/**
 * Real-PostgreSQL proof for indexed raw Sunbiz retrieval and the exact,
 * transactional source-link materializer.
 * Requires the repository's isolated TEST_DATABASE_URL safety guard and
 * creates temporary fixtures only; it performs no provider or network calls.
 */
import assert from "node:assert/strict";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { CONTACT_LINK_UNLINKED_SUNBIZ_NAME_MATCH_SQL } from "../server/services/contact-link-coverage-query";

await assertDisposableTestInfrastructure({
  operation: "contact-link raw Sunbiz recovery disposable SQL test",
  requireRedis: false,
});

const [{ Pool }, reconciliation, recovery] = await Promise.all([
  import("pg"),
  import("../server/services/contact-business-reconciliation"),
  import("../server/services/contact-link-source-recovery"),
]);
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
const client = await pool.connect();

const NAME_KEY = `btrim(regexp_replace(
  regexp_replace(
    lower(regexp_replace(coalesce(entity_name, ''), '[^a-zA-Z0-9]+', ' ', 'g')),
    '\\m(incorporated|inc|limited|ltd|llc|llp|corp|corporation|company|co)\\M', ' ', 'g'
  ),
  '\\s+', ' ', 'g'
))`;
const DBA_KEY = `btrim(regexp_replace(
  regexp_replace(
    lower(regexp_replace(coalesce(dba, ''), '[^a-zA-Z0-9]+', ' ', 'g')),
    '\\m(incorporated|inc|limited|ltd|llc|llp|corp|corporation|company|co)\\M', ' ', 'g'
  ),
  '\\s+', ' ', 'g'
))`;

try {
  await client.query(`
    CREATE TEMP TABLE sunbiz_entities (
      id integer PRIMARY KEY,
      filing_number text,
      entity_name text,
      dba text,
      contact_identity_name_key text GENERATED ALWAYS AS (${NAME_KEY}) STORED,
      contact_identity_dba_key text GENERATED ALWAYS AS (${DBA_KEY}) STORED,
      website text,
      principal_address text,
      principal_city text,
      principal_state text,
      principal_zip text,
      phone text,
      owner_phone text,
      source text
    );
    CREATE TEMP TABLE canonical_source_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id integer NOT NULL,
      source_system text NOT NULL,
      source_type text NOT NULL,
      stable_key text NOT NULL,
      raw_evidence jsonb,
      first_seen_at timestamptz NOT NULL DEFAULT now(),
      last_confirmed_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (source_system, source_type, stable_key)
    );
    CREATE TEMP TABLE businesses (
      id integer PRIMARY KEY,
      canonical_name text NOT NULL,
      normalized_name text NOT NULL,
      record_class text NOT NULL,
      do_not_visit boolean NOT NULL DEFAULT false
    );
    CREATE TEMP TABLE contacts (
      id integer PRIMARY KEY,
      company_name text,
      record_class text,
      archived_at timestamptz,
      do_not_contact boolean DEFAULT false,
      do_not_auto_contact boolean DEFAULT false,
      opted_out_email boolean DEFAULT false,
      opt_out_status text,
      unsubscribe_status text,
      bounce_status text,
      complaint_status text,
      suppression_reason text,
      business_id integer
    );
    CREATE TEMP TABLE contact_business_link_decisions (
      id uuid PRIMARY KEY,
      contact_id integer NOT NULL,
      decision text NOT NULL,
      business_id integer,
      revision integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      superseded_at timestamptz
    );
    CREATE TEMP TABLE contact_business_link_candidates (
      id uuid PRIMARY KEY,
      contact_id integer NOT NULL,
      business_id integer NOT NULL,
      source text NOT NULL,
      source_version text NOT NULL,
      candidate_key text NOT NULL,
      supersedes_candidate_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TEMP VIEW current_contact_business_link_candidates AS
      SELECT candidate.*
      FROM contact_business_link_candidates candidate
      WHERE NOT EXISTS (
        SELECT 1 FROM contact_business_link_candidates successor
        WHERE successor.supersedes_candidate_id = candidate.id
      );
    CREATE TEMP TABLE sunbiz_bootstrap_claims (
      id serial PRIMARY KEY,
      filing_number text NOT NULL UNIQUE,
      sunbiz_entity_id integer,
      status text NOT NULL,
      business_id integer,
      deferred_reason_code text,
      retry_count integer NOT NULL DEFAULT 0,
      claimed_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    );
    CREATE INDEX sunbiz_entities_contact_identity_name_key_idx
      ON sunbiz_entities (contact_identity_name_key) WHERE filing_number IS NOT NULL;
    CREATE INDEX sunbiz_entities_contact_identity_dba_key_idx
      ON sunbiz_entities (contact_identity_dba_key) WHERE filing_number IS NOT NULL AND dba IS NOT NULL;
    INSERT INTO sunbiz_entities
      (id, filing_number, entity_name, dba, website, principal_address, principal_city,
       principal_state, principal_zip, phone, owner_phone, source)
    VALUES
      (1, 'RAW-SUNRISE-1', 'Sunrise Dental Incorporated', 'Sunrise Family Dentistry',
       'https://sunrise.example', '10 Main Street', 'Miami', 'FL', '33101', '3055550001', NULL, 'cordata'),
      (2, 'RAW-SUNRISE-2', 'Sunrise Dental Group LLC', 'Sunrise Family Dentistry Corp',
       'https://sunrise.example', '12 Main Street', 'Miami', 'FL', '33101', '3055550002', NULL, 'corevt'),
      (3, 'LINKED-SUNRISE', 'Sunrise Family Dentistry', 'Sunrise Dental',
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'cordata'),
      (4, NULL, 'Sunrise Family Dentistry', 'Sunrise Dental', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'cordata'),
      (5, 'LINKED-ALIAS', 'Sunrise Family Dentistry', 'Sunrise Dental',
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'cordata'),
      (6, 'OTHER-1', 'Other Medical Group LLC', 'Other Brand',
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'cordata');
    INSERT INTO sunbiz_entities (id, filing_number, entity_name, dba, source) VALUES
      (7, NULL, NULL, NULL, 'fixture'),
      (8, NULL, '', '', 'fixture');
    INSERT INTO businesses VALUES (41, 'Sunrise Dental LLC', 'sunrise dental', 'canonical', false);
    INSERT INTO contacts (id, company_name, record_class, opt_out_status, unsubscribe_status, bounce_status, complaint_status)
      VALUES (31, 'Sunrise Family Dentistry', 'production', 'active', 'active', 'none', 'none');
    INSERT INTO contact_business_link_candidates
      (id, contact_id, business_id, source, source_version, candidate_key)
      VALUES ('00000000-0000-4000-8000-000000000031', 31, 41, 'sdr_orchestration',
              'contact_link_coverage_v1', 'fixture-candidate-31-41');
    INSERT INTO canonical_source_links (business_id, source_system, source_type, stable_key) VALUES
      (41, 'sunbiz', 'sunbiz_entity', 'LINKED-SUNRISE'),
      (41, 'sunbiz_entities', 'sunbiz_filing', 'LINKED-ALIAS');
  `);

  await client.query("BEGIN");
  try {
    await client.query(`
      UPDATE sunbiz_entities
      SET entity_name = 'Auto Changed Incorporated', dba = 'Auto Changed Brand LLC'
      WHERE id = 6
    `);
    const updatedKeys = await client.query(`
      SELECT contact_identity_name_key, contact_identity_dba_key
      FROM sunbiz_entities WHERE id = 6
    `);
    assert.deepEqual(updatedKeys.rows[0], {
      contact_identity_name_key: "auto changed",
      contact_identity_dba_key: "auto changed brand",
    }, "generated identity keys track changes to their underlying names");
  } finally {
    await client.query("ROLLBACK");
  }

  const emptyKeys = await client.query(`
    SELECT entity_name, dba, contact_identity_name_key, contact_identity_dba_key
    FROM sunbiz_entities WHERE id IN (7, 8) ORDER BY id
  `);
  assert.deepEqual(emptyKeys.rows.map(row => [
    row.entity_name, row.dba, row.contact_identity_name_key, row.contact_identity_dba_key,
  ]), [
    [null, null, "", ""],
    ["", "", "", ""],
  ], "generated keys preserve the SQL normalizer's null-to-empty and blank semantics");

  const legalKey = reconciliation.normalizeBusinessName("Sunrise Dental, LLC");
  assert.equal(legalKey, "sunrise dental", "TypeScript legal-suffix normalization matches the indexed SQL key");
  const legal = await client.query(CONTACT_LINK_UNLINKED_SUNBIZ_NAME_MATCH_SQL, [legalKey, 21]);
  assert.deepEqual(legal.rows.map(row => row.filingNumber), ["RAW-SUNRISE-1"],
    "legal-suffix retrieval finds unlinked raw legal-name variants only");

  const dbaKey = reconciliation.normalizeBusinessName("Sunrise Family Dentistry LLC");
  const dba = await client.query(CONTACT_LINK_UNLINKED_SUNBIZ_NAME_MATCH_SQL, [dbaKey, 21]);
  assert.deepEqual(dba.rows.map(row => row.filingNumber), ["RAW-SUNRISE-1", "RAW-SUNRISE-2"],
    "DBA retrieval returns legitimate raw variants, preserves ambiguous filings, and excludes linked/null-filing rows");
  assert.ok(dba.rows.every(row => row.matchType === "dba"));

  await client.query("SET enable_seqscan = off");
  const explain = await client.query(
    `EXPLAIN (COSTS OFF) ${CONTACT_LINK_UNLINKED_SUNBIZ_NAME_MATCH_SQL}`,
    [dbaKey, 21],
  );
  const plan = explain.rows.map(row => Object.values(row).join(" ")).join("\n");
  assert.match(plan, /sunbiz_entities_contact_identity_name_key_idx/,
    "legal-name branch uses the stored generated-column index");
  assert.match(plan, /sunbiz_entities_contact_identity_dba_key_idx/,
    "DBA branch uses the stored generated-column index");
  const nameIndex = await client.query(
    `SELECT indexdef FROM pg_indexes WHERE indexname='sunbiz_entities_contact_identity_name_key_idx'`,
  );
  assert.match(nameIndex.rows[0]?.indexdef ?? "", /\(contact_identity_name_key\)/);
  assert.match(nameIndex.rows[0]?.indexdef ?? "", /WHERE .*filing_number IS NOT NULL/i);
  const dbaIndex = await client.query(
    `SELECT indexdef FROM pg_indexes WHERE indexname='sunbiz_entities_contact_identity_dba_key_idx'`,
  );
  assert.match(dbaIndex.rows[0]?.indexdef ?? "", /\(contact_identity_dba_key\)/);
  assert.match(dbaIndex.rows[0]?.indexdef ?? "", /WHERE .*filing_number IS NOT NULL.*dba IS NOT NULL/i,
    "the generated-column DBA index retains its non-null filing and DBA predicate");

  const identity = {
    candidateId: "00000000-0000-4000-8000-000000000031",
    contactId: 31,
    businessId: 41,
    sourceEntityId: 1,
    filingNumber: "RAW-SUNRISE-1",
  };
  const preview = await recovery.previewContactLinkSourceRecoveryWithQueryable(client, identity);
  assert.equal(preview.status, "READY", "exact contact DBA→raw DBA and raw legal→canonical name is previewable");
  assert.deepEqual(preview.candidateBusinessIds, [41]);
  assert.ok(preview.snapshotHash);

  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const applied = await recovery.applyContactLinkSourceRecoveryInTransaction(client, {
      ...identity,
      expectedSnapshotHash: preview.snapshotHash!,
    });
    assert.equal(applied.status, "MATERIALIZED");
    assert.equal(applied.businessId, 41);
    const link = await client.query(`
      SELECT id, business_id, raw_evidence
      FROM canonical_source_links
      WHERE source_system = 'sunbiz' AND source_type = 'sunbiz_entity'
        AND stable_key = 'RAW-SUNRISE-1'
    `);
    assert.equal(link.rows.length, 1);
    assert.equal(Number(link.rows[0].business_id), 41);
    assert.equal(Number(link.rows[0].raw_evidence.immutableSourceIdentity.sourceEntityId), 1);
    assert.equal(link.rows[0].raw_evidence.immutableSourceIdentity.filingNumber, "RAW-SUNRISE-1");
    const untouchedContact = await client.query(`
      SELECT business_id FROM contacts WHERE id = 31
    `);
    assert.equal(untouchedContact.rows[0].business_id, null, "materialization does not alter contact-business projection");
    const untouchedDecisions = await client.query(`
      SELECT 1 FROM contact_business_link_decisions WHERE contact_id = 31
    `);
    assert.equal(untouchedDecisions.rows.length, 0, "materialization never verifies a contact link");
    const claim = await client.query(`
      SELECT sunbiz_entity_id, business_id, status FROM sunbiz_bootstrap_claims
      WHERE filing_number = 'RAW-SUNRISE-1'
    `);
    assert.deepEqual(claim.rows.map(row => [
      Number(row.sunbiz_entity_id), Number(row.business_id), row.status,
    ]), [[1, 41, "matched_existing"]]);
    const replay = await recovery.applyContactLinkSourceRecoveryInTransaction(client, {
      ...identity,
      expectedSnapshotHash: preview.snapshotHash!,
    });
    assert.equal(replay.status, "ALREADY_MATERIALIZED", "same source/filing/candidate replay is idempotent");
  } finally {
    await client.query("ROLLBACK");
  }
  const rolledBackLink = await client.query(`
    SELECT 1 FROM canonical_source_links
    WHERE source_system = 'sunbiz' AND source_type = 'sunbiz_entity'
      AND stable_key = 'RAW-SUNRISE-1'
  `);
  assert.equal(rolledBackLink.rows.length, 0, "disposable apply fixture leaves no committed rows");

  const wrongSourceId = await recovery.previewContactLinkSourceRecoveryWithQueryable(client, {
    ...identity,
    sourceEntityId: 2,
  });
  assert.equal(wrongSourceId.status, "HOLD", "source entity ID and filing number are an immutable pair");
  assert.ok(wrongSourceId.reasonCodes.includes("source_entity_id_and_filing_number_pair_not_found"));

  await client.query("BEGIN");
  try {
    await client.query("UPDATE sunbiz_entities SET website = 'https://changed.example' WHERE id = 1");
    const stale = await recovery.applyContactLinkSourceRecoveryInTransaction(client, {
      ...identity,
      expectedSnapshotHash: preview.snapshotHash!,
    });
    assert.equal(stale.status, "STALE_PREVIEW", "changed source facts fail the exact preview snapshot CAS");
  } finally {
    await client.query("ROLLBACK");
  }

  await client.query("BEGIN");
  try {
    await client.query(`
      INSERT INTO businesses VALUES (42, 'Sunrise Dental LLC', 'sunrise dental', 'canonical', false)
    `);
    const ambiguous = await recovery.previewContactLinkSourceRecoveryWithQueryable(client, identity);
    assert.equal(ambiguous.status, "HOLD");
    assert.ok(ambiguous.reasonCodes.includes("raw_sunbiz_identity_maps_to_multiple_canonical_businesses"));
  } finally {
    await client.query("ROLLBACK");
  }

  await client.query("BEGIN");
  try {
    await client.query(`
      INSERT INTO canonical_source_links (business_id, source_system, source_type, stable_key)
      VALUES (42, 'sunbiz_entities', 'sunbiz_filing', 'RAW-SUNRISE-1')
    `);
    const legacyConflict = await recovery.previewContactLinkSourceRecoveryWithQueryable(client, identity);
    assert.equal(legacyConflict.status, "HOLD");
    assert.ok(legacyConflict.reasonCodes.includes("legacy_sunbiz_crosswalk_targets_other_business"),
      "legacy aliases are checked for conflicts but never treated as the canonical tuple");
  } finally {
    await client.query("ROLLBACK");
  }

  console.log("contact-link raw Sunbiz recovery disposable SQL test passed");
} finally {
  client.release();
  await pool.end();
}