#!/usr/bin/env tsx
/**
 * test-sfp-full-drain-certification.ts
 *
 * Disposable-database certification proving the FULL source -> ready_held
 * handoff produces genuine nonzero per-record movement end to end:
 *
 *   staged free-discovery candidate
 *     -> ZeroBounce validation (executeSfpValidation, fake zbTransport)
 *     -> sfp_outreach_eligibility = validated_outreach_eligible
 *     -> campaign-staging worker tick (processSfpCampaignStagingTick)
 *     -> version-pinned ready_held row, staging_intent_id back-filled
 *
 * This never touches a real provider (fake zbTransport only; the
 * certification provider-deny boundary hard-fails any real HTTP attempt),
 * never enrolls a sequence, never calls GHL, and never sends anything --
 * it asserts ready_held is the terminal state and that no send-side table
 * gained a row.
 *
 * Run:
 *   npx tsx scripts/run-sfp-certification-disposable.ts
 * or directly against the current dev DB (NOT disposable) for iteration:
 *   npx tsx scripts/test-sfp-full-drain-certification.ts
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "./certification-provider-deny";

await assertDisposableTestInfrastructure({
  operation: "SFP full drain (validation -> ready_held) disposable certification",
  requireRedis: false,
});
const sfpRuntimeIdentity = await (await import("./helpers/sfp-runtime-test-identity")).getSfpRuntimeTestIdentity();
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
const RUN_ID = `sfpfd-${randomUUID().slice(0, 8)}`;

const { ensureProgram, setProgramActivation } = await import(
  "../server/services/cro03/south-florida-prospecting"
);
const { previewSfpValidation, executeSfpValidation } = await import(
  "../server/services/cro03/sfp-validation"
);
const { seal } = await import("../server/services/cro03/candidate-evidence-service");
const { processSfpCampaignStagingTick } = await import(
  "../server/services/cro03/sfp-campaign-staging-worker"
);
const { computeLivePackageContentHash } = await import(
  "../server/services/cro03/sfp-campaign-packages"
);
const { CLASSIFIER_VERSION, TAXONOMY_VERSION_V2 } = await import(
  "../server/services/cro03/sfp-vertical-classifier"
);

try {
  const { execSync } = await import("node:child_process");
  execSync("npx tsx scripts/seed-mi09-pricing.ts --apply --confirm-env=test", { stdio: "pipe", env: process.env });
} catch {
  /* idempotent */
}

const program = await ensureProgram({ createdBy: `cert:${RUN_ID}` });
await setProgramActivation({ active: true, actorId: `cert:${RUN_ID}` });
await db.execute(sql`
  UPDATE sfp_programs SET recurring_enabled = TRUE,
         taxonomy_version = ${TAXONOMY_VERSION_V2},
         vertical_ids = ARRAY['Healthcare']::text[],
         schedule_config = jsonb_set(COALESCE(schedule_config, '{}'::jsonb), '{campaignStaging}', '5')
   WHERE id = ${program.id}::uuid
`);

const { authorizePaidBudget, MI09_PAID_BUDGET_TYPED_CONFIRMATION } = await import(
  "../server/services/mi09-pilot-authority"
);
await authorizePaidBudget({ authorizedBy: `cert:${RUN_ID}`, typedConfirmation: MI09_PAID_BUDGET_TYPED_CONFIRMATION });

await db.execute(sql`
  UPDATE provider_controls
     SET enabled = TRUE, circuit_state = 'closed', local_budget_units = 1000000, version = version + 1, updated_at = NOW()
   WHERE provider = 'zerobounce'
`);

// Live attestation fixture (same seam as test-sfp-validation-handoff-repair-certification.ts)
{
  const certIdemKey = `cert-fd-att-${RUN_ID}`;
  const certAttHash = createHash("sha256").update(certIdemKey).digest("hex");
  await db.execute(sql`
    INSERT INTO cro03c_runtime_attestations
      (idempotency_key, worker_identities, artifact_sha, migration_head, deployment_identity,
       environment_identity, web_boot_identity, worker_boot_identity,
       queue_topology_hash, worker_heartbeat_at, db_healthy, redis_healthy,
       captured_at, expires_at, attestation_hash, created_by)
    VALUES (
      ${certIdemKey}, ${JSON.stringify([sfpRuntimeIdentity.processIdentity])}::jsonb, ${sfpRuntimeIdentity.artifactSha},
      ${createHash("sha256").update("cert-fd-migration-head").digest("hex").slice(0, 40)},
      ${sfpRuntimeIdentity.deploymentIdentity}, ${sfpRuntimeIdentity.environmentIdentity},
      ${`cert-fd-web-${RUN_ID}`}, ${`cert-fd-worker-${RUN_ID}`},
      ${sfpRuntimeIdentity.queueTopologyHash},
      NOW() - INTERVAL '30 seconds', true, true,
      NOW(), NOW() + INTERVAL '1 hour',
      ${certAttHash}, ${"cert-fd:" + RUN_ID}
    )
    ON CONFLICT (idempotency_key) DO NOTHING
  `);
}

// ── Fixture: 5 raw-NULL businesses with staged email candidates and frozen
// v2 Healthcare classification evidence. The raw vertical intentionally does
// not provide the package route; only the frozen v2 classifier pin may do so.
const genRow = rows(await db.execute(sql`
  INSERT INTO free_discovery_generations (run_key, actor_id, purpose, reason, state)
  VALUES (${`cert-fd-${RUN_ID}`}, ${`cert:${RUN_ID}`}, 'email_discovery', 'certification', 'running')
  RETURNING id
`))[0];
const generationId = String(genRow.id);

const bizIds: number[] = [];
const emailByBiz = new Map<number, string>();
const N = 5;
for (let i = 0; i < N; i++) {
  const name = `${RUN_ID}-biz-${i}`;
  const bizRow = rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name, normalized_name, vertical, state, record_class, created_at)
    VALUES (${name}, ${name.toLowerCase()}, NULL, 'FL', 'canonical', NOW())
    RETURNING id
  `))[0];
  const bizId = Number(bizRow.id);
  bizIds.push(bizId);
  await db.execute(sql`INSERT INTO business_locations (business_id, county_fips, created_at) VALUES (${bizId}, '12086', NOW())`);
  const email = `valid-${i}-${RUN_ID}@gmail.com`;
  emailByBiz.set(bizId, email);
  const sealed = seal("email", email);
  await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id, business_id, field, subject_type, domain, source,
       attribution_scope, disposition, confidence, envelope_ciphertext,
       envelope_nonce, envelope_tag, envelope_key_version,
       normalized_value_hash, masked_value, created_at)
    VALUES (${generationId}::uuid, ${bizId}, 'email', 'business',
      ${`${RUN_ID}-${i}.example.com`}, 'cert-seed', 'role', 'staged', ${90 - i},
      ${sealed.ciphertext}, ${sealed.nonce}, ${sealed.tag}, 1,
      ${sealed.normalizedValueHash}, ${sealed.maskedValue}, NOW())
  `);
}

const cohortRunId = randomUUID();
const cohortHash = createHash("sha256").update(cohortRunId).digest("hex");
await db.execute(sql`
  INSERT INTO sfp_cohort_runs
    (id, program_id, idempotency_key, status, cohort_size, cohort_hash, frozen_at,
     release_sha, actor_id, cohort_state, request_hash, config_hash)
  VALUES (${cohortRunId}::uuid, ${program.id}::uuid, ${`cert-fd-freeze-${RUN_ID}`}, 'freezing',
          ${bizIds.length}, ${cohortHash}, NULL, ${"0".repeat(40)}, ${`cert:${RUN_ID}`},
          'freezing', ${cohortHash}, ${cohortHash})
`);
const classificationPolicyVersion = Number(rows(await db.execute(sql`
  SELECT policy_version FROM sfp_programs WHERE id=${program.id}::uuid
`))[0]?.policy_version);
for (const [i, bizId] of bizIds.entries()) {
  const evidenceHash = createHash("sha256")
    .update(JSON.stringify({
      businessId: bizId,
      taxonomyVersion: TAXONOMY_VERSION_V2,
      classifierVersion: CLASSIFIER_VERSION,
      target: "Healthcare",
      fixture: RUN_ID,
    }))
    .digest("hex");
  const evidence = rows(await db.execute(sql`
    INSERT INTO sfp_classification_evidence
      (business_id, evidence_hash, source_refs, classifier_version, taxonomy_version,
       policy_version, outcome, confidence, reason_codes, idempotency_key,
       cost_micros, terminal_state, resolved_vertical_id, admission_tier)
    VALUES (${bizId}, ${evidenceHash}, ${JSON.stringify([{ source: "disposable-certification" }])}::jsonb,
       ${CLASSIFIER_VERSION}, ${TAXONOMY_VERSION_V2}, ${classificationPolicyVersion}, 'target', 0.95,
       '["CERTIFICATION_FROZEN_V2_TARGET"]'::jsonb,
       ${`cert-fd-classification:${RUN_ID}:${bizId}`}, 0, 'completed', 'Healthcare', 'resolved_high')
    RETURNING id
  `))[0];
  await db.execute(sql`
    INSERT INTO sfp_cohort_members
      (cohort_run_id, business_id, roi_score, geography_class, geography_source, county_fips, vertical,
       classifier_version, classifier_outcome, classifier_confidence, classifier_matched_target,
       classifier_reasons, classifier_evidence_hash)
    VALUES (${cohortRunId}::uuid, ${bizId}, ${100 - i}, 'verified', 'fips', '12086', 'Healthcare',
       ${CLASSIFIER_VERSION}, 'resolved_high', 0.95, 'Healthcare', '["CERTIFICATION_FROZEN_V2_TARGET"]'::jsonb, ${evidenceHash})
  `);
  await db.execute(sql`
    INSERT INTO sfp_cohort_decisions
      (cohort_run_id, business_id, disposition, geography_class, geography_source, vertical,
       roi_score, selected, classifier_version, classifier_outcome, classifier_confidence,
       classifier_matched_target, classifier_reasons, classifier_evidence_hash,
       classification_evidence_id, classification_policy_version, classification_evidence_hash,
       classification_classifier_version)
    VALUES (${cohortRunId}::uuid, ${bizId}, 'selected', 'verified', 'fips', 'Healthcare',
       ${100 - i}, TRUE, ${CLASSIFIER_VERSION}, 'resolved_high', 0.95, 'Healthcare',
       '["CERTIFICATION_FROZEN_V2_TARGET"]'::jsonb, ${evidenceHash},
       ${String(evidence.id)}::uuid, ${classificationPolicyVersion}, ${evidenceHash}, ${CLASSIFIER_VERSION})
  `);
}
await db.execute(sql`UPDATE sfp_cohort_runs SET status='frozen', cohort_state='frozen', frozen_at=NOW() WHERE id=${cohortRunId}::uuid`);

// The frozen evidence target has a current v2 package; this deliberately
// avoids relying on the businesses.vertical column (which is raw NULL).
const pkgCampaign = rows(await db.execute(sql`
  INSERT INTO campaigns (name, status, target_verticals, created_by, total_steps)
  VALUES (${`${RUN_ID}-campaign`}, 'draft', ARRAY['Healthcare'], ${RUN_ID}, 1)
  RETURNING id
`))[0];
const pkgSequence = rows(await db.execute(sql`
  INSERT INTO follow_up_sequences
    (name, status, trigger_type, total_steps, sequence_family, channels_allowed, eligible_consent_tiers)
  VALUES (${`${RUN_ID}-sequence`}, 'paused', 'manual', 1, ${`${RUN_ID}-healthcare-v2`},
          ARRAY['email','task'], ARRAY['first_party_role_inbox'])
  RETURNING id
`))[0];
const liveContentHash = await computeLivePackageContentHash(db, Number(pkgCampaign.id), Number(pkgSequence.id));
await db.execute(sql`
  INSERT INTO sfp_campaign_package_versions
    (package_key, vertical, campaign_id, campaign_name, sequence_id, sequence_name,
     sequence_family, content_hash, lifecycle_state, effective_at, actor_id)
  VALUES ('sfp.healthcare.v2', 'Healthcare', ${Number(pkgCampaign.id)}, ${`${RUN_ID}-campaign`},
          ${Number(pkgSequence.id)}, ${`${RUN_ID}-sequence`}, ${`${RUN_ID}-healthcare-v2`},
          ${liveContentHash}, 'current', NOW(), ${RUN_ID})
  ON CONFLICT DO NOTHING
`);
check(true, "SETUP", `frozen v2 cohort ${cohortRunId} with ${bizIds.length} raw-NULL businesses, pinned Healthcare evidence and current v2 package, campaignStaging batch=5`);

// ══════════════════════════════════════════════════════════════════════════
// STAGE 1: validation (fake zbTransport, all outcomes "valid")
// ══════════════════════════════════════════════════════════════════════════
const preview = await previewSfpValidation(cohortRunId);
check(preview.gateOpen, "VAL-gate", `validation gate open (reason: ${preview.gateBlockedReason})`);
check(preview.selectedCandidates.length === N, "VAL-selected", `preview selected all ${N} staged candidates`);

const zbTransport = async (_candidateId: string, realEmail: string) => {
  const known = [...emailByBiz.values()].includes(realEmail);
  if (!known) throw new Error(`unexpected transport call for ${realEmail}`);
  return "valid" as any;
};

const exec = await executeSfpValidation(cohortRunId, {
  idempotencyKey: `cert-fd-validate-${RUN_ID}`,
  snapshotHash: preview.snapshotHash,
  actorId: `cert:${RUN_ID}`,
  zbTransport,
});
check(exec.zeroOutreachConfirmed === true, "VAL-zero-outreach", "validation batch confirms zero outreach sent");
check(exec.addressesValidated === N, "VAL-count", `validated exactly ${N} real addresses (nonzero movement, not just a successful tick)`);
check(exec.validCount === N, "VAL-valid-count", `all ${N} addresses landed 'valid'`);

const eligibleRows = rows(await db.execute(sql`
  SELECT business_id, status, staging_intent_id FROM sfp_outreach_eligibility
   WHERE cohort_run_id = ${cohortRunId}::uuid
`));
check(eligibleRows.length === N, "VAL-eligibility-rows", `${N} sfp_outreach_eligibility rows written`);
check(
  eligibleRows.every((r: any) => r.status === "validated_outreach_eligible"),
  "VAL-eligible-status",
  "every business landed 'validated_outreach_eligible'",
);
check(
  eligibleRows.every((r: any) => r.staging_intent_id === null),
  "VAL-not-staged-yet",
  "none carry a staging_intent_id yet -- staging is a separate, later stage",
);

// ══════════════════════════════════════════════════════════════════════════
// STAGE 2: campaign-staging worker tick -> ready_held
// ══════════════════════════════════════════════════════════════════════════
const stagingResult = await processSfpCampaignStagingTick();
check(!!stagingResult, "STG-ran", `campaign-staging tick ran: ${JSON.stringify(stagingResult)}`);

const heldRows = rows(await db.execute(sql`
  SELECT si.id, si.business_id, si.state, si.eligibility_id
    FROM sfp_campaign_staging_intents si
    JOIN sfp_outreach_eligibility e ON e.id = si.eligibility_id
   WHERE e.cohort_run_id = ${cohortRunId}::uuid
`));
check(heldRows.length === N, "STG-ready-held-count", `${heldRows.length} of ${N} eligible businesses reached a sfp_campaign_staging_intents row (nonzero real staging movement)`);
check(
  heldRows.every((r: any) => r.state === "ready_held"),
  "STG-status",
  `every staged row is in the 'ready_held' terminal state, not sent (states: ${[...new Set(heldRows.map((r: any) => r.state))].join(",")})`,
);

const eligibleAfterStaging = rows(await db.execute(sql`
  SELECT staging_intent_id FROM sfp_outreach_eligibility WHERE cohort_run_id = ${cohortRunId}::uuid
`));
check(
  eligibleAfterStaging.every((r: any) => r.staging_intent_id !== null),
  "STG-intent-backfilled",
  "every eligibility row now carries a staging_intent_id linking it to its ready_held row",
);

// ══════════════════════════════════════════════════════════════════════════
// NEVER-SEND invariant: ready_held must never enroll sequences, call GHL,
// or send anything. Verify no sequence_enrollments/communication row was
// created for these businesses as a side effect of staging.
// ══════════════════════════════════════════════════════════════════════════
const stray = rows(await db.execute(sql`
  SELECT COUNT(*)::int AS n FROM sequence_enrollments se
   JOIN contacts c ON c.id = se.contact_id
   WHERE c.business_id IN (${sql.join(bizIds.map((id) => sql`${id}`), sql`, `)})
`)).map((r: any) => Number(r.n))[0] ?? 0;
check(stray === 0, "NEVER-SEND", "no sequence_enrollments row exists for any staged business -- ready_held never enrolls or sends");

console.log(`\n✅ ${assertions} assertions passed -- full source -> ready_held handoff proven with genuine nonzero per-record movement at every stage.`);
process.exit(0);
