/**
 * test-stale-job-lock.ts
 *
 * Verifies that acquireJobLock() auto-releases a stale lock left behind by a
 * crash (i.e. releaseJobLock was never called) so the next tick can proceed,
 * and that a late-arriving old owner cannot overwrite the new owner's state
 * (fencing token protection).
 *
 * Scenarios tested:
 *   A. Happy path
 *      1. First acquireJobLock returns a non-null token
 *      2. Immediate re-acquire returns null (lock is fresh)
 *
 *   B. Stale-lock recovery
 *      3. Back-date last_started_at beyond TTL
 *      4. acquireJobLock now returns a NEW (different) token
 *      5. DB row has status='running' and a fresh last_started_at
 *
 *   C. Fencing — old owner cannot overwrite new owner
 *      6. Old owner calls releaseJobLock with its stale token → no-op
 *      7. DB row still has status='running' (new owner's lock intact)
 *      8. New owner releases with its token → status='succeeded'
 *
 * Run with:  npx tsx scripts/test-stale-job-lock.ts
 */

import { pool } from "../server/db";
import { acquireJobLock, releaseJobLock, STALE_LOCK_TTL_MINUTES } from "../server/services/job-registry";

const TEST_JOB = `__test-stale-lock-${Date.now()}__`;

async function cleanup() {
  await pool.query(`DELETE FROM background_jobs WHERE job_name = $1`, [TEST_JOB]);
}

async function run() {
  let passed = 0;
  let failed = 0;

  function assert(label: string, condition: boolean) {
    if (condition) {
      console.log(`  ✓  ${label}`);
      passed++;
    } else {
      console.error(`  ✗  ${label}`);
      failed++;
    }
  }

  try {
    console.log(`\n[test-stale-job-lock] TTL = ${STALE_LOCK_TTL_MINUTES} minutes\n`);

    // ── Scenario A: Happy path ─────────────────────────────────────────────────
    console.log("Scenario A — happy path");

    const tokenA = await acquireJobLock(TEST_JOB);
    assert("A1 — first acquireJobLock returns a non-null token", tokenA !== null);

    const blockedAttempt = await acquireJobLock(TEST_JOB);
    assert("A2 — immediate re-acquire returns null (lock is fresh)", blockedAttempt === null);

    // ── Scenario B: Stale-lock recovery ───────────────────────────────────────
    console.log("\nScenario B — stale-lock recovery");

    // Simulate a crash by back-dating last_started_at beyond the TTL
    await pool.query(
      `UPDATE background_jobs
         SET last_started_at = NOW() - ($1 || ' minutes')::interval - INTERVAL '1 minute'
       WHERE job_name = $2`,
      [String(STALE_LOCK_TTL_MINUTES), TEST_JOB]
    );
    console.log(`  (back-dated last_started_at to ${STALE_LOCK_TTL_MINUTES + 1} minutes ago)`);

    const tokenB = await acquireJobLock(TEST_JOB);
    assert("B1 — acquireJobLock after TTL elapsed returns a non-null token", tokenB !== null);
    assert("B2 — new token differs from the stale token", tokenB !== tokenA);

    const { rows: afterStale } = await pool.query<{ status: string; last_started_at: Date }>(
      `SELECT status, last_started_at FROM background_jobs WHERE job_name = $1`,
      [TEST_JOB]
    );
    assert("B3 — status is 'running' after stale re-acquire", afterStale[0]?.status === "running");
    const ageSec = afterStale[0]?.last_started_at
      ? (Date.now() - new Date(afterStale[0].last_started_at).getTime()) / 1000
      : Infinity;
    assert("B4 — last_started_at was refreshed (< 5 s ago)", ageSec < 5);

    // ── Scenario C: Fencing — old owner cannot overwrite new owner ─────────────
    console.log("\nScenario C — fencing token blocks stale owner");

    // Old owner (tokenA) tries to release after being overtaken by tokenB.
    // This must be a no-op — the WHERE lock_token = $4 clause won't match.
    await releaseJobLock(TEST_JOB, true, undefined, tokenA!);

    const { rows: afterStaleRelease } = await pool.query<{ status: string }>(
      `SELECT status FROM background_jobs WHERE job_name = $1`,
      [TEST_JOB]
    );
    assert(
      "C1 — stale owner's releaseJobLock did NOT change status (still 'running')",
      afterStaleRelease[0]?.status === "running"
    );

    // New owner (tokenB) releases successfully.
    await releaseJobLock(TEST_JOB, true, undefined, tokenB!);

    const { rows: afterNewRelease } = await pool.query<{ status: string }>(
      `SELECT status FROM background_jobs WHERE job_name = $1`,
      [TEST_JOB]
    );
    assert(
      "C2 — new owner's releaseJobLock set status to 'succeeded'",
      afterNewRelease[0]?.status === "succeeded"
    );

    // A further acquire after release should succeed (lock is not 'running').
    const tokenC = await acquireJobLock(TEST_JOB);
    assert("C3 — acquireJobLock succeeds after clean release", tokenC !== null);
    await releaseJobLock(TEST_JOB, true, undefined, tokenC!);

  } finally {
    await cleanup();
    await pool.end();
  }

  console.log(`\n─────────────────────────────────────────`);
  if (failed === 0) {
    console.log(`✅  All ${passed} checks passed.\n`);
    process.exit(0);
  } else {
    console.error(`❌  ${failed} check(s) failed (${passed} passed).\n`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("[test-stale-job-lock] Fatal:", err);
  process.exit(1);
});
