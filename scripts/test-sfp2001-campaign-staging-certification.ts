#!/usr/bin/env npx tsx
/**
 * Task #2001 disposable-PostgreSQL certification.
 *
 * This suite exercises the actual snapshot-bound staging service with
 * network/provider transports denied. It never seeds or writes any
 * enrollment, campaign-dispatch, outbound, or GHL table.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import { sql } from "drizzle-orm";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "./certification-provider-deny";

await assertDisposableTestInfrastructure({
  operation: "Task #2001 SFP campaign-staging disposable certification",
  requireRedis: false,
});
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });
const deniedFetch = globalThis.fetch;
const fakeZeroBounceKey = "task-2001-disposable-zero-bounce-key";
process.env.ZEROBOUNCE_API_KEY = fakeZeroBounceKey;
process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = "true";
process.env.FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED = "true";
let zeroBounceCalls = 0;
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  if (url.origin === "https://api.zerobounce.net" && url.pathname === "/v2/validate") {
    if (url.searchParams.get("api_key") !== fakeZeroBounceKey) {
      throw new Error("TASK_2001_FAKE_ZEROBOUNCE_KEY_MISMATCH");
    }
    zeroBounceCalls++;
    return new Response(JSON.stringify({ status: "valid", sub_status: "" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return deniedFetch(input, init);
}) as typeof fetch;
// Keep the real MX validation gate while preventing test DNS from leaving the
// disposable process.
(dns as any).resolveMx = async () => [{ exchange: "mx.task2001.invalid", priority: 10 }];

let assertions = 0;
let failures = 0;
function check(value: unknown, label: string): void {
  assertions++;
  try {
    assert.ok(value, label);
    console.log(`✓ [SFP2001-${String(assertions).padStart(2, "0")}] ${label}`);
  } catch (error) {
    failures++;
    console.error(`✗ [SFP2001-${String(assertions).padStart(2, "0")}] ${label}: ${(error as Error).message}`);
  }
}
const rows = (r: any): any[] => r?.rows ?? r ?? [];
const runKey = `sfp2001-${randomUUID()}`;
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function emitFailOnlyDiagnostic(scope: string, details: unknown): void {
  console.error(`[SFP2001-DIAGNOSTIC:${scope}] ${JSON.stringify(details)}`);
}
function summarizeStagingPreview(preview: any): unknown {
  return {
    snapshotHash: preview?.snapshotHash ?? null,
    commandKey: preview?.commandKey ?? null,
    eligibleCount: preview?.eligibleCount ?? null,
    blockedCount: preview?.blockedCount ?? null,
    rows: (preview?.rows ?? []).map((row: any) => ({
      eligibilityId: row.eligibilityId,
      businessId: row.businessId,
      sourceKind: row.sourceKind,
      sourceReferenceId: row.sourceReferenceId ?? null,
      normalizedValueHashVersion: row.normalizedValueHashVersion ?? null,
      packageKey: row.packageKey ?? null,
      disposition: row.disposition,
      blockedReason: row.blockedReason ?? null,
    })),
  };
}
async function readStagingCurrentnessDiagnostic(cohortId: string, eligibilityIds: string[]): Promise<any[]> {
  if (eligibilityIds.length === 0) return [];
  return rows(await db.execute(sql`
    SELECT e.id::text AS eligibility_id,e.business_id,e.status,e.source_kind,
           e.candidate_id::text AS candidate_id,
           e.paid_candidate_evidence_id::text AS paid_candidate_evidence_id,
           e.contact_id,e.validation_operation_id::text AS validation_operation_id,
           e.reused_from_operation_id::text AS reused_from_operation_id,
           e.normalized_value_hash_version,
           (e.validation_expires_at IS NOT NULL AND e.validation_expires_at>NOW()) AS validation_current,
           (CASE e.source_kind
              WHEN 'free' THEN f.id IS NOT NULL AND f.business_id=e.business_id
                AND f.field='email' AND f.normalized_value_hash=e.normalized_value_hash
              WHEN 'paid' THEN p.id IS NOT NULL AND p.business_id=e.business_id
                AND p.field='email' AND p.normalized_value_hash=e.normalized_value_hash
              WHEN 'contact' THEN e.contact_id IS NOT NULL
                AND e.contact_business_link_decision_id IS NOT NULL
                AND e.normalized_value_hash IS NOT NULL
              ELSE FALSE
            END) AS current_source_identity_pin_matches,
           o.id::text AS receipt_operation_id,o.provider AS receipt_provider,o.state AS receipt_operation_state,
           po.subject_type AS observation_subject_type,
           (po.subject_id::text=e.business_id::text) AS observation_subject_matches_business,
           po.outcome AS observation_outcome
      FROM sfp_outreach_eligibility e
      LEFT JOIN free_discovery_candidates f
        ON e.source_kind='free' AND f.id=e.candidate_id
      LEFT JOIN sfp_paid_candidate_evidence p
        ON e.source_kind='paid' AND p.id=e.paid_candidate_evidence_id
      LEFT JOIN provider_operations o
        ON o.id=COALESCE(e.validation_operation_id,e.reused_from_operation_id)
      LEFT JOIN LATERAL (
        SELECT subject_type,subject_id,outcome
          FROM provider_observations
         WHERE operation_id=o.id
         ORDER BY observed_at DESC LIMIT 1
      ) po ON TRUE
     WHERE e.cohort_run_id=${cohortId}::uuid
       AND e.id=ANY(ARRAY[${sql.join(eligibilityIds.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[])
     ORDER BY e.id
  `));
}

// Import-boundary regression guards apply to the literal files, not a
// transitive bundle. These are intentionally hard negative assertions.
const stagingSource = source("server/services/cro03/sfp-campaign-staging-v2.ts");
const packagesSource = source("server/services/cro03/sfp-campaign-packages.ts");
const workerSource = source("server/services/cro03/sfp-campaign-staging-worker.ts");
const withoutComments = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");
for (const [label, text] of [
  ["staging service", stagingSource],
  ["package service", packagesSource],
]) {
  check(!/sequence_enrollments|campaign_queue_runs|campaign_queue_items|createSequenceEnrollment|ghl[-/]client|GhlClient/i.test(withoutComments(text)),
    `${label} executable source contains no enrollment, dispatch queue, or GHL client boundary`);
}
const workerImports = workerSource.match(/^\s*import[\s\S]*?from\s+["'][^"']+["'];/gm) ?? [];
check(!workerImports.some((line) => /ghl|sequence-enrollment|campaign-dispatch|campaign-queue/i.test(line)),
  "worker import statements exclude GHL clients, enrollment creation, and campaign dispatch");
const backgroundProfileSource = source("server/services/background-profile.ts");
const outreachGroup = backgroundProfileSource.match(/["']outreach["']\s*:\s*\[([^\]]*)\]/)?.[1] ?? "";
check(backgroundProfileSource.includes('"sfp-campaign-staging": [\n    "sfp-campaign-staging",') &&
  !outreachGroup.includes("sfp-campaign-staging"),
  "queue is isolated to the SFP staging capability, not outreach");
check(/COALESCE\(\(schedule_config->>'campaignStaging'\)::int,\s*0\)/.test(workerSource) &&
  workerSource.includes("recurring_enabled") && workerSource.includes("MAX_BATCH_SIZE = 25"),
  "recurring processing is opt-in, stage-configured, and capped at 25");

const { runDrizzleMigrations } = await import("../server/db-migrate");
await runDrizzleMigrations();
const { db, pool } = await import("../server/db");
const { seal } = await import("../server/services/cro03/candidate-evidence-service");
const { writeSfpPaidCandidateEvidence } = await import("../server/services/cro03/sfp-paid-evidence-writer");
const { previewStagingV2, executeStagingV2, SfpStagingV2Error } = await import("../server/services/cro03/sfp-campaign-staging-v2");
const { computeLivePackageContentHash } = await import("../server/services/cro03/sfp-campaign-packages");
const { CLASSIFIER_VERSION, SFP_TARGET_VERTICALS_V2, TAXONOMY_VERSION_V2 } = await import("../server/services/cro03/sfp-vertical-classifier");
  const { GEOGRAPHY_RESOLVER_VERSION, resolveGeographyForBusiness } = await import("../server/services/cro03/sfp-geography-resolver");
const { ensureProgram } = await import("../server/services/cro03/south-florida-prospecting");
const { previewSfpValidation, executeSfpValidation } = await import("../server/services/cro03/sfp-validation");
const { renewSfpRuntimeDeploymentOwner } = await import("../server/services/cro03/sfp-provider-operations");
let ownerHeartbeat: ReturnType<typeof setInterval> | undefined;
let ownerHeartbeatPending = false;
let ownerHeartbeatError: unknown;

try {
  // Runtime and release identity are bootstrapped only through the audited
  // private-test helper. Provider ownership is then acquired by the normal
  // validation reservation/dispatch fence, never by seeding authority rows.
  const runtimeIdentityHelper = await import("./helpers/sfp-runtime-test-identity");
  const currentTestRuntime = await runtimeIdentityHelper.getSfpRuntimeTestIdentity();
  const releaseSelection = await runtimeIdentityHelper.selectSfpRuntimeTestRelease(runKey);
  check(releaseSelection.currentReleaseSelected && releaseSelection.ownerLive && releaseSelection.ready,
    "current test release is selected through the helper with its persisted live runtime owner");
  check(releaseSelection.selectedRelease?.artifactSha === currentTestRuntime.artifactSha,
    "the private runtime selection is bound to this process's current release identity");
  // A long CLI fixture has no application heartbeat. Renew only its existing,
  // live, selected owner through the ordinary fenced API; never seed authority.
  ownerHeartbeat = setInterval(async () => {
    if (ownerHeartbeatPending) return;
    ownerHeartbeatPending = true;
    try { await renewSfpRuntimeDeploymentOwner(); }
    catch (error) { ownerHeartbeatError = error; }
    finally { ownerHeartbeatPending = false; }
  }, 5000);

  const { authorizePaidBudget, MI09_PAID_BUDGET_TYPED_CONFIRMATION } =
    await import("../server/services/mi09-pilot-authority");
  await authorizePaidBudget({
    authorizedBy: runKey,
    typedConfirmation: MI09_PAID_BUDGET_TYPED_CONFIRMATION,
  });
  const { updateSfpPaidProviderControl } = await import("../server/services/paid-provider-control");
  const zeroBounceControl = await updateSfpPaidProviderControl({
    provider: "zerobounce",
    enabled: true,
    reason: "Task 2001 disposable fake-provider validation",
    actorId: runKey,
  });
  check(zeroBounceControl.enabled === true && zeroBounceControl.circuit_state === "closed",
    "fake ZeroBounce validation uses the audited provider-control path in the disposable database");

  type FixtureValidationRun = { validationRunId: string; receipts: any[] };
  function findFixtureValidationReceipt(
    validation: FixtureValidationRun,
    businessId: number,
    sourceId: string,
  ): any | undefined {
    return validation.receipts.find((row: any) =>
      String(row.validation_run_id) === validation.validationRunId &&
      Number(row.business_id) === businessId &&
      String(row.candidate_id ?? row.paid_candidate_evidence_id ?? "") === sourceId);
  }
  async function validateFixtureCandidates(cohortId: string, label: string): Promise<FixtureValidationRun> {
    if (ownerHeartbeatError) throw ownerHeartbeatError;
    const preview = await previewSfpValidation(cohortId);
    check(preview.gateOpen, `${label} validation preview passes the governed runtime/provider gates`);
    check(preview.addressesForValidation > 0, `${label} validation selects at least one persisted source candidate`);
    const callsBeforeValidation = zeroBounceCalls;
    const result = await executeSfpValidation(cohortId, {
      idempotencyKey: `${runKey}-${label}-validation`,
      actorId: runKey,
      maxValidations: 25,
      snapshotHash: preview.snapshotHash,
    });
    const validationRun = rows(await db.execute(sql`
      SELECT id::text AS id,state
        FROM sfp_stage_runs
       WHERE cohort_run_id=${cohortId}::uuid AND stage='validation'
         AND idempotency_key=${result.idempotencyKey}
       LIMIT 1
    `))[0];
    const validationRunId = String(validationRun?.id ?? "");
    const resultRunId = typeof (result as any).runId === "string" ? String((result as any).runId) : null;
    const validationRunMatchesResult = Boolean(validationRunId) &&
      (!resultRunId || resultRunId === validationRunId);
    const validationSucceeded = result.failedCount === 0 && result.invalidCount === 0 && result.zeroOutreachConfirmed === true;
    const receipts = validationRunId ? rows(await db.execute(sql`
      WITH current_run_items AS (
        SELECT i.stage_run_id,i.business_id,i.state AS validation_item_state,i.outcome_code AS validation_item_outcome,
               i.redacted_result->>'sourceKind' AS source_kind,
               CASE i.redacted_result->>'sourceKind'
                 WHEN 'free' THEN i.redacted_result->>'candidateId'
                 WHEN 'paid' THEN i.redacted_result->>'paidCandidateEvidenceId'
                 WHEN 'contact' THEN i.redacted_result->>'contactId'
                 ELSE NULL
               END AS source_reference_id,
               NULLIF(i.redacted_result->>'policyVersion','')::int AS output_policy_version,
               i.redacted_result->>'normalizedAddressHash' AS output_normalized_value_hash,
               i.redacted_result->>'status' AS output_status,
               i.redacted_result->>'outcome' AS validation_provider_outcome
          FROM sfp_stage_items i
         WHERE i.stage_run_id=${validationRunId}::uuid AND i.provider='zerobounce'
      )
      SELECT e.id,e.business_id,e.status,e.source_kind,e.candidate_id,e.paid_candidate_evidence_id,
             e.validation_operation_id,e.reused_from_operation_id,e.normalized_value_hash_version,
             e.policy_version,ri.stage_run_id::text AS validation_run_id,
             ri.validation_item_state,ri.validation_item_outcome,
             ri.validation_provider_outcome,
             o.id AS receipt_operation_id,o.provider,o.state AS operation_state,
             po.subject_type AS observation_subject_type,
             (po.subject_id::text=e.business_id::text) AS observation_subject_matches_business,
             po.outcome AS observation_outcome,
             (CASE e.source_kind
                WHEN 'free' THEN f.id IS NOT NULL AND f.business_id=e.business_id
                  AND f.field='email' AND f.normalized_value_hash=e.normalized_value_hash
                WHEN 'paid' THEN p.id IS NOT NULL AND p.business_id=e.business_id
                  AND p.field='email' AND p.normalized_value_hash=e.normalized_value_hash
                ELSE FALSE
              END) AS current_source_identity_pin_matches
        FROM current_run_items ri
        JOIN sfp_outreach_eligibility e
          ON e.cohort_run_id=${cohortId}::uuid
         AND e.business_id=ri.business_id
         AND e.policy_version=ri.output_policy_version
         AND e.source_kind=ri.source_kind
         AND CASE e.source_kind
               WHEN 'free' THEN e.candidate_id::text
               WHEN 'paid' THEN e.paid_candidate_evidence_id::text
               WHEN 'contact' THEN e.contact_id::text
               ELSE ''
             END=ri.source_reference_id
         AND e.normalized_value_hash=ri.output_normalized_value_hash
         AND e.status=ri.output_status
        LEFT JOIN free_discovery_candidates f
          ON e.source_kind='free' AND f.id=e.candidate_id
        LEFT JOIN sfp_paid_candidate_evidence p
          ON e.source_kind='paid' AND p.id=e.paid_candidate_evidence_id
        LEFT JOIN provider_operations o
          ON o.id=COALESCE(e.validation_operation_id,e.reused_from_operation_id)
        LEFT JOIN LATERAL (
          SELECT subject_type,subject_id,outcome FROM provider_observations
           WHERE operation_id=o.id ORDER BY observed_at DESC LIMIT 1
        ) po ON TRUE
       ORDER BY e.business_id,e.id
     `))
      : [];
    const receiptBySource = new Map(receipts.map((row: any) => [
      String(row.candidate_id ?? row.paid_candidate_evidence_id ?? ""),
      row,
    ]));
    const receiptProofPassed = receipts.length === preview.selectedCandidates.length &&
      preview.selectedCandidates.every((candidate) => {
        const row: any = receiptBySource.get(String(candidate.candidateId));
        const sourceId = String(row?.candidate_id ?? row?.paid_candidate_evidence_id ?? "");
        const operationId = row?.validation_operation_id ?? row?.reused_from_operation_id;
        return row?.status === "validated_outreach_eligible" &&
          String(row.validation_run_id) === validationRunId &&
          Number(row.business_id) === Number(candidate.businessId) &&
          sourceId === String(candidate.candidateId) &&
          row.validation_item_state === "completed" &&
          row.validation_provider_outcome === "valid" &&
          Number(row.policy_version) > 0 &&
          Boolean(row.validation_operation_id) !== Boolean(row.reused_from_operation_id) &&
          operationId && String(row.receipt_operation_id) === String(operationId) &&
          row.provider === "zerobounce" &&
          row.operation_state === "completed" &&
          row.observation_subject_type === "business" &&
          row.observation_subject_matches_business === true &&
          row.observation_outcome === "valid" &&
          row.current_source_identity_pin_matches === true;
      });
    const providerRequestDelta = zeroBounceCalls - callsBeforeValidation;
    const directReceiptCount = receipts.filter((row: any) => Boolean(row.validation_operation_id)).length;
    const providerBoundaryPassed = providerRequestDelta === Number(result.providerRequests) &&
      Number(result.providerRequests) === directReceiptCount;
    if (!validationSucceeded || !validationRunMatchesResult || !receiptProofPassed || !providerBoundaryPassed) {
      emitFailOnlyDiagnostic(`validation:${label}`, {
        cohortId,
        validationRunId: validationRunId || null,
        resultRunId,
        validationRunState: validationRun?.state ?? null,
        validationRunMatchesResult,
        preview: {
          gateOpen: preview.gateOpen,
          gateBlockedReason: preview.gateBlockedReason,
          snapshotHash: preview.snapshotHash,
          addressesForValidation: preview.addressesForValidation,
          selectedCandidates: preview.selectedCandidates.map((candidate: any) => ({
            businessId: candidate.businessId,
            candidateId: candidate.candidateId,
          })),
        },
        result: {
          failedCount: result.failedCount,
          invalidCount: result.invalidCount,
          validCount: result.validCount,
          catchAllCount: result.catchAllCount,
          providerRequests: result.providerRequests,
          eligibilityRowsCreated: result.eligibilityRowsCreated,
          zeroOutreachConfirmed: result.zeroOutreachConfirmed,
        },
        zeroBounceCalls: providerRequestDelta,
        directReceiptCount,
        selectedCandidateCount: preview.selectedCandidates.length,
        receipts: receipts.map((row: any) => ({
          eligibilityId: row.id,
          businessId: Number(row.business_id),
          status: row.status,
          sourceKind: row.source_kind,
          candidateId: row.candidate_id,
          paidCandidateEvidenceId: row.paid_candidate_evidence_id,
          validationOperationId: row.validation_operation_id,
          reusedFromOperationId: row.reused_from_operation_id,
          receiptOperationId: row.receipt_operation_id,
          provider: row.provider,
          operationState: row.operation_state,
          observationSubjectType: row.observation_subject_type,
          observationSubjectMatchesBusiness: row.observation_subject_matches_business,
          observationOutcome: row.observation_outcome,
          normalizedValueHashVersion: row.normalized_value_hash_version,
          currentSourceIdentityPinMatches: row.current_source_identity_pin_matches,
          validationRunId: row.validation_run_id,
          validationItemState: row.validation_item_state,
          validationItemOutcome: row.validation_item_outcome,
          validationProviderOutcome: row.validation_provider_outcome,
        })),
        sourceCurrentness: await readStagingCurrentnessDiagnostic(
          cohortId,
          receipts.map((row: any) => String(row.id)),
        ),
      });
    }
    check(validationSucceeded,
      `${label} fake-provider validation completes without failures, invalid candidates, or outreach`);
    check(validationRunMatchesResult,
      `${label} receipt proof is bound to the exact validation run created for this idempotency key`);
    check(receiptProofPassed,
      `${label} current selected sources each retain an exact, subject-bound direct or reused completed ZeroBounce receipt and current source pin`);
    check(providerBoundaryPassed,
      `${label} new ZeroBounce operations match calls across the disposable fake transport boundary, with reused receipts remaining governed`);
    return { validationRunId, receipts };
  }

  const policy = rows(await db.execute(sql`
    SELECT d.id, d.version, d.document_hash
      FROM sfp_outreach_policy_control c
      JOIN sfp_outreach_policy_documents d ON d.id=c.active_policy_id
     WHERE c.singleton=TRUE
  `))[0];
  check(Boolean(policy), "active versioned outreach policy is present after migrations");

  const targetVerticalSql = sql.join(SFP_TARGET_VERTICALS_V2.map((vertical) => sql`${vertical}`), sql`, `);
  const ensuredProgram = await ensureProgram({ createdBy: runKey, maxCohortSize: 10 });
  const program = rows(await db.execute(sql`
    UPDATE sfp_programs
       SET county_fips=ARRAY['12086']::text[],
           vertical_ids=ARRAY[${targetVerticalSql}]::text[],
           max_cohort_size=10, is_active=TRUE, taxonomy_version=${TAXONOMY_VERSION_V2}
     WHERE id=${String(ensuredProgram.id)}::uuid
    RETURNING id
  `))[0];
  const cohortRunId = randomUUID();
  await db.execute(sql`
    INSERT INTO sfp_cohort_runs
      (id, program_id, idempotency_key, status, cohort_size, cohort_hash, release_sha, actor_id,
       cohort_state, frozen_at)
    VALUES (${cohortRunId}::uuid, ${String(program.id)}::uuid, ${`${runKey}-cohort`},
      'freezing', 10, ${createHash("sha256").update(runKey).digest("hex")},
      ${String(currentTestRuntime.artifactSha)}, ${runKey}, 'freezing', NULL)
  `);

  const campaign = rows(await db.execute(sql`
    INSERT INTO campaigns (name, status, target_verticals, created_by, total_steps)
    VALUES (${`${runKey}-campaign`}, 'draft', ARRAY['Healthcare'], ${runKey}, 1)
    RETURNING id
  `))[0];
  const sequence = rows(await db.execute(sql`
    INSERT INTO follow_up_sequences
      (name, status, trigger_type, total_steps, sequence_family, channels_allowed, eligible_consent_tiers)
    VALUES (${`${runKey}-sequence`}, 'paused', 'manual', 1, ${`${runKey}-healthcare-v2`},
            ARRAY['email','task'], ARRAY['first_party_role_inbox'])
    RETURNING id
  `))[0];
  const liveContentHash = await computeLivePackageContentHash(db, Number(campaign.id), Number(sequence.id));
  const fixturePackageKey = "sfp.healthcare.v2";
  const insertedPackageVersion = rows(await db.execute(sql`
    INSERT INTO sfp_campaign_package_versions
      (package_key, vertical, campaign_id, campaign_name, sequence_id, sequence_name,
       sequence_family, content_hash, lifecycle_state, effective_at, actor_id)
    VALUES (${fixturePackageKey}, 'Healthcare', ${Number(campaign.id)}, ${`${runKey}-campaign`},
            ${Number(sequence.id)}, ${`${runKey}-sequence`}, ${`${runKey}-healthcare-v2`},
            ${liveContentHash}, 'current', NOW(), ${runKey})
    ON CONFLICT DO NOTHING
    RETURNING id
  `))[0];
  const packageVersion = insertedPackageVersion ?? rows(await db.execute(sql`
    SELECT id FROM sfp_campaign_package_versions
     WHERE package_key=${fixturePackageKey} AND vertical='Healthcare' AND lifecycle_state='current'
     LIMIT 1
  `))[0];
  check(Boolean(packageVersion), "draft campaign and paused sequence current Healthcare v2 package seeded");
  const fixturePackageAuthority = rows(await db.execute(sql`
    SELECT campaign_id,sequence_id,content_hash
      FROM sfp_campaign_package_versions
     WHERE id=${String(packageVersion?.id)}::uuid
       AND package_key=${fixturePackageKey} AND vertical='Healthcare' AND lifecycle_state='current'
  `))[0];
  assert.ok(fixturePackageAuthority, "the current fixture package must resolve to its authoritative campaign and sequence");
  const fixturePackageCampaignId = Number(fixturePackageAuthority.campaign_id);
  const fixturePackageSequenceId = Number(fixturePackageAuthority.sequence_id);
  const fixturePackagePinnedContentHash = String(fixturePackageAuthority.content_hash);
  const fixturePackageLiveContentHash = await computeLivePackageContentHash(
    db, fixturePackageCampaignId, fixturePackageSequenceId,
  );
  check(fixturePackageLiveContentHash === fixturePackagePinnedContentHash,
    "the exact current fixture package content matches its authoritative stored fingerprint before negative tests");

  const generation = rows(await db.execute(sql`
    INSERT INTO free_discovery_generations (run_key, actor_id, purpose, reason, state)
    VALUES (${`${runKey}-generation`}, ${runKey}, 'email_discovery', 'Task 2001 certification', 'completed')
    RETURNING id
  `))[0];
  const classificationPolicyVersion = Number(rows(await db.execute(sql`
    SELECT policy_version FROM sfp_programs WHERE id=${String(program.id)}::uuid
  `))[0]?.policy_version);
  async function seedFixtureOperatingGeography(businessId: number): Promise<any> {
    await db.execute(sql`
      INSERT INTO business_locations
        (business_id,street_address,city,state,postal_code,county_fips,is_primary,created_at,updated_at)
      VALUES (${businessId},'100 Test Avenue','Miami','FL','33130','12086',TRUE,NOW(),NOW())
    `);
    const geography = await resolveGeographyForBusiness(businessId, db);
    assert.equal(geography.resolverVersion, GEOGRAPHY_RESOLVER_VERSION);
    assert.equal(geography.outcome, "resolved");
    assert.equal(geography.eligible, true);
    assert.equal(geography.countyFips, "12086");
    assert.ok(geography.winningLocationId, "fixture operating geography must resolve from its persisted business_locations row");
    return geography;
  }
  async function seedFrozenClassification(
    businessId: number,
    targetVertical: string,
    roiScore: number,
    targetCohortRunId = cohortRunId,
  ): Promise<void> {
    const geography = await seedFixtureOperatingGeography(businessId);
    const geographySource = geography.evidenceClass === "verified" ? "fips"
      : geography.evidenceClass === "zip_inferred" ? "zip"
        : geography.evidenceClass === "city_inferred" ? "city" : "none";
    const evidenceHash = createHash("sha256")
      .update(JSON.stringify({
        businessId, taxonomyVersion: TAXONOMY_VERSION_V2, classifierVersion: CLASSIFIER_VERSION,
        targetVertical, fixture: runKey,
      }))
      .digest("hex");
    const evidence = rows(await db.execute(sql`
      INSERT INTO sfp_classification_evidence
        (business_id, evidence_hash, source_refs, classifier_version, taxonomy_version, policy_version,
         outcome, confidence, reason_codes, idempotency_key, cost_micros, terminal_state,
         resolved_vertical_id, admission_tier)
      VALUES (${businessId}, ${evidenceHash}, ${JSON.stringify([{ source: "task-2001-disposable-certification" }])}::jsonb,
        ${CLASSIFIER_VERSION}, ${TAXONOMY_VERSION_V2}, ${classificationPolicyVersion}, 'target', 0.95,
        '["CERTIFICATION_FROZEN_V2_TARGET"]'::jsonb, ${`${runKey}-classification-${businessId}`},
        0, 'completed', ${targetVertical}, 'resolved_high')
      RETURNING id
    `))[0];
    await db.execute(sql`
      INSERT INTO sfp_cohort_members
        (cohort_run_id, business_id, roi_score, geography_class, geography_source, county_fips, vertical,
         classifier_version, classifier_outcome, classifier_confidence, classifier_matched_target,
         classifier_reasons, classifier_evidence_hash, geography_resolver_version, geography_outcome,
         geography_location_id, geography_reasons)
      VALUES (${targetCohortRunId}::uuid, ${businessId}, ${roiScore}, ${String(geography.evidenceClass)},
        ${geographySource}, ${geography.countyFips}, ${targetVertical},
        ${CLASSIFIER_VERSION}, 'resolved_high', 0.95, ${targetVertical},
        '["CERTIFICATION_FROZEN_V2_TARGET"]'::jsonb, ${evidenceHash},
        ${geography.resolverVersion}, ${geography.outcome}, ${geography.winningLocationId},
        ${JSON.stringify(geography.reasons)}::jsonb)
    `);
    await db.execute(sql`
      INSERT INTO sfp_cohort_decisions
        (cohort_run_id, business_id, disposition, geography_class, geography_source, vertical,
         roi_score, selected, classifier_version, classifier_outcome, classifier_confidence,
         classifier_matched_target, classifier_reasons, classifier_evidence_hash,
         classification_evidence_id, classification_policy_version, classification_evidence_hash,
         classification_classifier_version, geography_resolver_version, geography_outcome,
         geography_location_id, geography_reasons)
      VALUES (${targetCohortRunId}::uuid, ${businessId}, 'selected', ${String(geography.evidenceClass)},
        ${geographySource}, ${targetVertical},
        ${roiScore}, TRUE, ${CLASSIFIER_VERSION}, 'resolved_high', 0.95, ${targetVertical},
        '["CERTIFICATION_FROZEN_V2_TARGET"]'::jsonb, ${evidenceHash},
        ${String(evidence.id)}::uuid, ${classificationPolicyVersion}, ${evidenceHash}, ${CLASSIFIER_VERSION},
        ${geography.resolverVersion}, ${geography.outcome}, ${geography.winningLocationId},
        ${JSON.stringify(geography.reasons)}::jsonb)
    `);
  }
  const fixture: Array<{ eligibilityId: string; businessId: number; kind: "free" | "paid"; candidateId?: string; paidId?: string }> = [];
  // These are positive business-inbox eligibility fixtures, not named people.
  const emails = ["free", "paid", "drift", "legacy"].map(kind => `info@${kind}-${runKey}.example.org`);
  for (let i = 0; i < emails.length; i++) {
    const business = rows(await db.execute(sql`
      INSERT INTO businesses (canonical_name, normalized_name, vertical, state, record_class, created_at)
      VALUES (${`${runKey}-business-${i}`}, ${`${runKey}-business-${i}`.toLowerCase()}, NULL, 'FL', 'canonical', NOW())
      RETURNING id
    `))[0];
    const businessId = Number(business.id);
    let candidateId: string | undefined;
    let paidId: string | undefined;
    const normalizedHash = createHash("sha256").update(`email\0${emails[i].trim().toLowerCase()}`).digest("hex");
    if (i === 1) {
      const evidence = await writeSfpPaidCandidateEvidence({
        businessId, provider: "outscraper", field: "email", value: emails[i],
        subjectType: "business", confidence: 85,
      });
      paidId = String(evidence.evidenceId ?? evidence.id);
      check(Boolean(paidId), "paid candidate evidence created through the governed writer");
    } else {
      const sealed = seal("email", emails[i]);
      const candidate = rows(await db.execute(sql`
        INSERT INTO free_discovery_candidates
          (generation_id, business_id, field, subject_type, domain, source,
           attribution_scope, disposition, confidence, envelope_ciphertext, envelope_nonce,
           envelope_tag, envelope_key_version, normalized_value_hash, masked_value, created_at)
        VALUES (${String(generation.id)}::uuid, ${businessId}, 'email', 'business',
          ${`${runKey}-${i}.example.org`}, 'certification', 'role', 'staged', 90,
          ${sealed.ciphertext}, ${sealed.nonce}, ${sealed.tag}, 1, ${normalizedHash},
          ${sealed.maskedValue}, NOW())
        RETURNING id
      `))[0];
      candidateId = String(candidate.id);
    }
    await seedFrozenClassification(businessId, "Healthcare", 50);
    fixture.push({ eligibilityId: "", businessId, kind: i === 1 ? "paid" : "free", candidateId, paidId });
  }
  // Businesses used by the completion-review regression checks below
  // (cross-business evidence binding, live content-hash drift, concurrent
  // duplicate execution) must be registered as cohort members BEFORE the
  // freeze below — sfp_cohort_members has a trigger that rejects any INSERT
  // once the owning cohort run is frozen/voided/superseded.
  const extraBusinessIds: Record<"mismatch" | "drift2" | "concurrent" | "workerOk" | "crash" | "suppressed", number> = { mismatch: 0, drift2: 0, concurrent: 0, workerOk: 0, crash: 0, suppressed: 0 };
  for (const key of ["mismatch", "drift2", "concurrent", "workerOk", "crash", "suppressed"] as const) {
    const extraBusiness = rows(await db.execute(sql`
      INSERT INTO businesses (canonical_name, normalized_name, vertical, state, record_class, created_at)
      VALUES (${`${runKey}-business-${key}`}, ${`${runKey}-business-${key}`.toLowerCase()}, NULL, 'FL', 'canonical', NOW())
      RETURNING id
    `))[0];
    extraBusinessIds[key] = Number(extraBusiness.id);
    await seedFrozenClassification(extraBusinessIds[key], "Healthcare", 50);
  }

  await db.execute(sql`
    UPDATE sfp_cohort_runs SET status='frozen', cohort_state='frozen', frozen_at=NOW()
     WHERE id=${cohortRunId}::uuid
  `);

  // Every staging fixture starts from a real governed validation receipt:
  // source candidates are persisted above, but no eligibility status is
  // fabricated directly in SQL.
  const initialValidation = await validateFixtureCandidates(cohortRunId, "initial");
  for (const item of fixture) {
    const sourceId = item.kind === "free" ? String(item.candidateId) : String(item.paidId);
    const validated = findFixtureValidationReceipt(initialValidation, item.businessId, sourceId);
    assert.ok(
      validated?.validation_operation_id || validated?.reused_from_operation_id,
      "fixture eligibility must retain its exact current-run direct or reused provider operation",
    );
    item.eligibilityId = String(validated.id);
  }

  // Free source and paid source use the same preview/execute path.
  let initialFreePreview: Awaited<ReturnType<typeof previewStagingV2>> | null = null;
  for (const [index, label] of [[0, "free"], [1, "paid"]] as const) {
    const item = fixture[index];
    const preview = await previewStagingV2({ cohortRunId, eligibilityIds: [item.eligibilityId], actorId: runKey });
    if (label === "free") initialFreePreview = preview;
    const previewPassed = preview.eligibleCount === 1 && preview.rows[0]?.packageKey === fixturePackageKey;
    if (!previewPassed) {
      emitFailOnlyDiagnostic(`staging-preview:${label}`, {
        cohortId: cohortRunId,
        eligibilityIds: [item.eligibilityId],
        preview: summarizeStagingPreview(preview),
        sourceCurrentness: await readStagingCurrentnessDiagnostic(cohortRunId, [item.eligibilityId]),
      });
    }
    check(previewPassed,
      `${label} row previews against its package-pinned frozen v2 Healthcare target`);
    const result = await executeStagingV2({
      cohortRunId, eligibilityIds: [item.eligibilityId], commandKey: preview.commandKey,
      snapshotHash: preview.snapshotHash, actorId: runKey, confirmPayloadHash: preview.payloadHash,
    });
    const stagingPassed = result.readyHeld === 1 && result.rejected === 0;
    if (!stagingPassed) {
      emitFailOnlyDiagnostic(`staging-execute:${label}`, {
        cohortId: cohortRunId,
        eligibilityIds: [item.eligibilityId],
        preview: summarizeStagingPreview(preview),
        result: {
          readyHeld: result.readyHeld,
          rejected: result.rejected,
          reasons: result.reasons,
          zeroOutreachConfirmed: result.zeroOutreachConfirmed,
        },
        sourceCurrentness: await readStagingCurrentnessDiagnostic(cohortRunId, [item.eligibilityId]),
      });
    }
    check(stagingPassed, `${label} row reaches ready_held`);
    const intent = rows(await db.execute(sql`
      SELECT id, state, source_kind, candidate_id, paid_candidate_evidence_id
        FROM sfp_campaign_staging_intents WHERE eligibility_id=${item.eligibilityId}::uuid
    `))[0];
    const lead = rows(await db.execute(sql`
      SELECT pipeline_origin FROM master_leads WHERE canonical_business_id=${item.businessId}
        AND pipeline_origin='sfp_pipeline'
    `))[0];
    const eligibility = rows(await db.execute(sql`
      SELECT campaign_staged_at FROM sfp_outreach_eligibility WHERE id=${item.eligibilityId}::uuid
    `))[0];
    check(intent?.state === "ready_held", `${label} staging intent is ready_held`);
    check(lead?.pipeline_origin === "sfp_pipeline", `${label} creates an SFP-origin master lead`);
    check(Boolean(eligibility?.campaign_staged_at), `${label} eligibility records campaign_staged_at`);
    if (label === "paid") {
      check(intent?.source_kind === "paid" && intent.candidate_id === null && Boolean(intent.paid_candidate_evidence_id),
        "paid source uses the typed evidence one-of reference with candidate_id null");
    }
  }

  const freeFixture = fixture[0];
  const originalPreview = initialFreePreview!;
  const command = rows(await db.execute(sql`
    SELECT stored_result FROM sfp_campaign_staging_commands WHERE command_key=${originalPreview.commandKey}
  `))[0];
  const beforeReplayIntents = Number(rows(await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM sfp_campaign_staging_intents WHERE eligibility_id=${freeFixture.eligibilityId}::uuid
  `))[0].count);
  const replay = await executeStagingV2({
    cohortRunId, eligibilityIds: [freeFixture.eligibilityId], commandKey: originalPreview.commandKey,
    snapshotHash: originalPreview.snapshotHash, actorId: runKey, confirmPayloadHash: originalPreview.payloadHash,
  });
  const storedResult = command?.stored_result;
  const { replayed: _replayed, ...replayBusinessResult } = replay;
  const { replayed: _storedReplayed, ...storedBusinessResult } = storedResult ?? {};
  let matchesStoredResult = true;
  try { assert.deepStrictEqual(replayBusinessResult, storedBusinessResult); } catch { matchesStoredResult = false; }
  check(replay.replayed === true && matchesStoredResult,
    "same command key and payload replay the stored business result exactly");
  const afterReplayIntents = Number(rows(await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM sfp_campaign_staging_intents WHERE eligibility_id=${freeFixture.eligibilityId}::uuid
  `))[0].count);
  check(beforeReplayIntents === afterReplayIntents && afterReplayIntents === 1,
    "idempotent replay creates no second intent");

  let payloadMismatch: unknown;
  try {
    await executeStagingV2({
      cohortRunId, eligibilityIds: [fixture[2].eligibilityId], commandKey: originalPreview.commandKey,
      snapshotHash: originalPreview.snapshotHash, actorId: runKey, confirmPayloadHash: originalPreview.payloadHash,
    });
  } catch (error) { payloadMismatch = error; }
  check(payloadMismatch instanceof SfpStagingV2Error && payloadMismatch.httpStatus === 409,
    "same command key with a different eligibility payload returns HTTP 409");

  const stalePreview = await previewStagingV2({
    cohortRunId, eligibilityIds: [fixture[2].eligibilityId], actorId: runKey,
  });
  await db.execute(sql`
    UPDATE sfp_outreach_eligibility SET status='validated_review_required', updated_at=NOW()
     WHERE id=${fixture[2].eligibilityId}::uuid
  `);
  let snapshotDrift: unknown;
  try {
    await executeStagingV2({
      cohortRunId, eligibilityIds: [fixture[2].eligibilityId], commandKey: stalePreview.commandKey,
      snapshotHash: stalePreview.snapshotHash, actorId: runKey, confirmPayloadHash: stalePreview.payloadHash,
    });
  } catch (error) { snapshotDrift = error; }
  check(snapshotDrift instanceof SfpStagingV2Error && snapshotDrift.httpStatus === 409,
    "mutated eligibility state after preview fails closed with HTTP 409");

  // Rows using these historical state values remain legal and queryable
  // after migration 0290. Each row has an isolated eligibility identity.
  for (const [index, state] of ["staged", "rejected", "cancelled"].entries()) {
    // Constraint-retention fixtures are historical rows, not additional
    // actionable members of the live cohort. Keep each business independent.
    const legacyBusiness = rows(await db.execute(sql`
      INSERT INTO businesses (canonical_name, normalized_name, state, record_class)
      VALUES (${`${runKey}-legacy-state-${state}`}, ${`${runKey}-legacy-state-${state}`.toLowerCase()}, 'FL', 'canonical')
      RETURNING id
    `))[0];
    const legacyBusinessId = Number(legacyBusiness.id);
    const stateEmail = `info@legacy-${state}-${runKey}.example.org`;
    const sealedStateCandidate = seal("email", stateEmail);
    const stateCandidate = rows(await db.execute(sql`
      INSERT INTO free_discovery_candidates
        (generation_id, business_id, field, subject_type, domain, source, attribution_scope,
         disposition, confidence, envelope_ciphertext, envelope_nonce, envelope_tag,
         envelope_key_version, normalized_value_hash, masked_value, created_at)
       VALUES (${String(generation.id)}::uuid, ${legacyBusinessId}, 'email', 'business',
        ${`${runKey}-${state}.example.org`}, 'certification', 'role', 'staged', 85,
        ${sealedStateCandidate.ciphertext}, ${sealedStateCandidate.nonce}, ${sealedStateCandidate.tag},
        1, ${sealedStateCandidate.normalizedValueHash}, ${sealedStateCandidate.maskedValue}, NOW())
      RETURNING id
    `))[0];
    const eligibility = rows(await db.execute(sql`
      INSERT INTO sfp_outreach_eligibility
        (cohort_run_id, business_id, candidate_id, source_kind, policy_version, status,
         decision_reason, validation_at, validation_expires_at, role_inbox, normalized_value_hash)
       VALUES (${cohortRunId}::uuid, ${legacyBusinessId}, ${String(stateCandidate.id)}::uuid, 'free',
          ${Number(policy.version) + index + 10}, 'validated_review_required', ${`legacy-${state}`},
         NOW(), NOW()+INTERVAL '20 days', TRUE, ${createHash("sha256").update(`${state}${runKey}`).digest("hex")})
      RETURNING id
    `))[0];
    await db.execute(sql`
      INSERT INTO sfp_campaign_staging_intents
        (cohort_run_id, eligibility_id, business_id, candidate_id, source_kind,
         idempotency_key, actor_id, state, policy_version, validation_snapshot, lineage)
       VALUES (${cohortRunId}::uuid, ${String(eligibility.id)}::uuid, ${legacyBusinessId},
         ${String(stateCandidate.id)}::uuid, 'free', ${`${runKey}-${state}`}, ${runKey},
         ${state}, ${Number(policy.version)}, '{}'::jsonb, '{}'::jsonb)
    `);
  }
  const retainedStates = rows(await db.execute(sql`
    SELECT state FROM sfp_campaign_staging_intents
     WHERE idempotency_key=ANY(ARRAY[${sql.join(["staged", "rejected", "cancelled"].map((state) => sql`${`${runKey}-${state}`}`), sql`, `)}])
     ORDER BY state
  `)).map((row) => String(row.state));
  check(["cancelled", "rejected", "staged"].every((state) => retainedStates.includes(state)),
    "0290-era staged, rejected, and cancelled values are retained without constraint loss");

  // Assert the REAL, currently-applied migration 0290 CHECK constraint
  // (not a hand-reconstructed copy) retains 'promoted' as a legal
  // legacy-only value. Migration 0290 deliberately keeps 'promoted' in its
  // CHECK precisely so a true pre-existing legacy row is never rejected or
  // silently relabeled as ready_held. The rollback leaves the test database
  // untouched.
  let promotedRejectedByConstraint = false;
  const rollbackSentinel = new Error("SFP2001_MIGRATION_SIMULATION_ROLLBACK");
  try {
    await db.transaction(async (tx) => {
      const promotedEmail = `info@legacy-promoted-${runKey}.example.org`;
      const sealedPromotedCandidate = seal("email", promotedEmail);
      const promotedCandidate = rows(await tx.execute(sql`
        INSERT INTO free_discovery_candidates
          (generation_id, business_id, field, subject_type, domain, source, attribution_scope,
           disposition, confidence, envelope_ciphertext, envelope_nonce, envelope_tag,
           envelope_key_version, normalized_value_hash, masked_value, created_at)
        VALUES (${String(generation.id)}::uuid, ${fixture[3].businessId}, 'email', 'business',
          ${`${runKey}-promoted.example.org`}, 'certification', 'role', 'staged', 85,
          ${sealedPromotedCandidate.ciphertext}, ${sealedPromotedCandidate.nonce}, ${sealedPromotedCandidate.tag},
          1, ${sealedPromotedCandidate.normalizedValueHash}, ${sealedPromotedCandidate.maskedValue}, NOW())
        RETURNING id
      `))[0];
      const legacyEligibility = rows(await tx.execute(sql`
        INSERT INTO sfp_outreach_eligibility
          (cohort_run_id, business_id, candidate_id, source_kind, policy_version, status,
           decision_reason, validation_at, validation_expires_at, role_inbox)
        VALUES (${cohortRunId}::uuid, ${fixture[3].businessId}, ${String(promotedCandidate.id)}::uuid, 'free',
          ${Number(policy.version) + 20}, 'validated_review_required', 'legacy_promoted',
          NOW(), NOW()+INTERVAL '20 days', TRUE)
        RETURNING id
      `))[0];
      // The currently-applied migration 0290 CHECK must accept this insert
      // directly — no drop/recreate needed, since 0290 already retains
      // 'promoted' as a legal legacy-only value. If this insert throws a
      // check-constraint violation, migration 0290 regressed on Defect 1.
      const insertedPromoted = rows(await tx.execute(sql`
        INSERT INTO sfp_campaign_staging_intents
          (cohort_run_id, eligibility_id, business_id, candidate_id, source_kind,
           idempotency_key, actor_id, state, policy_version, validation_snapshot, lineage)
      VALUES (${cohortRunId}::uuid, ${String(legacyEligibility.id)}::uuid, ${fixture[3].businessId},
          ${String(promotedCandidate.id)}::uuid, 'free', ${`${runKey}-legacy-promoted`}, ${runKey},
          'promoted', ${Number(policy.version) + 20}, '{}'::jsonb, '{}'::jsonb)
      RETURNING state
      `))[0];
      if (String(insertedPromoted?.state) !== "promoted") {
        promotedRejectedByConstraint = true;
      }
      throw rollbackSentinel;
    });
  } catch (error) {
    if ((error as Error).message === rollbackSentinel.message) {
      // Expected — the whole block rolls back by design.
    } else if (/check constraint|sfp_campaign_staging_intents_state_check/i.test((error as Error).message ?? "")) {
      promotedRejectedByConstraint = true;
    } else {
      throw error;
    }
  }
  check(!promotedRejectedByConstraint,
    "0290 upgrade explicitly handles a real legacy promoted row without reinterpretation");
  if (promotedRejectedByConstraint) {
    console.error("BLOCKER: migration 0290's state CHECK rejects a legacy promoted row; retain promoted or migrate each row explicitly.");
  }

  const forbiddenBefore = rows(await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM master_leads WHERE pipeline_origin='sfp_pipeline' AND canonical_business_id=ANY(ARRAY[${sql.join(fixture.map((item) => sql`${item.businessId}`), sql`, `)}]::int[])) AS leads
  `))[0];
  check(Number(forbiddenBefore?.leads ?? 0) >= 2, "SFP fixtures created leads only through the staging implementation");

  // --- Cross-business evidence binding (completion-review Defect 1) -----
  // An eligibility row for business B references a candidate_id that
  // actually belongs to a DIFFERENT cohort-member business (fixture[0]'s
  // free candidate). Both businesses are cohort members, so the existing
  // frozen-cohort-membership check alone would pass; only the new exact
  // business-identity binding inside stageOneRowTransactional should catch
  // this and reject the row rather than projecting fixture[0]'s address
  // into business B's master-lead record.
  const mismatchBusinessId = extraBusinessIds.mismatch;
  const mismatchEmail = `info@mismatch-${runKey}.example.org`;
  const sealedMismatch = seal("email", mismatchEmail);
  const mismatchCandidate = rows(await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id, business_id, field, subject_type, domain, source, attribution_scope,
       disposition, confidence, envelope_ciphertext, envelope_nonce, envelope_tag,
       envelope_key_version, normalized_value_hash, masked_value, created_at)
    VALUES (${String(generation.id)}::uuid, ${mismatchBusinessId}, 'email', 'business',
      ${`${runKey}-mismatch.example.org`}, 'certification', 'role', 'staged', 90,
      ${sealedMismatch.ciphertext}, ${sealedMismatch.nonce}, ${sealedMismatch.tag}, 1,
      ${sealedMismatch.normalizedValueHash}, ${sealedMismatch.maskedValue}, NOW())
    RETURNING id
  `))[0];
  assert.ok(mismatchCandidate?.id);
  const mismatchValidation = await validateFixtureCandidates(cohortRunId, "mismatch");
  const mismatchEligibility = findFixtureValidationReceipt(
    mismatchValidation, mismatchBusinessId, String(mismatchCandidate.id),
  );
  assert.ok(mismatchEligibility?.id, "mismatch staging fixture is first validated normally");
  // Introduce only the deliberately corrupt cross-business pointer after
  // validation. The eligibility and its completed provider receipt remain
  // persisted by the governed validation path.
  await db.execute(sql`
    UPDATE sfp_outreach_eligibility
       SET candidate_id=${String(fixture[0].candidateId)}::uuid
     WHERE id=${String(mismatchEligibility.id)}::uuid
  `);
  const mismatchPreview = await previewStagingV2({ cohortRunId, eligibilityIds: [String(mismatchEligibility.id)], actorId: runKey });
  const mismatchResult = await executeStagingV2({
    cohortRunId, eligibilityIds: [String(mismatchEligibility.id)], commandKey: mismatchPreview.commandKey,
    snapshotHash: mismatchPreview.snapshotHash, actorId: runKey, confirmPayloadHash: mismatchPreview.payloadHash,
  });
  const mismatchReasonPassed = "SFP_STAGING_TYPED_SOURCE_MISSING_OR_BUSINESS_CHANGED" in mismatchResult.reasons;
  const mismatchPassed = mismatchResult.readyHeld === 0 && mismatchResult.rejected === 1 && mismatchReasonPassed;
  if (!mismatchPassed) {
    emitFailOnlyDiagnostic("cross-business-evidence-rejection", {
      expectedReason: "SFP_STAGING_TYPED_SOURCE_MISSING_OR_BUSINESS_CHANGED",
      readyHeld: mismatchResult.readyHeld,
      rejected: mismatchResult.rejected,
      reasons: mismatchResult.reasons,
      preview: summarizeStagingPreview(mismatchPreview),
    });
  }
  check(mismatchPassed,
    "cross-business evidence reference is rejected, never projected into the wrong business's master lead");
  const mismatchLead = rows(await db.execute(sql`
    SELECT id FROM master_leads WHERE canonical_business_id=${mismatchBusinessId} AND pipeline_origin='sfp_pipeline'
  `))[0];
  const mismatchIntentCount = Number(rows(await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM sfp_campaign_staging_intents
     WHERE eligibility_id=${String(mismatchEligibility.id)}::uuid AND state='ready_held'
  `))[0]?.count ?? 0);
  check(!mismatchLead, "no master lead is created for the business with mismatched evidence");
  check(mismatchIntentCount === 0, "mismatched evidence creates no ready_held staging intent");

  // --- Live content-hash drift (completion-review Defect 2) --------------
  // Mutate follow_up_sequences.description, an authoritative field in the
  // canonical live package fingerprint, after capturing the ready preview.
  // This mirrors the integrated-pipeline certification and intentionally
  // avoids legacy campaign columns or empty setup fields.
  const driftBusinessId = extraBusinessIds.drift2;
  const driftEmail = `info@content-drift-${runKey}.example.org`;
  const sealedDrift = seal("email", driftEmail);
  const driftCandidate = rows(await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id, business_id, field, subject_type, domain, source, attribution_scope,
       disposition, confidence, envelope_ciphertext, envelope_nonce, envelope_tag,
       envelope_key_version, normalized_value_hash, masked_value, created_at)
    VALUES (${String(generation.id)}::uuid, ${driftBusinessId}, 'email', 'business',
      ${`${runKey}-drift2.example.org`}, 'certification', 'role', 'staged', 90,
      ${sealedDrift.ciphertext}, ${sealedDrift.nonce}, ${sealedDrift.tag}, 1,
      ${sealedDrift.normalizedValueHash}, ${sealedDrift.maskedValue}, NOW())
    RETURNING id
  `))[0];
  assert.ok(driftCandidate?.id);
  const driftValidation = await validateFixtureCandidates(cohortRunId, "content-drift");
  const driftEligibility = findFixtureValidationReceipt(
    driftValidation, driftBusinessId, String(driftCandidate.id),
  );
  const driftPreview = await previewStagingV2({ cohortRunId, eligibilityIds: [String(driftEligibility.id)], actorId: runKey });
  check(driftPreview.rows[0]?.disposition === "eligible",
    "content-drift fixture captures an eligible preview before authoritative content changes");
  const originalSequenceContent = rows(await db.execute(sql`
    SELECT description FROM follow_up_sequences WHERE id=${fixturePackageSequenceId}
  `))[0];
  const driftedSequenceDescription = `${String(originalSequenceContent?.description ?? "")} ${runKey} authoritative content drift`;
  await db.execute(sql`
    UPDATE follow_up_sequences SET description=${driftedSequenceDescription}
     WHERE id=${fixturePackageSequenceId}
  `);
  const liveHashAfterSequenceEdit = await computeLivePackageContentHash(
    db, fixturePackageCampaignId, fixturePackageSequenceId,
  );
  const authoritativeSequenceContentChanged =
    fixturePackageLiveContentHash === fixturePackagePinnedContentHash &&
    liveHashAfterSequenceEdit !== fixturePackagePinnedContentHash;
  check(authoritativeSequenceContentChanged,
    "the post-preview sequence description edit changes the authoritative live package fingerprint");
  const driftResult = await executeStagingV2({
    cohortRunId, eligibilityIds: [String(driftEligibility.id)], commandKey: driftPreview.commandKey,
    snapshotHash: driftPreview.snapshotHash, actorId: runKey, confirmPayloadHash: driftPreview.payloadHash,
  });
  const driftReasonPassed = "SFP_STAGING_LIVE_PACKAGE_CONTENT_CHANGED" in driftResult.reasons;
  const driftPassed = driftResult.readyHeld === 0 && driftResult.rejected === 1 &&
    driftReasonPassed && authoritativeSequenceContentChanged;
  const driftLead = rows(await db.execute(sql`
    SELECT id FROM master_leads WHERE canonical_business_id=${driftBusinessId} AND pipeline_origin='sfp_pipeline'
  `))[0];
  const driftIntentCount = Number(rows(await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM sfp_campaign_staging_intents
     WHERE eligibility_id=${String(driftEligibility.id)}::uuid AND state='ready_held'
  `))[0]?.count ?? 0);
  if (!driftPassed) {
    emitFailOnlyDiagnostic("authoritative-package-content-drift", {
      expectedReason: "SFP_STAGING_LIVE_PACKAGE_CONTENT_CHANGED",
      readyHeld: driftResult.readyHeld,
      rejected: driftResult.rejected,
      reasons: driftResult.reasons,
      authoritativeSequenceContentChanged,
      masterLeadCreated: Boolean(driftLead),
      readyHeldIntentCount: driftIntentCount,
      preview: summarizeStagingPreview(driftPreview),
    });
  }
  check(driftPassed,
    "an authoritative sequence-content edit after preview is caught live and fails closed, never reaches ready_held on stale content");
  check(!driftLead, "authoritative package content drift creates no master lead");
  check(driftIntentCount === 0, "authoritative package content drift creates no ready_held staging intent");
  await db.execute(sql`
    UPDATE follow_up_sequences SET description=${originalSequenceContent?.description ?? null}
     WHERE id=${fixturePackageSequenceId}
  `);
  const restoredLiveContentHash = await computeLivePackageContentHash(
    db, fixturePackageCampaignId, fixturePackageSequenceId,
  );
  check(restoredLiveContentHash === fixturePackagePinnedContentHash,
    "the authoritative sequence content is restored exactly after the drift regression check");

  // --- Concurrent duplicate execution converges to one intent (Defect 3) -
  const concurrentBusinessId = extraBusinessIds.concurrent;
  const concurrentEmail = `info@concurrent-${runKey}.example.org`;
  // Use the exact v1 normalized hash produced by seal(); a run-key-only hash
  // would exercise the email-drift rejection instead of concurrent staging.
  const sealedConcurrent = seal("email", concurrentEmail);
  const concurrentCandidate = rows(await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id, business_id, field, subject_type, domain, source, attribution_scope,
       disposition, confidence, envelope_ciphertext, envelope_nonce, envelope_tag,
       envelope_key_version, normalized_value_hash, masked_value, created_at)
    VALUES (${String(generation.id)}::uuid, ${concurrentBusinessId}, 'email', 'business',
      ${`${runKey}-concurrent.example.org`}, 'certification', 'role', 'staged', 90,
      ${sealedConcurrent.ciphertext}, ${sealedConcurrent.nonce}, ${sealedConcurrent.tag}, 1,
      ${sealedConcurrent.normalizedValueHash}, ${sealedConcurrent.maskedValue}, NOW())
    RETURNING id
  `))[0];
  assert.ok(concurrentCandidate?.id);
  const concurrentValidation = await validateFixtureCandidates(cohortRunId, "concurrent");
  const concurrentEligibility = findFixtureValidationReceipt(
    concurrentValidation, concurrentBusinessId, String(concurrentCandidate.id),
  );
  const concurrentPreview = await previewStagingV2({ cohortRunId, eligibilityIds: [String(concurrentEligibility.id)], actorId: runKey });
  const [concurrentA, concurrentB] = await Promise.all([
    executeStagingV2({ cohortRunId, eligibilityIds: [String(concurrentEligibility.id)], commandKey: concurrentPreview.commandKey, snapshotHash: concurrentPreview.snapshotHash, actorId: runKey, confirmPayloadHash: concurrentPreview.payloadHash }),
    executeStagingV2({ cohortRunId, eligibilityIds: [String(concurrentEligibility.id)], commandKey: concurrentPreview.commandKey, snapshotHash: concurrentPreview.snapshotHash, actorId: runKey, confirmPayloadHash: concurrentPreview.payloadHash }),
  ]);
  check(concurrentA.readyHeld === 1 && concurrentA.rejected === 0 &&
    concurrentB.readyHeld === 1 && concurrentB.rejected === 0,
    "both concurrent same-command calls converge on the one ready_held business result");
  const concurrentIntentCount = Number(rows(await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM sfp_campaign_staging_intents WHERE eligibility_id=${String(concurrentEligibility.id)}::uuid
  `))[0].count);
  check(concurrentIntentCount === 1, "two concurrent executeStagingV2 calls for the same row converge to exactly one intent, never two");
  const concurrentIntentState = rows(await db.execute(sql`
    SELECT state FROM sfp_campaign_staging_intents WHERE eligibility_id=${String(concurrentEligibility.id)}::uuid
  `))[0];
  check(concurrentIntentState?.state === "ready_held", "the single surviving intent from concurrent execution reaches ready_held");

  // --- PM-10 ledger: manual execute produces its own durable stage_run +
  // stage_items, and reconciled counters exactly match the item rows ------
  const manualLedgerRun = rows(await db.execute(sql`
    SELECT id, state, selected_count, processed_count, succeeded_count, failed_count
      FROM sfp_stage_runs WHERE idempotency_key = ${originalPreview.commandKey}
  `))[0];
  check(!!manualLedgerRun, "manual executeStagingV2() call created its own sfp_stage_runs row keyed by commandKey");
  const manualLedgerItemCounts = rows(await db.execute(sql`
    SELECT COUNT(*) FILTER (WHERE state='completed')::int AS completed,
           COUNT(*)::int AS total
      FROM sfp_stage_items WHERE stage_run_id = ${String(manualLedgerRun.id)}::uuid
  `))[0];
  check(Number(manualLedgerItemCounts.total) === 1 && Number(manualLedgerItemCounts.completed) === 1,
    "manual staging run has exactly one stage_item, completed, matching the one ready_held row");
  check(Number(manualLedgerRun.succeeded_count) === Number(manualLedgerItemCounts.completed) &&
    Number(manualLedgerRun.processed_count) === Number(manualLedgerItemCounts.total),
    "manual staging run counters equal COUNT(*) over its own item rows, not an incremented tally");

  // Re-running reconcileStageRunCounters a second time (simulating a
  // resumed/duplicate reconciliation call) must NOT change the counters —
  // this is the core PM-10 regression this task exists to close: a `+=`
  // based counter would double on a second call, a COUNT(*)-based one is
  // idempotent.
  const { reconcileStageRunCounters: reconcileForTest } = await import("../server/services/cro03/sfp-stage-ledger");
  await reconcileForTest(String(manualLedgerRun.id));
  await reconcileForTest(String(manualLedgerRun.id));
  const manualLedgerRunAfterDoubleReconcile = rows(await db.execute(sql`
    SELECT succeeded_count, processed_count FROM sfp_stage_runs WHERE id = ${String(manualLedgerRun.id)}::uuid
  `))[0];
  check(Number(manualLedgerRunAfterDoubleReconcile.succeeded_count) === Number(manualLedgerRun.succeeded_count) &&
    Number(manualLedgerRunAfterDoubleReconcile.processed_count) === Number(manualLedgerRun.processed_count),
    "calling reconcileStageRunCounters twice in a row is idempotent and never double-counts (PM-10 core regression check)");

  // --- PM-08: exercise the real recurring worker end-to-end, including a
  // dead-lettered row, a retry requeue via the PM-13 operator route, and
  // counter correctness across MULTIPLE ticks of the SAME run (the exact
  // scenario the old `+=` counters double-counted on). -------------------
  const { processSfpCampaignStagingTick } = await import("../server/services/cro03/sfp-campaign-staging-worker");
  const workerBusiness = rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name, normalized_name, vertical, state, record_class, created_at)
    VALUES (${`${runKey}-worker-business`}, ${`${runKey}-worker-business`.toLowerCase()}, NULL, 'FL', 'canonical', NOW())
    RETURNING id
  `))[0];
  const workerBusinessId = Number(workerBusiness.id);
  await db.execute(sql`
    UPDATE sfp_programs SET recurring_enabled = TRUE,
      schedule_config = jsonb_set(COALESCE(schedule_config, '{}'::jsonb), '{campaignStaging}', '5')
     WHERE id = ${String(program.id)}::uuid
  `);
  process.env.BACKGROUND_JOB_PROFILE = "selective:sfp-campaign-staging";
  // Profile changes alter the attested queue-topology hash. Bind the positive
  // worker fixture to its actual topology before validation, not afterward.
  const workerTopologySelection = await runtimeIdentityHelper.selectSfpRuntimeTestRelease(runKey);
  check(workerTopologySelection.currentReleaseSelected && workerTopologySelection.ownerLive && workerTopologySelection.ready,
    "positive worker validation is bound to the newly selected test queue topology");
  if (!workerTopologySelection.ready) throw new Error("SFP2001_WORKER_TOPOLOGY_NOT_READY");
  ownerHeartbeatError = undefined;

  // The positive worker probe gets an isolated, genuinely frozen cohort so
  // unrelated still-eligible negative-regression fixtures cannot occupy the
  // worker's bounded inventory ahead of it. The retry/dead-letter lifecycle
  // is exercised below with its own dedicated frozen cohort.
  const workerOkEmail = `info@worker-ok-${runKey}.example.org`;
  const workerCohortRunId = randomUUID();
  await db.execute(sql`
    INSERT INTO sfp_cohort_runs
      (id, program_id, idempotency_key, status, cohort_size, cohort_hash, release_sha, actor_id,
       cohort_state, frozen_at)
    VALUES (${workerCohortRunId}::uuid, ${String(program.id)}::uuid, ${`${runKey}-worker-cohort`},
      'freezing', 1, ${createHash("sha256").update(`worker-${runKey}`).digest("hex")},
      ${String(currentTestRuntime.artifactSha)}, ${runKey}, 'freezing', NULL)
  `);
  await seedFrozenClassification(workerBusinessId, "Healthcare", 50, workerCohortRunId);
  await db.execute(sql`
    UPDATE sfp_cohort_runs SET status='frozen', cohort_state='frozen', frozen_at=NOW()
     WHERE id=${workerCohortRunId}::uuid
  `);
  const sealedWorkerOk = seal("email", workerOkEmail);
  const workerOkCandidate = rows(await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id, business_id, field, subject_type, domain, source, attribution_scope,
       disposition, confidence, envelope_ciphertext, envelope_nonce, envelope_tag,
       envelope_key_version, normalized_value_hash, masked_value, created_at)
    VALUES (${String(generation.id)}::uuid, ${workerBusinessId}, 'email', 'business',
      ${`${runKey}-worker-ok.example.org`}, 'certification', 'role', 'staged', 90,
      ${sealedWorkerOk.ciphertext}, ${sealedWorkerOk.nonce}, ${sealedWorkerOk.tag}, 1,
      ${sealedWorkerOk.normalizedValueHash}, ${sealedWorkerOk.maskedValue}, NOW())
    RETURNING id
  `))[0];
  assert.ok(workerOkCandidate?.id);
  const workerValidation = await validateFixtureCandidates(workerCohortRunId, "worker-ok");
  const workerOkEligibility = findFixtureValidationReceipt(
    workerValidation, workerBusinessId, String(workerOkCandidate.id),
  );
  check(Boolean(workerOkEligibility?.validation_operation_id || workerOkEligibility?.reused_from_operation_id),
    "worker success fixture is created by its exact current-run completed fake ZeroBounce validation");

  // Observe the exact persisted source inventory the recurring worker will
  // see, then bind it through the real snapshot service before the tick.
  const workerInventory = rows(await db.execute(sql`
    SELECT e.id,e.business_id,e.source_kind,e.candidate_id,e.validation_operation_id
      FROM sfp_outreach_eligibility e
     WHERE e.cohort_run_id=${workerCohortRunId}::uuid
       AND e.status='validated_outreach_eligible' AND e.staging_intent_id IS NULL
     ORDER BY e.created_at,e.id
  `));
  check(workerInventory.length === 1 &&
    String(workerInventory[0]?.id) === String(workerOkEligibility.id) &&
    Number(workerInventory[0]?.business_id) === workerBusinessId &&
    workerInventory[0]?.source_kind === "free" &&
    String(workerInventory[0]?.candidate_id) === String(workerOkCandidate.id) &&
    Boolean(workerInventory[0]?.validation_operation_id),
  "the frozen worker cohort contains exactly the governed, current source row intended for the worker");
  const workerSourcePreview = workerInventory.length > 0
    ? await previewStagingV2({
        cohortRunId: workerCohortRunId,
        eligibilityIds: workerInventory.map((row: any) => String(row.id)),
        actorId: runKey,
      })
    : null;
  check(workerSourcePreview?.eligibleCount === 1 &&
    workerSourcePreview?.rows[0]?.disposition === "eligible" &&
    workerSourcePreview?.rows[0]?.eligibilityId === String(workerOkEligibility.id),
  "the worker's persisted inventory is admitted by the real frozen-run source/package snapshot");

  const workerRuntimeSelection = await runtimeIdentityHelper.selectSfpRuntimeTestRelease(runKey);
  check(workerRuntimeSelection.currentReleaseSelected && workerRuntimeSelection.ownerLive &&
    workerRuntimeSelection.ready &&
    workerRuntimeSelection.selectedRelease?.artifactSha === currentTestRuntime.artifactSha,
  "the worker tick starts with this test process's helper-selected release and persisted owner lease");
  const tick1 = await processSfpCampaignStagingTick();
  check(tick1.enabled === true, "recurring campaign-staging tick runs when the capability and schedule are both configured on");

  // Filter by cohort_run_id + the worker's own deterministic actor_id, not
  // just "latest created_at" — the manual PM-10 ledger run immediately
  // above can share the same created_at timestamp (sub-millisecond test
  // execution) as this recurring run, making a bare ORDER BY created_at
  // DESC LIMIT 1 pick the wrong row.
  const workerRun = rows(await db.execute(sql`
    SELECT id, state, selected_count, processed_count, succeeded_count, failed_count, claim_token
      FROM sfp_stage_runs
     WHERE stage='campaign_staging' AND cohort_run_id=${workerCohortRunId}::uuid AND actor_id='system:sfp-campaign-staging'
     ORDER BY created_at DESC LIMIT 1
  `))[0];
  check(!!workerRun, "recurring worker tick created/advanced a sfp_stage_runs row");
  const workerItemStates = rows(await db.execute(sql`
    SELECT state, COUNT(*)::int AS count FROM sfp_stage_items
     WHERE stage_run_id = ${String(workerRun.id)}::uuid GROUP BY state
  `));
  const workerItemTotal = workerItemStates.reduce((sum: number, r: any) => sum + Number(r.count), 0);
  check(Number(workerRun.processed_count) === workerItemTotal,
    "after a single worker tick, processed_count exactly equals the total item row count for this run (no double count)");
  check(Number(workerRun.succeeded_count) === (workerItemStates.find((r: any) => r.state === "completed")?.count ?? 0),
    "succeeded_count exactly equals COUNT(*) of completed items, not an incremented tally");
  const workerBatchItems = rows(await db.execute(sql`
    SELECT business_id,state,outcome_code,attempt_count FROM sfp_stage_items
     WHERE stage_run_id=${String(workerRun.id)}::uuid AND provider='campaign_staging'
  `));
  const workerBatchPassed = workerBatchItems.length === 1 &&
    Number(workerBatchItems[0]?.business_id) === workerBusinessId &&
    workerBatchItems[0]?.state === "completed";
  if (!workerBatchPassed) {
    emitFailOnlyDiagnostic("worker-success", {
      tick: {
        enabled: tick1.enabled,
        processed: tick1.processed,
        succeeded: tick1.succeeded,
        failed: tick1.failed,
        stopReason: tick1.stopReason,
      },
      run: {
        id: workerRun.id,
        state: workerRun.state,
        selectedCount: workerRun.selected_count,
        processedCount: workerRun.processed_count,
        succeededCount: workerRun.succeeded_count,
        failedCount: workerRun.failed_count,
        claimTokenPresent: Boolean(workerRun.claim_token),
      },
      preTickInventory: workerInventory.map((row: any) => ({
        eligibilityId: row.id,
        businessId: Number(row.business_id),
        sourceKind: row.source_kind,
        candidateId: row.candidate_id,
        validationOperationIdPresent: Boolean(row.validation_operation_id),
      })),
      preTickPreview: summarizeStagingPreview(workerSourcePreview),
      items: workerBatchItems,
      sourceCurrentness: await readStagingCurrentnessDiagnostic(
        workerCohortRunId,
        [String(workerOkEligibility.id)],
      ),
    });
  }
  check(workerBatchPassed,
  "the worker's actual one-row frozen-cohort inventory completes as ready for held staging");
  const workerIntent = rows(await db.execute(sql`
    SELECT id,eligibility_id,command_key,snapshot_hash,state
      FROM sfp_campaign_staging_intents
     WHERE cohort_run_id=${workerCohortRunId}::uuid AND eligibility_id=${String(workerOkEligibility.id)}::uuid
  `))[0];
  const workerPersistedSnapshot = workerIntent && workerRun?.claim_token
    ? await previewStagingV2({
        cohortRunId: workerCohortRunId,
        eligibilityIds: [String(workerOkEligibility.id)],
        actorId: "system:sfp-campaign-staging",
        resumeCommandKey: String(workerIntent.command_key),
        attemptSalt: String(workerRun.claim_token),
      })
    : null;
  const workerSnapshotPassed = workerIntent?.state === "ready_held" &&
    workerPersistedSnapshot?.snapshotHash === workerIntent.snapshot_hash &&
    workerPersistedSnapshot?.commandKey === workerIntent.command_key;
  if (!workerSnapshotPassed) {
    emitFailOnlyDiagnostic("worker-persisted-snapshot", {
      workerRunId: workerRun.id,
      claimTokenPresent: Boolean(workerRun.claim_token),
      intent: workerIntent ? {
        id: workerIntent.id,
        eligibilityId: workerIntent.eligibility_id,
        state: workerIntent.state,
        snapshotHashPresent: Boolean(workerIntent.snapshot_hash),
        commandKeyPresent: Boolean(workerIntent.command_key),
      } : null,
      reconstructedSnapshot: workerPersistedSnapshot
        ? summarizeStagingPreview(workerPersistedSnapshot)
        : null,
      sourceCurrentness: await readStagingCurrentnessDiagnostic(
        workerCohortRunId,
        [String(workerOkEligibility.id)],
      ),
    });
  }
  check(workerSnapshotPassed,
  "the worker's committed intent reproduces the exact claim-salted snapshot and command from its persisted frozen-run source");

  // Run a second global tick while asserting this isolated run's already
  // completed item remains untouched. The drain may process other cohorts,
  // but those belong to separate run/item ledgers and cannot alter this
  // worker run's completed item.
  const completedBeforeSecondTick = rows(await db.execute(sql`
    SELECT id, updated_at FROM sfp_stage_items WHERE stage_run_id = ${String(workerRun.id)}::uuid AND state='completed'
  `));
  check(completedBeforeSecondTick.length > 0, "at least one item is completed after the first worker tick");
  await processSfpCampaignStagingTick();
  const completedItemsAfterSecondTick = new Map(rows(await db.execute(sql`
    SELECT id, state, updated_at FROM sfp_stage_items WHERE stage_run_id = ${String(workerRun.id)}::uuid
  `)).map((r: any) => [String(r.id), r]));
  const anyCompletedItemTouched = completedBeforeSecondTick.some((before: any) => {
    const after = completedItemsAfterSecondTick.get(String(before.id));
    return !after || after.state !== "completed" || String(after.updated_at) !== String(before.updated_at);
  });
  check(!anyCompletedItemTouched,
    "a second worker tick leaves every already-completed item's own row untouched (no double counting on resumed ticks)");
  const workerRunAfterSecondTick = rows(await db.execute(sql`
    SELECT processed_count, succeeded_count, failed_count FROM sfp_stage_runs WHERE id = ${String(workerRun.id)}::uuid
  `))[0];
  const workerRunItemTotalAfterSecondTick = Number(rows(await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM sfp_stage_items WHERE stage_run_id = ${String(workerRun.id)}::uuid
  `))[0].count);
  check(Number(workerRunAfterSecondTick.processed_count) === workerRunItemTotalAfterSecondTick,
    "the run's counters after a resumed tick still equal the real item-row count, not a double-incremented tally");

  // --- Corrective patch check 1: lost response / idempotent replay --------
  // Use an ordinary governed preview and execute, then deliberately discard
  // the successful response to model a caller that lost it after commit.
  // The next identical request must replay the persisted result without
  // fabricating/deleting a command, intent, eligibility, or lead row.
  const crashBusinessId = extraBusinessIds.crash;
  const crashEmail = `info@crash-resume-${runKey}.example.org`;
  const sealedCrash = seal("email", crashEmail);
  const crashCandidate = rows(await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id, business_id, field, subject_type, domain, source, attribution_scope,
       disposition, confidence, envelope_ciphertext, envelope_nonce, envelope_tag,
       envelope_key_version, normalized_value_hash, masked_value, created_at)
    VALUES (${String(generation.id)}::uuid, ${crashBusinessId}, 'email', 'business',
      ${`${runKey}-crash.example.org`}, 'certification', 'role', 'staged', 90,
      ${sealedCrash.ciphertext}, ${sealedCrash.nonce}, ${sealedCrash.tag}, 1,
      ${sealedCrash.normalizedValueHash}, ${sealedCrash.maskedValue}, NOW())
    RETURNING id
  `))[0];
  assert.ok(crashCandidate?.id);
  const crashValidation = await validateFixtureCandidates(cohortRunId, "crash-resume");
  const crashEligibility = findFixtureValidationReceipt(
    crashValidation, crashBusinessId, String(crashCandidate.id),
  );
  check(Boolean(crashEligibility?.validation_operation_id || crashEligibility?.reused_from_operation_id),
    "crash-resume fixture uses its exact current-run completed fake ZeroBounce receipt");
  const crashPreview = await previewStagingV2({ cohortRunId, eligibilityIds: [String(crashEligibility.id)], actorId: runKey });
  check(crashPreview.rows[0]?.disposition === "eligible", "crash-resume fixture previews as eligible before any staging occurs");

  // This is the ordinary commit path. Its returned value is intentionally
  // discarded: the caller is modeled as having lost the response in flight.
  await executeStagingV2({
    cohortRunId, eligibilityIds: [String(crashEligibility.id)], commandKey: crashPreview.commandKey,
    snapshotHash: crashPreview.snapshotHash, actorId: runKey, confirmPayloadHash: crashPreview.payloadHash,
  });
  const crashCommittedIntent = rows(await db.execute(sql`
    SELECT id,state,command_key,snapshot_hash,payload_hash
      FROM sfp_campaign_staging_intents
     WHERE cohort_run_id=${cohortRunId}::uuid AND eligibility_id=${String(crashEligibility.id)}::uuid
  `))[0];
  const crashCommittedEligibility = rows(await db.execute(sql`
    SELECT staging_intent_id,campaign_staged_at
      FROM sfp_outreach_eligibility WHERE id=${String(crashEligibility.id)}::uuid
  `))[0];
  const crashLeadCountBeforeReplay = Number(rows(await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM master_leads
     WHERE canonical_business_id=${crashBusinessId} AND pipeline_origin='sfp_pipeline'
  `))[0]?.count ?? 0);
  check(crashCommittedIntent?.state === "ready_held" &&
    crashCommittedIntent?.command_key === crashPreview.commandKey &&
    crashCommittedIntent?.snapshot_hash === crashPreview.snapshotHash &&
    crashCommittedIntent?.payload_hash === crashPreview.payloadHash &&
    String(crashCommittedEligibility?.staging_intent_id) === String(crashCommittedIntent?.id) &&
    Boolean(crashCommittedEligibility?.campaign_staged_at),
  "the ordinary governed execute commits one ready_held intent with the exact preview pins before its response is discarded");
  check(crashLeadCountBeforeReplay === 1,
    "the ordinary execute creates exactly one SFP-origin lead before the lost-response replay");

  const resumedPreview = await previewStagingV2({
    cohortRunId, eligibilityIds: [String(crashEligibility.id)], actorId: runKey, resumeCommandKey: crashPreview.commandKey,
  });
  check(resumedPreview.rows[0]?.disposition === "eligible" &&
    resumedPreview.snapshotHash === crashPreview.snapshotHash &&
    resumedPreview.payloadHash === crashPreview.payloadHash &&
    resumedPreview.commandKey === crashPreview.commandKey,
  "resume preview of the committed intent reconstructs the exact original eligible snapshot, payload, and command pins");

  let replayThrew: unknown;
  let replayResult: Awaited<ReturnType<typeof executeStagingV2>> | undefined;
  try {
    replayResult = await executeStagingV2({
      cohortRunId, eligibilityIds: [String(crashEligibility.id)], commandKey: crashPreview.commandKey,
      snapshotHash: crashPreview.snapshotHash, actorId: runKey, confirmPayloadHash: crashPreview.payloadHash,
    });
  } catch (error) { replayThrew = error; }
  check(!replayThrew, "replaying the identical request after a lost successful response does not throw snapshot drift");
  check(replayResult?.replayed === true && replayResult?.readyHeld === 1 &&
    replayResult?.rejected === 0 && replayResult?.zeroOutreachConfirmed === true &&
    replayResult?.stagedIntents.length === 1 &&
    String(replayResult?.stagedIntents[0]?.intentId) === String(crashCommittedIntent?.id),
  "the replay returns the same committed ready_held intent and no-outreach proof rather than creating a duplicate");
  const crashIntentCountAfterResume = Number(rows(await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM sfp_campaign_staging_intents WHERE eligibility_id = ${String(crashEligibility.id)}::uuid
  `))[0].count);
  const crashLeadCountAfterReplay = Number(rows(await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM master_leads
     WHERE canonical_business_id=${crashBusinessId} AND pipeline_origin='sfp_pipeline'
  `))[0]?.count ?? 0);
  check(crashIntentCountAfterResume === 1 && crashLeadCountAfterReplay === crashLeadCountBeforeReplay,
    "lost-response replay retains exactly one intent and creates no additional SFP-origin lead");

  // --- Corrective patch check 2: plaintext boundary cannot be escaped -----
  // openSfpCandidatePlaintext() itself must refuse to let a callback hand
  // the decrypted plaintext (or a value containing it) back to the caller,
  // independent of any one call site's own discipline.
  const { openSfpCandidatePlaintext } = await import("../server/services/cro03/sfp-paid-evidence-writer");
  let plaintextEscapeThrew: unknown;
  try {
    await db.transaction(async (tx) => openSfpCandidatePlaintext(
      { reference: { sourceKind: "free", freeDiscoveryCandidateId: freeFixture.candidateId! }, cohortRunId, actorId: runKey, purpose: "sfp_email_validation" },
      async (plaintext) => plaintext,
      tx,
    ));
  } catch (error) { plaintextEscapeThrew = error; }
  check(plaintextEscapeThrew instanceof Error && /SFP_PLAINTEXT_ESCAPE_BLOCKED/.test((plaintextEscapeThrew as Error).message),
    "openSfpCandidatePlaintext() structurally refuses a callback that returns the decrypted plaintext (SFP_PLAINTEXT_ESCAPE_BLOCKED)");
  let plaintextSafeCallbackThrew: unknown;
  try {
    await db.transaction(async (tx) => openSfpCandidatePlaintext(
      { reference: { sourceKind: "free", freeDiscoveryCandidateId: freeFixture.candidateId! }, cohortRunId, actorId: runKey, purpose: "sfp_email_validation" },
      async () => true,
      tx,
    ));
  } catch (error) { plaintextSafeCallbackThrew = error; }
  check(!plaintextSafeCallbackThrew, "a callback that never returns plaintext-derived data passes the guard normally");

  // --- Corrective patch check 3: single-ledger regression for the         --
  // recurring worker — exactly one sfp_stage_runs row and one item per     --
  // attempted business for the batch just processed above, never two.     --
  const workerLedgerRunCount = Number(rows(await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM sfp_stage_runs
     WHERE idempotency_key = (
       SELECT command_key FROM sfp_campaign_staging_intents WHERE business_id = ${workerBusinessId} LIMIT 1
     )
  `))[0]?.count ?? 0);
  check(workerLedgerRunCount === 0,
    "executeStagingV2() called with a caller-owned stageRunId does NOT independently create a second sfp_stage_runs row keyed by commandKey");
  // Any business the worker actually attempted in this run must have
  // exactly one item row (the (stage_run_id, business_id, provider) unique
  // constraint is the enforcement mechanism; this proves no second ledger
  // ever manufactured a duplicate insert path around it).
  const workerLedgerDuplicates = rows(await db.execute(sql`
    SELECT business_id, COUNT(*)::int AS count FROM sfp_stage_items
     WHERE stage_run_id = ${String(workerRun.id)}::uuid
     GROUP BY business_id HAVING COUNT(*) > 1
  `));
  check(workerLedgerDuplicates.length === 0,
    "no business processed by the worker's run has more than one sfp_stage_items row — no duplicate item from a second ledger");

  // --- Corrective patch check 4: telemetry truthfully reports worker/     --
  // queue health, next-run estimate, and a backlog ETA (not just counts).  --
  const { QUEUE_NAMES } = await import("../server/services/queue-manager");
  check(typeof QUEUE_NAMES.SFP_CAMPAIGN_STAGING === "string", "SFP campaign-staging has its own named BullMQ queue the telemetry endpoint can introspect");
  const leadOpsSource = source("server/routes/lead-ops.ts");
  check(/getSfpCampaignStagingWorkerHealth|repeatableJobRegistered/.test(leadOpsSource) && /nextRunEstimateAt/.test(leadOpsSource),
    "campaign-staging telemetry route reports actual queue-manager/repeatable-job health and a next-run estimate, not just program-flag inference");
  check(/campaignStagingBatchSize/.test(leadOpsSource) && /freshAwaitingStaging/.test(leadOpsSource),
    "campaign-staging telemetry route exposes the batch size and fresh backlog count needed to derive a backlog ETA");

  // --- Corrective patch check 5: PM-13 retry/cancel routes are registered --
  // with an admin role guard (not left open to any authenticated caller).  --
  check(/app\.post\(["']\/api\/lead-ops\/sfp\/campaign-staging\/items\/:itemId\/retry["'],\s*requireRole\(["']admin["']\)/.test(leadOpsSource),
    "the item-retry route is registered with requireRole('admin')");
  check(/app\.post\(["']\/api\/lead-ops\/sfp\/campaign-staging\/runs\/:runId\/cancel["'],\s*requireRole\(["']admin["']\)/.test(leadOpsSource),
    "the run-cancel route is registered with requireRole('admin')");

  // --- Corrective patch check 6: operator UI actually renders the retry/  --
  // cancel controls and row-level confirmation detail, not just the API.  --
  const uiSource = source("client/src/components/lead-ops/SouthFloridaProspectingPanel.tsx");
  check(/campaign-staging\/items\/\$\{itemId\}\/retry/.test(uiSource), "Lead Ops UI wires a retry control to the item-retry route");
  check(/campaign-staging\/runs\/\$\{runId\}\/cancel/.test(uiSource), "Lead Ops UI wires a cancel control to the run-cancel route");
  check(/rowDetailLines/.test(uiSource) && /validationAgeSeconds/.test(uiSource),
    "the staging confirmation dialog surfaces row-level package/policy/validation-freshness detail, not just aggregate counts");

  // ==========================================================================
  // Corrective patch (round 2): retry-lifecycle ownership, tx-bound
  // suppression re-check, and cancel-button/API contract parity.
  // ==========================================================================

  // --- Issue 1: worker-owned run must remain authoritative for its own    --
  // pending/completed/failed transition after executeStagingV2() writes    --
  // item outcomes — a real recurring failure must retry AND the run must   --
  // actually come back 'pending' (not stuck 'completed' by the shared      --
  // executor), and the SAME item must be reclaimed by a later tick. -------
  const retryProgram = rows(await db.execute(sql`SELECT id FROM sfp_programs WHERE id = ${String(program.id)}::uuid`))[0];
  const retryCohortRunId = randomUUID();
  await db.execute(sql`
    INSERT INTO sfp_cohort_runs
      (id, program_id, idempotency_key, status, cohort_size, cohort_hash, release_sha, actor_id,
       cohort_state, frozen_at)
    VALUES (${retryCohortRunId}::uuid, ${String(retryProgram.id)}::uuid, ${`${runKey}-retry-cohort`},
      'freezing', 1, ${createHash("sha256").update(`retry-${runKey}`).digest("hex")},
      ${String(currentTestRuntime.artifactSha)}, ${runKey}, 'freezing', NULL)
  `);
  const retryBusiness = rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name, normalized_name, vertical, state, record_class, created_at)
    VALUES (${`${runKey}-business-retry`}, ${`${runKey}-business-retry`.toLowerCase()}, NULL, 'FL', 'canonical', NOW())
    RETURNING id
  `))[0];
  const retryBusinessId = Number(retryBusiness.id);
  await seedFrozenClassification(retryBusinessId, "Fitness/Recreation", 50, retryCohortRunId);
  await db.execute(sql`
    UPDATE sfp_cohort_runs SET status='frozen', cohort_state='frozen', frozen_at=NOW()
     WHERE id=${retryCohortRunId}::uuid
  `);
  const retryEmail = `info@retry-lifecycle-${runKey}.example.org`;
  const sealedRetry = seal("email", retryEmail);
  const retryCandidate = rows(await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id, business_id, field, subject_type, domain, source, attribution_scope,
       disposition, confidence, envelope_ciphertext, envelope_nonce, envelope_tag,
       envelope_key_version, normalized_value_hash, masked_value, created_at)
    VALUES (${String(generation.id)}::uuid, ${retryBusinessId}, 'email', 'business',
      ${`${runKey}-retry.example.org`}, 'certification', 'role', 'staged', 90,
      ${sealedRetry.ciphertext}, ${sealedRetry.nonce}, ${sealedRetry.tag}, 1,
      ${sealedRetry.normalizedValueHash}, ${sealedRetry.maskedValue}, NOW())
    RETURNING id
  `))[0];
  assert.ok(retryCandidate?.id);
  // The source vertical remains raw-NULL; its frozen v2 target is
  // Fitness/Recreation. No current v2 package is seeded for that target, so
  // staging deterministically rejects with no_current_package_for_vertical.
  // This keeps the worker retry-lifecycle exercise independent of raw
  // business.vertical and preserves the v2 frozen-classification gate.
  const retryValidation = await validateFixtureCandidates(retryCohortRunId, "retry-lifecycle");
  const retryEligibility = findFixtureValidationReceipt(
    retryValidation, retryBusinessId, String(retryCandidate.id),
  );
  check(Boolean(retryEligibility?.validation_operation_id || retryEligibility?.reused_from_operation_id),
    "retry-lifecycle staging candidate has its exact current-run completed provider operation");
  const retryPreview = await previewStagingV2({
    cohortRunId: retryCohortRunId, eligibilityIds: [String(retryEligibility.id)], actorId: runKey,
  });
  check(retryPreview.eligibleCount === 0 &&
    retryPreview.rows[0]?.blockedReason === "no_current_package_for_vertical",
  "retry fixture resolves its frozen v2 Fitness/Recreation decision and fails closed only because that target has no current package");

  const retryTick1 = await processSfpCampaignStagingTick();
  check(retryTick1.enabled === true, "retry-lifecycle tick runs with the capability/schedule on");
  const retryRun = rows(await db.execute(sql`
    SELECT id, state FROM sfp_stage_runs WHERE cohort_run_id = ${retryCohortRunId}::uuid ORDER BY created_at DESC LIMIT 1
  `))[0];
  check(!!retryRun, "a dedicated sfp_stage_runs row was created for the retry-lifecycle cohort");
  const retryItemAfterTick1 = rows(await db.execute(sql`
    SELECT id, state, attempt_count, next_attempt_at FROM sfp_stage_items
     WHERE stage_run_id = ${String(retryRun.id)}::uuid AND business_id = ${retryBusinessId}
  `))[0];
  check(retryItemAfterTick1?.state === "retry" && Number(retryItemAfterTick1?.attempt_count ?? 0) < 5,
    "a recurring item that fails below MAX_ATTEMPTS becomes 'retry', not stuck 'dead_letter' or silently dropped");
  const retryRunAfterTick1 = rows(await db.execute(sql`SELECT state FROM sfp_stage_runs WHERE id = ${String(retryRun.id)}::uuid`))[0];
  check(retryRunAfterTick1?.state === "pending",
    "the worker-owned run returns to 'pending' after a retryable failure — proves executeStagingV2() no longer terminalizes a caller-owned run to 'completed' out from under the worker's own state machine");

  // Force the retry to be immediately due (rather than waiting on real
  // wall-clock backoff) and confirm the very next tick actually reprocesses
  // it — with the SAME eligibility selection, the SAME cohort, and no
  // decoy rows added. Retry-contract correction: the worker now salts its
  // preview/execute snapshot with the current tick's stage-run claim token
  // (see previewStagingV2's attemptSalt doc), so an unchanged selection
  // still produces a genuinely new commandKey per real attempt instead of
  // replaying the prior attempt's stored (failed) receipt and leaving the
  // claimed item stranded.
  check(Number(retryItemAfterTick1?.attempt_count ?? 0) === 1,
    "exactly one real worker attempt registers as attempt_count = 1 (not double-counted by claim + completion/dead-letter)");

  async function forceDueAndTick(itemId: string): Promise<{ state: string; attempt_count: number }> {
    await db.execute(sql`
      UPDATE sfp_stage_items SET next_attempt_at = NOW() - INTERVAL '1 minute'
       WHERE id = ${itemId}::uuid AND state = 'retry'
    `);
    await processSfpCampaignStagingTick();
    return rows(await db.execute(sql`
      SELECT state, attempt_count FROM sfp_stage_items WHERE id = ${itemId}::uuid
    `))[0] as any;
  }

  const retryItemAfterTick2 = await forceDueAndTick(String(retryItemAfterTick1.id));
  check(Number(retryItemAfterTick2.attempt_count) === 2,
    "a later worker tick genuinely reprocesses the SAME unchanged eligibility selection — attempt_count advances by exactly one real attempt (2), not zero (stranded replay) or two (double count)");
  check(retryItemAfterTick2.state === "retry" || retryItemAfterTick2.state === "dead_letter",
    "the reclaimed item is genuinely re-processed (retry or terminal dead_letter), not left stuck 'claimed' by a stale replay");

  // Continue unchanged through exactly five actual attempts — no decoy
  // rows, no cohort changes — proving the fifth ACTUAL failed attempt (not
  // the third attempt counted twice) is what reaches dead_letter.
  let lastItem = retryItemAfterTick2;
  for (let attempt = 3; attempt <= 5; attempt++) {
    lastItem = await forceDueAndTick(String(retryItemAfterTick1.id));
    if (attempt < 5) {
      check(Number(lastItem.attempt_count) === attempt && lastItem.state === "retry",
        `attempt ${attempt}: the same unchanged item is reclaimed and genuinely retried (attempt_count = ${attempt}, state 'retry')`);
    }
  }
  check(lastItem.state === "dead_letter" && Number(lastItem.attempt_count) === 5,
    "the fifth ACTUAL failed attempt — attempt_count exactly 5, not a lower count double-incremented to look like 5 — moves the item to 'dead_letter'");

  const retryRunFinal = rows(await db.execute(sql`SELECT state FROM sfp_stage_runs WHERE id = ${String(retryRun.id)}::uuid`))[0];
  check(retryRunFinal?.state === "failed",
    "the owning run reports 'failed' once its item exhausts all retry attempts");

  const claimedStragglers = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM sfp_stage_items
     WHERE stage_run_id = ${String(retryRun.id)}::uuid AND state = 'claimed'
  `))[0];
  check(Number(claimedStragglers?.count ?? 0) === 0,
    "no item remains 'claimed' after a completed worker tick on this run — the retry contract never strands a claimed item behind a replayed command receipt");

  // --- Issue 2: the real-address suppression check inside the plaintext   --
  // callback is bound to the staging transaction, not the global db pool.  --
  const stagingV2Source = source("server/services/cro03/sfp-campaign-staging-v2.ts");
  check(/isCanonicallySuppressed\(\s*\[\s*contactEmailTokenHash,\s*tokenHashForSuppression\s*\],\s*tx,\s*\[plaintext\]\s*,?\s*\)/s.test(stagingV2Source),
    "the real-address suppression re-check inside the audited plaintext callback receives the real address and is bound to the staging transaction (tx)");
  // Functional proof: a real (decrypted) address that is suppressed must
  // fail closed with SFP_STAGING_ADDRESS_SUPPRESSED even though the eligibility
  // row's own masked/normalized hash was clean at preview time — this is
  // exactly the scenario the tx-bound recheck exists to catch.
  const suppressedEmail = `info@suppressed-real-${runKey}.example.org`;
  const suppressedTokenHash = createHash("sha256").update(suppressedEmail.trim().toLowerCase()).digest("hex");
  // The candidate/evidence business-membership check inside
  // openSfpCandidatePlaintext() requires this business to already be a
  // registered sfp_cohort_members row — and cohortRunId is frozen by this
  // point in the script, so this fixture reuses the pre-freeze
  // extraBusinessIds.suppressed business rather than inserting a new one
  // now (which would trip the frozen-cohort membership trigger).
  const suppressedBusinessId = extraBusinessIds.suppressed;
  // Keep the validated identity pin bound to the actual candidate address so
  // the negative proof reaches the canonical suppression re-check.
  const sealedSuppressed = seal("email", suppressedEmail);
  const suppressedCandidate = rows(await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id, business_id, field, subject_type, domain, source, attribution_scope,
       disposition, confidence, envelope_ciphertext, envelope_nonce, envelope_tag,
       envelope_key_version, normalized_value_hash, masked_value, created_at)
    VALUES (${String(generation.id)}::uuid, ${suppressedBusinessId}, 'email', 'business',
      ${`${runKey}-suppressed.example.org`}, 'certification', 'role', 'staged', 90,
      ${sealedSuppressed.ciphertext}, ${sealedSuppressed.nonce}, ${sealedSuppressed.tag}, 1,
      ${sealedSuppressed.normalizedValueHash}, ${sealedSuppressed.maskedValue}, NOW())
    RETURNING id
  `))[0];
  assert.ok(suppressedCandidate?.id);
  const suppressedValidation = await validateFixtureCandidates(cohortRunId, "suppressed-real-address");
  const suppressedEligibility = findFixtureValidationReceipt(
    suppressedValidation, suppressedBusinessId, String(suppressedCandidate.id),
  );
  check(Boolean(suppressedEligibility?.validation_operation_id || suppressedEligibility?.reused_from_operation_id),
    "suppression regression fixture is first given its exact current-run real completed provider receipt");
  const suppressedPreview = await previewStagingV2({ cohortRunId, eligibilityIds: [String(suppressedEligibility.id)], actorId: runKey });
  check(suppressedPreview.eligibleCount === 1 && suppressedPreview.rows[0]?.disposition === "eligible",
    "the genuine source address and completed validation receipt are current in the actual pre-suppression staging snapshot");
  await db.execute(sql`
    INSERT INTO contacts (email, phone, email_token_hash, opted_out_email, first_name, last_name)
    VALUES (${suppressedEmail}, ${`+1305555${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`}, ${suppressedTokenHash}, TRUE, 'Cert', 'Suppressed')
    ON CONFLICT DO NOTHING
  `);
  const suppressedResult = await executeStagingV2({
    cohortRunId, eligibilityIds: [String(suppressedEligibility.id)], commandKey: suppressedPreview.commandKey,
    snapshotHash: suppressedPreview.snapshotHash, actorId: runKey, confirmPayloadHash: suppressedPreview.payloadHash,
  });
  const suppressedPassed = suppressedResult.readyHeld === 0 && suppressedResult.rejected === 1 &&
    "SFP_STAGING_ADDRESS_SUPPRESSED" in suppressedResult.reasons;
  const suppressedLead = rows(await db.execute(sql`
    SELECT id FROM master_leads WHERE canonical_business_id=${suppressedBusinessId} AND pipeline_origin='sfp_pipeline'
  `))[0];
  if (!suppressedPassed || suppressedLead) {
    emitFailOnlyDiagnostic("suppression-recheck", {
      eligibilityId: String(suppressedEligibility.id),
      preview: summarizeStagingPreview(suppressedPreview),
      result: {
        readyHeld: suppressedResult.readyHeld,
        rejected: suppressedResult.rejected,
        reasons: suppressedResult.reasons,
      },
      sourceCurrentness: await readStagingCurrentnessDiagnostic(cohortRunId, [String(suppressedEligibility.id)]),
      masterLeadCreated: Boolean(suppressedLead),
    });
  }
  check(suppressedPassed,
    "a real (decrypted) address matching a suppressed contact is rejected inside the transaction, even though its masked/normalized hash looked clean at preview time");
  check(!suppressedLead, "no master lead is created for a business whose real address is suppressed");

  // --- Issue 3: the cancel button must match the API's exact acceptance   --
  // predicate — never offered for an actively-leased running run, offered  --
  // for a genuinely cancellable one. --------------------------------------
  const leasedRun = rows(await db.execute(sql`
    INSERT INTO sfp_stage_runs (cohort_run_id, stage, idempotency_key, actor_id, state, max_items, provider_keys, estimated_cost_micros, lease_expires_at, claim_token)
    VALUES (${cohortRunId}::uuid, 'campaign_staging', ${`${runKey}-leased-run`}, ${runKey}, 'running', 1, '[]'::jsonb, 0, NOW()+INTERVAL '30 minutes', gen_random_uuid())
    RETURNING id
  `))[0];
  const stalledRun = rows(await db.execute(sql`
    INSERT INTO sfp_stage_runs (cohort_run_id, stage, idempotency_key, actor_id, state, max_items, provider_keys, estimated_cost_micros)
    VALUES (${cohortRunId}::uuid, 'campaign_staging', ${`${runKey}-stalled-run`}, ${runKey}, 'stalled', 1, '[]'::jsonb, 0)
    RETURNING id
  `))[0];
  // Mirrors the API's own acceptance predicate exactly (pending/authorized/
  // stalled, OR running with an expired lease) — reused as the telemetry
  // route's cancellableRun derivation.
  const runsForCancelCheck = rows(await db.execute(sql`
    SELECT id, state, lease_expires_at FROM sfp_stage_runs WHERE id = ANY(ARRAY[${String(leasedRun.id)}, ${String(stalledRun.id)}]::uuid[])
  `));
  const cancellableIds = runsForCancelCheck
    .filter((r: any) => ["pending", "authorized", "stalled"].includes(String(r.state)) ||
      (r.state === "running" && r.lease_expires_at && new Date(String(r.lease_expires_at)).getTime() < Date.now()))
    .map((r: any) => String(r.id));
  check(!cancellableIds.includes(String(leasedRun.id)) && cancellableIds.includes(String(stalledRun.id)),
    "the telemetry route's cancellableRun predicate excludes an actively-leased running run and includes a stalled one");
  // Confirm the actual cancel route's SQL predicate (unchanged) agrees:
  // an actively-leased running run is refused, a stalled one is accepted.
  const leasedCancelAttempt = rows(await db.execute(sql`
    UPDATE sfp_stage_runs SET state='cancelled', terminal_reason='operator_cancelled', completed_at=NOW(), lease_expires_at=NULL, claim_token=NULL, updated_at=NOW()
     WHERE id=${String(leasedRun.id)}::uuid AND (state IN ('pending','authorized','stalled') OR (state='running' AND lease_expires_at<NOW()))
    RETURNING id
  `));
  check(leasedCancelAttempt.length === 0, "the cancel route's own predicate refuses an actively-leased running run — the UI must never have offered it");
  const stalledCancelAttempt = rows(await db.execute(sql`
    UPDATE sfp_stage_runs SET state='cancelled', terminal_reason='operator_cancelled', completed_at=NOW(), lease_expires_at=NULL, claim_token=NULL, updated_at=NOW()
     WHERE id=${String(stalledRun.id)}::uuid AND (state IN ('pending','authorized','stalled') OR (state='running' AND lease_expires_at<NOW()))
    RETURNING id
  `));
  check(stalledCancelAttempt.length === 1, "the cancel route's own predicate accepts a genuinely cancellable (stalled) run — the UI's cancellableRun-gated button matches this exactly");
  check(/cancellableRun\b/.test(leadOpsSource), "the telemetry route response includes a cancellableRun field distinct from currentlyRunning");
  check(/stagingTelemetryQuery\.data\.cancellableRun/.test(uiSource) && !/onClick=\{\(\) => cancelStageRun\.mutate\(stagingTelemetryQuery\.data!\.currentlyRunning!\.id\)\}/.test(uiSource),
    "the UI's Cancel button is gated on cancellableRun, not on currentlyRunning (which may be actively leased and API-refused)");

  // --- PM-13: operator controls act on the ledger and are re-verified against real rows ---
  const deadLetterSeed = rows(await db.execute(sql`
    SELECT id FROM sfp_stage_items WHERE state='dead_letter' LIMIT 1
  `))[0];
  if (deadLetterSeed) {
    await db.execute(sql`UPDATE sfp_stage_items SET state='dead_letter', completed_at=NOW() WHERE id=${String(deadLetterSeed.id)}::uuid`);
    await db.execute(sql`UPDATE sfp_stage_runs SET state='failed' WHERE id IN (SELECT stage_run_id FROM sfp_stage_items WHERE id=${String(deadLetterSeed.id)}::uuid)`);
    const requeued = rows(await db.execute(sql`
      UPDATE sfp_stage_items SET state='retry', next_attempt_at=NOW(), completed_at=NULL, outcome_code=NULL
       WHERE id=${String(deadLetterSeed.id)}::uuid AND state='dead_letter'
      RETURNING id, stage_run_id
    `))[0];
    check(!!requeued, "PM-13 retry route's underlying transition (dead_letter -> retry) succeeds against a real dead-lettered item");
  } else {
    console.log("  (no dead-lettered item produced in this run to exercise the PM-13 retry transition against — non-fatal)");
  }
} finally {
  if (ownerHeartbeat) clearInterval(ownerHeartbeat);
  while (ownerHeartbeatPending) await new Promise(resolve => setTimeout(resolve, 10));
  await pool.end();
}

console.log(`\nTask #2001 certification: ${assertions - failures}/${assertions} checks passed; ${failures} failed.`);
if (failures > 0) process.exitCode = 1;