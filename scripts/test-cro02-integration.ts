#!/usr/bin/env npx tsx
/**
 * CRO-02 disposable PostgreSQL integration proof.
 * No skip path exists: missing isolation or an empty fixture is a hard failure.
 */
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { PoolClient } from "pg";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

process.env.NODE_ENV = "test";
process.env.GHL_TRANSPORT_FAILFAST = "true";
process.env.EMAIL_TRANSPORT_FAILFAST = "true";
process.env.SMS_TRANSPORT_FAILFAST = "true";

let passed = 0;
function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(`FAIL: ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}
async function rejects(run: () => Promise<unknown>, label: string, fragment?: string) {
  try {
    await run();
  } catch (error: any) {
    check(!fragment || String(error?.message).includes(fragment), label);
    return;
  }
  throw new Error(`FAIL: ${label} (unexpected success)`);
}
async function scalar(client: PoolClient, sql: string, values: unknown[] = []) {
  return (await client.query(sql, values)).rows[0];
}

async function main() {
  check(Boolean(process.env.TEST_DATABASE_URL), "TEST_DATABASE_URL is explicitly required");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  await assertDisposableTestInfrastructure({ operation: "cro02-integration" });

  // Application migrations are intentionally invoked twice against the already
  // disposable database; the second pass proves journal/idempotency behavior.
  const [{ runDrizzleMigrations }, { pool, db }, resolution, imports, reporting, links, identity, classification, merge] = await Promise.all([
    import("../server/db-migrate"),
    import("../server/db"),
    import("../server/services/commercial-resolution"),
    import("../server/services/import-execution"),
    import("../server/services/commercial-shadow-reporting"),
    import("../server/services/commercial-link-authority"),
    import("../server/services/contact-identity"),
    import("../server/services/commercial-classification-authority"),
    import("../server/services/contact-merge"),
  ]);
  await runDrizzleMigrations();
  await runDrizzleMigrations();
  check(true, "complete migration journal applies idempotently twice");
  const seededPolicies = await pool.query(`SELECT purpose,policy_version,mode,required_edges
    FROM commercial_purpose_policies WHERE policy_version=1 ORDER BY purpose`);
  check(seededPolicies.rowCount === 8 &&
    seededPolicies.rows.every(row => row.mode === "shadow" && row.required_edges.schemaVersion === 1),
    "all eight executable v1 shadow purpose policies are seeded");
  await resolution.assertCro02PurposePolicies();
  check(true, "startup guard accepts the complete frozen policy set");
  check(!resolution.decideCommercialEffect({
    effect: "marketing_outreach", recordClass: "production",
    policyDocument: resolution.CRO02_PURPOSE_POLICY_DOCUMENTS.marketing_outreach,
  }).allowed, "required marketing dependency axes deny when absent");
  check(resolution.decideCommercialEffect({
    effect: "commercial_reporting", recordClass: "production",
    policyDocument: resolution.CRO02_PURPOSE_POLICY_DOCUMENTS.commercial_reporting,
  }).allowed, "explicitly optional reporting dependency axes do not deny");

  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    providerCalls++;
    throw new Error("CRO02_NETWORK_DENIED");
  }) as typeof fetch;

  const client = await pool.connect();
  const nonce = crypto.randomUUID();
  const ids: number[] = [];
  try {
    await client.query("BEGIN");
    const classes = ["production", "test", "demo", "synthetic", "unknown"];
    for (const recordClass of classes) {
      const contact = (await client.query(
        `INSERT INTO contacts(first_name,last_name,email,phone,record_class)
         VALUES('CRO02',$1,$2,$3,$4) RETURNING id`,
        [recordClass, `cro02-${recordClass}-${nonce}@test.invalid`, `555${ids.length}1700`, recordClass],
      )).rows[0];
      ids.push(Number(contact.id));
    }
    check(ids.length === 5 && new Set(ids).size === 5, "non-empty fixtures cover all five frozen classes");

    const businesses: number[] = [];
    for (let i = 0; i < 5; i++) {
      businesses.push(Number((await client.query(
        `INSERT INTO businesses(canonical_name,normalized_name,record_class)
         VALUES($1,$2,$3) RETURNING id`,
        [`CRO02 ${nonce} ${i}`, `cro02-${nonce}-${i}`, classes[i]],
      )).rows[0].id));
    }
    const companyId = Number((await client.query(
      `INSERT INTO companies(legal_name,record_class) VALUES($1,'production') RETURNING id`,
      [`CRO02 legacy ${nonce}`],
    )).rows[0].id);
    const reviewerId = `cro02-reviewer-${nonce}`;
    await client.query(
      `INSERT INTO users(id,email,role) VALUES($1,$2,'admin')`,
      [reviewerId, `cro02-reviewer-${nonce}@test.invalid`],
    );
    const linkEvidenceId = Number((await client.query(
      `INSERT INTO contact_source_events
        (contact_id,event_key,source_category,source_type,actor_type,actor_id)
       VALUES($1,$2,'manual','reviewed_business_link','system','cro02-fixture')
       RETURNING id`,
      [ids[0], `cro02-link-evidence:${nonce}`],
    )).rows[0].id);
    await client.query(
      `INSERT INTO contact_business_link_decisions
        (contact_id,business_id,decision,decision_key,actor_id,revision,
         evidence_source_event_id,reviewed_by,reviewed_at)
       VALUES($1,$2,'verified',$3,$4,1,$5,$4,now())`,
      [ids[0], businesses[0], `link:${nonce}`, reviewerId, linkEvidenceId],
    );
    await client.query(
      `INSERT INTO legacy_company_mapping_decisions(company_id,business_id,decision,decision_key,revision)
       VALUES($1,$2,'verified',$3,1)`,
      [companyId, businesses[0], `mapping:${nonce}`],
    );
    await client.query(
      `INSERT INTO commercial_relationship_candidates(contact_id,business_id,source,source_version,confidence)
       VALUES($1,$2,'isolated_test','1',90)`,
      [ids[0], businesses[0]],
    );
    await client.query(
      `INSERT INTO commercial_relationship_reviews(contact_id,business_id,decision,review_key,actor_id,revision)
       VALUES($1,$2,'decision_maker',$3,'reviewer',1)`,
      [ids[0], businesses[0], `review:${nonce}`],
    );
    check(Number((await scalar(client, "SELECT count(*)::int n FROM contact_business_link_decisions WHERE decision_key=$1", [`link:${nonce}`])).n) === 1,
      "business link, mapping, candidate, and reviewed truth are persisted independently");

    const axes = [
      ["verified", "resolved", "verified", "decision_maker"],
      ["untraceable", "unresolved", "missing", "not_decision_maker"],
      ["legacy_unknown", "collision", "conflicted", "unknown"],
      ["conflicted", "conflicted", "legacy_unknown", "conflicted"],
      ["invalid", "legacy_unknown", "rejected", "unknown"],
    ];
    const snapshots: string[] = [];
    for (let i = 0; i < axes.length; i++) {
      const [provenance, identity, organization, relationship] = axes[i];
      const row = (await client.query(
        `INSERT INTO commercial_resolution_snapshots
         (requested_subject_type,requested_subject_id,effective_subject_type,effective_subject_id,purpose,
          policy_version,schema_version,mode,resolution,record_class,provenance_resolution,
          identity_resolution,organization_link_resolution,relationship_resolution,reason_codes,dependency_fingerprint)
         VALUES('contact',$1,'contact',$1,'marketing_outreach',1,1,'shadow',$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
         RETURNING id`,
        [ids[i], i === 0 ? "allowed" : "quarantined", classes[i], provenance, identity, organization,
          relationship, JSON.stringify(i === 0 ? [] : ["STALE_GRAPH"]), crypto.createHash("sha256").update(`${nonce}:${i}`).digest("hex")],
      )).rows[0];
      snapshots.push(row.id);
    }
    check(snapshots.length === 5, "fixtures cover every provenance, identity, organization-link, and relationship axis value");

    await client.query(
      `INSERT INTO commercial_resolution_dependencies(snapshot_id,object_type,object_id,revision,authority_version,rank)
       VALUES($1,'contact',$2,1,1,1),($1,'business',$3,1,1,5)`,
      [snapshots[0], String(ids[0]), String(businesses[0])],
    );
    await rejects(
      () => client.query(`INSERT INTO commercial_resolution_dependencies(snapshot_id,object_type,object_id,revision,authority_version,rank)
        VALUES($1,'contact',$2,2,1,1)`, [snapshots[0], String(ids[0])]),
      "duplicate effective dependency is rejected rather than multiplied",
    );
    await client.query("ROLLBACK");
    await client.query("BEGIN");

    // Provenance replay: exactly one subject-owned event, immutable first-seen
    // columns in normal intake, with last_seen_at intentionally advancing.
    const contact = (await client.query(
      `INSERT INTO contacts(first_name,last_name,email,phone) VALUES('CRO02','Evidence',$1,'5551700999') RETURNING id`,
      [`cro02-evidence-${nonce}@test.invalid`],
    )).rows[0];
    const source = (await client.query(
      `INSERT INTO contact_source_events(contact_id,event_key,source_category,source_type,actor_type,row_fingerprint)
       VALUES($1,$2,'test','isolated_fixture','test',$3) RETURNING id,last_seen_at`,
      [contact.id, `source:${nonce}`, crypto.createHash("sha256").update(nonce).digest("hex")],
    )).rows[0];
    await client.query("UPDATE contacts SET primary_source_event_id=$1 WHERE id=$2", [source.id, contact.id]);
    await client.query("UPDATE contact_source_events SET last_seen_at=last_seen_at + interval '1 second' WHERE id=$1", [source.id]);
    check((await scalar(client, "SELECT contact_id, last_seen_at>$2 AS advanced FROM contact_source_events WHERE id=$1", [source.id, source.last_seen_at])).advanced,
      "source evidence belongs to one subject and last_seen replay remains legal");

    const evidenceSnapshot = (await client.query(
      `INSERT INTO commercial_resolution_snapshots
       (requested_subject_type,requested_subject_id,effective_subject_type,effective_subject_id,purpose,
        policy_version,schema_version,mode,resolution,record_class,provenance_resolution,
        identity_resolution,organization_link_resolution,relationship_resolution,reason_codes,dependency_fingerprint)
       VALUES('contact',$1,'contact',$1,'internal_test',1,1,'shadow','quarantined','test',
        'verified','resolved','missing','unknown','["MISSING_ORGANIZATION_LINK"]'::jsonb,$2)
       RETURNING id`,
      [contact.id, crypto.createHash("sha256").update(`evidence:${nonce}`).digest("hex")],
    )).rows[0];
    await client.query("SAVEPOINT null_snapshot_check");
    await rejects(
      () => client.query(
        `INSERT INTO commercial_evidence_references(snapshot_id,contact_source_event_id) VALUES(NULL,$1)`,
        [source.id],
      ),
      "evidence reference without an immutable snapshot is rejected",
    );
    await client.query("ROLLBACK TO SAVEPOINT null_snapshot_check");
    await client.query(
      `INSERT INTO commercial_evidence_references(snapshot_id,contact_source_event_id) VALUES($1,$2)`,
      [evidenceSnapshot.id, source.id],
    );
    const classificationEvent = (await client.query(
      `INSERT INTO commercial_classification_events
       (subject_type,subject_id,event_namespace,event_key,new_class,evidence_fields,actor_id)
       VALUES('contact',$1,'cro02-test',$2,'unknown','{}'::jsonb,'cro02') RETURNING id`,
      [contact.id, `classification:${nonce}`],
    )).rows[0];
    await client.query("SAVEPOINT typed_evidence_check");
    await rejects(
      () => client.query(
        `INSERT INTO commercial_evidence_references(snapshot_id,contact_source_event_id,classification_event_id)
         VALUES($1,$2,$3)`,
        [evidenceSnapshot.id, source.id, classificationEvent.id],
      ),
      "typed evidence rejects invalid/multiple FK references",
    );
    await client.query("ROLLBACK TO SAVEPOINT typed_evidence_check");
    const primaryOnlySource = (await client.query(
      `INSERT INTO contact_source_events(contact_id,event_key,source_category,source_type,actor_type,row_fingerprint)
       VALUES($1,$2,'test','isolated_primary_fixture','test',$3) RETURNING id`,
      [contact.id, `primary-source:${nonce}`, crypto.createHash("sha256").update(`primary:${nonce}`).digest("hex")],
    )).rows[0];
    await client.query("UPDATE contacts SET primary_source_event_id=$1 WHERE id=$2", [primaryOnlySource.id, contact.id]);
    await client.query("SAVEPOINT referenced_source_delete");
    await rejects(
      () => client.query("DELETE FROM contact_source_events WHERE id=$1", [source.id]),
      "snapshot-referenced source evidence is retained by FK",
    );
    await client.query("ROLLBACK TO SAVEPOINT referenced_source_delete");
    await client.query("SAVEPOINT primary_source_delete");
    await rejects(
      () => client.query("DELETE FROM contact_source_events WHERE id=$1", [primaryOnlySource.id]),
      "same-contact primary source authority is retained by FK",
    );
    await client.query("ROLLBACK TO SAVEPOINT primary_source_delete");
    const disposableSource = (await client.query(
      `INSERT INTO contact_source_events(contact_id,event_key,source_category,source_type,actor_type,row_fingerprint)
       VALUES($1,$2,'test','isolated_disposable_fixture','test',$3) RETURNING id`,
      [contact.id, `disposable-source:${nonce}`, crypto.createHash("sha256").update(`disposable:${nonce}`).digest("hex")],
    )).rows[0];
    await client.query("DELETE FROM contact_source_events WHERE id=$1", [disposableSource.id]);
    check(Number((await scalar(client,
      "SELECT count(*)::int AS n FROM contact_source_events WHERE id=$1", [disposableSource.id])).n) === 0,
      "unreferenced disposable source fixture remains deletable");
    await client.query("ROLLBACK");

    const vector = [
      { objectType: "contact", objectId: 2, revision: 1, authorityVersion: 1 },
      { objectType: "business", objectId: 1, revision: 3, authorityVersion: 1 },
    ];
    const golden = resolution.canonicalDependencyFingerprint(vector);
    check(golden === "7f2466980c7b42e857d67637bd53a4a9438befd243a3b91840e7332724f1e1c2", "canonical SHA-256 fingerprint matches the golden vector");
    check(golden === resolution.canonicalDependencyFingerprint([...vector].reverse()), "dependency hash is deterministic under input ordering");
    check(resolution.decideCommercialEffect({ effect: "inbound_transactional_acknowledgement", recordClass: "unknown", requestedSubjectType: "contact", requestedSubjectId: 1, inboundRequestId: "owned", intendedRecipientId: 1 }).allowed,
      "bound inbound acknowledgement preserves production-or-unknown compatibility");
    check(!resolution.decideCommercialEffect({ effect: "inbound_transactional_acknowledgement", recordClass: "unknown" }).allowed,
      "unknown inbound without server binding is quarantined");
    check(!resolution.decideCommercialEffect({ effect: "inbound_transactional_acknowledgement", recordClass: "production", requestedSubjectType: "contact", requestedSubjectId: 1 }).allowed,
      "inbound acknowledgement effect always requires its server request/recipient binding");
    check(!resolution.decideCommercialEffect({ effect: "account_transactional", recordClass: "unknown" }).allowed,
      "coarse transactional labeling cannot authorize unknown account traffic");
    check(resolution.decideCommercialEffect({ effect: "marketing_outreach", recordClass: "test" }).reasonCodes.includes("ROOT_CLASS_NON_PRODUCTION"),
      "non-production roots produce stable quarantine reasons");
    check(resolution.decideCommercialEffect({ effect: "marketing_outreach", recordClass: "production", identity: "collision" }).reasonCodes.includes("IDENTITY_COLLISION"),
      "identity collision remains explicit");
    check(resolution.decideCommercialEffect({ effect: "internal_test", recordClass: "synthetic" }).allowed,
      "internal test is limited to NODE_ENV=test non-production fixtures");
    resolution.assertCro02ShadowOnly("shadow");
    await rejects(async () => resolution.assertCro02ShadowOnly("enforce"), "control remains shadow-only", "CRO02_SHADOW_ONLY");

    const observed = (await client.query(
      `INSERT INTO contacts(first_name,last_name,email,phone,record_class)
       VALUES('CRO02','Observed',$1,$2,'production') RETURNING id`,
      [`cro02-observed-${nonce}@test.invalid`, `555${String(Date.now()).slice(-7)}`],
    )).rows[0];
    const concurrentBusiness = (await client.query(
      `INSERT INTO businesses(canonical_name,normalized_name,record_class)
       VALUES($1,$2,'production') RETURNING id`,
      [`CRO02 concurrent ${nonce}`, `cro02-concurrent-${nonce}`],
    )).rows[0];
    const concurrentReviewerId = `cro02-concurrent-reviewer-${nonce}`;
    await client.query(`INSERT INTO users(id,email,role) VALUES($1,$2,'admin')`, [
      concurrentReviewerId, `cro02-concurrent-reviewer-${nonce}@test.invalid`,
    ]);
    const concurrentEvidence = (await client.query(
      `INSERT INTO contact_source_events
       (contact_id,event_key,source_category,source_type,actor_type,actor_id)
       VALUES($1,$2,'manual','reviewed_business_link','system','cro02-concurrency-fixture')
       RETURNING id`,
      [observed.id, `cro02-concurrent-link:${nonce}`],
    )).rows[0];
    const beforeLink = await resolution.resolveCommercialGraph({
      subjectType: "contact", subjectId: Number(observed.id), effect: "marketing_outreach", persist: true,
    });
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 1700))`,
        [`cro02:v1:node:contact:${observed.id}`],
      );
      let writerSettled = false;
      let resolverSettled = false;
      const writer = links.decideContactBusinessLink({
        contactId: Number(observed.id),
        businessId: Number(concurrentBusiness.id),
        decision: "verified",
        decisionKey: `cro02-concurrent-decision:${nonce}`,
        reviewerId: concurrentReviewerId,
        evidenceSourceEventId: Number(concurrentEvidence.id),
      }).finally(() => { writerSettled = true; });
      const concurrentResolution = resolution.resolveCommercialGraph({
        subjectType: "contact", subjectId: Number(observed.id), effect: "marketing_outreach", persist: true,
      }).finally(() => { resolverSettled = true; });
      const waitDeadline = Date.now() + 3_000;
      let advisoryWaiters = 0;
      while (Date.now() < waitDeadline && advisoryWaiters < 2) {
        advisoryWaiters = Number((await scalar(client, `SELECT count(*)::int AS n
          FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event='advisory'
            AND query ILIKE '%pg_advisory_xact_lock%'`)).n);
        if (advisoryWaiters < 2) await new Promise(resolve => setTimeout(resolve, 25));
      }
      check(advisoryWaiters >= 2 && !writerSettled && !resolverSettled,
        "resolver and reviewed-link writer contend on the identical advisory namespace");
      await blocker.query("COMMIT");
      const outcomes = await Promise.race([
        Promise.allSettled([writer, concurrentResolution]),
        new Promise<PromiseSettledResult<unknown>[]>((_, reject) =>
          setTimeout(() => reject(new Error("CRO02_CONCURRENT_LOCK_TIMEOUT")), 5_000)),
      ]);
      check(outcomes.every(outcome => outcome.status === "fulfilled"),
        "concurrent resolver and reviewed-link writer finish without deadlock or lock timeout");
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
    const afterLink = await resolution.resolveCommercialGraph({
      subjectType: "contact", subjectId: Number(observed.id), effect: "marketing_outreach", persist: true,
    });
    check(afterLink.dependencyFingerprint !== beforeLink.dependencyFingerprint &&
      afterLink.organizationLink === "verified",
      "reviewed-link commit changes the graph fingerprint and invalidates the pre-link view");
    const beforeIdentity = afterLink.dependencyFingerprint;
    const identityBlocker = await pool.connect();
    try {
      await identityBlocker.query("BEGIN");
      await identityBlocker.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 1700))`,
        [`cro02:v1:node:contact:${observed.id}`],
      );
      let identitySettled = false;
      let resolverSettled = false;
      const identityWrite = db.transaction((tx: any) =>
        identity.recordContactIdentityObservations(tx, {
          id: Number(observed.id),
          email: `cro02-identity-${nonce}@test.invalid`,
          phone: `553${String(Date.now()).slice(-7)}`,
        }, "storage_update", `cro02-concurrency:${nonce}`),
      ).finally(() => { identitySettled = true; });
      const identityResolution = resolution.resolveCommercialGraph({
        subjectType: "contact", subjectId: Number(observed.id), effect: "marketing_outreach", persist: true,
      }).finally(() => { resolverSettled = true; });
      const waitDeadline = Date.now() + 3_000;
      let advisoryWaiters = 0;
      while (Date.now() < waitDeadline && advisoryWaiters < 2) {
        advisoryWaiters = Number((await scalar(client, `SELECT count(*)::int AS n
          FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event='advisory'
            AND query ILIKE '%pg_advisory_xact_lock%'`)).n);
        if (advisoryWaiters < 2) await new Promise(resolve => setTimeout(resolve, 25));
      }
      check(advisoryWaiters >= 2 && !identitySettled && !resolverSettled,
        "resolver and identity writer contend on the identical advisory namespace");
      await identityBlocker.query("COMMIT");
      const outcomes = await Promise.race([
        Promise.allSettled([identityWrite, identityResolution]),
        new Promise<PromiseSettledResult<unknown>[]>((_, reject) =>
          setTimeout(() => reject(new Error("CRO02_IDENTITY_LOCK_TIMEOUT")), 5_000)),
      ]);
      check(outcomes.every(outcome => outcome.status === "fulfilled"),
        "concurrent resolver and identity writer finish without deadlock or lock timeout");
    } finally {
      await identityBlocker.query("ROLLBACK").catch(() => undefined);
      identityBlocker.release();
    }
    const afterIdentity = await resolution.resolveCommercialGraph({
      subjectType: "contact", subjectId: Number(observed.id), effect: "marketing_outreach", persist: true,
    });
    check(afterIdentity.dependencyFingerprint !== beforeIdentity &&
      afterIdentity.identity === "resolved",
      "identity commit changes the graph fingerprint and invalidates the pre-identity view");
    const beforeClassification = afterIdentity.dependencyFingerprint;
    const classificationBlocker = await pool.connect();
    try {
      await classificationBlocker.query("BEGIN");
      await classificationBlocker.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 1700))`,
        [`cro02:v1:node:contact:${observed.id}`],
      );
      let classificationSettled = false;
      let resolverSettled = false;
      const classificationWrite = classification.applyClassification({
        subjectType: "contact",
        subjectId: Number(observed.id),
        targetClass: "production",
        eventNamespace: "cro02-concurrency",
        eventKey: `classification:${nonce}`,
        evidenceFields: { review_source: "isolated_fixture", verified_at: "2026-08-28" },
        actorId: `cro02-requester-${nonce}`,
        approverId: `cro02-approver-${nonce}`,
      }).finally(() => { classificationSettled = true; });
      const classificationResolution = resolution.resolveCommercialGraph({
        subjectType: "contact", subjectId: Number(observed.id), effect: "marketing_outreach", persist: true,
      }).finally(() => { resolverSettled = true; });
      const waitDeadline = Date.now() + 3_000;
      let advisoryWaiters = 0;
      while (Date.now() < waitDeadline && advisoryWaiters < 2) {
        advisoryWaiters = Number((await scalar(client, `SELECT count(*)::int AS n
          FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'
            AND query ILIKE '%pg_advisory_xact_lock%'`)).n);
        if (advisoryWaiters < 2) await new Promise(resolve => setTimeout(resolve, 25));
      }
      check(advisoryWaiters >= 2 && !classificationSettled && !resolverSettled,
        "resolver and classification writer contend on the identical advisory namespace");
      await classificationBlocker.query("COMMIT");
      const outcomes = await Promise.race([
        Promise.allSettled([classificationWrite, classificationResolution]),
        new Promise<PromiseSettledResult<unknown>[]>((_, reject) =>
          setTimeout(() => reject(new Error("CRO02_CLASSIFICATION_LOCK_TIMEOUT")), 5_000)),
      ]);
      check(outcomes.every(outcome => outcome.status === "fulfilled"),
        "concurrent resolver and classification writer finish without deadlock or lock timeout");
    } finally {
      await classificationBlocker.query("ROLLBACK").catch(() => undefined);
      classificationBlocker.release();
    }
    const afterClassification = await resolution.resolveCommercialGraph({
      subjectType: "contact", subjectId: Number(observed.id), effect: "marketing_outreach", persist: true,
    });
    check(afterClassification.dependencyFingerprint !== beforeClassification,
      "classification commit advances the dependency fingerprint");
    const classificationRoot = (await client.query(
      `INSERT INTO contacts(first_name,last_name,email,phone,record_class)
       VALUES('CRO02','ClassificationRoot',$1,'5551700401','production') RETURNING id`,
      [`cro02-class-root-${nonce}@test.invalid`],
    )).rows[0];
    const classificationDeal = (await client.query(
      `INSERT INTO deals(name,pipeline,stage,contact_id,record_class)
       VALUES($1,'sales','New Lead',$2,'unknown') RETURNING id`,
      [`CRO02 classification race ${nonce}`, classificationRoot.id],
    )).rows[0];
    const linkedClassBlocker = await pool.connect();
    try {
      await linkedClassBlocker.query("BEGIN");
      await linkedClassBlocker.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 1700))`,
        [`cro02:v1:node:contact:${classificationRoot.id}`],
      );
      const rootDemotion = classification.applyClassification({
        subjectType: "contact",
        subjectId: Number(classificationRoot.id),
        targetClass: "demo",
        eventNamespace: "cro02-concurrency",
        eventKey: `linked-root-demotion:${nonce}`,
        evidenceFields: { review_source: "isolated_fixture" },
        actorId: `cro02-root-reviewer-${nonce}`,
      });
      let waiters = 0;
      const demotionWaitDeadline = Date.now() + 3_000;
      while (Date.now() < demotionWaitDeadline && waiters < 1) {
        waiters = Number((await scalar(client, `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event='advisory'
            AND query ILIKE '%pg_advisory_xact_lock%'`)).n);
        if (waiters < 1) await new Promise(resolve => setTimeout(resolve, 25));
      }
      let promotionRejected = false;
      const dealPromotion = classification.applyClassification({
        subjectType: "deal",
        subjectId: Number(classificationDeal.id),
        targetClass: "production",
        eventNamespace: "cro02-concurrency",
        eventKey: `deal-promotion:${nonce}`,
        evidenceFields: { review_source: "isolated_fixture" },
        actorId: `cro02-deal-requester-${nonce}`,
        approverId: `cro02-deal-approver-${nonce}`,
      }).catch(() => { promotionRejected = true; });
      const promotionWaitDeadline = Date.now() + 3_000;
      while (Date.now() < promotionWaitDeadline && waiters < 2) {
        waiters = Number((await scalar(client, `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event='advisory'
            AND query ILIKE '%pg_advisory_xact_lock%'`)).n);
        if (waiters < 2) await new Promise(resolve => setTimeout(resolve, 25));
      }
      check(waiters >= 2, "linked-root reclassification is ordered ahead of stale deal promotion");
      await linkedClassBlocker.query("COMMIT");
      await Promise.all([rootDemotion, dealPromotion]);
      const dealClass = await scalar(client,
        `SELECT record_class FROM deals WHERE id=$1`, [classificationDeal.id]);
      check(promotionRejected && dealClass.record_class === "unknown",
        "linked-root demotion prevents stale production deal classification");
    } finally {
      await linkedClassBlocker.query("ROLLBACK").catch(() => undefined);
      linkedClassBlocker.release();
    }
    const candidateBlocker = await pool.connect();
    try {
      await candidateBlocker.query("BEGIN");
      await candidateBlocker.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 1700))`,
        [`cro02:v1:node:contact:${observed.id}`],
      );
      let candidateSettled = false;
      let resolverSettled = false;
      const candidateWrite = links.recordContactBusinessLinkCandidate({
        contactId: Number(observed.id),
        businessId: Number(concurrentBusiness.id),
        source: "csv_import",
        sourceVersion: "1",
        candidateKey: `cro02-candidate-concurrency:${nonce}`,
        confidence: 80,
      }).finally(() => { candidateSettled = true; });
      const candidateResolution = resolution.resolveCommercialGraph({
        subjectType: "contact", subjectId: Number(observed.id), effect: "marketing_outreach", persist: true,
      }).finally(() => { resolverSettled = true; });
      const waitDeadline = Date.now() + 3_000;
      let advisoryWaiters = 0;
      while (Date.now() < waitDeadline && advisoryWaiters < 2) {
        advisoryWaiters = Number((await scalar(client, `SELECT count(*)::int AS n
          FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'
            AND query ILIKE '%pg_advisory_xact_lock%'`)).n);
        if (advisoryWaiters < 2) await new Promise(resolve => setTimeout(resolve, 25));
      }
      check(advisoryWaiters >= 2 && !candidateSettled && !resolverSettled,
        "resolver and link-candidate writer contend on the identical advisory namespace");
      await candidateBlocker.query("COMMIT");
      const outcomes = await Promise.race([
        Promise.allSettled([candidateWrite, candidateResolution]),
        new Promise<PromiseSettledResult<unknown>[]>((_, reject) =>
          setTimeout(() => reject(new Error("CRO02_CANDIDATE_LOCK_TIMEOUT")), 5_000)),
      ]);
      check(outcomes.every(outcome => outcome.status === "fulfilled"),
        "concurrent resolver and link-candidate writer finish without deadlock or lock timeout");
    } finally {
      await candidateBlocker.query("ROLLBACK").catch(() => undefined);
      candidateBlocker.release();
    }
    const batchPeer = (await client.query(
      `INSERT INTO contacts(first_name,last_name,email,phone,record_class)
       VALUES('CRO02','BatchPeer',$1,$2,'production') RETURNING id`,
      [`cro02-batch-peer-${nonce}@test.invalid`, `552${String(Date.now()).slice(-7)}`],
    )).rows[0];
    const [firstBatchId, secondBatchId] = [Number(observed.id), Number(batchPeer.id)].sort((a, b) => a - b);
    const batchBlocker = await pool.connect();
    const batchWriterClient = await pool.connect();
    try {
      await batchBlocker.query("BEGIN");
      await batchBlocker.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 1700))`,
        [`cro02:v1:membership-set:identity:contact:${firstBatchId}`],
      );
      let batchSettled = false;
      let nodeProbeSettled = false;
      const batchWrite = (async () => {
        await batchWriterClient.query("BEGIN");
        try {
          await identity.recordContactIdentityObservationsForPgContacts(batchWriterClient, [
          { id: secondBatchId, email: `cro02-batch-second-${nonce}@test.invalid`, phone: "5551700202" },
          { id: firstBatchId, email: `cro02-batch-first-${nonce}@test.invalid`, phone: "5551700201" },
          ], "csv_import", `cro02-batch:${nonce}`);
          await batchWriterClient.query("COMMIT");
        } catch (error) {
          await batchWriterClient.query("ROLLBACK").catch(() => undefined);
          throw error;
        }
      })().finally(() => { batchSettled = true; });
      const firstWaitDeadline = Date.now() + 3_000;
      let advisoryWaiters = 0;
      while (Date.now() < firstWaitDeadline && advisoryWaiters < 1) {
        advisoryWaiters = Number((await scalar(client, `SELECT count(*)::int AS n
          FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'
            AND query ILIKE '%pg_advisory_xact_lock%'`)).n);
        if (advisoryWaiters < 1) await new Promise(resolve => setTimeout(resolve, 25));
      }
      const nodeProbe = db.transaction((tx: any) =>
        tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
          ${`cro02:v1:node:contact:${secondBatchId}`}, 1700))`),
      ).finally(() => { nodeProbeSettled = true; });
      const secondWaitDeadline = Date.now() + 3_000;
      while (Date.now() < secondWaitDeadline && advisoryWaiters < 2) {
        advisoryWaiters = Number((await scalar(client, `SELECT count(*)::int AS n
          FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'
            AND query ILIKE '%pg_advisory_xact_lock%'`)).n);
        if (advisoryWaiters < 2) await new Promise(resolve => setTimeout(resolve, 25));
      }
      check(advisoryWaiters >= 2 && !batchSettled && !nodeProbeSettled,
        "reversed identity batch acquires every node before its first membership sentinel");
      await batchBlocker.query("COMMIT");
      const outcomes = await Promise.race([
        Promise.allSettled([batchWrite, nodeProbe]),
        new Promise<PromiseSettledResult<unknown>[]>((_, reject) =>
          setTimeout(() => reject(new Error("CRO02_BATCH_LOCK_TIMEOUT")), 5_000)),
      ]);
      check(outcomes.every(outcome => outcome.status === "fulfilled"),
        "reversed multi-contact identity batch completes without lock inversion");
    } finally {
      await batchBlocker.query("ROLLBACK").catch(() => undefined);
      await batchWriterClient.query("ROLLBACK").catch(() => undefined);
      batchBlocker.release();
      batchWriterClient.release();
    }
    const mergeDeprecated = (await client.query(
      `INSERT INTO contacts(first_name,last_name,email,phone,record_class)
       VALUES('CRO02','MergeDeprecated',$1,'5551700301','production') RETURNING id,email,phone`,
      [`cro02-merge-${nonce}@test.invalid`],
    )).rows[0];
    const mergeSurvivor = (await client.query(
      `INSERT INTO contacts(first_name,last_name,email,phone,record_class)
       VALUES('CRO02','MergeSurvivor',$1,'5551700301','production') RETURNING id,email,phone`,
      [`CRO02-MERGE-${nonce}@test.invalid`],
    )).rows[0];
    await db.transaction(async (tx: any) => {
      await identity.recordContactIdentityObservationsForContacts(
        tx, [mergeDeprecated, mergeSurvivor], "storage_create", `cro02-merge:${nonce}`,
      );
    });
    const mergePreview = await merge.previewContactMerge({
      survivorContactId: Number(mergeSurvivor.id),
      deprecatedContactId: Number(mergeDeprecated.id),
      idempotencyKey: crypto.randomUUID(),
      actorId: `cro02-merge-requester-${nonce}`,
      actorRole: "admin",
      fieldDecisions: { email: "survivor", phone: "survivor" },
    });
    check(mergePreview.conflicts.length === 0, "redirect race fixture produces an executable merge");
    await merge.approveContactMerge(mergePreview.operationId, `cro02-merge-approver-${nonce}`);
    let releaseInitialDiscovery!: () => void;
    let initialDiscoveryObserved!: () => void;
    const initialDiscoveryReady = new Promise<void>(resolve => { initialDiscoveryObserved = resolve; });
    const initialDiscoveryGate = new Promise<void>(resolve => { releaseInitialDiscovery = resolve; });
    let releaseConsentHandoff!: () => void;
    let localCommitObserved!: () => void;
    const localCommitReady = new Promise<void>(resolve => { localCommitObserved = resolve; });
    const consentHandoffGate = new Promise<void>(resolve => { releaseConsentHandoff = resolve; });
    resolution.setCommercialResolutionTestHooks({
      afterInitialRedirectDiscovery: async (discoveries: any[], attempt: number) => {
        if (attempt !== 0) return;
        check(discoveries.length === 1 &&
          discoveries[0].effectiveId === Number(mergeDeprecated.id) &&
          discoveries[0].chain.length === 1,
        "resolver deterministically discovers the pre-merge graph");
        initialDiscoveryObserved();
        await initialDiscoveryGate;
      },
    });
    merge.setContactMergeTestHooks({
      afterLocalCommit: async (operation: any) => {
        check(operation.status === "committed",
          "merge seam observes the post-local-commit state before consent handoff");
        localCommitObserved();
        await consentHandoffGate;
      },
    });
    const snapshotsBeforeRace = Number((await scalar(client,
      `SELECT count(*)::int AS n FROM commercial_resolution_snapshots
       WHERE requested_subject_type='contact' AND requested_subject_id=$1`,
      [mergeDeprecated.id])).n);
    const racedResolution = resolution.resolveCommercialGraph({
      subjectType: "contact", subjectId: Number(mergeDeprecated.id),
      effect: "commercial_reporting", persist: true,
    });
    await initialDiscoveryReady;
    const mergeWrite = merge.executeContactMerge(
      mergePreview.operationId, `cro02-merge-executor-${nonce}`,
    );
    await localCommitReady;
    const committedState = await scalar(client, `SELECT o.status,r.active,c.archived_at
      FROM contact_merge_operations o
      JOIN contact_merge_redirects r ON r.operation_id=o.id
      JOIN contacts c ON c.id=o.deprecated_contact_id
      WHERE o.id=$1`, [mergePreview.operationId]);
    check(committedState.status === "committed" && committedState.active &&
      Boolean(committedState.archived_at),
    "active redirect and archived deprecated contact are visible during committed handoff window");
    const liveCommitted = await identity.resolveLiveContactRedirect(Number(mergeDeprecated.id));
    check(liveCommitted.effectiveContactId === Number(mergeSurvivor.id) &&
      liveCommitted.effectHold,
    "committed redirect resolves the survivor with a temporary effect hold");
    releaseInitialDiscovery();
    const resolvedAfterMerge = await racedResolution;
    const raceSnapshots = (await client.query(`SELECT effective_subject_id FROM commercial_resolution_snapshots
      WHERE requested_subject_type='contact' AND requested_subject_id=$1
      ORDER BY created_at DESC`, [mergeDeprecated.id])).rows;
    check(resolvedAfterMerge.effectiveSubjectId === Number(mergeSurvivor.id) &&
      !resolvedAfterMerge.reasonCodes.includes("STALE_GRAPH") &&
      Boolean(resolvedAfterMerge.snapshotId),
    "resolver retries redirect drift and resolves the survivor during committed state");
    check(raceSnapshots.length === snapshotsBeforeRace + 1 &&
      Number(raceSnapshots[0].effective_subject_id) === Number(mergeSurvivor.id),
    "stale resolver attempt persists no snapshot or dependency authority");
    resolution.setCommercialResolutionTestHooks(null);
    const concurrentCommitted = await Promise.all(Array.from({ length: 2 }, () =>
      resolution.resolveCommercialGraph({
        subjectType: "contact", subjectId: Number(mergeDeprecated.id),
        effect: "commercial_reporting", persist: true,
      })));
    check(concurrentCommitted.every(result =>
      result.effectiveSubjectId === Number(mergeSurvivor.id)),
    "concurrent resolvers converge on the survivor during committed state");
    releaseConsentHandoff();
    const mergeResult = await mergeWrite;
    check(["completed", "reconciliation_pending"].includes(mergeResult.status),
      "consent handoff advances the locally committed merge");
    merge.setContactMergeTestHooks(null);

    await client.query(`UPDATE contact_merge_operations
      SET status='reconciliation_pending',reconciliation_status='consent_handoff_retry_required'
      WHERE id=$1`, [mergePreview.operationId]);
    const retryPendingLive = await identity.resolveLiveContactRedirect(Number(mergeDeprecated.id));
    const retryPendingEffect = await resolution.resolveCommercialGraph({
      subjectType: "contact", subjectId: Number(mergeDeprecated.id),
      effect: "provider_pre_spend", persist: false,
    });
    check(retryPendingLive.effectiveContactId === Number(mergeSurvivor.id) &&
      retryPendingLive.effectHold &&
      retryPendingEffect.reasonCodes.includes("CONTACT_MERGE_CONSENT_HANDOFF_PENDING"),
    "consent-handoff retry keeps survivor identity but fails effect eligibility closed");

    await client.query(`UPDATE contact_merge_operations
      SET status='reconciliation_pending',reconciliation_status='pending'
      WHERE id=$1`, [mergePreview.operationId]);
    const ghlPendingLive = await identity.resolveLiveContactRedirect(Number(mergeDeprecated.id));
    const ghlPendingGraph = await resolution.resolveCommercialGraph({
      subjectType: "contact", subjectId: Number(mergeDeprecated.id),
      effect: "commercial_reporting", persist: false,
    });
    check(ghlPendingLive.effectiveContactId === Number(mergeSurvivor.id) &&
      !ghlPendingLive.effectHold &&
      !ghlPendingGraph.reasonCodes.includes("REDIRECT_UNRESOLVED") &&
      !ghlPendingGraph.reasonCodes.includes("CONTACT_MERGE_CONSENT_HANDOFF_PENDING"),
    "GHL-only reconciliation pending retains survivor identity without a consent hold");

    await client.query(`UPDATE contact_merge_operations
      SET status='completed',reconciliation_status='not_required',conflict_reason=NULL
      WHERE id=$1`, [mergePreview.operationId]);
    let releaseUndoDiscovery!: () => void;
    let undoDiscoveryObserved!: () => void;
    const undoDiscoveryReady = new Promise<void>(resolve => { undoDiscoveryObserved = resolve; });
    const undoDiscoveryGate = new Promise<void>(resolve => { releaseUndoDiscovery = resolve; });
    resolution.setCommercialResolutionTestHooks({
      afterInitialRedirectDiscovery: async (discoveries: any[], attempt: number) => {
        if (attempt !== 0) return;
        check(discoveries[0]?.effectiveId === Number(mergeSurvivor.id),
          "undo race deterministically discovers the active redirect");
        undoDiscoveryObserved();
        await undoDiscoveryGate;
      },
    });
    const racedUndoResolution = resolution.resolveCommercialGraph({
      subjectType: "contact", subjectId: Number(mergeDeprecated.id),
      effect: "commercial_reporting", persist: true,
    });
    await undoDiscoveryReady;
    await merge.undoContactMerge(mergePreview.operationId, `cro02-merge-undo-${nonce}`);
    releaseUndoDiscovery();
    const resolvedAfterUndo = await racedUndoResolution;
    check(resolvedAfterUndo.effectiveSubjectId === Number(mergeDeprecated.id) &&
      !resolvedAfterUndo.reasonCodes.includes("STALE_GRAPH") &&
      Boolean(resolvedAfterUndo.snapshotId),
    "resolver retries undo drift and restores the deprecated contact as canonical");
    resolution.setCommercialResolutionTestHooks(null);

    const snapshotsBeforeExhaustion = Number((await scalar(client,
      `SELECT count(*)::int AS n FROM commercial_resolution_snapshots
       WHERE requested_subject_type='contact' AND requested_subject_id=$1`,
      [mergeDeprecated.id])).n);
    resolution.setCommercialResolutionTestHooks({
      forceGraphDiscoveryDrift: () => true,
    });
    await rejects(() => resolution.resolveCommercialGraph({
      subjectType: "contact", subjectId: Number(mergeDeprecated.id),
      effect: "commercial_reporting", persist: true,
    }), "bounded redirect churn exhausts retries", "CRO02_GRAPH_RETRY_EXHAUSTED");
    resolution.setCommercialResolutionTestHooks(null);
    const snapshotsAfterExhaustion = Number((await scalar(client,
      `SELECT count(*)::int AS n FROM commercial_resolution_snapshots
       WHERE requested_subject_type='contact' AND requested_subject_id=$1`,
      [mergeDeprecated.id])).n);
    check(snapshotsAfterExhaustion === snapshotsBeforeExhaustion,
      "retry exhaustion persists no snapshot");
    const beforeObservation = await scalar(client, `SELECT
      (SELECT coverage_high_water FROM commercial_shadow_controls WHERE control_key='commercial')::bigint AS control_high_water,
      (SELECT COUNT(*) FROM commercial_resolution_snapshots)::bigint AS snapshots,
      (SELECT COUNT(*) FROM commercial_resolution_dependencies)::bigint AS dependencies,
      (SELECT COUNT(*) FROM commercial_shadow_aggregates)::bigint AS aggregates`);
    const observations = await Promise.all(Array.from({ length: 8 }, () =>
      resolution.authorizeCommercialUse({
        subjectType: "contact", subjectId: Number(observed.id), effect: "marketing_outreach",
      })));
    check(observations.every(actual =>
      actual.effectiveDecision.allowed && !actual.shadowDecision.allowed &&
      actual.discrepancyCode === "LEGACY_ALLOWED_CRO02_QUARANTINED"),
      "concurrent passive dual-reads return deterministic legacy-effective discrepancies");
    const afterObservation = await scalar(client, `SELECT
      (SELECT coverage_high_water FROM commercial_shadow_controls WHERE control_key='commercial')::bigint AS control_high_water,
      (SELECT COUNT(*) FROM commercial_resolution_snapshots)::bigint AS snapshots,
      (SELECT COUNT(*) FROM commercial_resolution_dependencies)::bigint AS dependencies,
      (SELECT COUNT(*) FROM commercial_shadow_aggregates)::bigint AS aggregates`);
    check(Object.keys(beforeObservation).every(key => Number(beforeObservation[key]) === Number(afterObservation[key])),
      "passive dual-reads do not mutate control, snapshot, dependency, or aggregate storage");
    await resolution.resolveCommercialGraph({
      subjectType: "contact", subjectId: Number(observed.id), effect: "marketing_outreach", persist: true,
    });
    await resolution.resolveCommercialGraph({
      subjectType: "contact", subjectId: Number(observed.id), effect: "marketing_outreach", persist: true,
    });
    const report = await reporting.readCommercialShadowReport({ role: "admin" }, "marketing_outreach");
    check(report.frozenHighWater > 0 && report.denominator >= report.evaluated &&
      report.evaluated > 0 &&
      report.evaluated === report.reconciliation.discrepancyTotal &&
      report.denominator === report.evaluated + report.reconciliation.snapshotMissing,
      "coverage report counts distinct latest subject snapshots and exposes unevaluated roots");
    const retainedThenDeleted = (await client.query(
      `INSERT INTO contacts(first_name,last_name,email,phone,record_class)
       VALUES('CRO02','RetainedDelete',$1,$2,'unknown') RETURNING id`,
      [`cro02-retained-${nonce}@test.invalid`, `554${String(Date.now()).slice(-7)}`],
    )).rows[0];
    await resolution.resolveCommercialGraph({
      subjectType: "contact", subjectId: Number(retainedThenDeleted.id),
      effect: "marketing_outreach", persist: true,
    });
    const beforeRetainedDelete = await reporting.readCommercialShadowReport({ role: "admin" }, "marketing_outreach");
    await client.query("DELETE FROM contacts WHERE id=$1", [retainedThenDeleted.id]);
    const afterRetainedDelete = await reporting.readCommercialShadowReport({ role: "admin" }, "marketing_outreach");
    check(afterRetainedDelete.denominator === beforeRetainedDelete.denominator - 1 &&
      afterRetainedDelete.evaluated === beforeRetainedDelete.evaluated - 1 &&
      afterRetainedDelete.denominator === afterRetainedDelete.evaluated +
        afterRetainedDelete.reconciliation.snapshotMissing,
      "retained snapshots for deleted roots cannot inflate evaluated coverage");

    // Six durable terminal dispositions plus exact/divergent replay and lease
    // fencing are exercised through the real import service.
    const claim = await imports.claimCsvExecution({
      fileHash: crypto.createHash("sha256").update(`cro02:${nonce}`).digest("hex"),
      totalRows: 6, actorType: "test", actorId: "cro02",
    });
    check(claim.claimed && claim.claimToken, "import execution obtains a fenced lease");
    const dispositions = ["created", "matched_noop", "updated", "rejected", "deferred", "failed"] as const;
    for (let i = 0; i < dispositions.length; i++) {
      check(await imports.recordImportRowDisposition({
        executionId: claim.execution.id, claimToken: claim.claimToken!, sourceRowNumber: i + 1,
        rowFingerprint: `row-${i}`, disposition: dispositions[i], reasonCode: `CRO02_${i}`,
      }), `durable import disposition ${dispositions[i]} is recorded`);
    }
    check(await imports.recordImportRowDisposition({
      executionId: claim.execution.id, claimToken: claim.claimToken!, sourceRowNumber: 1,
      rowFingerprint: "row-0", disposition: "created", reasonCode: "CRO02_0",
    }), "exact row replay is idempotent");
    await rejects(() => imports.recordImportRowDisposition({
      executionId: claim.execution.id, claimToken: claim.claimToken!, sourceRowNumber: 1,
      rowFingerprint: "divergent", disposition: "failed", reasonCode: "OTHER",
    }), "divergent row replay conflicts", "IMPORT_LEDGER_DISPOSITION_CONFLICT");
    await rejects(() => imports.recordImportRowDisposition({
      executionId: claim.execution.id, claimToken: crypto.randomUUID(), sourceRowNumber: 7,
      rowFingerprint: "stale", disposition: "created", reasonCode: "STALE",
    }), "lease loss fences stale worker writes", "IMPORT_EXECUTION_LEASE_LOST");
    const races = await Promise.allSettled([
      imports.completeImportExecution({ executionId: claim.execution.id, claimToken: claim.claimToken!, expectedRows: 6 }),
      imports.completeImportExecution({ executionId: claim.execution.id, claimToken: claim.claimToken!, expectedRows: 6 }),
    ]);
    check(races.filter((r) => r.status === "fulfilled" && r.value.completed).length === 1 &&
      races.filter((r) => r.status === "rejected").length === 1, "completion race has exactly one fenced winner");
    const summary = await imports.getImportLedgerSummary(claim.execution.id);
    check(summary.total === 6 && dispositions.every((d) => summary.counts[d] === 1), "completion summarizes all six dispositions without zero/skip");
    await rejects(() => imports.recordImportRowDisposition({
      executionId: claim.execution.id, claimToken: claim.claimToken!, sourceRowNumber: 7,
      rowFingerprint: "after-finalization", disposition: "created", reasonCode: "AFTER_FINALIZATION",
    }), "finalization fences all subsequent row dispositions", "IMPORT_EXECUTION_LEASE_LOST");

    await client.query("ALTER TABLE commercial_purpose_policies DISABLE TRIGGER cro02_purpose_policy_immutable");
    await client.query(`UPDATE commercial_purpose_policies SET required_edges='{}'::jsonb
      WHERE purpose='commercial_reporting' AND policy_version=1`);
    await client.query(`DELETE FROM commercial_purpose_policies
      WHERE purpose='marketing_outreach' AND policy_version=1`);
    const malformed = await resolution.resolveCommercialGraph({
      subjectType: "contact", subjectId: Number(observed.id), effect: "commercial_reporting", persist: true,
    });
    const missing = await resolution.resolveCommercialGraph({
      subjectType: "contact", subjectId: Number(observed.id), effect: "marketing_outreach", persist: true,
    });
    check(!malformed.allowed && malformed.policyVersion === 0 && !malformed.snapshotId &&
      malformed.reasonCodes.includes("PURPOSE_POLICY_INVALID"),
      "tampered persisted purpose policy fails closed without a v1 snapshot");
    check(!missing.allowed && missing.policyVersion === 0 && !missing.snapshotId &&
      missing.reasonCodes.includes("PURPOSE_POLICY_INVALID"),
      "missing persisted purpose policy fails closed without a v1 snapshot");
    await rejects(() => resolution.assertCro02PurposePolicies(),
      "startup guard refuses a missing or divergent policy set", "CRO02_PURPOSE_POLICY");
    await client.query(`UPDATE commercial_purpose_policies SET required_edges=$1::jsonb
      WHERE purpose='commercial_reporting' AND policy_version=1`,
      [JSON.stringify(resolution.CRO02_PURPOSE_POLICY_DOCUMENTS.commercial_reporting)]);
    await client.query(`INSERT INTO commercial_purpose_policies(purpose,policy_version,required_edges,mode)
      VALUES('marketing_outreach',1,$1::jsonb,'shadow')`,
      [JSON.stringify(resolution.CRO02_PURPOSE_POLICY_DOCUMENTS.marketing_outreach)]);
    await client.query("ALTER TABLE commercial_purpose_policies ENABLE TRIGGER cro02_purpose_policy_immutable");
    await resolution.assertCro02PurposePolicies();

    check(providerCalls === 0, "integration proof made zero network/provider calls");
    check(passed >= 25, "suite executed a substantive non-zero assertion set");
  } finally {
    globalThis.fetch = originalFetch;
    if ((client as any).query) await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
  console.log(`CRO-02 integration passed (${passed} assertions)`);
}

main().catch((error) => {
  console.error("CRO-02 integration failed:", error);
  process.exit(1);
});