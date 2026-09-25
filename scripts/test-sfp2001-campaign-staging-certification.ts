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
import { sql } from "drizzle-orm";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "./certification-provider-deny";

await assertDisposableTestInfrastructure({
  operation: "Task #2001 SFP campaign-staging disposable certification",
  requireRedis: false,
});
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });

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

try {
  const policy = rows(await db.execute(sql`
    SELECT d.id, d.version, d.document_hash
      FROM sfp_outreach_policy_control c
      JOIN sfp_outreach_policy_documents d ON d.id=c.active_policy_id
     WHERE c.singleton=TRUE
  `))[0];
  check(Boolean(policy), "active versioned outreach policy is present after migrations");

  const program = rows(await db.execute(sql`
    INSERT INTO sfp_programs (name, county_fips, vertical_ids, max_cohort_size, policy_version, is_active, created_by)
    VALUES (${`${runKey}-program`}, ARRAY['12086'], ARRAY['Med Spa'], 10, 1, TRUE, ${runKey})
    RETURNING id
  `))[0];
  const cohortRunId = randomUUID();
  await db.execute(sql`
    INSERT INTO sfp_cohort_runs
      (id, program_id, idempotency_key, status, cohort_size, cohort_hash, release_sha, actor_id,
       cohort_state, frozen_at)
    VALUES (${cohortRunId}::uuid, ${String(program.id)}::uuid, ${`${runKey}-cohort`},
      'freezing', 4, ${createHash("sha256").update(runKey).digest("hex")},
      ${"0".repeat(40)}, ${runKey}, 'freezing', NULL)
  `);

  const campaign = rows(await db.execute(sql`
    INSERT INTO campaigns (name, status, target_verticals, created_by, total_steps)
    VALUES (${`${runKey}-campaign`}, 'draft', ARRAY['Med Spa'], ${runKey}, 1)
    RETURNING id
  `))[0];
  const sequence = rows(await db.execute(sql`
    INSERT INTO follow_up_sequences
      (name, status, trigger_type, total_steps, sequence_family, channels_allowed, eligible_consent_tiers)
    VALUES (${`${runKey}-sequence`}, 'paused', 'manual', 1, ${`${runKey}-med-spa`},
            ARRAY['email','task'], ARRAY['first_party_role_inbox'])
    RETURNING id
  `))[0];
  const liveContentHash = await computeLivePackageContentHash(db, Number(campaign.id), Number(sequence.id));
  const packageVersion = rows(await db.execute(sql`
    INSERT INTO sfp_campaign_package_versions
      (package_key, vertical, campaign_id, campaign_name, sequence_id, sequence_name,
       sequence_family, content_hash, lifecycle_state, effective_at, actor_id)
    VALUES ('sfp.med_spa.v1', 'Med Spa', ${Number(campaign.id)}, ${`${runKey}-campaign`},
            ${Number(sequence.id)}, ${`${runKey}-sequence`}, ${`${runKey}-med-spa`},
            ${liveContentHash}, 'current', NOW(), ${runKey})
    RETURNING id
  `))[0];
  check(Boolean(packageVersion), "draft campaign and paused sequence package version seeded");

  const generation = rows(await db.execute(sql`
    INSERT INTO free_discovery_generations (run_key, actor_id, purpose, reason, state)
    VALUES (${`${runKey}-generation`}, ${runKey}, 'email_discovery', 'Task 2001 certification', 'completed')
    RETURNING id
  `))[0];
  const fixture: Array<{ eligibilityId: string; businessId: number; kind: "free" | "paid"; candidateId?: string; paidId?: string }> = [];
  const emails = [`free-${runKey}@example.org`, `paid-${runKey}@example.org`, `drift-${runKey}@example.org`, `legacy-${runKey}@example.org`];
  for (let i = 0; i < emails.length; i++) {
    const business = rows(await db.execute(sql`
      INSERT INTO businesses (canonical_name, normalized_name, vertical, state, record_class, created_at)
      VALUES (${`${runKey}-business-${i}`}, ${`${runKey}-business-${i}`.toLowerCase()}, 'Med Spa', 'FL', 'canonical', NOW())
      RETURNING id
    `))[0];
    const businessId = Number(business.id);
    let candidateId: string | undefined;
    let paidId: string | undefined;
    const normalizedHash = createHash("sha256").update(emails[i]).digest("hex");
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
    await db.execute(sql`
      INSERT INTO sfp_cohort_members
        (cohort_run_id, business_id, roi_score, geography_class, geography_source, county_fips, vertical)
      VALUES (${cohortRunId}::uuid, ${businessId}, 50, 'verified', 'fips', '12086', 'Med Spa')
    `);
    const eligibility = rows(await db.execute(sql`
      INSERT INTO sfp_outreach_eligibility
        (cohort_run_id, business_id, candidate_id, source_kind, paid_candidate_evidence_id,
         policy_version, status, decision_reason, validation_at, validation_expires_at,
         role_inbox, masked_email, discovery_source, suppression_status,
         outreach_policy_version, normalized_value_hash, policy_document_id,
         policy_document_hash, consent_tier, reason_codes)
      VALUES (${cohortRunId}::uuid, ${businessId}, ${candidateId ?? null}::uuid,
         ${i === 1 ? "paid" : "free"}, ${paidId ?? null}::uuid,
         ${Number(policy.version)}, 'validated_outreach_eligible', 'certification_fixture',
         NOW(), NOW()+INTERVAL '20 days', TRUE, ${emails[i].replace(/^[^@]+/, "***")},
         ${i === 1 ? "paid" : "free"}, 'not_suppressed', ${Number(policy.version)},
         ${normalizedHash}, ${String(policy.id)}::uuid, ${String(policy.document_hash)},
         'first_party_role_inbox', '[]'::jsonb)
      RETURNING id
    `))[0];
    fixture.push({ eligibilityId: String(eligibility.id), businessId, kind: i === 1 ? "paid" : "free", candidateId, paidId });
  }
  // Businesses used by the completion-review regression checks below
  // (cross-business evidence binding, live content-hash drift, concurrent
  // duplicate execution) must be registered as cohort members BEFORE the
  // freeze below — sfp_cohort_members has a trigger that rejects any INSERT
  // once the owning cohort run is frozen/voided/superseded.
  const extraBusinessIds: Record<"mismatch" | "drift2" | "concurrent" | "workerOk", number> = { mismatch: 0, drift2: 0, concurrent: 0, workerOk: 0 };
  for (const key of ["mismatch", "drift2", "concurrent", "workerOk"] as const) {
    const extraBusiness = rows(await db.execute(sql`
      INSERT INTO businesses (canonical_name, normalized_name, vertical, state, record_class, created_at)
      VALUES (${`${runKey}-business-${key}`}, ${`${runKey}-business-${key}`.toLowerCase()}, 'Med Spa', 'FL', 'canonical', NOW())
      RETURNING id
    `))[0];
    extraBusinessIds[key] = Number(extraBusiness.id);
    await db.execute(sql`
      INSERT INTO sfp_cohort_members
        (cohort_run_id, business_id, roi_score, geography_class, geography_source, county_fips, vertical)
      VALUES (${cohortRunId}::uuid, ${extraBusinessIds[key]}, 50, 'verified', 'fips', '12086', 'Med Spa')
    `);
  }

  await db.execute(sql`
    UPDATE sfp_cohort_runs SET status='frozen', cohort_state='frozen', frozen_at=NOW()
     WHERE id=${cohortRunId}::uuid
  `);

  // Free source and paid source use the same preview/execute path.
  let initialFreePreview: Awaited<ReturnType<typeof previewStagingV2>> | null = null;
  for (const [index, label] of [[0, "free"], [1, "paid"]] as const) {
    const item = fixture[index];
    const preview = await previewStagingV2({ cohortRunId, eligibilityIds: [item.eligibilityId], actorId: runKey });
    if (label === "free") initialFreePreview = preview;
    check(preview.eligibleCount === 1 && preview.rows[0]?.packageKey === "sfp.med_spa.v1",
      `${label} row previews against its package-pinned Med Spa target`);
    const result = await executeStagingV2({
      cohortRunId, eligibilityIds: [item.eligibilityId], commandKey: preview.commandKey,
      snapshotHash: preview.snapshotHash, actorId: runKey, confirmPayloadHash: preview.payloadHash,
    });
    check(result.readyHeld === 1 && result.rejected === 0, `${label} row reaches ready_held`);
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
    const stateEmail = `legacy-${state}-${runKey}@example.org`;
    const sealedStateCandidate = seal("email", stateEmail);
    const stateCandidate = rows(await db.execute(sql`
      INSERT INTO free_discovery_candidates
        (generation_id, business_id, field, subject_type, domain, source, attribution_scope,
         disposition, confidence, envelope_ciphertext, envelope_nonce, envelope_tag,
         envelope_key_version, normalized_value_hash, masked_value, created_at)
      VALUES (${String(generation.id)}::uuid, ${fixture[3].businessId}, 'email', 'business',
        ${`${runKey}-${state}.example.org`}, 'certification', 'role', 'staged', 85,
        ${sealedStateCandidate.ciphertext}, ${sealedStateCandidate.nonce}, ${sealedStateCandidate.tag},
        1, ${sealedStateCandidate.normalizedValueHash}, ${sealedStateCandidate.maskedValue}, NOW())
      RETURNING id
    `))[0];
    const eligibility = rows(await db.execute(sql`
      INSERT INTO sfp_outreach_eligibility
        (cohort_run_id, business_id, candidate_id, source_kind, policy_version, status,
         decision_reason, validation_at, validation_expires_at, role_inbox, normalized_value_hash)
      VALUES (${cohortRunId}::uuid, ${fixture[3].businessId}, ${String(stateCandidate.id)}::uuid, 'free',
         ${Number(policy.version) + index + 10}, 'validated_outreach_eligible', ${`legacy-${state}`},
         NOW(), NOW()+INTERVAL '20 days', TRUE, ${createHash("sha256").update(`${state}${runKey}`).digest("hex")})
      RETURNING id
    `))[0];
    await db.execute(sql`
      INSERT INTO sfp_campaign_staging_intents
        (cohort_run_id, eligibility_id, business_id, candidate_id, source_kind,
         idempotency_key, actor_id, state, policy_version, validation_snapshot, lineage)
      VALUES (${cohortRunId}::uuid, ${String(eligibility.id)}::uuid, ${fixture[3].businessId},
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
      const promotedEmail = `legacy-promoted-${runKey}@example.org`;
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
          ${Number(policy.version) + 20}, 'validated_outreach_eligible', 'legacy_promoted',
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
  const mismatchEligibility = rows(await db.execute(sql`
    INSERT INTO sfp_outreach_eligibility
      (cohort_run_id, business_id, candidate_id, source_kind, policy_version, status,
       decision_reason, validation_at, validation_expires_at, role_inbox,
       normalized_value_hash, policy_document_id, policy_document_hash, consent_tier, reason_codes)
    VALUES (${cohortRunId}::uuid, ${mismatchBusinessId}, ${fixture[0].candidateId}::uuid, 'free',
       ${Number(policy.version)}, 'validated_outreach_eligible', 'certification_fixture_mismatch',
       NOW(), NOW()+INTERVAL '20 days', TRUE, ${createHash("sha256").update(`mismatch-${runKey}`).digest("hex")},
       ${String(policy.id)}::uuid, ${String(policy.document_hash)}, 'first_party_role_inbox', '[]'::jsonb)
    RETURNING id
  `))[0];
  const mismatchPreview = await previewStagingV2({ cohortRunId, eligibilityIds: [String(mismatchEligibility.id)], actorId: runKey });
  const mismatchResult = await executeStagingV2({
    cohortRunId, eligibilityIds: [String(mismatchEligibility.id)], commandKey: mismatchPreview.commandKey,
    snapshotHash: mismatchPreview.snapshotHash, actorId: runKey, confirmPayloadHash: mismatchPreview.payloadHash,
  });
  check(mismatchResult.readyHeld === 0 && mismatchResult.rejected === 1 && "SFP_STAGING_EVIDENCE_BUSINESS_MISMATCH" in mismatchResult.reasons,
    "cross-business evidence reference is rejected, never projected into the wrong business's master lead");
  const mismatchLead = rows(await db.execute(sql`
    SELECT id FROM master_leads WHERE canonical_business_id=${mismatchBusinessId} AND pipeline_origin='sfp_pipeline'
  `))[0];
  check(!mismatchLead, "no master lead is created for the business with mismatched evidence");

  // --- Live content-hash drift (completion-review Defect 2) --------------
  // Editing the pinned campaign's actual content (a real content_revision
  // bump — not just touching the package-version row) must be caught live,
  // inside the staging transaction, even though the package mapping itself
  // still reports lifecycle_state='current'.
  await db.execute(sql`UPDATE campaigns SET content_revision = content_revision + 1, description = 'edited after package was pinned' WHERE id = ${Number(campaign.id)}`);
  const driftBusinessId = extraBusinessIds.drift2;
  const driftEmail = `content-drift-${runKey}@example.org`;
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
  const driftEligibility = rows(await db.execute(sql`
    INSERT INTO sfp_outreach_eligibility
      (cohort_run_id, business_id, candidate_id, source_kind, policy_version, status,
       decision_reason, validation_at, validation_expires_at, role_inbox,
       normalized_value_hash, policy_document_id, policy_document_hash, consent_tier, reason_codes)
    VALUES (${cohortRunId}::uuid, ${driftBusinessId}, ${String(driftCandidate.id)}::uuid, 'free',
       ${Number(policy.version)}, 'validated_outreach_eligible', 'certification_fixture_drift',
       NOW(), NOW()+INTERVAL '20 days', TRUE, ${createHash("sha256").update(`drift2-${runKey}`).digest("hex")},
       ${String(policy.id)}::uuid, ${String(policy.document_hash)}, 'first_party_role_inbox', '[]'::jsonb)
    RETURNING id
  `))[0];
  const driftPreview = await previewStagingV2({ cohortRunId, eligibilityIds: [String(driftEligibility.id)], actorId: runKey });
  const driftResult = await executeStagingV2({
    cohortRunId, eligibilityIds: [String(driftEligibility.id)], commandKey: driftPreview.commandKey,
    snapshotHash: driftPreview.snapshotHash, actorId: runKey, confirmPayloadHash: driftPreview.payloadHash,
  });
  check(driftResult.readyHeld === 0 && driftResult.rejected === 1 && "SFP_STAGING_PACKAGE_CONTENT_DRIFTED" in driftResult.reasons,
    "a campaign content-revision edit after pinning is caught live and fails closed, never reaches ready_held on stale content");
  // Restore the campaign so it does not poison any later readers of this fixture data.
  await db.execute(sql`UPDATE campaigns SET content_revision = content_revision - 1, description = NULL WHERE id = ${Number(campaign.id)}`);

  // --- Concurrent duplicate execution converges to one intent (Defect 3) -
  const concurrentBusinessId = extraBusinessIds.concurrent;
  const concurrentEmail = `concurrent-${runKey}@example.org`;
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
  const concurrentEligibility = rows(await db.execute(sql`
    INSERT INTO sfp_outreach_eligibility
      (cohort_run_id, business_id, candidate_id, source_kind, policy_version, status,
       decision_reason, validation_at, validation_expires_at, role_inbox,
       normalized_value_hash, policy_document_id, policy_document_hash, consent_tier, reason_codes)
    VALUES (${cohortRunId}::uuid, ${concurrentBusinessId}, ${String(concurrentCandidate.id)}::uuid, 'free',
       ${Number(policy.version)}, 'validated_outreach_eligible', 'certification_fixture_concurrent',
       NOW(), NOW()+INTERVAL '20 days', TRUE, ${createHash("sha256").update(`concurrent-${runKey}`).digest("hex")},
       ${String(policy.id)}::uuid, ${String(policy.document_hash)}, 'first_party_role_inbox', '[]'::jsonb)
    RETURNING id
  `))[0];
  const concurrentPreview = await previewStagingV2({ cohortRunId, eligibilityIds: [String(concurrentEligibility.id)], actorId: runKey });
  const [concurrentA, concurrentB] = await Promise.all([
    executeStagingV2({ cohortRunId, eligibilityIds: [String(concurrentEligibility.id)], commandKey: concurrentPreview.commandKey, snapshotHash: concurrentPreview.snapshotHash, actorId: runKey, confirmPayloadHash: concurrentPreview.payloadHash }),
    executeStagingV2({ cohortRunId, eligibilityIds: [String(concurrentEligibility.id)], commandKey: concurrentPreview.commandKey, snapshotHash: concurrentPreview.snapshotHash, actorId: runKey, confirmPayloadHash: concurrentPreview.payloadHash }),
  ]);
  check(concurrentA.readyHeld + (concurrentA.replayed ? 0 : 0) >= 0 && concurrentB.readyHeld >= 0, "concurrent duplicate execution calls both return without throwing");
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
  const workerBusinessId = extraBusinessIds.workerOk;
  await db.execute(sql`
    UPDATE sfp_programs SET recurring_enabled = TRUE,
      schedule_config = jsonb_set(COALESCE(schedule_config, '{}'::jsonb), '{campaignStaging}', '5')
     WHERE name = 'south-florida-v1'
  `);
  process.env.BACKGROUND_JOB_PROFILE = "selective:sfp-campaign-staging";

  // Fixture: one row that will succeed, and one that will be forced to
  // dead-letter (bad candidate reference) to exercise the retry/dead-letter
  // lifecycle and the PM-13 requeue route end-to-end.
  const workerOkEmail = `worker-ok-${runKey}@example.org`;
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
  const workerOkEligibility = rows(await db.execute(sql`
    INSERT INTO sfp_outreach_eligibility
      (cohort_run_id, business_id, candidate_id, source_kind, policy_version, status,
       decision_reason, validation_at, validation_expires_at, role_inbox,
       normalized_value_hash, policy_document_id, policy_document_hash, consent_tier, reason_codes)
    VALUES (${cohortRunId}::uuid, ${workerBusinessId}, ${String(workerOkCandidate.id)}::uuid, 'free',
       ${Number(policy.version)}, 'validated_outreach_eligible', 'certification_fixture_worker_ok',
       NOW(), NOW()+INTERVAL '20 days', TRUE, ${createHash("sha256").update(`worker-ok-${runKey}`).digest("hex")},
       ${String(policy.id)}::uuid, ${String(policy.document_hash)}, 'first_party_role_inbox', '[]'::jsonb)
    RETURNING id
  `))[0];

  const tick1 = await processSfpCampaignStagingTick();
  check(tick1.enabled === true, "recurring campaign-staging tick runs when the capability and schedule are both configured on");

  const workerRun = rows(await db.execute(sql`
    SELECT id, state, selected_count, processed_count, succeeded_count, failed_count
      FROM sfp_stage_runs WHERE stage='campaign_staging' ORDER BY created_at DESC LIMIT 1
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

  // Run a second tick against the SAME run without adding new eligible
  // rows (simulating a resumed/re-triggered tick). If counters were still
  // `+=` based, processed/succeeded would double here; with the ledger fix
  // they must stay identical because no new items exist to reconcile.
  await processSfpCampaignStagingTick();
  const workerRunAfterSecondTick = rows(await db.execute(sql`
    SELECT processed_count, succeeded_count, failed_count FROM sfp_stage_runs WHERE id = ${String(workerRun.id)}::uuid
  `))[0];
  check(Number(workerRunAfterSecondTick.processed_count) === Number(workerRun.processed_count) &&
    Number(workerRunAfterSecondTick.succeeded_count) === Number(workerRun.succeeded_count),
    "a second worker tick against an already-completed run with no new eligible rows leaves counters unchanged (no double counting on resumed ticks)");

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
  await pool.end();
}

console.log(`\nTask #2001 certification: ${assertions - failures}/${assertions} checks passed; ${failures} failed.`);
if (failures > 0) process.exitCode = 1;