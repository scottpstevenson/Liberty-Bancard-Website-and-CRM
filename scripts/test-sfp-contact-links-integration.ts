/**
 * Disposable-Postgres integration coverage for strict Sunbiz-backed
 * contact→business system linking. Run only through
 * run-sfp-contact-links-integration-disposable.ts.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

await assertDisposableTestInfrastructure({
  operation: "SFP contact-business links disposable integration",
  requireRedis: false,
});

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
const nonce = randomUUID().replaceAll("-", "");
let assertionCount = 0;

function check(value: unknown, label: string): asserts value {
  assertionCount++;
  assert.ok(value, `[SFP-CONTACT-LINK-${String(assertionCount).padStart(2, "0")}] ${label}`);
  console.log(`✓ [SFP-CONTACT-LINK-${String(assertionCount).padStart(2, "0")}] ${label}`);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  assertionCount++;
  assert.equal(actual, expected, `[SFP-CONTACT-LINK-${String(assertionCount).padStart(2, "0")}] ${label}`);
  console.log(`✓ [SFP-CONTACT-LINK-${String(assertionCount).padStart(2, "0")}] ${label}`);
}

async function fixture(label: string) {
  const suffix = `${nonce}-${label}`;
  const name = `SFP Contact Link ${suffix}`;
  const domain = `${suffix}.example.test`;
  const filingNumber = `SFPCL-${suffix}`;
  const business = (await client.query(
    `INSERT INTO businesses
       (canonical_name, normalized_name, website_domain, record_class, do_not_visit)
     VALUES ($1, lower($1), $2, 'canonical', false)
     RETURNING id`,
    [name, domain],
  )).rows[0];
  const contact = (await client.query(
    `INSERT INTO contacts
       (first_name, last_name, email, phone, company_name, website, record_class,
        email_status, title, consent_email)
     VALUES ('Test', $1, $2, '5550000000', $3, $4, 'production',
        'unvalidated', 'Owner', true)
     RETURNING id`,
    [label, `owner@${domain}`, name, `https://${domain}/contact`],
  )).rows[0];
  const entity = (await client.query(
    `INSERT INTO sunbiz_entities
       (filing_number, entity_name, website, source, score)
     VALUES ($1, $2, $3, 'cordata', 'raw')
     RETURNING id`,
    [filingNumber, name, `https://${domain}`],
  )).rows[0];
  const sourceLink = (await client.query(
    `INSERT INTO canonical_source_links
       (business_id, source_system, source_type, stable_key)
     VALUES ($1, 'sunbiz', 'sunbiz_entity', $2)
     RETURNING id`,
    [business.id, filingNumber],
  )).rows[0];
  return {
    contactId: Number(contact.id),
    businessId: Number(business.id),
    sourceLinkId: String(sourceLink.id),
    sourceEntityId: Number(entity.id),
  };
}

async function previewItem(contactId: number) {
  const result = await links.previewContactBusinessSystemLinks({
    afterContactId: contactId - 1,
    limit: 1,
  });
  const row = result.rows.find((candidate: any) => candidate.contactId === contactId);
  check(row, `read-only preview includes fixture contact ${contactId}`);
  return { result, row };
}

async function applyItem(contactId: number) {
  const { row } = await previewItem(contactId);
  assert.equal(row.eligible, true, `fixture ${contactId} must be strictly eligible`);
  return {
    contactId,
    businessId: Number(row.businessId),
    sourceLinkId: String(row.sourceLinkId),
    sourceEntityId: Number(row.sourceEntityId),
    snapshotHash: String(row.snapshotHash),
  };
}

const links = await import("../server/services/contact-business-system-links");
const authority = await import("../server/services/commercial-link-authority");
const gapVector = await import("../server/services/cro03/sfp-contact-gap-vector");

async function assertBlockedByPartialSchema(item: any, label: string): Promise<void> {
  const preview = await links.previewContactBusinessSystemLinks({
    afterContactId: item.contactId - 1,
    limit: 1,
  });
  equal(preview.schemaReady, false, `${label}: preview marks schema not ready`);
  equal(preview.writes, 0, `${label}: preview remains read-only`);
  const applied = await links.applyContactBusinessSystemLink(item);
  equal(applied.status, "rejected", `${label}: apply is blocked`);
  equal(applied.code, "COMMERCIAL_SYSTEM_LINK_DATABASE_GUARD_MISSING",
    `${label}: apply returns explicit schema-guard error`);
}

async function installStrictSourceChecks(): Promise<void> {
  await client.query(`
    ALTER TABLE sfp_outreach_eligibility
      DROP CONSTRAINT IF EXISTS sfp_outreach_eligibility_source_ref_one_of_chk;
    ALTER TABLE sfp_outreach_eligibility
      ADD CONSTRAINT sfp_outreach_eligibility_source_ref_one_of_chk CHECK (
        source_kind IS NULL
        OR (source_kind = 'free' AND candidate_id IS NOT NULL
            AND paid_candidate_evidence_id IS NULL AND contact_id IS NULL)
        OR (source_kind = 'paid' AND paid_candidate_evidence_id IS NOT NULL
            AND candidate_id IS NULL AND contact_id IS NULL)
        OR (source_kind = 'contact' AND contact_id IS NOT NULL
            AND candidate_id IS NULL AND paid_candidate_evidence_id IS NULL
            AND contact_business_link_decision_id IS NOT NULL
            AND contact_business_link_revision IS NOT NULL
            AND normalized_value_hash IS NOT NULL
            AND normalized_value_hash_version IS NOT NULL
            AND normalized_value_hash_version IN (0,1))
      );
    ALTER TABLE sfp_campaign_staging_intents
      DROP CONSTRAINT IF EXISTS sfp_campaign_staging_intents_source_ref_one_of_chk;
    ALTER TABLE sfp_campaign_staging_intents
      ADD CONSTRAINT sfp_campaign_staging_intents_source_ref_one_of_chk CHECK (
        (source_kind = 'free' AND candidate_id IS NOT NULL
          AND paid_candidate_evidence_id IS NULL AND contact_id IS NULL)
        OR (source_kind = 'paid' AND paid_candidate_evidence_id IS NOT NULL
          AND candidate_id IS NULL AND contact_id IS NULL)
        OR (source_kind = 'contact' AND contact_id IS NOT NULL
          AND candidate_id IS NULL AND paid_candidate_evidence_id IS NULL
          AND contact_business_link_decision_id IS NOT NULL
          AND contact_business_link_revision IS NOT NULL
          AND normalized_value_hash IS NOT NULL
          AND normalized_value_hash_version IS NOT NULL
          AND normalized_value_hash_version IN (0,1))
      );
  `);
}

async function installPreContactSourceChecks(): Promise<void> {
  await client.query(`
    ALTER TABLE sfp_outreach_eligibility
      DROP CONSTRAINT IF EXISTS sfp_outreach_eligibility_source_ref_one_of_chk;
    ALTER TABLE sfp_outreach_eligibility
      ADD CONSTRAINT sfp_outreach_eligibility_source_ref_one_of_chk CHECK (
        source_kind IS NULL
        OR (source_kind='free' AND candidate_id IS NOT NULL AND paid_candidate_evidence_id IS NULL)
        OR (source_kind='paid' AND paid_candidate_evidence_id IS NOT NULL AND candidate_id IS NULL)
      );
    ALTER TABLE sfp_campaign_staging_intents
      DROP CONSTRAINT IF EXISTS sfp_campaign_staging_intents_source_ref_one_of_chk;
    ALTER TABLE sfp_campaign_staging_intents
      ADD CONSTRAINT sfp_campaign_staging_intents_source_ref_one_of_chk CHECK (
        (source_kind='free' AND candidate_id IS NOT NULL AND paid_candidate_evidence_id IS NULL)
        OR (source_kind='paid' AND paid_candidate_evidence_id IS NOT NULL AND candidate_id IS NULL)
      );
  `);
}

async function captureContactLinkRouteHandlers() {
  const { registerAdminRoutes } = await import("../server/routes/admin");
  const captured = new Map<string, (...args: any[]) => any>();
  const app = new Proxy({}, {
    get(_target, method: string) {
      return (...args: any[]) => {
        const routePath = args[0];
        const handler = args.at(-1);
        if (typeof routePath === "string" && typeof handler === "function") {
          captured.set(`${method.toUpperCase()} ${routePath}`, handler);
        }
      };
    },
  });
  registerAdminRoutes(app as any);
  return captured;
}

function fakeResponse() {
  const response: { statusCode: number; body: any; status(code: number): any; json(body: any): any } = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
  };
  return response;
}

let failure: unknown;
try {
  await client.connect();

  // Ensure this suite is exercising the real migration result, not a mocked or
  // hand-assembled schema.
  const guard = await client.query(
    `SELECT to_regclass('contact_business_system_link_evidence') IS NOT NULL AS evidence_table,
            EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='contact_business_link_review_contract'
                     AND tgenabled <> 'D') AS review_trigger,
            EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='contact_business_system_link_evidence_append_only'
                     AND tgenabled <> 'D') AS immutable_trigger,
            (SELECT count(*)=2 FROM pg_constraint
              WHERE conname IN ('sfp_outreach_eligibility_source_ref_one_of_chk',
                                'sfp_campaign_staging_intents_source_ref_one_of_chk')
                AND contype='c'
                AND position('contact_business_link_decision_id' in pg_get_constraintdef(oid)) > 0) AS contact_checks`,
  );
  check(
    guard.rows[0].evidence_table && guard.rows[0].review_trigger
      && guard.rows[0].immutable_trigger && guard.rows[0].contact_checks,
    "real migration-created evidence, trigger, and SFP contact-lineage contracts are present",
  );
  const contactLinkRoutes = await captureContactLinkRouteHandlers();
  const previewRoute = contactLinkRoutes.get(
    "GET /api/admin/contact-business-system-links/preview",
  );
  const applyRoute = contactLinkRoutes.get(
    "POST /api/admin/contact-business-system-links/apply",
  );
  check(previewRoute && applyRoute,
    "actual admin preview/apply handlers are captured from registerAdminRoutes");

  // Existing admin-reviewed evidence remains supported by the original
  // reviewer/source-event path, independently of system-link evidence.
  const adminFixture = await fixture("admin-reviewed");
  const adminId = `sfp-contact-link-admin-${nonce}`;
  await client.query(
    `INSERT INTO users (id, email, role) VALUES ($1, $2, 'admin')`,
    [adminId, `${adminId}@example.test`],
  );
  const adminEvent = (await client.query(
    `INSERT INTO contact_source_events
       (contact_id, event_key, source_category, source_type, actor_type, actor_id)
     VALUES ($1, $2, 'fixture', 'admin_review', 'system', 'integration-test')
     RETURNING id`,
    [adminFixture.contactId, `sfp-contact-link:${nonce}:admin-event`],
  )).rows[0];
  const reviewed = await authority.decideContactBusinessLink({
    contactId: adminFixture.contactId,
    businessId: adminFixture.businessId,
    decision: "verified",
    decisionKey: `sfp-contact-link:${nonce}:admin-decision`,
    reviewerId: adminId,
    evidenceSourceEventId: Number(adminEvent.id),
  });
  equal(reviewed.decision, "verified", "admin-reviewed link remains accepted");
  const adminStored = (await client.query(
    `SELECT reviewed_by, system_evidence_id, evidence_source_event_id
       FROM contact_business_link_decisions WHERE id=$1`,
    [reviewed.id],
  )).rows[0];
  equal(adminStored.reviewed_by, adminId, "admin reviewer identity is retained");
  equal(adminStored.system_evidence_id, null, "admin path does not fabricate system evidence");
  equal(Number(adminStored.evidence_source_event_id), Number(adminEvent.id),
    "admin source-event evidence remains attached");

  // Verified system decision and contacts.business_id projection commit
  // atomically, and the real SFP contact-reuse reader sees it.
  const successFixture = await fixture("verified");
  const successItem = await applyItem(successFixture.contactId);
  const preview = await links.previewContactBusinessSystemLinks({
    afterContactId: successFixture.contactId - 1,
    limit: 1,
  });
  check(preview.schemaReady, "strict schema guard reports ready before system apply");
  equal(preview.writes, 0, "preview remains read-only");
  equal(preview.paidProviderCalls, 0, "preview invokes no paid provider");
  const applied = await links.applyContactBusinessSystemLink(successItem);
  equal(applied.status, "applied", "eligible verified system link applies");
  const committed = (await client.query(
    `SELECT c.business_id, d.id decision_id, d.decision, d.actor_id,
            d.system_evidence_id, e.source_link_id, e.source_entity_id,
            e.facts_hash, e.facts
       FROM contacts c
       JOIN contact_business_link_decisions d
         ON d.contact_id=c.id AND d.superseded_at IS NULL
       JOIN contact_business_system_link_evidence e ON e.id=d.system_evidence_id
      WHERE c.id=$1`,
    [successFixture.contactId],
  )).rows[0];
  equal(Number(committed.business_id), successFixture.businessId,
    "verified decision is projected to contacts.business_id");
  equal(Number(committed.source_entity_id), successFixture.sourceEntityId,
    "immutable evidence retains the verified Sunbiz entity");
  equal(String(committed.source_link_id), successFixture.sourceLinkId,
    "immutable evidence retains the canonical Sunbiz source link");
  equal(committed.facts_hash, successItem.snapshotHash, "decision evidence pins preview facts hash");
  equal(committed.actor_id, "system", "automatic decision uses system authority identity");
  check(committed.facts && typeof committed.facts === "object",
    "system-link evidence stores minimized facts");

  const reuse = await gapVector.computeContactLinkReuse([successFixture.businessId]);
  const reusedBusiness = reuse.get(successFixture.businessId);
  check(reusedBusiness?.hasVerifiedContact,
    "SFP verified-contact candidate read recognizes the applied contact");
  check(reusedBusiness?.hasVerifiedNamedDecisionMaker,
    "SFP named decision-maker selection recognizes the applied owner");
  equal(reusedBusiness?.verifiedLinks[0]?.contactId, successFixture.contactId,
    "SFP candidate read returns the exact verified contact");

  // Reinstall semantically identical constraints with different source DDL
  // whitespace. Catalog deparse fingerprints are semantic, not source-format
  // pins, so a formatting-only change remains ready.
  await installStrictSourceChecks();
  const formattingOnlyPreview = await links.previewContactBusinessSystemLinks({
    afterContactId: successFixture.contactId - 1,
    limit: 1,
  });
  equal(formattingOnlyPreview.schemaReady, true,
    "formatting-only CHECK DDL changes preserve readiness via canonical expression fingerprints");

  const evidenceBeforeImmutability = await client.query(
    `SELECT facts::text, facts_hash FROM contact_business_system_link_evidence WHERE id=$1`,
    [committed.system_evidence_id],
  );
  await assert.rejects(
    client.query(
      `UPDATE contact_business_system_link_evidence SET facts='{}'::jsonb WHERE id=$1`,
      [committed.system_evidence_id],
    ),
    /COMMERCIAL_SYSTEM_LINK_EVIDENCE_IMMUTABLE/,
  );
  assertionCount++;
  console.log("✓ [SFP-CONTACT-LINK] evidence UPDATE is rejected by database append-only trigger");
  await assert.rejects(
    client.query(`DELETE FROM contact_business_system_link_evidence WHERE id=$1`, [committed.system_evidence_id]),
    /COMMERCIAL_SYSTEM_LINK_EVIDENCE_IMMUTABLE/,
  );
  assertionCount++;
  console.log("✓ [SFP-CONTACT-LINK] evidence DELETE is rejected by database append-only trigger");
  const evidenceAfterImmutability = await client.query(
    `SELECT facts::text, facts_hash FROM contact_business_system_link_evidence WHERE id=$1`,
    [committed.system_evidence_id],
  );
  equal(JSON.stringify(evidenceAfterImmutability.rows), JSON.stringify(evidenceBeforeImmutability.rows),
    "evidence content remains unchanged after rejected mutation attempts");

  // Stale-preview revalidation rejects changed identity facts before writes.
  const staleFixture = await fixture("stale");
  const staleItem = await applyItem(staleFixture.contactId);
  await client.query(`UPDATE contacts SET company_name='Changed after preview' WHERE id=$1`, [staleFixture.contactId]);
  const stale = await links.applyContactBusinessSystemLink(staleItem);
  equal(stale.status, "rejected", "stale preview is rejected");
  equal(stale.code, "SYSTEM_LINK_SNAPSHOT_STALE", "stale preview returns specific rejection");
  const staleWrites = await client.query(
    `SELECT count(*)::int AS count FROM contact_business_link_decisions WHERE contact_id=$1`,
    [staleFixture.contactId],
  );
  equal(staleWrites.rows[0].count, 0, "stale preview creates no decision");

  // Force an error after evidence INSERT but before decision/projection commit.
  // PostgreSQL must roll back the evidence row in the real service transaction.
  const rollbackFixture = await fixture("rollback");
  const rollbackItem = await applyItem(rollbackFixture.contactId);
  await client.query(`
    CREATE OR REPLACE FUNCTION sfp_contact_link_test_force_rollback()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'SFP_CONTACT_LINK_TEST_ROLLBACK'; END $$;
    CREATE TRIGGER sfp_contact_link_test_force_rollback
      BEFORE INSERT ON contact_business_link_decisions
      FOR EACH ROW EXECUTE FUNCTION sfp_contact_link_test_force_rollback();
  `);
  const rolledBack = await links.applyContactBusinessSystemLink(rollbackItem);
  equal(rolledBack.status, "rejected", "forced post-evidence failure rejects apply");
  await client.query(`DROP TRIGGER sfp_contact_link_test_force_rollback ON contact_business_link_decisions`);
  await client.query(`DROP FUNCTION sfp_contact_link_test_force_rollback()`);
  const rollbackState = (await client.query(
    `SELECT c.business_id,
            (SELECT count(*)::int FROM contact_business_link_decisions d WHERE d.contact_id=c.id) decisions,
            (SELECT count(*)::int FROM contact_business_system_link_evidence e WHERE e.contact_id=c.id) evidence
       FROM contacts c WHERE c.id=$1`,
    [rollbackFixture.contactId],
  )).rows[0];
  equal(rollbackState.business_id, null, "rollback leaves business projection untouched");
  equal(rollbackState.decisions, 0, "rollback leaves no decision");
  equal(rollbackState.evidence, 0, "rollback removes evidence inserted earlier in the transaction");

  // Two simultaneous applies race through the public service; graph locks,
  // replay check and unique current-link authority permit exactly one decision.
  const concurrentFixture = await fixture("concurrent");
  const concurrentItem = await applyItem(concurrentFixture.contactId);
  const concurrent = await Promise.all([
    links.applyContactBusinessSystemLink(concurrentItem),
    links.applyContactBusinessSystemLink(concurrentItem),
  ]);
  check(concurrent.every((result: any) => ["applied", "replayed"].includes(result.status)),
    "concurrent applies resolve as applied/replayed rather than divergent writes");
  equal(concurrent.filter((result: any) => result.status === "applied").length, 1,
    "concurrent apply commits exactly one new decision");
  equal(concurrent.filter((result: any) => result.status === "replayed").length, 1,
    "concurrent loser observes the idempotent replay");
  const repeated = await links.applyContactBusinessSystemLink(concurrentItem);
  equal(repeated.status, "replayed", "repeated apply returns existing decision");
  const repeatedCounts = await client.query(
    `SELECT (SELECT count(*)::int FROM contact_business_link_decisions WHERE contact_id=$1) decisions,
            (SELECT count(*)::int FROM contact_business_system_link_evidence WHERE contact_id=$1) evidence`,
    [concurrentFixture.contactId],
  );
  equal(repeatedCounts.rows[0].decisions, 1, "repeated/concurrent calls retain one decision");
  equal(repeatedCounts.rows[0].evidence, 1, "repeated/concurrent calls retain one evidence row");

  // Model partial contracts only inside this ephemeral database. Every failed
  // preflight is followed by an apply attempt through the actual service.
  const routeFixture = await fixture("route-boundary");
  const routeItem = await applyItem(routeFixture.contactId);
  await client.query(`DROP TRIGGER contact_business_link_review_contract ON contact_business_link_decisions`);
  const routeCountsBefore = await client.query(
    `SELECT
       (SELECT count(*)::int FROM contact_business_link_decisions WHERE contact_id=$1) decisions,
       (SELECT count(*)::int FROM contact_business_system_link_evidence WHERE contact_id=$1) evidence,
       (SELECT business_id FROM contacts WHERE id=$1) projection,
       (SELECT count(*)::int FROM audit_logs
         WHERE action='contact_business_system_link_batch_applied' AND entity_key=$1::text) audits`,
    [routeFixture.contactId],
  );
  const beforeRouteState = routeCountsBefore.rows[0];
  const previewResponse = fakeResponse();
  await previewRoute!({
    query: { afterContactId: String(routeFixture.contactId - 1), limit: "1" },
  }, previewResponse);
  equal(previewResponse.statusCode, 200,
    "actual admin preview endpoint remains available during schema drift");
  equal(previewResponse.body.schemaReady, false,
    "actual admin preview endpoint reports schemaReady=false during drift");
  equal(previewResponse.body.writes, 0,
    "actual admin preview endpoint advertises no writes during drift");
  const routeCountsAfterPreview = await client.query(
    `SELECT
       (SELECT count(*)::int FROM contact_business_link_decisions WHERE contact_id=$1) decisions,
       (SELECT count(*)::int FROM contact_business_system_link_evidence WHERE contact_id=$1) evidence,
       (SELECT business_id FROM contacts WHERE id=$1) projection,
       (SELECT count(*)::int FROM audit_logs
         WHERE action='contact_business_system_link_batch_applied' AND entity_key=$1::text) audits`,
    [routeFixture.contactId],
  );
  assertionCount++;
  assert.deepEqual(routeCountsAfterPreview.rows[0], beforeRouteState,
    "[SFP-CONTACT-LINK] preview route leaves audit/evidence/decision/projection state unchanged");
  console.log("✓ [SFP-CONTACT-LINK] preview route leaves audit, evidence, decision, and projection state unchanged");
  const applyResponse = fakeResponse();
  await applyRoute!({
    body: { items: [routeItem] },
    user: { id: `sfp-contact-link-route-admin-${nonce}` },
  }, applyResponse);
  equal(applyResponse.statusCode, 409,
    "actual admin apply endpoint returns HTTP 409 before per-item work on preflight drift");
  const routeCountsAfter = await client.query(
    `SELECT
       (SELECT count(*)::int FROM contact_business_link_decisions WHERE contact_id=$1) decisions,
       (SELECT count(*)::int FROM contact_business_system_link_evidence WHERE contact_id=$1) evidence,
       (SELECT business_id FROM contacts WHERE id=$1) projection,
       (SELECT count(*)::int FROM audit_logs
         WHERE action='contact_business_system_link_batch_applied' AND entity_key=$1::text) audits`,
    [routeFixture.contactId],
  );
  assertionCount++;
  assert.deepEqual(routeCountsAfter.rows[0], beforeRouteState,
    "[SFP-CONTACT-LINK] route preflight rejection preserves audit/evidence/decision/projection counts");
  console.log("✓ [SFP-CONTACT-LINK] HTTP 409 preflight leaves audit, evidence, decision, and projection state unchanged");
  await assertBlockedByPartialSchema(routeItem, "missing reviewed-link trigger");
  await client.query(`
    CREATE TRIGGER contact_business_link_review_contract
      BEFORE INSERT OR UPDATE ON contact_business_link_decisions
      FOR EACH ROW EXECUTE FUNCTION enforce_reviewed_contact_business_link()
  `);

  await client.query(`DROP TRIGGER contact_business_system_link_evidence_append_only ON contact_business_system_link_evidence`);
  await assertBlockedByPartialSchema(successItem, "missing evidence immutability trigger");
  await client.query(`
    CREATE TRIGGER contact_business_system_link_evidence_append_only
      BEFORE UPDATE OR DELETE ON contact_business_system_link_evidence
      FOR EACH ROW EXECUTE FUNCTION cro02_system_link_evidence_append_only()
  `);

  await client.query(`ALTER TABLE contact_business_link_decisions DISABLE TRIGGER contact_business_link_review_contract`);
  await assertBlockedByPartialSchema(successItem, "disabled reviewed-link trigger");
  await client.query(`ALTER TABLE contact_business_link_decisions ENABLE TRIGGER contact_business_link_review_contract`);

  await client.query(`
    DROP TRIGGER contact_business_link_review_contract ON contact_business_link_decisions;
    CREATE TRIGGER contact_business_link_review_contract
      BEFORE INSERT OR UPDATE ON contact_business_link_decisions
      FOR EACH ROW WHEN (false)
      EXECUTE FUNCTION enforce_reviewed_contact_business_link()
  `);
  await assertBlockedByPartialSchema(successItem, "review trigger with WHEN(false)");
  await client.query(`
    DROP TRIGGER contact_business_link_review_contract ON contact_business_link_decisions;
    CREATE TRIGGER contact_business_link_review_contract
      BEFORE INSERT OR UPDATE ON contact_business_link_decisions
      FOR EACH ROW EXECUTE FUNCTION enforce_reviewed_contact_business_link()
  `);

  await client.query(`ALTER TABLE contact_business_system_link_evidence ENABLE REPLICA TRIGGER contact_business_system_link_evidence_append_only`);
  await assertBlockedByPartialSchema(successItem, "replica-only append-only trigger");
  await client.query(`ALTER TABLE contact_business_system_link_evidence ENABLE TRIGGER contact_business_system_link_evidence_append_only`);

  await client.query(`
    DROP TRIGGER contact_business_system_link_evidence_append_only ON contact_business_system_link_evidence;
    CREATE TRIGGER contact_business_system_link_evidence_append_only
      BEFORE UPDATE OR DELETE ON contact_business_system_link_evidence
      FOR EACH ROW WHEN (false)
      EXECUTE FUNCTION cro02_system_link_evidence_append_only()
  `);
  await assertBlockedByPartialSchema(successItem, "append-only trigger with WHEN(false)");
  await client.query(`
    DROP TRIGGER contact_business_system_link_evidence_append_only ON contact_business_system_link_evidence;
    CREATE TRIGGER contact_business_system_link_evidence_append_only
      BEFORE UPDATE OR DELETE ON contact_business_system_link_evidence
      FOR EACH ROW EXECUTE FUNCTION cro02_system_link_evidence_append_only()
  `);

  await client.query(`ALTER TABLE contact_business_system_link_evidence
    DROP CONSTRAINT contact_business_system_link_evidence_source_entity_id_fkey`);
  await assertBlockedByPartialSchema(successItem, "missing Sunbiz evidence foreign key");
  await client.query(`ALTER TABLE contact_business_system_link_evidence
    ADD CONSTRAINT contact_business_system_link_evidence_source_entity_id_fkey
      FOREIGN KEY (source_entity_id) REFERENCES sunbiz_entities(id) ON DELETE RESTRICT`);

  // These CHECKs retain the old guard's substring (contact branch plus decision
  // id) while omitting required lineage pins. This catches false readiness from
  // merely spotting `contact_business_link_decision_id` in pg_get_constraintdef.
  await client.query(`
    ALTER TABLE sfp_outreach_eligibility
      DROP CONSTRAINT sfp_outreach_eligibility_source_ref_one_of_chk;
    ALTER TABLE sfp_outreach_eligibility
      ADD CONSTRAINT sfp_outreach_eligibility_source_ref_one_of_chk CHECK (
        source_kind IS NULL
        OR (source_kind='free' AND candidate_id IS NOT NULL
            AND paid_candidate_evidence_id IS NULL AND contact_id IS NULL)
        OR (source_kind='paid' AND paid_candidate_evidence_id IS NOT NULL
            AND candidate_id IS NULL AND contact_id IS NULL)
        OR (source_kind='contact' AND contact_id IS NOT NULL
            AND candidate_id IS NULL AND paid_candidate_evidence_id IS NULL
            AND contact_business_link_decision_id IS NOT NULL)
      );
  `);
  await assertBlockedByPartialSchema(successItem, "weakened eligibility contact CHECK");
  await installStrictSourceChecks();

  await client.query(`
    ALTER TABLE sfp_campaign_staging_intents
      DROP CONSTRAINT sfp_campaign_staging_intents_source_ref_one_of_chk;
    ALTER TABLE sfp_campaign_staging_intents
      ADD CONSTRAINT sfp_campaign_staging_intents_source_ref_one_of_chk CHECK (
        (source_kind='free' AND candidate_id IS NOT NULL AND paid_candidate_evidence_id IS NULL)
        OR (source_kind='paid' AND paid_candidate_evidence_id IS NOT NULL AND candidate_id IS NULL)
        OR (source_kind='contact' AND contact_id IS NOT NULL
            AND candidate_id IS NULL AND paid_candidate_evidence_id IS NULL
            AND contact_business_link_decision_id IS NOT NULL)
      );
  `);
  await assertBlockedByPartialSchema(successItem, "weakened staging-intent contact CHECK");
  await installStrictSourceChecks();

  await client.query(`
    ALTER TABLE sfp_outreach_eligibility
      DROP CONSTRAINT sfp_outreach_eligibility_source_ref_one_of_chk;
    ALTER TABLE sfp_outreach_eligibility
      ADD CONSTRAINT sfp_outreach_eligibility_source_ref_one_of_chk CHECK (
        source_kind IS NULL
        OR (source_kind='free' AND candidate_id IS NOT NULL AND paid_candidate_evidence_id IS NULL AND contact_id IS NULL)
        OR (source_kind='paid' AND paid_candidate_evidence_id IS NOT NULL AND candidate_id IS NULL AND contact_id IS NULL)
        OR (source_kind='contact' AND contact_id IS NOT NULL
            AND candidate_id IS NULL AND paid_candidate_evidence_id IS NULL
            AND contact_business_link_decision_id IS NOT NULL
            AND contact_business_link_revision IS NOT NULL
            AND normalized_value_hash IS NOT NULL
            AND normalized_value_hash_version IS NOT NULL
            AND normalized_value_hash_version IN (0,1,2))
      );
  `);
  await assertBlockedByPartialSchema(successItem, "eligibility CHECK with widened version allowlist");
  await installStrictSourceChecks();

  const shadowSchema = `sfp_contact_link_shadow_${nonce}`;
  await client.query(`
    CREATE SCHEMA ${shadowSchema};
    CREATE TABLE ${shadowSchema}.sfp_outreach_eligibility (
      source_kind text, candidate_id uuid, paid_candidate_evidence_id uuid, contact_id integer,
      contact_business_link_decision_id uuid, contact_business_link_revision integer,
      normalized_value_hash text, normalized_value_hash_version integer,
      CONSTRAINT sfp_outreach_eligibility_source_ref_one_of_chk CHECK (
        source_kind IS NULL
        OR (source_kind='free' AND candidate_id IS NOT NULL AND paid_candidate_evidence_id IS NULL AND contact_id IS NULL)
        OR (source_kind='paid' AND paid_candidate_evidence_id IS NOT NULL AND candidate_id IS NULL AND contact_id IS NULL)
        OR (source_kind='contact' AND contact_id IS NOT NULL AND candidate_id IS NULL
          AND paid_candidate_evidence_id IS NULL AND contact_business_link_decision_id IS NOT NULL
          AND contact_business_link_revision IS NOT NULL AND normalized_value_hash IS NOT NULL
          AND normalized_value_hash_version IS NOT NULL AND normalized_value_hash_version IN (0,1))
      )
    );
    CREATE TABLE ${shadowSchema}.sfp_campaign_staging_intents (
      source_kind text, candidate_id uuid, paid_candidate_evidence_id uuid, contact_id integer,
      contact_business_link_decision_id uuid, contact_business_link_revision integer,
      normalized_value_hash text, normalized_value_hash_version integer,
      CONSTRAINT sfp_campaign_staging_intents_source_ref_one_of_chk CHECK (
        (source_kind='free' AND candidate_id IS NOT NULL AND paid_candidate_evidence_id IS NULL AND contact_id IS NULL)
        OR (source_kind='paid' AND paid_candidate_evidence_id IS NOT NULL AND candidate_id IS NULL AND contact_id IS NULL)
        OR (source_kind='contact' AND contact_id IS NOT NULL AND candidate_id IS NULL
          AND paid_candidate_evidence_id IS NULL AND contact_business_link_decision_id IS NOT NULL
          AND contact_business_link_revision IS NOT NULL AND normalized_value_hash IS NOT NULL
          AND normalized_value_hash_version IS NOT NULL AND normalized_value_hash_version IN (0,1))
      )
    );
    CREATE TABLE ${shadowSchema}.contact_business_link_decisions (id integer);
    CREATE TRIGGER contact_business_link_review_contract
      BEFORE INSERT OR UPDATE ON ${shadowSchema}.contact_business_link_decisions
      FOR EACH ROW EXECUTE FUNCTION public.enforce_reviewed_contact_business_link();
    CREATE TABLE ${shadowSchema}.contact_business_system_link_evidence (id integer);
    CREATE TRIGGER contact_business_system_link_evidence_append_only
      BEFORE UPDATE OR DELETE ON ${shadowSchema}.contact_business_system_link_evidence
      FOR EACH ROW EXECUTE FUNCTION public.cro02_system_link_evidence_append_only();
    ALTER TABLE public.sfp_outreach_eligibility
      DROP CONSTRAINT sfp_outreach_eligibility_source_ref_one_of_chk;
    ALTER TABLE public.sfp_campaign_staging_intents
      DROP CONSTRAINT sfp_campaign_staging_intents_source_ref_one_of_chk;
    DROP TRIGGER contact_business_link_review_contract ON public.contact_business_link_decisions;
    DROP TRIGGER contact_business_system_link_evidence_append_only ON public.contact_business_system_link_evidence;
  `);
  await assertBlockedByPartialSchema(successItem, "matching contracts present only in non-public schema");
  await client.query(`DROP SCHEMA ${shadowSchema} CASCADE`);
  await client.query(`
    CREATE TRIGGER contact_business_link_review_contract
      BEFORE INSERT OR UPDATE ON public.contact_business_link_decisions
      FOR EACH ROW EXECUTE FUNCTION public.enforce_reviewed_contact_business_link();
    CREATE TRIGGER contact_business_system_link_evidence_append_only
      BEFORE UPDATE OR DELETE ON public.contact_business_system_link_evidence
      FOR EACH ROW EXECUTE FUNCTION public.cro02_system_link_evidence_append_only()
  `);
  await installStrictSourceChecks();

  // Older pre-contact-source CHECKs must also remain a hard block.
  await installPreContactSourceChecks();
  await assertBlockedByPartialSchema(successItem, "pre-contact-source SFP CHECKs");

  await installStrictSourceChecks();
  await client.query(`
    CREATE OR REPLACE FUNCTION public.enforce_reviewed_contact_business_link()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RETURN NEW; END $$;
  `);
  await assertBlockedByPartialSchema(successItem, "weakened reviewed-link trigger function body");
  await client.query(`
    CREATE OR REPLACE FUNCTION public.cro02_system_link_evidence_append_only()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RETURN NEW; END $$;
  `);
  await assertBlockedByPartialSchema(successItem, "weakened evidence immutability function body");

  console.log(`\n✓ ${assertionCount} disposable PostgreSQL SFP contact-link integration assertions passed.`);
} catch (error) {
  failure = error;
} finally {
  if (client._connected) await client.end().catch(() => {});
  const { pool } = await import("../server/db");
  await pool.end().catch(() => {});
}

if (failure) {
  console.error("✗ SFP contact-business system-link integration failed:", failure);
  process.exitCode = 1;
}