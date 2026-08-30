import assert from "node:assert/strict";
import fs from "node:fs";
import { Client } from "pg";

const url = process.env.TEST_DATABASE_URL;
if (!url || url !== process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL and TEST_DATABASE_URL must identify the same approved staging/test database.");
}
const expectedName = process.env.TEST_APPROVED_DB_NAME?.trim();

const migration = fs.readFileSync("migrations/0193_cro03_ledger_lineage_drift_repair.sql", "utf8");
const client = new Client({ connectionString: url });
await client.connect();
try {
  const identity = await client.query<{ name: string }>("SELECT current_database() AS name");
  const databaseName = identity.rows[0]?.name ?? "";
  const approved = expectedName
    ? databaseName === expectedName && !/(prod|production|live)/i.test(databaseName)
    : !/(prod|production|live)/i.test(databaseName) &&
      /(^|[_-])(test|ci)([_-]|$)|^(test|ci)/i.test(databaseName);
  assert.ok(approved, expectedName
    ? `Database ${databaseName} does not match the explicit non-production approval.`
    : `Database ${databaseName} is not clearly named as a test/CI database.`);

  await client.query("BEGIN");
  try {
    await client.query(`
      CREATE SCHEMA cro03_repair_test;
      SET LOCAL search_path TO cro03_repair_test;
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE provider_operations(id UUID PRIMARY KEY,provider TEXT NOT NULL);
      CREATE TABLE provider_attempts(id UUID PRIMARY KEY);
      CREATE TABLE validation_intents(id UUID PRIMARY KEY);
      CREATE TABLE cro03_provider_runs(
        id UUID PRIMARY KEY,item_id UUID NOT NULL,provider TEXT NOT NULL,operation_id UUID,
        route_policy_version INTEGER NOT NULL,purpose TEXT NOT NULL,state TEXT NOT NULL,
        provider_outcome TEXT,billing_disposition TEXT,target_fingerprint TEXT,
        authorization_context_hash TEXT,attempt_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),completed_at TIMESTAMPTZ
      );
      CREATE TABLE cro03_receipts(
        id UUID PRIMARY KEY,provider_run_id UUID NOT NULL REFERENCES cro03_provider_runs(id),
        provider_operation_id UUID REFERENCES provider_operations(id),receipt_key TEXT NOT NULL UNIQUE,
        provider_request_hash TEXT,receipt_reference TEXT,billing_disposition TEXT NOT NULL,
        units INTEGER NOT NULL DEFAULT 0,amount_micros BIGINT NOT NULL DEFAULT 0,
        redacted_metadata JSONB NOT NULL DEFAULT '{}',received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE cro03_provider_ledger(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),provider_run_id UUID NOT NULL REFERENCES cro03_provider_runs(id),
        provider_operation_id UUID REFERENCES provider_operations(id),provider TEXT NOT NULL,
        entry_key TEXT NOT NULL UNIQUE,disposition TEXT NOT NULL,units INTEGER NOT NULL DEFAULT 0,
        amount_micros BIGINT NOT NULL DEFAULT 0,receipt_reference TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE FUNCTION cro03_immutable_row_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION '% is immutable',TG_TABLE_NAME; END $$;
      INSERT INTO provider_operations VALUES
        ('00000000-0000-4000-8000-000000000001','apollo'),
        ('00000000-0000-4000-8000-000000000002','outscraper');
      INSERT INTO cro03_provider_runs
        (id,item_id,provider,operation_id,route_policy_version,purpose,state,billing_disposition)
      VALUES
        ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
         'apollo','00000000-0000-4000-8000-000000000001',1,'internal_test','reserved','outstanding'),
        ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',
         'outscraper','00000000-0000-4000-8000-000000000002',1,'internal_test','completed','consumed');
      INSERT INTO cro03_provider_ledger
        (id,provider_run_id,provider_operation_id,provider,entry_key,disposition,units,amount_micros)
      VALUES
        ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
         '00000000-0000-4000-8000-000000000001','apollo','legacy-outstanding','outstanding',1,0),
        ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',
         '00000000-0000-4000-8000-000000000002','outscraper','legacy-terminal','consumed',2,100);
      INSERT INTO cro03_receipts
        (id,provider_run_id,provider_operation_id,receipt_key,billing_disposition,units,amount_micros)
      VALUES
        ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',
         '00000000-0000-4000-8000-000000000002','legacy-receipt','consumed',2,100);
    `);
    await client.query(migration);
    const once = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM cro03_provider_ledger) AS ledger_count,
        (SELECT COUNT(*)::int FROM cro03_provider_ledger WHERE event_type='reservation') AS reservations,
        (SELECT COUNT(*)::int FROM cro03_provider_ledger WHERE event_type='terminal'
          AND reservation_entry_id IS NOT NULL) AS linked_terminals,
        (SELECT COUNT(*)::int FROM cro03_receipts WHERE provider='outscraper') AS attributed_receipts
    `);
    assert.deepEqual(once.rows[0], {
      ledger_count: 3, reservations: 2, linked_terminals: 1, attributed_receipts: 1,
    });
    await client.query(migration);
    const twice = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM cro03_provider_ledger) AS ledger_count,
        (SELECT COUNT(*)::int FROM cro03_provider_ledger WHERE event_type='reservation') AS reservations,
        (SELECT COUNT(*)::int FROM cro03_provider_ledger WHERE event_type='terminal'
          AND reservation_entry_id IS NOT NULL) AS linked_terminals,
        (SELECT COUNT(*)::int FROM cro03_receipts WHERE provider='outscraper') AS attributed_receipts
    `);
    assert.deepEqual(twice.rows[0], once.rows[0], "second migration application must be an exact replay");
    const columns = await client.query<{ table_name: string; column_name: string }>(`
      SELECT table_name,column_name FROM information_schema.columns
       WHERE table_schema=current_schema()
         AND ((table_name='cro03_provider_ledger' AND column_name IN ('event_type','reservation_entry_id'))
          OR (table_name='cro03_receipts' AND column_name='provider'))
       ORDER BY table_name,column_name
    `);
    assert.deepEqual(columns.rows, [
      { table_name: "cro03_provider_ledger", column_name: "event_type" },
      { table_name: "cro03_provider_ledger", column_name: "reservation_entry_id" },
      { table_name: "cro03_receipts", column_name: "provider" },
    ]);
    const guards = await client.query<{ name: string }>(`
      SELECT conname AS name FROM pg_constraint
       WHERE conrelid='cro03_provider_ledger'::regclass
         AND conname IN ('cro03_ledger_event_type_chk','cro03_ledger_terminal_lineage_chk')
      UNION ALL
      SELECT tgname FROM pg_trigger
       WHERE tgrelid IN ('cro03_provider_ledger'::regclass,'cro03_receipts'::regclass)
         AND NOT tgisinternal
         AND tgname IN ('cro03_ledger_immutable','cro03_ledger_lineage_guard',
                        'cro03_receipt_immutable','cro03_receipt_lineage_guard')
      UNION ALL
      SELECT indexname FROM pg_indexes
       WHERE schemaname=current_schema()
         AND indexname IN ('cro03_ledger_one_reservation_per_run',
                           'cro03_ledger_one_reservation_per_operation',
                           'cro03_ledger_one_terminal_per_run')
      ORDER BY name
    `);
    assert.deepEqual(guards.rows.map((row) => row.name), [
      "cro03_ledger_event_type_chk",
      "cro03_ledger_immutable",
      "cro03_ledger_lineage_guard",
      "cro03_ledger_one_reservation_per_operation",
      "cro03_ledger_one_reservation_per_run",
      "cro03_ledger_one_terminal_per_run",
      "cro03_ledger_terminal_lineage_chk",
      "cro03_receipt_immutable",
      "cro03_receipt_lineage_guard",
    ]);
  } finally {
    await client.query("ROLLBACK");
  }
  console.log("PASS CRO-03 ledger drift repair apply/replay and schema lineage");
} finally {
  await client.end();
}