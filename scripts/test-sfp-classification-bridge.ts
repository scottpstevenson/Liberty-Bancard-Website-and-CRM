#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import {
  applyCertificationProviderDenyBoundary,
  getBlockedCertificationNetworkAttemptCount,
} from "./certification-provider-deny";

await assertDisposableTestInfrastructure({
  operation: "SFP classification bridge disposable certification",
  requireRedis: false,
});
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });
const { pool } = await import("../server/db");
const {
  runPreCohortClassificationBridge: runPreCohortClassificationBridgeCore,
  getLatestAdmissibleClassificationEvidence,
} = await import("../server/services/cro03/sfp-classification-bridge");
const { selectRoiCohort } = await import("../server/services/cro03/roi-cohort-selector");
const { CLASSIFIER_VERSION } = await import("../server/services/cro03/sfp-vertical-classifier");

const nonce = randomUUID();
const programName = `sfp-c1-bridge-${nonce}`;
const actorId = `sfp-c1-test-${nonce}`;
const businessIds: number[] = [];
let programId: string | null = null;
let assertionCount = 0;
const check = (condition: unknown, message: string) => {
  assert.ok(condition, message);
  assertionCount++;
  console.log(`✓ ${message}`);
};

const runPreCohortClassificationBridge: typeof runPreCohortClassificationBridgeCore = (input, deps) =>
  runPreCohortClassificationBridgeCore({ ...input, allowWebsiteEvidenceFetch: false }, deps);

async function addBusiness(
  name: string, vertical: string, zip = "33101", city = "Miami", fips = "12086", state = "FL",
) {
  const result = await pool.query(
    `INSERT INTO businesses (canonical_name,normalized_name,vertical,city,state,postal_code,status,record_class)
     VALUES ($1,$1,$2,$3,$5,$4,'active','canonical') RETURNING id`,
    [`${name}-${nonce}`, vertical, city, zip, state],
  );
  const id = Number(result.rows[0].id);
  businessIds.push(id);
  await pool.query(
    `INSERT INTO business_locations (business_id,is_primary,city,state,postal_code,county_fips)
     VALUES ($1,true,$2,$5,$3,$4)`,
    [id, city, zip, fips, state],
  );
  return id;
}

async function protectedCounts() {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM sfp_stage_runs r JOIN sfp_stage_items i ON i.stage_run_id=r.id WHERE i.business_id=ANY($1::int[])) AS stage_runs,
       (SELECT COUNT(*)::int FROM sfp_cohort_runs r JOIN sfp_cohort_members m ON m.cohort_run_id=r.id WHERE m.business_id=ANY($1::int[])) AS cohort_runs,
       (SELECT COUNT(*)::int FROM sfp_cohort_members WHERE business_id=ANY($1::int[])) AS cohort_members,
       (SELECT COUNT(*)::int FROM sfp_cohort_decisions WHERE business_id=ANY($1::int[])) AS cohort_decisions`,
    [businessIds],
  );
  return result.rows[0];
}

async function main() {
  const program = await pool.query(
    `INSERT INTO sfp_programs (name,county_fips,vertical_ids,max_cohort_size,policy_version,is_active,created_by)
     VALUES ($1,$2,$3,100,1,false,$4) RETURNING id`,
    [programName, ["12011", "12086", "12099"], ["Dental"], actorId],
  );
  programId = String(program.rows[0].id);
  const bridgeProgramId = programId;

  const outsideId = await addBusiness("outside", "dental", "30301", "Atlanta", "13089", "GA");
  const dentalId = await addBusiness("dental", "dental");
  const ambiguousFakeId = await addBusiness("ambiguous-fake", "healthcare");
  const ambiguousNoAdapterId = await addBusiness("ambiguous-no-adapter", "healthcare");

  const noProtectedRowsBefore = await protectedCounts();
  const firstKey = `c1-${nonce}-dental`;
  const openAiCalls: number[] = [];
  // Scope selection to exactly these fixture businesses (businessIdFilter):
  // this dev database already has hundreds of real South-Florida-resolvable
  // canonical businesses awaiting classification, which would otherwise fill
  // every bounded run (ORDER BY id ASC) and starve out these newly-inserted,
  // higher-id fixtures. See sfp-classification-bridge.ts's businessIdFilter
  // doc comment for the production rationale.
  await runPreCohortClassificationBridge({
    programId: bridgeProgramId, idempotencyKey: firstKey, actorId, maxBusinesses: 100, targetIds: ["Dental"], policyVersion: 1,
    businessIdFilter: businessIds,
  }, { openAiClassify: async ({ businessId }) => {
    openAiCalls.push(businessId);
    return businessId === ambiguousFakeId || businessId === ambiguousNoAdapterId ? {
      outcome: "target", confidence: 0.91, reasonCodes: ["TEST_FAKE_OPENAI"], modelVersion: "test-model",
      promptVersion: "test-prompt", costMicros: 0, resolvedVerticalId: "Dental",
    } : null;
  } });
  const evidenceBefore = await pool.query(
    `SELECT COUNT(*)::int AS n FROM sfp_classification_evidence WHERE business_id=ANY($1::int[])`,
    [[outsideId, dentalId, ambiguousFakeId, ambiguousNoAdapterId]],
  );
  const replay = await runPreCohortClassificationBridge({
    programId: bridgeProgramId, idempotencyKey: firstKey, actorId, maxBusinesses: 100, targetIds: ["Dental"], policyVersion: 1,
    businessIdFilter: businessIds,
  });
  const evidenceAfter = await pool.query(
    `SELECT COUNT(*)::int AS n FROM sfp_classification_evidence WHERE business_id=ANY($1::int[])`,
    [[outsideId, dentalId, ambiguousFakeId, ambiguousNoAdapterId]],
  );
  check(replay.replayed, "same-key/same-config run is reported as replayed");
  check(Number(evidenceBefore.rows[0].n) === Number(evidenceAfter.rows[0].n), "idempotent replay creates no evidence rows");
  check(!openAiCalls.includes(dentalId), "exact dental alias does not invoke OpenAI");

  await assert.rejects(
    runPreCohortClassificationBridge({
      programId: bridgeProgramId, idempotencyKey: firstKey, actorId, maxBusinesses: 99, targetIds: ["Dental"], policyVersion: 1,
      businessIdFilter: businessIds,
    }),
    /SFP_CLASSIFICATION_DIVERGENT_REPLAY/,
  );
  assertionCount++;
  console.log("✓ divergent maxBusinesses replay is rejected");
  await assert.rejects(
    runPreCohortClassificationBridge({
      programId: bridgeProgramId, idempotencyKey: firstKey, actorId, maxBusinesses: 100, targetIds: ["Restaurant"], policyVersion: 1,
      businessIdFilter: businessIds,
    }),
    /SFP_CLASSIFICATION_DIVERGENT_REPLAY/,
  );
  assertionCount++;
  console.log("✓ divergent targetIds replay is rejected");

  check(openAiCalls.includes(ambiguousFakeId), "ambiguous fixture escalated through the injected classifier");

  await runPreCohortClassificationBridge({
    programId: bridgeProgramId, idempotencyKey: `c1-${nonce}-ambiguous-no-adapter`, actorId, maxBusinesses: 100,
    targetIds: ["Dental"], policyVersion: 2, businessIdFilter: businessIds,
  });

  const fixtures = await pool.query(
    `SELECT business_id,outcome,reason_codes,policy_version FROM sfp_classification_evidence
      WHERE business_id=ANY($1::int[]) AND policy_version IN (1,2) ORDER BY created_at ASC`,
    [[outsideId, dentalId, ambiguousFakeId, ambiguousNoAdapterId]],
  );
  const fixtureRows = fixtures.rows;
  check(!fixtureRows.some((r: any) => Number(r.business_id) === outsideId), "outside-county business receives no classification evidence");
  const dentalEvidence = fixtureRows.find((r: any) => Number(r.business_id) === dentalId);
  check(dentalEvidence?.outcome === "target", "exact dental alias deterministically classifies as target");
  const fakeEvidence = fixtureRows.find((r: any) => Number(r.business_id) === ambiguousFakeId && Number(r.policy_version) === 1);
  check(fakeEvidence?.outcome === "target", "fake OpenAI target outcome is persisted");
  const noAdapterEvidence = fixtureRows.find((r: any) => Number(r.business_id) === ambiguousNoAdapterId && Number(r.policy_version) === 2);
  const noAdapterReasons = Array.isArray(noAdapterEvidence?.reason_codes)
    ? noAdapterEvidence.reason_codes : JSON.parse(noAdapterEvidence?.reason_codes ?? "[]");
  check(noAdapterEvidence?.outcome === "review_required", "ambiguous classification without adapter remains review_required");
  check(noAdapterReasons.includes("OPENAI_ESCALATION_NOT_CONFIGURED") || noAdapterReasons.includes("OPENAI_UNAVAILABLE"), "no-adapter evidence records an explicit non-attempt reason code");

  // Two admissible rows at one policy version prove latest timestamp wins;
  // a still-newer row at a different policy version must not leak into lookup.
  const older = await pool.query(
    `INSERT INTO sfp_classification_evidence
       (business_id,evidence_hash,source_refs,classifier_version,policy_version,outcome,confidence,reason_codes,idempotency_key,created_at)
     VALUES ($1,$2,'[]'::jsonb,1,7,'review_required',0.2,'[]'::jsonb,$3,NOW()-INTERVAL '1 day') RETURNING id,evidence_hash`,
    [dentalId, `older-${nonce}`, `older-${nonce}`],
  );
  const newer = await pool.query(
    `INSERT INTO sfp_classification_evidence
       (business_id,evidence_hash,source_refs,classifier_version,policy_version,outcome,confidence,reason_codes,idempotency_key,created_at)
     VALUES ($1,$2,'[]'::jsonb,$4,7,'target',0.9,'[]'::jsonb,$3,NOW()) RETURNING id,evidence_hash`,
    [dentalId, `newer-${nonce}`, `newer-${nonce}`, CLASSIFIER_VERSION],
  );
  await pool.query(
    `INSERT INTO sfp_classification_evidence
       (business_id,evidence_hash,source_refs,classifier_version,policy_version,outcome,confidence,reason_codes,idempotency_key,created_at)
     VALUES ($1,$2,'[]'::jsonb,9,8,'non_target',0.9,'[]'::jsonb,$3,NOW()+INTERVAL '1 day')`,
    [dentalId, `other-policy-${nonce}`, `other-policy-${nonce}`],
  );
  const latest = await getLatestAdmissibleClassificationEvidence(dentalId, 7);
  check(latest?.id === String(newer.rows[0].id), "latest evidence is deterministic at exact policy version and ignores other policies");
  check(String(older.rows[0].evidence_hash) !== String(newer.rows[0].evidence_hash), "lookup fixture contains distinct evidence hashes");

  const itemRows = await pool.query(
    `SELECT business_id,state,outcome_code FROM sfp_classification_items WHERE business_id=ANY($1::int[])`,
    [businessIds],
  );
  const outsideGeographyItem = itemRows.rows.find((r: any) =>
    Number(r.business_id) === outsideId && String(r.outcome_code ?? "").includes('"route":"outside_territory"'),
  );
  check(outsideGeographyItem?.state === "skipped", "out-of-territory geography is durably routed as an explicit non-target skip");
  const outsideGeographyFacts = JSON.parse(outsideGeographyItem.outcome_code);
  check(outsideGeographyFacts.reasons.length > 0 && outsideGeographyFacts.candidates.length > 0,
    "geography routing retains actual resolver reasons and source-location references");
  const protectedRowsAfter = await protectedCounts();
  check(JSON.stringify(noProtectedRowsBefore) === JSON.stringify(protectedRowsAfter), "bridge writes no stage/cohort run, member, or decision rows");

  // Governed Serper domain discovery: only invoked when explicitly enabled
  // and only for a business missing a domain; discovered domain is
  // persisted so a later run never re-spends on the same business.
  const noDomainId = await addBusiness("no-domain-dental", "dental", "33101", "Miami", "12086");
  const discoveryCalls: number[] = [];
  const fakeLookup = async (lookupInput: { businessId: number }) => {
    discoveryCalls.push(lookupInput.businessId);
    return { domain: "example-dental-clinic.test", costMicros: 4000, reasonCode: "SERPER_DOMAIN_DISCOVERED" };
  };
  await runPreCohortClassificationBridge({
    programId: bridgeProgramId, idempotencyKey: `c1-${nonce}-discovery-disabled`, actorId, maxBusinesses: 100,
    targetIds: ["Dental"], policyVersion: 3, businessIdFilter: [noDomainId], allowGovernedSerperDomainDiscovery: false,
  }, { serperDomainLookup: fakeLookup });
  check(discoveryCalls.length === 0, "domain discovery is never invoked unless explicitly authorized");

  await runPreCohortClassificationBridge({
    programId: bridgeProgramId, idempotencyKey: `c1-${nonce}-discovery-enabled`, actorId, maxBusinesses: 100,
    targetIds: ["Dental"], policyVersion: 4, businessIdFilter: [noDomainId], allowGovernedSerperDomainDiscovery: true,
  }, { serperDomainLookup: fakeLookup });
  check(discoveryCalls.includes(noDomainId), "authorized domain discovery invokes the injected lookup for the domain-less business");
  const discoveredBiz = await pool.query(`SELECT website_domain FROM businesses WHERE id=$1`, [noDomainId]);
  check(discoveredBiz.rows[0]?.website_domain === "example-dental-clinic.test", "discovered domain is persisted onto the business");
  const discoveryEvidence = await pool.query(
    `SELECT cost_micros, reason_codes FROM sfp_classification_evidence WHERE business_id=$1 AND policy_version=4`,
    [noDomainId],
  );
  check(Number(discoveryEvidence.rows[0]?.cost_micros) === 4000, "discovery cost is folded into the classification evidence cost ledger");
  const discoveryReasons = Array.isArray(discoveryEvidence.rows[0]?.reason_codes)
    ? discoveryEvidence.rows[0].reason_codes : JSON.parse(discoveryEvidence.rows[0]?.reason_codes ?? "[]");
  check(discoveryReasons.includes("SERPER_DOMAIN_DISCOVERED"), "discovery reason code is recorded on the evidence row");

  const discoveryCallsBeforeReplay = discoveryCalls.length;
  await runPreCohortClassificationBridge({
    programId: bridgeProgramId, idempotencyKey: `c1-${nonce}-discovery-rerun`, actorId, maxBusinesses: 100,
    targetIds: ["Dental"], policyVersion: 5, businessIdFilter: [noDomainId], allowGovernedSerperDomainDiscovery: true,
  }, { serperDomainLookup: fakeLookup });
  check(discoveryCalls.length === discoveryCallsBeforeReplay, "a later run never re-discovers a domain the business already has on file");

  // ── Free-only mode: zero provider calls, ambiguous cases stay provisional ──
  const roofingId = await addBusiness("Best Quality Roofing Corp", "roofing");
  const restaurantId = await addBusiness("Ocean Breeze Restaurant", "restaurant");
  const healthcareRealtyId = await addBusiness("Healthcare Realty Trust", "real estate");
  const supplySoundingId = await addBusiness("Roofing Supply Depot Inc", "wholesale building supplies");
  const ambiguousFreeId = await addBusiness("ambiguous-free-only", "services");

  let freeOnlyOpenAiCalls = 0;
  let freeOnlySerperCalls = 0;
  await runPreCohortClassificationBridge({
    programId: bridgeProgramId, idempotencyKey: `c1-${nonce}-free-only`, actorId, maxBusinesses: 100,
    targetIds: ["Construction/Trades/Home Services"], policyVersion: 10, taxonomyVersion: 2,
    businessIdFilter: [roofingId, restaurantId, healthcareRealtyId, supplySoundingId, ambiguousFreeId],
    allowGovernedSerperDomainDiscovery: true, // must be forced off by freeOnly regardless of this
    freeOnly: true,
  }, {
    openAiClassify: async () => { freeOnlyOpenAiCalls++; return { outcome: "target", confidence: 0.9, reasonCodes: ["SHOULD_NEVER_BE_CALLED"], modelVersion: "x", promptVersion: "x", costMicros: 5000 }; },
    serperDomainLookup: async () => { freeOnlySerperCalls++; return { domain: "should-never-be-called.test", costMicros: 1000, reasonCode: "SHOULD_NEVER_BE_CALLED" }; },
  });
  check(freeOnlyOpenAiCalls === 0, "free-only mode never invokes the OpenAI classifier");
  check(freeOnlySerperCalls === 0, "free-only mode never invokes Serper domain discovery even when explicitly requested");

  const freeOnlyEvidence = await pool.query(
    `SELECT business_id,outcome,reason_codes,terminal_state,cost_micros FROM sfp_classification_evidence
      WHERE business_id=ANY($1::int[]) AND policy_version=10`,
    [[roofingId, restaurantId, healthcareRealtyId, supplySoundingId, ambiguousFreeId]],
  );
  const byBiz = (id: number) => freeOnlyEvidence.rows.find((r: any) => Number(r.business_id) === id);
  check(byBiz(roofingId)?.outcome === "target", "exact roofing alias classifies as target with zero provider calls");
  check(byBiz(restaurantId)?.outcome === "non_target", "restaurant business is an explicit non-target, not review_required");
  check(byBiz(healthcareRealtyId)?.outcome !== "target", "'Healthcare Realty' (real-estate, not healthcare) is never admitted as target");
  check(byBiz(supplySoundingId)?.outcome !== "target", "target-sounding wholesale supply business is never admitted as target on name alone");
  const ambiguousFreeEvidence = byBiz(ambiguousFreeId);
  check(ambiguousFreeEvidence?.outcome === "review_required", "ambiguous case in free-only mode stays review_required rather than escalating");
  const ambiguousFreeReasons = Array.isArray(ambiguousFreeEvidence?.reason_codes)
    ? ambiguousFreeEvidence.reason_codes : JSON.parse(ambiguousFreeEvidence?.reason_codes ?? "[]");
  check(ambiguousFreeReasons.includes("FREE_ONLY_NO_ESCALATION"), "free-only non-attempt records FREE_ONLY_NO_ESCALATION reason code");
  check(ambiguousFreeEvidence?.terminal_state === "provisional", "free-only non-attempt is terminal_state=provisional so a later paid run can retry");
  check(Number(ambiguousFreeEvidence?.cost_micros) === 0, "free-only non-attempt records zero cost");

  // ── Stale classifier version must never masquerade as current evidence ──
  // even when it is the NEWEST row by timestamp. An old-classifier row
  // inserted after a current-classifier row is exactly the production
  // defect: "current" selection must be classifier_version-scoped, not just
  // most-recent-by-timestamp.
  // Live text is deliberately ambiguous ("services") so the ONLY thing that
  // could wrongly admit this business is a stale evidence row.
  const staleClassifierId = await addBusiness("Stale Classifier Ambiguous Co", "services");
  // An old-classifier-version row claiming a resolved_high TARGET outcome --
  // this is the shape a pre-fix classifier bug would have produced -- and it
  // is the NEWEST row by timestamp, so a timestamp-only "latest wins" lookup
  // would wrongly treat it as current.
  await pool.query(
    `INSERT INTO sfp_classification_evidence
       (business_id,evidence_hash,source_refs,classifier_version,policy_version,taxonomy_version,outcome,confidence,reason_codes,idempotency_key,terminal_state,admission_tier,resolved_vertical_id,created_at)
     VALUES ($1,$2,'[]'::jsonb,$3,20,2,'target',0.9,'[]'::jsonb,$4,'completed','resolved_high','Construction/Trades/Home Services',NOW())`,
    [staleClassifierId, `old-classifier-newer-ts-${nonce}`, CLASSIFIER_VERSION - 1, `old-classifier-newer-ts-${nonce}`],
  );
  // An older-by-timestamp row at the CURRENT classifier version, correctly
  // review_required -- the row that should actually govern.
  await pool.query(
    `INSERT INTO sfp_classification_evidence
       (business_id,evidence_hash,source_refs,classifier_version,policy_version,taxonomy_version,outcome,confidence,reason_codes,idempotency_key,terminal_state,created_at)
     VALUES ($1,$2,'[]'::jsonb,$3,20,2,'review_required',0.4,'[]'::jsonb,$4,'completed',NOW()-INTERVAL '2 hours')`,
    [staleClassifierId, `current-classifier-older-ts-${nonce}`, CLASSIFIER_VERSION, `current-classifier-older-ts-${nonce}`],
  );
  const staleSelection = await selectRoiCohort({
    verticalIds: ["Construction/Trades/Home Services"], countyFips: ["12086"], maxCohort: 100,
    policyVersion: 20, taxonomyVersion: 2,
  });
  const staleEligible = staleSelection.eligible.find((c: any) => c.canonicalBusinessId === staleClassifierId);
  const staleExcluded = staleSelection.excluded.find((c: any) => c.canonicalBusinessId === staleClassifierId);
  check(!staleEligible, "a newer-by-timestamp old-classifier-version 'target' row never admits an otherwise-ambiguous business");
  check(!!staleExcluded, "the business is excluded, governed by the current-classifier-version review_required row instead");
  check(
    staleExcluded?.classificationEvidence?.classifierVersion === CLASSIFIER_VERSION,
    "attached classificationEvidence (when present) is always scoped to the current classifier version, never the stale one",
  );

  check(getBlockedCertificationNetworkAttemptCount() === 0,
    "classification bridge certification completes without an external network attempt");
  console.log(`\nSFP classification bridge: ${assertionCount} assertions passed.`);
}

try {
  await main();
} finally {
  if (businessIds.length) {
    await pool.query(`DELETE FROM sfp_classification_items WHERE business_id=ANY($1::int[])`, [businessIds]).catch((error: any) => {
      if (error?.code !== "42P01") throw error;
    });
    if (programId) {
      await pool.query(`DELETE FROM sfp_classification_items WHERE run_id IN (SELECT id FROM sfp_classification_runs WHERE program_id=$1)`, [programId]).catch(() => {});
      await pool.query(`DELETE FROM sfp_classification_runs WHERE program_id=$1`, [programId]).catch((error: any) => {
        console.error("cleanup: failed to delete sfp_classification_runs", error?.message ?? error);
      });
    }
    // sfp_classification_evidence is insert-only in production (a DB
    // trigger rejects every UPDATE/DELETE -- see migration 0288) and is
    // FK'd to businesses, so disposable test fixtures would otherwise
    // accumulate forever. Disabling the trigger for exactly this
    // test-cleanup DELETE (scoped to this run's nonce-suffixed business
    // ids) is the same one-time exception pattern migration 0301 uses for
    // its backfill -- never done against real evidence rows.
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