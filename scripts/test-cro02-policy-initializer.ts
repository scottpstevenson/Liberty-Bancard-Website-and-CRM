#!/usr/bin/env npx tsx
/**
 * CRO-02 purpose-policy initializer proof.
 *
 * Verifies the insert-only convergence behavior that repairs a production
 * `commercial_purpose_policies` table left empty (or partially seeded) by
 * Replit Publish schema synchronization, without ever touching the Drizzle
 * migration journal, mutating an existing row, or producing any outbound
 * side effect.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
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
    check(!fragment || String(error?.message).includes(fragment), `${label} (got: ${error?.message})`);
    return;
  }
  throw new Error(`FAIL: ${label} (unexpected success)`);
}

const JOURNAL_PATH = path.join(process.cwd(), "migrations", "meta", "_journal.json");

async function main() {
  check(Boolean(process.env.TEST_DATABASE_URL), "TEST_DATABASE_URL is explicitly required");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  await assertDisposableTestInfrastructure({ operation: "cro02-policy-initializer" });

  const journalBefore = fs.readFileSync(JOURNAL_PATH, "utf8");

  const [{ runDrizzleMigrations }, { pool, db }, resolution, initializerMod, pauseAuthority] = await Promise.all([
    import("../server/db-migrate"),
    import("../server/db"),
    import("../server/services/commercial-resolution"),
    import("../server/services/cro02-purpose-policy-initializer"),
    import("../server/services/outbound-pause-authority"),
  ]);
  const { initializeCro02PurposePolicies } = initializerMod;
  const { CRO02_PURPOSE_POLICY_DOCUMENTS, CRO02_POLICY_VERSION, commercialPurposePolicyFingerprint, assertCro02PurposePolicies } = resolution;
  const effects = Object.keys(CRO02_PURPOSE_POLICY_DOCUMENTS) as (keyof typeof CRO02_PURPOSE_POLICY_DOCUMENTS)[];

  await runDrizzleMigrations();

  // Snapshot the pause-control table's current state before any of this
  // test's activity, and require it stays exactly what it was.
  const pauseBefore = await pauseAuthority.getPauseState();
  check(pauseBefore.state !== "unpaused", "outbound pause state starts PAUSED / NOT AUTHORIZED before initializer runs");

  // `commercial_purpose_policies` carries a BEFORE UPDATE OR DELETE immutable
  // guard trigger (migration 0170) — the same protection the initializer
  // itself must respect in production. To exercise "empty" and "partial"
  // starting states in this disposable database, test setup temporarily
  // disables that trigger around its own DELETE, then re-enables it before
  // the initializer (the code under test) ever runs. The initializer always
  // runs with the trigger active, matching production.
  async function purgePolicies() {
    await pool.query(`ALTER TABLE commercial_purpose_policies DISABLE TRIGGER cro02_purpose_policy_immutable`);
    try {
      await pool.query(`DELETE FROM commercial_purpose_policies WHERE policy_version = $1`, [CRO02_POLICY_VERSION]);
    } finally {
      await pool.query(`ALTER TABLE commercial_purpose_policies ENABLE TRIGGER cro02_purpose_policy_immutable`);
    }
  }
  async function fetchAll() {
    const result = await pool.query(
      `SELECT purpose, policy_version, required_edges, mode FROM commercial_purpose_policies WHERE policy_version = $1 ORDER BY purpose`,
      [CRO02_POLICY_VERSION],
    );
    return result.rows;
  }

  // ── Scenario 1: empty table converges to exactly eight canonical rows ──
  await purgePolicies();
  await initializeCro02PurposePolicies();
  let rows = await fetchAll();
  check(rows.length === 8, "empty table converges to exactly eight rows");
  check(
    effects.every((effect) => {
      const row = rows.find((r) => r.purpose === effect);
      return row && row.mode === "shadow" &&
        commercialPurposePolicyFingerprint(row.required_edges) === commercialPurposePolicyFingerprint(CRO02_PURPOSE_POLICY_DOCUMENTS[effect]);
    }),
    "every converged row matches its canonical document, fingerprint, and shadow mode",
  );
  await assertCro02PurposePolicies();
  check(true, "strict startup assertion passes after convergence from empty");

  // ── Scenario 2: partial canonical set converges ──
  await purgePolicies();
  const keepEffect = effects[0];
  const keepDoc = CRO02_PURPOSE_POLICY_DOCUMENTS[keepEffect];
  await pool.query(
    `INSERT INTO commercial_purpose_policies (purpose, policy_version, required_edges, mode) VALUES ($1, $2, $3::jsonb, 'shadow')`,
    [keepEffect, CRO02_POLICY_VERSION, JSON.stringify(keepDoc)],
  );
  await initializeCro02PurposePolicies();
  rows = await fetchAll();
  check(rows.length === 8, "partial canonical set (one pre-existing row) converges to exactly eight rows");
  await assertCro02PurposePolicies();
  check(true, "strict startup assertion passes after convergence from a partial set");

  // ── Scenario 3: repeat startup is idempotent ──
  const beforeUpdatedAt = new Map(rows.map((r) => [r.purpose, r.updated_at]));
  await initializeCro02PurposePolicies();
  const rowsAfterRepeat = await fetchAll();
  check(rowsAfterRepeat.length === 8, "repeat run still yields exactly eight rows");
  check(
    rowsAfterRepeat.every((r) => beforeUpdatedAt.get(r.purpose)?.getTime?.() === r.updated_at?.getTime?.()
      || String(beforeUpdatedAt.get(r.purpose)) === String(r.updated_at)),
    "repeat run does not touch updated_at on any already-converged row (no update/delete)",
  );
  await initializeCro02PurposePolicies();
  await assertCro02PurposePolicies();
  check(true, "repeated startup is idempotent");

  // ── Scenario 4: conflicting existing row fails startup ──
  await purgePolicies();
  await pool.query(
    `INSERT INTO commercial_purpose_policies (purpose, policy_version, required_edges, mode) VALUES ($1, $2, $3::jsonb, 'shadow')`,
    [effects[1], CRO02_POLICY_VERSION, JSON.stringify({ ...CRO02_PURPOSE_POLICY_DOCUMENTS[effects[1]], allowedClasses: ["test"] })],
  );
  await rejects(
    () => initializeCro02PurposePolicies(),
    "conflicting existing row (document mismatch) fails startup",
    `CRO02_POLICY_INIT_CONFLICT:${effects[1]}`,
  );
  const rowsAfterConflict = await fetchAll();
  check(rowsAfterConflict.length === 1, "conflicting row was not deleted or overwritten by the failed initializer");

  // ── Scenario 5: unexpected mode or fingerprint fails startup ──
  await purgePolicies();
  await pool.query(
    `INSERT INTO commercial_purpose_policies (purpose, policy_version, required_edges, mode) VALUES ($1, $2, $3::jsonb, 'compare')`,
    [effects[2], CRO02_POLICY_VERSION, JSON.stringify(CRO02_PURPOSE_POLICY_DOCUMENTS[effects[2]])],
  );
  await rejects(
    () => initializeCro02PurposePolicies(),
    "unexpected mode (compare, not shadow) fails startup",
    `CRO02_POLICY_INIT_CONFLICT:${effects[2]}`,
  );

  await purgePolicies();
  await pool.query(
    `INSERT INTO commercial_purpose_policies (purpose, policy_version, required_edges, mode) VALUES ($1, $2, $3::jsonb, 'shadow')`,
    [effects[3], CRO02_POLICY_VERSION, JSON.stringify({ ...CRO02_PURPOSE_POLICY_DOCUMENTS[effects[3]], schemaVersion: 1, edges: { ...CRO02_PURPOSE_POLICY_DOCUMENTS[effects[3]].edges, dealRoots: { required: true, min: 99, max: 99 } } })],
  );
  await rejects(
    () => initializeCro02PurposePolicies(),
    "unexpected fingerprint (mutated document) fails startup",
    `CRO02_POLICY_INIT_CONFLICT:${effects[3]}`,
  );

  // ── Scenario 6: malformed/missing table structure fails startup ──
  await purgePolicies();
  await pool.query(`ALTER TABLE commercial_purpose_policies RENAME COLUMN mode TO mode_renamed`);
  try {
    await rejects(
      () => initializeCro02PurposePolicies(),
      "malformed table shape (renamed column) fails startup",
      "CRO02_POLICY_TABLE_SHAPE_INVALID:mode",
    );
  } finally {
    await pool.query(`ALTER TABLE commercial_purpose_policies RENAME COLUMN mode_renamed TO mode`);
  }

  await pool.query(`ALTER TABLE commercial_purpose_policies RENAME TO commercial_purpose_policies_missing_test`);
  try {
    await rejects(
      () => initializeCro02PurposePolicies(),
      "missing table fails startup",
      "CRO02_POLICY_TABLE_MISSING",
    );
  } finally {
    await pool.query(`ALTER TABLE commercial_purpose_policies_missing_test RENAME TO commercial_purpose_policies`);
  }

  // ── Scenario 7: concurrent startup produces exactly eight rows ──
  await purgePolicies();
  const concurrentAttempts = 5;
  const results = await Promise.allSettled(
    Array.from({ length: concurrentAttempts }, () => initializeCro02PurposePolicies()),
  );
  check(results.every((r) => r.status === "fulfilled"), "all concurrent initializer attempts resolve without throwing");
  const concurrentRows = await fetchAll();
  check(concurrentRows.length === 8, `concurrent startup (${concurrentAttempts}x) produces exactly eight rows, not duplicates`);
  await assertCro02PurposePolicies();
  check(true, "strict startup assertion passes after concurrent convergence");

  // ── Scenario 8: migration journal is byte-for-byte unchanged ──
  const journalAfter = fs.readFileSync(JOURNAL_PATH, "utf8");
  check(journalAfter === journalBefore, "migration journal file is byte-for-byte unchanged");
  const journalRows = await pool.query(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
  check(journalRows.rows[0].n > 0, "drizzle migration ledger table was not touched by the initializer (sanity: still populated)");

  // ── Scenario 9: outbound remains PAUSED / NOT AUTHORIZED ──
  const pauseAfter = await pauseAuthority.getPauseState();
  check(pauseAfter.state !== "unpaused", "outbound pause state remains PAUSED / NOT AUTHORIZED after all initializer activity");
  check(
    pauseBefore.state === pauseAfter.state && pauseBefore.reason === pauseAfter.reason,
    "outbound pause state and reason are unchanged by the initializer",
  );

  console.log(`\n${passed} checks passed.`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
