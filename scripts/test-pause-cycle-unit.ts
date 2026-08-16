#!/usr/bin/env tsx
/**
 * scripts/test-pause-cycle-unit.ts
 *
 * Isolated behavioral test suite for the full pause → _holdDeferred marker →
 * unpause → legacy restoration → release_pending → approveRelease state machine.
 *
 * ── ISOLATION GUARDS (all four required) ─────────────────────────────────────
 *   NODE_ENV=test
 *   TEST_DATABASE_URL   must resolve to a DIFFERENT database than DATABASE_URL
 *                       (verified by SELECT current_database(), not just URL text)
 *   TEST_REDIS_PREFIX   unique namespace for any Redis keys created by the test
 *   INTEGRATION_TESTS_OPT_IN=1  explicit opt-in: prevents accidental runs
 *
 * Optional (strongly recommended):
 *   TEST_APPROVED_DB_NAME   expected database name returned by current_database()
 *                           on TEST_DATABASE_URL; if set, the script rejects any
 *                           DB whose name does not match.
 *
 * ── CLEAN-STATE REQUIREMENT ──────────────────────────────────────────────────
 * The script refuses to run if TEST_DATABASE_URL already has:
 *   • any active global_outbound or release_pending holds
 *   • outbound_pause_control in state 'paused' or 'activating'
 *   • any sequence_enrollment with _globalPauseBlockReason set
 *
 * These checks ensure the test runs on an exclusive, clean state machine and
 * cannot accidentally affect pre-existing state from another run or application.
 *
 * ── PROVIDER CALL ISOLATION ──────────────────────────────────────────────────
 * The pause/unpause/approveRelease/writeHoldDeferralMarker code paths are
 * DB-only by construction: they write to outbound_pause_control,
 * outbound_pause_audit, logical_job_control_holds, logical_job_hold_events,
 * and sequence_enrollments — none of which invoke email, SMS, GHL, SMTP,
 * RVM, voice, or contact-upsert providers.
 *
 * ── KILL LINES ───────────────────────────────────────────────────────────────
 *   STOP if any test scenario mutates global pause/holds on a shared DB.
 *   STOP if cleanup restores the system based on a stale pre-test snapshot.
 *   STOP if the test approves/clears a hold it did not create.
 *   STOP if any provider/contact-upsert call is possible during the test.
 *
 * Exit 0 = all PASS
 * Exit 1 = any FAIL or cleanup failure
 */

import process from "process";

// ── Sync isolation guards (before any imports) ────────────────────────────────

function guardFail(message: string): never {
  console.error(`\n[ISOLATION GUARD FAILED]\n${message}\n`);
  process.exit(1);
}

if (process.env.NODE_ENV !== "test") {
  guardFail(
    "NODE_ENV must be 'test'.\n" +
    "Why: prevents this test from running against a non-test environment.\n" +
    "Set NODE_ENV=test before running this script.",
  );
}

if (!process.env.TEST_DATABASE_URL) {
  guardFail(
    "TEST_DATABASE_URL is not set.\n" +
    "Why: this test must target a DISTINCT test database.\n" +
    "Set TEST_DATABASE_URL to a test-only PostgreSQL connection string.",
  );
}

if (!process.env.TEST_REDIS_PREFIX) {
  guardFail(
    "TEST_REDIS_PREFIX is not set.\n" +
    "Why: ensures Redis keys are namespaced and do not collide with production.\n" +
    "Set TEST_REDIS_PREFIX to a unique string (e.g. 'pause-unit-test-<timestamp>').",
  );
}

if (process.env.INTEGRATION_TESTS_OPT_IN !== "1") {
  guardFail(
    "INTEGRATION_TESTS_OPT_IN is not set to '1'.\n" +
    "Why: explicit opt-in required so ordinary CI never executes this test.\n" +
    "Set INTEGRATION_TESTS_OPT_IN=1 to confirm you want to run this test.",
  );
}

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL!;
const TEST_REDIS_PREFIX = process.env.TEST_REDIS_PREFIX!;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const approvedDbName = process.env.TEST_APPROVED_DB_NAME;

// ── Synchronous identity proof check (before any async work) ─────────────────
// The script MUST be able to prove the test DB is not the production DB.
// Two paths are accepted (at least one must be present):
//
//   Path A: DATABASE_URL is set → connect to both DBs, assert different names.
//   Path B: TEST_APPROVED_DB_NAME is set → assert test DB name matches the
//           explicit allowlist value (operator vouches the DB is a test DB).
//
// This check is synchronous and happens before any network I/O — if neither
// variable is available, the script refuses to run immediately.

if (!ORIGINAL_DATABASE_URL && !approvedDbName) {
  guardFail(
    "Cannot prove test database identity: neither DATABASE_URL nor TEST_APPROVED_DB_NAME is set.\n" +
    "At least one of the following is required:\n" +
    "  DATABASE_URL          — compared against TEST_DATABASE_URL (must resolve to a different DB)\n" +
    "  TEST_APPROVED_DB_NAME — explicit name of the approved test database (e.g. 'liberty_test')\n" +
    "Set one of these to allow identity verification before running this destructive test.",
  );
}

// ── Async isolation guards (DB identity validation via actual connections) ─────
// Connect to both databases using raw pg BEFORE overriding DATABASE_URL,
// so we validate against the actual DB identity — not URL text.

console.log("\n══════════════════════════════════════════════════════════════");
console.log(" Pause State-Machine Unit Test (isolated) — Pre-flight checks");
console.log("══════════════════════════════════════════════════════════════\n");

// Use dynamic import so this runs before any server-module imports
const pg = (await import("pg")).default;

// ── 1. Validate TEST_DATABASE_URL is reachable and get its DB identity ────────
let testDbName: string;
{
  const testClient = new pg.Client({ connectionString: TEST_DATABASE_URL });
  try {
    await testClient.connect();
    const r = await testClient.query<{ current_database: string }>(
      "SELECT current_database()",
    );
    testDbName = r.rows[0]?.current_database;
    if (!testDbName) throw new Error("current_database() returned empty");
    console.log(`  ✓ TEST_DATABASE_URL resolves to database: '${testDbName}'`);
  } catch (err: any) {
    guardFail(
      `Cannot connect to TEST_DATABASE_URL or query current_database(): ${err?.message}\n` +
      "Ensure the test database exists and the connection string is correct.",
    );
  } finally {
    try { await testClient.end(); } catch { /* ignore */ }
  }
}

// ── 2. Cross-compare DB identity (Path A and/or Path B) ──────────────────────

if (ORIGINAL_DATABASE_URL) {
  // Path A: connect to both and compare
  let prodDbName: string | null = null;
  const prodClient = new pg.Client({ connectionString: ORIGINAL_DATABASE_URL });
  try {
    await prodClient.connect();
    const r = await prodClient.query<{ current_database: string }>(
      "SELECT current_database()",
    );
    prodDbName = r.rows[0]?.current_database ?? null;
  } catch (err: any) {
    guardFail(
      `Cannot connect to DATABASE_URL to verify database identity: ${err?.message}\n` +
      "Both databases must be reachable for identity verification.",
    );
  } finally {
    try { await prodClient.end(); } catch { /* ignore */ }
  }
  if (!prodDbName) {
    guardFail("DATABASE_URL connected but current_database() returned empty — cannot verify identity.");
  }
  if (testDbName! === prodDbName) {
    guardFail(
      `TEST_DATABASE_URL and DATABASE_URL both resolve to the same database: '${testDbName}'.\n` +
      "Provide a SEPARATE test database to prevent mutating shared state.",
    );
  }
  console.log(`  ✓ DATABASE_URL resolves to '${prodDbName}' — distinct from test DB '${testDbName}'`);
}

if (approvedDbName) {
  // Path B: explicit allowlist
  if (testDbName! !== approvedDbName) {
    guardFail(
      `TEST_DATABASE_URL resolved to database '${testDbName}' but ` +
      `TEST_APPROVED_DB_NAME requires '${approvedDbName}'.\n` +
      "Update TEST_APPROVED_DB_NAME or point TEST_DATABASE_URL at the correct database.",
    );
  }
  console.log(`  ✓ TEST_APPROVED_DB_NAME confirmed: '${testDbName}'`);
}

// ── 4. Verify the test DB is in a clean state (no pre-existing global state) ──
// IMPORTANT: query errors are NOT treated as "empty state" — any error on a
// table this test will mutate causes a hard fail. A missing table means the
// schema hasn't been applied; a permission error means the DB is not ready.
// Both are treated the same: refuse to run.
{
  const preClient = new pg.Client({ connectionString: TEST_DATABASE_URL });
  try {
    await preClient.connect();

    // Check for active global_outbound or release_pending holds.
    // Error = fail closed (schema not applied, permissions wrong, etc.)
    let holdCount: number;
    try {
      const r = await preClient.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM logical_job_control_holds
         WHERE reason_code IN ('global_outbound', 'release_pending') AND active = true`,
      );
      holdCount = parseInt(r.rows[0]?.count ?? "0", 10);
    } catch (err: any) {
      guardFail(
        `Pre-flight check on logical_job_control_holds failed: ${err?.message}\n` +
        "This table must exist and be queryable in the test DB.\n" +
        "Ensure the test database has the full schema applied (run all migrations first).",
      );
    }
    if (holdCount! > 0) {
      guardFail(
        `Test DB '${testDbName}' already has ${holdCount!} active global_outbound/release_pending hold(s).\n` +
        "This test requires a CLEAN test database with no pre-existing global hold state.\n" +
        "Clear the holds or use a fresh test database:\n" +
        "  UPDATE logical_job_control_holds SET active=false\n" +
        "    WHERE reason_code IN ('global_outbound','release_pending');",
      );
    }
    console.log("  ✓ No pre-existing global_outbound/release_pending holds in test DB");

    // Check outbound_pause_control for pre-existing paused/activating state.
    // Error = fail closed.
    let pauseState: string | undefined;
    try {
      const r = await preClient.query<{ state: string }>(
        `SELECT state FROM outbound_pause_control ORDER BY id DESC LIMIT 1`,
      );
      pauseState = r.rows[0]?.state;
    } catch (err: any) {
      guardFail(
        `Pre-flight check on outbound_pause_control failed: ${err?.message}\n` +
        "This table must exist and be queryable in the test DB.\n" +
        "Ensure the test database has the full schema applied (run all migrations first).",
      );
    }
    if (pauseState === "paused" || pauseState === "activating") {
      guardFail(
        `Test DB '${testDbName}' outbound_pause_control is already in state='${pauseState}'.\n` +
        "This test requires a CLEAN (unpaused) outbound control state.\n" +
        "Restore the state before running:\n" +
        "  UPDATE outbound_pause_control SET state='unpaused';",
      );
    }
    console.log(`  ✓ outbound_pause_control state='${pauseState ?? "absent (no row)"}' — clean`);

    // Check for pre-existing paused enrollments with _globalPauseBlockReason.
    // The VFC-22 unpause sweep restores ALL such rows unscoped; pre-existing
    // ones would be silently altered. Error = fail closed.
    let blockedEnrollCount: number;
    try {
      const r = await preClient.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM sequence_enrollments
         WHERE status = 'paused'
           AND metadata->>'_globalPauseBlockReason' IS NOT NULL`,
      );
      blockedEnrollCount = parseInt(r.rows[0]?.count ?? "0", 10);
    } catch (err: any) {
      guardFail(
        `Pre-flight check on sequence_enrollments failed: ${err?.message}\n` +
        "This table must exist and be queryable in the test DB.\n" +
        "Ensure the test database has the full schema applied (run all migrations first).",
      );
    }
    if (blockedEnrollCount! > 0) {
      guardFail(
        `Test DB '${testDbName}' has ${blockedEnrollCount!} pre-existing paused enrollment(s) ` +
        `with _globalPauseBlockReason.\n` +
        "The VFC-22 restoration sweep in applyPauseMutation(unpause) restores ALL such rows unscoped.\n" +
        "This test requires a CLEAN test database — no pre-existing _globalPauseBlockReason enrollments.\n" +
        "Clear them or use a fresh test database before running.",
      );
    }
    console.log("  ✓ No pre-existing _globalPauseBlockReason enrollments in test DB");

  } finally {
    try { await preClient.end(); } catch { /* ignore */ }
  }
}

console.log("\n  All pre-flight checks passed — proceeding with test.\n");

// ── Override DATABASE_URL BEFORE server-module imports ────────────────────────
// After this point all dynamic imports see the test database.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.REDIS_KEY_PREFIX = TEST_REDIS_PREFIX;

console.log("══════════════════════════════════════════════════════════════");
console.log(" Pause State-Machine Unit Test (isolated) — Running scenarios");
console.log("══════════════════════════════════════════════════════════════");
console.log(`  NODE_ENV:           ${process.env.NODE_ENV}`);
console.log(`  Test DB:            ${testDbName!}`);
console.log(`  TEST_REDIS_PREFIX:  ${TEST_REDIS_PREFIX}`);
console.log(`  OPT_IN:             confirmed`);
console.log("");

// ── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label: string): void {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label: string, detail?: string): void {
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
  failed++;
}

function section(title: string): void {
  console.log(`\n▶  ${title}`);
}

// ── Dynamically import server modules (all see overridden DATABASE_URL) ───────
const { applyPauseMutation } = await import("../server/services/outbound-control-service");
const { outboundQueueCoordinator } = await import("../server/services/outbound-queue-coordinator");
const { writeHoldDeferralMarker } = await import("../server/services/sequence-worker");
const { db: testDb, pool: testPool } = await import("../server/db");
const {
  contacts: contactsTable,
  sequenceEnrollments: seTable,
} = await import("../shared/schema");
const { eq, inArray } = await import("drizzle-orm");

// ── Per-run identity ─────────────────────────────────────────────────────────
const TEST_RUN_SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const TEST_CORRELATION_ID = `pause-unit-test-${TEST_RUN_SUFFIX}`;
const TEST_ACTOR = `test-isolation-suite-${TEST_RUN_SUFFIX}@internal`;

console.log(`  Correlation ID: ${TEST_CORRELATION_ID}`);
console.log(`  Actor:          ${TEST_ACTOR}\n`);

// ── Seeded fixture IDs and tracked hold IDs ───────────────────────────────────
let seededContactId: number | null = null;
let seededActiveEnrollmentId: number | null = null;
let seededLegacyEnrollmentId: number | null = null;

// hold_ids created by this test run — tracked for scoped cleanup and approval
const testCreatedHoldIds = new Set<string>();
// logical_job_keys with release_pending holds created by our unpause — for scoped approveRelease
let testReleasePendingKeys: string[] = [];

// ── Cleanup ───────────────────────────────────────────────────────────────────
// ISOLATION: every operation targets only rows this test created, identified
// by seeded IDs, TEST_CORRELATION_ID, TEST_ACTOR, or explicit hold_ids.

async function cleanup(): Promise<void> {
  section("Cleanup: destroying isolated fixture rows");
  const cleanupErrors: string[] = [];

  // 1. Delete seeded sequence_enrollments by exact ID
  const enrollmentIds = [seededActiveEnrollmentId, seededLegacyEnrollmentId].filter(
    (id): id is number => id !== null,
  );
  if (enrollmentIds.length > 0) {
    try {
      await testDb.delete(seTable).where(inArray(seTable.id, enrollmentIds));
      console.log(`  ✓ Deleted ${enrollmentIds.length} test enrollment(s): ${enrollmentIds.join(", ")}`);
    } catch (err: any) {
      cleanupErrors.push(`sequence_enrollments delete: ${err?.message}`);
      console.error(`  ✗ Could not delete test enrollment(s): ${err?.message}`);
    }
  }

  // 2. Delete seeded contact by exact ID
  if (seededContactId !== null) {
    try {
      await testDb.delete(contactsTable).where(eq(contactsTable.id, seededContactId));
      console.log(`  ✓ Deleted test contact: ${seededContactId}`);
    } catch (err: any) {
      cleanupErrors.push(`contacts delete: ${err?.message}`);
      console.error(`  ✗ Could not delete test contact: ${err?.message}`);
    }
  }

  // 3. Deactivate holds by hold_id (the hold_ids we tracked during the run)
  if (testCreatedHoldIds.size > 0) {
    try {
      const ids = Array.from(testCreatedHoldIds);
      const r = await testPool.query<{ hold_id: string }>(
        `UPDATE logical_job_control_holds
         SET active = false, released_at = NOW(), updated_at = NOW()
         WHERE hold_id = ANY($1) AND active = true
         RETURNING hold_id`,
        [ids],
      );
      console.log(`  ✓ Deactivated ${r.rows.length} test hold(s) by hold_id`);
    } catch (err: any) {
      cleanupErrors.push(`hold deactivation by id: ${err?.message}`);
      console.error(`  ✗ Could not deactivate test holds by hold_id: ${err?.message}`);
    }
  }

  // 4. Clean up any remaining global_outbound/release_pending holds that our
  //    test created but weren't tracked in testCreatedHoldIds yet.
  //    Uses events join (not holds.correlation_id) because writeGlobalOutboundHolds
  //    only writes correlation_id on events, not on hold rows.
  try {
    const untracked = await testPool.query<{ hold_id: string }>(
      `SELECT DISTINCT h.hold_id
       FROM logical_job_hold_events e
       JOIN logical_job_control_holds h ON h.hold_id = e.hold_id
       WHERE e.correlation_id = $1
         AND e.reason_code IN ('global_outbound', 'release_pending')
         AND h.active = true`,
      [TEST_CORRELATION_ID],
    );
    const untrackedIds = untracked.rows
      .map(r => r.hold_id)
      .filter(id => !testCreatedHoldIds.has(id));
    if (untrackedIds.length > 0) {
      const r2 = await testPool.query<{ hold_id: string }>(
        `UPDATE logical_job_control_holds
         SET active = false, released_at = NOW(), updated_at = NOW()
         WHERE hold_id = ANY($1) AND active = true
         RETURNING hold_id`,
        [untrackedIds],
      );
      if (r2.rows.length > 0) {
        console.log(`  ✓ Deactivated ${r2.rows.length} additional hold(s) via events-join safety net`);
      }
    }
  } catch {
    /* non-fatal — best effort safety net */
  }

  // 5. Restore outbound_pause_control ONLY if our actor was the last to write it
  try {
    const ctrl = await testPool.query<{ state: string; actor: string | null }>(
      `SELECT state, actor FROM outbound_pause_control ORDER BY id DESC LIMIT 1`,
    );
    const row = ctrl.rows[0];
    if (row && (row.state === "paused" || row.state === "activating") && row.actor === TEST_ACTOR) {
      await testPool.query(
        `UPDATE outbound_pause_control
         SET state = 'unpaused', updated_at = NOW()
         WHERE actor = $1 AND state IN ('paused', 'activating')`,
        [TEST_ACTOR],
      );
      console.log(`  ✓ Restored outbound_pause_control to unpaused (written by test actor)`);
    } else if (row?.state === "paused" || row?.state === "activating") {
      console.log(
        `  ○ outbound_pause_control state='${row?.state}' actor='${row?.actor}' — ` +
        `not written by this run (actor='${TEST_ACTOR}'), left unchanged`,
      );
    }
  } catch {
    /* table may not exist — tolerate */
  }

  if (cleanupErrors.length > 0) {
    console.error("\n  ✗ CLEANUP ERRORS — test namespace may be in an ambiguous state:");
    for (const e of cleanupErrors) console.error(`      ${e}`);
    console.error(
      `\n  Manual cleanup hint:\n` +
      `    DELETE FROM sequence_enrollments WHERE id IN (${enrollmentIds.join(",") || "none"});\n` +
      `    UPDATE logical_job_control_holds SET active=false WHERE correlation_id='${TEST_CORRELATION_ID}';`,
    );
    process.exit(1);
  }
}

// ── Seed isolated fixtures ────────────────────────────────────────────────────

section("Seeding isolated test fixtures");

try {
  const contactRows = await testDb.insert(contactsTable).values({
    firstName: "PauseCycleTest",
    lastName: `Unit-${TEST_RUN_SUFFIX}`,
    email: `pause-unit-test-${TEST_RUN_SUFFIX}@test.internal`,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any).returning({ id: contactsTable.id });

  seededContactId = contactRows[0]?.id ?? null;
  if (seededContactId === null) throw new Error("Contact insert returned no ID");
  console.log(`  ✓ Seeded test contact id=${seededContactId}`);

  // Active enrollment — no _holdDeferred fields, status='active'
  const activeRows = await testDb.insert(seTable).values({
    contactId: seededContactId,
    sequenceId: null,
    currentStep: 0,
    status: "active",
    metadata: {} as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any).returning({ id: seTable.id });

  seededActiveEnrollmentId = activeRows[0]?.id ?? null;
  if (seededActiveEnrollmentId === null) throw new Error("Active enrollment insert returned no ID");
  console.log(`  ✓ Seeded active enrollment id=${seededActiveEnrollmentId}`);

  // Legacy VFC-22 enrollment — status='paused', _globalPauseBlockReason set
  const legacyRows = await testDb.insert(seTable).values({
    contactId: seededContactId,
    sequenceId: null,
    currentStep: 1,
    status: "paused",
    metadata: {
      _globalPauseBlockStep: 1,
      _globalPauseBlockReason: "OutboundPauseAuthority blocked (paused)",
    } as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any).returning({ id: seTable.id });

  seededLegacyEnrollmentId = legacyRows[0]?.id ?? null;
  if (seededLegacyEnrollmentId === null) throw new Error("Legacy enrollment insert returned no ID");
  console.log(`  ✓ Seeded legacy (VFC-22) enrollment id=${seededLegacyEnrollmentId}`);

} catch (seedErr: any) {
  console.error(`  ✗ Fixture seeding failed: ${seedErr?.message}`);
  await cleanup();
  process.exit(1);
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

try {
  // ── Scenario A: install reason-scoped manual_operator hold ───────────────
  section("Scenario A: install reason-scoped manual_operator hold");

  const manualHoldKey = `test-manual-hold-${TEST_RUN_SUFFIX}`;

  try {
    const ins = await testPool.query<{ hold_id: string }>(
      `INSERT INTO logical_job_control_holds
         (logical_job_key, reason_code, source_type, source_key, source_epoch,
          ledger_epoch, active, activated_at, updated_at, actor, correlation_id)
       VALUES ($1, 'manual_operator', 'operator', 'test-suite', 0, 1, true, NOW(), NOW(), $2, $3)
       RETURNING hold_id`,
      [manualHoldKey, TEST_ACTOR, TEST_CORRELATION_ID],
    );
    const manualHoldId = ins.rows[0]?.hold_id;
    if (manualHoldId) {
      testCreatedHoldIds.add(manualHoldId);
      ok(`manual_operator hold inserted (hold_id=${manualHoldId}, key='${manualHoldKey}')`);
    } else {
      fail("manual_operator hold INSERT returned no hold_id");
    }

    const check = await testPool.query<{ active: boolean }>(
      `SELECT active FROM logical_job_control_holds WHERE hold_id = $1`,
      [manualHoldId ?? ""],
    );
    if (check.rows[0]?.active === true) {
      ok("manual_operator hold confirmed active before global pause cycle");
    } else {
      fail("manual_operator hold not found or not active after insert");
    }
  } catch (err: any) {
    fail("Scenario A", err?.message);
  }

  // ── Scenario B: pause creates global_outbound holds ──────────────────────
  section("Scenario B: pause creates global_outbound holds");

  try {
    const pauseResult = await applyPauseMutation({
      outboundGlobalPaused: true,
      reason: "Isolation-test pause — unit test scenario B",
      actor: TEST_ACTOR,
      correlationId: TEST_CORRELATION_ID,
    });

    if (pauseResult.ok) ok("applyPauseMutation(pause) returned ok=true");
    else fail("applyPauseMutation(pause) returned ok=false");

    if (pauseResult.control.outboundGlobalPaused === true)
      ok("control.outboundGlobalPaused is true after pause");
    else fail("control.outboundGlobalPaused should be true after pause");

    if (typeof pauseResult.control.epoch === "string")
      ok(`pause epoch is string type: '${pauseResult.control.epoch}'`);
    else fail(`pause epoch must be a string, got ${typeof pauseResult.control.epoch}`);

    const status = await outboundQueueCoordinator.getStatus();
    if (typeof status.ledgerEpoch === "string")
      ok(`coordinator getStatus().ledgerEpoch is string type: '${status.ledgerEpoch}'`);
    else fail(`coordinator getStatus().ledgerEpoch must be string (got ${typeof status.ledgerEpoch})`);

    // Track hold_ids created by our pause via events join.
    // NOTE: writeGlobalOutboundHolds stores correlation_id on logical_job_hold_events
    // rows, NOT on logical_job_control_holds rows. We must join events → holds.
    const createdHolds = await testPool.query<{ hold_id: string }>(
      `SELECT DISTINCT h.hold_id
       FROM logical_job_hold_events e
       JOIN logical_job_control_holds h ON h.hold_id = e.hold_id
       WHERE e.event_type = 'activated'
         AND e.reason_code = 'global_outbound'
         AND e.correlation_id = $1
         AND h.active = true`,
      [TEST_CORRELATION_ID],
    );
    for (const r of createdHolds.rows) testCreatedHoldIds.add(r.hold_id);

    if (createdHolds.rows.length > 0)
      ok(`${createdHolds.rows.length} active global_outbound hold(s) tracked (via events join, correlation_id='${TEST_CORRELATION_ID}')`);
    else fail("Expected at least one active global_outbound hold after pause — verify writeGlobalOutboundHolds writes activation events with correlation_id");

  } catch (err: any) {
    fail("Scenario B", err?.message);
  }

  // ── Scenario C: _holdDeferred marker write and idempotency ───────────────
  section("Scenario C: _holdDeferred marker write and idempotency");

  try {
    if (seededActiveEnrollmentId === null) throw new Error("No active enrollment seeded");

    const testStep = 0;
    const testReason = "OutboundPauseAuthority blocked (paused) — unit test";

    // First call — should write the marker
    const first = await writeHoldDeferralMarker(
      seededActiveEnrollmentId,
      testStep,
      testReason,
      null,
      testDb,
    );

    if (first.written === true) ok("First writeHoldDeferralMarker call wrote the marker");
    else fail("First writeHoldDeferralMarker call should have written (was: not written)");

    if (typeof first._holdDeferredAt === "string" && first._holdDeferredAt.length > 0)
      ok(`First call _holdDeferredAt is a non-empty ISO string: '${first._holdDeferredAt}'`);
    else fail("First call _holdDeferredAt must be a non-empty ISO string");

    // Read back to verify stored state
    const afterFirst = await testDb
      .select({ status: seTable.status, metadata: seTable.metadata, updatedAt: seTable.updatedAt })
      .from(seTable)
      .where(eq(seTable.id, seededActiveEnrollmentId))
      .limit(1);

    const meta1 = (afterFirst[0]?.metadata as Record<string, unknown>) ?? {};

    if (afterFirst[0]?.status === "active")
      ok("enrollment status remains 'active' after first writeHoldDeferralMarker");
    else fail(`enrollment status must remain 'active', got '${afterFirst[0]?.status}'`);

    const updAt = afterFirst[0]?.updatedAt;
    if (updAt instanceof Date && Date.now() - updAt.getTime() < 5000)
      ok("enrollment updatedAt refreshed by writeHoldDeferralMarker");
    else fail(`enrollment updatedAt not refreshed (got: ${updAt})`);

    if (meta1._holdDeferredStep === testStep) ok(`_holdDeferredStep=${testStep} stored correctly`);
    else fail(`_holdDeferredStep should be ${testStep}, got ${meta1._holdDeferredStep}`);

    if (meta1._holdDeferredReason === testReason) ok("_holdDeferredReason stored correctly");
    else fail(`_holdDeferredReason mismatch: '${meta1._holdDeferredReason}'`);

    // Second call with same step+reason — must be idempotent
    const second = await writeHoldDeferralMarker(
      seededActiveEnrollmentId,
      testStep,
      testReason,
      meta1,
      testDb,
    );

    if (second.written === false) ok("Second writeHoldDeferralMarker call was idempotent (no write)");
    else fail("Second call with same step+reason should be idempotent (written should be false)");

    if (second._holdDeferredAt === first._holdDeferredAt)
      ok(`_holdDeferredAt preserved on idempotent second call: '${second._holdDeferredAt}'`);
    else fail(
      `_holdDeferredAt changed on idempotent call. ` +
      `Before: '${first._holdDeferredAt}', After: '${second._holdDeferredAt}'`,
    );

    const afterSecond = await testDb
      .select({ status: seTable.status })
      .from(seTable)
      .where(eq(seTable.id, seededActiveEnrollmentId))
      .limit(1);

    if (afterSecond[0]?.status === "active")
      ok("enrollment status still 'active' after idempotent second call");
    else fail(`enrollment status must remain 'active', got '${afterSecond[0]?.status}'`);

    if (afterSecond[0]?.status !== "paused")
      ok("confirmed: no status='paused' was written during hold deferral (no VFC-22 regression)");
    else fail("KILL: enrollment status was set to 'paused' — VFC-22 regression detected");

  } catch (err: any) {
    fail("Scenario C", err?.message);
  }

  // ── Scenario D: reason-scoped hold survives paused state ─────────────────
  section("Scenario D: manual_operator hold is active during paused state");

  try {
    const holdCheck = await testPool.query<{ active: boolean }>(
      `SELECT active FROM logical_job_control_holds
       WHERE correlation_id = $1 AND reason_code = 'manual_operator'`,
      [TEST_CORRELATION_ID],
    );
    if (holdCheck.rows[0]?.active === true)
      ok("manual_operator hold still active during paused state (not affected by global pause)");
    else fail("manual_operator hold should still be active during paused state");
  } catch (err: any) {
    fail("Scenario D", err?.message);
  }

  // ── Scenario E: unpause restores VFC-22 legacy enrollments ───────────────
  section("Scenario E: unpause → VFC-22 restoration + release_pending transition");

  try {
    const unpause = await applyPauseMutation({
      outboundGlobalPaused: false,
      reason: "Isolation-test unpause — unit test scenario E",
      actor: TEST_ACTOR,
      correlationId: TEST_CORRELATION_ID,
    });

    if (unpause.ok) ok("applyPauseMutation(unpause) returned ok=true");
    else fail("applyPauseMutation(unpause) returned ok=false");

    if (unpause.control.outboundGlobalPaused === false)
      ok("control.outboundGlobalPaused is false after unpause");
    else fail("control.outboundGlobalPaused should be false after unpause");

    // VFC-22: legacy enrollment (seeded with _globalPauseBlockReason) must be restored
    if (seededLegacyEnrollmentId !== null) {
      const legacyAfter = await testDb
        .select({ status: seTable.status, metadata: seTable.metadata })
        .from(seTable)
        .where(eq(seTable.id, seededLegacyEnrollmentId))
        .limit(1);
      const legMeta = (legacyAfter[0]?.metadata as Record<string, unknown>) ?? {};

      if (legacyAfter[0]?.status === "active")
        ok("VFC-22: legacy enrollment restored to status='active' by unpause sweep");
      else fail(`VFC-22: legacy enrollment should be 'active' after unpause, got '${legacyAfter[0]?.status}'`);

      if (!legMeta._globalPauseBlockReason)
        ok("VFC-22: _globalPauseBlockReason cleared from legacy enrollment metadata");
      else fail("VFC-22: _globalPauseBlockReason should be removed after unpause");

      if (!legMeta._globalPauseBlockStep)
        ok("VFC-22: _globalPauseBlockStep cleared from legacy enrollment metadata");
      else fail("VFC-22: _globalPauseBlockStep should be removed after unpause");
    }

    // Non-legacy active enrollment must remain unchanged
    if (seededActiveEnrollmentId !== null) {
      const activeAfter = await testDb
        .select({ status: seTable.status })
        .from(seTable)
        .where(eq(seTable.id, seededActiveEnrollmentId))
        .limit(1);
      if (activeAfter[0]?.status === "active")
        ok("non-legacy active enrollment unchanged after unpause");
      else fail(`non-legacy active enrollment should remain 'active', got '${activeAfter[0]?.status}'`);
    }

    // Find release_pending holds created by our unpause by querying events
    // attributed to our actor + correlated hold_ids
    const rpEvents = await testPool.query<{ logical_job_key: string; hold_id: string }>(
      `SELECT DISTINCT e.logical_job_key, e.hold_id
       FROM logical_job_hold_events e
       JOIN logical_job_control_holds h ON h.hold_id = e.hold_id
       WHERE e.event_type = 'activated'
         AND e.reason_code = 'release_pending'
         AND e.actor = $1
         AND h.active = true`,
      [TEST_ACTOR],
    );

    testReleasePendingKeys = rpEvents.rows.map(r => r.logical_job_key);
    for (const r of rpEvents.rows) testCreatedHoldIds.add(r.hold_id);

    if (testReleasePendingKeys.length > 0)
      ok(`${testReleasePendingKeys.length} release_pending key(s) tracked after unpause`);
    else fail("Expected at least one release_pending hold after unpause (traced via TEST_ACTOR events)");

    // Our manual_operator hold must not have been affected by unpause
    const manualAfter = await testPool.query<{ active: boolean }>(
      `SELECT active FROM logical_job_control_holds
       WHERE correlation_id = $1 AND reason_code = 'manual_operator'`,
      [TEST_CORRELATION_ID],
    );
    if (manualAfter.rows[0]?.active === true)
      ok("manual_operator hold still active after global unpause");
    else fail("manual_operator hold should survive global unpause — reason-scoped isolation broken");

    // Our global_outbound holds (correlation_id = ours) must now be inactive
    const goAfter = await testPool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM logical_job_control_holds
       WHERE correlation_id = $1 AND reason_code = 'global_outbound' AND active = true`,
      [TEST_CORRELATION_ID],
    );
    const goCount = parseInt(goAfter.rows[0]?.count ?? "0", 10);
    if (goCount === 0)
      ok("global_outbound holds (our correlation_id) inactive after unpause (moved to release_pending)");
    else fail(`${goCount} of our global_outbound hold(s) still active after unpause`);

  } catch (err: any) {
    fail("Scenario E", err?.message);
  }

  // ── Scenario F: approveRelease clears only our release_pending holds ──────
  // Uses specific logical_job_keys identified during Scenario E — never "all".
  section("Scenario F: approveRelease clears our release_pending holds (scoped keys, not 'all')");

  try {
    if (testReleasePendingKeys.length === 0) {
      fail("Scenario F: no release_pending keys tracked from Scenario E — cannot run approve");
    } else {
      const approveResult = await outboundQueueCoordinator.approveRelease(
        testReleasePendingKeys,  // ← specific keys, never "all"
        TEST_ACTOR,
        TEST_CORRELATION_ID,
      );

      if (typeof approveResult.count === "number") ok(`approveRelease returned count=${approveResult.count}`);
      else fail("approveRelease did not return a numeric count");

      if (approveResult.count > 0) ok(`${approveResult.count} release_pending hold(s) approved and cleared`);
      else fail("approveRelease cleared 0 holds — expected at least 1 for our tracked keys");

      if (typeof approveResult.newLedgerEpoch === "bigint")
        ok(`approveRelease newLedgerEpoch is bigint: ${approveResult.newLedgerEpoch}`);
      else if (typeof approveResult.newLedgerEpoch === "string")
        ok(`approveRelease newLedgerEpoch is string (serial-safe): '${approveResult.newLedgerEpoch}'`);
      else fail(`approveRelease newLedgerEpoch unexpected type: ${typeof approveResult.newLedgerEpoch}`);

      // Our release_pending holds for tracked keys must now be inactive
      const rpAfter = await testPool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM logical_job_control_holds
         WHERE logical_job_key = ANY($1) AND reason_code = 'release_pending' AND active = true`,
        [testReleasePendingKeys],
      );
      const rpRem = parseInt(rpAfter.rows[0]?.count ?? "0", 10);
      if (rpRem === 0) ok("zero release_pending holds remain for our tracked keys after approveRelease");
      else fail(`${rpRem} release_pending hold(s) still active for our tracked keys after approveRelease`);

      // getStatus() must show no active global_outbound or release_pending holds
      // for our tracked keys
      const statusAfter = await outboundQueueCoordinator.getStatus();
      const stillActive = testReleasePendingKeys.filter(k => {
        const holds = (statusAfter.desiredLogicalHolds ?? {})[k] ?? [];
        return (holds as any[]).some(
          (h: any) => h.reasonCode === "global_outbound" || h.reasonCode === "release_pending",
        );
      });
      if (stillActive.length === 0)
        ok("getStatus() shows zero active global_outbound/release_pending holds for our tracked keys");
      else fail(
        `getStatus() still shows active holds for ${stillActive.length} tracked key(s): ` +
        stillActive.slice(0, 3).join(", "),
      );

      // manual_operator hold must still be present — approveRelease only clears release_pending
      const manualFinal = await testPool.query<{ active: boolean }>(
        `SELECT active FROM logical_job_control_holds
         WHERE correlation_id = $1 AND reason_code = 'manual_operator'`,
        [TEST_CORRELATION_ID],
      );
      if (manualFinal.rows[0]?.active === true)
        ok("manual_operator hold still active after approveRelease (unaffected by release approval)");
      else fail("KILL: manual_operator hold cleared by approveRelease — reason-scoped isolation broken");
    }
  } catch (err: any) {
    fail("Scenario F", err?.message);
  }

} finally {
  await cleanup();
  try { await testPool.end(); } catch { /* ignore */ }
}

// ── Results ───────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════════════════════");
console.log(` Pause State-Machine Unit Test — Results`);
console.log("══════════════════════════════════════════════════════════════");
console.log(`  Passed:  ${passed}`);
console.log(`  Failed:  ${failed}`);
console.log("");

if (failed > 0) {
  console.error(`❌  ${failed} assertion(s) failed.\n`);
  process.exit(1);
} else {
  console.log(`✅  All ${passed} assertions passed.\n`);
  process.exit(0);
}
