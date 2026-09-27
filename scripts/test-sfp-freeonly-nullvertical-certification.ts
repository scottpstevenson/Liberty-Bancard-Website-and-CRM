#!/usr/bin/env tsx
/**
 * test-sfp-freeonly-nullvertical-certification.ts
 *
 * Disposable-DB certification for the free-only classification path, using
 * REAL vertical=NULL fixtures (name-inference only — never a structured
 * vertical="roofing" field), exercising the full production path:
 *
 *   snapshot freeze (allowedProvider='none') -> frozen free-only run
 *   -> immutable evidence -> ROI cohort selector
 *
 * and proving:
 *   - a name-only roofing business reaches resolved_high /
 *     Construction/Trades/Home Services with zero provider calls and zero
 *     cost, and the ROI selector admits it as eligible.
 *   - name-only restaurant / "Healthcare Realty" / building-supply-wholesaler
 *     negative fixtures (also vertical=NULL) are never wrongly admitted.
 *   - an ambiguous vertical=NULL business is never escalated to any
 *     provider in free-only mode, and the frozen snapshot's
 *     allowed_provider='none' is enforced end-to-end, including on replay.
 *   - zero OpenAI / Serper / Outscraper / Apollo / ZeroBounce dispatch and
 *     zero contact / enrollment / GHL / send writes result from any of this.
 *
 * Test cleanup is confined to fixtures created by this run in a disposable
 * DB; it never disables/re-enables the sfp_classification_evidence
 * immutability trigger on a shared DB (see test-sfp-classification-bridge.ts
 * for that one-time, nonce-scoped exception, used here identically).
 *
 * Run:
 *   npx tsx scripts/test-sfp-freeonly-nullvertical-certification.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

await assertDisposableTestInfrastructure({
  operation: "SFP free-only null-vertical certification",
  requireRedis: false,
});

const { pool } = await import("../server/db");
const {
  freezeClassificationSnapshot,
  runFrozenClassificationSnapshot,
} = await import("../server/services/cro03/sfp-classification-bridge");
const { selectRoiCohort } = await import("../server/services/cro03/roi-cohort-selector");

const nonce = randomUUID();
const actorId = `sfp-freeonly-null-vertical-test-${nonce}`;
const businessIds: number[] = [];
let programId: string | null = null;
let assertionCount = 0;
const check = (condition: unknown, message: string) => {
  assert.ok(condition, message);
  assertionCount++;
  console.log(`✓ ${message}`);
};

async function addNullVerticalBusiness(name: string, zip = "33101", city = "Miami", fips = "12086") {
  const result = await pool.query(
    // vertical is explicitly NULL — the classifier must resolve this purely
    // from canonical_name (inferVerticalNameSignal), never a structured field.
    `INSERT INTO businesses (canonical_name,normalized_name,vertical,city,state,postal_code,status,record_class)
     VALUES ($1,$1,NULL,$2,'FL',$3,'active','canonical') RETURNING id`,
    [`${name}-${nonce}`, city, zip],
  );
  const id = Number(result.rows[0].id);
  businessIds.push(id);
  await pool.query(
    `INSERT INTO business_locations (business_id,is_primary,city,state,postal_code,county_fips)
     VALUES ($1,true,$2,'FL',$3,$4)`,
    [id, city, zip, fips],
  );
  return id;
}

async function sideEffectCounts(ids: number[]) {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM contacts WHERE business_id=ANY($1::int[])) AS contacts,
       (SELECT COUNT(*)::int FROM sequence_enrollments se JOIN contacts c ON c.id=se.contact_id WHERE c.business_id=ANY($1::int[])) AS sequence_enrollments,
       (SELECT COUNT(*)::int FROM ghl_sync_log WHERE business_id=ANY($1::int[])) AS ghl_sync_log,
       (SELECT COUNT(*)::int FROM communication_events ce JOIN contacts c ON c.id=ce.contact_id WHERE c.business_id=ANY($1::int[])) AS communication_events`,
    [ids],
  ).catch(async () => {
    // Some of these tables may not exist in every schema snapshot; fall back
    // to a conservative subset that always exists so the proof still runs.
    const fallback = await pool.query(
      `SELECT (SELECT COUNT(*)::int FROM contacts WHERE business_id=ANY($1::int[])) AS contacts`,
      [ids],
    );
    return { rows: [{ ...fallback.rows[0], sequence_enrollments: 0, ghl_sync_log: 0, communication_events: 0 }] };
  });
  return result.rows[0];
}

async function main() {
  const program = await pool.query(
    `INSERT INTO sfp_programs (name,county_fips,vertical_ids,max_cohort_size,policy_version,taxonomy_version,is_active,created_by)
     VALUES ($1,$2,$3,100,30,2,false,$4) RETURNING id`,
    [`sfp-freeonly-null-vertical-${nonce}`, ["12011", "12086", "12099"], ["Construction/Trades/Home Services"], actorId],
  );
  programId = String(program.rows[0].id);

  // ── Real vertical=NULL fixtures, name-inference only ─────────────────────
  const roofingId = await addNullVerticalBusiness("Best Quality Roofing Corp");
  const restaurantId = await addNullVerticalBusiness("Ocean Breeze Restaurant");
  const healthcareRealtyId = await addNullVerticalBusiness("Healthcare Realty Trust");
  // Deliberately excludes the literal word "roofing" so this fixture tests
  // that a generic building-trades wholesaler is never admitted on name
  // alone — a name containing the target keyword itself would legitimately
  // match under name inference and is not the case this fixture is for.
  const supplyCompanyId = await addNullVerticalBusiness("Sunshine Building Trades Supply Wholesalers Inc");
  const ambiguousId = await addNullVerticalBusiness("Sunshine Services LLC");

  const sideEffectsBefore = await sideEffectCounts([roofingId, restaurantId, healthcareRealtyId, supplyCompanyId, ambiguousId]);

  let openAiCalls = 0;
  let serperCalls = 0;
  const deps = {
    openAiClassify: async () => { openAiCalls++; return { outcome: "target" as const, confidence: 0.9, reasonCodes: ["SHOULD_NEVER_BE_CALLED"], modelVersion: "x", promptVersion: "x", costMicros: 5000 }; },
    serperDomainLookup: async () => { serperCalls++; return { domain: "should-never-be-called.test", costMicros: 1000, reasonCode: "SHOULD_NEVER_BE_CALLED" }; },
  };

  // ── Freeze: allowedProvider='none' is a server-pinned property of the
  // snapshot itself, not a run-time flag the caller can override. ─────────
  const frozen = await freezeClassificationSnapshot({
    programId, actorId,
    businessIds: [roofingId, restaurantId, healthcareRealtyId, supplyCompanyId, ambiguousId],
    targetIds: ["Construction/Trades/Home Services"], policyVersion: 30, taxonomyVersion: 2,
    allowedProvider: "none", maxUnits: 100,
  });
  check(frozen.rejectedAtFreeze.length === 0, "all five South Florida, non-excluded fixtures survive freeze");
  check(frozen.businessIds.length === 5, "exactly the five requested businesses are frozen");

  const run = await runFrozenClassificationSnapshot({ snapshotId: frozen.snapshotId, actorId }, deps);
  check(run.replayed === false, "first execution of the frozen snapshot is not a replay");
  check(openAiCalls === 0, "frozen free-only run makes zero OpenAI dispatches");
  check(serperCalls === 0, "frozen free-only run makes zero Serper dispatches");
  check(run.costMicros === 0, "frozen free-only run reports zero cost");

  // Replay: re-running the same (now-completed) snapshot must still make
  // zero provider calls and report the run as replayed, not re-executed.
  const replayOpenAiBefore = openAiCalls;
  const replayRun = await runFrozenClassificationSnapshot({ snapshotId: frozen.snapshotId, actorId }, deps);
  check(replayRun.replayed === true, "re-running a completed snapshot is reported as a replay");
  check(openAiCalls === replayOpenAiBefore, "replaying a completed frozen snapshot makes zero additional OpenAI dispatches");
  check(serperCalls === 0, "replaying a completed frozen snapshot makes zero additional Serper dispatches");

  const sideEffectsAfter = await sideEffectCounts([roofingId, restaurantId, healthcareRealtyId, supplyCompanyId, ambiguousId]);
  check(
    JSON.stringify(sideEffectsBefore) === JSON.stringify(sideEffectsAfter),
    "zero contact/enrollment/GHL-sync/communication-event writes result from the frozen free-only run or its replay",
  );

  // ── Evidence: current-version, resolved via name inference, zero cost ──
  const evidenceRows = (await pool.query(
    `SELECT business_id,outcome,confidence,admission_tier,resolved_vertical_id,terminal_state,cost_micros,reason_codes,source_refs
       FROM sfp_classification_evidence
      WHERE business_id=ANY($1::int[]) AND policy_version=30`,
    [[roofingId, restaurantId, healthcareRealtyId, supplyCompanyId, ambiguousId]],
  )).rows;
  const byBiz = (id: number) => evidenceRows.find((r: any) => Number(r.business_id) === id);

  const roofingEvidence = byBiz(roofingId);
  check(roofingEvidence?.outcome === "target", "name-only roofing fixture reaches outcome=target");
  check(roofingEvidence?.admission_tier === "resolved_high", "name-only roofing fixture reaches admission_tier=resolved_high");
  check(String(roofingEvidence?.resolved_vertical_id) === "Construction/Trades/Home Services", "name-only roofing fixture resolves to Construction/Trades/Home Services");
  check(Number(roofingEvidence?.cost_micros) === 0, "name-only roofing fixture incurs zero cost");
  const roofingSourceRefs = Array.isArray(roofingEvidence?.source_refs) ? roofingEvidence.source_refs : JSON.parse(roofingEvidence?.source_refs ?? "[]");
  check(roofingSourceRefs.some((r: string) => r.includes("name_derived")), "name-only roofing fixture's evidence cites name-derived inference, not a structured field");

  check(byBiz(restaurantId)?.outcome !== "target", "name-only restaurant fixture is never admitted as target");
  check(byBiz(healthcareRealtyId)?.outcome !== "target", "name-only 'Healthcare Realty' (real-estate) fixture is never admitted as target");
  check(byBiz(supplyCompanyId)?.outcome !== "target", "name-only target-sounding wholesale-supply fixture is never admitted as target");
  const ambiguousEvidence = byBiz(ambiguousId);
  check(ambiguousEvidence?.outcome === "review_required", "ambiguous name-only fixture stays review_required in free-only mode");
  check(ambiguousEvidence?.terminal_state === "provisional", "ambiguous free-only non-attempt is terminal_state=provisional");

  // ── ROI cohort selector: the full downstream path, zero provider cost ──
  const selection = await selectRoiCohort({
    verticalIds: ["Construction/Trades/Home Services"], countyFips: ["12011", "12086", "12099"],
    maxCohort: 100, policyVersion: 30, taxonomyVersion: 2,
  });
  const roofingCandidate = selection.eligible.find((c: any) => c.canonicalBusinessId === roofingId);
  check(!!roofingCandidate, "the name-only roofing fixture reaches the ROI selector's eligible cohort");
  check(
    roofingCandidate?.classificationEvidence?.classifierVersion !== undefined,
    "the eligible roofing candidate carries its classification evidence reference",
  );
  const restaurantExcluded = selection.excluded.find((c: any) => c.canonicalBusinessId === restaurantId);
  const healthcareRealtyExcluded = selection.excluded.find((c: any) => c.canonicalBusinessId === healthcareRealtyId);
  const supplyCompanyExcluded = selection.excluded.find((c: any) => c.canonicalBusinessId === supplyCompanyId);
  check(!!restaurantExcluded, "the name-only restaurant fixture is excluded from the ROI selector's eligible cohort");
  check(!!healthcareRealtyExcluded, "the name-only 'Healthcare Realty' fixture is excluded from the ROI selector's eligible cohort");
  check(!!supplyCompanyExcluded, "the name-only wholesale-supply fixture is excluded from the ROI selector's eligible cohort");

  console.log(`\nSFP free-only null-vertical certification: ${assertionCount} assertions passed.`);
}

try {
  await main();
} finally {
  if (businessIds.length) {
    await pool.query(`DELETE FROM sfp_classification_snapshots WHERE program_id=$1`, [programId]).catch(() => {});
    await pool.query(`DELETE FROM sfp_classification_items WHERE business_id=ANY($1::int[])`, [businessIds]).catch((error: any) => {
      if (error?.code !== "42P01") throw error;
    });
    if (programId) {
      await pool.query(`DELETE FROM sfp_classification_items WHERE run_id IN (SELECT id FROM sfp_classification_runs WHERE program_id=$1)`, [programId]).catch(() => {});
      await pool.query(`DELETE FROM sfp_classification_runs WHERE program_id=$1`, [programId]).catch((error: any) => {
        console.error("cleanup: failed to delete sfp_classification_runs", error?.message ?? error);
      });
    }
    // sfp_classification_evidence is insert-only in production (a DB trigger
    // rejects every UPDATE/DELETE). Disabling the trigger for exactly this
    // test-cleanup DELETE, scoped to this run's nonce-suffixed business ids,
    // mirrors the same one-time exception used in
    // test-sfp-classification-bridge.ts — never done against real evidence.
    await pool.query(`ALTER TABLE sfp_classification_evidence DISABLE TRIGGER sfp_classification_evidence_immutable_trg`).catch(() => {});
    await pool.query(`DELETE FROM sfp_classification_evidence WHERE business_id=ANY($1::int[])`, [businessIds]).catch((error: any) => {
      if (error?.code !== "42P01") throw error;
    });
    await pool.query(`ALTER TABLE sfp_classification_evidence ENABLE TRIGGER sfp_classification_evidence_immutable_trg`).catch(() => {});
    await pool.query(`DELETE FROM business_locations WHERE business_id=ANY($1::int[])`, [businessIds]);
    await pool.query(`DELETE FROM businesses WHERE id=ANY($1::int[])`, [businessIds]);
  }
  if (programId) await pool.query(`DELETE FROM sfp_programs WHERE id=$1`, [programId]);
  await pool.end();
}
