#!/usr/bin/env tsx
/**
 * Schema, upgrade, replay and rollback proof for migrations 0384 (partner applications, introductions, public policy) and
 * 0385 (review history, introduction decisions and completion checkpoints) and 0386 (validates 0385's two checks, which Publish
 * cannot generate SQL for while they are NOT VALID), on freshly created disposable PostgreSQL
 * databases only. The production migrator harness (server/db-migrate.ts) is the only
 * thing that applies migrations.
 *
 *  1. Fresh install through the harness; exact ledger hash; harness re-run leaves the ledger unchanged.
 *  2. SQL-to-Drizzle parity for the three new tables (columns, types, nullability, indexes, checks) and negative controls
 *     proving the database itself rejects illegal values.
 *  3. Upgrade with historic rows: the prior head is the harness-migrated schema with exactly the 0384 objects reversed and its
 *     ledger row removed (an emulated 0383 head, stated as such). Legacy partner, referral and commission-tier rows are
 *     checksummed before and after; the migration changes none of them, creates no application, opens nothing.
 *  4. Partial schema: an interrupted earlier attempt (one table present with a retained row, no ledger row) converges.
 *  3b. 0385 upgrade from a real 0384 head holding historic introductions: the checkpoint backfill marks exactly the steps the
 *     previous code performed, leaves unlinked rows pending, and never touches a partner's referral total.
 *  5. Replay: the whole 0384, 0385 and 0386 SQL replayed against retained evidence changes nothing.
 *  6. Rollback rehearsal: the previous build (a clean export of the audited base commit) is run against the upgraded
 *     database holding application, consent, introduction and policy evidence. Its migration harness leaves every row,
 *     table and ledger entry in place, its own legacy application route still runs, and the evidence is byte-identical.
 * No provider, no network, no production database.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
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
const names = { clean: `test_pp_clean_${nonce}`, upgrade: `test_pp_upgrade_${nonce}`, backfill: `test_pp_backfill_${nonce}`, partial: `test_pp_partial_${nonce}`, rollback: `test_pp_rollback_${nonce}` };
const migrations = path.join(process.cwd(), "migrations");
const TAG = "0384_partner_applications_introductions_policy";
const sql0384 = fs.readFileSync(path.join(migrations, `${TAG}.sql`), "utf8");
const hash0384 = crypto.createHash("sha256").update(sql0384).digest("hex");
const TAG85 = "0385_partner_review_decisions_and_introduction_completion";
const sql0385 = fs.readFileSync(path.join(migrations, `${TAG85}.sql`), "utf8");
const hash0385 = crypto.createHash("sha256").update(sql0385).digest("hex");
const TAG86 = "0386_partner_introduction_checks_validated";
const sql0386 = fs.readFileSync(path.join(migrations, `${TAG86}.sql`), "utf8");
const hash0386 = crypto.createHash("sha256").update(sql0386).digest("hex");
const INTRO_CHECKS_0385 = ["partner_introductions_completion_chk", "partner_introductions_decision_chk"];
const COLUMNS_0385 = ["revision", "decided_by", "decided_at", "decision_note", "completion_state", "contact_checkpoint_at", "referral_checkpoint_at",
  "notification_checkpoint_at", "count_checkpoint_at", "completion_attempts", "completion_last_attempt_at", "completion_error_code"];
const BASE_COMMIT = process.env.PARTNER_BASE_COMMIT ?? "70baaffd";
let checks = 0;
function ok(condition: unknown, label: string) { assert.ok(condition, label); checks++; console.log(`  ✓ ${label}`); }
function equal<T>(actual: T, expected: T, label: string) { assert.deepEqual(actual, expected, label); checks++; console.log(`  ✓ ${label}`); }

const NEW_TABLES = ["partner_applications", "partner_introductions", "partner_public_policy_versions", "partner_review_events"] as const;
const LEGACY_TABLES: Array<[string, string]> = [["partners", "id"], ["referrals", "id"], ["commission_tiers", "id"], ["users", "id"], ["contacts", "id"]];

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
function migrate(databaseUrl: string, cwd = process.cwd()) {
  // A child process is intentional: server/db has a module-level pool, so each database needs its own harness process.
  const tsx = path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs");
  const result = spawnSync(process.execPath, [tsx, "server/db-migrate.ts"],
    { cwd, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8", timeout: 240_000 });
  if (result.status !== 0) throw new Error(`migration harness failed in ${cwd}: ${(result.stderr || result.stdout).slice(-2500)}`);
}
async function ledger(client: Client) {
  return (await client.query("SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
}
async function exists(client: Client, relation: string) {
  return Boolean((await client.query("SELECT to_regclass($1) AS r", [`public.${relation}`])).rows[0].r);
}
async function count(client: Client, table: string) {
  return Number((await client.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n);
}
/** One digest per table over every column of every row, ordered, so any changed value or row shows up. */
async function checksums(client: Client, tables: Array<[string, string]>, only: Record<string, string> = {}) {
  const out: Record<string, string> = {};
  for (const [table, order] of tables) {
    const where = only[table] ? `WHERE t.id = '${only[table]}'` : "";
    out[table] = (await client.query(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.${order}), '')) AS d FROM ${table} t ${where}`)).rows[0].d;
  }
  return out;
}

/** Reverse exactly what 0385 added (the review-event table and the introduction columns, constraints and index), then its ledger row. */
async function reverseTo0384(client: Client) {
  await client.query(`DROP TABLE IF EXISTS partner_review_events`);
  await client.query(`ALTER TABLE partner_introductions DROP CONSTRAINT IF EXISTS partner_introductions_completion_chk, DROP CONSTRAINT IF EXISTS partner_introductions_decision_chk`);
  await client.query(`DROP INDEX IF EXISTS partner_introductions_completion_idx`);
  for (const column of COLUMNS_0385) await client.query(`ALTER TABLE partner_introductions DROP COLUMN IF EXISTS ${column}`);
  await client.query(`DELETE FROM drizzle.__drizzle_migrations WHERE hash IN ($1,$2)`, [hash0385, hash0386]);
}

/** Both 0385 checks must be validated: Publish generates malformed SQL for a NOT VALID check, which stopped the whole publication. */
async function checksAreValidated(client: Client, label: string) {
  const rows = (await client.query(`SELECT conname, convalidated FROM pg_constraint WHERE conrelid='public.partner_introductions'::regclass AND conname = ANY($1) ORDER BY conname`, [INTRO_CHECKS_0385])).rows;
  equal(rows.map((r: any) => [r.conname, r.convalidated]), INTRO_CHECKS_0385.map((name) => [name, true]), `${label}: both introduction checks exist and are validated (none is NOT VALID, which Publish cannot generate SQL for)`);
}

/** Reverse exactly what 0384 to 0386 added: the new tables (children first), then their ledger rows. */
async function reverseTo0383(client: Client) {
  for (const table of ["partner_review_events", "partner_introductions", "partner_applications", "partner_public_policy_versions"]) {
    await client.query(`DROP TABLE IF EXISTS ${table}`);
  }
  await client.query(`DELETE FROM drizzle.__drizzle_migrations WHERE hash IN ($1,$2,$3)`, [hash0384, hash0385, hash0386]);
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
    .replace(/^timestamp without time zone$/, "timestamp").replace(/^serial$/, "integer").replace(/^bigserial$/, "bigint");
}

async function parity(client: Client) {
  const schema = await import("../shared/schema");
  const tables = NEW_TABLES.map((name) => Object.values(schema).find((value: any) => {
    try { return getTableConfig(value as any).name === name; } catch { return false; }
  })) as any[];
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
    equal(dbChecks, config.checks.map((c: any) => c.name).sort(), `${config.name}: check constraints match the Drizzle model`);
  }
}

async function seedLegacy(client: Client) {
  const contact = (await client.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class) VALUES('Legacy','Referral',$1,$2,'test') RETURNING id`,
    [`pp-legacy-${nonce}@example.test`, `+1557${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`])).rows[0].id;
  const partners: number[] = [];
  for (const [i, spec] of [["active", 10, "hash-a"], ["active", 50, "hash-b"], ["pending", 10, null], ["inactive", 15, "hash-c"]].entries()) {
    partners.push((await client.query(
      `INSERT INTO partners(company_name,contact_name,email,password_hash,partner_type,affiliate_code,status,commission_percent)
       VALUES($1,'Legacy Partner',$2,$3,'referral',$4,$5,$6) RETURNING id`,
      [`Legacy Partner ${i}`, `pp-legacy-partner-${i}-${nonce}@example.test`, spec[2], `ppl${i}${nonce}`.slice(0, 20), spec[0], spec[1]])).rows[0].id);
  }
  for (const partnerId of partners.slice(0, 2)) {
    await client.query(`INSERT INTO referrals(partner_id,contact_id,referred_name,status,commission_amount) VALUES($1,$2,'Legacy Referred','converted','125.50')`, [partnerId, contact]);
  }
  await client.query(`INSERT INTO commission_tiers(min_referrals,max_referrals,commission_amount,label) VALUES(1,5,'100','pp-legacy-tier-${nonce}')`);
  return { contact, partners };
}

/** A real-shaped application, consent, introduction and policy record, inserted directly so the proof needs no application code. */
async function seedEvidence(client: Client) {
  const partner = (await client.query(
    `INSERT INTO partners(company_name,contact_name,email,partner_type,status,commission_percent) VALUES('Evidence Applicant','Eve',$1,'referral','pending',NULL) RETURNING id`,
    [`pp-evidence-${nonce}@example.test`])).rows[0].id;
  const inbound = (await client.query(
    `INSERT INTO inbound_requests(idempotency_key,occurrence_key,request_fingerprint,source_category,source_type,source_class,caller_scope,actor_type,manifest_version,manifest_hash)
     VALUES($1,$2,$3,'website_form','partner_application','public','public:cert','public','test',$4) RETURNING id`,
    [crypto.randomUUID(), crypto.randomUUID(), "f".repeat(64), "c".repeat(64)])).rows[0].id;
  const application = (await client.query(
    `INSERT INTO partner_applications(inbound_request_id,partner_id,mailbox,path,profession,answers,consent_version,consent_text_sha256,consent_purpose,schema_version)
     VALUES($1,$2,$3,'referral','cpa','{"referralNetwork":"clients"}'::jsonb,'v1',$4,'review_my_application',1) RETURNING id`,
    [inbound, partner, `pp-evidence-${nonce}@example.test`, "a".repeat(64)])).rows[0].id;
  const approvedPartner = (await client.query(
    `INSERT INTO partners(company_name,contact_name,email,partner_type,status,commission_percent) VALUES('Evidence Introducer','Ivy',$1,'referral','active',20) RETURNING id`,
    [`pp-introducer-${nonce}@example.test`])).rows[0].id;
  const introduction = (await client.query(
    `INSERT INTO partner_introductions(partner_id,idempotency_key,request_fingerprint,business_name,contact_name,contact_email,permission_version,permission_text_sha256)
     VALUES($1,$2,$3,'Evidence Cafe','Cal','cal@example.test','v1',$4) RETURNING id`,
    [approvedPartner, crypto.randomUUID(), "e".repeat(64), "b".repeat(64)])).rows[0].id;
  const policy = (await client.query(
    `INSERT INTO partner_public_policy_versions(policy_key,version,share_percent,status,schedule_reference,copy_version,created_by)
     VALUES('standard_referral',1,25,'draft','SCH-EVIDENCE','v1','evidence-fixture') RETURNING id`)).rows[0].id;
  const event = (await client.query(
    `INSERT INTO partner_review_events(subject_type,subject_id,event_type,from_status,to_status,from_revision,to_revision,actor_id,note)
     VALUES('application',$1,'needs_info','pending_review','needs_info',1,2,'evidence-admin','Evidence note') RETURNING id`, [application])).rows[0].id;
  return { partner, inbound, application, approvedPartner, introduction, policy, event };
}

const evidenceTables: Array<[string, string]> = [["partner_applications", "id"], ["partner_introductions", "id"], ["partner_public_policy_versions", "id"], ["partner_review_events", "id"], ["inbound_requests", "id"]];

const baseDir = path.join(os.tmpdir(), `partner-base-${nonce}`);
try {
  await admin(async (client) => { await client.query(`CREATE DATABASE "${names.clean}"`); });

  // ── 1. Fresh install ──
  console.log("\n[1] Fresh install through the production harness");
  migrate(urlFor(names.clean));
  const cleanLedger = await withDb(names.clean, async (client) => {
    for (const table of NEW_TABLES) ok(await exists(client, table), `fresh install creates ${table}`);
    equal((await client.query(`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash=$1`, [hash0384])).rowCount, 1, "the ledger records the exact 0384 file hash once");
    equal((await client.query(`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash=$1`, [hash0385])).rowCount, 1, "the ledger records the exact 0385 file hash once");
    equal((await client.query(`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash=$1`, [hash0386])).rowCount, 1, "the ledger records the exact 0386 file hash once");
    await checksAreValidated(client, "fresh install");
    equal((await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='partner_introductions' AND column_name = ANY($1) ORDER BY column_name`, [COLUMNS_0385])).rows.map((r: any) => r.column_name),
      [...COLUMNS_0385].sort(), "fresh install adds every 0385 introduction column");
    for (const table of NEW_TABLES) equal(await count(client, table), 0, `${table} starts empty (nothing seeded, nothing approved)`);
    return ledger(client);
  });
  migrate(urlFor(names.clean));
  await withDb(names.clean, async (client) => { equal(await ledger(client), cleanLedger, "re-running the harness leaves the ledger unchanged"); });

  // ── 2. SQL-to-Drizzle parity and database-enforced rules ──
  console.log("\n[2] SQL-to-Drizzle parity and negative controls");
  await withDb(names.clean, parity);
  await withDb(names.clean, async (client) => {
    const evidence = await seedEvidence(client);
    const freshInbound = async () => (await client.query(
      `INSERT INTO inbound_requests(idempotency_key,occurrence_key,request_fingerprint,source_category,source_type,source_class,caller_scope,actor_type,manifest_version,manifest_hash)
       VALUES($1,$2,$3,'website_form','partner_application','public','public:cert','public','test',$4) RETURNING id`, [crypto.randomUUID(), crypto.randomUUID(), "f".repeat(64), "c".repeat(64)])).rows[0].id as string;
    const freshPartner = async (tag: string) => (await client.query(`INSERT INTO partners(company_name,email,status) VALUES($1,$2,'pending') RETURNING id`, [`neg ${tag}`, `pp-neg-${tag}-${nonce}@example.test`])).rows[0].id as number;
    type AppExtra = { path?: string; status?: string; marketing?: boolean; disclosure?: string | null; decided?: boolean };
    const insertApp = (mailbox: string, extra: AppExtra = {}) => (inbound: string, partner: number) => client.query(
      `INSERT INTO partner_applications(inbound_request_id,partner_id,mailbox,path,consent_version,consent_text_sha256,consent_purpose,schema_version,review_status,marketing_opt_in,marketing_disclosure_id,decided_by,decided_at)
       VALUES($1,$2,$3,$4,'v1',$5,'p',1,$6,$7,$8,$9,$10)`,
      [inbound, partner, mailbox, extra.path ?? "referral", "a".repeat(64), extra.status ?? "pending_review", extra.marketing ?? false, extra.disclosure ?? null, extra.decided ? "admin" : null, extra.decided ? new Date() : null]);
    const try1 = async (label: string, expected: string, build: (inbound: string, partner: number) => Promise<unknown>) => {
      const inbound = await freshInbound(); const partner = await freshPartner(label.replace(/\W/g, "").slice(0, 12));
      await client.query("BEGIN");
      let code = "";
      try { await build(inbound, partner); } catch (error: any) { code = error.code ?? "unknown"; }
      await client.query("ROLLBACK");
      equal(code, expected, label);
    };
    await try1("an unknown application path is rejected by the database", "23514", insertApp(`neg-a-${nonce}@example.test`, { path: "affiliate" }));
    await try1("an unknown review status is rejected by the database", "23514", insertApp(`neg-b-${nonce}@example.test`, { status: "approved" }));
    await try1("a mixed-case mailbox is rejected by the database", "23514", insertApp(`NEG-C-${nonce}@example.test`));
    await try1("marketing opt-in without a disclosure is rejected by the database", "23514", insertApp(`neg-d-${nonce}@example.test`, { marketing: true, disclosure: null }));
    await try1("a disclosure without a marketing opt-in is rejected by the database", "23514", insertApp(`neg-e-${nonce}@example.test`, { marketing: false, disclosure: "d1" }));
    await try1("a decided application without a decider is rejected by the database", "23514", insertApp(`neg-f-${nonce}@example.test`, { status: "accepted", decided: false }));
    await try1("a second open application for one mailbox is rejected (open-mailbox identity)", "23505", insertApp(`pp-evidence-${nonce}@example.test`));
    equal(await errCode(client, `INSERT INTO partner_applications(inbound_request_id,partner_id,mailbox,path,consent_version,consent_text_sha256,consent_purpose,schema_version) VALUES($1,$2,$3,'referral','v1','x','p',1)`, [evidence.inbound, evidence.partner, `neg-g-${nonce}@example.test`]), "23505", "a second application for one occurrence or one partner is rejected");
    equal(await errCode(client, `INSERT INTO partner_introductions(partner_id,idempotency_key,request_fingerprint,business_name,contact_name,permission_version,permission_text_sha256) VALUES($1,$2,'f','b','c','v','h')`, [evidence.approvedPartner, crypto.randomUUID()]), "23514", "an introduction with no email and no phone is rejected by the database");
    equal(await errCode(client, `INSERT INTO partner_introductions(partner_id,idempotency_key,request_fingerprint,business_name,contact_name,contact_email,permission_version,permission_text_sha256,review_state) VALUES($1,$2,'f','b','c','x@example.test','v','h','bogus')`, [evidence.approvedPartner, crypto.randomUUID()]), "23514", "an unknown introduction review state is rejected by the database");
    const intro = (await client.query(`SELECT idempotency_key FROM partner_introductions WHERE id=$1`, [evidence.introduction])).rows[0].idempotency_key;
    equal(await errCode(client, `INSERT INTO partner_introductions(partner_id,idempotency_key,request_fingerprint,business_name,contact_name,contact_email,permission_version,permission_text_sha256) VALUES($1,$2,'f','b','c','x@example.test','v','h')`, [evidence.approvedPartner, intro]), "23505", "the same partner and idempotency key cannot create a second introduction");
    equal(await errCode(client, `INSERT INTO partner_review_events(subject_type,subject_id,event_type,to_status,actor_id) VALUES('contact',$1,'x','y','a')`, [crypto.randomUUID()]), "23514", "a review event for an unknown subject type is rejected by the database");
    equal(await errCode(client, `INSERT INTO partner_review_events(subject_type,subject_id,event_type,to_status) VALUES('application',$1,'x','y')`, [crypto.randomUUID()]), "23502", "a review event with no actor is rejected by the database");
    equal(await errCode(client, `UPDATE partner_introductions SET completion_state='half' WHERE id=$1`, [evidence.introduction]), "23514", "an unknown completion state is rejected by the database");
    equal(await errCode(client, `UPDATE partner_introductions SET review_state='accepted' WHERE id=$1`, [evidence.introduction]), "23514", "an accepted introduction without a decider and time is rejected by the database");
    equal(await errCode(client, `UPDATE partner_introductions SET review_state='declined', decided_by='admin', decided_at=now() WHERE id=$1`, [evidence.introduction]), "", "a declined introduction with a decider and time is accepted");
    const policyInsert = `INSERT INTO partner_public_policy_versions(policy_key,version,share_percent,status,schedule_reference,copy_version,created_by,approved_by,approved_at) VALUES('standard_referral',$1,$2,$3,'SCH','v1','t',$4,$5)`;
    equal(await errCode(client, policyInsert, [2, 0, "draft", null, null]), "23514", "a referral share of 0 is rejected by the database");
    equal(await errCode(client, policyInsert, [3, 101, "draft", null, null]), "23514", "a referral share above 100 is rejected by the database");
    equal(await errCode(client, policyInsert, [4, 25, "approved", null, null]), "23514", "an approved policy without an approver is rejected by the database");
    equal(await errCode(client, policyInsert, [1, 25, "draft", null, null]), "23505", "a repeated policy version number is rejected");
    equal(await errCode(client, `INSERT INTO partner_public_policy_versions(policy_key,version,share_percent,status,schedule_reference,copy_version,created_by) VALUES('other_policy',1,25,'draft','SCH','v1','t')`), "23514", "an unknown policy key is rejected by the database");
    await client.query(policyInsert, [2, 25, "approved", "admin", new Date()]);
    equal(await errCode(client, policyInsert, [3, 30, "approved", "admin", new Date()]), "23505", "a second approved policy for the same key is rejected (one approved version at a time)");
  });

  // ── 3. Upgrade with historic rows (emulated 0383 head) ──
  console.log("\n[3] Upgrade with historic rows");
  await admin(async (client) => { await client.query(`CREATE DATABASE "${names.upgrade}" TEMPLATE "${names.clean}"`); });
  // The template carries the negative-control rows from section 2's rolled-back statements only; the one committed policy row is removed with the tables.
  const historic = await withDb(names.upgrade, async (client) => {
    await reverseTo0383(client);
    for (const table of NEW_TABLES) ok(!(await exists(client, table)), `prior head has no ${table}`);
    equal((await client.query(`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash IN ($1,$2,$3)`, [hash0384, hash0385, hash0386])).rowCount, 0, "prior head has no 0384, 0385 or 0386 ledger row");
    return seedLegacy(client);
  });
  const priorLedger = await withDb(names.upgrade, (client) => ledger(client));
  const beforeChecksums = await withDb(names.upgrade, (client) => checksums(client, LEGACY_TABLES));
  migrate(urlFor(names.upgrade));
  await withDb(names.upgrade, async (client) => {
    for (const table of NEW_TABLES) ok(await exists(client, table), `upgrade creates ${table}`);
    const after = await ledger(client);
    equal(after.slice(0, priorLedger.length), priorLedger, "every prior ledger row is retained unchanged");
    equal(after.length, priorLedger.length + 3, "exactly three ledger rows are added (0384, 0385 and 0386)");
    equal(after.slice(-3).map((r: any) => r.hash), [hash0384, hash0385, hash0386], "the added rows are the exact 0384, 0385 and 0386 hashes, in order");
    await checksAreValidated(client, "upgrade");
    equal(await checksums(client, LEGACY_TABLES), beforeChecksums, "partners, referrals, commission tiers, users and contacts are byte-identical before and after the upgrade");
    const rates = (await client.query(`SELECT id, commission_percent, status FROM partners WHERE id = ANY($1) ORDER BY id`, [historic.partners])).rows.map((r: any) => [r.commission_percent, r.status]);
    equal(rates, [[10, "active"], [50, "active"], [10, "pending"], [15, "inactive"]], "every historic partner keeps its exact commission percent and status (10, 50, 10, 15)");
    for (const table of NEW_TABLES) equal(await count(client, table), 0, `${table} is empty after upgrade (no application created, no policy approved)`);
    const legacy = await client.query(`INSERT INTO partners(company_name,email,status) VALUES('Legacy Writer',$1,'pending') RETURNING commission_percent`, [`pp-legacy-writer-${nonce}@example.test`]);
    equal(legacy.rows[0].commission_percent, 10, "a legacy raw-SQL partner insert still works and still receives the column default");
  });
  await withDb(names.upgrade, parity);

  // ── 3b. 0385 upgrade from a real 0384 head holding historic introductions ──
  console.log("\n[3b] 0385 upgrade from a 0384 head with historic introductions");
  await admin(async (client) => { await client.query(`CREATE DATABASE "${names.backfill}" TEMPLATE "${names.clean}"`); });
  const backfillIds = await withDb(names.backfill, async (client) => {
    await reverseTo0384(client);
    ok(await exists(client, "partner_introductions") && !(await exists(client, "partner_review_events")), "the 0384 head has the introduction table and no review-event table");
    equal((await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name='partner_introductions' AND column_name = ANY($1)`, [COLUMNS_0385])).rowCount, 0, "the 0384 head has none of the 0385 introduction columns");
    const partner = (await client.query(`INSERT INTO partners(company_name,email,status,total_referrals) VALUES('Backfill Introducer',$1,'active',7) RETURNING id`, [`pp-backfill-${nonce}@example.test`])).rows[0].id;
    const contact = async (tag: string) => (await client.query(`INSERT INTO contacts(first_name,last_name,email,phone,record_class) VALUES('Back','${tag}',$1,$2,'test') RETURNING id`,
      [`pp-backfill-${tag}-${nonce}@example.test`, `+1558${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`])).rows[0].id;
    const referral = async (contactId: number, tag: string) => (await client.query(`INSERT INTO referrals(partner_id,contact_id,referred_name,status) VALUES($1,$2,$3,'pending') RETURNING id`, [partner, contactId, `Backfill ${tag}`])).rows[0].id;
    const intro = async (tag: string, contactId: number | null, referralId: number | null, reviewState = "pending_review") => (await client.query(
      `INSERT INTO partner_introductions(partner_id,idempotency_key,request_fingerprint,business_name,contact_name,contact_email,permission_version,permission_text_sha256,contact_id,referral_id,review_state)
       VALUES($1,$2,'f','Backfill ' || $3,'Cal',$4,'v1',$5,$6,$7,$8) RETURNING id`,
      [partner, crypto.randomUUID(), tag, `pp-backfill-${tag}-${nonce}@example.test`, "b".repeat(64), contactId, referralId, reviewState])).rows[0].id as string;
    const cA = await contact("a"); const rA = await referral(cA, "a"); const a = await intro("a", cA, rA);
    await client.query(`INSERT INTO notifications(command_key,channel,title,message) VALUES($1,'in_app','Backfill notice','Backfill notice')`, [`partner-introduction:${a}:review`]);
    const cB = await contact("b"); const rB = await referral(cB, "b"); const b = await intro("b", cB, rB);
    const cC = await contact("c"); const c = await intro("c", cC, null, "duplicate_review");
    const d = await intro("d", null, null);
    return { partner, a, b, c, d };
  });
  const backfillLegacyBefore = await withDb(names.backfill, (client) => checksums(client, [["partners", "id"], ["referrals", "id"], ["contacts", "id"]]));
  migrate(urlFor(names.backfill));
  await withDb(names.backfill, async (client) => {
    const row = async (id: string) => (await client.query(
      `SELECT completion_state, revision, decided_by, contact_checkpoint_at IS NOT NULL AS contact_done, referral_checkpoint_at IS NOT NULL AS referral_done,
              count_checkpoint_at IS NOT NULL AS count_done, notification_checkpoint_at IS NOT NULL AS notification_done, completion_attempts
         FROM partner_introductions WHERE id=$1`, [id])).rows[0];
    equal(await row(backfillIds.a), { completion_state: "complete", revision: 1, decided_by: null, contact_done: true, referral_done: true, count_done: true, notification_done: true, completion_attempts: 0 }, "a historic introduction with contact, referral and notification is marked complete");
    equal(await row(backfillIds.b), { completion_state: "pending", revision: 1, decided_by: null, contact_done: true, referral_done: true, count_done: true, notification_done: false, completion_attempts: 0 }, "a historic introduction with no notification keeps only that step pending (recovery creates it)");
    equal(await row(backfillIds.c), { completion_state: "pending", revision: 1, decided_by: null, contact_done: true, referral_done: true, count_done: true, notification_done: false, completion_attempts: 0 }, "a historic held duplicate with a contact and no referral is not invented a referral; only its notification is pending");
    equal(await row(backfillIds.d), { completion_state: "pending", revision: 1, decided_by: null, contact_done: false, referral_done: false, count_done: false, notification_done: false, completion_attempts: 0 }, "a historic introduction with no contact stays fully pending and resumes from the first step");
    equal(await checksums(client, [["partners", "id"], ["referrals", "id"], ["contacts", "id"]]), backfillLegacyBefore, "the backfill changes no partner (including its referral total), referral or contact row");
    equal((await client.query(`SELECT total_referrals FROM partners WHERE id=$1`, [backfillIds.partner])).rows[0].total_referrals, 7, "the partner's referral total is exactly what it was (never incremented by a migration)");
    equal(await count(client, "partner_review_events"), 0, "no review event is invented for historic rows");
    equal((await client.query(`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash=$1`, [hash0385])).rowCount, 1, "the ledger records the exact 0385 hash once");
    equal((await client.query(`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash=$1`, [hash0386])).rowCount, 1, "the ledger records the exact 0386 hash once");
    await checksAreValidated(client, "0385 upgrade over historic introductions");
    const afterFirst = await checksums(client, [["partner_introductions", "id"]]);
    for (const part of [...statements(sql0385), ...statements(sql0386)]) await client.query(part);
    equal(await checksums(client, [["partner_introductions", "id"]]), afterFirst, "replaying the 0385 and 0386 SQL over the backfilled rows changes nothing");
    await checksAreValidated(client, "after replay");
  });
  await withDb(names.backfill, parity);

  // ── 4. Partial schema from an interrupted earlier attempt ──
  console.log("\n[4] Partial schema from an interrupted earlier attempt");
  await admin(async (client) => { await client.query(`CREATE DATABASE "${names.partial}" TEMPLATE "${names.clean}"`); });
  await withDb(names.partial, async (client) => {
    await reverseTo0383(client);
    const code = (part: string) => part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim();
    const wanted = statements(sql0384).filter((part) => /^CREATE TABLE IF NOT EXISTS partner_public_policy_versions\b/.test(code(part))
      || /^CREATE UNIQUE INDEX IF NOT EXISTS partner_public_policy_version_uidx\b/.test(code(part)));
    equal(wanted.length, 2, "the interrupted attempt is a strict subset: the policy table and one of its indexes");
    for (const part of wanted) await client.query(part);
    await client.query(`INSERT INTO partner_public_policy_versions(policy_key,version,share_percent,status,schedule_reference,copy_version,created_by) VALUES('standard_referral',7,25,'draft','SCH-PARTIAL','v1','partial-fixture')`);
    ok(await exists(client, "partner_public_policy_versions") && !(await exists(client, "partner_applications")), "partial state: one new table present, the rest absent");
    equal((await client.query(`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash IN ($1,$2,$3)`, [hash0384, hash0385, hash0386])).rowCount, 0, "partial state: no ledger row");
  });
  migrate(urlFor(names.partial));
  await withDb(names.partial, async (client) => {
    for (const table of NEW_TABLES) ok(await exists(client, table), `convergence creates or keeps ${table}`);
    equal((await client.query(`SELECT version,schedule_reference FROM partner_public_policy_versions`)).rows.map((r: any) => ({ ...r })), [{ version: 7, schedule_reference: "SCH-PARTIAL" }], "the retained row from the interrupted attempt survives");
    equal((await client.query(`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash=$1`, [hash0384])).rowCount, 1, "the ledger records 0384 once");
    equal((await client.query(`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash=$1`, [hash0385])).rowCount, 1, "the ledger records 0385 once");
    equal((await client.query(`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash=$1`, [hash0386])).rowCount, 1, "the ledger records 0386 once");
    await checksAreValidated(client, "partial-schema convergence");
  });
  await withDb(names.partial, parity);

  // ── 5. Replay with retained evidence ──
  console.log("\n[5] Replay with retained evidence");
  await admin(async (client) => { await client.query(`CREATE DATABASE "${names.rollback}" TEMPLATE "${names.upgrade}"`); });
  const evidence = await withDb(names.rollback, async (client) => {
    await client.query(`DELETE FROM partner_public_policy_versions`);
    await client.query(`DELETE FROM partner_review_events`);
    const seeded = await seedEvidence(client);
    const before = await checksums(client, evidenceTables, { inbound_requests: seeded.inbound });
    for (const part of [...statements(sql0384), ...statements(sql0385), ...statements(sql0386)]) await client.query(part);
    equal(await checksums(client, evidenceTables, { inbound_requests: seeded.inbound }), before, "replaying the 0384, 0385 and 0386 SQL against retained application, introduction, review-event and policy rows changes nothing");
    return seeded;
  });

  // ── 6. Rollback rehearsal: the previous build against the upgraded database ──
  console.log(`\n[6] Rollback rehearsal with the previous build (${BASE_COMMIT})`);
  fs.mkdirSync(baseDir, { recursive: true });
  const exported = spawnSync("bash", ["-c", `git archive ${BASE_COMMIT} | tar -x -C "${baseDir}"`], { encoding: "utf8" });
  if (exported.status !== 0) throw new Error(`could not export ${BASE_COMMIT}: ${exported.stderr}`);
  fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(baseDir, "node_modules"));
    const baseJournal = JSON.parse(fs.readFileSync(path.join(baseDir, "migrations/meta/_journal.json"), "utf8")).entries as Array<{ tag: string }>;
  ok(!baseJournal.some((entry) => entry.tag === TAG), "the previous build's journal does not contain 0384 (it truly is the older build)");
  const evidenceOnly = { inbound_requests: evidence.inbound };
  const evidenceBefore = await withDb(names.rollback, (client) => checksums(client, evidenceTables, evidenceOnly));
  const ledgerBefore = await withDb(names.rollback, (client) => ledger(client));
  const legacyBefore = await withDb(names.rollback, (client) => checksums(client, LEGACY_TABLES));
  migrate(urlFor(names.rollback), baseDir);
  await withDb(names.rollback, async (client) => {
    equal(await ledger(client), ledgerBefore, "the previous build's migration harness leaves the ledger (including 0384) untouched");
    for (const table of NEW_TABLES) ok(await exists(client, table), `${table} still exists after the previous build's harness ran`);
    equal(await checksums(client, evidenceTables, evidenceOnly), evidenceBefore, "application, consent, introduction and policy evidence is byte-identical after the previous build ran its migrations");
    equal(await checksums(client, LEGACY_TABLES), legacyBefore, "legacy partner and referral rows are byte-identical after the previous build ran its migrations");
  });
  // The previous build's own application route, run against the upgraded schema (this shows what a code rollback re-opens).
  const probe = path.join(baseDir, "rollback-probe.ts");
  fs.writeFileSync(probe, `
    import express from "express";
    const { registerPartnersRoutes } = await import("./server/routes/partners");
    const { pool } = await import("./server/db");
    const app = express(); app.set("trust proxy", "loopback"); app.use(express.json()); registerPartnersRoutes(app);
    const server = await new Promise<any>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const base = "http://127.0.0.1:" + server.address().port;
    const email = ${JSON.stringify(`pp-rollback-${nonce}@example.test`)};
    const response = await fetch(base + "/api/partner-apply", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID(), "x-forwarded-for": "10.7.7.7" },
      body: JSON.stringify({ firstName: "Roll", lastName: "Back", email, phone: "305-555-0177", companyName: "Rollback Co", numberOfClients: "5", referralType: "referral", password: "chosen-in-browser-1" }) });
    const row = (await pool.query("SELECT status, commission_percent, (password_hash IS NOT NULL) AS has_password FROM partners WHERE lower(email)=$1", [email])).rows[0] ?? null;
    console.log("ROLLBACK_PROBE " + JSON.stringify({ status: response.status, row }));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end(); process.exit(0);
  `);
  const probeResult = await new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn(process.execPath, [path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), probe], { cwd: baseDir, env: { ...process.env, DATABASE_URL: urlFor(names.rollback) } });
    let out = ""; child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
  const probeLine = probeResult.out.split("\n").find((line) => line.startsWith("ROLLBACK_PROBE "));
  ok(probeLine, `the previous build's application route ran against the upgraded database (${probeResult.out.slice(-300).replace(/\s+/g, " ")})`);
  const probed = JSON.parse(probeLine!.slice("ROLLBACK_PROBE ".length));
  console.log(`  ℹ previous build's legacy route result: ${JSON.stringify(probed)}`);
  ok([200, 201].includes(probed.status), "the previous build's own application route still answers (the rolled-back code works on the additive schema)");
  await withDb(names.rollback, async (client) => {
    equal(await checksums(client, evidenceTables, evidenceOnly), evidenceBefore, "evidence (application, consent, introduction, policy and its occurrence) is still byte-identical after the previous build handled a request");
    equal((await client.query(`SELECT count(*)::int n FROM partner_applications WHERE id=$1`, [evidence.application])).rows[0].n, 1, "the pending applicant and its consent record are still present");
    equal((await client.query(`SELECT count(*)::int n FROM partner_introductions WHERE id=$1`, [evidence.introduction])).rows[0].n, 1, "the partner introduction and its permission record are still present");
    // Rolling forward again: the current harness converges on the same state.
  });
  migrate(urlFor(names.rollback));
  await withDb(names.rollback, async (client) => {
    equal((await ledger(client)).length, ledgerBefore.length, "rolling forward again adds nothing to the ledger");
    ok((await count(client, "partner_applications")) === 1 && (await count(client, "partner_introductions")) === 1, "after rolling forward, the retained evidence is still there");
  });

  console.log(`\nPartner program migration certification: ${checks} checks passed`);
} finally {
  fs.rmSync(baseDir, { recursive: true, force: true });
  for (const name of Object.values(names)) await dropDb(name).catch(() => undefined);
}
