/**
 * Disposable PostgreSQL integration test for contact-scoped SDR candidate keys.
 * Exercises the real contact ingest and commercial-link authority without
 * provider calls or direct writes to the contact/business projection.
 */
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

await assertDisposableTestInfrastructure({
  operation: "SDR contact candidate collision disposable test",
  requireRedis: false,
});

const [{ db }, schema, dedupe, authority, candidateKeyModule] = await Promise.all([
  import("../server/db"),
  import("@shared/schema"),
  import("../server/services/sdr/dedupe"),
  import("../server/services/commercial-link-authority"),
  import("../server/services/sdr/contact-candidate-key"),
]);

const { contacts } = schema;
const SOURCE_TYPE = "serper";
const SOURCE_LABEL = "contact_enrich_batch";

async function makeContact(index: number, companyName: string) {
  const [contact] = await db.insert(contacts).values({
    firstName: `Collision${index}`,
    lastName: "Fixture",
    email: `sdr-candidate-collision-${index}@example.test`,
    phone: "3055550147",
    companyName,
    website: "https://sdr-candidate-collision-fixture.example",
    city: "Miami",
    state: "FL",
    leadSource: "test_fixture",
  }).returning();
  return contact;
}

async function candidateRows(contactIds: number[]) {
  return (await db.execute(sql`
    SELECT id, contact_id, business_id, source, source_version, candidate_key, confidence
    FROM contact_business_link_candidates
    WHERE contact_id = ANY(ARRAY[${sql.join(contactIds.map((id) => sql`${id}`), sql`, `)}]::integer[])
    ORDER BY contact_id, candidate_key
  `) as any).rows as Array<{
    id: string;
    contact_id: number;
    business_id: number;
    source: string;
    source_version: string;
    candidate_key: string;
    confidence: number;
  }>;
}

async function main() {
  // Different tuple boundaries can produce the same readable legacy key; the
  // scoped digest must preserve the exact tuple boundaries.
  const delimiterCollisionA = candidateKeyModule.getSdrContactCandidateKeys({
    sourceType: "serper:batch",
    sourceLabel: "contact",
    contactId: 900001,
    businessId: 900002,
  });
  const delimiterCollisionB = candidateKeyModule.getSdrContactCandidateKeys({
    sourceType: "serper",
    sourceLabel: "batch:contact",
    contactId: 900001,
    businessId: 900002,
  });
  assert.equal(delimiterCollisionA.legacy, delimiterCollisionB.legacy);
  assert.notEqual(delimiterCollisionA.scoped, delimiterCollisionB.scoped);

  const first = await makeContact(1, "Collision Fixture Dental LLC");
  const second = await makeContact(2, "Collision Fixture Dental Group");
  const legacyMismatch = await makeContact(3, "Collision Fixture Dental Center");
  const freshScoped = await makeContact(4, "Collision Fixture Dental Studio");

  const firstIngest = await dedupe.ingestBusiness({
    name: first.companyName!,
    website: first.website,
    phone: first.phone,
    city: first.city,
    state: first.state,
    sourceType: SOURCE_TYPE,
    sourceLabel: SOURCE_LABEL,
    contactId: first.id,
  });
  assert.equal(firstIngest.isNew, true, "the direct business ingest creates the fixture business");
  const firstKeys = candidateKeyModule.getSdrContactCandidateKeys({
    contactId: first.id,
    businessId: firstIngest.businessId,
    sourceType: SOURCE_TYPE,
    sourceLabel: SOURCE_LABEL,
  });
  const seededFirstLegacy = await authority.recordContactBusinessLinkCandidate({
    contactId: first.id,
    businessId: firstIngest.businessId,
    source: "sdr_dedupe",
    sourceVersion: SOURCE_TYPE,
    candidateKey: firstKeys.legacy,
    confidence: 70,
  });

  const firstContactIngest = await dedupe.ingestBusinessFromContact(first.id, SOURCE_TYPE, SOURCE_LABEL);
  assert.ok(firstContactIngest, "the first contact should resolve and ingest a business");
  assert.equal(firstContactIngest.businessId, firstIngest.businessId);
  assert.equal(firstContactIngest.isNew, false);

  const secondIngest = await dedupe.ingestBusinessFromContact(second.id, SOURCE_TYPE, SOURCE_LABEL);
  assert.ok(secondIngest, "the second contact should resolve and ingest a business");
  assert.equal(secondIngest.businessId, firstIngest.businessId,
    "distinct contacts with matching website/phone evidence resolve to the same business");

  const ids = [first.id, second.id, legacyMismatch.id, freshScoped.id];
  const initialRows = await candidateRows(ids);
  assert.equal(initialRows.length, 2, "each of the two actual ingests records one candidate");
  assert.equal(new Set(initialRows.map((row) => row.contact_id)).size, 2);
  assert.equal(new Set(initialRows.map((row) => row.id)).size, 2,
    "different contacts retain distinct candidate rows for the shared business");

  const secondKeys = candidateKeyModule.getSdrContactCandidateKeys({
    contactId: second.id,
    businessId: secondIngest.businessId,
    sourceType: SOURCE_TYPE,
    sourceLabel: SOURCE_LABEL,
  });
  assert.equal(initialRows.find((row) => row.contact_id === first.id)?.candidate_key, firstKeys.legacy,
    "the first proposal retains its established legacy key");
  assert.equal(initialRows.find((row) => row.contact_id === first.id)?.id, seededFirstLegacy.id,
    "same-contact replay retains the pre-existing legacy proposal");
  assert.equal(initialRows.find((row) => row.contact_id === second.id)?.candidate_key, secondKeys.scoped,
    "a different contact sharing the legacy key receives its own scoped key");

  for (const contact of [first, second]) {
    const retry = await dedupe.ingestBusinessFromContact(contact.id, SOURCE_TYPE, SOURCE_LABEL);
    assert.ok(retry);
    assert.equal(retry.businessId, firstIngest.businessId);
    assert.equal((await candidateRows(ids)).length, 2,
      "retry of each contact is idempotent and leaves exactly two proposals");
  }
  const afterRetries = await candidateRows(ids);
  assert.deepEqual(
    afterRetries.map(({ id, contact_id, candidate_key, confidence }) => ({ id, contact_id, candidate_key, confidence })),
    initialRows.map(({ id, contact_id, candidate_key, confidence }) => ({ id, contact_id, candidate_key, confidence })),
    "valid retries retain the original immutable legacy/scoped candidate rows",
  );

  const freshLabel = "fresh_contact_enrich_batch";
  const freshKeys = candidateKeyModule.getSdrContactCandidateKeys({
    contactId: freshScoped.id,
    businessId: firstIngest.businessId,
    sourceType: SOURCE_TYPE,
    sourceLabel: freshLabel,
  });
  const freshIngest = await dedupe.ingestBusinessFromContact(freshScoped.id, SOURCE_TYPE, freshLabel);
  assert.ok(freshIngest);
  assert.equal(freshIngest.businessId, firstIngest.businessId);
  const freshRow = (await candidateRows(ids)).find((row) => row.contact_id === freshScoped.id);
  assert.equal(freshRow?.candidate_key, freshKeys.scoped,
    "a fresh source label without any legacy key creates a scoped candidate");
  const freshRetry = await dedupe.ingestBusinessFromContact(freshScoped.id, SOURCE_TYPE, freshLabel);
  assert.ok(freshRetry);
  assert.equal(freshRetry.businessId, firstIngest.businessId);
  assert.equal((await candidateRows(ids)).length, 3,
    "fresh scoped proposal retry is idempotent");

  const mismatchLabel = "legacy_mismatch_contact_enrich_batch";
  const legacyMismatchKeys = candidateKeyModule.getSdrContactCandidateKeys({
    contactId: legacyMismatch.id,
    businessId: firstIngest.businessId,
    sourceType: SOURCE_TYPE,
    sourceLabel: mismatchLabel,
  });
  const seededLegacy = await authority.recordContactBusinessLinkCandidate({
    contactId: legacyMismatch.id,
    businessId: firstIngest.businessId,
    source: "sdr_dedupe",
    sourceVersion: SOURCE_TYPE,
    candidateKey: legacyMismatchKeys.legacy,
    confidence: 75,
  });
  assert.equal(seededLegacy.confidence, 75);

  await assert.rejects(
    dedupe.ingestBusinessFromContact(legacyMismatch.id, SOURCE_TYPE, mismatchLabel),
    /COMMERCIAL_LINK_CANDIDATE_DIVERGENT_REPLAY/,
    "same-contact legacy replay with divergent confidence must reject, not fall back to a scoped row",
  );
  const finalRows = await candidateRows(ids);
  const mismatchRows = finalRows.filter((row) => row.contact_id === legacyMismatch.id);
  assert.equal(mismatchRows.length, 1, "divergent legacy replay must not add a scoped candidate");
  assert.deepEqual(
    mismatchRows[0],
    {
      id: seededLegacy.id,
      contact_id: legacyMismatch.id,
      business_id: firstIngest.businessId,
      source: "sdr_dedupe",
      source_version: SOURCE_TYPE,
      candidate_key: legacyMismatchKeys.legacy,
      confidence: 75,
    },
    "legacy candidate row is not rewritten by failed replay",
  );
  assert.equal(finalRows.length, 4);

  const contactProjection = (await db.execute(sql`
    SELECT id, business_id FROM contacts
    WHERE id = ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::integer[])
    ORDER BY id
  `) as any).rows;
  assert.deepEqual(contactProjection.map((row: any) => row.business_id), [null, null, null, null],
    "candidate discovery does not project a business onto contacts");
  const decisions = (await db.execute(sql`
    SELECT contact_id FROM contact_business_link_decisions
    WHERE contact_id = ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::integer[])
  `) as any).rows;
  assert.equal(decisions.length, 0, "ingest creates no contact-link decisions or verification");

  console.log("SDR contact candidate collision disposable test passed");
}

try {
  await main();
} finally {
  await db.$client.end();
}