#!/usr/bin/env tsx
/**
 * CR-06 migration proof on two newly-created disposable PostgreSQL databases.
 * The upgrade database is genuinely materialized at the 0184 journal boundary:
 * canonical snapshot + the real journal SQL through 0184 are applied and
 * journaled before the production migrator is allowed to upgrade it.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const sourceUrl = process.env.TEST_DATABASE_URL;
if (!sourceUrl || sourceUrl !== process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must equal DATABASE_URL and identify the disposable test cluster.");
}
const source = new URL(sourceUrl);
const root = new URL(sourceUrl);
root.pathname = "/postgres";
const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const names = [`cr06_clean_${nonce}`, `cr06_prior0184_${nonce}`];
if (/(prod|production|live)/i.test(source.pathname)) throw new Error("Refusing non-disposable database name.");
const migrations = path.join(process.cwd(), "migrations");
const journal = JSON.parse(fs.readFileSync(path.join(migrations, "meta/_journal.json"), "utf8")) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};
function urlFor(name: string) { const value = new URL(sourceUrl); value.pathname = `/${name}`; return value.toString(); }
function sql(tag: string) { return fs.readFileSync(path.join(migrations, `${tag}.sql`), "utf8"); }
function hash(tag: string) { return crypto.createHash("sha256").update(sql(tag)).digest("hex"); }

async function create(name: string) {
  const client = new Client({ connectionString: root.toString() });
  await client.connect();
  try { await client.query(`CREATE DATABASE "${name}"`); } finally { await client.end(); }
}
async function drop(name: string) {
  const client = new Client({ connectionString: root.toString() });
  await client.connect();
  try {
    await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [name]);
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
  } finally { await client.end(); }
}
async function migrateWithProductionHarness(databaseUrl: string) {
  // A child process is intentional: server/db has a module-level pool, so each
  // temporary database needs an independently constructed production harness.
  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "server/db-migrate.ts"],
    { env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8", timeout: 150_000 },
  );
  if (result.status !== 0) {
    throw new Error(`production migration harness failed: ${(result.stderr || result.stdout).slice(-2000)}`);
  }
}

try {
  await Promise.all(names.map(create));
  await migrateWithProductionHarness(urlFor(names[0]));
  let client = new Client({ connectionString: urlFor(names[0]) });
  await client.connect();
  try {
    const found = await client.query("SELECT to_regclass('public.cr06_feedback_receipts') AS receipts, to_regclass('public.cr06_preparation_reservations') AS reservations");
    assert.ok(found.rows[0].receipts && found.rows[0].reservations, "clean-zero harness migration must install CR-06 tables");
  } finally { await client.end(); }

  client = new Client({ connectionString: urlFor(names[1]) });
  await client.connect();
  try {
    await client.query(sql("0109_fearless_starhawk"));
    await client.query(sql("0076_outbound_launch_foundation"));
    await client.query(sql("0106_deferred_ghl_enrollments"));
    await client.query('CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)');
    for (const entry of journal.entries.filter((entry) => entry.idx >= 110 && entry.idx <= 188)) {
      await client.query(sql(entry.tag));
    }
    for (const entry of journal.entries.filter((entry) => entry.idx <= 188)) {
      const file = path.join(migrations, `${entry.tag}.sql`);
      if (fs.existsSync(file)) await client.query("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES($1,$2)", [hash(entry.tag), entry.when]);
    }
    const legacyRunId = "00000000-0000-4000-8000-000000000186";
    await client.query("SET session_replication_role='replica'");
    await client.query(
      `INSERT INTO cr06_preparation_runs
        (id,idempotency_key,program_artifact_id,approval_id,cohort_run_id,dependency_fingerprint,
         state,requested_count,created_by)
       VALUES ($1,'cr06-0184-upgrade-fixture','00000000-0000-4000-8000-000000000001',
         '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',
         $2,'failed',1,'migration-certification')`,
      [legacyRunId, "a".repeat(64)],
    );
    await client.query(
      `INSERT INTO cr06_preparation_reservations
        (preparation_run_id,reservation_key,reserved_members,send_capacity_units,dependency_snapshot)
       VALUES ($1,'cr06-0184-retained-reservation',1,0,'{"version":1}'::jsonb)`,
      [legacyRunId],
    );
    await client.query(
      `INSERT INTO cr06_rollout_manifests
        (manifest_version,manifest_hash,status,program_count,sequence_count,content_count,
         manual_task_count,document,actor_id,receipt,applied_at)
       VALUES ('liberty-premium-pilots-v1',$1,'verified',3,3,12,3,
         '{"manifestVersion":"liberty-premium-pilots-v1","fixture":"prior-head"}'::jsonb,
         'migration-certification','{"verified":true}'::jsonb,NOW())`,
      ["b".repeat(64)],
    );
    const v1Kinds = [
      ...Array(3).fill("program"),
      ...Array(3).fill("sequence_version"),
      ...Array(12).fill("content_version"),
      ...Array(3).fill("manual_task_definition"),
    ];
    for (const [ordinal, kind] of v1Kinds.entries()) {
      await client.query(
        `INSERT INTO cr06_artifacts
          (identity_key,artifact_kind,record_class,purpose,governance_state,compatibility_state,
           preparation_state,version,document,content_hash,created_by,reviewed_by,approved_at)
         VALUES ($1,$2,'production','cold_marketing','approved_inactive','governed',
           'not_prepared',1,$3::jsonb,$4,'migration-certification','migration-certification',NOW())`,
        [`prior-v1-${kind}-${ordinal}`, kind,
          JSON.stringify({ fixture: "prior-v1", ordinal, kind }), crypto.createHash("sha256").update(`${kind}:${ordinal}`).digest("hex")],
      );
    }
    await client.query("SET session_replication_role='origin'");
    const before = await client.query("SELECT to_regclass('public.cr06_campaign_gate_revisions') AS gate_revisions");
    assert.equal(before.rows[0].gate_revisions, null, "0184 prior head must not already contain 0185 gate revisions");
  } finally { await client.end(); }
  await migrateWithProductionHarness(urlFor(names[1]));
  client = new Client({ connectionString: urlFor(names[1]) });
  await client.connect();
  try {
    const after = await client.query("SELECT to_regclass('public.cr06_campaign_gate_revisions') AS gate_revisions, to_regclass('public.cr06_preparation_reservations') AS reservations");
    assert.ok(after.rows[0].gate_revisions && after.rows[0].reservations, "production harness upgrades genuine 0184 head through CR-06 corrections");
    const retained = await client.query(
      `SELECT reservation_key,scope_type,scope_identity,reserved_member_cap,effective_cap,
              send_capacity_units,state,receipt,receipt_hash,expires_at
         FROM cr06_preparation_reservations
        WHERE reservation_key='cr06-0184-retained-reservation'`,
    );
    assert.equal(retained.rowCount, 1, "0184 reservation history must survive the 0186 upgrade");
    assert.equal(retained.rows[0].scope_type, "legacy");
    assert.equal(retained.rows[0].scope_identity, "cr06-0184-retained-reservation");
    assert.equal(retained.rows[0].reserved_member_cap, 1);
    assert.equal(retained.rows[0].effective_cap, 0);
    assert.equal(retained.rows[0].send_capacity_units, 0);
    assert.equal(retained.rows[0].state, "superseded");
    assert.ok(retained.rows[0].receipt && retained.rows[0].receipt_hash && retained.rows[0].expires_at,
      "0186 must backfill complete immutable legacy reservation evidence");
    const retainedV1 = await client.query(
      `SELECT
         (SELECT count(*)::int FROM cr06_rollout_manifests
           WHERE manifest_version='liberty-premium-pilots-v1' AND status='verified'
             AND manifest_hash=$1) AS manifests,
         (SELECT count(*)::int FROM cr06_artifacts
           WHERE version=1 AND identity_key LIKE 'prior-v1-%') AS artifacts`,
      ["b".repeat(64)],
    );
    assert.deepEqual(retainedV1.rows[0], { manifests: 1, artifacts: 21 },
      "verified v1 manifest and all v1 artifact history survive the 0184-to-current migration");
  } finally { await client.end(); }
  console.log("CR-06 clean-zero and genuine prior-head-0184 reservation migration proof passed.");
} finally {
  process.env.DATABASE_URL = sourceUrl;
  await Promise.all(names.map(drop));
}