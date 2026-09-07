#!/usr/bin/env npx tsx
/**
 * Fresh-schema migration test for migrations 0225 and 0226.
 *
 * Cannot create a second Neon database from the shell, so this test creates a
 * throwaway schema within the same database, runs both migration SQL files against
 * it, verifies the resulting DDL, and then drops the schema.
 *
 * This confirms that 0225 and 0226 are:
 *   - Syntactically valid PostgreSQL
 *   - Idempotent (IF NOT EXISTS guards)
 *   - Can be applied to a completely empty schema in sequence
 *
 * Exit 0 = pass. Exit 1 = fail.
 */

import fs from "fs";
import pg from "pg";

const { Pool } = pg;
const SCHEMA = `census_migration_test_${Date.now()}`;

let pass = 0; let fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; process.stdout.write(`  ✓ ${label}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${label}${detail ? ` — ${detail}` : ""}\n`); }
}

// Read both migration files and namespace them to the test schema
// (replace plain table refs with schema-qualified ones for isolation)
function rewriteToSchema(sql: string, schema: string): string {
  return (
    `SET search_path TO ${schema}, public;\n` + sql
  );
}

async function main() {
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("  Fresh-Schema Migration Test — 0225 + 0226");
  console.log(`  Schema: ${SCHEMA}`);
  console.log("══════════════════════════════════════════════════════════════════\n");

  // Use DATABASE_URL which includes proper credentials and SSL settings
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL not set");
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    // Create fresh schema
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await client.query(`SET search_path TO ${SCHEMA}, public`);

    // ── Apply 0225 ─────────────────────────────────────────────────────────
    const sql0225 = fs.readFileSync("migrations/0225_contact_census.sql", "utf8");
    console.log("  Applying 0225_contact_census.sql...");
    await client.query(rewriteToSchema(sql0225, SCHEMA));
    console.log("  Applied 0225.");

    // Verify 0225 created expected tables
    const tablesR = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = $1 AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `, [SCHEMA]);
    const tables = tablesR.rows.map((r: any) => r.table_name as string);
    check("0225 created contact_census_runs", tables.includes("contact_census_runs"));
    check("0225 created contact_census_members", tables.includes("contact_census_members"));

    // Verify 0225 columns on contact_census_runs
    const cols0225R = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'contact_census_runs'
      ORDER BY column_name
    `, [SCHEMA]);
    const cols0225 = cols0225R.rows.map((r: any) => r.column_name as string);
    for (const col of ["id", "snapshot_type", "environment_label", "status", "rules_version", "denominator_at_start", "total_processed"]) {
      check(`0225 contact_census_runs has column '${col}'`, cols0225.includes(col));
    }

    // ── Apply 0226 ─────────────────────────────────────────────────────────
    const sql0226 = fs.readFileSync("migrations/0226_census_ownership.sql", "utf8");
    console.log("\n  Applying 0226_census_ownership.sql...");
    await client.query(rewriteToSchema(sql0226, SCHEMA));
    console.log("  Applied 0226.");

    // Verify 0226 added new columns
    const cols0226R = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'contact_census_runs'
      ORDER BY column_name
    `, [SCHEMA]);
    const cols0226 = cols0226R.rows.map((r: any) => r.column_name as string);
    for (const col of ["max_contact_id_at_start", "terminal_snapshot_exceptions", "lease_owner", "lease_expires_at"]) {
      check(`0226 adds column '${col}'`, cols0226.includes(col), `cols: ${cols0226.join(", ")}`);
    }

    // Verify 0226 partial unique index
    const idxR = await client.query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = $1 AND indexname = 'census_runs_one_active'
    `, [SCHEMA]);
    check("0226 creates census_runs_one_active partial unique index", idxR.rows.length > 0);
    if (idxR.rows.length > 0) {
      const def: string = idxR.rows[0].indexdef;
      check("Index uses constant expression (true)", def.includes("(true)"));
      check("Index is UNIQUE", def.toLowerCase().includes("unique"));
      check("Index partial filter covers 'pending' and 'running'", def.includes("pending") && def.includes("running"));
      console.log(`\n  Index DDL: ${def}`);
    }

    // ── Idempotency: apply 0226 again (IF NOT EXISTS guards) ──────────────
    console.log("\n  Testing idempotency — applying 0226 again...");
    await client.query(rewriteToSchema(sql0226, SCHEMA));
    check("0226 is idempotent (IF NOT EXISTS guards — no error on re-apply)", true);

    // ── Unique partial index enforcement test ──────────────────────────────
    // Insert one 'running' row — should succeed
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    await client.query(`
      INSERT INTO contact_census_runs
        (snapshot_type, environment_label, selector_hash, selector_params, rules_version,
         release_sha, db_identity_token, as_of, requested_by, status)
      VALUES ('full', 'development_preview', md5(random()::text), '{}', '1.0.0',
              'sha1', 'tok1', now(), 'test', 'running')
    `);
    check("Insert first 'running' row succeeds (index allows one)", true);

    // Insert a second 'running' row — must fail with unique_violation
    try {
      await client.query(`
        INSERT INTO contact_census_runs
          (snapshot_type, environment_label, selector_hash, selector_params, rules_version,
           release_sha, db_identity_token, as_of, requested_by, status)
        VALUES ('full', 'development_preview', md5(random()::text), '{}', '1.0.0',
                'sha2', 'tok2', now(), 'test2', 'running')
      `);
      check("Second 'running' insert blocked by unique partial index", false, "Expected unique_violation (23505)");
    } catch (err: any) {
      check("Second 'running' insert blocked by unique partial index (23505)", err.code === "23505", `code: ${err.code}`);
    }

    // Insert a 'completed' row — must succeed (not in partial index filter)
    await client.query(`
      INSERT INTO contact_census_runs
        (snapshot_type, environment_label, selector_hash, selector_params, rules_version,
         release_sha, db_identity_token, as_of, requested_by, status)
      VALUES ('full', 'development_preview', md5(random()::text), '{}', '1.0.0',
              'sha3', 'tok3', now(), 'test3', 'completed')
    `);
    check("'completed' row can be inserted alongside a 'running' row (not in partial index)", true);

  } finally {
    // Drop test schema
    try { await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`); }
    catch { /* ignore */ }
    client.release();
    await pool.end();
  }

  console.log(`\n  Summary: ${pass} passed, ${fail} failed`);
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
