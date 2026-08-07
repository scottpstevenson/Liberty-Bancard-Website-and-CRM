import { db, pool } from "../db";
import { backgroundJobs } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export const JOB_NAMES = {
  GHL_SYNC: "ghl-sync",
  SLA_WORKER: "sla-worker",
  INBOX_ROTATION: "inbox-rotation",
  CONTENT_SCHEDULER: "content-scheduler",
  SEQUENCE_WORKER: "sequence-worker",
  ANOMALY_DETECTION: "anomaly-detection",
  WEEKLY_DIGEST: "weekly-digest",
  MID_INGESTION: "mid-ingestion",
  // Pseudo-job used purely as a visible health signal, not a real recurring
  // tick. recordWorkerSuccess() is called when BullMQ initializes the GHL
  // sync queue; recordWorkerFailure() is called when the process falls back
  // to the legacy setInterval GHL sync loop. Lets operators see fallback
  // mode in the same Job Queue health table instead of only in server logs.
  GHL_SYNC_MODE: "ghl-sync-mode",
  // Tracks isolated failures of the specific sub-call inside each tick
  // (separate from the overall tick's own job name), so a persistently
  // broken sequence-enrollment or enrichment sub-task is visible even
  // though the outer tick itself keeps "succeeding" due to error isolation.
  SEQUENCE_ENROLLMENT_PROCESSOR: "sequence-enrollment-processor",
  ENRICHMENT_QUEUE_PROCESSOR: "enrichment-queue-processor",
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

/**
 * How long a job may stay in status='running' before its lock is considered
 * stale and is auto-released on the next acquireJobLock() call.
 *
 * Default: 20 minutes — comfortably longer than the worst-case sequence-worker
 * run (documented at ~8 min with 155K contacts).  Override via env var
 * STALE_JOB_LOCK_TTL_MINUTES for environments with different run budgets.
 */
export const STALE_LOCK_TTL_MINUTES: number = (() => {
  const raw = parseInt(process.env.STALE_JOB_LOCK_TTL_MINUTES ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 20;
})();

/**
 * Attempt to acquire a lock for the given job atomically.
 *
 * Returns a string lock token if the lock was acquired — callers MUST pass
 * this token to every releaseJobLock() call so that a slow or crashed prior
 * owner cannot overwrite the new owner's lock state (fencing token pattern).
 *
 * Returns null if the job is already running and the lock is not yet stale.
 *
 * Stale-lock recovery: if status='running' and last_started_at is older than
 * STALE_LOCK_TTL_MINUTES, the lock is atomically reclaimed.  A CTE captures
 * the pre-update row so the staleness test reads the original state, not the
 * post-update one.
 */
export async function acquireJobLock(jobName: string): Promise<string | null> {
  try {
    const newToken = randomUUID();

    // CTE reads the current row BEFORE the INSERT/UPDATE fires, giving us the
    // original status and last_started_at for an accurate staleness check.
    // The upsert updates only when:
    //   (a) the job is not currently running, OR
    //   (b) the job is running but the lock has gone stale.
    // rowCount == 0  →  already running (fresh lock)  →  return null
    // rowCount == 1  →  lock acquired; was_stale tells us if it was a recovery
    const result = await pool.query<{
      lock_token: string;
      was_stale: boolean | null;
    }>(
      `WITH pre AS MATERIALIZED (
         SELECT status, last_started_at
         FROM background_jobs
         WHERE job_name = $1
       )
       INSERT INTO background_jobs
           (job_name, status, last_started_at, lock_token, run_count, consecutive_failures, updated_at)
         VALUES ($1, 'running', NOW(), $3, 0, 0, NOW())
       ON CONFLICT (job_name) DO UPDATE
         SET status          = 'running',
             last_started_at = NOW(),
             lock_token      = $3,
             updated_at      = NOW()
         WHERE background_jobs.status <> 'running'
            OR background_jobs.last_started_at < NOW() - ($2 || ' minutes')::interval
       RETURNING
         lock_token,
         (SELECT pre.status = 'running'
                 AND pre.last_started_at < NOW() - ($2 || ' minutes')::interval
          FROM pre) AS was_stale`,
      [jobName, String(STALE_LOCK_TTL_MINUTES), newToken]
    );

    if (result.rowCount === 0) {
      console.log(`[JobRegistry] ${jobName} is already running — skipping tick`);
      return null;
    }

    // Log when we auto-released a stale lock so operators can see the recovery.
    if (result.rows[0]?.was_stale === true) {
      console.warn(
        `[JobRegistry] ${jobName} lock was stale (>${STALE_LOCK_TTL_MINUTES} min) — auto-released and re-acquired`
      );
    }

    return result.rows[0]?.lock_token ?? newToken;
  } catch (err) {
    console.error(`[JobRegistry] acquireJobLock failed for ${jobName}:`, err);
    // Fail closed — if the registry DB is unavailable, refuse the lock so
    // concurrent workers cannot run the same singleton job and cause duplicate
    // sends or conflicting writes.
    return null;
  }
}

/**
 * Release the job lock after execution completes.
 *
 * @param jobName   - The job whose lock to release.
 * @param success   - true for a successful run, false for failure.
 * @param error     - Optional error message (stored when success=false).
 * @param lockToken - Token returned by acquireJobLock.  When provided, the
 *                    UPDATE is gated on lock_token matching, so a slow/crashed
 *                    prior owner cannot overwrite the current owner's state.
 *                    Callers that omit it get the old unconditional behaviour
 *                    (with a warning log) for backward compatibility.
 */
export async function releaseJobLock(
  jobName: string,
  success: boolean,
  error?: string,
  lockToken?: string
): Promise<void> {
  try {
    if (!lockToken) {
      console.warn(
        `[JobRegistry] releaseJobLock called without lockToken for ${jobName} — ownership not verified`
      );
    }

    const result = await pool.query<{ id: number }>(
      `UPDATE background_jobs
         SET status               = $2,
             last_finished_at     = NOW(),
             last_error           = $3,
             run_count            = run_count + 1,
             consecutive_failures = CASE WHEN $2 = 'succeeded' THEN 0
                                         ELSE consecutive_failures + 1 END,
             updated_at           = NOW()
       WHERE job_name = $1
         AND ($4::text IS NULL OR lock_token = $4)
       RETURNING id`,
      [
        jobName,
        success ? "succeeded" : "failed",
        success ? null : (error ?? "Unknown error"),
        lockToken ?? null,
      ]
    );

    if ((result.rowCount ?? 0) === 0 && lockToken) {
      // Token mismatch — this call came from a stale owner whose lock was
      // already reclaimed by a newer tick.  No-op is correct; log for visibility.
      console.warn(
        `[JobRegistry] releaseJobLock for ${jobName} matched 0 rows — ` +
        `token mismatch; likely a stale owner releasing after takeover (safe no-op)`
      );
    }
  } catch (err) {
    console.error(`[JobRegistry] releaseJobLock failed for ${jobName}:`, err);
  }
}

/**
 * Returns the current health status of all registered background jobs.
 */
export async function getJobStatuses(): Promise<
  Array<{
    jobName: string;
    status: string;
    lastStartedAt: Date | null;
    lastFinishedAt: Date | null;
    lastError: string | null;
    runCount: number;
    consecutiveFailures: number;
    updatedAt: Date | null;
    lastDurationMs: number | null;
  }>
> {
  try {
    const rows = await db.select().from(backgroundJobs);

    const knownJobs = Object.values(JOB_NAMES);
    const rowsByName = new Map(rows.map((r) => [r.jobName, r]));

    const results = knownJobs.map((jobName) => {
      const row = rowsByName.get(jobName);
      const lastDurationMs =
        row?.lastStartedAt && row?.lastFinishedAt
          ? new Date(row.lastFinishedAt).getTime() - new Date(row.lastStartedAt).getTime()
          : null;

      return {
        jobName,
        status: row?.status ?? "idle",
        lastStartedAt: row?.lastStartedAt ?? null,
        lastFinishedAt: row?.lastFinishedAt ?? null,
        lastError: row?.lastError ?? null,
        runCount: row?.runCount ?? 0,
        consecutiveFailures: row?.consecutiveFailures ?? 0,
        updatedAt: row?.updatedAt ?? null,
        lastDurationMs,
      };
    });

    return results;
  } catch (err) {
    console.error("[JobRegistry] getJobStatuses failed:", err);
    return [];
  }
}

/**
 * Returns true if any job has 3 or more consecutive failures.
 */
export async function hasJobAlerts(): Promise<boolean> {
  try {
    const statuses = await getJobStatuses();
    return statuses.some((j) => j.consecutiveFailures >= 3);
  } catch {
    return false;
  }
}

/**
 * Record a single worker job failure in background_jobs, incrementing
 * consecutive_failures atomically.  Returns the new consecutive failure count
 * so callers can threshold-check without a separate read.
 *
 * Used by QueueManager to persist failure health for any queue name, not just
 * the named jobs in JOB_NAMES (those are tracked by acquireJobLock/releaseJobLock).
 */
export async function recordWorkerFailure(
  queueName: string,
  error: string
): Promise<number> {
  try {
    const result = await pool.query<{ consecutive_failures: number }>(
      `INSERT INTO background_jobs
         (job_name, status, last_finished_at, run_count, consecutive_failures, last_error, updated_at)
       VALUES ($1, 'failed', NOW(), 0, 1, $2, NOW())
       ON CONFLICT (job_name) DO UPDATE
         SET status              = 'failed',
             consecutive_failures = background_jobs.consecutive_failures + 1,
             last_error          = $2,
             last_finished_at    = NOW(),
             updated_at          = NOW()
       RETURNING consecutive_failures`,
      [queueName, error.slice(0, 1000)]
    );
    return result.rows[0]?.consecutive_failures ?? 1;
  } catch (err) {
    console.error(`[JobRegistry] recordWorkerFailure failed for ${queueName}:`, err);
    return 0;
  }
}

/**
 * Record a successful worker job run — resets consecutive_failures to 0.
 */
export async function recordWorkerSuccess(queueName: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO background_jobs
         (job_name, status, last_finished_at, run_count, consecutive_failures, updated_at)
       VALUES ($1, 'succeeded', NOW(), 1, 0, NOW())
       ON CONFLICT (job_name) DO UPDATE
         SET status              = 'succeeded',
             consecutive_failures = 0,
             run_count           = background_jobs.run_count + 1,
             last_finished_at    = NOW(),
             updated_at          = NOW()`,
      [queueName]
    );
  } catch (err) {
    console.error(`[JobRegistry] recordWorkerSuccess failed for ${queueName}:`, err);
  }
}
