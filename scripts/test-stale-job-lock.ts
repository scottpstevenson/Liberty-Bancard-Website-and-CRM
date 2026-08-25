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
 *      1. First acquireJobLock returns acquired + a token
 *      2. Immediate re-acquire returns held (lock is fresh)
 *
 *   B. Stale-lock recovery
 *      3. Back-date the renewable heartbeat beyond TTL
 *      4. acquireJobLock now returns a NEW (different) token
 *      5. DB row has status='running', a fresh heartbeat, and the original start time is retained
 *
 *   C. Fencing — old owner cannot overwrite new owner
 *      6. Old owner calls releaseJobLock with its stale token → no-op
 *      7. DB row still has status='running' (new owner's lock intact)
 *      8. New owner releases with its token → status='succeeded'
 *
 * Run with:  npx tsx scripts/test-stale-job-lock.ts
 */

import { pool } from "../server/db";
import { acquireJobLock, releaseJobLock, renewJobLock, recordWorkerFailure, recordWorkerSuccess, startJobLockHeartbeat, STALE_LOCK_TTL_MINUTES } from "../server/services/job-registry";

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

    const leaseA = await acquireJobLock(TEST_JOB);
    assert("A1 — first acquireJobLock returns acquired + a token", leaseA.status === "acquired");
    if (leaseA.status !== "acquired") throw new Error("first lease was not acquired");
    const tokenA = leaseA.lockToken;
    const { rows: ownerA } = await pool.query<{ last_started_at: Date }>(
      `SELECT last_started_at FROM background_jobs WHERE job_name = $1`, [TEST_JOB],
    );
    const originalStartedAt = new Date(ownerA[0]?.last_started_at).getTime();

    const blockedAttempt = await acquireJobLock(TEST_JOB);
    assert("A2 — immediate re-acquire returns held (lock is fresh)", blockedAttempt.status === "held");

    // ── Scenario B: Stale-lock recovery ───────────────────────────────────────
    console.log("\nScenario B — stale-lock recovery");

    // Simulate a crash by back-dating the renewable liveness heartbeat.
    await pool.query(
      `UPDATE background_jobs
         SET updated_at = NOW() - ($1 || ' minutes')::interval - INTERVAL '1 minute'
       WHERE job_name = $2`,
      [String(STALE_LOCK_TTL_MINUTES), TEST_JOB]
    );
    console.log(`  (back-dated updated_at to ${STALE_LOCK_TTL_MINUTES + 1} minutes ago)`);

    const leaseB = await acquireJobLock(TEST_JOB);
    assert("B1 — acquireJobLock after TTL elapsed returns acquired", leaseB.status === "acquired");
    if (leaseB.status !== "acquired") throw new Error("stale lease was not recovered");
    const tokenB = leaseB.lockToken;
    assert("B2 — new token differs from the stale token", tokenB !== tokenA);

    const { rows: afterStale } = await pool.query<{ status: string; last_started_at: Date; updated_at: Date }>(
      `SELECT status, last_started_at, updated_at FROM background_jobs WHERE job_name = $1`,
      [TEST_JOB]
    );
    assert("B3 — status is 'running' after stale re-acquire", afterStale[0]?.status === "running");
    const ageSec = afterStale[0]?.updated_at
      ? (Date.now() - new Date(afterStale[0].updated_at).getTime()) / 1000
      : Infinity;
    assert("B4 — heartbeat was refreshed (< 5 s ago)", ageSec < 5);
    assert(
      "B5 — stale recovery records the successor execution start timestamp",
      new Date(afterStale[0]?.last_started_at).getTime() > originalStartedAt,
    );
    const successorStartedAt = new Date(afterStale[0]?.last_started_at).getTime();
    assert("B6 — current owner can renew with its token", await renewJobLock(TEST_JOB, tokenB));
    const { rows: afterRenewal } = await pool.query<{ last_started_at: Date }>(
      `SELECT last_started_at FROM background_jobs WHERE job_name = $1`, [TEST_JOB],
    );
    assert(
      "B7 — renewal retains the current execution start timestamp",
      new Date(afterRenewal[0]?.last_started_at).getTime() === successorStartedAt,
    );
    assert("B8 — stale owner cannot renew successor lease", !(await renewJobLock(TEST_JOB, tokenA)));

    await recordWorkerSuccess(TEST_JOB);
    await recordWorkerFailure(TEST_JOB, "stale telemetry");
    const { rows: afterTelemetry } = await pool.query<{ status: string; lock_token: string }>(
      `SELECT status, lock_token FROM background_jobs WHERE job_name = $1`, [TEST_JOB],
    );
    assert("B9 — tokenless stale telemetry cannot overwrite successor lease", afterTelemetry[0]?.status === "running" && afterTelemetry[0]?.lock_token === tokenB);
    const lossHeartbeat = startJobLockHeartbeat(TEST_JOB, tokenB, {
      intervalMs: 1,
      renew: async () => false,
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    let ownershipLossStoppedWork = false;
    try {
      lossHeartbeat.assertOwned();
    } catch (error) {
      ownershipLossStoppedWork = String(error).includes("JOB_LEASE_LOST");
    } finally {
      lossHeartbeat.stop();
    }
    assert("B10 — renewal loss is observable before consequential work", ownershipLossStoppedWork);

    // ── Scenario C: Fencing — old owner cannot overwrite new owner ─────────────
    console.log("\nScenario C — fencing token blocks stale owner");

    // Old owner (tokenA) tries to release after being overtaken by tokenB.
    // This must be a no-op — the WHERE lock_token = $4 clause won't match.
    await releaseJobLock(TEST_JOB, true, undefined, tokenA);

    const { rows: afterStaleRelease } = await pool.query<{ status: string }>(
      `SELECT status FROM background_jobs WHERE job_name = $1`,
      [TEST_JOB]
    );
    assert(
      "C1 — stale owner's releaseJobLock did NOT change status (still 'running')",
      afterStaleRelease[0]?.status === "running"
    );

    // New owner (tokenB) releases successfully.
    await releaseJobLock(TEST_JOB, true, undefined, tokenB);

    const { rows: afterNewRelease } = await pool.query<{ status: string }>(
      `SELECT status FROM background_jobs WHERE job_name = $1`,
      [TEST_JOB]
    );
    assert(
      "C2 — new owner's releaseJobLock set status to 'succeeded'",
      afterNewRelease[0]?.status === "succeeded"
    );

    // A further acquire after release should succeed (lock is not 'running').
    const leaseC = await acquireJobLock(TEST_JOB);
    assert("C3 — acquireJobLock succeeds after clean release", leaseC.status === "acquired");
    if (leaseC.status === "acquired") await releaseJobLock(TEST_JOB, true, undefined, leaseC.lockToken);

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
