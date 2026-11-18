/** Phase 7 real PostgreSQL certification. Explicitly disposable and provider-denied before application imports. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID, generateKeyPairSync, sign, createHash } from "node:crypto";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "./certification-provider-deny";
await assertDisposableTestInfrastructure({
  operation: "Phase 7 integration",
  requireRedis: true,
});
applyCertificationProviderDenyBoundary({ fatal: true });
const { pool } = await import("../server/db");
const { runDrizzleMigrations } = await import("../server/db-migrate");
const { PHASE7_NATIVE_ENTRY } =
  await import("../server/native-objects/phase7.generated");
const {
  experimentDigest,
  freezeCro07Experiment,
  startCro07Experiment,
  stopCro07Experiment,
  decideCro07Experiment,
  evaluateCro07Experiment,
} = await import("../server/services/cro07-experiments");
const { readConversionFunnel, exportConversionFunnel } =
  await import("../server/services/conversion-funnel");
const {
  getOrCreateSequenceAbAssignment,
  bindPhase7Dispatch,
  bindPhase7FinalEnvelope,
} = await import("../server/services/sequence-ab-authority");
const { markSendSent, markSendFailed } =
  await import("../server/services/outbound-send-log");
let n = 0;
const ok = (v: unknown, message: string) => {
  assert.ok(v, message);
  n++;
  console.log("✓ " + message);
};
const one = async (text: string, values: unknown[] = []) =>
  (await pool.query(text, values)).rows[0];
const prefix = "phase7_" + randomUUID().slice(0, 8);
try {
  await runDrizzleMigrations();
  await runDrizzleMigrations();
  ok(
    (await one(PHASE7_NATIVE_ENTRY.verifySql)).repair_verified,
    "fresh migration installs all native guards; harness replay retains them",
  );
  await pool.query(
    fs.readFileSync("migrations/0387_phase7_conversion_integrity.sql", "utf8"),
  );
  ok(
    (await one(PHASE7_NATIVE_ENTRY.verifySql)).repair_verified,
    "direct additive SQL replay is idempotent",
  );
  const { reconcileNativeObjects } =
    await import("../server/native-objects/reconciler");
  const replicas = await Promise.all([
    reconcileNativeObjects({ entries: [PHASE7_NATIVE_ENTRY], attempts: 1 }),
    reconcileNativeObjects({ entries: [PHASE7_NATIVE_ENTRY], attempts: 1 }),
  ]);
  ok(
    replicas
      .flat()
      .every((r) =>
        ["already_current", "installed", "skipped_locked"].includes(r.status),
      ),
    "concurrent native reconciler replicas retain guards",
  );
  const drift = await pool.connect();
  try {
    await drift.query("BEGIN");
    await drift.query(
      `CREATE OR REPLACE FUNCTION phase7_append_only()RETURNS trigger AS $$BEGIN RETURN NEW;END;$$LANGUAGE plpgsql`,
    );
    await assert.rejects(
      () => drift.query(PHASE7_NATIVE_ENTRY.installSql),
      /ROUTINE_DRIFT/,
    );
    n++;
    await drift.query("ROLLBACK");
    await drift.query("BEGIN");
    await drift.query(
      "ALTER TABLE cro07_attempt_envelopes RENAME TO phase7_missing_prerequisite",
    );
    await assert.rejects(
      () => drift.query(PHASE7_NATIVE_ENTRY.installSql),
      /PREREQUISITE_MISSING/,
    );
    n++;
    await drift.query("ROLLBACK");
  } finally {
    drift.release();
  }
  const actor = { id: randomUUID(), authEpoch: 0, accountVersion: 1 };
  await pool.query(`INSERT INTO users(id,email,role) VALUES($1,$2,'admin')`, [
    actor.id,
    prefix + "@example.test",
  ]);
  const domain = prefix + ".example.test";
  const business = await one(
    `INSERT INTO businesses(canonical_name,normalized_name,website_domain,record_class,do_not_visit) VALUES($1,lower($1),$2,'canonical',false) RETURNING id`,
    [prefix, domain],
  );
  const contact = await one(
    `INSERT INTO contacts(first_name,last_name,email,phone,company_name,website,record_class,email_status,title,consent_email) VALUES('Test',$1,$2,'5550000000',$3,$4,'production','unvalidated','Owner',true) RETURNING id`,
    [prefix, "owner@" + domain, prefix, "https://" + domain + "/contact"],
  );
  await pool.query(
    `INSERT INTO sunbiz_entities(filing_number,entity_name,website,source,score) VALUES($1,$2,$3,'cordata','raw')`,
    [prefix, prefix, "https://" + domain],
  );
  await pool.query(
    `INSERT INTO canonical_source_links(business_id,source_system,source_type,stable_key) VALUES($1,'sunbiz','sunbiz_entity',$2)`,
    [business.id, prefix],
  );
  const links =
    await import("../server/services/contact-business-system-links");
  const preview = await links.previewContactBusinessSystemLinks({
    afterContactId: contact.id - 1,
    limit: 1,
  });
  const link = preview.rows.find((r: any) => r.contactId === contact.id)!;
  ok(link?.eligible, "canonical source preview establishes fixture linkage");
  const linked = await links.applyContactBusinessSystemLink({
    contactId: contact.id,
    businessId: business.id,
    sourceLinkId: String(link.sourceLinkId),
    sourceEntityId: Number(link.sourceEntityId),
    snapshotHash: String(link.snapshotHash),
  });
  ok(
    linked.status === "applied",
    "fixture uses the guarded canonical linking owner",
  );
  const deal = await one(
    `INSERT INTO deals(contact_id,name,pipeline,stage,record_class) VALUES($1,$2,'sales','New Lead','production') RETURNING id`,
    [contact.id, prefix],
  );
  const seq = await one(
    `INSERT INTO follow_up_sequences(name,status,version,created_by,sequence_family) VALUES($1,'paused',1,$2,'sfp-v2-cold-phase7-fixture') RETURNING id`,
    [prefix, actor.id],
  );
  const step = await one(
    `INSERT INTO sequence_steps(sequence_id,step_order,action_type,subject,body,delay_days,delay_hours,config) VALUES($1,1,'email','Control','Hello {{companyName}}',0,0,'{"format":"plain_text"}') RETURNING id`,
    [seq.id],
  );
  for (const order of [2, 3])
    await pool.query(
      `INSERT INTO sequence_steps(sequence_id,step_order,action_type,subject,body,delay_days,delay_hours) VALUES($1,$2,'email','A question','Hello {{companyName}}',3,0)`,
      [seq.id, order],
    );
  const campaign = await one(
    `INSERT INTO campaigns(name,status)VALUES($1,'paused')RETURNING id`,
    [prefix],
  );
  const sourceSteps = (
    await pool.query(
      "SELECT * FROM sequence_steps WHERE sequence_id=$1 ORDER BY step_order",
      [seq.id],
    )
  ).rows;
  for (const s of sourceSteps)
    await pool.query(
      `INSERT INTO campaign_steps(campaign_id,step_order,step_type,subject,body_template,delay_days,channel)VALUES($1,$2,'email',$3,$4,$5,'email')`,
      [campaign.id, s.step_order, s.subject, s.body, s.delay_days],
    );
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { computeLivePackageContentHash } =
    await import("../server/services/cro03/sfp-campaign-packages");
  const packageHash = await computeLivePackageContentHash(
    drizzle(pool),
    campaign.id,
    seq.id,
  );
  await pool.query(
    `INSERT INTO sfp_campaign_package_versions(package_key,vertical,campaign_id,campaign_name,sequence_id,sequence_name,sequence_family,content_hash,lifecycle_state,actor_id)VALUES('sfp.healthcare.v2','Healthcare',$1,$2,$3,$2,'sfp-v2-cold-phase7-fixture',$4,'current',$5)`,
    [campaign.id, prefix, seq.id, packageHash, actor.id],
  );
  const { createCr06Phase7ReviewPackage, approveCr06Program } =
    await import("../server/services/cr06-premium-campaigns");
  const c = await pool.connect();
  let review: any;
  try {
    await c.query("BEGIN");
    review = await createCr06Phase7ReviewPackage({
      client: c,
      key: prefix,
      actorId: actor.id,
      vertical: "Healthcare",
      sourceSequenceId: seq.id,
      challengerSubject: "Challenger",
      followupBodies: ["Hello {{companyName}}", "Hello {{companyName}}"],
    });
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  await approveCr06Program({
    programArtifactId: review.program.id,
    expectedHash: review.program.content_hash,
    reviewerId: actor.id,
  });
  const arms: any = {};
  for (const [name, role] of [
    ["A", "control"],
    ["B", "challenger"],
  ]) {
    const a = review.family.find((a: any) => a.document.phase7?.role === role);
    arms[name] = {
      artifactId: a.id,
      contentHash: a.content_hash,
      subject: a.document.subject,
      bodyHash: a.document.phase7.bodyHash,
      cadenceHash: review.cadenceHash,
      senderPolicy: "cold_outreach",
    };
  }
  const design = {
    contractVersion: 1,
    sequenceId: seq.id,
    stepId: step.id,
    sequenceVersion: 1,
    vertical: "Healthcare",
    allocationUnit: "canonical_business",
    overlapPolicy: "one_collecting_experiment_per_business",
    outcomeMaturityDays: 7,
    collectionDays: 14,
    metric: "verified_qualified_reply_rate",
    denominator: "distinct_exposed_businesses",
    method: "fisher_exact_two_sided_v1",
    alpha: 0.05,
    comparisonFamilySize: 3,
    minPerArm: 6000,
    planning: {
      baselineRate: 0.02,
      minimumDetectableEffect: 0.02,
      power: 0.8,
      rationale: "Small disposable fixture only; not a production sample plan.",
    },
    arms,
    guardrails: [
      {
        metric: "complaint",
        denominator: "distinct_attempted_businesses",
        minimumEvidence: 1,
        maxRate: 0,
      },
    ],
  };
  const input = {
    key: prefix,
    hypothesis: "Subject-only fixture",
    metric: design.metric,
    populationDefinition: { fixture: true },
    allocation: { A: 0.5, B: 0.5 },
    versions: arms,
    minSampleSize: 6000,
    minDurationDays: 14,
    confidenceRule: { method: design.method, alpha: 0.05 },
    guardrails: [],
    frozenBy: actor.id,
    phase7Design: design,
  };
  process.env.SMTP_HOST = "smtp.sendgrid.net";
  process.env.SMTP_USER = "apikey";
  process.env.SMTP_PASS = "SG.fixture_key_id_12345.fixture_not_a_real_secret";
  let e = await freezeCro07Experiment(input, {
    actor,
    commandId: randomUUID(),
    expectedVersion: 1,
  });
  ok(
    e.state === "frozen_design",
    "approved subject-only experiment freezes through owner",
  );
  const replay = await freezeCro07Experiment(input, {
    actor,
    commandId: randomUUID(),
    expectedVersion: 1,
  });
  ok(replay.id === e.id, "identical design is idempotent");
  const { resolvePolicy } = await import("../server/services/sender-policy");
  const policy = resolvePolicy("cold_outreach");
  const sg = await import("../server/services/phase7-sendgrid");
  await assert.rejects(
    () =>
      startCro07Experiment(e.id, {
        actor,
        commandId: randomUUID(),
        expectedVersion: e.revision,
      }),
    /FEEDBACK_COVERAGE_NOT_READY/,
  );
  n++;
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKey = keys.publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");
  process.env.PHASE7_MEASUREMENT_ENABLED = "true";
  process.env.SENDGRID_API_KEY = "fixture-not-a-real-api-key";
  process.env.SENDGRID_EVENT_WEBHOOK_ID = "fixture-webhook";
  process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY = publicKey;
  process.env.CRO07_SEQUENCE_FEEDBACK_SOURCE = "sendgrid";
  process.env.CRO07_SEQUENCE_FEEDBACK_ACCOUNT = policy.from;
  await pool.query(
    `INSERT INTO gmail_mailbox_reader_state(account_email,state,history_cursor,account_fingerprint,last_success_at,phase7_history_complete)VALUES($1,'active','100',$2,clock_timestamp(),true)`,
    [
      policy.replyTo || policy.from,
      createHash("sha256")
        .update(
          "gmail-account:" + (policy.replyTo || policy.from).toLowerCase(),
        )
        .digest("hex"),
    ],
  );
  let settingsReads = 0;
  const probe = await sg.observePhase7SendGridCoverage((async (
    url: any,
    options: any,
  ) => {
    settingsReads++;
    assert.equal(options.method, "GET");
    return new Response(
      JSON.stringify(
        String(url).includes("/api_keys/")
          ? { result: [{ api_key_id: "fixture_key_id_12345", scopes: ["mail.send"] }] }
          : String(url).includes("/signed/")
            ? { id: "fixture-webhook", public_key: publicKey }
            : {
                id: "fixture-webhook",
                enabled: true,
                url: "https://libertybancard.com/api/webhooks/cro07/sendgrid",
                public_key: publicKey,
                delivered: true,
                bounce: true,
                spam_report: true,
                unsubscribe: true,
                group_unsubscribe: true,
                processed: true,
                dropped: true,
              },
      ),
      { status: 200 },
    );
  }) as typeof fetch);
  ok(
    probe.state === "observed_healthy" && settingsReads === 3,
    "SendGrid coverage owner verifies read-only provider settings, SMTP account ownership and actual complete mailbox state",
  );
  const sendGridEvent = async (events: any[]) => {
    const raw = Buffer.from(JSON.stringify(events)),
      stamp = String(Math.floor(Date.now() / 1000)),
      signature = sign(
        "sha256",
        Buffer.concat([Buffer.from(stamp), raw]),
        keys.privateKey,
      ).toString("base64");
    return sg.receivePhase7SendGrid(raw, signature, stamp);
  };
  e = await startCro07Experiment(e.id, {
    actor,
    commandId: randomUUID(),
    expectedVersion: e.revision,
  });
  const enrollment = await one(
    `INSERT INTO sequence_enrollments(sequence_id,contact_id,status,current_step) VALUES($1,$2,'active',0) RETURNING id`,
    [seq.id, contact.id],
  );
  const assign = () =>
    getOrCreateSequenceAbAssignment({
      enrollmentId: enrollment.id,
      stepId: step.id,
      splitRatio: 50,
      config: { experimentId: e.id },
      eligibilitySnapshot: {},
    });
  const allocated = await Promise.all([assign(), assign(), assign()]);
  ok(
    allocated.every((a) => a === allocated[0]),
    "concurrent workers retain one business allocation",
  );
  const subject = design.arms[allocated[0]].subject;
  const { sfpLaunchRenderContext, renderSfpLaunchBodyHtml } =
    await import("../server/services/sfp-launch-render");
  const body = renderSfpLaunchBodyHtml(
    "Hello {{companyName}}",
    sfpLaunchRenderContext({
      firstName: "Test",
      lastName: prefix,
      companyName: prefix,
      email: "owner@" + domain,
    }),
  );
  const log = await one(
    `INSERT INTO outbound_send_log(idempotency_key,sequence_id,sequence_enrollment_id,contact_id,step_order,channel,to_address,subject,status) VALUES($1,$2,$3,$4,1,'email_smtp','fixture@example.test',$5,'pending') RETURNING id`,
    [prefix, seq.id, enrollment.id, contact.id, subject],
  );
  await bindPhase7Dispatch({
    enrollmentId: enrollment.id,
    stepId: step.id,
    idempotencyKey: prefix,
    subject,
    body,
  });
  await bindPhase7FinalEnvelope({
    idempotencyKey: prefix,
    to: "fixture@example.test",
    subject,
    html: body + " footer",
    text: "fixture",
    from: policy.from,
    fromHeader: `"${policy.displayName.replace(/["\\]/g, "")}" <${policy.from}>`,
    replyTo: policy.replyTo,
    headers: {},
  });
  const earlyEvent = {
    sg_event_id: prefix + "-early-open",
    sg_message_id: prefix + "-sendgrid-message",
    event: "open",
    email: "fixture@example.test",
    "smtp-id": "<" + prefix + "@fixture.test>",
    timestamp: Math.floor(Date.now() / 1000),
  };
  ok(
    (await sendGridEvent([earlyEvent])).applied === 0,
    "signed pre-receipt observation is retained without inventing exposure",
  );
  await markSendFailed({
    idempotencyKey: prefix,
    failureReason: "definitively rejected fixture",
  });
  ok(
    Number(
      (
        await one(
          `SELECT count(*) AS n FROM cro07_receipt_exposures WHERE outbound_log_id=$1`,
          [log.id],
        )
      ).n,
    ) === 0,
    "failed transport is not exposure",
  );
  await markSendSent({
    idempotencyKey: prefix,
    providerMessageId: "<" + prefix + "@fixture.test>",
  });
  await markSendSent({
    idempotencyKey: prefix,
    providerMessageId: "<" + prefix + "@fixture.test>",
  });
  ok(
    Number(
      (
        await one(
          `SELECT count(*) AS n FROM cro07_receipt_exposures WHERE outbound_log_id=$1`,
          [log.id],
        )
      ).n,
    ) === 1,
    "failed-first successful-retry and receipt replay count once",
  );
  await sg.reconcilePhase7SendGridEvents();
  ok(
    Number(
      (
        await one(
          `SELECT count(*) AS n FROM cro07_verified_outcomes o JOIN cro07_provider_receipts r ON r.id::text=o.receipt_id WHERE r.provider_event_id=$1`,
          [earlyEvent.sg_event_id],
        )
      ).n,
    ) === 1,
    "retained signed observation repairs after definitive receipt without rewriting its original receipt",
  );
  ok(
    (await sendGridEvent([earlyEvent])).applied === 1,
    "identical signed event replays without duplicate outcomes",
  );
  await assert.rejects(
    () => sendGridEvent([{ ...earlyEvent, event: "click" }]),
    /REPLAY_CONFLICT/,
  );
  n++;
  const linkedEvent = {
    sg_event_id: prefix + "-linked-click",
    sg_message_id: earlyEvent.sg_message_id,
    event: "click",
    email: "fixture@example.test",
    timestamp: Math.floor(Date.now() / 1000),
  };
  ok(
    (await sendGridEvent([linkedEvent])).applied === 1,
    "SendGrid ID without SMTP ID resolves only through an exact signed account/recipient crosswalk",
  );
  ok(
    (
      await sendGridEvent([
        {
          ...linkedEvent,
          sg_event_id: prefix + "-foreign",
          email: "foreign@example.test",
        },
      ])
    ).applied === 0,
    "foreign recipient cannot borrow a valid SendGrid message relation",
  );
  ok(
    (await sg.readPhase7FeedbackCoverage(pool, e)).status === "unavailable",
    "a healthy current probe never fabricates coverage of the future experiment horizon",
  );
  await assert.rejects(
    () =>
      pool.query(
        `UPDATE cro07_feedback_coverage_observations SET healthy=true`,
      ),
    /append.only|immutable/i,
  );
  n++;
  await assert.rejects(
    () =>
      markSendSent({
        idempotencyKey: prefix,
        providerMessageId: "foreign-provider-id",
      }),
    /PROVIDER_ID_CONFLICT/,
  );
  n++;
  await assert.rejects(
    () =>
      bindPhase7Dispatch({
        enrollmentId: enrollment.id,
        stepId: step.id,
        idempotencyKey: prefix,
        subject: "FORGED",
        body,
      }),
    /CONTENT_DRIFT/,
  );
  n++;
  const {
    ingestPhase7MailboxReceipt,
    qualifyPhase7Reply,
    ingestPhase7ProviderFeedback,
  } = await import("../server/services/phase7-feedback");
  const headers = {
    from: "fixture@example.test",
    subject: "Reply",
    messageId: "<reply@fixture.test>",
    inReplyTo: "<" + prefix + "@fixture.test>",
    references: null,
    autoSubmitted: null,
    precedence: null,
    xAutoreply: null,
    xFailedRecipients: null,
    contentType: "text/plain",
    labelIds: ["INBOX"],
  };
  const receipt = await ingestPhase7MailboxReceipt(policy.replyTo, {
    providerMessageId: prefix + "-reply",
    receivedAt: new Date(),
    headers,
  });
  ok(
    receipt?.reason === "EXACT_MESSAGE_ACCOUNT_AND_RECIPIENT",
    "authenticated mailbox receipt binds exact account, recipient and RFC message",
  );
  const wrong = await ingestPhase7MailboxReceipt("wrong@example.test", {
    providerMessageId: prefix + "-wrong",
    receivedAt: new Date(),
    headers,
  });
  ok(!wrong.exposure_id, "foreign mailbox receipt remains unlinked");
  const automated = await ingestPhase7MailboxReceipt(policy.replyTo, {
    providerMessageId: prefix + "-auto",
    receivedAt: new Date(),
    headers: { ...headers, autoSubmitted: "auto-replied" },
  });
  ok(automated.kind === "automated", "automated reply remains diagnostic");
  const cmd = { actor, commandId: randomUUID(), expectedVersion: e.revision };
  const qualification = {
    experimentId: e.id,
    receiptId: receipt.id,
    classification: "qualified" as const,
    reason:
      "Explicit request for a statement review, inspected by the fixture reviewer.",
    dealId: deal.id,
  };
  await qualifyPhase7Reply(qualification, cmd);
  await qualifyPhase7Reply(qualification, cmd);
  ok(
    Number(
      (
        await one(
          `SELECT count(*) AS n FROM cro07_verified_outcomes WHERE kind='qualified_reply'`,
        )
      ).n,
    ) === 1,
    "review of a real receipt produces one qualified success, without a new exposure",
  );
  await assert.rejects(
    () =>
      qualifyPhase7Reply(
        { ...qualification, receiptId: automated.id },
        { ...cmd, commandId: randomUUID() },
      ),
    /VERIFIED_REPLY_REQUIRED/,
  );
  n++;
  let releaseLease!: () => void, claimObserved!: () => void;
  const leased = new Promise<void>((r) => (claimObserved = r)),
    resume = new Promise<void>((r) => (releaseLease = r));
  const oldEvaluator = evaluateCro07Experiment(e.id, undefined, {
    onLeaseClaimed: async () => {
      claimObserved();
      await resume;
    },
  });
  await leased;
  await pool.query(
    "UPDATE cro07_experiments SET evaluation_lease_expires_at=now()-interval '1 second' WHERE id=$1",
    [e.id],
  );
  await evaluateCro07Experiment(e.id);
  releaseLease();
  await assert.rejects(() => oldEvaluator, /LEASE_LOST/);
  n++;
  ok(
    Number(
      (
        await one(
          "SELECT count(*) AS n FROM cro07_evaluation_snapshots WHERE experiment_id=$1",
          [e.id],
        )
      ).n,
    ) === 0,
    "expired evaluator cannot insert or overwrite a snapshot after recovery",
  );
  const evaluated = await evaluateCro07Experiment(e.id);
  ok(
    evaluated.state === "insufficient_data",
    "sample, maturity and telemetry gates hold without winner",
  );
  const evaluationCommand = {
    actor,
    commandId: randomUUID(),
    expectedVersion: e.revision,
  };
  await evaluateCro07Experiment(e.id, evaluationCommand);
  const evaluationReplay = await evaluateCro07Experiment(
    e.id,
    evaluationCommand,
  );
  ok(
    evaluationReplay.replayed,
    "manual evaluation command replays its immutable result",
  );
  const frozen = await freezeCro07Experiment(
    { ...input, key: prefix + "-stop" },
    { actor, commandId: randomUUID(), expectedVersion: 1 },
  );
  const stopCommand = {
    actor,
    commandId: randomUUID(),
    expectedVersion: frozen.revision,
  };
  await stopCro07Experiment(frozen.id, "cancelled", stopCommand);
  ok(
    (await stopCro07Experiment(frozen.id, "cancelled", stopCommand)).replayed,
    "stop is audited and idempotent",
  );
  process.env.CRO07_SEQUENCE_FEEDBACK_SOURCE = "phase7_fixture";
  process.env.CRO07_SEQUENCE_FEEDBACK_ACCOUNT = policy.from;
  const provider = {
    source: "phase7_fixture",
    providerAccountId: policy.from,
    providerEventId: prefix + "-complaint",
    providerMessageId: "<" + prefix + "@fixture.test>",
    eventType: "complaint" as const,
    occurredAt: new Date(),
    payloadHash: experimentDigest({ fixture: prefix }),
  };
  await assert.rejects(
    () =>
      ingestPhase7ProviderFeedback({
        ...provider,
        providerAccountId: "foreign-account",
      }),
    /ACCOUNT_MISMATCH/,
  );
  n++;
  await ingestPhase7ProviderFeedback(provider);
  await ingestPhase7ProviderFeedback(provider);
  const stopped = await one("SELECT * FROM cro07_experiments WHERE id=$1", [
    e.id,
  ]);
  ok(
    stopped.state === "stopped_guardrail",
    "signed receipt crosses frozen guardrail and atomically stops experimental dispatch",
  );
  await assert.rejects(
    () =>
      decideCro07Experiment({
        experimentId: e.id,
        decision: "winner_a",
        decidedBy: actor.id,
        evaluationId: randomUUID(),
        command: {
          actor,
          expectedVersion: stopped.revision,
          commandId: randomUUID(),
        },
      }),
    /NOT_DECIDABLE/,
  );
  n++;
  await assert.rejects(
    () =>
      bindPhase7Dispatch({
        enrollmentId: enrollment.id,
        stepId: step.id,
        idempotencyKey: prefix,
        subject,
        body,
      }),
    /REVOKED/,
  );
  n++;
  // Durable same-transaction evidence owner and a full ordered fixture cohort.
  for (const [i, stage] of [
    "lead",
    "engaged",
    "statement_requested",
    "statement_received",
    "proposal_sent",
    "application",
    "closed_won",
  ].entries()) {
    await pool.query(
      `SELECT phase7_emit_conversion('fixture',$1,$2,$3,$4,$5,'{"source":"fixture"}')`,
      [
        prefix + "-" + stage,
        stage,
        contact.id,
        deal.id,
        new Date(Date.UTC(2026, 10, 1, 12 + i)),
      ],
    );
  }
  const { funnelQuerySchema } = await import("../shared/conversion-funnel");
  const q = funnelQuerySchema.parse({
    start: "2026-11-01",
    end: "2026-11-02",
    asOf: "2026-11-17T00:00:00Z",
  });
  // Fixture ingestion uses actual current clock, so pin a current cutoff for this synthetic historical occurrence set.
  q.asOf = new Date().toISOString();
  const report = await readConversionFunnel(q);
  ok(
    report.stages.every((s) => s.count === 1),
    "all seven ordered stages reconcile to one business sales journey",
  );
  ok(
    report.drilldown.total === report.stages[0].count,
    "drilldown and chart share the exact population",
  );
  let csv = "";
  for await (const chunk of exportConversionFunnel(q)) csv += chunk;
  ok(
    csv.split("\r\n").length === 3,
    "full cursor export has header and the complete journey",
  );
  await assert.rejects(
    () =>
      pool.query(
        `UPDATE conversion_journey_evidence SET dimensions='{}' WHERE source_type='fixture'`,
      ),
    /IMMUTABLE/,
  );
  n++;
  const before = await one(
    `SELECT count(*)::int AS n FROM conversion_journey_evidence`,
  );
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query(
      `SELECT phase7_emit_conversion('fixture','rollback','lead',$1,$2,now(),'{}')`,
      [contact.id, deal.id],
    );
    await tx.query("ROLLBACK");
  } finally {
    tx.release();
  }
  ok(
    (await one(`SELECT count(*)::int AS n FROM conversion_journey_evidence`))
      .n === before.n,
    "rolled-back business transaction leaves no milestone",
  );
  const { aggregateDailyMetrics } =
    await import("../server/services/sdr/funnel-metrics");
  for (const [state, source, created, bucket] of [
    ["FL", "import", "2026-11-01T05:00:00Z", "A"],
    ["GA", "discovery", "2026-11-02T04:30:00Z", "B"],
  ]) {
    const merchant = await one(
      `INSERT INTO sdr_merchants(business_name)VALUES($1)RETURNING id`,
      [prefix + "-" + state],
    );
    await pool.query(
      `INSERT INTO sdr_lead_state(merchant_id,contact_id,vertical,state,source_type,email,priority_bucket,created_at)VALUES($1,$2,'Healthcare',$3,$4,'fixture@example.test',$5,$6)`,
      [merchant.id, contact.id, state, source, bucket, created],
    );
  }
  await aggregateDailyMetrics("2026-11-01");
  const daily = (
    await pool.query(
      `SELECT * FROM daily_funnel_metrics WHERE date='2026-11-01' ORDER BY id`,
    )
  ).rows;
  ok(
    daily.find((r) => r.vertical === null)?.leads_found === 2,
    "numeric daily rollup includes the full 25-hour Eastern DST day without string concatenation " +
      JSON.stringify(
        daily.map((r) => ({
          vertical: r.vertical,
          state: r.state,
          source: r.source_type,
          found: r.leads_found,
          enriched: r.leads_enriched,
        })),
      ),
  );
  ok(
    daily.filter((r) => r.vertical === "Healthcare").length === 2 &&
      daily
        .filter((r) => r.vertical === "Healthcare")
        .every((r) => r.leads_enriched === 1),
    "retained enrichment totals use the exact vertical/state/source grain",
  );
  await pool.query(
    `CREATE FUNCTION phase7_fixture_daily_failure()RETURNS trigger AS $$BEGIN RAISE EXCEPTION 'FIXTURE_AGGREGATE_INSERT_FAILURE';END;$$LANGUAGE plpgsql;CREATE TRIGGER phase7_fixture_daily_failure BEFORE INSERT ON daily_funnel_metrics FOR EACH ROW EXECUTE FUNCTION phase7_fixture_daily_failure()`,
  );
  try {
    await assert.rejects(
      () => aggregateDailyMetrics("2026-11-01"),
      (error: any) =>
        error.cause?.message === "FIXTURE_AGGREGATE_INSERT_FAILURE",
    );
    n++;
    const after = (
      await pool.query(
        `SELECT * FROM daily_funnel_metrics WHERE date='2026-11-01' ORDER BY id`,
      )
    ).rows;
    ok(
      JSON.stringify(after) === JSON.stringify(daily),
      "failed aggregate replacement preserves every prior row and lineage in one transaction",
    );
  } finally {
    await pool.query(
      "DROP TRIGGER phase7_fixture_daily_failure ON daily_funnel_metrics;DROP FUNCTION phase7_fixture_daily_failure()",
    );
  }
  const { createCr06ExperimentDraft } =
    await import("../server/services/cr06-premium-campaigns");
  const handoffClient = await pool.connect();
  const approvedBefore = (
    await pool.query(
      `SELECT id,content_hash,document FROM cr06_artifacts WHERE governance_state='approved_inactive' ORDER BY id`,
    )
  ).rows;
  try {
    await handoffClient.query("BEGIN");
    const handoff = await createCr06ExperimentDraft({
      client: handoffClient,
      parentArtifactId: arms.A.artifactId,
      identityKey: prefix + "-handoff",
      actorId: actor.id,
      subject: arms.A.subject,
      experimentId: e.id,
    });
    const family = (
      await handoffClient.query(
        `WITH RECURSIVE f AS(SELECT * FROM cr06_artifacts WHERE id=$1 UNION ALL SELECT a.* FROM cr06_artifacts a JOIN f ON a.parent_artifact_id=f.id)SELECT * FROM f`,
        [handoff.id],
      )
    ).rows;
    ok(
      family.length === 7 &&
        family.every((r) => r.governance_state === "draft"),
      "winner handoff creates a new complete draft family through CR-06",
    );
    await handoffClient.query("COMMIT");
  } catch (error) {
    await handoffClient.query("ROLLBACK");
    throw error;
  } finally {
    handoffClient.release();
  }
  ok(
    JSON.stringify(
      (
        await pool.query(
          `SELECT id,content_hash,document FROM cr06_artifacts WHERE governance_state='approved_inactive' ORDER BY id`,
        )
      ).rows,
    ) === JSON.stringify(approvedBefore),
    "draft handoff preserves every approved artifact byte",
  );
  ok(
    Number(
      (
        await one(
          "SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'",
        )
      ).n,
    ) === 0,
    "completed owner commands release no client with an open transaction",
  );
  // Synthetic private rows exercise the SQL continuity predicate; these are not elapsed live observation claims.
  const currentProof = await one(
    `SELECT * FROM cro07_feedback_coverage_observations ORDER BY id LIMIT 1`,
  );
  const spanStart = new Date(Date.now() - 60 * 60000),
    spanEnd = new Date(Date.now() - 20 * 60000);
  await pool.query(
    `INSERT INTO cro07_feedback_coverage_observations(sender_account,reply_account,identity_hash,healthy,reason,proof,observed_at)SELECT $1,$2,$3,true,'synthetic_disposable_continuity_fixture',$4,g FROM generate_series($5::timestamptz-interval '5 minutes',$6::timestamptz+interval '5 minutes',interval '5 minutes')g`,
    [
      currentProof.sender_account,
      currentProof.reply_account,
      currentProof.identity_hash,
      currentProof.proof,
      spanStart,
      spanEnd,
    ],
  );
  const synthetic = {
    ...e,
    id: randomUUID(),
    started_at: spanStart,
    maturity_ends_at: new Date(+spanEnd - 24 * 3600_000),
  };
  ok(
    (await sg.readPhase7FeedbackCoverage(pool, synthetic)).status ===
      "complete",
    "SQL coverage requires a full observed chain through the fixed retry grace in a synthetic private horizon",
  );
  await pool.query(
    `INSERT INTO cro07_feedback_coverage_observations(sender_account,reply_account,identity_hash,healthy,reason,proof,observed_at)VALUES($1,$2,$3,false,'synthetic_gap',$4,$5)`,
    [
      currentProof.sender_account,
      currentProof.reply_account,
      currentProof.identity_hash,
      currentProof.proof,
      new Date(+spanStart + 15 * 60000),
    ],
  );
  ok(
    (await sg.readPhase7FeedbackCoverage(pool, synthetic)).status ===
      "unavailable",
    "one unhealthy observation invalidates the complete SQL horizon",
  );
  console.log(
    `Phase 7 integration PASS: ${n} checks, disposable infrastructure only, zero real sends.`,
  );
} finally {
  await pool.end();
}
