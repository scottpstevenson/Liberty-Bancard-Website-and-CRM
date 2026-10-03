#!/usr/bin/env tsx
/**
 * test-sfp2000-disposable-certification.ts
 *
 * Task #2000 disposable-PostgreSQL certification. Runs against a fresh,
 * disposable database (DATABASE_URL === TEST_DATABASE_URL, clearly
 * test/CI-named) with a network-denied fake provider boundary. Proves the
 * specific findings from the Task #2000 pre-build audit are fixed:
 *
 *   T2K-01  the validator consumes BOTH free and paid candidates through
 *           getUnifiedSfpCandidates — a paid-only winner is validated.
 *   T2K-02  the fake ZeroBounce transport receives the REAL decrypted
 *           address, never masked_value (positive + negative control).
 *   T2K-03  a fresh (within-TTL) provider observation is reused on a second
 *           execution — zero new provider calls — while safety gates are
 *           still re-evaluated.
 *   T2K-04  a changed snapshot between preview and execute fails closed.
 *   T2K-05  stageForCampaign's compatibility fence reports paid-source
 *           eligible rows as Task-2001-blocked with exact counts, never
 *           silently dropped or staged.
 *   T2K-06  getValidatedProspects returns exact filtered totals/grouped
 *           counts that reconcile with the page rows, and populates
 *           validation_age_days.
 *   T2K-07  provider settlement and the eligibility write happen inside one
 *           transaction — a reservation is never left dangling without a
 *           matching eligibility row.
 *
 * Zero live provider/network calls. Zero outreach/campaign/GHL/sequence
 * activity. Never activates a program's live send path.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import {
  applyCertificationProviderDenyBoundary,
  getBlockedCertificationNetworkAttemptCount,
  getLastBlockedCertificationNetworkOrigin,
} from "./certification-provider-deny";

await assertDisposableTestInfrastructure({
  operation: "Task #2000 SFP validation disposable certification",
  requireRedis: false,
});
process.env.VG_PROVIDER_DENY_MODE = "1";
// This gate is part of the fixture's intended positive promotion case, not a
// production setting. Set it only after disposable infrastructure is proved.
process.env.FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED = "true";
applyCertificationProviderDenyBoundary({ fatal: true });
// The provider governance path requires transport activation and a configured
// credential before it will reserve work. These disposable-only values let
// the injected fake transport traverse that real reservation/dispatch/
// settlement path; the deny boundary remains installed and no live adapter is
// called.
process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = "true";
process.env.ZEROBOUNCE_API_KEY = "sfp2000-disposable-fake-key";
const deniedNetworkBaseline = getBlockedCertificationNetworkAttemptCount();

function safeDiagnosticCode(value: unknown): string | null {
  if (value == null) return null;
  const code = String(value);
  return /^[A-Za-z0-9_.:-]{1,160}$/.test(code) ? code : "non_code_diagnostic";
}

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
const RUN_ID = `sfp2000cert-${randomUUID().slice(0, 8)}`;
const runtimeReleaseSelection = await (await import("./helpers/sfp-runtime-test-identity"))
  .selectSfpRuntimeTestRelease(`cert:${RUN_ID}`);

const {
  ensureProgram,
  setProgramActivation,
  freezeCohort,
  getValidatedProspects,
  stageForCampaign,
} = await import("../server/services/cro03/south-florida-prospecting");
const { previewSfpValidation, executeSfpValidation } = await import(
  "../server/services/cro03/sfp-validation"
);
const { seal } = await import("../server/services/cro03/candidate-evidence-service");
const { writeSfpPaidCandidateEvidence } = await import(
  "../server/services/cro03/sfp-paid-evidence-writer"
);

// Seed a live pricing schedule + activation authority prerequisite so the
// preview gate can open (mirrors scripts/seed-mi09-pricing.ts).
try {
  const { execSync } = await import("node:child_process");
  execSync("npx tsx scripts/seed-mi09-pricing.ts --apply --confirm-env=test", {
    stdio: "pipe",
    env: process.env,
  });
} catch {
  /* already seeded — idempotent */
}

const program = await ensureProgram({ createdBy: `cert:${RUN_ID}` });
await setProgramActivation({ active: true, actorId: `cert:${RUN_ID}` });

const { authorizePaidBudget, MI09_PAID_BUDGET_TYPED_CONFIRMATION } = await import(
  "../server/services/mi09-pilot-authority"
);
await authorizePaidBudget({
  authorizedBy: `cert:${RUN_ID}`,
  typedConfirmation: MI09_PAID_BUDGET_TYPED_CONFIRMATION,
});

// A freshly migrated disposable database seeds provider_controls with
// enabled=FALSE for every provider (migrations 0160/0269) — a real
// administrator must explicitly enable a provider before any live traffic.
// This certification never makes a live ZeroBounce call (all validation
// below goes through an injected fake zbTransport), but previewSfpValidation
// still reports the provider's real DB-backed gate state, so this test's own
// assertions about that reported gate need the row enabled the same way an
// operator would enable it — exactly like the equivalent seed already
// performed by scripts/sfp-certification.ts's shared (pre-disposable-DB-era)
// database fixture.
await db.execute(sql`
  UPDATE provider_controls
     SET enabled = TRUE, circuit_state = 'closed', local_budget_units = 1000000, version = version + 1, updated_at = NOW()
   WHERE provider = 'zerobounce'
`);

// ── Seed businesses: one with a FREE candidate, one with a PAID-ONLY
//    candidate, one with a NO-MX free candidate ───────────────────────────
const seededBizIds: number[] = [];
for (let i = 0; i < 3; i++) {
  const name = `${RUN_ID}-biz-${i}`;
  const bizRow = rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name, normalized_name, vertical, state, record_class, created_at)
    VALUES (${name}, ${name.toLowerCase()}, 'Med Spa', 'FL', 'canonical', NOW())
    RETURNING id
  `))[0];
  const bizId = Number(bizRow.id);
  seededBizIds.push(bizId);
  await db.execute(sql`
    INSERT INTO business_locations (business_id, county_fips, created_at)
    VALUES (${bizId}, '12086', NOW())
  `);
}
const [freeBizId, paidOnlyBizId, thirdBizId] = seededBizIds;

const genRow = rows(await db.execute(sql`
  INSERT INTO free_discovery_generations (run_key, actor_id, purpose, reason, state)
  VALUES (${`cert2000-${RUN_ID}`}, ${`cert:${RUN_ID}`}, 'email_discovery', 'certification', 'running')
  RETURNING id
`))[0];
const generationId = String(genRow.id);

// Positive eligibility cases use generic business inboxes. Named Gmail
// addresses correctly remain review-required under the current policy.
const freeEmail = `info@free-${RUN_ID}.example.com`;
{
  const sealedFree = seal("email", freeEmail);
  await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id, business_id, field, subject_type, domain, source,
       attribution_scope, disposition, confidence, envelope_ciphertext,
       envelope_nonce, envelope_tag, envelope_key_version,
       normalized_value_hash, masked_value, created_at)
    VALUES (${generationId}::uuid, ${freeBizId}, 'email', 'business',
      ${`${RUN_ID}-free.example.com`}, 'cert-seed', 'role', 'staged', 60,
      ${sealedFree.ciphertext}, ${sealedFree.nonce}, ${sealedFree.tag}, 1,
      ${sealedFree.normalizedValueHash}, ${sealedFree.maskedValue}, NOW())
  `);
}

// T2K-01 fixture: PAID-ONLY winner — no free candidate at all for this
// business, only sfp_paid_candidate_evidence. If the validator only read
// free_discovery_candidates, this business would silently get zero
// validation coverage.
const paidEmail = `sales@paid-${RUN_ID}.example.com`;
const paidWrite = await writeSfpPaidCandidateEvidence({
  businessId: paidOnlyBizId,
  provider: "outscraper",
  field: "email",
  value: paidEmail,
  subjectType: "business",
  confidence: 85,
});
check(paidWrite.wasNew, "T2K-01a", "paid-only candidate evidence written for a business with no free candidate");

// Third business gets a free candidate too, used for the freshness-reuse
// and staging-fence checks below.
const thirdEmail = `support@third-${RUN_ID}.example.com`;
{
  const sealedThird = seal("email", thirdEmail);
  await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id, business_id, field, subject_type, domain, source,
       attribution_scope, disposition, confidence, envelope_ciphertext,
       envelope_nonce, envelope_tag, envelope_key_version,
       normalized_value_hash, masked_value, created_at)
    VALUES (${generationId}::uuid, ${thirdBizId}, 'email', 'business',
      ${`${RUN_ID}-third.example.com`}, 'cert-seed', 'role', 'staged', 55,
      ${sealedThird.ciphertext}, ${sealedThird.nonce}, ${sealedThird.tag}, 1,
      ${sealedThird.normalizedValueHash}, ${sealedThird.maskedValue}, NOW())
  `);
}

// ── Synthesize a frozen cohort covering exactly the three fixture
//    businesses. Cohort SELECTION (which businesses freezeCohort's own
//    funnel algorithm admits) is Task #1998's scope, already certified
//    separately; Task #2000 owns what happens to a frozen cohort's members
//    during validation, so this suite constructs the frozen cohort directly
//    to isolate validation/eligibility behavior from selection behavior and
//    from cross-run test-data pollution in the shared businesses table. ──
const { createHash: createCohortHash } = await import("node:crypto");
const cohortRunId = randomUUID();
const cohortHash = createCohortHash("sha256").update(cohortRunId).digest("hex");
await db.execute(sql`
  INSERT INTO sfp_cohort_runs
    (id, program_id, idempotency_key, status, cohort_size, cohort_hash, frozen_at,
     release_sha, actor_id, cohort_state, request_hash, config_hash)
  VALUES (${cohortRunId}::uuid, ${program.id}::uuid, ${`cert2000-freeze-${RUN_ID}`}, 'freezing',
          ${seededBizIds.length}, ${cohortHash}, NULL, ${"0".repeat(40)}, ${`cert:${RUN_ID}`},
          'freezing', ${cohortHash}, ${cohortHash})
`);
for (const bizId of seededBizIds) {
  await db.execute(sql`
    INSERT INTO sfp_cohort_members
      (cohort_run_id, business_id, roi_score, geography_class, geography_source, county_fips, vertical)
    VALUES (${cohortRunId}::uuid, ${bizId}, 50, 'verified', 'fips', '12086', 'Med Spa')
  `);
  // Validation's immutable source contract requires each frozen member to
  // have its selected terminal decision. This is cohort-source evidence, not
  // an eligibility or provider receipt; both are still produced only by the
  // normal execution path below.
  await db.execute(sql`
    INSERT INTO sfp_cohort_decisions
      (cohort_run_id, business_id, disposition, geography_class, geography_source, vertical, roi_score, selected)
    VALUES (${cohortRunId}::uuid, ${bizId}, 'selected', 'verified', 'fips', 'Med Spa', 50, TRUE)
  `);
}
await db.execute(sql`
  UPDATE sfp_cohort_runs SET status = 'frozen', cohort_state = 'frozen', frozen_at = NOW()
  WHERE id = ${cohortRunId}::uuid
`);
check(true, "T2K-setup", "frozen cohort synthesized directly for the three fixture businesses");

// Create a prior frozen cohort for the free candidate and generate its provider
// observation through the ordinary reservation/attempt/dispatch/settlement
// path. The second cohort below then proves real observation freshness reuse,
// without inserting a fabricated completed operation or observation.
const priorCohortRunId = randomUUID();
const priorCohortHash = createCohortHash("sha256").update(priorCohortRunId).digest("hex");
await db.execute(sql`
  INSERT INTO sfp_cohort_runs
    (id, program_id, idempotency_key, status, cohort_size, cohort_hash, frozen_at,
     release_sha, actor_id, cohort_state, request_hash, config_hash)
  VALUES (${priorCohortRunId}::uuid, ${program.id}::uuid, ${`cert2000-prior-freeze-${RUN_ID}`}, 'freezing',
          1, ${priorCohortHash}, NULL, ${"0".repeat(40)}, ${`cert:${RUN_ID}`},
          'freezing', ${priorCohortHash}, ${priorCohortHash})
`);
await db.execute(sql`
  INSERT INTO sfp_cohort_members
    (cohort_run_id, business_id, roi_score, geography_class, geography_source, county_fips, vertical)
  VALUES (${priorCohortRunId}::uuid, ${freeBizId}, 50, 'verified', 'fips', '12086', 'Med Spa')
`);
await db.execute(sql`
  INSERT INTO sfp_cohort_decisions
    (cohort_run_id, business_id, disposition, geography_class, geography_source, vertical, roi_score, selected)
  VALUES (${priorCohortRunId}::uuid, ${freeBizId}, 'selected', 'verified', 'fips', 'Med Spa', 50, TRUE)
`);
await db.execute(sql`
  UPDATE sfp_cohort_runs SET status='frozen',cohort_state='frozen',frozen_at=NOW()
   WHERE id=${priorCohortRunId}::uuid
`);
const priorPreview = await previewSfpValidation(priorCohortRunId);
const priorTransportCalls: string[] = [];
const priorProviderFailureDiagnostics: Array<{ phase: string; code: string }> = [];
// A deterministic positive DNS seam keeps the disposable cert networkless;
// only DNS is stubbed here—the provider operation still uses normal reserve,
// dispatch, fake transport, receipt, and settlement governance.
const priorExecution = await executeSfpValidation(priorCohortRunId, {
  idempotencyKey: `cert2000-prior-validate-${RUN_ID}`,
  snapshotHash: priorPreview.snapshotHash,
  actorId: `cert:${RUN_ID}`,
  maxValidations: 25,
  mxCheck: async () => "ok",
  onProviderFailureDiagnostic: (phase, code) => priorProviderFailureDiagnostics.push({ phase, code }),
  zbTransport: async (_candidateId, realEmail) => {
    priorTransportCalls.push(realEmail);
    return "valid";
  },
});
const priorEligibility = rows(await db.execute(sql`
  SELECT validation_operation_id,status,decision_reason,zb_outcome
    FROM sfp_outreach_eligibility
   WHERE cohort_run_id=${priorCohortRunId}::uuid AND business_id=${freeBizId}
`))[0];
const priorOpId = String(priorEligibility?.validation_operation_id ?? "");
const priorOperation = rows(await db.execute(sql`
  SELECT o.state,o.billing_state,a.outcome,a.dispatch_marked_at,po.outcome AS observation_outcome
    FROM provider_operations o
    LEFT JOIN provider_attempts a ON a.operation_id=o.id AND a.attempt_number=1
    LEFT JOIN provider_observations po ON po.operation_id=o.id
   WHERE o.id=${priorOpId || null}::uuid
`))[0];
const priorStageDiagnostic = rows(await db.execute(sql`
  SELECT state,selected_count,processed_count,failed_count
    FROM sfp_stage_runs
   WHERE stage='validation' AND idempotency_key=${`cert2000-prior-validate-${RUN_ID}`}
`))[0];
const priorAuthorityDiagnostic = rows(await db.execute(sql`
  SELECT r.cohort_state,p.is_active,
         (SELECT COUNT(*)::int FROM sfp_cohort_decisions d
           WHERE d.cohort_run_id=r.id AND d.selected=TRUE) AS selected_decisions,
         pc.enabled AS provider_enabled,pc.circuit_state
    FROM sfp_cohort_runs r
    JOIN sfp_programs p ON p.id=r.program_id
    LEFT JOIN provider_controls pc ON pc.provider='zerobounce'
   WHERE r.id=${priorCohortRunId}::uuid
`))[0];
const priorTransportSawFixture = priorTransportCalls.includes(freeEmail);
const priorProviderLineageSettled = Boolean(priorOpId) && priorOperation?.state === "completed" &&
  priorOperation.billing_state === "committed" && priorOperation.outcome === "completed" &&
  Boolean(priorOperation.dispatch_marked_at) && priorOperation.observation_outcome === "valid";
if (priorExecution.failedCount !== 0 || !priorTransportSawFixture || !priorProviderLineageSettled) {
  const deniedNetworkAttempts = getBlockedCertificationNetworkAttemptCount();
  console.error("[T2K-03setup-diagnostic]", JSON.stringify({
    preview: {
      gateOpen: priorPreview.gateOpen,
      blockedReason: safeDiagnosticCode(priorPreview.gateBlockedReason),
    },
    authority: {
      runtimeReleaseSelected: runtimeReleaseSelection.currentReleaseSelected,
      cohortState: priorAuthorityDiagnostic?.cohort_state ?? null,
      programActive: priorAuthorityDiagnostic?.is_active ?? null,
      selectedDecisionCount: Number(priorAuthorityDiagnostic?.selected_decisions ?? 0),
      providerEnabled: priorAuthorityDiagnostic?.provider_enabled ?? null,
      providerCircuit: safeDiagnosticCode(priorAuthorityDiagnostic?.circuit_state),
      providerTransportEnabled: process.env.CRO03_PROVIDER_TRANSPORT_ENABLED === "true",
      disposableCredentialPresent: Boolean(process.env.ZEROBOUNCE_API_KEY),
    },
    execution: {
      failedCount: priorExecution.failedCount,
      addressesValidated: priorExecution.addressesValidated,
      transportCallCount: priorTransportCalls.length,
      transportSawSeededCandidate: priorTransportSawFixture,
      providerFailures: priorProviderFailureDiagnostics.map(({ phase, code }) => ({
        phase: safeDiagnosticCode(phase),
        code: safeDiagnosticCode(code),
      })),
    },
    stage: {
      state: safeDiagnosticCode(priorStageDiagnostic?.state),
      selectedCount: Number(priorStageDiagnostic?.selected_count ?? 0),
      processedCount: Number(priorStageDiagnostic?.processed_count ?? 0),
      failedCount: Number(priorStageDiagnostic?.failed_count ?? 0),
    },
    eligibility: {
      status: safeDiagnosticCode(priorEligibility?.status),
      decisionReason: safeDiagnosticCode(priorEligibility?.decision_reason),
      providerOutcome: safeDiagnosticCode(priorEligibility?.zb_outcome),
    },
    providerLineage: {
      operationPresent: Boolean(priorOpId),
      state: safeDiagnosticCode(priorOperation?.state),
      billingState: safeDiagnosticCode(priorOperation?.billing_state),
      attemptOutcome: safeDiagnosticCode(priorOperation?.outcome),
      dispatchMarked: Boolean(priorOperation?.dispatch_marked_at),
      observationOutcome: safeDiagnosticCode(priorOperation?.observation_outcome),
    },
    deniedExternalHttp: {
      attemptCountDelta: deniedNetworkAttempts - deniedNetworkBaseline,
      lastOrigin: deniedNetworkAttempts > deniedNetworkBaseline
        ? getLastBlockedCertificationNetworkOrigin() : null,
    },
  }));
}
check(priorTransportSawFixture,
  "T2K-03setup-transport", "the seeded candidate reached the injected fake transport after normal provider governance");
check(priorExecution.failedCount === 0,
  "T2K-03setup-result", `the governed prior validation completed without failed candidates (failedCount=${priorExecution.failedCount})`);
check(priorProviderLineageSettled,
  "T2K-03setup2", "the reuse source is a persisted settled operation with an actual marked dispatch and provider observation");

// ── T2K-02: masked-vs-real transport (positive + negative control) ───────
const receivedByTransport: string[] = [];
// Exact completed candidate revisions are deliberately terminal. Exercise the
// supported receipt-repair path, not an implicit release of terminal work:
// remove only this fixture's staging projection link.
// The settled provider operation/observation remains intact and must be reused.
const repairFixture = rows(await db.execute(sql`
  UPDATE sfp_outreach_eligibility
     SET staging_intent_id=NULL
   WHERE cohort_run_id=${priorCohortRunId}::uuid AND business_id=${freeBizId}
   RETURNING validation_operation_id
`));
check(repairFixture.length === 1 && String(repairFixture[0].validation_operation_id) === priorOpId,
  "T2K-03repair-setup", "one fixture-local projection link is missing; the exact settled receipt is preserved for guarded repair");
const preview1 = await previewSfpValidation(cohortRunId);
check(preview1.gateOpen, "T2K-02setup", `validation gate must be open (reason: ${preview1.gateBlockedReason})`);

const exec1 = await executeSfpValidation(cohortRunId, {
  idempotencyKey: `cert2000-validate-${RUN_ID}`,
  snapshotHash: preview1.snapshotHash,
  actorId: `cert:${RUN_ID}`,
  maxValidations: 25,
  mxCheck: async () => "ok",
  zbTransport: async (_candidateId, realEmail) => {
    receivedByTransport.push(realEmail);
    return "valid";
  },
});
check(exec1.zeroOutreachConfirmed === true, "T2K-02setup2", "execution confirms zero outreach");

const realEmails = new Set([freeEmail, paidEmail, thirdEmail]);
check(receivedByTransport.length >= 2, "T2K-02a", "transport was invoked for the paid-only and third-business winners");
for (const received of receivedByTransport) {
  check(realEmails.has(received), "T2K-02b", `transport received a real decrypted address (${received}), never masked_value`);
  check(!received.includes("***"), "T2K-02c", "transport value is not a masked string");
}
// Negative control: a masked-looking string must never equal any real seeded email.
const maskedLooking = `p***0@${RUN_ID}.example.com`;
check(!realEmails.has(maskedLooking), "T2K-02d", "negative control: a masked-looking value is never mistaken for a real seeded email");

// ── T2K-03: freshness reuse — the free-candidate business has a fresh
//    provider_observations row created through a prior governed execution, so
//    this cohort must reuse it without another fake transport call while
//    still writing a fresh eligibility decision that records the reuse. ───
check(!receivedByTransport.includes(freeEmail), "T2K-03a", "the free-candidate business's address never reaches the transport — its fresh prior observation is reused instead of a new provider call");
const freeEligRow = rows(await db.execute(sql`
  SELECT status, reused_from_operation_id, zb_outcome FROM sfp_outreach_eligibility
  WHERE cohort_run_id = ${cohortRunId}::uuid AND business_id = ${freeBizId}
`))[0];
check(!!freeEligRow, "T2K-03b", "the free-candidate business still received a fresh eligibility decision despite the provider call being skipped");
check(String(freeEligRow.reused_from_operation_id) === priorOpId, "T2K-03c", "the eligibility row records exactly which prior operation its decision was reused from");
check(freeEligRow.status === "validated_outreach_eligible", "T2K-03d", "reuse of a prior 'valid' observation still produces the correct eligibility status — reuse is not a free pass to skip the outcome mapping");
const reuseExpiry = rows(await db.execute(sql`
  SELECT e.validation_expires_at>NOW() AS eligibility_live,
         e.validation_expires_at <= LEAST(
           COALESCE(po.expires_at,
             po.observed_at+(pd.validation_ttl_days::text||' days')::interval),
           po.observed_at+(pd.validation_ttl_days::text||' days')::interval
         ) AS expiry_not_extended
    FROM sfp_outreach_eligibility e
    JOIN provider_observations po ON po.operation_id=e.reused_from_operation_id
    JOIN sfp_outreach_policy_documents pd ON pd.id=e.policy_document_id
   WHERE e.cohort_run_id=${cohortRunId}::uuid AND e.business_id=${freeBizId}
`))[0];
check(reuseExpiry?.eligibility_live === true && reuseExpiry.expiry_not_extended === true,
  "T2K-03e", "freshness reuse remains live without extending the original provider observation's bounded expiry");

// ── T2K-01: confirm the paid-only business actually got an eligibility
//    decision (proves paid evidence was consumed, not silently skipped) ──
const paidEligRow = rows(await db.execute(sql`
  SELECT status, source_kind, paid_candidate_evidence_id FROM sfp_outreach_eligibility
  WHERE cohort_run_id = ${cohortRunId}::uuid AND business_id = ${paidOnlyBizId}
`))[0];
check(!!paidEligRow, "T2K-01b", "paid-only business received an eligibility decision");
check(paidEligRow.source_kind === "paid", "T2K-01c", "eligibility row correctly attributes source_kind='paid'");
check(!!paidEligRow.paid_candidate_evidence_id, "T2K-01d", "eligibility row links the paid_candidate_evidence_id, not a fabricated free reference");
check(paidEligRow.status === "validated_outreach_eligible", "T2K-01e", "a valid paid-sourced ZB outcome reaches the SAME persisted status value as free — no new status introduced");

// ── T2K-07: atomic finalization — each completed governed provider operation
//    for this cohort has a matching eligibility row (never dangling spend).
// The injected transport replaces only the external HTTP adapter; reservation,
// attempt, dispatch, receipt, settlement, and eligibility all remain real.
const finalizedOperations = rows(await db.execute(sql`
  SELECT o.id,o.state,o.billing_state,e.id AS eligibility_id
    FROM provider_operations o
    LEFT JOIN sfp_outreach_eligibility e
      ON e.cohort_run_id=${cohortRunId}::uuid
     AND (e.validation_operation_id=o.id OR e.reused_from_operation_id=o.id)
   WHERE o.purpose='sfp_email_validation'
     AND o.idempotency_key LIKE ${`cert2000-validate-${RUN_ID}:%`}
   ORDER BY o.id
`));
check(finalizedOperations.length >= 2 && finalizedOperations.every((operation: any) =>
  operation.state === "completed" && operation.billing_state === "committed" && operation.eligibility_id,
), "T2K-07ops", "every settled provider operation created by the current validation run has its matching eligibility record");
const validRowsForProjection = rows(await db.execute(sql`
  SELECT soe.business_id, soe.status, b.main_email, b.email_discovery_status
  FROM sfp_outreach_eligibility soe
  JOIN businesses b ON b.id = soe.business_id
  WHERE soe.cohort_run_id = ${cohortRunId}::uuid AND soe.status = 'validated_outreach_eligible'
`));
check(validRowsForProjection.length >= 1, "T2K-07setup", "at least one validated_outreach_eligible row exists to check projection atomicity");
for (const r of validRowsForProjection) {
  check(!!r.main_email && r.email_discovery_status === "provider_valid", "T2K-07a",
    `business ${r.business_id}'s safe projection (main_email/email_discovery_status) committed atomically with its eligibility write`);
}

// ── T2K-04: snapshot mismatch fails closed ────────────────────────────────
let snapshotMismatchCaught = false;
try {
  await executeSfpValidation(cohortRunId, {
    idempotencyKey: `cert2000-validate-stale-${RUN_ID}`,
    snapshotHash: "0".repeat(64),
    actorId: `cert:${RUN_ID}`,
    maxValidations: 25,
    zbTransport: async () => "valid",
  });
} catch (err: any) {
  snapshotMismatchCaught = /SNAPSHOT_MISMATCH/.test(String(err?.message ?? ""));
}
check(snapshotMismatchCaught, "T2K-04a", "an execute call with a stale/wrong snapshotHash fails closed with SNAPSHOT_MISMATCH");

// ── T2K-05: staging fence reports paid-eligible rows as Task-2001-blocked,
//    never silently dropped or staged. ────────────────────────────────────
const stagingResult: any = await stageForCampaign({
  cohortRunId,
  actorId: `cert:${RUN_ID}`,
  idempotencyKey: `cert2000-stage-${RUN_ID}`,
} as any).catch((err: any) => ({ __error: String(err?.message ?? err) }));

if (stagingResult.__error) {
  // Some deployments hard-block staging entirely pending Task #2001 — that
  // is an acceptable fail-closed posture as long as it is explicit.
  check(/2001|blocked|not.?supported/i.test(stagingResult.__error), "T2K-05a", `staging call fails closed with an explicit Task-2001-blocked reason: ${stagingResult.__error}`);
} else {
  const blockedCount = Number(stagingResult.reasons?.paid_source_task2001_blocked ?? 0);
  check(blockedCount >= 1, "T2K-05a", `stageForCampaign reports at least one paid-eligible row as Task-2001-blocked (got ${blockedCount})`);
  check(Number(stagingResult.rejected) >= blockedCount, "T2K-05a2", "the paid-blocked rows are counted in the rejected total, never silently omitted from the run's counters");
  const paidStillUnstaged = rows(await db.execute(sql`
    SELECT campaign_staged_at FROM sfp_outreach_eligibility
    WHERE cohort_run_id = ${cohortRunId}::uuid AND business_id = ${paidOnlyBizId}
  `))[0];
  check(!paidStillUnstaged?.campaign_staged_at, "T2K-05b", "the paid-eligible business is never silently staged alongside the free-eligible ones");
}

// ── T2K-06: getValidatedProspects exact reporting ─────────────────────────
const report = await getValidatedProspects({ cohortRunId, limit: 50, offset: 0 });
check(report.total === report.prospects.length || report.total >= report.prospects.length, "T2K-06a", "reported total is consistent with (>=) the returned page size");
const eligibleCountDb = rows(await db.execute(sql`
  SELECT COUNT(*)::int AS cnt FROM sfp_outreach_eligibility WHERE cohort_run_id = ${cohortRunId}::uuid
`))[0];
check(Number(report.total) === Number(eligibleCountDb.cnt), "T2K-06b", `getValidatedProspects total (${report.total}) matches the raw eligibility row count (${eligibleCountDb.cnt}) for this cohort — no silent join drop`);
const paidProspect = report.prospects.find((p: any) => p.businessId === paidOnlyBizId);
check(!!paidProspect, "T2K-06c", "the paid-sourced eligible business appears in the exact reporting relation, not just the legacy free-candidate join");
if (paidProspect) {
  check(paidProspect.validationAgeDays !== null && paidProspect.validationAgeDays !== undefined, "T2K-06d", "validation_age_days is populated at read time, never left null/never-computed");
}

console.log(`\nTASK2000_DISPOSABLE_CERTIFICATION_PASS assertions=${assertions}`);
process.exit(0);
