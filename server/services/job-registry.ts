import { db, pool } from "../db";
import { backgroundJobs } from "@shared/schema";
import { eq } from "drizzle-orm";

export const JOB_NAMES = {
  GHL_SYNC: "ghl-sync",
  SLA_WORKER: "sla-worker",
  INBOX_ROTATION: "inbox-rotation",
  CONTENT_SCHEDULER: "content-scheduler",
  SEQUENCE_WORKER: "sequence-worker",
  ANOMALY_DETECTION: "anomaly-detection",
  WEEKLY_DIGEST: "weekly-digest",
  MID_INGESTION: "mid-ingestion",
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

/**
 * Attempt to acquire a lock for the given job atomically.
 *
 * Uses a single INSERT … ON CONFLICT … DO UPDATE … WHERE status != 'running'
 * so that concurrent callers cannot both claim the lock in the same tick.
 *
 * Returns true if the lock was acquired (job can proceed).
 * Returns false if the job is already running (caller should skip this tick).
 */
export async function acquireJobLock(jobName: string): Promise<boolean> {
  try {
    // Single atomic upsert: insert the row if it doesn't exist, then
    // conditionally flip status to 'running' only when it is NOT already running.
    // The UPDATE branch fires only when the WHERE clause matches, so
    // rowCount == 0 means "already running" and rowCount == 1 means "acquired".
    const result = await pool.query(
      `INSERT INTO background_jobs (job_name, status, last_started_at, run_count, consecutive_failures, updated_at)
         VALUES ($1, 'running', NOW(), 0, 0, NOW())
       ON CONFLICT (job_name) DO UPDATE
         SET status = 'running',
             last_started_at = NOW(),
             updated_at = NOW()
         WHERE background_jobs.status <> 'running'
       RETURNING id`,
      [jobName]
    );

    if (result.rowCount === 0) {
      console.log(`[JobRegistry] ${jobName} is already running — skipping tick`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[JobRegistry] acquireJobLock failed for ${jobName}:`, err);
    // Fail open so a registry error never permanently blocks a worker
    return true;
  }
}

/**
 * Release the job lock after execution completes.
 * Pass success=true for a successful run, false for failure (with optional error message).
 */
export async function releaseJobLock(
  jobName: string,
  success: boolean,
  error?: string
): Promise<void> {
  try {
    const [row] = await db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.jobName, jobName))
      .limit(1);

    if (!row) return;

    const newRunCount = (row.runCount ?? 0) + 1;
    const newConsecutiveFailures = success ? 0 : (row.consecutiveFailures ?? 0) + 1;

    await db
      .update(backgroundJobs)
      .set({
        status: success ? "succeeded" : "failed",
        lastFinishedAt: new Date(),
        lastError: success ? null : (error ?? "Unknown error"),
        runCount: newRunCount,
        consecutiveFailures: newConsecutiveFailures,
        updatedAt: new Date(),
      })
      .where(eq(backgroundJobs.jobName, jobName));
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
