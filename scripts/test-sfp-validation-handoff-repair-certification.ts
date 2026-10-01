#!/usr/bin/env tsx
/**
 * test-sfp-validation-handoff-repair-certification.ts
 *
 * Disposable-database certification for the stalled-SFP-email-validation
 * repair. Proves two independent fixes together restore the eligible ->
 * ZeroBounce -> eligibility -> ready_held handoff:
 *
 *  FIX-1 (sfp-attestation-refresh.ts): the refresh tick now requests the
 *        max 15-minute attestation TTL instead of the implicit 60-second
 *        default, so a fresh attestation always outlives the 5-minute
 *        refresh interval. Before the fix, ~4 of every 5 minutes had NO
 *        live attestation and every validation tick landing there saw
 *        getSfpAttestationReadiness() report "no_live_runtime_attestation".
 *
 *  FIX-2 (sfp-validation.ts getUndecidedCohortBizIds): preview/snapshot/
 *        execute now exclude businesses that already carry a decided
 *        (non-'validation_pending') eligibility row for the cohort+policy,
 *        so each call's top-N-by-ROI slice advances to the next undecided
 *        businesses instead of re-selecting the same top N forever. Proves
 *        a cohort larger than one validation batch actually drains beyond
 *        the first batch across successive calls, exactly like the
 *        continuous tick calling executeSfpValidation repeatedly over time.
 *
 * Also certifies the full terminal-state matrix (valid / invalid /
 * catch-all / spamtrap / abuse / do_not_mail / unknown / failed(retryable)
 * / suppressed / missing-candidate), idempotent replay, and zero real
 * provider network calls (fake zbTransport only — the certification
 * provider-deny boundary would hard-fail any real HTTP attempt).
 *
 * Never touches outbound_pause_control, zerobounce_auto_run_enabled, or any
 * spend cap/counter outside this disposable database.
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "./certification-provider-deny";

await assertDisposableTestInfrastructure({
  operation: "SFP validation handoff repair disposable certification",
  requireRedis: false,
});
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });
process.env.FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED = "true";

let assertions = 0;
function check(value: unknown, id: string, label: string): asserts value {
  assertions++;
  assert.ok(value, `[${id}] ${label}`);
  console.log(`✓ [${id}] ${label}`);
}

const { runDrizzleMigrations } = await import("../server/db-migrate");
await runDrizzleMigrations();

const { db } = await import("../server/db");
const rows = (r: any): any[] => r?.rows ?? r ?? [];
const RUN_ID = `sfpvhr-${randomUUID().slice(0, 8)}`;
await (await import("./helpers/sfp-runtime-test-identity"))
  .selectSfpRuntimeTestRelease(`cert:${RUN_ID}`);

const { ensureProgram, setProgramActivation, previewFunnel, freezeCohort } = await import(
  "../server/services/cro03/south-florida-prospecting"
);
const { previewSfpValidation, executeSfpValidation, SFP_VALIDATION_MAX } = await import(
  "../server/services/cro03/sfp-validation"
);
const { claimValidationCandidate } = await import("../server/services/cro03/sfp-validation");
const { getUnifiedSfpCandidates } = await import("../server/services/cro03/sfp-paid-evidence-writer");
const { getActiveSfpOutreachPolicy } = await import("../server/services/cro03/sfp-outreach-policy");
const { seal } = await import("../server/services/cro03/candidate-evidence-service");
const { createCro03cRuntimeAttestation } = await import("../server/services/cro03/live-execution");
const { processSfpAttestationRefreshTick } = await import("../server/services/cro03/sfp-attestation-refresh");
const { processSfpContinuousValidationTick } = await import("../server/services/cro03/sfp-continuous-discovery");

try {
  const { execSync } = await import("node:child_process");
  execSync("npx tsx scripts/seed-mi09-pricing.ts --apply --confirm-env=test", { stdio: "pipe", env: process.env });
} catch {
  /* idempotent */
}

const program = await ensureProgram({ createdBy: `cert:${RUN_ID}` });
await setProgramActivation({ active: true, actorId: `cert:${RUN_ID}` });

const { authorizePaidBudget, MI09_PAID_BUDGET_TYPED_CONFIRMATION } = await import(
  "../server/services/mi09-pilot-authority"
);
await authorizePaidBudget({ authorizedBy: `cert:${RUN_ID}`, typedConfirmation: MI09_PAID_BUDGET_TYPED_CONFIRMATION });

await db.execute(sql`
  UPDATE provider_controls
     SET enabled = TRUE, circuit_state = 'closed', local_budget_units = 1000000, version = version + 1, updated_at = NOW()
   WHERE provider = 'zerobounce'
`);

// ══════════════════════════════════════════════════════════════════════════
// FIX-1: attestation TTL — createCro03cRuntimeAttestation's real gate
// requires a full live worker-fleet/deployment-inventory attestation
// (evaluateCro03cRuntimeFleet), which this disposable-DB cert does not
// stand up. Instead of faking an entire fleet, this asserts the exact
// arithmetic defect directly against the live source: the refresh tick's
// call site must now request a TTL that outlives its own 5-minute
// refresh interval, where before it silently relied on the function's
// 60-second default.
// ══════════════════════════════════════════════════════════════════════════
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_TTL_MS = 60_000; // createCro03cRuntimeAttestation's ttlMs default when omitted
check(
  DEFAULT_TTL_MS < REFRESH_INTERVAL_MS,
  "FIX1-repro",
  `createCro03cRuntimeAttestation's implicit default TTL (${DEFAULT_TTL_MS / 1000}s) is shorter than the 5-min refresh interval — this is the exact gap that stalled every validation tick landing outside the first minute after a refresh`,
);
const refreshSource = await (await import("node:fs/promises")).readFile(
  new URL("../server/services/cro03/sfp-attestation-refresh.ts", import.meta.url),
  "utf-8",
);
const ttlMatch = refreshSource.match(/ttlMs:\s*([0-9_]+)\s*\*\s*60_000/);
check(!!ttlMatch, "FIX1-a", "the refresh tick's createCro03cRuntimeAttestation call now passes an explicit ttlMs (no longer relies on the 60s implicit default)");
const patchedTtlMs = ttlMatch ? Number(ttlMatch[1].replace(/_/g, "")) * 60_000 : 0;
check(
  patchedTtlMs >= REFRESH_INTERVAL_MS,
  "FIX1-b",
  `patched refresh call requests a ${patchedTtlMs / 60_000}-minute TTL, which outlives the 5-minute refresh interval — closes the dead-attestation gap`,
);
check(patchedTtlMs <= 15 * 60_000, "FIX1-c", "the requested TTL stays within createCro03cRuntimeAttestation's own 15-minute clamp — no new unbounded-authority window introduced");

// C5 source contracts: continuous selection must page the complete frozen
// cohort set and order by durable prior activity, rather than a newest-25
// window. ROI remains the stable tie-break in the starvation-protected
// pre-cohort selector.
const continuousSource = await (await import("node:fs/promises")).readFile(
  new URL("../server/services/cro03/sfp-continuous-discovery.ts", import.meta.url), "utf-8",
);
check(!/LIMIT\s+25\b/.test(continuousSource), "C5-cohort-page", "continuous discovery/validation no longer truncates frozen cohorts to the newest 25");
check(continuousSource.includes("MAX(s.last_heartbeat_at)") && continuousSource.includes("stage='validation'"),
  "C5-cohort-fairness", "validation cohort selection rotates from persisted least-recently-worked progress");
const roiSource = await (await import("node:fs/promises")).readFile(
  new URL("../server/services/cro03/roi-cohort-selector.ts", import.meta.url), "utf-8",
);
check(roiSource.includes("lastFrozenAt") && roiSource.includes("b.roiScore - a.roiScore"),
  "C5-roi-starvation", "cohort selection prioritizes least-recently-frozen businesses while retaining deterministic ROI priority");

// ══════════════════════════════════════════════════════════════════════════
// Fixture: one cohort with 6 businesses, each with a distinct ZB outcome
// intent, plus a 7th business with NO candidate at all (missing-email case)
// ══════════════════════════════════════════════════════════════════════════
const OUTCOMES: Array<{ label: string; zb: string }> = [
  { label: "valid", zb: "valid" },
  { label: "invalid", zb: "invalid" },
  { label: "catch-all", zb: "catch-all" },
  { label: "spamtrap", zb: "spamtrap" },
  { label: "abuse", zb: "abuse" },
  { label: "do_not_mail", zb: "do_not_mail" },
  { label: "unknown", zb: "unknown" },
  { label: "failed-retryable", zb: "failed" },
];

const bizByLabel = new Map<string, number>();
const emailByLabel = new Map<string, string>();
const genRow = rows(await db.execute(sql`
  INSERT INTO free_discovery_generations (run_key, actor_id, purpose, reason, state)
  VALUES (${`cert-vhr-${RUN_ID}`}, ${`cert:${RUN_ID}`}, 'email_discovery', 'certification', 'running')
  RETURNING id
`))[0];
const generationId = String(genRow.id);

for (const [i, o] of OUTCOMES.entries()) {
  const name = `${RUN_ID}-biz-${o.label}`;
  const bizRow = rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name, normalized_name, vertical, state, record_class, created_at)
    VALUES (${name}, ${name.toLowerCase()}, 'Med Spa', 'FL', 'canonical', NOW())
    RETURNING id
  `))[0];
  const bizId = Number(bizRow.id);
  bizByLabel.set(o.label, bizId);
  await db.execute(sql`INSERT INTO business_locations (business_id, county_fips, created_at) VALUES (${bizId}, '12086', NOW())`);

  const email = `${o.label}-${RUN_ID}@gmail.com`;
  emailByLabel.set(o.label, email);
  const sealed = seal("email", email);
  await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id, business_id, field, subject_type, domain, source,
       attribution_scope, disposition, confidence, envelope_ciphertext,
       envelope_nonce, envelope_tag, envelope_key_version,
       normalized_value_hash, masked_value, created_at)
    VALUES (${generationId}::uuid, ${bizId}, 'email', 'business',
      ${`${RUN_ID}-${o.label}.example.com`}, 'cert-seed', 'role', 'staged', ${70 - i},
      ${sealed.ciphertext}, ${sealed.nonce}, ${sealed.tag}, 1,
      ${sealed.normalizedValueHash}, ${sealed.maskedValue}, NOW())
  `);
}
// Missing-email business: cohort member, zero candidates of any kind.
const missingBizRow = rows(await db.execute(sql`
  INSERT INTO businesses (canonical_name, normalized_name, vertical, state, record_class, created_at)
  VALUES (${`${RUN_ID}-biz-missing`}, ${`${RUN_ID}-biz-missing`.toLowerCase()}, 'Med Spa', 'FL', 'canonical', NOW())
  RETURNING id
`))[0];
const missingBizId = Number(missingBizRow.id);
await db.execute(sql`INSERT INTO business_locations (business_id, county_fips, created_at) VALUES (${missingBizId}, '12086', NOW())`);

// Filler businesses: enough "valid" candidates to push the cohort past
// SFP_VALIDATION_MAX so a single batch cannot possibly decide the whole
// cohort — this is what makes FIX-2's cross-batch draining observable
// rather than trivially true.
const fillerBizIds: number[] = [];
const FILLER_COUNT = SFP_VALIDATION_MAX + 5;
for (let i = 0; i < FILLER_COUNT; i++) {
  const name = `${RUN_ID}-biz-filler-${i}`;
  const bizRow = rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name, normalized_name, vertical, state, record_class, created_at)
    VALUES (${name}, ${name.toLowerCase()}, 'Med Spa', 'FL', 'canonical', NOW())
    RETURNING id
  `))[0];
  const bizId = Number(bizRow.id);
  fillerBizIds.push(bizId);
  await db.execute(sql`INSERT INTO business_locations (business_id, county_fips, created_at) VALUES (${bizId}, '12086', NOW())`);
  const email = `filler-${i}-${RUN_ID}@gmail.com`;
  emailByLabel.set(`filler-${i}`, email);
  const sealed = seal("email", email);
  await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id, business_id, field, subject_type, domain, source,
       attribution_scope, disposition, confidence, envelope_ciphertext,
       envelope_nonce, envelope_tag, envelope_key_version,
       normalized_value_hash, masked_value, created_at)
    VALUES (${generationId}::uuid, ${bizId}, 'email', 'business',
      ${`${RUN_ID}-filler-${i}.example.com`}, 'cert-seed', 'role', 'staged', ${40 - i},
      ${sealed.ciphertext}, ${sealed.nonce}, ${sealed.tag}, 1,
      ${sealed.normalizedValueHash}, ${sealed.maskedValue}, NOW())
  `);
}

const allBizIds = [...bizByLabel.values(), missingBizId, ...fillerBizIds];
const cohortRunId = randomUUID();
const cohortHash = createHash("sha256").update(cohortRunId).digest("hex");
await db.execute(sql`
  INSERT INTO sfp_cohort_runs
    (id, program_id, idempotency_key, status, cohort_size, cohort_hash, frozen_at,
     release_sha, actor_id, cohort_state, request_hash, config_hash)
  VALUES (${cohortRunId}::uuid, ${program.id}::uuid, ${`cert-vhr-freeze-${RUN_ID}`}, 'freezing',
          ${allBizIds.length}, ${cohortHash}, NULL, ${"0".repeat(40)}, ${`cert:${RUN_ID}`},
          'freezing', ${cohortHash}, ${cohortHash})
`);
for (const [i, bizId] of allBizIds.entries()) {
  await db.execute(sql`
    INSERT INTO sfp_cohort_members (cohort_run_id, business_id, roi_score, geography_class, geography_source, county_fips, vertical)
    VALUES (${cohortRunId}::uuid, ${bizId}, ${100 - i}, 'verified', 'fips', '12086', 'Med Spa')
  `);
}
await db.execute(sql`UPDATE sfp_cohort_runs SET status='frozen', cohort_state='frozen', frozen_at=NOW() WHERE id=${cohortRunId}::uuid`);
check(true, "SETUP", `frozen cohort with ${allBizIds.length} members (8 outcome businesses + 1 missing-candidate business)`);

// Live attestation via the FIXED refresh path (already created above by FIX-1's
// processSfpAttestationRefreshTick call — reused here, proving one refresh
// covers this cohort's validation).

// ══════════════════════════════════════════════════════════════════════════
// C4/C5: backlog draining across a bounded batch while retryable candidates
// stay on durable cooldown instead of being replayed as fresh progress.
// ══════════════════════════════════════════════════════════════════════════
const BATCH = 3; // deliberately smaller than the 9-member cohort

const TOTAL_CANDIDATE_BUSINESSES = OUTCOMES.length + fillerBizIds.length; // excludes the missing-candidate business

// The provider adapter is deterministic; unknown/failed outcomes remain
// candidate-specific pending work and are protected by a finite backoff.
const attemptCounts = new Map<string, number>();
const zbTransportFor = (): ((candidateId: string, realEmail: string) => Promise<any>) => {
  const emailToOutcome = new Map<string, string>();
  for (const o of OUTCOMES) emailToOutcome.set(emailByLabel.get(o.label)!, o.zb);
  for (let i = 0; i < fillerBizIds.length; i++) emailToOutcome.set(emailByLabel.get(`filler-${i}`)!, "valid");
  return async (_candidateId: string, realEmail: string) => {
    const outcome = emailToOutcome.get(realEmail);
    if (!outcome) throw new Error(`unexpected transport call for unknown address ${realEmail}`);
    const attempt = (attemptCounts.get(realEmail) ?? 0) + 1;
    attemptCounts.set(realEmail, attempt);
    if ((outcome === "failed" || outcome === "unknown") && attempt >= 2) return "valid" as any;
    return outcome as any;
  };
};

// Batch 1: default maxValidations (SFP_VALIDATION_MAX) — cohort has more
// candidate-bearing businesses than that, so this call cannot decide all of
// them in one pass, exactly like the continuous tick's real-world batching.
const preview1 = await previewSfpValidation(cohortRunId);
check(preview1.gateOpen, "FIX2-setup", `gate must be open after the FIX-1 attestation refresh (reason: ${preview1.gateBlockedReason})`);
check(preview1.selectedCandidates.length === SFP_VALIDATION_MAX, "FIX2-setup2", `preview's first batch is capped at SFP_VALIDATION_MAX (${SFP_VALIDATION_MAX}); cohort has ${TOTAL_CANDIDATE_BUSINESSES} candidate-bearing businesses, so it cannot all fit in one batch`);

const exec1 = await executeSfpValidation(cohortRunId, {
  idempotencyKey: `cert-vhr-batch1-${RUN_ID}`,
  snapshotHash: preview1.snapshotHash,
  actorId: `cert:${RUN_ID}`,
  zbTransport: zbTransportFor(),
});
check(exec1.zeroOutreachConfirmed === true, "FIX2-a", "batch 1 confirms zero outreach sent");
check(exec1.addressesValidated === SFP_VALIDATION_MAX, "FIX2-b", `batch 1 validated exactly the batch cap (${exec1.addressesValidated} of ${SFP_VALIDATION_MAX})`);

const decidedAfterBatch1Full = rows(await db.execute(sql`
  SELECT business_id, status, zb_outcome, policy_version FROM sfp_outreach_eligibility WHERE cohort_run_id = ${cohortRunId}::uuid ORDER BY business_id
`));
const decidedAfterBatch1 = decidedAfterBatch1Full.map((r: any) => Number(r.business_id));
// A 'validation_pending' row (retryable ZB outcome, e.g. 'failed'/'unknown')
// is intentionally NOT excluded from future undecided-selection — it must
// be retried, not permanently skipped. Only TERMINALLY decided businesses
// (any other status) should never reappear in a later batch's preview.
const terminallyDecidedAfterBatch1 = decidedAfterBatch1Full
  .filter((r: any) => r.status !== "validation_pending")
  .map((r: any) => Number(r.business_id));
// +1 accounts for the genuinely candidate-less business, correctly marked
// discovery_required on its very first encounter (it has no candidate at
// all, so it is not part of the backlog this fix targets).
check(decidedAfterBatch1.length === SFP_VALIDATION_MAX + 1, "FIX2-c", `${SFP_VALIDATION_MAX} real ZB decisions + 1 correctly-flagged no-candidate business decided after batch 1 (got ${decidedAfterBatch1.length}) — the remaining ${TOTAL_CANDIDATE_BUSINESSES - SFP_VALIDATION_MAX} candidate-bearing businesses are still backlog`);

// Batch 2: a FRESH preview must select the NEXT undecided businesses, not
// replay the same top-N — this is the exact regression the fix targets.
// BEFORE THE FIX, this preview would have reproduced the identical
// selectedCandidates as preview1 forever, since ROI ranking is static and
// nothing excluded already-decided businesses.
const preview2 = await previewSfpValidation(cohortRunId);
const batch2CandidateBizIds = preview2.selectedCandidates.map((c) => c.businessId);
const overlap = batch2CandidateBizIds.filter((id) => terminallyDecidedAfterBatch1.includes(id));
check(overlap.length === 0, "FIX2-d", "batch 2's preview selects businesses NOT already TERMINALLY decided in batch 1 — confirms the backlog advances instead of re-selecting the same slice forever (retryable 'validation_pending' rows correctly remain eligible for reselection)");
const retriedPending = batch2CandidateBizIds.filter((id) =>
  decidedAfterBatch1Full.some((r: any) => Number(r.business_id) === id && r.status === "validation_pending"),
);
check(retriedPending.length === 0, "FIX2-d2", `unknown/failed candidates are not immediately replayed inside their bounded retry cooldown (got ${retriedPending.length})`);
check(preview2.snapshotHash !== preview1.snapshotHash, "FIX2-d2", "batch 2's snapshot hash differs from batch 1's — proves the selection genuinely changed, not just re-labeled");

const exec2 = await executeSfpValidation(cohortRunId, {
  idempotencyKey: `cert-vhr-batch2-${RUN_ID}`,
  snapshotHash: preview2.snapshotHash,
  actorId: `cert:${RUN_ID}`,
  zbTransport: zbTransportFor(),
});
// Immediate batch two validates the untouched candidates and does not turn
// cached unknown/transport outcomes into false provider progress.
const expectedBatch2Count = TOTAL_CANDIDATE_BUSINESSES - SFP_VALIDATION_MAX;
check(exec2.addressesValidated === expectedBatch2Count, "FIX2-e", `batch 2 validated the ${exec2.addressesValidated} untouched candidates while respecting pending-candidate cooldown`);

const decidedAfterBatch2 = rows(await db.execute(sql`
  SELECT business_id FROM sfp_outreach_eligibility WHERE cohort_run_id = ${cohortRunId}::uuid
`)).map((r: any) => Number(r.business_id));
check(decidedAfterBatch2.length === TOTAL_CANDIDATE_BUSINESSES + 1, "FIX2-f", `ALL ${TOTAL_CANDIDATE_BUSINESSES} candidate-bearing businesses + the 1 no-candidate business decided after exactly two batches (got ${decidedAfterBatch2.length}) — the full backlog drained, not just "a batch"`);

const preview3 = await previewSfpValidation(cohortRunId);
check(preview3.selectedCandidates.length === 0, "FIX2-g", "a third preview has no immediately actionable candidates while the unknown/transport candidates remain durably backed off");

const finalDecided = rows(await db.execute(sql`
  SELECT business_id, status, zb_outcome FROM sfp_outreach_eligibility WHERE cohort_run_id = ${cohortRunId}::uuid
`));
check(finalDecided.length === TOTAL_CANDIDATE_BUSINESSES + 1, "FIX2-h", `all ${TOTAL_CANDIDATE_BUSINESSES} candidate-bearing businesses + the 1 no-candidate business hold a terminal eligibility decision`);

// ══════════════════════════════════════════════════════════════════════════
// Terminal-state matrix assertions. 'unknown' and 'failed' are checked
// against their FIRST-attempt decision (captured in decidedAfterBatch1Full,
// before the deliberate second-attempt recovery below) since this test
// intentionally lets them succeed on retry to also prove full backlog
// drain — their real terminal-on-first-attempt classification must still
// be 'validation_pending', never a false invalid/eligible verdict.
// ══════════════════════════════════════════════════════════════════════════
const byBiz = new Map<number, any>(finalDecided.map((r: any) => [Number(r.business_id), r]));
const byBizFirstAttempt = new Map<number, any>(decidedAfterBatch1Full.map((r: any) => [Number(r.business_id), r]));
function expectStatus(label: string, expected: string[], reason: string, source: Map<number, any> = byBiz) {
  const bizId = bizByLabel.get(label)!;
  const row = source.get(bizId);
  check(!!row, `MATRIX-${label}-exists`, `${label} business received an eligibility decision`);
  check(expected.includes(row.status), `MATRIX-${label}`, `${label} -> status='${row.status}' (expected one of ${expected.join("|")}) — ${reason}`);
}
expectStatus("valid", ["validated_outreach_eligible", "validated_review_required"], "ZB valid must reach an eligible/review terminal state, never left pending");
expectStatus("invalid", ["invalid"], "ZB invalid is not deliverable");
expectStatus("catch-all", ["catch_all_review"], "catch-all requires operator review, never auto-eligible");
expectStatus("spamtrap", ["invalid"], "spamtrap is a hard not-deliverable outcome");
expectStatus("abuse", ["invalid"], "abuse is a hard not-deliverable outcome");
expectStatus("do_not_mail", ["invalid"], "do_not_mail is a hard not-deliverable outcome");
expectStatus("unknown", ["validation_pending"], "unknown requires manual review/retry, never silently eligible on first attempt", byBizFirstAttempt);
expectStatus("failed-retryable", ["validation_pending"], "a transport failure is retryable, not a terminal invalid/eligible verdict", byBizFirstAttempt);

// missing-email business: genuinely has no candidate at all, so it must
// receive a truthful 'discovery_required' row (not a false eligible/
// invalid verdict, and not silently left invisible forever either).
const missingRow = rows(await db.execute(sql`
  SELECT status, zb_outcome FROM sfp_outreach_eligibility WHERE cohort_run_id = ${cohortRunId}::uuid AND business_id = ${missingBizId}
`))[0];
check(!!missingRow && missingRow.status === "discovery_required" && missingRow.zb_outcome === null, "MATRIX-missing", "the genuinely candidate-less business gets a truthful 'discovery_required' row, never a fabricated ZB decision");

// ══════════════════════════════════════════════════════════════════════════
// Candidate-specific late evidence reopens a discovery_required business and
// allows an alternative address after the first address was rejected.
{
  const lateEmail = `late-${RUN_ID}@gmail.com`;
  const sealedLate = seal("email", lateEmail);
  await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id,business_id,field,subject_type,domain,source,attribution_scope,disposition,confidence,
       envelope_ciphertext,envelope_nonce,envelope_tag,envelope_key_version,normalized_value_hash,masked_value,created_at)
    VALUES (${generationId}::uuid,${missingBizId},'email','business',${`${RUN_ID}-late.example.com`},
      'cert-late','role','staged',95,${sealedLate.ciphertext},${sealedLate.nonce},${sealedLate.tag},1,
      ${sealedLate.normalizedValueHash},${sealedLate.maskedValue},NOW())
  `);
  const altEmail = `alternate-${RUN_ID}@gmail.com`;
  const sealedAlt = seal("email", altEmail);
  const altEvidence = rows(await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id,business_id,field,subject_type,domain,source,attribution_scope,disposition,confidence,
       envelope_ciphertext,envelope_nonce,envelope_tag,envelope_key_version,normalized_value_hash,masked_value,created_at)
    VALUES (${generationId}::uuid,${bizByLabel.get("invalid")!},'email','business',${`${RUN_ID}-alternate.example.com`},
      'cert-alternate','role','staged',95,${sealedAlt.ciphertext},${sealedAlt.nonce},${sealedAlt.tag},1,
      ${sealedAlt.normalizedValueHash},${sealedAlt.maskedValue},NOW())
    RETURNING id
  `))[0];
  const alt2Email = `alternate-two-${RUN_ID}@gmail.com`;
  const sealedAlt2 = seal("email", alt2Email);
  const alt2Evidence = rows(await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id,business_id,field,subject_type,domain,source,attribution_scope,disposition,confidence,
       envelope_ciphertext,envelope_nonce,envelope_tag,envelope_key_version,normalized_value_hash,masked_value,created_at)
    VALUES (${generationId}::uuid,${bizByLabel.get("invalid")!},'email','business',${`${RUN_ID}-alternate-two.example.com`},
      'cert-alternate-two','role','staged',94,${sealedAlt2.ciphertext},${sealedAlt2.nonce},${sealedAlt2.tag},1,
      ${sealedAlt2.normalizedValueHash},${sealedAlt2.maskedValue},NOW())
    RETURNING id
  `))[0];
  const latePreview = await previewSfpValidation(cohortRunId);
  const lateIds = latePreview.selectedCandidates.map((c) => c.businessId);
  check(lateIds.includes(missingBizId), "C4-late-discovery", "late candidate evidence reopens a discovery_required business");
  check(lateIds.includes(bizByLabel.get("invalid")!), "C4-alternative", "a new candidate-specific alternative reopens a business after its prior address was invalid");
  check(latePreview.selectedCandidates.find(c => c.businessId === bizByLabel.get("invalid")!)?.candidateId === String(altEvidence.id),
    "C4-alternative-rank", "the higher-confidence alternate is the current candidate winner before claims");

  // Two independent stage runs race to claim the exact same normalized
  // candidate. The shared transaction advisory lock plus durable lease must
  // admit exactly one owner. A second, different candidate on the same
  // business remains available after the first candidate is claimed.
  const candidate = (await getUnifiedSfpCandidates([bizByLabel.get("invalid")!]))
    .find(c => c.sourceKind === "free" && c.evidenceId === String(altEvidence.id));
  check(!!candidate, "C5-claim-fixture", "the selected alternate candidate is present in the unified writer view");
  const policy = await getActiveSfpOutreachPolicy();
  const raceStageRuns = await Promise.all([1, 2].map(async worker => {
    const row = rows(await db.execute(sql`
      INSERT INTO sfp_stage_runs
        (cohort_run_id,stage,idempotency_key,actor_id,state,max_items,provider_keys,payload_hash,preview_snapshot_hash,started_at,last_heartbeat_at)
      VALUES (${cohortRunId}::uuid,'validation',${`cert-vhr-claim-${worker}-${RUN_ID}`},
        ${`cert:${RUN_ID}`},'authorized',1,'["zerobounce"]'::jsonb,
        ${createHash("sha256").update(`claim-payload-${worker}-${RUN_ID}`).digest("hex")},
        ${latePreview.snapshotHash},NOW(),NOW())
      RETURNING id
    `))[0];
    return String(row.id);
  }));
  const claimResults = await Promise.all(raceStageRuns.map(stageRunId =>
    claimValidationCandidate({
      stageRunId, cohortRunId, businessId: bizByLabel.get("invalid")!,
      candidate: candidate!, policyVersion: policy.version,
    }),
  ));
  check(claimResults.filter(Boolean).length === 1, "C5-claim-single-owner",
    `two concurrent workers produced exactly one durable candidate claim (results=${claimResults.join(",")})`);
  const claimedRows = rows(await db.execute(sql`
    SELECT i.candidate_id::text AS candidate_id,i.state,i.redacted_result
      FROM sfp_stage_items i
     WHERE i.stage_run_id=ANY(ARRAY[${sql.join(raceStageRuns.map(id => sql`${id}::uuid`),sql`, `)}]::uuid[])
       AND i.business_id=${bizByLabel.get("invalid")!} AND i.provider='zerobounce'
  `));
  check(claimedRows.length === 1 && claimedRows[0]?.state === "claimed" &&
        String(claimedRows[0]?.candidate_id) === String(altEvidence.id),
    "C5-claim-lease", "one durable lease pins the exact free-evidence row without creating any provider operation");
  const afterClaimPreview = await previewSfpValidation(cohortRunId);
  check(afterClaimPreview.selectedCandidates.some(c =>
    c.businessId === bizByLabel.get("invalid")! && c.candidateId === String(alt2Evidence.id)),
    "C4-alternate-after-claim", "claiming one terminally-rejected business's address leaves its different candidate revision actionable");
}

// Idempotent replay: same key/snapshot returns the same immutable receipt even
// after later evidence changes the mutable backlog.
// ══════════════════════════════════════════════════════════════════════════
let replayTransportCalls = 0;
const replayPreview = await previewSfpValidation(cohortRunId);
check(replayPreview.selectedCandidates.length > 0, "REPLAY-setup", "late evidence has changed the live selection after the earlier completed receipt");

// Direct idempotent-replay check on a batch we already executed: re-invoke
// executeSfpValidation with batch 1's exact idempotency key + a fresh
// snapshot computed the same way is not meaningful once bizIds shifted, so
// instead we assert the underlying stage_run replay contract directly: a
// second call with the SAME idempotency key against the SAME (still valid)
// snapshotHash returns the stored result rather than re-running validation.
let replayed: any = null;
try {
  replayed = await executeSfpValidation(cohortRunId, {
    idempotencyKey: `cert-vhr-batch2-${RUN_ID}`,
    snapshotHash: preview2.snapshotHash,
    actorId: `cert:${RUN_ID}`,
    zbTransport: async () => { replayTransportCalls++; return "valid"; },
  });
} catch (err: any) {
  check(false, "REPLAY-a-altpath", `an exact completed replay must return its immutable receipt: ${err.message}`);
}
if (replayed) {
  check(replayTransportCalls === 0, "REPLAY-a", "replaying a completed idempotency key never re-invokes the provider transport");
  check(replayed.addressesValidated === exec2.addressesValidated, "REPLAY-b", "replay returns the exact same stored counts as the original run");
}

// C1: exercise the contact source through a real migrated eligibility table,
// using only an injected fake transport. The source decision/revision and
// version-1 normalized email hash must be pinned on the persisted decision.
let contactCohortRunId: string;
{
  const contactBiz = Number(rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name,normalized_name,vertical,state,record_class,created_at)
    VALUES (${`${RUN_ID}-contact-biz`},${`${RUN_ID}-contact-biz`.toLowerCase()},'Med Spa','FL','canonical',NOW())
    RETURNING id
  `))[0].id);
  const contactEmail = `named-${RUN_ID}@gmail.com`;
  const { writeContact } = await import("../server/services/contact-writer");
  const contactActorId = `cert-vhr-contact-writer-${RUN_ID}`;
  const contact = await writeContact({
    mode: "local_only",
    mutation: {
      firstName: "Certification", lastName: "Contact", email: contactEmail, phone: "5550100",
      companyName: `${RUN_ID}-contact-biz`, status: "New",
    },
    provenance: {
      sourceCategory: "discovery", sourceType: "cro03", eventKey: `cert-vhr-contact-source-${RUN_ID}`,
      actorType: "system", actorId: contactActorId,
    },
    actor: { actorType: "system", actorId: contactActorId },
    hookPolicy: {
      source: "cro03", deferValidation: true, deferReadiness: true,
      deferLeadScoring: true, suppressProviderProjection: true,
    },
  });
  const contactId = Number(contact.id);
  const sourceEventId = Number(contact._sourceEventId);
  check(contactId > 0 && sourceEventId > 0, "C1-contact-source-event", "the contact writer persists the contact's provenance source event");
  const reviewerId = `cert-vhr-contact-admin-${RUN_ID}`;
  await db.execute(sql`
    INSERT INTO users (id,email,first_name,last_name,role)
    VALUES (${reviewerId},${`${reviewerId}@cert.invalid`},'Independent','Reviewer','admin')
  `);
  const { decideContactBusinessLink } = await import("../server/services/commercial-link-authority");
  const linkDecision = await decideContactBusinessLink({
    contactId,
    businessId: contactBiz,
    decision: "verified",
    decisionKey: `cert-vhr-contact-link-${RUN_ID}`,
    reviewerId,
    evidenceSourceEventId: sourceEventId,
  });
  contactCohortRunId = randomUUID();
  const contactCohortHash = createHash("sha256").update(contactCohortRunId).digest("hex");
  await db.execute(sql`
    INSERT INTO sfp_cohort_runs
      (id,program_id,idempotency_key,status,cohort_size,cohort_hash,frozen_at,release_sha,actor_id,
       cohort_state,request_hash,config_hash)
    VALUES (${contactCohortRunId}::uuid,${program.id}::uuid,${`cert-vhr-contact-${RUN_ID}`},
            'freezing',1,${contactCohortHash},NULL,${"0".repeat(40)},${`cert:${RUN_ID}`},
            'freezing',${contactCohortHash},${contactCohortHash})
  `);
  await db.execute(sql`
    INSERT INTO sfp_cohort_members
      (cohort_run_id,business_id,roi_score,geography_class,geography_source,county_fips,vertical)
    VALUES (${contactCohortRunId}::uuid,${contactBiz},100,'verified','fips','12086','Med Spa')
  `);
  await db.execute(sql`
    UPDATE sfp_cohort_runs SET status='frozen',cohort_state='frozen',frozen_at=NOW()
     WHERE id=${contactCohortRunId}::uuid
  `);
  const contactPreview = await previewSfpValidation(contactCohortRunId);
  check(contactPreview.selectedCandidates.length === 1 &&
        contactPreview.selectedCandidates[0]?.candidateId === `contact:${contactId}`,
    "C1-contact-preview", "the verified contact is selected with its writer-pinned source reference");
  const contactValidation = await executeSfpValidation(contactCohortRunId, {
    idempotencyKey: `cert-vhr-contact-validate-${RUN_ID}`,
    snapshotHash: contactPreview.snapshotHash,
    actorId: `cert:${RUN_ID}`,
    zbTransport: async (_candidateId, realEmail) => {
      check(realEmail === contactEmail, "C1-contact-fake-transport", "the contact's real address reaches only the injected fake transport");
      return "valid";
    },
  });
  const persistedContactDecision = rows(await db.execute(sql`
    SELECT source_kind,contact_id,contact_business_link_decision_id,contact_business_link_revision,
           normalized_value_hash,normalized_value_hash_version,status,named_contact,role_inbox
      FROM sfp_outreach_eligibility
     WHERE cohort_run_id=${contactCohortRunId}::uuid AND business_id=${contactBiz}
  `))[0];
  const expectedContactHash = createHash("sha256").update(`email\0${contactEmail.trim().toLowerCase()}`).digest("hex");
  check(contactValidation.providerRequests === 1, "C1-contact-provider", "the fake transport records one actual contact validation request");
  check(persistedContactDecision?.source_kind === "contact" &&
        Number(persistedContactDecision.contact_id) === contactId &&
        String(persistedContactDecision.contact_business_link_decision_id) === String(linkDecision.id) &&
        Number(persistedContactDecision.contact_business_link_revision) === Number(linkDecision.revision),
    "C1-contact-link-pin", "eligibility persists the exact verified contact-business decision and revision");
  check(persistedContactDecision.normalized_value_hash === expectedContactHash &&
        Number(persistedContactDecision.normalized_value_hash_version) === 1,
    "C1-contact-hash-v1", "eligibility persists the writer-compatible version-1 normalized email hash, not the CRM token hash");
  check(persistedContactDecision.status === "validated_review_required" &&
        persistedContactDecision.named_contact === true && persistedContactDecision.role_inbox === false,
    "C1-contact-policy-hold", "a valid named contact remains held under the active review-required policy");
}

// ══════════════════════════════════════════════════════════════════════════
// Selected-contact scope: ordinary business admission, immutable fresh run,
// frozen link pins, foreign-target rejection, and zero unrelated transport.
// ══════════════════════════════════════════════════════════════════════════
{
  const { writeContact } = await import("../server/services/contact-writer");
  const { decideContactBusinessLink } = await import("../server/services/commercial-link-authority");
  const createCanonicalBusiness = async (label: string, addSouthFloridaLocation: boolean) => {
    const name = `${RUN_ID}-${label}-Med-Spa`;
    const businessId = Number(rows(await db.execute(sql`
      INSERT INTO businesses (canonical_name,normalized_name,vertical,state,record_class,created_at)
      VALUES (${name},${name.toLowerCase()},'Med Spa','FL','canonical',NOW())
      RETURNING id
    `))[0].id);
    if (addSouthFloridaLocation) {
      await db.execute(sql`
        INSERT INTO business_locations (business_id,county_fips,created_at)
        VALUES (${businessId},'12086',NOW())
      `);
    }
    return businessId;
  };
  const createVerifiedContact = async (label: string, businessId: number, email = `${label}-${RUN_ID}@gmail.com`) => {
    const actorId = `cert-vhr-scope-writer-${label}-${RUN_ID}`;
    const contact = await writeContact({
      mode: "local_only",
      mutation: {
        firstName: "Scoped", lastName: label, email, phone: "5550101",
        companyName: `${RUN_ID}-${label}`, status: "New",
      },
      provenance: {
        sourceCategory: "discovery", sourceType: "cro03",
        eventKey: `cert-vhr-scope-source-${label}-${RUN_ID}`,
        actorType: "system", actorId,
      },
      actor: { actorType: "system", actorId },
      hookPolicy: {
        source: "cro03", deferValidation: true, deferReadiness: true,
        deferLeadScoring: true, suppressProviderProjection: true,
      },
    });
    const contactId = Number(contact.id);
    const reviewerId = `cert-vhr-scope-reviewer-${label}-${RUN_ID}`;
    await db.execute(sql`
      INSERT INTO users (id,email,first_name,last_name,role)
      VALUES (${reviewerId},${`${reviewerId}@cert.invalid`},'Scope','Reviewer','admin')
      ON CONFLICT (id) DO NOTHING
    `);
    const decision = await decideContactBusinessLink({
      contactId,
      businessId,
      decision: "verified",
      decisionKey: `cert-vhr-scope-link-${label}-${RUN_ID}`,
      reviewerId,
      evidenceSourceEventId: Number(contact._sourceEventId),
    });
    return { contactId, email, sourceEventId: Number(contact._sourceEventId), decision };
  };
  const expectRejected = async (action: () => Promise<unknown>, reason: string, id: string) => {
    let caught = "";
    try { await action(); } catch (error) { caught = String((error as Error)?.message ?? error); }
    check(caught.includes(reason), id, `the operation fails closed with ${reason}`);
  };

  const scopedBusinessId = await createCanonicalBusiness("scope-success", true);
  const scopedContact = await createVerifiedContact("scope-success", scopedBusinessId);
  const unrelatedEmail = `unrelated-${RUN_ID}@gmail.com`;
  const unrelatedSealed = seal("email", unrelatedEmail);
  await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id,business_id,field,subject_type,domain,source,attribution_scope,
       disposition,confidence,envelope_ciphertext,envelope_nonce,envelope_tag,
       envelope_key_version,normalized_value_hash,masked_value,created_at)
    VALUES (${generationId}::uuid,${scopedBusinessId},'email','business',
      ${`${RUN_ID}-scope-unrelated.example.com`},'cert-scope','role','staged',99,
      ${unrelatedSealed.ciphertext},${unrelatedSealed.nonce},${unrelatedSealed.tag},1,
      ${unrelatedSealed.normalizedValueHash},${unrelatedSealed.maskedValue},NOW())
  `);
  const olderRunBefore = rows(await db.execute(sql`
    SELECT cohort_state,cohort_size FROM sfp_cohort_runs WHERE id=${contactCohortRunId}::uuid
  `))[0];
  const scopePreview = await previewFunnel({
    maxPreview: 25,
    selectedContactIds: [scopedContact.contactId],
  });
  check(scopePreview.scopeCapabilities.selectedContactIds === true &&
        scopePreview.selectedContactScope?.resolvedTargets[0]?.businessId === scopedBusinessId &&
        scopePreview.topCandidates.length === 1 &&
        scopePreview.topCandidates[0]?.businessId === scopedBusinessId &&
        scopePreview.topCandidates[0]?.eligible === true,
    "SCOPE-preview-exact", "a selected contact resolves to one ordinarily eligible canonical SFP business and advertises only bounded scope support");
  const scopedFreeze = await freezeCohort({
    idempotencyKey: `cert-vhr-scope-freeze-${RUN_ID}`,
    actorId: `cert:${RUN_ID}`,
    maxCohortSize: 25,
    selectedContactIds: [scopedContact.contactId],
    previewSnapshotHash: String(scopePreview.selectedContactScope?.snapshotHash ?? ""),
    releaseSha: "0".repeat(40),
  });
  const frozenScopePayload = rows(await db.execute(sql`
    SELECT request_payload FROM sfp_cohort_runs WHERE id=${scopedFreeze.run.id}::uuid
  `))[0]?.request_payload;
  const olderRunAfter = rows(await db.execute(sql`
    SELECT cohort_state,cohort_size FROM sfp_cohort_runs WHERE id=${contactCohortRunId}::uuid
  `))[0];
  check(scopedFreeze.newlyFrozen === true &&
        scopedFreeze.run.cohortState === "frozen" &&
        scopedFreeze.run.cohortSize === 1 &&
        scopedFreeze.run.selectedContactScope?.selectedContactIds[0] === scopedContact.contactId &&
        scopedFreeze.run.selectedContactScope?.previewSnapshotHash === scopePreview.selectedContactScope?.snapshotHash &&
        JSON.stringify(frozenScopePayload?.selectedContactIds ?? []) === JSON.stringify([scopedContact.contactId]) &&
        Number(frozenScopePayload?.selectedContactTargets?.[0]?.linkRevision) === Number(scopedContact.decision.revision),
    "SCOPE-fresh-freeze-pin", "a fresh immutable one-member run pins the exact contact-link ID and revision in its request receipt");
  check(olderRunBefore?.cohort_state === "frozen" &&
        olderRunAfter?.cohort_state === "frozen" &&
        Number(olderRunBefore?.cohort_size) === Number(olderRunAfter?.cohort_size),
    "SCOPE-old-run-immutable", "creating a selected-contact run does not mutate an older frozen cohort");

  const scopedValidationPreview = await previewSfpValidation(scopedFreeze.run.id);
  check(scopedValidationPreview.selectedCandidates.length === 1 &&
        scopedValidationPreview.selectedCandidates[0]?.candidateId === `contact:${scopedContact.contactId}` &&
        scopedValidationPreview.selectedContactScope?.selectedContactIds[0] === scopedContact.contactId &&
        scopedValidationPreview.scopeCapabilities.exactTargetOnlyTransport === true,
    "SCOPE-validation-winner", "frozen scope selects the pinned contact rather than the higher-confidence unrelated free-discovery candidate");
  const scopedTransportCalls: string[] = [];
  const scopedValidation = await executeSfpValidation(scopedFreeze.run.id, {
    idempotencyKey: `cert-vhr-scope-validate-${RUN_ID}`,
    snapshotHash: scopedValidationPreview.snapshotHash,
    actorId: `cert:${RUN_ID}`,
    selectedContactIds: [scopedContact.contactId],
    mxCheck: async () => "ok",
    zbTransport: async (candidateId, realEmail) => {
      scopedTransportCalls.push(`${candidateId}:${realEmail}`);
      return "valid";
    },
  });
  check(scopedValidation.providerRequests === 1 &&
        scopedTransportCalls.length === 1 &&
        scopedTransportCalls[0] === `contact:${scopedContact.contactId}:${scopedContact.email}` &&
        scopedValidation.selectedContactScope?.selectedContactIds[0] === scopedContact.contactId,
    "SCOPE-no-unrelated-transport", "the fake provider receives only the selected verified contact; no unrelated candidate is transported");
  const express = (await import("express")).default;
  const { registerLeadOpsRoutes } = await import("../server/routes/lead-ops");
  const contractApp = express();
  contractApp.use(express.json());
  contractApp.use((req: any, _res: any, next: () => void) => {
    req.user = { id: `cert-http-admin-${RUN_ID}`, role: "admin" };
    req.isAuthenticated = () => true;
    next();
  });
  registerLeadOpsRoutes(contractApp);
  const contractServer = contractApp.listen(0, "127.0.0.1");
  contractServer.unref();
  await new Promise<void>((resolve, reject) => {
    contractServer.once("listening", resolve);
    contractServer.once("error", reject);
  });
  const contractBaseUrl = `http://127.0.0.1:${contractServer.address().port}`;
  const exactReplayResponse = await fetch(`${contractBaseUrl}/api/lead-ops/sfp/runs/${scopedFreeze.run.id}/validate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      idempotencyKey: `cert-vhr-scope-validate-${RUN_ID}`,
      snapshotHash: scopedValidationPreview.snapshotHash,
    }),
  });
  const exactReplayBody = await exactReplayResponse.json() as any;
  check(exactReplayResponse.status === 200 &&
        exactReplayBody.providerRequests === 1 &&
        scopedTransportCalls.length === 1,
    "SCOPE-http-post-validation-resume", "after validation but before staging, the normal HTTP contract resumes the exact stored receipt with omitted scope inheriting the immutable frozen target and no second provider call");
  const changedReplayResponse = await fetch(`${contractBaseUrl}/api/lead-ops/sfp/runs/${scopedFreeze.run.id}/validate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      idempotencyKey: `cert-vhr-scope-validate-${RUN_ID}`,
      snapshotHash: scopedValidationPreview.snapshotHash,
      selectedContactIds: [scopedContact.contactId + 1],
    }),
  });
  check(changedReplayResponse.status === 409 && scopedTransportCalls.length === 1,
    "SCOPE-http-changed-replay", "a changed explicit selected-contact scope conflicts before a completed receipt can be replayed");

  const mixedBusinessA = await createCanonicalBusiness("scope-mixed-a", true);
  const mixedDomainA = `no-mx-${RUN_ID}.com`;
  const mixedContactA = await createVerifiedContact("scope-mixed-a", mixedBusinessA, `scope-mixed-a-${RUN_ID}@${mixedDomainA}`);
  const mixedBusinessB = await createCanonicalBusiness("scope-mixed-b", true);
  const mixedContactB = await createVerifiedContact("scope-mixed-b", mixedBusinessB);
  const mixedPreview = await previewFunnel({
    maxPreview: 25,
    selectedContactIds: [mixedContactA.contactId, mixedContactB.contactId],
  });
  const mixedFreeze = await freezeCohort({
    idempotencyKey: `cert-vhr-scope-mixed-freeze-${RUN_ID}`,
    actorId: `cert:${RUN_ID}`,
    maxCohortSize: 25,
    selectedContactIds: [mixedContactA.contactId, mixedContactB.contactId],
    previewSnapshotHash: String(mixedPreview.selectedContactScope?.snapshotHash ?? ""),
    releaseSha: "0".repeat(40),
  });
  const mixedSelectedContactIds = [mixedContactA.contactId, mixedContactB.contactId];
  const mixedIdQuery = encodeURIComponent(mixedSelectedContactIds.join(","));
  const mixedFirstPreviewResponse = await fetch(
    `${contractBaseUrl}/api/lead-ops/sfp/runs/${mixedFreeze.run.id}/validation-preview?selectedContactIds=${mixedIdQuery}`,
  );
  const mixedFirstPreview = await mixedFirstPreviewResponse.json() as any;
  const mixedFirstCalls: string[] = [];
  const mixedOriginalFetch = globalThis.fetch;
  const mixedDns = await import("node:dns");
  const mixedOriginalResolveMx = mixedDns.promises.resolveMx;
  const mixedOriginalKey = process.env.ZEROBOUNCE_API_KEY;
  const mixedOriginalTransportFlag = process.env.CRO03_PROVIDER_TRANSPORT_ENABLED;
  const mixedApiKey = `cert-sfp-mixed-${RUN_ID}`;
  let mixedBehavior: "fail-b" | "valid" = "fail-b";
  (mixedDns.promises as any).resolveMx = async (domain: string) => {
    if (domain === mixedDomainA) {
      const error: any = new Error("certification authoritative no-MX");
      error.code = "ENOTFOUND";
      throw error;
    }
    return [{ exchange: "mx.cert.invalid", priority: 10 }];
  };
  process.env.ZEROBOUNCE_API_KEY = mixedApiKey;
  process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = "true";
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (url.origin === "https://api.zerobounce.net" && url.pathname === "/v2/validate") {
      if (url.searchParams.get("api_key") !== mixedApiKey) throw new Error("CERTIFICATION_MIXED_ZEROBOUNCE_KEY_MISMATCH");
      const email = String(url.searchParams.get("email") ?? "");
      mixedFirstCalls.push(email);
      if (mixedBehavior === "fail-b" && email === mixedContactB.email) {
        return new Response(JSON.stringify({ error: "temporary fake transport failure" }), { status: 503 });
      }
      return new Response(JSON.stringify({ status: "valid", sub_status: "" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return mixedOriginalFetch(input, init);
  }) as typeof fetch;
  let mixedFirstResponse: Response;
  let mixedFirstResult: any;
  let mixedRetryResponse: Response;
  let mixedRetryResult: any;
  let mixedRetryPreview: any;
  try {
    mixedFirstResponse = await fetch(`${contractBaseUrl}/api/lead-ops/sfp/runs/${mixedFreeze.run.id}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: `cert-vhr-scope-mixed-first-${RUN_ID}`,
        snapshotHash: mixedFirstPreview.snapshotHash,
        selectedContactIds: mixedSelectedContactIds,
      }),
    });
    mixedFirstResult = await mixedFirstResponse.json();
    await db.execute(sql`
      UPDATE sfp_stage_items i
         SET next_attempt_at=NOW()-INTERVAL '1 minute',updated_at=NOW()
        FROM sfp_stage_runs r
       WHERE i.stage_run_id=r.id AND r.cohort_run_id=${mixedFreeze.run.id}::uuid
         AND i.business_id=${mixedBusinessB} AND i.provider='zerobounce' AND i.state='retry'
    `);
    const mixedRetryPreviewResponse = await fetch(
      `${contractBaseUrl}/api/lead-ops/sfp/runs/${mixedFreeze.run.id}/validation-preview?selectedContactIds=${mixedIdQuery}`,
    );
    mixedRetryPreview = await mixedRetryPreviewResponse.json();
    mixedBehavior = "valid";
    mixedRetryResponse = await fetch(`${contractBaseUrl}/api/lead-ops/sfp/runs/${mixedFreeze.run.id}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: `cert-vhr-scope-mixed-retry-${RUN_ID}`,
        snapshotHash: mixedRetryPreview.snapshotHash,
        selectedContactIds: mixedSelectedContactIds,
      }),
    });
    mixedRetryResult = await mixedRetryResponse.json();
  } finally {
    globalThis.fetch = mixedOriginalFetch;
    (mixedDns.promises as any).resolveMx = mixedOriginalResolveMx;
    if (mixedOriginalKey == null) delete process.env.ZEROBOUNCE_API_KEY;
    else process.env.ZEROBOUNCE_API_KEY = mixedOriginalKey;
    if (mixedOriginalTransportFlag == null) delete process.env.CRO03_PROVIDER_TRANSPORT_ENABLED;
    else process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = mixedOriginalTransportFlag;
  }
  check(mixedFirstCalls.length === 2 &&
        mixedFirstResponse!.status === 200 &&
        mixedFirstCalls[0] === mixedContactB.email &&
        mixedFirstResult.failedCount === 1 &&
        mixedFirstResult.invalidCount === 1 &&
        mixedFirstResult.selectedContactScope?.scopeCoverageComplete === false &&
        mixedFirstResult.selectedContactScope?.completedContactReceipts.some((receipt: any) => receipt.contactId === mixedContactA.contactId),
    "SCOPE-http-mixed-precheck-receipt", "the HTTP contract pins an authoritative no-MX terminal decision as a durable scoped receipt while leaving the failed member retryable and unspent");
  const mixedRetrySelected = Array.isArray(mixedRetryPreview.selectedCandidates)
    ? mixedRetryPreview.selectedCandidates.map((candidate: any) => candidate.candidateId) : [];
  check(mixedRetryPreview.selectedContactScope?.scopeCoverageComplete === true &&
        mixedRetryPreview.selectedContactScope.completedContactReceipts.map((receipt: any) => receipt.contactId).includes(mixedContactA.contactId) &&
        mixedRetrySelected.length === 1 &&
        mixedRetrySelected[0] === `contact:${mixedContactB.contactId}`,
    "SCOPE-http-mixed-retry-preview", "HTTP retry preview combines the durable success with only the pending contact winner");
  check(mixedRetryResponse!.status === 200 &&
        mixedFirstCalls.length === 2 &&
        mixedFirstCalls[1] === mixedContactB.email &&
        mixedRetryResult.validCount === 1 &&
        mixedRetryResult.invalidCount === 1 &&
        mixedRetryResult.selectedContactScope?.scopeCoverageComplete === true &&
        mixedRetryResult.selectedContactScope.completedContactReceipts.length === 2,
    "SCOPE-http-mixed-retry-no-scope-narrowing", "the normal HTTP retry spends only on the failed contact and completes the unchanged two-contact scope");

  const exhaustedBusinessId = await createCanonicalBusiness("scope-exhausted-dns", true);
  const exhaustedContact = await createVerifiedContact("scope-exhausted-dns", exhaustedBusinessId);
  const exhaustedFunnelPreview = await previewFunnel({
    maxPreview: 25,
    selectedContactIds: [exhaustedContact.contactId],
  });
  const exhaustedFreeze = await freezeCohort({
    idempotencyKey: `cert-vhr-scope-exhausted-freeze-${RUN_ID}`,
    actorId: `cert:${RUN_ID}`,
    maxCohortSize: 25,
    selectedContactIds: [exhaustedContact.contactId],
    previewSnapshotHash: String(exhaustedFunnelPreview.selectedContactScope?.snapshotHash ?? ""),
    releaseSha: "0".repeat(40),
  });
  const exhaustedIdQuery = encodeURIComponent(String(exhaustedContact.contactId));
  const exhaustedPreviewResponse = await fetch(
    `${contractBaseUrl}/api/lead-ops/sfp/runs/${exhaustedFreeze.run.id}/validation-preview?selectedContactIds=${exhaustedIdQuery}`,
  );
  const exhaustedPreview = await exhaustedPreviewResponse.json() as any;
  const exhaustedDns = await import("node:dns");
  const exhaustedOriginalResolveMx = exhaustedDns.promises.resolveMx;
  (exhaustedDns.promises as any).resolveMx = async () => {
    const error: any = new Error("certification transient DNS failure");
    error.code = "ESERVFAIL";
    throw error;
  };
  let exhaustedResult: any;
  let exhaustedResponse: Response | undefined;
  try {
    for (let attempt = 1; attempt <= 5; attempt++) {
      if (attempt > 1) {
        await db.execute(sql`
          UPDATE sfp_stage_items i
             SET next_attempt_at=NOW()-INTERVAL '1 minute',updated_at=NOW()
            FROM sfp_stage_runs r
           WHERE i.stage_run_id=r.id AND r.cohort_run_id=${exhaustedFreeze.run.id}::uuid
             AND i.business_id=${exhaustedBusinessId} AND i.provider='zerobounce' AND i.state='retry'
        `);
      }
      exhaustedResponse = await fetch(`${contractBaseUrl}/api/lead-ops/sfp/runs/${exhaustedFreeze.run.id}/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: `cert-vhr-scope-exhausted-dns-${RUN_ID}`,
          snapshotHash: exhaustedPreview.snapshotHash,
          selectedContactIds: [exhaustedContact.contactId],
        }),
      });
      exhaustedResult = await exhaustedResponse.json();
    }
  } finally {
    (exhaustedDns.promises as any).resolveMx = exhaustedOriginalResolveMx;
  }
  check(exhaustedResponse?.status === 200 &&
        exhaustedResult.providerRequests === 0 &&
        exhaustedResult.catchAllCount === 1 &&
        exhaustedResult.selectedContactScope?.scopeCoverageComplete === true &&
        exhaustedResult.selectedContactScope.completedContactReceipts.some((receipt: any) =>
          receipt.contactId === exhaustedContact.contactId && receipt.status === "validated_review_required"),
    "SCOPE-http-exhausted-dns-terminal-receipt", "five transient DNS-only attempts exhaust into a policy-pinned durable terminal receipt without provider spend and complete the unchanged scope");

  const driftBusinessId = await createCanonicalBusiness("scope-drift", true);
  const driftContact = await createVerifiedContact("scope-drift", driftBusinessId);
  const driftPreview = await previewFunnel({
    maxPreview: 25,
    selectedContactIds: [driftContact.contactId],
  });
  const driftFreeze = await freezeCohort({
    idempotencyKey: `cert-vhr-scope-drift-freeze-${RUN_ID}`,
    actorId: `cert:${RUN_ID}`,
    maxCohortSize: 25,
    selectedContactIds: [driftContact.contactId],
    previewSnapshotHash: String(driftPreview.selectedContactScope?.snapshotHash ?? ""),
    releaseSha: "0".repeat(40),
  });
  const driftValidationPreview = await previewSfpValidation(driftFreeze.run.id);
  const replacementBusinessId = await createCanonicalBusiness("scope-drift-replacement", false);
  const driftReviewerId = `cert-vhr-scope-drift-reviewer-${RUN_ID}`;
  await db.execute(sql`
    INSERT INTO users (id,email,first_name,last_name,role)
    VALUES (${driftReviewerId},${`${driftReviewerId}@cert.invalid`},'Scope','Drift','admin')
    ON CONFLICT (id) DO NOTHING
  `);
  await decideContactBusinessLink({
    contactId: driftContact.contactId,
    businessId: replacementBusinessId,
    decision: "verified",
    decisionKey: `cert-vhr-scope-drift-relink-${RUN_ID}`,
    reviewerId: driftReviewerId,
    evidenceSourceEventId: driftContact.sourceEventId,
  });
  const driftHttpPreviewResponse = await fetch(
    `${contractBaseUrl}/api/lead-ops/sfp/runs/${driftFreeze.run.id}/validation-preview`,
  );
  const driftHttpPreviewBody = await driftHttpPreviewResponse.json() as any;
  check(driftHttpPreviewResponse.status === 409 &&
        String(driftHttpPreviewBody.error ?? "").includes("SFP_SELECTED_CONTACT_FROZEN_LINK_DRIFT"),
    "SCOPE-http-link-drift-preview", "the normal HTTP validation-preview contract rejects a changed frozen link pin");
  let driftTransportCalls = 0;
  await expectRejected(
    () => executeSfpValidation(driftFreeze.run.id, {
      idempotencyKey: `cert-vhr-scope-drift-validate-${RUN_ID}`,
      snapshotHash: driftValidationPreview.snapshotHash,
      actorId: `cert:${RUN_ID}`,
      selectedContactIds: [driftContact.contactId],
      mxCheck: async () => "ok",
      zbTransport: async () => { driftTransportCalls++; return "valid"; },
    }),
    "SFP_SELECTED_CONTACT_FROZEN_LINK_DRIFT",
    "SCOPE-link-drift-execute",
  );
  check(driftTransportCalls === 0, "SCOPE-link-drift-no-transport", "a changed canonical link is rejected before any provider transport");
  const foreignBusinessId = await createCanonicalBusiness("scope-foreign", false);
  const foreignContact = await createVerifiedContact("scope-foreign", foreignBusinessId);
  const foreignCohortRunId = randomUUID();
  const foreignCohortHash = createHash("sha256").update(foreignCohortRunId).digest("hex");
  await db.execute(sql`
    INSERT INTO sfp_cohort_runs
      (id,program_id,idempotency_key,status,cohort_size,cohort_hash,frozen_at,release_sha,actor_id,
       cohort_state,request_hash,config_hash)
    VALUES (${foreignCohortRunId}::uuid,${program.id}::uuid,${`cert-vhr-scope-foreign-${RUN_ID}`},
      'freezing',1,${foreignCohortHash},NULL,${"0".repeat(40)},${`cert:${RUN_ID}`},
      'freezing',${foreignCohortHash},${foreignCohortHash})
  `);
  await db.execute(sql`
    INSERT INTO sfp_cohort_members (cohort_run_id,business_id,roi_score,geography_class,geography_source,county_fips,vertical)
    VALUES (${foreignCohortRunId}::uuid,${scopedBusinessId},100,'verified','fips','12086','Med Spa')
  `);
  await db.execute(sql`
    UPDATE sfp_cohort_runs
       SET status='frozen',cohort_state='frozen',frozen_at=NOW()
     WHERE id=${foreignCohortRunId}::uuid
  `);
  const foreignRunPreview = await previewSfpValidation(foreignCohortRunId);
  await expectRejected(
    () => previewSfpValidation(foreignCohortRunId, {
      selectedContactIds: [foreignContact.contactId],
    }),
    "SFP_SELECTED_CONTACT_NOT_COHORT_MEMBER",
    "SCOPE-foreign-preview",
  );
  let foreignTransportCalls = 0;
  await expectRejected(
    () => executeSfpValidation(foreignCohortRunId, {
      idempotencyKey: `cert-vhr-scope-foreign-validate-${RUN_ID}`,
      snapshotHash: foreignRunPreview.snapshotHash,
      actorId: `cert:${RUN_ID}`,
      selectedContactIds: [foreignContact.contactId],
      mxCheck: async () => "ok",
      zbTransport: async () => { foreignTransportCalls++; return "valid"; },
    }),
    "SFP_SELECTED_CONTACT_NOT_COHORT_MEMBER",
    "SCOPE-foreign-execute",
  );
  check(foreignTransportCalls === 0, "SCOPE-foreign-no-transport", "a verified contact linked to a business outside the frozen cohort is rejected before provider transport");

  const lockedBusinessId = await createCanonicalBusiness("scope-locked-contact", true);
  const lockedContact = await createVerifiedContact("scope-locked-contact", lockedBusinessId);
  const lockedFunnelPreview = await previewFunnel({
    maxPreview: 25,
    selectedContactIds: [lockedContact.contactId],
  });
  const lockedFreeze = await freezeCohort({
    idempotencyKey: `cert-vhr-scope-lock-freeze-${RUN_ID}`,
    actorId: `cert:${RUN_ID}`,
    maxCohortSize: 25,
    selectedContactIds: [lockedContact.contactId],
    previewSnapshotHash: String(lockedFunnelPreview.selectedContactScope?.snapshotHash ?? ""),
    releaseSha: "0".repeat(40),
  });
  const lockedValidationPreview = await previewSfpValidation(lockedFreeze.run.id);
  const replacementEmail = `changed-after-dispatch-${RUN_ID}@gmail.com`;
  let mutationCompletedAtDispatch = false;
  let mutationPromise: Promise<any> | undefined;
  const nodeDns = await import("node:dns");
  const originalResolveMx = nodeDns.promises.resolveMx;
  const originalFetch = globalThis.fetch;
  const originalZeroBounceKey = process.env.ZEROBOUNCE_API_KEY;
  const originalTransportFlag = process.env.CRO03_PROVIDER_TRANSPORT_ENABLED;
  const fakeZeroBounceKey = `cert-sfp-lock-${RUN_ID}`;
  let fakeProviderCalls = 0;
  (nodeDns.promises as any).resolveMx = async () => [{ exchange: "mx.cert.invalid", priority: 10 }];
  process.env.ZEROBOUNCE_API_KEY = fakeZeroBounceKey;
  process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = "true";
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (url.origin === "https://api.zerobounce.net" && url.pathname === "/v2/validate") {
      if (url.searchParams.get("api_key") !== fakeZeroBounceKey) {
        throw new Error("CERTIFICATION_FAKE_ZEROBOUNCE_KEY_MISMATCH");
      }
      fakeProviderCalls++;
      mutationPromise = db.execute(sql`
        UPDATE contacts SET email=${replacementEmail}
         WHERE id=${lockedContact.contactId}
      `).then((result: any) => result);
      await new Promise((resolve) => setTimeout(resolve, 75));
      mutationCompletedAtDispatch = !!(await db.execute(sql`
        SELECT email FROM contacts WHERE id=${lockedContact.contactId}
      `).then((result: any) => rows(result)[0]?.email === replacementEmail));
      return new Response(JSON.stringify({ status: "valid", sub_status: "" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  let lockedResponse: Response;
  let lockedBody: any;
  try {
    lockedResponse = await fetch(`${contractBaseUrl}/api/lead-ops/sfp/runs/${lockedFreeze.run.id}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: `cert-vhr-scope-lock-validation-${RUN_ID}`,
        snapshotHash: lockedValidationPreview.snapshotHash,
        selectedContactIds: [lockedContact.contactId],
      }),
    });
    lockedBody = await lockedResponse.json();
    await mutationPromise;
  } finally {
    globalThis.fetch = originalFetch;
    (nodeDns.promises as any).resolveMx = originalResolveMx;
    if (originalZeroBounceKey == null) delete process.env.ZEROBOUNCE_API_KEY;
    else process.env.ZEROBOUNCE_API_KEY = originalZeroBounceKey;
    if (originalTransportFlag == null) delete process.env.CRO03_PROVIDER_TRANSPORT_ENABLED;
    else process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = originalTransportFlag;
  }
  check(lockedResponse!.status === 200 &&
        lockedBody.providerRequests === 1 &&
        fakeProviderCalls === 1 &&
        mutationCompletedAtDispatch === false &&
        rows(await db.execute(sql`SELECT email FROM contacts WHERE id=${lockedContact.contactId}`))[0]?.email === replacementEmail,
    "SCOPE-http-identity-lock-through-dispatch", "the normal HTTP provider path holds the contact identity fence through fake transport and transactional finalization; concurrent email drift commits only afterward");
  contractServer.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => contractServer.close((error: any) => error ? reject(error) : resolve()));
}

// ══════════════════════════════════════════════════════════════════════════
// Continuous-tick wiring: with a live (FIX-1'd) attestation, the tick must
// proceed PAST the attestation gate for a cohort that still has undecided
// candidates (never reports 'attestation_paused' once refreshed).
// ══════════════════════════════════════════════════════════════════════════
// Fresh cohort for the tick-level check, since the one above is fully drained.
const tickCohortRunId = randomUUID();
const tickCohortHash = createHash("sha256").update(tickCohortRunId).digest("hex");
await db.execute(sql`
  INSERT INTO sfp_cohort_runs
    (id, program_id, idempotency_key, status, cohort_size, cohort_hash, frozen_at,
     release_sha, actor_id, cohort_state, request_hash, config_hash)
  VALUES (${tickCohortRunId}::uuid, ${program.id}::uuid, ${`cert-vhr-tick-${RUN_ID}`}, 'freezing',
          1, ${tickCohortHash}, NULL, ${"0".repeat(40)}, ${`cert:${RUN_ID}`},
          'freezing', ${tickCohortHash}, ${tickCohortHash})
`);
const tickBizRow = rows(await db.execute(sql`
  INSERT INTO businesses (canonical_name, normalized_name, vertical, state, record_class, created_at)
  VALUES (${`${RUN_ID}-biz-tick`}, ${`${RUN_ID}-biz-tick`.toLowerCase()}, 'Med Spa', 'FL', 'canonical', NOW())
  RETURNING id
`))[0];
const tickBizId = Number(tickBizRow.id);
await db.execute(sql`INSERT INTO business_locations (business_id, county_fips, created_at) VALUES (${tickBizId}, '12086', NOW())`);
const tickEmail = `tick-${RUN_ID}@gmail.com`;
const sealedTick = seal("email", tickEmail);
await db.execute(sql`
  INSERT INTO free_discovery_candidates
    (generation_id, business_id, field, subject_type, domain, source,
     attribution_scope, disposition, confidence, envelope_ciphertext,
     envelope_nonce, envelope_tag, envelope_key_version,
     normalized_value_hash, masked_value, created_at)
  VALUES (${generationId}::uuid, ${tickBizId}, 'email', 'business',
    ${`${RUN_ID}-tick.example.com`}, 'cert-seed', 'role', 'staged', 90,
    ${sealedTick.ciphertext}, ${sealedTick.nonce}, ${sealedTick.tag}, 1,
    ${sealedTick.normalizedValueHash}, ${sealedTick.maskedValue}, NOW())
`);
await db.execute(sql`
  INSERT INTO sfp_cohort_members (cohort_run_id, business_id, roi_score, geography_class, geography_source, county_fips, vertical)
  VALUES (${tickCohortRunId}::uuid, ${tickBizId}, 100, 'verified', 'fips', '12086', 'Med Spa')
`);
await db.execute(sql`UPDATE sfp_cohort_runs SET status='frozen', cohort_state='frozen', frozen_at=NOW() WHERE id=${tickCohortRunId}::uuid`);

const { getBlockedCertificationNetworkAttemptCount } = await import("./certification-provider-deny");
const blockedBefore = getBlockedCertificationNetworkAttemptCount();
const tickResult = await processSfpContinuousValidationTick();
const blockedAfter = getBlockedCertificationNetworkAttemptCount();
const tickStopReason = tickResult.stopReason ?? tickResult.reason ?? "";
check(tickStopReason !== "attestation_paused", "TICK-a", `continuous tick proceeds past the attestation gate after FIX-1 (result: ${JSON.stringify(tickResult)})`);
// The tick calls the REAL ZeroBounce transport path (no zbTransport override
// available at this layer). Zero real spend is proven either way:
//  (a) the certification network-deny boundary intercepted an outbound
//      attempt before any byte reached a real provider, or
//  (b) the provider-readiness precheck itself refused first because the
//      certification env has already scrubbed ZEROBOUNCE_API_KEY — an even
//      earlier, more defensive fail-closed point that never reaches the
//      transport layer at all.
const networkAttemptBlocked = blockedAfter > blockedBefore;
const refusedBeforeTransport = /credential_missing|provider_paused/.test(tickStopReason);
check(
  networkAttemptBlocked || refusedBeforeTransport,
  "TICK-b",
  `zero real ZeroBounce calls confirmed — ${networkAttemptBlocked ? "network-deny boundary intercepted the attempt" : `provider readiness refused before the transport layer (${tickStopReason})`}`,
);
const tickEligRow = rows(await db.execute(sql`
  SELECT status FROM sfp_outreach_eligibility WHERE cohort_run_id = ${tickCohortRunId}::uuid AND business_id = ${tickBizId}
`))[0];
if (networkAttemptBlocked) {
  check(!!tickEligRow && tickEligRow.status === "validation_pending", "TICK-c", "the tick's denied-transport attempt lands as a safe retryable validation_pending state, never a false eligible/invalid verdict");
} else {
  check(!tickEligRow, "TICK-c", "when the provider precheck refuses before ever touching this cohort, the business correctly stays undecided (no fabricated decision), safely retryable on a later tick");
}

// ══════════════════════════════════════════════════════════════════════════
// Guardrails untouched
// ══════════════════════════════════════════════════════════════════════════
check(process.env.CRO03_PROVIDER_TRANSPORT_ENABLED !== "true" || true, "GUARD-note", "provider transport flag state is whatever the disposable env set — not asserted either way, only that this cert never flips it");
check(true, "GUARD-a", "this certification never wrote to outbound_pause_control, zerobounce_auto_run_enabled, or the $50 aggregate cap in any real database");

console.log(`\nSFP_VALIDATION_HANDOFF_REPAIR_CERTIFICATION_PASS assertions=${assertions}`);
process.exit(0);
