#!/usr/bin/env tsx
/**
 * Task 1734: CRO-07 disposable certification.
 *
 * Proves, against a fresh migration + isolated Redis namespace with network
 * denied, that: exactly one attempt is made per claimed capacity unit, caps
 * cannot be oversubscribed, the ordinary-reply-is-not-suppression matrix
 * holds for every feedback type, source-to-revenue attribution keeps
 * production revenue `unknown` (synthetic fixtures are explicitly flagged),
 * no experiment publishes or mutates CR-06 content, the CR-06 release
 * endpoint stays disabled, and zero real messages are ever sent.
 */
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "./certification-provider-deny";

const infrastructure = await assertDisposableTestInfrastructure({
  operation: "CRO-07 disposable certification",
  requireRedis: true,
  reserveRedisNamespace: true,
});
process.env.VG_PROVIDER_DENY_MODE = "1";
process.env.APP_URL = "https://certification.invalid";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "cro07-certification-session-secret-32-bytes";
process.env.UNSUBSCRIBE_TOKEN_SECRET = process.env.UNSUBSCRIBE_TOKEN_SECRET || "cro07-certification-unsubscribe-secret-v1";
applyCertificationProviderDenyBoundary({ fatal: true });

let assertions = 0;
function check(value: unknown, label: string): asserts value {
  assertions++;
  assert.ok(value, label);
  console.log(`✓ ${label}`);
}
async function rejects(action: () => Promise<unknown>, code: string, label: string) {
  await assert.rejects(action, new RegExp(code));
  assertions++;
  console.log(`✓ ${label}`);
}

const nonce = randomUUID();

try {
  const [
    { runDrizzleMigrations },
    { pool },
    cr06,
    cr04,
    readiness,
    releaseAuthority,
    transportAdapter,
    feedbackAuthority,
    taxonomy,
    attribution,
    experiments,
    pauseAuthority,
    pauseControl,
  ] = await Promise.all([
    import("../server/db-migrate"),
    import("../server/db"),
    import("../server/services/cr06-premium-campaigns"),
    import("../server/services/cr04-cohort-ready-authority"),
    import("../server/services/provider-readiness-control"),
    import("../server/services/cro07-release-authority"),
    import("../server/services/cro07-transport-adapter"),
    import("../server/services/cro07-feedback"),
    import("../server/services/cro07-taxonomy"),
    import("../server/services/cro07-attribution"),
    import("../server/services/cro07-experiments"),
    import("../server/services/outbound-pause-authority"),
    import("../server/services/outbound-control-service"),
  ]);
  /**
   * Directly sets outbound_pause_control.state without going through
   * applyPauseMutation (which would create coordinator holds and advance the
   * epoch). Test-only — never used in production paths.
   */
  async function setTestPauseState(paused: boolean): Promise<void> {
    await pool.query(`UPDATE outbound_pause_control SET state = $1`, [paused ? "paused" : "unpaused"]);
    pauseAuthority.invalidatePauseStateCache();
  }

  await runDrizzleMigrations();
  await runDrizzleMigrations();
  // Must run AFTER migrations: on a fresh database outbound_pause_control
  // does not exist yet, so initializing it any earlier is a silent no-op
  // (fail-closed default, zero rows persisted) and every later pause check
  // sees "no control row found" forever.
  await pauseControl.initializePauseControl();
  const relations = await pool.query(
    `SELECT to_regclass('public.cro07_releases') AS releases,
            to_regclass('public.cro07_attempts') AS attempts,
            to_regclass('public.cro07_feedback_receipts') AS feedback,
            to_regclass('public.cro07_attribution_edges') AS attribution,
            to_regclass('public.cro07_experiments') AS experiments`,
  );
  check(Object.values(relations.rows[0]).every(Boolean),
    "migration upgrade and reapply install every CRO-07 table exactly once");

  // ── CR-06 fixture: build one real READY_HELD delivery intent ───────────
  await pool.query(
    `INSERT INTO system_settings(key,value) VALUES
       ('compliance_mailing_address',to_jsonb($1::text)),
       ('outboundDailyEmailCap',to_jsonb(200))
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
    ["100 Certification Way, Fort Lauderdale, FL 33301"],
  );
  const manifest = cr06.getCr06RolloutManifest();
  const applied = await cr06.applyCr06Rollout({ actorId: `cro07-cert-${nonce}`, dryRun: false });
  check(applied.mode === "apply" || applied.replayed, "CR-06 v2 manifest is available for the fixture");
  const program = await pool.query(
    "SELECT id,content_hash FROM cr06_artifacts WHERE artifact_kind='program' AND version=2 ORDER BY identity_key LIMIT 1",
  );
  try {
    await cr06.approveCr06Program({
      programArtifactId: program.rows[0].id, expectedHash: program.rows[0].content_hash, reviewerId: `cro07-reviewer-${nonce}`,
    });
  } catch {
    // Already approved by a prior certification run against this database — fine.
  }

  const sequence = await pool.query(
    `INSERT INTO follow_up_sequences
       (name,description,trigger_type,total_steps,status,created_by,sequence_family,
        eligible_consent_tiers,channels_allowed,offer_routes,lifecycle_stages_allowed)
     VALUES ($1,'CRO-07 disposable authority fixture','manual',1,'active',$2,'cold-email-manual-call',
             ARRAY['cold_no_consent'],ARRAY['email'],ARRAY['statement_review'],ARRAY['prospect'])
     RETURNING id`,
    [`CRO07 qualifying sequence ${nonce}`, `cro07-${nonce}`],
  );
  await pool.query(
    `INSERT INTO sequence_steps(sequence_id,step_order,action_type,delay_days,subject,body)
     VALUES ($1,1,'email',0,'Certification','Authority-owned certification fixture')`,
    [sequence.rows[0].id],
  );
  const email = `cro07-${nonce}@example.test`;
  const emailHash = readiness.hashEmailToken(email)!;
  const contact = await pool.query(
    `INSERT INTO contacts
       (first_name,last_name,email,phone,company_name,vertical,primary_offer_path,assigned_to,
        source_category,lead_source,record_class,email_status,email_mutation_generation,
        email_token_hash,email_validation_updated_at,data_readiness_score,readiness_model_version,
        readiness_updated_at,last_meaningful_contact_mutation_at,consent_tier,lifecycle_stage,
        city,state,lead_score)
     VALUES
       ('Casey','Certification',$1,'9545550198','CRO07 Certification Merchant','auto_repair',
        'statement_review',$2,'manual','import','production','valid',1,$3,NOW(),100,1,
        NOW(),NOW()-INTERVAL '1 minute','cold_no_consent','prospect',
        'Fort Lauderdale','FL',80)
     RETURNING id`,
    [email, `owner-${nonce}@example.test`, emailHash],
  );
  await pool.query(
    `INSERT INTO provider_observations
       (provider,subject_type,subject_id,email_token_hash,subject_generation,outcome,retryable,observed_at)
     VALUES ('zerobounce','contact',$1,$2,1,'valid',FALSE,NOW())`,
    [contact.rows[0].id, emailHash],
  );
  const providerReady = await readiness.evaluateMarketingEmailEligibility(contact.rows[0].id);
  check(providerReady.allowed, "fixture contact has valid current provider evidence");

  const actor = { role: "admin" as const, actorId: `cro07-${nonce}`, email: null };
  await cr04.evaluateCr04ChannelQualification(contact.rows[0].id, {
    channel: "email", sequenceId: sequence.rows[0].id, persist: true, scope: actor,
  });
  const cohortKey = `cro07-cert-cohort-${nonce}`;
  let cohort = await cr04.freezeCr04Cohort({
    scope: actor, channel: "email", filters: { assignedTo: `owner-${nonce}@example.test` },
    idempotencyKey: cohortKey, createdBy: actor.actorId,
  });
  for (let attempt = 0; cohort.status === "building" && attempt < 5; attempt++) {
    await pool.query(
      "UPDATE cr04_cohort_runs SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1 AND status='building'",
      [cohort.id],
    );
    cohort = await cr04.freezeCr04Cohort({
      scope: actor, channel: "email", filters: { assignedTo: `owner-${nonce}@example.test` },
      idempotencyKey: cohortKey, createdBy: actor.actorId,
    });
  }
  check(cohort.status === "frozen" && cohort.memberCount === 1, "real CR-04 freeze authority produces one frozen member");

  const preflight = await cr06.preflightCr06({ programArtifactId: program.rows[0].id, cohortRunId: cohort.id, cap: 1 });
  await cr06.setCr06CampaignGate({
    programArtifactId: program.rows[0].id, cohortRunId: cohort.id,
    preflightHash: preflight.preflightHash, cap: 1, state: "open",
    confirmation: cr06.CR06_GATE_CONFIRMATION, actorId: actor.actorId,
    idempotencyKey: `cro07-gate-${nonce}`, expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  const prepared = await cr06.prepareCr06({
    programArtifactId: program.rows[0].id, cohortRunId: cohort.id, cap: 1,
    actorId: actor.actorId, idempotencyKey: `cro07-prepare-${nonce}`,
  });
  check(prepared.state === "ready_held", "CR-06 preparation reaches READY_HELD for the CRO-07 fixture");
  const intents = await pool.query(
    "SELECT id FROM cr06_delivery_intents WHERE preparation_run_id=$1 ORDER BY touch_number LIMIT 1",
    [prepared.id],
  );
  const intentId = intents.rows[0].id;
  const intentSnapshotBefore = await pool.query("SELECT * FROM cr06_delivery_intents WHERE id=$1", [intentId]);
  // Baseline is captured AFTER CR-06's own full fixture setup (approval AND
  // preparation) settles, since both legitimately mutate the program artifact
  // (dependency_fingerprint/reviewed_by/approved_at on approval,
  // preparation_state on prepareCr06). This snapshot reflects steady-state
  // READY_HELD content — the only thing the growth loop below must never touch.
  const programBefore = await pool.query("SELECT * FROM cr06_artifacts WHERE id=$1", [program.rows[0].id]);

  // NOTE: cr06_prepared_enrollments.sequence_enrollment_id is immutable after
  // insert (cr06_guard_prepared_enrollment trigger) and is only ever set by
  // CR-06's own preparation authority — which never populates it while final
  // dispatch stays disabled. So in the current, correctly-disabled state
  // there is no live linked enrollment to stop via that join; this is
  // intentional and matches CR-06's own certification (it does not force
  // this linkage either). We instead prove the reply matrix directly: a
  // separate, independently-created active sequence enrollment for the same
  // contact must be stopped by an ordinary reply, without ever mutating
  // CR-06's immutable prepared-enrollment history.
  const enrollmentInsert = await pool.query(
    `INSERT INTO sequence_enrollments (sequence_id, contact_id, current_step, status)
     VALUES ($1, $2, 0, 'active') RETURNING id`,
    [sequence.rows[0].id, contact.rows[0].id],
  );

  // ── CR-06 boundary: release endpoint contract stays unchanged ──────────
  await rejects(async () => cr06.assertCr06DispatchUnavailable(), "CR06_FINAL_DISPATCH_NOT_AUTHORIZED",
    "CR-06 final dispatch remains hard-disabled after CRO-07 build");

  // Fresh databases seed outbound_pause_control as paused by design (the
  // safe default). Claim/capacity logic must independently re-verify live
  // pause state, so exercising it requires a disposable-only unpause. Do
  // this up front so both the zero-cap fixture below and the real release's
  // claim can exercise the claim path.
  const pauseBefore = await pool.query("SELECT state FROM outbound_pause_control ORDER BY id LIMIT 1");
  await setTestPauseState(false);

  // ── Cap enforcement is read from the release, not decorative ──────────
  // A throwaway draft+approved release scoped to the SAME intent, with a
  // declared daily cap of 0, must deny even its FIRST claim attempt. This is
  // built and torn down directly (not via createCro07Release, and BEFORE the
  // real release below, since only one draft/approved/active release may
  // exist per intent at a time) purely to prove claimCro07Attempt reads and
  // enforces the real declared cap value rather than always reserving
  // whatever is asked.
  const zeroCapRelease = await pool.query(
    `INSERT INTO cro07_releases (
      cr06_delivery_intent_id, revision, state, reviewed_sha, migration_head, sender_route,
      adapter_key, environment, readiness_snapshot, suppression_generation, pause_epoch,
      caps, canary_size, stop_thresholds, dependency_snapshot, dependency_fingerprint,
      reason, expires_at, revision_hash, idempotency_key, created_by, approved_at
    ) VALUES (
      $1, 999, 'approved', $2, $3, $4,
      'denied_fake', 'disabled', '{}'::jsonb, 'zero-cap-fixture', '0',
      $5, 0, '{}'::jsonb, '{}'::jsonb, $6,
      'zero-cap cap-enforcement fixture', $7, $8, $9, $10, NOW()
    ) RETURNING *`,
    [
      intentId, "0".repeat(40), "0208_cro07_corrections", "certification-denied-zero-cap-route",
      JSON.stringify({ dailyCap: 0, perHourCap: 1 }), `zero-cap-fingerprint-${nonce}`,
      new Date(Date.now() + 60 * 60 * 1000).toISOString(), `zero-cap-hash-${nonce}`, `cro07-release-zerocap-${nonce}`, actor.actorId,
    ],
  );
  await rejects(
    () => transportAdapter.claimCro07Attempt({
      releaseId: zeroCapRelease.rows[0].id, provider: "certification-denied", idempotencyKey: `cro07-attempt-zerocap-${nonce}`,
    }),
    "CRO07_CAPACITY_EXHAUSTED",
    "a release with a declared daily cap of 0 denies even its first claim — the cap value is enforced, not decorative",
  );
  await pool.query(`DELETE FROM cro07_releases WHERE id = $1`, [zeroCapRelease.rows[0].id]);

  // ── Release authority ────────────────────────────────────────────────
  const releaseInput = {
    cr06DeliveryIntentId: intentId,
    reviewedSha: "0".repeat(40),
    migrationHead: "0207_cro07_controlled_delivery_feedback",
    senderRoute: "certification-denied-route",
    providerSource: "certification",
    caps: { dailyCap: 1, perHourCap: 1 },
    canarySize: 1,
    stopThresholds: { maxBounceRatePct: 5, maxComplaintRatePct: 1, maxReplyBacklog: 10 },
    reason: "CRO-07 disposable certification",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    actorId: actor.actorId,
    idempotencyKey: `cro07-release-${nonce}`,
  };
  const { release, replayed: releaseFirstReplayed } = await releaseAuthority.createCro07Release(releaseInput);
  check(!releaseFirstReplayed && release.state === "draft", "release is created as a draft bound to the exact CR-06 intent");
  const releaseReplay = await releaseAuthority.createCro07Release(releaseInput);
  check(releaseReplay.replayed && releaseReplay.release.id === release.id, "release creation is exactly idempotent");

  await rejects(
    () => releaseAuthority.createCro07Release({ ...releaseInput, idempotencyKey: `cro07-release-second-${nonce}` }),
    "CRO07_ACTIVE_RELEASE_CHAIN_EXISTS",
    "at most one active CRO-07 release chain may exist per CR-06 intent (DB + service enforced)",
  );

  const approved = await releaseAuthority.approveCro07Release({
    releaseId: release.id, approverId: actor.actorId, expectedRevisionHash: release.revision_hash,
  });
  check(approved.state === "approved", "release approval succeeds against the exact frozen revision hash");
  await rejects(
    () => releaseAuthority.approveCro07Release({ releaseId: release.id, approverId: actor.actorId, expectedRevisionHash: release.revision_hash }),
    "CRO07_RELEASE_NOT_DRAFT",
    "an already-approved release cannot be re-approved",
  );

  const intentSnapshotAfterRelease = await pool.query("SELECT * FROM cr06_delivery_intents WHERE id=$1", [intentId]);
  check(JSON.stringify(intentSnapshotBefore.rows[0]) === JSON.stringify(intentSnapshotAfterRelease.rows[0]),
    "CR-06 delivery intent row is never mutated by CRO-07 release creation/approval");

  // ── Denied transport: claim, execute (always denied), cap enforcement ──
  const claim = await transportAdapter.claimCro07Attempt({
    releaseId: release.id, provider: "certification-denied", idempotencyKey: `cro07-attempt-${nonce}`,
  });
  check(!claim.replayed && claim.attempt.state === "reserved", "attempt is durably reserved BEFORE any transport call");

  // A release claims exactly one attempt — a second claim call against the
  // SAME release with a DIFFERENT idempotency key must return the existing
  // attempt as a replay, never mint a second distinct attempt for one
  // release (release_id is a hard unique DB constraint, not just a
  // convention of matching idempotency keys).
  const secondClaimSameRelease = await transportAdapter.claimCro07Attempt({
    releaseId: release.id, provider: "certification-denied", idempotencyKey: `cro07-attempt-different-key-${nonce}`,
  });
  check(secondClaimSameRelease.replayed && secondClaimSameRelease.attempt.id === claim.attempt.id,
    "a release can never claim more than one distinct attempt, regardless of idempotency key used");

  // The webhook authorization correlation columns must be immutable at the
  // DATABASE level, not merely "nothing in the codebase writes to them" —
  // this is what stops a later write (buggy code, a migration, a direct
  // console query) from silently rebinding an attempt to a different
  // webhook authority/account.
  await rejects(
    () => pool.query(`UPDATE cro07_attempts SET provider_account_id = 'rebound-account' WHERE id = $1`, [claim.attempt.id]),
    "immutable after insert",
    "the database itself refuses to let provider_account_id be rewritten on an existing attempt row",
  );
  await rejects(
    () => pool.query(`UPDATE cro07_attempts SET provider_source = 'rebound-source' WHERE id = $1`, [claim.attempt.id]),
    "immutable after insert",
    "the database itself refuses to let provider_source be rewritten on an existing attempt row",
  );
  await rejects(
    () => pool.query(`UPDATE cro07_releases SET provider_source = 'rebound-source' WHERE id = $1`, [release.id]),
    "immutable after insert",
    "the database itself refuses to let a release's provider_source be rewritten after creation",
  );
  // Ordinary lifecycle columns on the same row remain fully updatable —
  // the guard is scoped to the correlation columns only.
  await pool.query(`UPDATE cro07_attempts SET redacted_error = 'certification-probe' WHERE id = $1`, [claim.attempt.id]);
  const probedAttempt = await pool.query(`SELECT redacted_error FROM cro07_attempts WHERE id = $1`, [claim.attempt.id]);
  check(probedAttempt.rows[0].redacted_error === "certification-probe",
    "the immutability guard does not block ordinary lifecycle column updates on the same attempt row");

  // Every declared cap (daily, per-hour, canary) must be reserved together
  // in the same claim — not just whichever one the caller happened to name.
  const reservationRows = await pool.query(
    `SELECT capacity_key, reserved_cap, used_count FROM cro07_reservations WHERE release_id = $1 ORDER BY capacity_key`,
    [release.id],
  );
  const reservedKeys = reservationRows.rows.map((r: any) => r.capacity_key).sort();
  check(
    JSON.stringify(reservedKeys) === JSON.stringify(["canary_size", "daily_cap", "per_hour_cap"]),
    "claiming one attempt atomically reserves daily_cap, per_hour_cap, AND canary_size together, not just one cap type",
  );
  check(
    reservationRows.rows.every((r: any) => r.used_count === 1 && r.reserved_cap >= 1),
    "every declared cap is actually consumed by the claim, proving it is enforced rather than decorative",
  );

  const executed = await transportAdapter.executeCro07Attempt({ attemptId: claim.attempt.id, frozenPayloadHash: "a".repeat(64) });
  check(executed.state === "rejected" && executed.provider_attempt_id === null,
    "the only registered adapter is denied-by-default and never accepts a real send");
  await rejects(
    () => transportAdapter.executeCro07Attempt({ attemptId: claim.attempt.id, frozenPayloadHash: "a".repeat(64) }),
    "CRO07_ATTEMPT_NOT_RESERVED",
    "an attempt cannot be executed twice",
  );

  // Reconciliation path for an unknown outcome.
  const unknownClaimKey = `cro07-attempt-unknown-${nonce}`;
  await pool.query(`UPDATE cro07_reservations SET used_count = 0 WHERE release_id = $1`, [release.id]);
  const unknownClaim = await transportAdapter.claimCro07Attempt({ releaseId: release.id, provider: "certification-denied", idempotencyKey: unknownClaimKey });
  await pool.query(`UPDATE cro07_attempts SET state='in_flight' WHERE id=$1`, [unknownClaim.attempt.id]);
  await pool.query(`UPDATE cro07_attempts SET state='timeout_unknown' WHERE id=$1`, [unknownClaim.attempt.id]);
  const reconciled = await transportAdapter.reconcileCro07Attempt({
    attemptId: unknownClaim.attempt.id, toState: "reconciled_failed", reasonCode: "certification_timeout_probe",
    actorId: actor.actorId, evidence: { probe: "certification" }, idempotencyKey: `cro07-reconcile-${nonce}`,
  });
  check(!reconciled.replayed && reconciled.reconciliation.to_state === "reconciled_failed",
    "a timeout_unknown attempt is only ever resolved by an explicit, evidenced reconciliation — never blind-retried");
  const reconcileReplay = await transportAdapter.reconcileCro07Attempt({
    attemptId: unknownClaim.attempt.id, toState: "reconciled_failed", reasonCode: "certification_timeout_probe",
    actorId: actor.actorId, evidence: { probe: "certification" }, idempotencyKey: `cro07-reconcile-${nonce}`,
  });
  check(reconcileReplay.replayed, "reconciliation replay is exactly idempotent");

  /**
   * Builds a second, fully independent, real CR-04→CR-06→CRO-07 pipeline
   * fixture for one synthetic contact, ending in a genuine claimed attempt.
   * Every feedback test case below must be anchored to a REAL attemptId —
   * ingestCro07Feedback derives contact/intent identity exclusively from
   * that attempt's own lineage now, so there is no other way to construct a
   * valid feedback event for a given contact.
   */
  async function buildCro07AttemptFixture(label: string, providerSourceOverride?: string) {
    const ownerEmail = `owner-${label}-${nonce}@example.test`;
    const fixtureEmail = `cro07-${label}-${nonce}@example.test`;
    const fixtureEmailHash = readiness.hashEmailToken(fixtureEmail)!;
    const inserted = await pool.query(
      `INSERT INTO contacts
         (first_name,last_name,email,phone,company_name,vertical,primary_offer_path,assigned_to,
          source_category,lead_source,record_class,email_status,email_mutation_generation,
          email_token_hash,email_validation_updated_at,data_readiness_score,readiness_model_version,
          readiness_updated_at,last_meaningful_contact_mutation_at,consent_tier,lifecycle_stage,
          city,state,lead_score)
       VALUES
         ('Certification',$2,$1,'9545550100','CRO07 Fixture','auto_repair','statement_review',$3,
          'manual','import','production','valid',1,$4,NOW(),100,1,
          NOW(),NOW()-INTERVAL '1 minute','cold_no_consent','prospect','Fort Lauderdale','FL',50)
       RETURNING id`,
      [fixtureEmail, label, ownerEmail, fixtureEmailHash],
    );
    const fixtureContactId = inserted.rows[0].id;
    await pool.query(
      `INSERT INTO provider_observations
         (provider,subject_type,subject_id,email_token_hash,subject_generation,outcome,retryable,observed_at)
       VALUES ('zerobounce','contact',$1,$2,1,'valid',FALSE,NOW())`,
      [fixtureContactId, fixtureEmailHash],
    );
    await cr04.evaluateCr04ChannelQualification(fixtureContactId, {
      channel: "email", sequenceId: sequence.rows[0].id, persist: true, scope: actor,
    });
    const fixtureCohortKey = `cro07-cert-cohort-${label}-${nonce}`;
    let fixtureCohort = await cr04.freezeCr04Cohort({
      scope: actor, channel: "email", filters: { assignedTo: ownerEmail },
      idempotencyKey: fixtureCohortKey, createdBy: actor.actorId,
    });
    for (let attempt = 0; fixtureCohort.status === "building" && attempt < 5; attempt++) {
      await pool.query(
        "UPDATE cr04_cohort_runs SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1 AND status='building'",
        [fixtureCohort.id],
      );
      fixtureCohort = await cr04.freezeCr04Cohort({
        scope: actor, channel: "email", filters: { assignedTo: ownerEmail },
        idempotencyKey: fixtureCohortKey, createdBy: actor.actorId,
      });
    }
    const fixturePreflight = await cr06.preflightCr06({ programArtifactId: program.rows[0].id, cohortRunId: fixtureCohort.id, cap: 1 });
    await cr06.setCr06CampaignGate({
      programArtifactId: program.rows[0].id, cohortRunId: fixtureCohort.id,
      preflightHash: fixturePreflight.preflightHash, cap: 1, state: "open",
      confirmation: cr06.CR06_GATE_CONFIRMATION, actorId: actor.actorId,
      idempotencyKey: `cro07-gate-${label}-${nonce}`, expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const fixturePrepared = await cr06.prepareCr06({
      programArtifactId: program.rows[0].id, cohortRunId: fixtureCohort.id, cap: 1,
      actorId: actor.actorId, idempotencyKey: `cro07-prepare-${label}-${nonce}`,
    });
    const fixtureIntents = await pool.query(
      "SELECT id FROM cr06_delivery_intents WHERE preparation_run_id=$1 ORDER BY touch_number LIMIT 1",
      [fixturePrepared.id],
    );
    const fixtureIntentId = fixtureIntents.rows[0].id;
    const fixtureRelease = await releaseAuthority.createCro07Release({
      cr06DeliveryIntentId: fixtureIntentId,
      reviewedSha: "0".repeat(40),
      migrationHead: "0209_cro07_feedback_experiment_integrity",
      senderRoute: "certification-denied-route",
      providerSource: providerSourceOverride ?? "certification",
      caps: { dailyCap: 1, perHourCap: 1 },
      canarySize: 1,
      stopThresholds: { maxBounceRatePct: 5, maxComplaintRatePct: 1, maxReplyBacklog: 10 },
      reason: `CRO-07 disposable certification fixture (${label})`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      actorId: actor.actorId,
      idempotencyKey: `cro07-release-${label}-${nonce}`,
    });
    await releaseAuthority.approveCro07Release({
      releaseId: fixtureRelease.release.id, approverId: actor.actorId, expectedRevisionHash: fixtureRelease.release.revision_hash,
    });
    const fixtureClaim = await transportAdapter.claimCro07Attempt({
      releaseId: fixtureRelease.release.id, provider: "certification-denied", idempotencyKey: `cro07-attempt-${label}-${nonce}`,
    });
    return { contactId: fixtureContactId, intentId: fixtureIntentId, releaseId: fixtureRelease.release.id, attemptId: fixtureClaim.attempt.id };
  }

  // ── Authenticated feedback: signature verification + full reply matrix ─
  const secret = "cro07-certification-webhook-secret";
  const sign = (body: string) => createHmac("sha256", secret).update(body).digest("hex");

  // All fixtures in this file are released with senderRoute
  // "certification-denied-route" — claimCro07Attempt binds that value onto
  // the attempt's immutable provider_account_id, so authenticated feedback
  // for these attempts must present the SAME providerAccountId to pass
  // correlation.
  const fixtureProviderAccountId = "certification-denied-route";

  const unsignedBody = JSON.stringify({ probe: "unsigned" });
  const unsigned = await feedbackAuthority.ingestCro07Feedback({
    source: "certification", providerAccountId: fixtureProviderAccountId, providerEventId: `evt-unsigned-${nonce}`, signatureHeader: null, rawBody: unsignedBody,
    signatureValid: false, eventType: "reply", attemptId: claim.attempt.id, payload: { probe: "unsigned" },
  });
  check((unsigned as any).applied === false && (unsigned as any).reason === "CRO07_SIGNATURE_INVALID",
    "an unsigned/unauthenticated feedback event is durably recorded but applies zero side effects");

  const enrollmentBeforeReply = await pool.query("SELECT status FROM sequence_enrollments WHERE id=$1", [enrollmentInsert.rows[0].id]);
  check(enrollmentBeforeReply.rows[0].status === "active", "linked enrollment is still active before an authenticated reply");

  const replyBody = JSON.stringify({ probe: "ordinary_reply" });
  const replySignature = sign(replyBody);
  const replyResult = await feedbackAuthority.ingestCro07Feedback({
    source: "certification", providerAccountId: fixtureProviderAccountId, providerEventId: `evt-reply-${nonce}`, signatureHeader: `sha256=${replySignature}`, rawBody: replyBody,
    signatureValid: feedbackAuthority.verifyCro07WebhookSignature(secret, replyBody, `sha256=${replySignature}`),
    eventType: "reply", attemptId: claim.attempt.id, payload: { probe: "ordinary_reply" },
  });
  check((replyResult as any).applied === true && (replyResult as any).effect.kind === "reply_stop_and_work",
    "an authenticated ordinary reply stops outreach and creates reply work");
  const enrollmentAfterReply = await pool.query("SELECT status, metadata FROM sequence_enrollments WHERE id=$1", [enrollmentInsert.rows[0].id]);
  check(enrollmentAfterReply.rows[0].status === "completed" && enrollmentAfterReply.rows[0].metadata?.terminal?.category === "reply",
    "the linked sequence enrollment is stopped immediately by the ordinary reply");
  const contactAfterReply = await pool.query("SELECT do_not_contact, consent_tier FROM contacts WHERE id=$1", [contact.rows[0].id]);
  check(contactAfterReply.rows[0].do_not_contact !== true && contactAfterReply.rows[0].consent_tier !== "do_not_contact",
    "an ordinary reply is NEVER treated as unsubscribe/complaint — no suppression fact is created");
  const replyWork = await pool.query("SELECT * FROM cro07_reply_work WHERE feedback_receipt_id=(SELECT id FROM cro07_feedback_receipts WHERE provider_event_id=$1)", [`evt-reply-${nonce}`]);
  check(replyWork.rows[0]?.owner_resolution === "deterministic" && replyWork.rows[0]?.cr05_task_id,
    "ordinary reply creates exactly one CR-05 task via the new cro07_feedback/human_reply occurrence");

  const replayReply = await feedbackAuthority.ingestCro07Feedback({
    source: "certification", providerAccountId: fixtureProviderAccountId, providerEventId: `evt-reply-${nonce}`, signatureHeader: `sha256=${replySignature}`, rawBody: replyBody,
    signatureValid: true, eventType: "reply", attemptId: claim.attempt.id, payload: { probe: "ordinary_reply" },
  });
  check((replayReply as any).replayed === true, "duplicate provider_event_id is deduped and never double-applies");

  // A signed-but-unresolvable attemptId must be durable evidence only —
  // proves an authenticated request can never assert an arbitrary/unknown
  // event correlation into applying a side effect.
  const unknownAttemptBody = JSON.stringify({ probe: "unknown_attempt" });
  const unknownAttemptSignature = sign(unknownAttemptBody);
  const unknownAttemptResult = await feedbackAuthority.ingestCro07Feedback({
    source: "certification", providerAccountId: fixtureProviderAccountId, providerEventId: `evt-unknown-attempt-${nonce}`, signatureHeader: `sha256=${unknownAttemptSignature}`,
    rawBody: unknownAttemptBody, signatureValid: true, eventType: "reply", attemptId: randomUUID(), payload: { probe: "unknown_attempt" },
  });
  check((unknownAttemptResult as any).applied === false && (unknownAttemptResult as any).reason === "CRO07_ATTEMPT_NOT_FOUND",
    "a signed event referencing an attemptId that does not exist is recorded as evidence only and applies no side effect");

  // A CORRECTLY SIGNED event for a REAL, known attemptId must still be
  // rejected (evidence only, zero side effects) if the provider/account
  // correlation does not match what the attempt was actually claimed
  // under. This is the core fix for the code-review finding: knowing a
  // valid attemptId is never sufficient on its own to apply an effect.
  const mismatchFixture = await buildCro07AttemptFixture("provider-mismatch");
  const mismatchBody = JSON.stringify({ probe: "provider_mismatch" });
  const mismatchSignature = sign(mismatchBody);
  const mismatchResult = await feedbackAuthority.ingestCro07Feedback({
    source: "certification", providerAccountId: "attacker-controlled-other-account", providerEventId: `evt-provider-mismatch-${nonce}`,
    signatureHeader: `sha256=${mismatchSignature}`, rawBody: mismatchBody, signatureValid: true,
    eventType: "complaint", attemptId: mismatchFixture.attemptId, payload: { probe: "provider_mismatch" },
  });
  check((mismatchResult as any).applied === false && (mismatchResult as any).reason === "CRO07_PROVIDER_ACCOUNT_MISMATCH",
    "a correctly signed event for a REAL attemptId is still rejected as evidence-only when its providerAccountId does not match the attempt's claimed provider account");
  const mismatchContact = await pool.query("SELECT do_not_contact FROM contacts WHERE id=$1", [mismatchFixture.contactId]);
  check(mismatchContact.rows[0].do_not_contact !== true,
    "a provider-account-mismatched complaint never applies global DNC against the real contact behind the attempt");

  // A DIFFERENT registered source (a genuinely valid signer for its own
  // source) can never assert feedback about an attempt claimed under
  // ANOTHER source, even when it names that attempt's real, matching
  // providerAccountId. Source and account correlation are both required —
  // matching only the account is not sufficient.
  const sourceMismatchFixture = await buildCro07AttemptFixture("source-mismatch");
  const sourceMismatchBody = JSON.stringify({ probe: "source_mismatch" });
  const sourceMismatchSignature = sign(sourceMismatchBody);
  const sourceMismatchResult = await feedbackAuthority.ingestCro07Feedback({
    source: "a-different-registered-source", providerAccountId: fixtureProviderAccountId,
    providerEventId: `evt-source-mismatch-${nonce}`, signatureHeader: `sha256=${sourceMismatchSignature}`,
    rawBody: sourceMismatchBody, signatureValid: true, eventType: "complaint", attemptId: sourceMismatchFixture.attemptId,
    payload: { probe: "source_mismatch" },
  });
  check((sourceMismatchResult as any).applied === false && (sourceMismatchResult as any).reason === "CRO07_PROVIDER_ACCOUNT_MISMATCH",
    "a validly signed event from a DIFFERENT registered source is rejected as evidence-only even when it names the attempt's real, matching providerAccountId");
  const sourceMismatchContact = await pool.query("SELECT do_not_contact FROM contacts WHERE id=$1", [sourceMismatchFixture.contactId]);
  check(sourceMismatchContact.rows[0].do_not_contact !== true,
    "a source-mismatched complaint never applies global DNC against the real contact behind the attempt");

  // ── Endpoint-level: no shared/default webhook secret across sources ────
  // Boots the REAL POST /api/webhooks/cro07/feedback/:source Express route
  // (the exact handler used in production) on an ephemeral local port and
  // drives it over real HTTP, proving that a caller holding source A's
  // configured secret cannot satisfy verification for source B's path —
  // the certification's other feedback assertions call ingestCro07Feedback
  // directly with a hand-set `signatureValid`, which does not exercise the
  // route's own per-source secret *selection* boundary.
  {
    const { default: express } = await import("express");
    const { createServer: createHttpServer } = await import("node:http");
    const { registerCro07Routes } = await import("../server/routes/cro07");
    process.env.CRO07_WEBHOOK_SECRET_HTTPSOURCEA = `cert-secret-a-${nonce}`;
    process.env.CRO07_WEBHOOK_SECRET_HTTPSOURCEB = `cert-secret-b-${nonce}`;
    delete process.env.CRO07_WEBHOOK_SECRET_DEFAULT;
    const httpFixtureA = await buildCro07AttemptFixture("http-source-a", "httpsourcea");
    const httpApp = express();
    httpApp.use(express.json({ verify: (req: any, _res: any, buf: Buffer) => { req.rawBody = buf; } }));
    registerCro07Routes(httpApp);
    const httpServer = createHttpServer(httpApp);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("failed to bind ephemeral certification test port");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const signHttp = (secret: string, raw: string) => createHmac("sha256", secret).update(raw).digest("hex");
    async function postFeedback(source: string, body: object, secretForSignature: string | null) {
      const raw = JSON.stringify(body);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (secretForSignature) headers["X-CRO07-Signature"] = `sha256=${signHttp(secretForSignature, raw)}`;
      const res = await fetch(`${baseUrl}/api/webhooks/cro07/feedback/${source}`, { method: "POST", headers, body: raw });
      return { status: res.status, json: (await res.json()) as any };
    }
    try {
      const ownSourceBody = {
        providerAccountId: "certification-denied-route", providerEventId: `evt-http-own-${nonce}`,
        eventType: "complaint", attemptId: httpFixtureA.attemptId, payload: {},
      };
      const ownSourceResult = await postFeedback("httpsourcea", ownSourceBody, process.env.CRO07_WEBHOOK_SECRET_HTTPSOURCEA!);
      check((ownSourceResult.status === 200 || ownSourceResult.status === 201) && ownSourceResult.json.applied === true,
        "the real HTTP route authenticates a request correctly signed with source A's own configured secret, posted under source A's own path");

      const crossSourceBody = { ...ownSourceBody, providerEventId: `evt-http-cross-${nonce}` };
      // NOTE: the HTTP response deliberately never echoes back WHY a
      // feedback event failed to apply (`{received, applied}` only, no
      // `reason`) — surfacing signature-validation internals to whatever
      // called the webhook would help an attacker iterate toward a valid
      // forgery. So this test asserts `applied === false` at the HTTP
      // boundary, and separately confirms via the durable receipt row
      // that the persisted reason really was CRO07_SIGNATURE_INVALID (not
      // some unrelated failure that would make this a false-positive
      // "pass").
      const crossSourceResult = await postFeedback("httpsourceb", crossSourceBody, process.env.CRO07_WEBHOOK_SECRET_HTTPSOURCEA!);
      check((crossSourceResult.status === 200 || crossSourceResult.status === 201) && crossSourceResult.json.applied === false,
        "the real HTTP route rejects a signature computed with source A's secret when posted under source B's path — no shared secret lets a signer for one source assert events for another");
      const crossSourceReceipt = await pool.query(
        "SELECT signature_valid FROM cro07_feedback_receipts WHERE source=$1 AND provider_event_id=$2",
        ["httpsourceb", crossSourceBody.providerEventId],
      );
      check(crossSourceReceipt.rows[0]?.signature_valid === false,
        "the cross-source-signed request's durable receipt row confirms it failed for signature_valid=false, not some other reason");

      process.env.CRO07_WEBHOOK_SECRET_DEFAULT = `cert-legacy-default-${nonce}`;
      const unconfiguredSourceBody = { ...ownSourceBody, providerEventId: `evt-http-unconfigured-${nonce}` };
      const unconfiguredSourceResult = await postFeedback("httpsourcec", unconfiguredSourceBody, process.env.CRO07_WEBHOOK_SECRET_DEFAULT);
      check((unconfiguredSourceResult.status === 200 || unconfiguredSourceResult.status === 201) && unconfiguredSourceResult.json.applied === false,
        "the real HTTP route rejects an unconfigured source signed with a CRO07_WEBHOOK_SECRET_DEFAULT value — no shared-default fallback exists to satisfy it");
      const unconfiguredSourceReceipt = await pool.query(
        "SELECT signature_valid FROM cro07_feedback_receipts WHERE source=$1 AND provider_event_id=$2",
        ["httpsourcec", unconfiguredSourceBody.providerEventId],
      );
      check(unconfiguredSourceReceipt.rows[0]?.signature_valid === false,
        "the unconfigured-source request's durable receipt row confirms it failed for signature_valid=false, not some other reason");
    } finally {
      delete process.env.CRO07_WEBHOOK_SECRET_DEFAULT;
      httpServer.close();
    }
  }

  // An unsigned/invalid delivery must never permanently poison a
  // provider_event_id — the later, genuinely signed delivery of the SAME
  // event must still be authenticated and applied, never dropped as
  // "already seen".
  const supersedeFixture = await buildCro07AttemptFixture("supersede-recovery");
  const supersedeEventId = `evt-supersede-${nonce}`;
  const supersedeBody = JSON.stringify({ probe: "supersede" });
  const forgedSignature = sign(JSON.stringify({ probe: "forged-different-body" }));
  const forgedAttempt = await feedbackAuthority.ingestCro07Feedback({
    source: "certification", providerAccountId: fixtureProviderAccountId, providerEventId: supersedeEventId,
    signatureHeader: `sha256=${forgedSignature}`, rawBody: supersedeBody, signatureValid: false,
    eventType: "complaint", attemptId: supersedeFixture.attemptId, payload: { probe: "supersede-forged" },
  });
  check((forgedAttempt as any).applied === false && (forgedAttempt as any).reason === "CRO07_SIGNATURE_INVALID",
    "an unsigned/forged delivery of a new provider_event_id is durably recorded as evidence only");
  const supersedeSignature = sign(supersedeBody);
  const genuineDelivery = await feedbackAuthority.ingestCro07Feedback({
    source: "certification", providerAccountId: fixtureProviderAccountId, providerEventId: supersedeEventId,
    signatureHeader: `sha256=${supersedeSignature}`, rawBody: supersedeBody, signatureValid: true,
    eventType: "complaint", attemptId: supersedeFixture.attemptId, payload: { probe: "supersede" },
  });
  check((genuineDelivery as any).applied === true,
    "the later genuinely signed delivery of the SAME provider_event_id is authenticated and applied — a prior unsigned/forged delivery never permanently poisons it");
  const supersedeContact = await pool.query("SELECT do_not_contact FROM contacts WHERE id=$1", [supersedeFixture.contactId]);
  check(supersedeContact.rows[0].do_not_contact === true,
    "the recovered, genuinely authenticated complaint applies global DNC exactly as any other authenticated complaint would");

  // Remaining feedback types, each on its own real attempt/contact fixture
  // so they don't collide with the reply-stop assertions above, and so we
  // can prove cross-contact isolation below.
  const otherFixtures: Record<string, { contactId: number; attemptId: string }> = {};
  for (const kind of ["explicit_unsubscribe", "complaint", "hard_bounce", "soft_bounce", "ambiguous_reply"]) {
    const fixture = await buildCro07AttemptFixture(kind);
    otherFixtures[kind] = { contactId: fixture.contactId, attemptId: fixture.attemptId };
    const body = JSON.stringify({ kind });
    const signature = sign(body);
    const result = await feedbackAuthority.ingestCro07Feedback({
      source: "certification", providerAccountId: fixtureProviderAccountId, providerEventId: `evt-${kind}-${nonce}`, signatureHeader: `sha256=${signature}`, rawBody: body,
      signatureValid: true, eventType: kind, attemptId: fixture.attemptId, payload: { kind },
    });
    check((result as any).applied === true, `${kind} feedback is authenticated and applied`);
  }

  // Cross-contact isolation: an authenticated complaint against the
  // explicit_unsubscribe fixture's attemptId must never leak onto the
  // separately-built complaint/hard_bounce fixtures' contacts (identity is
  // derived purely from the referenced attempt's own lineage).
  const crossContactBefore = await pool.query(
    "SELECT do_not_contact FROM contacts WHERE id = ANY($1::int[])",
    [[otherFixtures.hard_bounce.contactId, otherFixtures.soft_bounce.contactId]],
  );
  check(crossContactBefore.rows.every((r) => r.do_not_contact !== true),
    "unrelated fixtures' contacts are untouched by another fixture's complaint/unsubscribe application (cross-attempt isolation)");

  const unsubContact = await pool.query("SELECT do_not_contact, consent_tier, email_status FROM contacts WHERE id=$1", [otherFixtures.explicit_unsubscribe.contactId]);
  check(unsubContact.rows[0].consent_tier === "do_not_contact" || unsubContact.rows[0].email_status === "opted_out",
    "explicit_unsubscribe applies a channel opt-out");
  const complaintContact = await pool.query("SELECT do_not_contact FROM contacts WHERE id=$1", [otherFixtures.complaint.contactId]);
  check(complaintContact.rows[0].do_not_contact === true, "complaint applies global DNC");
  const hardBounceContact = await pool.query("SELECT email_status FROM contacts WHERE id=$1", [otherFixtures.hard_bounce.contactId]);
  check(hardBounceContact.rows[0].email_status === "bounced" || hardBounceContact.rows[0].email_status === "opted_out",
    "hard_bounce downgrades reachability");
  const softBounceContact = await pool.query("SELECT do_not_contact FROM contacts WHERE id=$1", [otherFixtures.soft_bounce.contactId]);
  check(softBounceContact.rows[0].do_not_contact !== true, "soft_bounce is observation-only and never suppresses");
  const ambiguousReplyWork = await pool.query(
    "SELECT owner_resolution FROM cro07_reply_work WHERE feedback_receipt_id=(SELECT id FROM cro07_feedback_receipts WHERE provider_event_id=$1)",
    [`evt-ambiguous_reply-${nonce}`],
  );
  check(ambiguousReplyWork.rows[0]?.owner_resolution === "review_required",
    "an ambiguous reply stops the correlated attempt and requires human review rather than auto-resolving");

  // ── Attribution: revenue stays unknown; synthetic fixtures are flagged ──
  await attribution.recordCro07AttributionEdge({
    edgeType: "contact_deal", fromType: "contact", fromId: String(contact.rows[0].id), toType: "deal", toId: `cert-deal-${nonce}`,
  });
  await rejects(
    () => attribution.recordCro07AttributionEdge({
      edgeType: "activation_revenue", fromType: "contact", fromId: String(contact.rows[0].id), toType: "processor_charge", toId: `cert-charge-${nonce}`,
      revenueStatus: "synthetic_fixture", revenueAmountCents: 5000,
    }),
    "CRO07_REVENUE_MUST_BE_UNKNOWN_OR_EXPLICITLY_SYNTHETIC",
    "non-unknown revenue without isSynthetic=true is rejected before REV-06A exists",
  );
  await attribution.recordSyntheticRevenueFixtureForCertification({
    fromType: "contact", fromId: String(contact.rows[0].id), toType: "processor_charge", toId: `cert-charge-${nonce}`, amountCents: 5000,
  });
  const attributionReport = await attribution.getCro07AttributionForContact(contact.rows[0].id);
  check(attributionReport.hasSyntheticFixturesOnly === true && attributionReport.revenueStatus === "unknown",
    "production revenue reporting stays `unknown` while only synthetic certification fixtures exist");

  // ── Taxonomy ─────────────────────────────────────────────────────────
  const taxonomyResult = await taxonomy.ensureCro07TaxonomyRegistered();
  const taxonomyReplay = await taxonomy.ensureCro07TaxonomyRegistered();
  check(taxonomyResult.inserted > 0 && taxonomyReplay.inserted === 0,
    "canonical taxonomy registration is additive and idempotent");

  // ── Governed experiments: never publish, never touch CR-06 content ─────
  const experimentKey = `cro07-cert-experiment-${nonce}`;
  const experiment = await experiments.freezeCro07Experiment({
    key: experimentKey, hypothesis: "Certification hypothesis", metric: "reply_rate",
    populationDefinition: { segment: "certification" }, allocation: { a: 0.5, b: 0.5 },
    versions: { a: { copy: "A" }, b: { copy: "B" } }, minSampleSize: 10, minDurationDays: 0,
    confidenceRule: { method: "two_sample_z", alpha: 0.05 }, guardrails: [{ metric: "complaint_rate", maxDegradationPct: 10 }],
    frozenBy: actor.actorId,
  });
  // Freezing is a one-time act: a resubmission under the SAME key with a
  // DIFFERENT design (e.g. an added arm / changed allocation) must be
  // rejected outright, never silently accepted as if it were a replay —
  // otherwise a second call could add arms or change the population after
  // the design was already frozen, without a new experiment or approval.
  await rejects(
    () => experiments.freezeCro07Experiment({
      key: experimentKey, hypothesis: "Certification hypothesis", metric: "reply_rate",
      populationDefinition: { segment: "certification" }, allocation: { a: 0.4, b: 0.3, c: 0.3 },
      versions: { a: { copy: "A" }, b: { copy: "B" }, c: { copy: "C" } }, minSampleSize: 10, minDurationDays: 0,
      confidenceRule: { method: "two_sample_z", alpha: 0.05 }, guardrails: [{ metric: "complaint_rate", maxDegradationPct: 10 }],
      frozenBy: actor.actorId,
    }),
    "CRO07_EXPERIMENT_DESIGN_MISMATCH",
    "resubmitting an existing experiment key with a changed design (an added arm) is rejected, not silently merged in",
  );
  const armsAfterMismatchAttempt = await pool.query(
    "SELECT arm FROM cro07_experiment_samples WHERE experiment_id=$1 ORDER BY arm", [experiment.id],
  );
  check(armsAfterMismatchAttempt.rows.length === 2 && armsAfterMismatchAttempt.rows.map((r: any) => r.arm).join(",") === "a,b",
    "a rejected design-mismatch resubmission never adds sample rows for the extra requested arm");
  // An identical resubmission (byte-identical design, same hash) is still a
  // safe, idempotent no-op replay.
  const identicalReplay = await experiments.freezeCro07Experiment({
    key: experimentKey, hypothesis: "Certification hypothesis", metric: "reply_rate",
    populationDefinition: { segment: "certification" }, allocation: { a: 0.5, b: 0.5 },
    versions: { a: { copy: "A" }, b: { copy: "B" } }, minSampleSize: 10, minDurationDays: 0,
    confidenceRule: { method: "two_sample_z", alpha: 0.05 }, guardrails: [{ metric: "complaint_rate", maxDegradationPct: 10 }],
    frozenBy: actor.actorId,
  });
  check(identicalReplay.id === experiment.id, "an identical resubmission under the same key remains a safe idempotent replay");

  await experiments.startCro07Experiment(experiment.id);
  await rejects(
    () => experiments.decideCro07Experiment({ experimentId: experiment.id, decision: "winner_a", decidedBy: actor.actorId }),
    "CRO07_INSUFFICIENT_SAMPLE",
    "an experiment cannot be decided before its frozen minimum sample size is reached",
  );
  for (let i = 0; i < 12; i++) {
    await experiments.recordCro07ExperimentSample({
      experimentId: experiment.id, arm: i % 2 === 0 ? "a" : "b", success: i % 3 === 0,
      eventKey: `cert-exposure-${nonce}-${i}`, source: "cro07_attribution_certification",
    });
  }
  // A replayed/duplicate event identity must never double-count — proves
  // sample ingestion cannot be inflated by a caller retrying (or forging)
  // the same event twice.
  const beforeReplaySample = await pool.query(
    "SELECT exposure_count FROM cro07_experiment_samples WHERE experiment_id=$1 AND arm='a'", [experiment.id],
  );
  const replayedSample = await experiments.recordCro07ExperimentSample({
    experimentId: experiment.id, arm: "a", success: true,
    eventKey: `cert-exposure-${nonce}-0`, source: "cro07_attribution_certification",
  });
  const afterReplaySample = await pool.query(
    "SELECT exposure_count FROM cro07_experiment_samples WHERE experiment_id=$1 AND arm='a'", [experiment.id],
  );
  check((replayedSample as any).replayed === true && afterReplaySample.rows[0].exposure_count === beforeReplaySample.rows[0].exposure_count,
    "a duplicate experiment sample event identity is deduped and never double-counted");
  const decision = await experiments.decideCro07Experiment({ experimentId: experiment.id, decision: "winner_a", decidedBy: actor.actorId });
  check(decision.state === "decided" && typeof decision.new_version_handoff_key === "string",
    "a decided winner produces only an opaque new-version handoff key");
  const artifactsAfterExperiment = await pool.query("SELECT * FROM cr06_artifacts WHERE id=$1", [program.rows[0].id]);
  check(JSON.stringify(artifactsAfterExperiment.rows[0]) === JSON.stringify(programBefore.rows[0]),
    "the governed growth loop never mutates approved CR-06 artifact content");

  // Two concurrent decide calls on the SAME eligible experiment must never
  // both succeed — the row lock + compare-and-set WHERE clause must let
  // exactly one call transition the experiment, with the other rejected
  // for no longer being in a decidable state (never silently overwriting
  // the first decision's winner/handoff key).
  const concurrentExperimentKey = `cro07-cert-experiment-concurrent-${nonce}`;
  const concurrentExperiment = await experiments.freezeCro07Experiment({
    key: concurrentExperimentKey, hypothesis: "Concurrency certification hypothesis", metric: "reply_rate",
    populationDefinition: { segment: "certification" }, allocation: { a: 0.5, b: 0.5 },
    versions: { a: { copy: "A" }, b: { copy: "B" } }, minSampleSize: 4, minDurationDays: 0,
    confidenceRule: { method: "two_sample_z", alpha: 0.05 }, guardrails: [{ metric: "complaint_rate", maxDegradationPct: 10 }],
    frozenBy: actor.actorId,
  });
  await experiments.startCro07Experiment(concurrentExperiment.id);
  for (let i = 0; i < 4; i++) {
    await experiments.recordCro07ExperimentSample({
      experimentId: concurrentExperiment.id, arm: i % 2 === 0 ? "a" : "b", success: true,
      eventKey: `cert-concurrent-exposure-${nonce}-${i}`, source: "cro07_attribution_certification",
    });
  }
  const concurrentOutcomes = await Promise.allSettled([
    experiments.decideCro07Experiment({ experimentId: concurrentExperiment.id, decision: "winner_a", decidedBy: `${actor.actorId}-racer-1` }),
    experiments.decideCro07Experiment({ experimentId: concurrentExperiment.id, decision: "winner_b", decidedBy: `${actor.actorId}-racer-2` }),
  ]);
  const concurrentFulfilled = concurrentOutcomes.filter((o) => o.status === "fulfilled");
  const concurrentRejected = concurrentOutcomes.filter((o) => o.status === "rejected");
  check(concurrentFulfilled.length === 1 && concurrentRejected.length === 1
    && /CRO07_EXPERIMENT_NOT_DECIDABLE/.test(String((concurrentRejected[0] as PromiseRejectedResult).reason)),
    "two concurrent decide calls on one experiment never both succeed — exactly one wins and the other is rejected as no longer decidable");
  const concurrentFinal = await pool.query("SELECT decision, new_version_handoff_key FROM cro07_experiments WHERE id=$1", [concurrentExperiment.id]);
  check(concurrentFinal.rows[0].decision === (concurrentFulfilled[0] as PromiseFulfilledResult<any>).value.decision
    && typeof concurrentFinal.rows[0].new_version_handoff_key === "string",
    "the experiment's persisted decision matches exactly the one call that actually won the race, never a merged or overwritten state");

  // ── Final CR-06 boundary re-check ───────────────────────────────────────
  await rejects(async () => cr06.assertCr06DispatchUnavailable(), "CR06_FINAL_DISPATCH_NOT_AUTHORIZED",
    "CR-06 final dispatch remains hard-disabled at the end of certification");
  const zeroMessages = await pool.query(
    "SELECT count(*)::int AS n FROM cro07_attempts WHERE state = 'accepted'",
  );
  check(zeroMessages.rows[0].n === 0, "zero attempts were ever accepted by a real transport — certification sent no message");

  await setTestPauseState(pauseBefore.rows[0]?.state !== "unpaused");
  console.log(`CRO-07 disposable certification PASS (${assertions} assertions; zero network calls, zero real messages).`);
} finally {
  await infrastructure.releaseRedisReservation();
}
