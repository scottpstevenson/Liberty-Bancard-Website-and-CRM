import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  computeContactLinkReuse,
  computeSfpGapVector,
} from "../server/services/cro03/sfp-contact-gap-vector";

const { Client } = pg;
const prefix = `sfp-gap-vector-${randomUUID()}`;
const client = new Client({ connectionString: process.env.DATABASE_URL });
const businessIds: number[] = [];
const contactIds: number[] = [];
let generationId: string | null = null;
let fixtureFailure: unknown;

function logPass(message: string) {
  console.log(`✓ ${message}`);
}

async function insertBusiness(label: string): Promise<number> {
  const result = await client.query(
    `INSERT INTO businesses (canonical_name, normalized_name, record_class)
     VALUES ($1, $2, 'test') RETURNING id`,
    [`${prefix}-${label}`, `${prefix}-${label}`],
  );
  const id = Number(result.rows[0].id);
  businessIds.push(id);
  return id;
}

async function insertContact(label: string, businessId: number | null, suppressed = false): Promise<number> {
  const result = await client.query(
    `INSERT INTO contacts
       (first_name, last_name, email, phone, business_id, opted_out_email)
     VALUES ($1, $2, $3, '0000000000', $4, $5) RETURNING id`,
    [
      `${prefix}-${label}`,
      "Fixture",
      `${prefix}-${label}@example.invalid`,
      businessId,
      suppressed,
    ],
  );
  const id = Number(result.rows[0].id);
  contactIds.push(id);
  return id;
}

async function insertFreeCandidate(
  businessId: number,
  contactId: number,
  label: string,
): Promise<void> {
  await client.query(
    `INSERT INTO free_discovery_candidates
       (generation_id, field, subject_type, business_id, contact_id, domain, source,
        attribution_scope, disposition, confidence, envelope_ciphertext, envelope_nonce,
        envelope_tag, envelope_key_version, normalized_value_hash, masked_value)
     VALUES ($1, 'email', 'business', $2, $3, 'example.invalid', 'fixture',
        'role', 'staged', 80, 'fixture-ciphertext', 'fixture-nonce',
        'fixture-tag', 1, $4, 'f***@example.invalid')`,
    [generationId, businessId, contactId, `${prefix}-${label}`],
  );
}

async function run(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  await client.connect();

  const admin = await client.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  assert(admin.rows[0], "Dev database must have an admin reviewer fixture");
  const reviewerId = String(admin.rows[0].id);

  const supersessionBusiness = await insertBusiness("supersession");
  const mixedBusiness = await insertBusiness("mixed");
  const suppressedBusiness = await insertBusiness("all-suppressed");
  const candidateOnlyBusiness = await insertBusiness("candidate-only");

  const supersededContact = await insertContact("historical-verified", supersessionBusiness);
  const mixedSuppressedContact = await insertContact("mixed-suppressed", mixedBusiness, true);
  const mixedUsableContact = await insertContact("mixed-usable", mixedBusiness);
  const allSuppressedContact = await insertContact("all-suppressed", suppressedBusiness, true);
  const candidateOnlyContact = await insertContact("candidate-only", candidateOnlyBusiness);

  const generation = await client.query(
    `INSERT INTO free_discovery_generations (run_key, actor_id, reason, state)
     VALUES ($1, 'sfp-gap-vector-test', 'Task #1999 C6 integration fixture', 'completed')
     RETURNING id`,
    [`${prefix}:generation`],
  );
  generationId = String(generation.rows[0].id);

  const sourceEvent = await client.query(
    `INSERT INTO contact_source_events
       (contact_id, event_key, source_category, source_type, actor_type, actor_id)
     VALUES ($1, $2, 'fixture', 'fixture', 'system', $3) RETURNING id`,
    [supersededContact, `${prefix}:verified-evidence`, "sfp-gap-vector-test"],
  );
  const evidenceId = Number(sourceEvent.rows[0].id);
  const verifiedDecision = await client.query(
    `INSERT INTO contact_business_link_decisions
       (contact_id, business_id, decision, decision_key, actor_id, revision,
        evidence_source_event_id, reviewed_by, reviewed_at)
     VALUES ($1, $2, 'verified', $3, $4, 1, $5, $4, now()) RETURNING id`,
    [supersededContact, supersessionBusiness, `${prefix}:verified`, reviewerId, evidenceId],
  );
  await client.query(
    `UPDATE contact_business_link_decisions SET superseded_at = now() WHERE id = $1`,
    [verifiedDecision.rows[0].id],
  );
  await client.query(
    `INSERT INTO contact_business_link_decisions
       (contact_id, business_id, decision, decision_key, actor_id, revision)
     VALUES ($1, NULL, 'rejected', $2, $3, 2)`,
    [supersededContact, `${prefix}:rejected`, reviewerId],
  );
  await client.query(`UPDATE contacts SET business_id = NULL WHERE id = $1`, [supersededContact]);

  await client.query(
    `INSERT INTO contact_business_link_candidates
       (contact_id, business_id, source, candidate_key, confidence)
     VALUES ($1, $2, 'legacy_import', $3, 75)`,
    [candidateOnlyContact, candidateOnlyBusiness, `${prefix}:link-candidate-only`],
  );
  await client.query(
    `INSERT INTO contact_business_link_decisions
       (contact_id, business_id, decision, decision_key, actor_id, revision)
     VALUES ($1, NULL, 'legacy_unknown', $2, $3, 1)`,
    [candidateOnlyContact, `${prefix}:legacy-unknown`, reviewerId],
  );

  await insertFreeCandidate(mixedBusiness, mixedSuppressedContact, "mixed-suppressed-candidate");
  await insertFreeCandidate(mixedBusiness, mixedUsableContact, "mixed-usable-candidate");
  await insertFreeCandidate(suppressedBusiness, allSuppressedContact, "all-suppressed-candidate");

  const reuse = await computeContactLinkReuse([
    supersessionBusiness,
    candidateOnlyBusiness,
  ]);
  assert.equal(reuse.get(supersessionBusiness)?.hasVerifiedContact, false);
  assert.equal(reuse.get(supersessionBusiness)?.hasVerifiedNamedDecisionMaker, false);
  assert.equal(reuse.get(supersessionBusiness)?.skipReason, null);
  assert.deepEqual(reuse.get(supersessionBusiness)?.verifiedLinks, []);
  logPass("superseded historical verified decision cannot authorize reuse, Apollo skip, or email attribution");

  assert.equal(reuse.get(candidateOnlyBusiness)?.hasVerifiedContact, false);
  assert.equal(reuse.get(candidateOnlyBusiness)?.hasVerifiedNamedDecisionMaker, false);
  assert.equal(reuse.get(candidateOnlyBusiness)?.skipReason, null);
  logPass("candidate-only and legacy_unknown link evidence is not authoritative reuse");

  const mixedVector = await computeSfpGapVector({
    businessId: mixedBusiness,
    targetVerticalResolved: true,
    officialDomainKnown: true,
    hasFreeDiscoveryContactCandidate: true,
    verifiedLinkReuse: { hasVerifiedContact: false, hasVerifiedNamedDecisionMaker: false },
    subjectSuppressions: [{
      subjectHash: `${prefix}-mixed-suppressed-hash`,
      authority: "contact.opted_out_email",
      reasonCode: "CONTACT_EMAIL_OPTED_OUT",
      channel: "email",
      scope: "contact",
    }],
    businessWideSuppressionApplied: false,
  });
  const mixedChannel = mixedVector.before.find((entry) => entry.dimension === "business_contact_channel")!;
  assert.equal(mixedChannel.open, false, "the non-suppressed candidate closes the channel gap");
  assert.equal(mixedChannel.subjectExclusions.length, 1);
  assert.equal(mixedChannel.subjectExclusions[0].subjectHash, `${prefix}-mixed-suppressed-hash`);
  logPass("subject exclusion remains visible while another usable candidate closes the channel gap");

  const allSuppressedVector = await computeSfpGapVector({
    businessId: suppressedBusiness,
    targetVerticalResolved: true,
    officialDomainKnown: true,
    hasFreeDiscoveryContactCandidate: false,
    verifiedLinkReuse: { hasVerifiedContact: false, hasVerifiedNamedDecisionMaker: false },
    subjectSuppressions: [{
      subjectHash: `${prefix}-all-suppressed-hash`,
      authority: "contact.opted_out_email",
      reasonCode: "CONTACT_EMAIL_OPTED_OUT",
      channel: "email",
      scope: "contact",
    }],
    businessWideSuppressionApplied: false,
  });
  const allSuppressedChannel = allSuppressedVector.before.find(
    (entry) => entry.dimension === "business_contact_channel",
  )!;
  assert.equal(allSuppressedChannel.open, true);
  assert.equal(allSuppressedChannel.subjectExclusions.length, 1);
  logPass("all-known-candidates-suppressed leaves the business contact-channel gap open");

  const businessWideVector = await computeSfpGapVector({
    businessId: mixedBusiness,
    targetVerticalResolved: false,
    officialDomainKnown: false,
    hasFreeDiscoveryContactCandidate: false,
    verifiedLinkReuse: { hasVerifiedContact: false, hasVerifiedNamedDecisionMaker: false },
    subjectSuppressions: [],
    businessWideSuppressionApplied: true,
  });
  assert.equal(
    businessWideVector.before.find((entry) => entry.dimension === "geography")?.open,
    false,
  );
  assert(
    businessWideVector.before
      .filter((entry) => entry.dimension !== "geography")
      .every((entry) =>
        entry.open === false
        && entry.closedBy === "business_wide_suppression_authoritative"),
  );
  logPass("authoritative business-wide suppression closes every non-geography dimension");
}

try {
  await run();
} catch (error) {
  fixtureFailure = error;
} finally {
  if (client._connected) {
    try {
      // Decision history is intentionally append-only in normal operation;
      // test-owned rows are removed with FK/immutability triggers bypassed.
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(
        `DELETE FROM contact_business_link_decisions WHERE contact_id IN
           (SELECT id FROM contacts WHERE email LIKE $1)`,
        [`${prefix}-%`],
      );
      await client.query(
        `DELETE FROM contact_business_link_candidates WHERE contact_id IN
           (SELECT id FROM contacts WHERE email LIKE $1)`,
        [`${prefix}-%`],
      );
      await client.query(
        `DELETE FROM free_discovery_candidates WHERE generation_id IN
           (SELECT id FROM free_discovery_generations WHERE run_key = $1)`,
        [`${prefix}:generation`],
      );
      await client.query(
        `DELETE FROM contact_source_events WHERE event_key LIKE $1`,
        [`${prefix}:%`],
      );
      await client.query(`DELETE FROM contacts WHERE email LIKE $1`, [`${prefix}-%`]);
      await client.query(
        `DELETE FROM free_discovery_generations WHERE run_key = $1`,
        [`${prefix}:generation`],
      );
      await client.query(`DELETE FROM businesses WHERE canonical_name LIKE $1`, [`${prefix}-%`]);
      await client.query(`SET session_replication_role = 'origin'`);
      console.log("✓ cleaned up all uniquely-prefixed fixture rows");
    } catch (cleanupError) {
      console.error("✗ fixture cleanup failed:", cleanupError);
      fixtureFailure ??= cleanupError;
    }
    await client.end().catch(() => {});
  }
}

if (fixtureFailure) {
  console.error("✗ Task #1999 contact-gap-vector test failed:", fixtureFailure);
  process.exitCode = 1;
} else {
  console.log("All Task #1999 contact-gap-vector assertions passed.");
}