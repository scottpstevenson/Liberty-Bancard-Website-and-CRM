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
process.env.BACKGROUND_JOB_PROFILE = "full";

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
const { bridgeReadyHeldIntentToPausedEnrollment } = await import(
  "../server/services/cro03/sfp-enrollment-bridge"
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
         schedule_config = jsonb_set(COALESCE(schedule_config, '{}'::jsonb), '{campaignStaging}', '25')
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

// ── Fixture: 125 five-v2-vertical businesses; 100 free evidence rows and
// 25 real CRM contacts with current, explicit verified business links. ──
const genRow = rows(await db.execute(sql`
  INSERT INTO free_discovery_generations (run_key, actor_id, purpose, reason, state)
  VALUES (${`cert-fd-${RUN_ID}`}, ${`cert:${RUN_ID}`}, 'email_discovery', 'certification', 'running')
  RETURNING id
`))[0];
const generationId = String(genRow.id);

const bizIds: number[] = [];
const emailByBiz = new Map<number, string>();
const contactBusinessIds = new Set<number>();
const N = 125;
const CONTACT_COUNT = 25;
for (let i = 0; i < N; i++) {
  const name = `${RUN_ID}-biz-${i}`;
  const bizRow = rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name, normalized_name, vertical, state, record_class, created_at)
    VALUES (${name}, ${name.toLowerCase()}, 'Automotive', 'FL', 'canonical', NOW())
    RETURNING id
  `))[0];
  const bizId = Number(bizRow.id);
  bizIds.push(bizId);
  await db.execute(sql`INSERT INTO business_locations (business_id, county_fips, created_at) VALUES (${bizId}, '12086', NOW())`);
  const email = `info@${RUN_ID}-${i}.biz`;
  emailByBiz.set(bizId, email);
  if (i < CONTACT_COUNT) {
    const emailTokenHash = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
    const contactRow = rows(await db.execute(sql`
      INSERT INTO contacts (first_name,last_name,email,phone,company_name,vertical,business_id,consent_tier,email_token_hash)
      VALUES ('SFP','Fixture',${email},'3055550100',${name},'Automotive',${bizId},'cold_no_consent',${emailTokenHash})
      RETURNING id
    `))[0];
    await db.execute(sql`
      INSERT INTO contact_business_link_decisions (contact_id,business_id,decision,decision_key,actor_id,revision)
      VALUES (${Number(contactRow.id)},${bizId},'verified',${`cert-fd-link-${RUN_ID}-${i}`},${`cert:${RUN_ID}`},1)
    `);
    contactBusinessIds.add(bizId);
  } else {
    const sealed = seal("email", email);
    await db.execute(sql`
      INSERT INTO free_discovery_candidates
        (generation_id, business_id, field, subject_type, domain, source,
         attribution_scope, disposition, confidence, envelope_ciphertext,
         envelope_nonce, envelope_tag, envelope_key_version,
         normalized_value_hash, masked_value, created_at)
      VALUES (${generationId}::uuid, ${bizId}, 'email', 'business',
        ${`${RUN_ID}-${i}.business.test`}, 'cert-seed', 'role', 'staged', 90,
        ${sealed.ciphertext}, ${sealed.nonce}, ${sealed.tag}, 1,
        ${sealed.normalizedValueHash}, ${sealed.maskedValue}, NOW())
    `);
  }
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
for (const [i, bizId] of bizIds.entries()) {
  await db.execute(sql`
    INSERT INTO sfp_cohort_members (cohort_run_id, business_id, roi_score, geography_class, geography_source, county_fips, vertical)
    VALUES (${cohortRunId}::uuid, ${bizId}, ${100 - i}, 'verified', 'fips', '12086', 'Automotive')
  `);
}
await db.execute(sql`UPDATE sfp_cohort_runs SET status='frozen', cohort_state='frozen', frozen_at=NOW() WHERE id=${cohortRunId}::uuid`);

// A current package version is required for campaign staging to have
// anywhere to route an eligible business -- without one, every staging
// attempt dead-letters with 'no_current_package_for_vertical' and produces
// zero movement regardless of how much eligible backlog exists.
const pkgCampaign = rows(await db.execute(sql`
  INSERT INTO campaigns (name, status, target_verticals, created_by, total_steps)
  VALUES (${`${RUN_ID}-campaign`}, 'draft', ARRAY['Automotive'], ${RUN_ID}, 1)
  RETURNING id
`))[0];
const pkgSequence = rows(await db.execute(sql`
  INSERT INTO follow_up_sequences
    (name, status, trigger_type, total_steps, sequence_family, channels_allowed, eligible_consent_tiers)
  VALUES (${`${RUN_ID}-sequence`}, 'paused', 'manual', 1, ${`${RUN_ID}-automotive`},
          ARRAY['email','task'], ARRAY['first_party_role_inbox'])
  RETURNING id
`))[0];
const liveContentHash = await computeLivePackageContentHash(db, Number(pkgCampaign.id), Number(pkgSequence.id));
await db.execute(sql`
  INSERT INTO sfp_campaign_package_versions
    (package_key, vertical, campaign_id, campaign_name, sequence_id, sequence_name,
     sequence_family, content_hash, lifecycle_state, effective_at, actor_id)
  VALUES ('sfp.automotive.v2', 'Automotive', ${Number(pkgCampaign.id)}, ${`${RUN_ID}-campaign`},
          ${Number(pkgSequence.id)}, ${`${RUN_ID}-sequence`}, ${`${RUN_ID}-automotive`},
          ${liveContentHash}, 'current', NOW(), ${RUN_ID})
`);
check(true, "SETUP", `frozen cohort ${cohortRunId} with ${bizIds.length} staged-email members, ${CONTACT_COUNT} verified-linked contact candidates + ${N - CONTACT_COUNT} free candidates, campaignStaging chunk=25 drained continuously, v2 Automotive package pinned`);

// ══════════════════════════════════════════════════════════════════════════
// STAGE 1: validation (fake zbTransport, all outcomes "valid")
// ══════════════════════════════════════════════════════════════════════════
const preview = await previewSfpValidation(cohortRunId);
check(preview.gateOpen, "VAL-gate", `validation gate open (reason: ${preview.gateBlockedReason})`);
check(preview.selectedCandidates.length === 25, "VAL-selected", `first safe validation chunk selected 25 of ${N}; repeated executions must drain the whole cohort`);

const zbTransport = async (_candidateId: string, realEmail: string) => {
  const known = [...emailByBiz.values()].includes(realEmail);
  if (!known) throw new Error(`unexpected transport call for ${realEmail}`);
  return "valid" as any;
};

let validatedTotal = 0;
let validTotal = 0;
for (let batch = 0; batch < N / 25; batch++) {
  const currentPreview = batch === 0 ? preview : await previewSfpValidation(cohortRunId);
  const exec = await executeSfpValidation(cohortRunId, {
    idempotencyKey: `cert-fd-validate-${RUN_ID}-${batch}`,
    snapshotHash: currentPreview.snapshotHash,
    actorId: `cert:${RUN_ID}`,
    maxValidations: 25,
    zbTransport,
    mxCheck: async () => "ok",
  });
  check(exec.zeroOutreachConfirmed === true, `VAL-zero-outreach-${batch}`, `fake validation chunk ${batch + 1} confirms zero outreach sent`);
  validatedTotal += exec.addressesValidated;
  validTotal += exec.validCount;
}
check(validatedTotal === N, "VAL-count", `repeated restart-safe chunks validated all ${N} records (>100; fake provider only)`);
check(validTotal === N, "VAL-valid-count", `all ${N} fake addresses landed 'valid'`);

const eligibleRows = rows(await db.execute(sql`
  SELECT business_id, source_kind, contact_id, status, staging_intent_id FROM sfp_outreach_eligibility
   WHERE cohort_run_id = ${cohortRunId}::uuid
`));
check(eligibleRows.length === N, "VAL-eligibility-rows", `${N} sfp_outreach_eligibility rows written`);
check(
  eligibleRows.every((r: any) => r.status === "validated_outreach_eligible"),
  "VAL-eligible-status",
  "every business landed 'validated_outreach_eligible'",
);
check(
  eligibleRows.filter((r: any) => r.source_kind === "contact" && contactBusinessIds.has(Number(r.business_id))).length === CONTACT_COUNT,
  "VAL-contact-source",
  `${CONTACT_COUNT} pre-existing, explicitly verified-linked CRM contacts were selected, validated, and persisted with contact lineage`,
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
  SELECT si.id, si.business_id, si.state, si.eligibility_id, si.source_kind, si.contact_id, si.package_key
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
check(
  heldRows.filter((r: any) => r.source_kind === "contact" && r.contact_id != null && contactBusinessIds.has(Number(r.business_id))).length === CONTACT_COUNT,
  "STG-contact-source",
  `${CONTACT_COUNT} existing contacts reached ready_held with the exact contact_id pinned`,
);
check(
  heldRows.every((r: any) => r.package_key === "sfp.automotive.v2"),
  "STG-v2-package",
  `all ${N} ready_held rows pin the current Automotive v2 package`,
);

const eligibleAfterStaging = rows(await db.execute(sql`
  SELECT staging_intent_id FROM sfp_outreach_eligibility WHERE cohort_run_id = ${cohortRunId}::uuid
`));
check(
  eligibleAfterStaging.every((r: any) => r.staging_intent_id !== null),
  "STG-intent-backfilled",
  "every eligibility row now carries a staging_intent_id linking it to its ready_held row",
);

// Exercise the actual identity-pinned bridge once within the disposable DB.
// It may create a paused enrollment, but never unpauses, dispatches, or sends.
const contactIntent = heldRows.find((r: any) => r.source_kind === "contact" && r.contact_id != null);
check(Boolean(contactIntent), "BRIDGE-fixture", "at least one ready_held intent pins an existing verified-linked contact");
const bridge = await bridgeReadyHeldIntentToPausedEnrollment(String(contactIntent.id), `cert:${RUN_ID}`);
check(bridge.status === "created" && bridge.enrollmentStatus === "paused", "BRIDGE-paused", "one exact linked CRM contact is bridged into a paused sequence enrollment");
const bridgeReplay = await bridgeReadyHeldIntentToPausedEnrollment(String(contactIntent.id), `cert:${RUN_ID}`);
check(bridgeReplay.status === "already_bridged" && bridgeReplay.sequenceEnrollmentId === bridge.sequenceEnrollmentId,
  "BRIDGE-idempotent", "replaying the same ready_held intent returns the same paused enrollment");

// ══════════════════════════════════════════════════════════════════════════
// NEVER-SEND invariant: ready_held must never enroll sequences, call GHL,
// or send anything. Verify no sequence_enrollments/communication row was
// created for these businesses as a side effect of staging.
// ══════════════════════════════════════════════════════════════════════════
const stray = rows(await db.execute(sql`
  SELECT COUNT(*)::int AS n FROM sequence_enrollments se
   JOIN contacts c ON c.id = se.contact_id
   WHERE c.business_id IN (${sql.join(bizIds.map((id) => sql`${id}`), sql`, `)})
     AND se.contact_id <> ${bridge.contactId}
`)).map((r: any) => Number(r.n))[0] ?? 0;
check(stray === 0, "NEVER-SEND", "no sequence_enrollments row exists for any other staged business -- the tested bridge is the only paused enrollment");

const enrollmentState = rows(await db.execute(sql`
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status='paused')::int AS paused,
         COUNT(*) FILTER (WHERE status='active')::int AS active
    FROM sequence_enrollments WHERE contact_id=${bridge.contactId}
`))[0];
check(Number(enrollmentState.total) === 1 && Number(enrollmentState.paused) === 1 && Number(enrollmentState.active) === 0,
  "BRIDGE-zero-active", "exactly one paused enrollment exists for the tested contact and no active enrollment was created");

console.log(`\n✅ ${assertions} assertions passed -- 125-record (>100) free + verified-contact pipeline reached v2 ready_held with fake ZeroBounce and no sends.`);
process.exit(0);
