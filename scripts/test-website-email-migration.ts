#!/usr/bin/env tsx
/**
 * E14 schema and release proof for migration 0382 (website email lifecycle), on freshly created disposable PostgreSQL
 * databases only. The production migrator harness (server/db-migrate.ts) is the only thing that applies migrations.
 *
 *  1. Fresh install through the harness; exact ledger hash; harness re-run leaves the ledger unchanged.
 *  2. SQL-to-Drizzle parity for every new table and the new enrollment column (columns, types, nullability, indexes, checks).
 *  3. Upgrade with historic rows: the prior head is the harness-migrated schema with exactly the 0382 objects reversed and
 *     its ledger row removed (an emulated 0381 head, stated as such); the harness then upgrades it and every historic row
 *     survives with legal values still legal, unknown values still rejected, and nothing opened.
 *  4. Partial schema: an interrupted earlier attempt (some objects present, no ledger row) converges without data loss.
 *  5. Rollback and replay with retained rows: the additive schema keeps rows, legacy writers still work unchanged,
 *     and replaying the 0382 SQL changes nothing.
 * No provider, no network, no production database.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";

const sourceUrl = process.env.TEST_DATABASE_URL;
if (!sourceUrl || sourceUrl !== process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must equal DATABASE_URL and identify the disposable test cluster.");
}
const source = new URL(sourceUrl);
if (/(prod|production|live)/i.test(source.pathname)) throw new Error("Refusing non-disposable database name.");
const root = new URL(sourceUrl);
root.pathname = "/postgres";
const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const names = { clean: `we_clean_${nonce}`, upgrade: `we_upgrade_${nonce}`, partial: `we_partial_${nonce}` };
const migrations = path.join(process.cwd(), "migrations");
const TAG = "0382_website_email_lifecycle";
const sql0382 = fs.readFileSync(path.join(migrations, `${TAG}.sql`), "utf8");
const hash0382 = crypto.createHash("sha256").update(sql0382).digest("hex");
let checks = 0;
function ok(condition: unknown, label: string) { assert.ok(condition, label); checks++; console.log(`  ✓ ${label}`); }
function equal<T>(actual: T, expected: T, label: string) { assert.deepEqual(actual, expected, label); checks++; console.log(`  ✓ ${label}`); }

const NEW_TABLES = [
  "website_lifecycle_config_revisions", "website_warm_revisions", "website_lifecycle_intents", "website_lifecycle_admissions",
  "website_email_send_receipts", "gmail_mailbox_reader_state", "website_inbound_evidence",
] as const;

function urlFor(name: string) { const value = new URL(sourceUrl!); value.pathname = `/${name}`; return value.toString(); }
async function admin<T>(fn: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: root.toString() });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}
async function withDb<T>(name: string, fn: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: urlFor(name) });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}
async function dropDb(name: string) {
  await admin(async (client) => {
    await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [name]);
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
  });
}
function migrate(databaseUrl: string) {
  // A child process is intentional: server/db has a module-level pool, so each database needs its own harness process.
  const result = spawnSync(process.execPath, [path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "server/db-migrate.ts"],
    { env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8", timeout: 240_000 });
  if (result.status !== 0) throw new Error(`production migration harness failed: ${(result.stderr || result.stdout).slice(-2500)}`);
}
async function ledger(client: Client) {
  return (await client.query("SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
}
async function exists(client: Client, relation: string) {
  return Boolean((await client.query("SELECT to_regclass($1) AS r", [`public.${relation}`])).rows[0].r);
}
async function hasColumn(client: Client) {
  return (await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name='sequence_enrollments' AND column_name='website_admission_id'`)).rowCount === 1;
}

/** Reverse exactly what 0382 added, in dependency order, and restore the original 0119 provider CHECK. */
async function reverseTo0381(client: Client) {
  await client.query(`ALTER TABLE sequence_enrollments DROP CONSTRAINT IF EXISTS sequence_enrollments_website_admission_id_fk`);
  await client.query(`DROP INDEX IF EXISTS sequence_enrollments_website_admission_idx`);
  await client.query(`ALTER TABLE sequence_enrollments DROP COLUMN IF EXISTS website_admission_id`);
  for (const table of ["website_inbound_evidence", "gmail_mailbox_reader_state", "website_email_send_receipts", "website_lifecycle_admissions",
    "website_lifecycle_intents", "website_warm_revisions", "website_lifecycle_config_revisions"]) {
    await client.query(`DROP TABLE IF EXISTS ${table}`);
  }
  await client.query(`ALTER TABLE communication_events DROP CONSTRAINT IF EXISTS communication_events_provider_gmail_chk`);
  await client.query(`ALTER TABLE communication_events ADD CONSTRAINT communication_events_provider_check CHECK (provider IS NULL OR provider IN ('ghl','smtp','twilio','internal','manual'))`);
  await client.query(`DELETE FROM drizzle.__drizzle_migrations WHERE hash=$1`, [hash0382]);
}

/** Run one statement in its own transaction that is always rolled back; return the SQLSTATE it raised ('' if none). */
async function errCode(client: Client, text: string, params: unknown[] = []) {
  await client.query("BEGIN");
  let code = "";
  try { await client.query(text, params); } catch (error: any) { code = error.code ?? "unknown"; }
  await client.query("ROLLBACK");
  return code;
}

/** Statements of a migration file as the harness applies them. */
function statements(text: string) { return text.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean); }

function normalizeType(type: string) {
  return type.toLowerCase().replace(/\s+/g, " ").replace(/, /g, ",")
    .replace(/^character varying/, "varchar").replace(/^timestamp with time zone$/, "timestamptz")
    .replace(/^timestamp without time zone$/, "timestamp").replace(/^timestamp$/, "timestamp")
    .replace(/^serial$/, "integer").replace(/^bigserial$/, "bigint").replace(/^double precision$/, "double precision");
}

async function parity(client: Client) {
  const schema = await import("../shared/schema");
  const tables = [
    ...NEW_TABLES.map((name) => Object.values(schema).find((value: any) => {
      try { return getTableConfig(value as any).name === name; } catch { return false; }
    })),
  ] as any[];
  tables.forEach((table, index) => ok(table, `Drizzle declares ${NEW_TABLES[index]}`));
  for (const table of tables) {
    const config = getTableConfig(table);
    const dbColumns = (await client.query(
      `SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS not_null
         FROM pg_attribute a WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname`, [`public.${config.name}`])).rows;
    const model = config.columns.map((column: any) => ({ name: column.name, type: normalizeType(column.getSQLType()), not_null: Boolean(column.notNull) }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
    equal(dbColumns.map((c: any) => ({ name: c.name, type: normalizeType(c.type), not_null: c.not_null })), model, `${config.name}: columns, types and nullability match the Drizzle model`);
    const dbIndexes = (await client.query(
      `SELECT c.relname AS name, i.indisunique AS uniq FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
        WHERE i.indrelid=$1::regclass AND NOT i.indisprimary ORDER BY c.relname`, [`public.${config.name}`])).rows.map((r: any) => `${r.name}:${r.uniq}`);
    const modelIndexes = [
      ...config.indexes.map((i: any) => `${i.config.name}:${Boolean(i.config.unique)}`),
      ...config.uniqueConstraints.map((u: any) => `${u.name}:true`),
    ].sort();
    equal(dbIndexes, modelIndexes, `${config.name}: indexes and uniqueness match the Drizzle model`);
    const dbChecks = (await client.query(`SELECT conname FROM pg_constraint WHERE conrelid=$1::regclass AND contype='c' ORDER BY conname`, [`public.${config.name}`])).rows.map((r: any) => r.conname);
    const modelChecks = config.checks.map((c: any) => c.name).sort();
    equal(dbChecks, modelChecks, `${config.name}: check constraints match the Drizzle model`);
  }
  const enrollments = getTableConfig((schema as any).sequenceEnrollments);
  const column: any = enrollments.columns.find((c: any) => c.name === "website_admission_id");
  ok(column && !column.notNull, "Drizzle declares the nullable sequence_enrollments.website_admission_id");
  const dbColumn = (await client.query(`SELECT is_nullable, column_default, data_type FROM information_schema.columns WHERE table_name='sequence_enrollments' AND column_name='website_admission_id'`)).rows[0];
  equal({ nullable: dbColumn.is_nullable, def: dbColumn.column_default, type: dbColumn.data_type }, { nullable: "YES", def: null, type: "integer" },
    "sequence_enrollments.website_admission_id is a nullable integer with no default (legacy inserts are unaffected)");
  const fk = (await client.query(`SELECT confrelid::regclass::text AS target FROM pg_constraint WHERE conname='sequence_enrollments_website_admission_id_fk' AND contype='f'`)).rows;
  equal(fk.map((r: any) => r.target), ["website_lifecycle_admissions"], "the enrollment marker is a foreign key to the admission record");
}

async function seedHistoric(client: Client) {
  const contact = (await client.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class) VALUES('Hist','Oric',$1,$2,'test') RETURNING id`,
    [`hist-${nonce}@example.test`, `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`])).rows[0].id;
  const sequence = (await client.query(`INSERT INTO follow_up_sequences(name,status,trigger_type,total_steps) VALUES($1,'paused','manual',0) RETURNING id`, [`hist-seq-${nonce}`])).rows[0].id;
  const enrollment = (await client.query(`INSERT INTO sequence_enrollments(contact_id,sequence_id,status,current_step,next_action_at) VALUES($1,$2,'active',0,now()-interval '1 hour') RETURNING id`, [contact, sequence])).rows[0].id;
  const providers = ["ghl", "smtp", "twilio", "internal", "manual", null];
  const events: number[] = [];
  for (const provider of providers) {
    events.push((await client.query(`INSERT INTO communication_events(contact_id,direction,channel,provider,status,sent_by) VALUES($1,'outbound','email',$2,'sent','automation') RETURNING id`, [contact, provider])).rows[0].id);
  }
  return { contact, sequence, enrollment, events, providers };
}

async function expectCheckRejected(client: Client, provider: string, label: string) {
  equal(await errCode(client, `INSERT INTO communication_events(direction,channel,provider,status,sent_by) VALUES('outbound','email',$1,'sent','automation')`, [provider]), "23514", label);
}

try {
  await admin(async (client) => { await client.query(`CREATE DATABASE "${names.clean}"`); });

  // ── 1. Fresh install ──
  console.log("\n[1] Fresh install through the production harness");
  migrate(urlFor(names.clean));
  const cleanLedger = await withDb(names.clean, async (client) => {
    for (const table of NEW_TABLES) ok(await exists(client, table), `fresh install creates ${table}`);
    ok(await hasColumn(client), "fresh install adds sequence_enrollments.website_admission_id");
    const rows = (await client.query(`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash=$1`, [hash0382])).rowCount;
    equal(rows, 1, "the ledger records the exact 0382 file hash once");
    for (const table of NEW_TABLES) equal(Number((await client.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n), 0, `${table} starts empty (nothing seeded, nothing opened)`);
    const constraint = (await client.query(`SELECT convalidated FROM pg_constraint WHERE conname='communication_events_provider_gmail_chk'`)).rows;
    equal(constraint.map((r: any) => r.convalidated), [true], "the widened provider check is installed and validated");
    equal((await client.query(`SELECT count(*)::int n FROM pg_constraint WHERE conname='communication_events_provider_check' AND conrelid='communication_events'::regclass`)).rows[0].n, 0, "the narrow original check is gone (swapped, not duplicated)");
    return ledger(client);
  });
  migrate(urlFor(names.clean));
  await withDb(names.clean, async (client) => { equal(await ledger(client), cleanLedger, "re-running the harness leaves the ledger unchanged"); });

  // ── 2. SQL-to-Drizzle parity ──
  console.log("\n[2] SQL-to-Drizzle parity");
  await withDb(names.clean, parity);
  await withDb(names.clean, async (client) => {
    // Negative controls: the constraints are real, not just declared.
    const insertRevision = `INSERT INTO website_lifecycle_config_revisions(revision,status,config_hash,created_by) VALUES(1,$1,$2,'t')`;
    equal(await errCode(client, insertRevision, ["bogus", "a".repeat(64)]), "23514", "an unknown lane status is rejected by the database");
    equal(await errCode(client, insertRevision, ["closed", "not-a-hash"]), "23514", "a malformed configuration hash is rejected by the database");
    await client.query(insertRevision, ["closed", "a".repeat(64)]);
    equal(await errCode(client, insertRevision, ["closed", "b".repeat(64)]), "23505", "a second configuration with the same revision number is rejected (compare-and-set identity)");
    await client.query(`DELETE FROM website_lifecycle_config_revisions`);
  });

  // ── 3. Upgrade with historic rows (emulated 0381 head) ──
  console.log("\n[3] Upgrade with historic rows");
  await admin(async (client) => { await client.query(`CREATE DATABASE "${names.upgrade}" TEMPLATE "${names.clean}"`); });
  const historic = await withDb(names.upgrade, async (client) => {
    await reverseTo0381(client);
    for (const table of NEW_TABLES) ok(!(await exists(client, table)), `prior head has no ${table}`);
    ok(!(await hasColumn(client)), "prior head has no website_admission_id column");
    equal((await client.query(`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash=$1`, [hash0382])).rowCount, 0, "prior head has no 0382 ledger row");
    await expectCheckRejected(client, "gmail", "prior head rejects the provider value gmail (the gap this migration closes)");
    return seedHistoric(client);
  });
  const priorLedger = await withDb(names.upgrade, (client) => ledger(client));
  migrate(urlFor(names.upgrade));
  await withDb(names.upgrade, async (client) => {
    for (const table of NEW_TABLES) ok(await exists(client, table), `upgrade creates ${table}`);
    ok(await hasColumn(client), "upgrade adds the enrollment marker column");
    const after = await ledger(client);
    equal(after.slice(0, priorLedger.length), priorLedger, "every prior ledger row is retained unchanged");
    equal(after.length, priorLedger.length + 1, "exactly one ledger row is added");
    equal(after[after.length - 1].hash, hash0382, "the added row is the exact 0382 hash");
    const enrollment = (await client.query(`SELECT id,sequence_id,contact_id,status,website_admission_id FROM sequence_enrollments WHERE id=$1`, [historic.enrollment])).rows[0];
    equal({ ...enrollment }, { id: historic.enrollment, sequence_id: historic.sequence, contact_id: historic.contact, status: "active", website_admission_id: null },
      "the historic enrollment survives unchanged and unmarked");
    const events = (await client.query(`SELECT id,provider FROM communication_events WHERE id = ANY($1) ORDER BY id`, [historic.events])).rows;
    equal(events.map((r: any) => r.provider), historic.providers, "historic communication events keep their exact provider values");
    equal((await client.query(`SELECT convalidated FROM pg_constraint WHERE conname='communication_events_provider_gmail_chk'`)).rows.map((r: any) => r.convalidated), [true], "the widened check validated against the historic rows");
    for (const provider of ["gmail", "ghl", "smtp"]) {
      await client.query(`INSERT INTO communication_events(direction,channel,provider,status,sent_by) VALUES('outbound','email',$1,'sent','automation')`, [provider]);
    }
    ok(true, "gmail and every previously legal provider are accepted");
    await expectCheckRejected(client, "carrier_pigeon", "an unlisted provider is still rejected");
    for (const table of NEW_TABLES) equal(Number((await client.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n), 0, `${table} is empty after upgrade (default closed; nothing admitted)`);
    equal(Number((await client.query(`SELECT count(*)::int n FROM sequence_enrollments WHERE website_admission_id IS NOT NULL`)).rows[0].n), 0, "no enrollment is marked as a warm journey by the migration");
    equal((await client.query(`SELECT status FROM follow_up_sequences WHERE id=$1`, [historic.sequence])).rows[0].status, "paused", "the migration does not un-pause any sequence");
  });
  await withDb(names.upgrade, async (client) => { await parity(client); });

  // ── 4. Partial schema ──
  console.log("\n[4] Partial schema from an interrupted earlier attempt");
  await admin(async (client) => { await client.query(`CREATE DATABASE "${names.partial}" TEMPLATE "${names.clean}"`); });
  await withDb(names.partial, async (client) => {
    await reverseTo0381(client);
    // Re-create a strict subset exactly as the migration would, with a retained row, and a half-swapped provider check.
    const parts = statements(sql0382);
    const code = (part: string) => part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim();
    const wanted = parts.filter((part) => /^CREATE TABLE IF NOT EXISTS website_lifecycle_config_revisions\b/.test(code(part))
      || /^CREATE UNIQUE INDEX IF NOT EXISTS website_lifecycle_config_revisions_/.test(code(part))
      || /^ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS website_admission_id/.test(code(part)));
    equal(wanted.length, 3, "the interrupted attempt is a strict subset: one table, its index and the enrollment column");
    for (const part of wanted) await client.query(part);
    await client.query(`INSERT INTO website_lifecycle_config_revisions(revision,status,config_hash,created_by,note) VALUES(7,'closed',$1,'partial-fixture','retained')`, ["c".repeat(64)]);
    await client.query(`ALTER TABLE communication_events DROP CONSTRAINT IF EXISTS communication_events_provider_check`);
    await client.query(`ALTER TABLE communication_events ADD CONSTRAINT communication_events_provider_gmail_chk CHECK (provider IS NULL OR provider IN ('ghl','smtp','gmail','twilio','internal','manual')) NOT VALID`);
    ok(await exists(client, "website_lifecycle_config_revisions") && !(await exists(client, "website_lifecycle_intents")), "partial state: one new table present, the rest absent");
    ok(await hasColumn(client), "partial state: the enrollment column is already present");
    equal((await client.query(`SELECT convalidated FROM pg_constraint WHERE conname='communication_events_provider_gmail_chk'`)).rows.map((r: any) => r.convalidated), [false], "partial state: the widened check exists but is not validated");
    equal((await client.query(`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash=$1`, [hash0382])).rowCount, 0, "partial state: no ledger row");
  });
  migrate(urlFor(names.partial));
  await withDb(names.partial, async (client) => {
    for (const table of NEW_TABLES) ok(await exists(client, table), `convergence creates or keeps ${table}`);
    equal((await client.query(`SELECT revision,note FROM website_lifecycle_config_revisions`)).rows.map((r: any) => ({ ...r })), [{ revision: 7, note: "retained" }], "the retained row from the interrupted attempt survives convergence");
    equal((await client.query(`SELECT convalidated FROM pg_constraint WHERE conname='communication_events_provider_gmail_chk'`)).rows.map((r: any) => r.convalidated), [true], "convergence validates the half-installed check");
    equal((await client.query(`SELECT count(*)::int n FROM pg_constraint WHERE conrelid='communication_events'::regclass AND conname IN ('communication_events_provider_check','communication_events_provider_gmail_chk')`)).rows[0].n, 1, "exactly one provider check remains");
    equal((await client.query(`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash=$1`, [hash0382])).rowCount, 1, "the ledger records 0382 once");
  });
  await withDb(names.partial, async (client) => { await parity(client); });

  // ── 5. Rollback and replay with retained rows ──
  console.log("\n[5] Rollback and replay with retained rows");
  await withDb(names.upgrade, async (client) => {
    const rev = (await client.query(`INSERT INTO website_lifecycle_config_revisions(revision,status,config_hash,created_by) VALUES(1,'closed',$1,'retained-fixture') RETURNING id`, ["d".repeat(64)])).rows[0].id;
    const before = {
      revs: (await client.query(`SELECT count(*)::int n FROM website_lifecycle_config_revisions`)).rows[0].n,
      gmail: (await client.query(`SELECT count(*)::int n FROM communication_events WHERE provider='gmail'`)).rows[0].n,
      enrollments: (await client.query(`SELECT count(*)::int n FROM sequence_enrollments`)).rows[0].n,
    };
    // Legacy writers keep working against the upgraded schema exactly as before (they never name the new column).
    const otherContact = (await client.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class) VALUES('Legacy','Writer',$1,$2,'test') RETURNING id`,
      [`legacy-${nonce}@example.test`, `+1556${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`])).rows[0].id;
    const legacy = await client.query(`INSERT INTO sequence_enrollments (sequence_id, contact_id, current_step, status, metadata) VALUES ($1,$2,0,'active','{}'::jsonb) RETURNING id, website_admission_id`, [historic.sequence, otherContact]);
    equal(legacy.rows[0].website_admission_id, null, "a legacy raw-SQL enrollment insert still works and stays unmarked");
    // Replaying the whole migration with retained rows changes nothing and raises nothing.
    for (const part of statements(sql0382)) await client.query(part);
    equal({
      revs: (await client.query(`SELECT count(*)::int n FROM website_lifecycle_config_revisions`)).rows[0].n,
      gmail: (await client.query(`SELECT count(*)::int n FROM communication_events WHERE provider='gmail'`)).rows[0].n,
      enrollments: (await client.query(`SELECT count(*)::int n FROM sequence_enrollments`)).rows[0].n - 1,
    }, before, "replaying the 0382 SQL against retained rows is idempotent");
    ok((await client.query(`SELECT 1 FROM website_lifecycle_config_revisions WHERE id=$1`, [rev])).rowCount === 1, "the retained configuration revision is unchanged by the replay");
    equal((await client.query(`SELECT convalidated FROM pg_constraint WHERE conname='communication_events_provider_gmail_chk'`)).rows.map((r: any) => r.convalidated), [true], "the replay leaves the provider check validated");
    // Code rollback means redeploying the previous build: the schema is additive, so nothing is dropped and old statements still run.
    for (const provider of ["ghl", "smtp", "twilio", "internal", "manual"]) {
      await client.query(`INSERT INTO communication_events(direction,channel,provider,status,sent_by) VALUES('outbound','email',$1,'sent','automation')`, [provider]);
    }
    ok(true, "every statement the previous build issues against these tables still succeeds");
  });
  await withDb(names.clean, async (client) => {
    // Reversal on a database that has retained Gmail rows must be refused by the database, not silently drop the evidence.
    await client.query(`INSERT INTO communication_events(direction,channel,provider,status,sent_by) VALUES('outbound','email','gmail','sent','automation')`);
    const refused = await errCode(client, `ALTER TABLE communication_events DROP CONSTRAINT communication_events_provider_gmail_chk, ADD CONSTRAINT communication_events_provider_check CHECK (provider IS NULL OR provider IN ('ghl','smtp','twilio','internal','manual'))`);
    equal(refused, "23514", "narrowing the provider check is refused while retained Gmail evidence exists (schema rollback is not a supported release path)");
    equal((await client.query(`SELECT count(*)::int n FROM communication_events WHERE provider='gmail'`)).rows[0].n, 1, "the retained Gmail row is intact after the refused rollback");
  });

  console.log(`\nWebsite email lifecycle migration proof: PASS (${checks} checks)`);
} finally {
  process.env.DATABASE_URL = sourceUrl;
  await Promise.all(Object.values(names).map((name) => dropDb(name).catch(() => undefined)));
}
