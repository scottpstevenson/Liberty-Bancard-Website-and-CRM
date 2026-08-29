#!/usr/bin/env tsx
/**
 * Task 1722, corrections 7–9: CR-06's stateful certification.
 *
 * This suite deliberately has no transport adapter.  It operates only on the
 * disposable database, reserves a private Redis namespace (so a worker cannot
 * share it), and is executed by run-denied-certification-suite.ts in CI.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "./certification-provider-deny";

const infrastructure = await assertDisposableTestInfrastructure({
  operation: "CR-06 disposable certification",
  requireRedis: true,
  reserveRedisNamespace: true,
});
// CI installs this before module loading; retain the same hard boundary when
// the disposable suite is explicitly run through pre-deploy as well.
process.env.VG_PROVIDER_DENY_MODE = "1";
process.env.APP_URL = "https://certification.invalid";
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "cr06-certification-session-secret-32-bytes";
process.env.UNSUBSCRIBE_TOKEN_SECRET = "cr06-certification-unsubscribe-secret-v1";
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
const fixtureHash = nonce.replace(/-/g, "").padEnd(64, "1");
try {
  // Migrations are run twice, rather than assuming a developer's local schema
  // is current.  This also exercises the journal's upgrade/reapply control.
  const [{ runDrizzleMigrations }, { pool }, cr06, cr04, feedback, readiness] = await Promise.all([
    import("../server/db-migrate"),
    import("../server/db"),
    import("../server/services/cr06-premium-campaigns"),
    import("../server/services/cr04-cohort-ready-authority"),
    import("../server/services/cr06-feedback"),
    import("../server/services/provider-readiness-control"),
  ]);
  await runDrizzleMigrations();
  await runDrizzleMigrations();
  const relations = await pool.query(
    `SELECT to_regclass('public.cr06_preparation_reservations') AS reservations,
            to_regclass('public.cr06_feedback_receipts') AS feedback,
            to_regclass('public.cr06_campaign_gates') AS gates`,
  );
  check(relations.rows[0].reservations && relations.rows[0].feedback && relations.rows[0].gates,
    "migration upgrade and reapply install correction tables exactly once");

  const manifest = cr06.getCr06RolloutManifest();
  check(manifest.manifestVersion === "liberty-premium-pilots-v2" &&
    manifest.artifacts.every((artifact) => artifact.version === 2 && artifact.identityKey.endsWith("-v2")),
  "API exposes only the explicit current v2 manifest and artifact identities");
  // Materialize a genuinely verified/approved v1 package first. The v2 rollout
  // must coexist with this immutable history rather than rewriting its hashes.
  const v1ManifestVersion = "liberty-premium-pilots-v1";
  const v1Document = { manifestVersion: v1ManifestVersion, fixture: "immutable-v1-compatibility" };
  const v1ManifestHash = cr06.hashCr06(v1Document);
  await pool.query(
    `INSERT INTO cr06_rollout_manifests
      (manifest_version,manifest_hash,status,program_count,sequence_count,content_count,manual_task_count,document,actor_id)
     VALUES ($1,$2,'applying',3,3,12,3,$3::jsonb,$4)`,
    [v1ManifestVersion, v1ManifestHash, JSON.stringify(v1Document), `cr06-v1-${nonce}`],
  );
  const v1Ids = new Map<string, string>();
  const v1Evidence = new Map<string, { hash: string; document: unknown }>();
  for (const currentArtifact of manifest.artifacts) {
    const identityKey = currentArtifact.identityKey.replace(/-v2$/, "");
    const parentKey = currentArtifact.parentKey?.replace(/-v2$/, "") ?? null;
    const document = { fixture: "immutable-v1", identityKey, artifactKind: currentArtifact.kind };
    const contentHash = cr06.hashCr06(document);
    const insertedV1 = await pool.query(
      `INSERT INTO cr06_artifacts
        (identity_key,artifact_kind,record_class,purpose,governance_state,compatibility_state,
         preparation_state,version,parent_artifact_id,document,content_hash,created_by,reviewed_by,approved_at)
       VALUES ($1,$2,'production','cold_marketing','approved_inactive','governed','not_prepared',1,
         $3,$4::jsonb,$5,$6,$6,NOW()) RETURNING id`,
      [identityKey, currentArtifact.kind, parentKey ? v1Ids.get(parentKey) : null,
        JSON.stringify(document), contentHash, `cr06-v1-${nonce}`],
    );
    v1Ids.set(identityKey, insertedV1.rows[0].id);
    v1Evidence.set(identityKey, { hash: contentHash, document });
  }
  await pool.query(
    `UPDATE cr06_rollout_manifests
        SET status='verified',receipt=$2::jsonb,applied_at=NOW()
      WHERE manifest_version=$1`,
    [v1ManifestVersion, JSON.stringify({ receiptVersion: 1, manifestHash: v1ManifestHash, immutable: true })],
  );
  const conflictArtifact = manifest.artifacts[0];
  const conflictingHash = conflictArtifact.contentHash === "f".repeat(64) ? "e".repeat(64) : "f".repeat(64);
  const conflictingV2 = await pool.query(
    `INSERT INTO cr06_artifacts
      (identity_key,artifact_kind,record_class,purpose,governance_state,compatibility_state,
       preparation_state,version,document,content_hash,created_by)
     VALUES ($1,$2,'test','cold_marketing','draft','governed','not_prepared',2,
       '{"conflict":true}'::jsonb,$3,$4) RETURNING id`,
    [conflictArtifact.identityKey, conflictArtifact.kind, conflictingHash, `cr06-conflict-${nonce}`],
  );
  await rejects(
    () => cr06.applyCr06Rollout({ actorId: `cr06-cert-${nonce}`, dryRun: true }),
    "CR06_ARTIFACT_HASH_CONFLICT",
    "same v2 artifact identity and version with a different hash is rejected",
  );
  await pool.query("DELETE FROM cr06_artifacts WHERE id=$1", [conflictingV2.rows[0].id]);
  const dry = await cr06.applyCr06Rollout({ actorId: `cr06-cert-${nonce}`, dryRun: true });
  check(dry.mode === "dry_run" && dry.dispatchAvailable === false,
    "manifest dry-run is read-only and dispatch remains unavailable");
  const applied = await cr06.applyCr06Rollout({ actorId: `cr06-cert-${nonce}`, dryRun: false });
  const replay = await cr06.applyCr06Rollout({ actorId: `cr06-cert-${nonce}`, dryRun: false });
  check(applied.mode === "apply" && replay.replayed === true,
    "manifest apply is durable and exact replay is idempotent");
  const versionCompatibility = await pool.query(
    `SELECT identity_key,version,content_hash,document,governance_state,compatibility_state
       FROM cr06_artifacts
      WHERE version IN (1,2) ORDER BY version,identity_key`,
  );
  const retainedV1 = versionCompatibility.rows.filter((row) => row.version === 1);
  const installedV2 = versionCompatibility.rows.filter((row) => row.version === 2);
  check(retainedV1.length === 21 && installedV2.length === 21 &&
    retainedV1.every((row) => {
      const evidence = v1Evidence.get(row.identity_key);
      return evidence && row.content_hash === evidence.hash &&
        cr06.hashCr06(row.document) === cr06.hashCr06(evidence.document) &&
        row.governance_state === "retired" && row.compatibility_state === "replaceable";
    }),
  "v2 apply preserves every v1 document/hash while explicitly retiring the superseded approved package");
  check(installedV2.filter((row) => row.document && row.version === 2).length === 21 &&
    manifest.counts.programs === 3 && manifest.counts.sequences === 3 &&
    manifest.counts.contents === 12 && manifest.counts.manualTasks === 3,
  "current v2 verification reports exactly 3 programs, 3 sequences, 12 contents, and 3 tasks");
  const manifestHistory = await pool.query(
    `SELECT manifest_version,manifest_hash,status,document
       FROM cr06_rollout_manifests
      WHERE manifest_version IN ($1,$2) ORDER BY manifest_version`,
    [v1ManifestVersion, manifest.manifestVersion],
  );
  const retainedV1Manifest = manifestHistory.rows.find((row) => row.manifest_version === v1ManifestVersion);
  check(manifestHistory.rowCount === 2 && retainedV1Manifest?.status === "verified" &&
    retainedV1Manifest.manifest_hash === v1ManifestHash &&
    cr06.hashCr06(retainedV1Manifest.document) === cr06.hashCr06(v1Document),
  "verified v1 manifest history remains byte-semantically unchanged beside verified v2");
  const manifestRow = await pool.query(
    "SELECT id,receipt FROM cr06_rollout_manifests WHERE manifest_version=$1",
    [manifest.manifestVersion],
  );
  await rejects(
    () => pool.query("UPDATE cr06_rollout_manifests SET receipt='{}'::jsonb WHERE id=$1", [manifestRow.rows[0].id]),
    "CR06_(RECEIPT|MANIFEST_EVIDENCE)_IMMUTABLE",
    "manifest receipt cannot be rewritten after verification",
  );
  // A verified manifest identity/hash cannot be changed in place.
  await rejects(
    () => pool.query(
      "UPDATE cr06_rollout_manifests SET manifest_hash=$2 WHERE id=$1",
      [manifestRow.rows[0].id, "f".repeat(64)],
    ),
    "CR06_MANIFEST_EVIDENCE_IMMUTABLE",
    "verified manifest identity rejects a conflicting hash",
  );

  const program = await pool.query(
    "SELECT id,content_hash FROM cr06_artifacts WHERE artifact_kind='program' AND version=2 ORDER BY identity_key LIMIT 1",
  );
  await cr06.approveCr06Program({
    programArtifactId: program.rows[0].id,
    expectedHash: program.rows[0].content_hash,
    reviewerId: `cr06-reviewer-${nonce}`,
  });
  await rejects(
    () => pool.query("UPDATE cr06_artifacts SET content_hash=$2 WHERE id=$1", [program.rows[0].id, "0".repeat(64)]),
    "CR06_APPROVED_ARTIFACT_IMMUTABLE",
    "approval package content is immutable after exact-hash approval",
  );
  const snapshot = await pool.query(
    "SELECT id FROM cr06_approval_snapshots WHERE artifact_id=$1", [program.rows[0].id],
  );
  await rejects(
    () => pool.query("DELETE FROM cr06_approval_snapshots WHERE id=$1", [snapshot.rows[0].id]),
    "CR06_IMMUTABLE_HISTORY",
    "approval history is append-only",
  );

  // Build only authority prerequisites. The CR-04 decision, membership, and
  // frozen run are produced exclusively by the real CR-04 authority below.
  await pool.query(
    `INSERT INTO system_settings(key,value) VALUES
       ('compliance_mailing_address',to_jsonb($1::text)),
       ('outboundDailyEmailCap',to_jsonb(200))
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
    ["100 Certification Way, Fort Lauderdale, FL 33301"],
  );
  await pool.query("UPDATE follow_up_sequences SET status='paused' WHERE status='active'");
  const sequence = await pool.query(
    `INSERT INTO follow_up_sequences
       (name,description,trigger_type,total_steps,status,created_by,sequence_family,
        eligible_consent_tiers,channels_allowed,offer_routes,lifecycle_stages_allowed)
     VALUES ($1,'CR-06 disposable authority fixture','manual',1,'active',$2,'cold-email-manual-call',
             ARRAY['cold_no_consent'],ARRAY['email'],ARRAY['statement_review'],ARRAY['prospect'])
     RETURNING id`,
    [`CR06 qualifying sequence ${nonce}`, `cr06-${nonce}`],
  );
  await pool.query(
    `INSERT INTO sequence_steps(sequence_id,step_order,action_type,delay_days,subject,body)
     VALUES ($1,1,'email',0,'Certification','Authority-owned certification fixture')`,
    [sequence.rows[0].id],
  );
  const email = `cr06-${nonce}@example.test`;
  const emailHash = readiness.hashEmailToken(email)!;
  const contact = await pool.query(
    `INSERT INTO contacts
       (first_name,last_name,email,phone,company_name,vertical,primary_offer_path,assigned_to,
        source_category,lead_source,record_class,email_status,email_mutation_generation,
        email_token_hash,email_validation_updated_at,data_readiness_score,readiness_model_version,
        readiness_updated_at,last_meaningful_contact_mutation_at,consent_tier,lifecycle_stage,
        city,state,lead_score)
     VALUES
       ('Casey','Certification',$1,'9545550199','CR06 Certification Merchant','auto_repair',
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
  check(providerReady.allowed, "authority-owned current provider evidence qualifies the exact email generation");

  const actor = { role: "admin" as const, actorId: `cr06-${nonce}`, email: null };
  const authorityDecision = await cr04.evaluateCr04ChannelQualification(contact.rows[0].id, {
    channel: "email", sequenceId: sequence.rows[0].id, persist: true, scope: actor,
  });
  check(authorityDecision.qualified && authorityDecision.id,
    "real CR-04 qualification authority persists a qualified decision");
  const cohortKey = `cr06-cert-cohort-${nonce}`;
  let cohort = await cr04.freezeCr04Cohort({
    scope: actor, channel: "email", filters: { assignedTo: `owner-${nonce}@example.test` },
    idempotencyKey: cohortKey, createdBy: actor.actorId,
  });
  for (let attempt = 0; cohort.status === "building" && attempt < 5; attempt++) {
    // Each bounded phase normally resumes after its lease. Advance only this
    // disposable fixture's lease to exercise takeover without a wall-clock wait.
    await pool.query(
      "UPDATE cr04_cohort_runs SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1 AND status='building'",
      [cohort.id],
    );
    cohort = await cr04.freezeCr04Cohort({
      scope: actor, channel: "email", filters: { assignedTo: `owner-${nonce}@example.test` },
      idempotencyKey: cohortKey, createdBy: actor.actorId,
    });
  }
  check(cohort.status === "frozen" && cohort.memberCount === 1,
    "real CR-04 freeze authority produces one immutable frozen member");
  const frozenMember = await pool.query(
    `SELECT m.decision_id,m.dependency_fingerprint,d.decision,d.contact_id
       FROM cr04_cohort_members m
       JOIN cr04_channel_decisions d ON d.id=m.decision_id
      WHERE m.run_id=$1`,
    [cohort.id],
  );
  check(frozenMember.rowCount === 1 && frozenMember.rows[0].decision === "qualified" &&
    frozenMember.rows[0].contact_id === contact.rows[0].id,
  "frozen membership is bound to a qualified decision produced by the authority");

  const definition = await pool.query(
    "SELECT definition_id FROM cr04_cohort_runs WHERE id=$1", [cohort.id],
  );
  const expiredCohort = await pool.query(
    `INSERT INTO cr04_cohort_runs
       (definition_id,idempotency_key,status,as_of,expires_at,member_count,membership_fingerprint,created_by,
        build_cursor,reconciliation_cursor,build_phase)
      VALUES ($1,$2,'frozen',NOW()-INTERVAL '2 days',NOW()-INTERVAL '1 day',0,$3,$4,0,0,'complete')
     RETURNING id`,
    [definition.rows[0].definition_id, `cr06-cert-expired-${nonce}`, fixtureHash, `cr06-${nonce}`],
  );
  const expiredPreflight = await cr06.preflightCr06({
    programArtifactId: program.rows[0].id, cohortRunId: expiredCohort.rows[0].id, cap: 1,
  });
  check(expiredPreflight.blockers.includes("COHORT_EXPIRED"),
    "expired CR-04 cohorts are rejected before preparation");
  const historicalExpiredPreview = await cr06.preflightCr06({
    programArtifactId: program.rows[0].id,
    cohortRunId: expiredCohort.rows[0].id,
    cap: 1,
    asOf: new Date(Date.now() - 3 * 86400000),
  });
  check(historicalExpiredPreview.eligible,
    "historical asOf remains available only for deterministic read-only preview");
  await rejects(
    () => cr06.setCr06CampaignGate({
      programArtifactId: program.rows[0].id,
      cohortRunId: expiredCohort.rows[0].id,
      preflightHash: historicalExpiredPreview.preflightHash,
      cap: 1,
      state: "open",
      confirmation: cr06.CR06_GATE_CONFIRMATION,
      actorId: actor.actorId,
      idempotencyKey: `cr06-historical-gate-${nonce}`,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    }),
    "CR06_PREFLIGHT_BLOCKED",
    "historical caller clock cannot open a gate after server-current cohort expiry",
  );

  const preflightAsOf = new Date();
  const pauseBefore = await pool.query(
    "SELECT state,epoch::text FROM outbound_pause_control ORDER BY id LIMIT 1",
  );
  const preflightA = await cr06.preflightCr06({
    programArtifactId: program.rows[0].id, cohortRunId: cohort.id, cap: 1, asOf: preflightAsOf,
  });
  const preflightB = await cr06.preflightCr06({
    programArtifactId: program.rows[0].id, cohortRunId: cohort.id, cap: 1, asOf: preflightAsOf,
  });
  check(preflightA.eligible && preflightA.summary.eligible === 1 &&
    preflightA.preflightHash === preflightB.preflightHash,
  "real preflight is read-only and exactly equal at one authority instant");
  const gate = await cr06.setCr06CampaignGate({
    programArtifactId: program.rows[0].id, cohortRunId: cohort.id,
    preflightHash: preflightA.preflightHash, cap: 1, state: "open",
    confirmation: cr06.CR06_GATE_CONFIRMATION, actorId: actor.actorId,
    idempotencyKey: `cr06-gate-${nonce}`, expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  const gateReplay = await cr06.setCr06CampaignGate({
    programArtifactId: program.rows[0].id, cohortRunId: cohort.id,
    preflightHash: preflightA.preflightHash, cap: 1, state: "open",
    confirmation: cr06.CR06_GATE_CONFIRMATION, actorId: actor.actorId,
    idempotencyKey: `cr06-gate-${nonce}`, expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  check(gateReplay.id === gate.id && gateReplay.revision === gate.revision,
    "exact campaign-gate idempotency replay returns the original durable command");
  await rejects(
    () => cr06.setCr06CampaignGate({
      programArtifactId: program.rows[0].id, cohortRunId: cohort.id,
      preflightHash: preflightA.preflightHash, cap: 1, state: "closed",
      actorId: actor.actorId, idempotencyKey: `cr06-gate-${nonce}`,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    }),
    "CR06_IDEMPOTENCY_KEY_CONFLICT",
    "campaign-gate idempotency key rejects a conflicting command",
  );
  const closedGate = await feedback.compareAndSetCr06GateRevision({
    gateId: gate.id, expectedRevision: Number(gate.revision), state: "closed", actorId: actor.actorId,
  });
  check(closedGate.revision === Number(gate.revision) + 1,
    "gate revision compare-and-set advances exactly once");
  await rejects(
    () => feedback.compareAndSetCr06GateRevision({
      gateId: gate.id, expectedRevision: Number(gate.revision), state: "open", actorId: actor.actorId,
    }),
    "CR06_GATE_REVISION_COMPARE_AND_SET_FAILED",
    "stale gate revision compare-and-set is rejected",
  );
  await feedback.compareAndSetCr06GateRevision({
    gateId: gate.id, expectedRevision: Number(closedGate.revision), state: "open", actorId: actor.actorId,
  });

  const liveExpiry = await pool.query(
    `SELECT r.expires_at AS cohort_expires_at,d.decided_at AS decision_decided_at,
            d.expires_at AS decision_expires_at
       FROM cr04_cohort_runs r
       JOIN cr04_cohort_members m ON m.run_id=r.id
       JOIN cr04_channel_decisions d ON d.id=m.decision_id
      WHERE r.id=$1`,
    [cohort.id],
  );
  await pool.query("UPDATE cr04_cohort_runs SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [cohort.id]);
  const forceDecisionExpiry = await pool.connect();
  try {
    // The authority correctly makes decisions immutable. This disposable-only
    // fault injection bypasses user triggers to simulate wall-clock expiry
    // without sleeping for the full decision TTL.
    await forceDecisionExpiry.query("SET session_replication_role='replica'");
    await forceDecisionExpiry.query(
      `UPDATE cr04_channel_decisions
          SET decided_at=NOW()-INTERVAL '2 seconds',expires_at=NOW()-INTERVAL '1 second'
        WHERE id=(SELECT decision_id FROM cr04_cohort_members WHERE run_id=$1 LIMIT 1)`,
      [cohort.id],
    );
  } finally {
    await forceDecisionExpiry.query("SET session_replication_role='origin'");
    forceDecisionExpiry.release();
  }
  await rejects(() => cr06.prepareCr06({
    programArtifactId: program.rows[0].id, cohortRunId: cohort.id, cap: 1,
    actorId: actor.actorId, idempotencyKey: `cr06-current-expiry-${nonce}`,
  }), "CR06_GATE_DEPENDENCY_SNAPSHOT_STALE",
  "preparation rejects server-current cohort and decision expiry after gate opening");
  await pool.query("UPDATE cr04_cohort_runs SET expires_at=$2 WHERE id=$1",
    [cohort.id, liveExpiry.rows[0].cohort_expires_at]);
  const restoreDecisionExpiry = await pool.connect();
  try {
    await restoreDecisionExpiry.query("SET session_replication_role='replica'");
    await restoreDecisionExpiry.query(
      `UPDATE cr04_channel_decisions SET decided_at=$2,expires_at=$3
        WHERE id=(SELECT decision_id FROM cr04_cohort_members WHERE run_id=$1 LIMIT 1)`,
      [cohort.id, liveExpiry.rows[0].decision_decided_at, liveExpiry.rows[0].decision_expires_at],
    );
  } finally {
    await restoreDecisionExpiry.query("SET session_replication_role='origin'");
    restoreDecisionExpiry.release();
  }

  await pool.query("UPDATE contacts SET last_contacted_at=NOW() WHERE id=$1", [contact.rows[0].id]);
  await rejects(() => cr06.prepareCr06({
    programArtifactId: program.rows[0].id, cohortRunId: cohort.id, cap: 1,
    actorId: actor.actorId, idempotencyKey: `cr06-current-recent-contact-${nonce}`,
  }), "CR06_GATE_DEPENDENCY_SNAPSHOT_STALE",
  "recent contact after gate opening removes member at server-current preparation time");
  await pool.query("UPDATE contacts SET last_contacted_at=NULL WHERE id=$1", [contact.rows[0].id]);

  const rejectAuthorityDrift = (suffix: string) => cr06.prepareCr06({
    programArtifactId: program.rows[0].id, cohortRunId: cohort.id, cap: 1,
    actorId: actor.actorId, idempotencyKey: `cr06-${suffix}-${nonce}`,
  });
  const originalAppUrl = process.env.APP_URL;
  process.env.APP_URL = "https://changed-certification.invalid/path";
  await rejects(() => rejectAuthorityDrift("stale-app-origin"),
    "CR06_GATE_DEPENDENCY_SNAPSHOT_STALE",
    "APP URL origin drift invalidates the exact gate snapshot");
  process.env.APP_URL = originalAppUrl;

  const originalUnsubscribeSecret = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  process.env.UNSUBSCRIBE_TOKEN_SECRET = "cr06-certification-unsubscribe-secret-v2";
  await rejects(() => rejectAuthorityDrift("stale-unsubscribe-secret"),
    "CR06_GATE_DEPENDENCY_SNAPSHOT_STALE",
    "unsubscribe secret fingerprint drift invalidates the gate without retaining the secret");
  process.env.UNSUBSCRIBE_TOKEN_SECRET = originalUnsubscribeSecret;

  const complianceIdentity = await pool.query(
    "SELECT value,updated_at FROM system_settings WHERE key='compliance_mailing_address'",
  );
  await pool.query(
    "UPDATE system_settings SET value=to_jsonb($1::text),updated_at=NOW() WHERE key='compliance_mailing_address'",
    ["200 Drift Avenue, Fort Lauderdale, FL 33301"],
  );
  await rejects(() => rejectAuthorityDrift("stale-compliance-setting"),
    "CR06_GATE_DEPENDENCY_SNAPSHOT_STALE",
    "compliance address value and revision drift invalidate the exact gate");
  await pool.query(
    "UPDATE system_settings SET value=$1::jsonb,updated_at=$2 WHERE key='compliance_mailing_address'",
    [JSON.stringify(complianceIdentity.rows[0].value), complianceIdentity.rows[0].updated_at],
  );

  const capIdentity = await pool.query(
    "SELECT value,updated_at FROM system_settings WHERE key='outboundDailyEmailCap'",
  );
  await pool.query(
    "UPDATE system_settings SET value=to_jsonb(5),updated_at=NOW() WHERE key='outboundDailyEmailCap'",
  );
  await rejects(() => rejectAuthorityDrift("stale-outbound-cap"),
    "CR06_GATE_DEPENDENCY_SNAPSHOT_STALE",
    "sender campaign cap drift invalidates the exact gate");
  await pool.query(
    "UPDATE system_settings SET value=$1::jsonb,updated_at=$2 WHERE key='outboundDailyEmailCap'",
    [JSON.stringify(capIdentity.rows[0].value), capIdentity.rows[0].updated_at],
  );

  const providerControlIdentity = await pool.query(
    "SELECT circuit_state,version,updated_at FROM provider_controls WHERE provider='zerobounce'",
  );
  await pool.query(
    `UPDATE provider_controls SET circuit_state='open',version=version+1,updated_at=NOW()
      WHERE provider='zerobounce'`,
  );
  await rejects(() => rejectAuthorityDrift("stale-provider-control"),
    "CR06_GATE_DEPENDENCY_SNAPSHOT_STALE",
    "provider circuit and control-version drift invalidate the exact gate");
  await pool.query(
    `UPDATE provider_controls SET circuit_state=$1,version=$2,updated_at=$3
      WHERE provider='zerobounce'`,
    [providerControlIdentity.rows[0].circuit_state, providerControlIdentity.rows[0].version,
      providerControlIdentity.rows[0].updated_at],
  );

  // Preparation must derive again after obtaining its locks. These temporary
  // restrictive changes are made after the exact gate snapshot and therefore
  // must invalidate it rather than being admitted by the earlier preflight.
  await pool.query("UPDATE contacts SET do_not_contact=TRUE WHERE id=$1", [contact.rows[0].id]);
  await rejects(
    () => cr06.prepareCr06({
      programArtifactId: program.rows[0].id, cohortRunId: cohort.id, cap: 1,
      actorId: actor.actorId, idempotencyKey: `cr06-stale-consent-${nonce}`,
    }),
    "CR06_GATE_DEPENDENCY_SNAPSHOT_STALE",
    "consent drift after gate snapshot is rejected under preparation locks",
  );
  await pool.query("UPDATE contacts SET do_not_contact=FALSE WHERE id=$1", [contact.rows[0].id]);

  await pool.query(
    `INSERT INTO provider_observations
       (provider,subject_type,subject_id,email_token_hash,subject_generation,outcome,retryable,observed_at)
     VALUES ('zerobounce','contact',$1,$2,1,'invalid',FALSE,NOW()+INTERVAL '1 second')`,
    [contact.rows[0].id, emailHash],
  );
  await rejects(
    () => cr06.prepareCr06({
      programArtifactId: program.rows[0].id, cohortRunId: cohort.id, cap: 1,
      actorId: actor.actorId, idempotencyKey: `cr06-stale-provider-${nonce}`,
    }),
    "CR06_GATE_DEPENDENCY_SNAPSHOT_STALE",
    "provider-readiness drift after gate snapshot is rejected under preparation locks",
  );
  await pool.query(
    `INSERT INTO provider_observations
       (provider,subject_type,subject_id,email_token_hash,subject_generation,outcome,retryable,observed_at)
     VALUES ('zerobounce','contact',$1,$2,1,'valid',FALSE,NOW()+INTERVAL '2 seconds')`,
    [contact.rows[0].id, emailHash],
  );
  await rejects(
    () => pool.query(
      "UPDATE cr04_cohort_members SET dependency_fingerprint=$2 WHERE run_id=$1",
      [cohort.id, "e".repeat(64)],
    ),
    "CR04|IMMUTABLE|frozen",
    "frozen member fingerprint drift is rejected before it can expand preparation",
  );
  const refreshedAsOf = new Date();
  const refreshedPreflight = await cr06.preflightCr06({
    programArtifactId: program.rows[0].id, cohortRunId: cohort.id, cap: 1, asOf: refreshedAsOf,
  });
  check(refreshedPreflight.eligible && refreshedPreflight.summary.eligible === 1,
    "restored restrictive authorities produce a new exact snapshot without adding members");
  await cr06.setCr06CampaignGate({
    programArtifactId: program.rows[0].id, cohortRunId: cohort.id,
    preflightHash: refreshedPreflight.preflightHash, cap: 1, state: "open",
    confirmation: cr06.CR06_GATE_CONFIRMATION, actorId: actor.actorId,
    idempotencyKey: `cr06-gate-refreshed-${nonce}`, expiresAt: new Date(Date.now() + 10 * 60_000),
  });

  const prepareInputs = [0, 1].map((index) => ({
    programArtifactId: program.rows[0].id, cohortRunId: cohort.id, cap: 1,
    actorId: actor.actorId, idempotencyKey: `cr06-prepare-${nonce}-${index}`,
  }));
  const concurrent = await Promise.allSettled(prepareInputs.map((input) => cr06.prepareCr06(input)));
  const fulfilled = concurrent.filter((result): result is PromiseFulfilledResult<any> => result.status === "fulfilled");
  const rejected = concurrent.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  check(fulfilled.length === 1 && rejected.length === 1 &&
    /CR06_EXACT_CAMPAIGN_GATE_NOT_OPEN|duplicate key|active_exact/i.test(String(rejected[0].reason)),
  "concurrent cap reservation admits one winner and rejects oversubscription");
  const prepared = fulfilled[0].value;
  check(prepared.state === "ready_held" && prepared.statusLabel.includes("READY_HELD") &&
    prepared.preparedCount === 1 && prepared.providerAttemptCount === 0,
  "winning preparation returns the READY_HELD receipt with zero provider attempts");
  const preparedRunIdentity = await pool.query(
    "SELECT idempotency_key FROM cr06_preparation_runs WHERE id=$1", [prepared.id],
  );
  const preparationReplay = await cr06.prepareCr06(prepareInputs.find((input) =>
    input.idempotencyKey === preparedRunIdentity.rows[0].idempotency_key,
  )!);
  check(preparationReplay.replayed === true && preparationReplay.id === prepared.id,
    "preparation replay returns the original immutable held run");
  const reservationEvidence = await pool.query(
    `SELECT scope_type,scope_identity,scope_window,reserved_member_cap,effective_cap,current_usage,
            send_capacity_units,state,receipt_hash,expires_at
       FROM cr06_preparation_reservations
      WHERE preparation_run_id=$1 ORDER BY scope_type`,
    [prepared.id],
  );
  const expectedScopes = ["campaign", "canary", "day", "hour", "minute", "provider", "sender"];
  check(reservationEvidence.rowCount === expectedScopes.length &&
    reservationEvidence.rows.map((row) => row.scope_type).join(",") === expectedScopes.join(",") &&
    reservationEvidence.rows.every((row) => Number(row.reserved_member_cap) === 1 &&
      Number(row.effective_cap) === 0 && Number(row.send_capacity_units) === 0 &&
      row.state === "held" && typeof row.receipt_hash === "string" && row.receipt_hash.length === 64),
  "preparation atomically retains exact seven scoped zero-capacity reservation receipts");
  await rejects(
    () => pool.query(
      "UPDATE cr06_preparation_reservations SET reserved_member_cap=2 WHERE preparation_run_id=$1 AND scope_type='sender'",
      [prepared.id],
    ),
    "CR06_RESERVATION_IMMUTABLE",
    "reservation cap evidence cannot be rewritten",
  );
  await rejects(
    () => cr06.reconcileCr06PreparationReservations({
      preparationRunId: prepared.id,
      transition: "expired",
      actorId: actor.actorId,
      idempotencyKey: `cr06-expire-${nonce}`,
    }),
    "CR06_RESERVATION_NOT_EXPIRED",
    "reservation expiry is denied before the database-owned expiry instant",
  );
  const forceReservationExpiry = await pool.connect();
  try {
    // Disposable-only clock acceleration: bypass the immutable trigger, then
    // exercise the production owner and its database-clock comparison normally.
    await forceReservationExpiry.query("SET session_replication_role='replica'");
    await forceReservationExpiry.query(
      "UPDATE cr06_preparation_reservations SET expires_at=NOW()-INTERVAL '1 second' WHERE preparation_run_id=$1",
      [prepared.id],
    );
  } finally {
    await forceReservationExpiry.query("SET session_replication_role='origin'");
    forceReservationExpiry.release();
  }
  const expiryInput = {
    preparationRunId: prepared.id,
    transition: "expired" as const,
    actorId: actor.actorId,
    idempotencyKey: `cr06-expire-${nonce}`,
  };
  const expiryRace = await Promise.all([
    cr06.reconcileCr06PreparationReservations(expiryInput),
    cr06.reconcileCr06PreparationReservations(expiryInput),
  ]);
  check(expiryRace.filter((result) => !result.replayed).length === 1 &&
    expiryRace.filter((result) => result.replayed).length === 1 &&
    expiryRace[0].receiptHash === expiryRace[1].receiptHash &&
    expiryRace.every((result) => result.affectedScopes === 7),
  "concurrent expiry transitions all seven scopes once and returns one immutable receipt");
  const expiryRetry = await cr06.reconcileCr06PreparationReservations(expiryInput);
  check(expiryRetry.replayed && expiryRetry.receiptHash === expiryRace[0].receiptHash,
    "reservation expiry retry returns the exact original receipt");
  await rejects(
    () => cr06.reconcileCr06PreparationReservations({
      ...expiryInput,
      actorId: `${actor.actorId}-other`,
    }),
    "CR06_RESERVATION_RECONCILIATION_CONFLICT",
    "reservation replay rejects a changed actor",
  );
  await rejects(
    () => cr06.reconcileCr06PreparationReservations({
      ...expiryInput,
      reason: "different reason cannot rewrite expiry evidence",
    }),
    "CR06_RESERVATION_RECONCILIATION_CONFLICT",
    "reservation replay rejects a changed reason or transition",
  );
  const expiredScopes = await pool.query(
    `SELECT state,reconciliation_receipt,reconciliation_receipt_hash,reconciliation_actor_id,reconciliation_as_of
       FROM cr06_preparation_reservations WHERE preparation_run_id=$1`,
    [prepared.id],
  );
  check(expiredScopes.rowCount === 7 &&
    expiredScopes.rows.every((row) => row.state === "expired" &&
      row.reconciliation_receipt_hash === expiryRace[0].receiptHash &&
      row.reconciliation_actor_id === actor.actorId &&
      row.reconciliation_as_of),
  "normal expiry retains actor, DB as-of, receipt, and hash on every exact scope");
  await rejects(
    () => pool.query(
      `UPDATE cr06_preparation_reservations
          SET reconciliation_receipt=jsonb_build_object('tampered',true)
        WHERE preparation_run_id=$1 AND scope_type='sender'`,
      [prepared.id],
    ),
    "CR06_RESERVATION_(RECONCILIATION_EVIDENCE_INVALID|TRANSITION_FORBIDDEN)",
    "reservation reconciliation receipt is immutable after transition",
  );
  const retainedAuthority = await pool.query(
    `SELECT pr.dependency_snapshot AS preparation_snapshot,g.dependency_snapshot AS gate_snapshot
       FROM cr06_preparation_runs pr
       JOIN cr06_campaign_gates g ON g.id=(
         SELECT id FROM cr06_campaign_gates
          WHERE program_artifact_id=pr.program_artifact_id AND cohort_run_id=pr.cohort_run_id
          ORDER BY created_at DESC LIMIT 1)
      WHERE pr.id=$1`,
    [prepared.id],
  );
  check(!JSON.stringify(retainedAuthority.rows[0]).includes(process.env.UNSUBSCRIBE_TOKEN_SECRET!) &&
    retainedAuthority.rows[0].preparation_snapshot.compliance.unsubscribeSecret.fingerprint.length === 64,
  "gate and preparation retain only versioned unsubscribe-secret fingerprint, never secret material");
  const held = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM cr06_delivery_intents WHERE preparation_run_id=$1 AND state='held') AS intents,
       (SELECT count(*)::int FROM cr06_manual_task_intents WHERE preparation_run_id=$1 AND state='held') AS manual,
       (SELECT count(*)::int FROM sequence_enrollments WHERE contact_id=$2) AS enrollments,
       (SELECT count(*)::int FROM tasks WHERE contact_id=$2) AS tasks,
       (SELECT COALESCE(sum(provider_attempt_count),0)::int FROM cr06_delivery_intents WHERE preparation_run_id=$1) AS attempts`,
    [prepared.id, contact.rows[0].id],
  );
  check(held.rows[0].intents === 4 && held.rows[0].manual === 1 &&
    held.rows[0].enrollments === 0 && held.rows[0].tasks === 0 && held.rows[0].attempts === 0,
  "preparation persists four held intents and one held manual intent with no live work or attempts");
  const pauseAfter = await pool.query(
    "SELECT state,epoch::text FROM outbound_pause_control ORDER BY id LIMIT 1",
  );
  check(pauseAfter.rows[0]?.state === pauseBefore.rows[0]?.state &&
    pauseAfter.rows[0]?.epoch === pauseBefore.rows[0]?.epoch,
  "preflight, gate, and preparation perform zero pause-state or epoch mutation");
  const transport = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM provider_operations
         WHERE idempotency_key LIKE 'cr06:%') AS operations,
       (SELECT count(*)::int FROM provider_attempts pa
         JOIN provider_operations po ON po.id=pa.operation_id
        WHERE po.idempotency_key LIKE 'cr06:%') AS attempts`,
  );
  check(transport.rows[0].operations === 0 && transport.rows[0].attempts === 0,
    "held CR-06 preparation creates exactly no provider operation, attempt, or transport");
  await rejects(
    async () => cr06.assertCr06DispatchUnavailable(),
    "CR06_FINAL_DISPATCH_NOT_AUTHORIZED",
    "held intents remain isolated from workers behind the unavailable dispatch boundary",
  );

  const intents = await pool.query(
    "SELECT id FROM cr06_delivery_intents WHERE preparation_run_id=$1 ORDER BY touch_number",
    [prepared.id],
  );
  check(intents.rowCount === 4, "feedback certification has the four durable held delivery intents");
  const feedbackTypes: Array<
    "delivered" | "hard_bounce" | "soft_bounce" | "complaint" | "unsubscribe" |
    "provider_rejected" | "provider_failed" | "replied"
  > = [
    "delivered", "hard_bounce", "soft_bounce", "complaint", "unsubscribe",
    "provider_rejected", "provider_failed", "replied",
  ];
  const feedbackEvents = new Map<string, { intentId: string; receiptId: string }>();
  for (const [index, eventType] of feedbackTypes.entries()) {
    const intentId = intents.rows[index % intents.rows.length].id;
    const eventKey = `cr06-feedback-${eventType}-${nonce}`;
    const result = await feedback.ingestCr06SyntheticFeedback({
      deliveryIntentId: intentId,
      eventKey,
      eventType,
      actorId: actor.actorId,
      payload: {
        provider: "certification",
        providerMessageId: `message-${index}`,
        occurredAt: new Date().toISOString(),
        smtpStatus: eventType === "hard_bounce" ? 550 : 250,
      },
    });
    feedbackEvents.set(eventType, { intentId, receiptId: result.receiptId });
    const terminal = await pool.query(
      "SELECT state,terminal_reason FROM cr06_delivery_intents WHERE id=$1",
      [intentId],
    );
    check(!result.replayed && terminal.rows[0]?.state === "terminal" &&
      String(terminal.rows[0]?.terminal_reason).startsWith("feedback_"),
    `${eventType} feedback is durably attributed and terminalizes its held intent`);
  }
  const allFeedback = await pool.query(
    `SELECT count(*)::int AS receipts,
            count(*) FILTER (WHERE processed_at IS NOT NULL)::int AS processed
       FROM cr06_feedback_receipts
      WHERE event_key LIKE $1`,
    [`cr06-feedback-%-${nonce}`],
  );
  const allAttribution = await pool.query(
    "SELECT count(*)::int AS events FROM cr06_attribution_events WHERE provider_event_key LIKE $1",
    [`cr06-feedback-%-${nonce}`],
  );
  check(allFeedback.rows[0].receipts === feedbackTypes.length &&
    allFeedback.rows[0].processed === feedbackTypes.length &&
    allAttribution.rows[0].events === feedbackTypes.length,
  "every CR-06 feedback type has one processed receipt and one attribution event");

  const delivered = feedbackEvents.get("delivered")!;
  const replayKey = `cr06-feedback-delivered-${nonce}`;
  // occurredAt is intentionally part of the exact receipt payload; use its persisted
  // form to prove a byte-equivalent logical command replay rather than a new event.
  const replayPayload = await pool.query(
    "SELECT payload FROM cr06_feedback_receipts WHERE event_key=$1",
    [replayKey],
  );
  const exactReplay = await feedback.ingestCr06SyntheticFeedback({
    deliveryIntentId: delivered.intentId, eventKey: replayKey, eventType: "delivered",
    actorId: actor.actorId, payload: replayPayload.rows[0].payload,
  });
  check(exactReplay.replayed && exactReplay.receiptId === delivered.receiptId,
  "feedback exact replay returns the original immutable receipt");
  await rejects(
    () => feedback.ingestCr06SyntheticFeedback({
      deliveryIntentId: delivered.intentId, eventKey: replayKey, eventType: "replied", actorId: actor.actorId,
    }),
    "CR06_FEEDBACK_EVENT_KEY_CONFLICT",
    "feedback event-key reuse with a conflicting command is rejected",
  );
  await rejects(
    () => feedback.ingestCr06SyntheticFeedback({
      deliveryIntentId: delivered.intentId, eventKey: `cr06-feedback-redacted-${nonce}`,
      eventType: "delivered", actorId: actor.actorId, payload: { provider: "certification", email: email } as any,
    }),
    "CR06_FEEDBACK_PAYLOAD_FIELD_FORBIDDEN",
    "feedback payload rejects redacted contact material before a receipt is written",
  );
  const rejectedPayloadReceipt = await pool.query(
    "SELECT count(*)::int AS receipts FROM cr06_feedback_receipts WHERE event_key=$1",
    [`cr06-feedback-redacted-${nonce}`],
  );
  check(rejectedPayloadReceipt.rows[0].receipts === 0,
    "redacted feedback payload rejection creates no durable receipt");
  const restrictive = await pool.query(
    "SELECT do_not_contact,email_status,consent_tier FROM contacts WHERE id=$1",
    [contact.rows[0].id],
  );
  check(restrictive.rows[0]?.do_not_contact === true &&
    restrictive.rows[0]?.consent_tier === "do_not_contact" &&
    ["bounced", "opted_out"].includes(restrictive.rows[0]?.email_status),
  "complaint/unsubscribe and hard bounce apply restrictive authorities without weaker feedback clearing them");

  // Authorization/IDOR/CSRF remains source-certified because this suite does
  // not start an HTTP server.
  const route = fs.readFileSync("server/routes/cr06.ts", "utf8");
  const routeRegistry = fs.readFileSync("server/routes.ts", "utf8");
  const authSetup = fs.readFileSync("server/replit_integrations/auth/replitAuth.ts", "utf8");
  check(route.includes('requireRole("admin")') && route.includes("uuid.parse(req.params.id)") &&
    route.includes("IDEMPOTENCY_KEY_REQUIRED") &&
    authSetup.indexOf("app.use(csrfProtection)") >= 0 &&
    routeRegistry.indexOf("await setupAuth(app)") < routeRegistry.indexOf("registerCr06Routes(app)"),
  "CR-06 mutations retain admin, opaque-ID validation, idempotency, and global CSRF ordering");

  console.log(`CR-06 disposable certification PASS (${assertions} assertions; no enrollment, task, or provider transport).`);
} finally {
  await infrastructure.releaseRedisReservation();
}