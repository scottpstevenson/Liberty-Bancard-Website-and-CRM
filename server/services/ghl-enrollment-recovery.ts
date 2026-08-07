/**
 * GHL Enrollment Recovery — atomic, crash-safe, exponential-backoff retry.
 *
 * Storage: `deferred_ghl_enrollments` PostgreSQL table (migration 0106).
 * Replaces the previous system_settings JSON-blob + in-process mutex approach,
 * which was not safe across multiple autoscale instances.
 *
 * Design principles:
 *  • deferGhlEnrollment()       → atomic UPSERT — no read-modify-write race
 *  • retryDeferredEnrollments() → UPDATE … RETURNING to claim a batch before
 *    processing; crash-safe because unclaimed rows retry after the claim window
 *  • Exponential back-off: 30 min → 1 h → 2 h → 4 h → 8 h (±5 % jitter)
 *  • MAX_RETRIES = 5; at retry 4 a "final attempt" warning is emitted so ops
 *    can intervene before permanent failure
 *  • Non-retryable config errors are dropped immediately (no retry budget waste)
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { auditChange } from "./audit-change";

const MAX_RETRIES  = 5;
const PROCESS_BATCH = 20;

// Claim window: how far ahead we push next_retry_at when claiming a row for
// processing.  If the worker crashes mid-flight the row becomes visible again
// after this window, ensuring no silent permanent loss.
const CLAIM_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Compute next-retry delay with exponential back-off + ±5 % jitter. */
function nextRetryDelayMs(retryCount: number): number {
  const base    = 30 * 60 * 1000;          // 30-minute base
  const cap     = 8  * 60 * 60 * 1000;     // 8-hour ceiling
  const raw     = base * Math.pow(2, retryCount);
  const capped  = Math.min(raw, cap);
  const jitter  = capped * 0.05 * (Math.random() * 2 - 1);
  return Math.round(capped + jitter);
}

/** Errors that are transient and worth retrying. */
export function isTransientGhlError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /timeout|timed out/i.test(msg) ||
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(msg) ||
    /5\d{2}/.test(msg) ||              // 5xx HTTP errors
    /circuit.*open|circuit breaker/i.test(msg) ||
    /network error|fetch failed/i.test(msg) ||
    /429/.test(msg)                    // rate-limit
  );
}

export interface DeferredEnrollment {
  id: string;
  ghlContactId: string;
  workflowKey: string;
  metadata?: Record<string, any>;
  enqueuedAt: string;
  retryCount: number;
  nextRetryAt: string;
  lastError: string;
  status: "pending" | "failed";
}

/**
 * Persist a failed enrollment so the recovery job can retry it.
 * Idempotent: if the same (ghlContactId, workflowKey) already exists, updates
 * lastError and resets nextRetryAt without touching retryCount.
 * Never throws — a failure to persist must not crash the caller's request.
 */
export async function deferGhlEnrollment(params: {
  ghlContactId: string;
  workflowKey: string;
  metadata?: Record<string, any>;
  error: unknown;
}): Promise<void> {
  const { ghlContactId, workflowKey, metadata, error } = params;
  const id        = `${ghlContactId}::${workflowKey}`;
  const lastError = error instanceof Error ? error.message : String(error);
  const delayMs   = nextRetryDelayMs(0);
  const nextRetryAt = new Date(Date.now() + delayMs).toISOString();

  try {
    await db.execute(sql`
      INSERT INTO deferred_ghl_enrollments
        (id, ghl_contact_id, workflow_key, metadata,
         enqueued_at, retry_count, next_retry_at, last_error, status)
      VALUES
        (${id}, ${ghlContactId}, ${workflowKey},
         ${metadata ? JSON.stringify(metadata) : null}::jsonb,
         NOW(), 0, ${nextRetryAt}::timestamptz, ${lastError}, 'pending')
      ON CONFLICT (id) DO UPDATE SET
        last_error    = EXCLUDED.last_error,
        next_retry_at = EXCLUDED.next_retry_at
      WHERE deferred_ghl_enrollments.status = 'pending'
    `);
    console.warn(
      `[GHL Recovery] Deferred enrollment queued: workflowKey=${workflowKey}` +
      ` ghlContactId=${ghlContactId} error="${lastError}"`
    );
  } catch (storageErr) {
    // Never let the deferral mechanism crash the caller
    console.error("[GHL Recovery] Failed to save deferred enrollment:", storageErr);
  }
}

/**
 * Called by the BullMQ repeatable job every 30 minutes.
 *
 * Atomically claims a batch of due entries by pushing their nextRetryAt
 * forward (the "claim window"), then processes each one.  If the process
 * crashes mid-batch, claimed rows become eligible again after the claim
 * window — no silent data loss.
 */
export async function retryDeferredEnrollments(): Promise<{
  attempted: number;
  succeeded: number;
  permanentlyFailed: number;
  stillPending: number;
}> {
  const stats = { attempted: 0, succeeded: 0, permanentlyFailed: 0, stillPending: 0 };

  // Count total pending for reporting (non-locking)
  const pendingResult = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM deferred_ghl_enrollments
    WHERE status = 'pending'
  `);
  const totalPending = Number((pendingResult.rows[0] as any)?.cnt ?? 0);

  if (totalPending === 0) return stats;

  // Atomically claim a batch: push next_retry_at forward so concurrent workers
  // (or a crash-restart) won't pick up the same rows.
  const claimWindowAt = new Date(Date.now() + CLAIM_WINDOW_MS).toISOString();
  const claimed = await db.execute(sql`
    UPDATE deferred_ghl_enrollments
    SET    next_retry_at = ${claimWindowAt}::timestamptz
    WHERE  id IN (
      SELECT id
      FROM   deferred_ghl_enrollments
      WHERE  status = 'pending'
        AND  next_retry_at <= NOW()
      ORDER  BY next_retry_at
      LIMIT  ${PROCESS_BATCH}
    )
    RETURNING
      id, ghl_contact_id, workflow_key, metadata,
      retry_count, last_error, enqueued_at
  `);

  const rows = claimed.rows as Array<{
    id: string;
    ghl_contact_id: string;
    workflow_key: string;
    metadata: any;
    retry_count: number;
    last_error: string;
    enqueued_at: string;
  }>;

  if (rows.length === 0) {
    stats.stillPending = totalPending;
    return stats;
  }

  stats.stillPending = totalPending - rows.length;

  // Import lazily to avoid circular deps
  const { enrollInGhlWorkflow } = await import("./ghl-workflows");

  for (const entry of rows) {
    stats.attempted++;

    // Permanently fail if retry budget exhausted
    if (entry.retry_count >= MAX_RETRIES) {
      await db.execute(sql`
        UPDATE deferred_ghl_enrollments
        SET status = 'failed', failed_at = NOW()
        WHERE id = ${entry.id}
      `);
      await auditChange({
        actorType: "system",
        action: "ghl_enrollment_permanently_failed",
        entityType: "ghl_sync",
        entityKey: entry.ghl_contact_id,
        details: {
          workflowKey: entry.workflow_key,
          ghlContactId: entry.ghl_contact_id,
          metadata: entry.metadata,
          enqueuedAt: entry.enqueued_at,
          retryCount: entry.retry_count,
          lastError: entry.last_error,
        },
      }).catch(e => console.error("[GHL Recovery] audit log failed:", e));
      console.error(
        `[GHL Recovery] Permanently failed after ${entry.retry_count} retries:` +
        ` workflowKey=${entry.workflow_key} ghlContactId=${entry.ghl_contact_id}` +
        ` lastError="${entry.last_error}"`
      );
      stats.permanentlyFailed++;
      continue;
    }

    // Warn loudly on the last attempt before permanent failure
    if (entry.retry_count === MAX_RETRIES - 1) {
      console.warn(
        `[GHL Recovery] ⚠ FINAL RETRY (${entry.retry_count + 1}/${MAX_RETRIES}):` +
        ` workflowKey=${entry.workflow_key} ghlContactId=${entry.ghl_contact_id}` +
        ` — will be permanently dropped on next failure`
      );
    }

    try {
      const result = await enrollInGhlWorkflow({
        workflowKey: entry.workflow_key,
        ghlContactId: entry.ghl_contact_id,
        metadata: {
          ...(entry.metadata ?? {}),
          _recovery: true,
          _retryCount: entry.retry_count + 1,
        },
        // Prevent infinite deferral recursion inside enrollInGhlWorkflow
        _isRecoveryAttempt: true,
      } as any);

      if (result.success) {
        // Success — remove the row
        await db.execute(sql`
          DELETE FROM deferred_ghl_enrollments WHERE id = ${entry.id}
        `);
        await auditChange({
          actorType: "system",
          action: "ghl_enrollment_recovered",
          entityType: "ghl_sync",
          entityKey: entry.ghl_contact_id,
          details: {
            workflowKey: entry.workflow_key,
            retryCount: entry.retry_count + 1,
            enqueuedAt: entry.enqueued_at,
          },
        }).catch(() => {});
        console.log(
          `[GHL Recovery] Recovered: workflowKey=${entry.workflow_key}` +
          ` ghlContactId=${entry.ghl_contact_id} (attempt ${entry.retry_count + 1})`
        );
        stats.succeeded++;
      } else {
        // Non-retryable config error → drop without burning retry budget
        const errMsg = result.error ?? "enrollment returned success:false";
        if (
          errMsg.includes("not configured") ||
          (errMsg.includes("Workflow") && errMsg.includes("not configured"))
        ) {
          await db.execute(sql`
            DELETE FROM deferred_ghl_enrollments WHERE id = ${entry.id}
          `);
          console.warn(
            `[GHL Recovery] Dropping non-retryable: workflowKey=${entry.workflow_key}` +
            ` reason="${errMsg}"`
          );
          stats.permanentlyFailed++;
        } else {
          throw new Error(errMsg);
        }
      }
    } catch (retryErr) {
      // Failed — update retry count and schedule next attempt with back-off
      const newRetryCount = entry.retry_count + 1;
      const lastError     = retryErr instanceof Error ? retryErr.message : String(retryErr);
      const delayMs       = nextRetryDelayMs(newRetryCount);
      const nextRetryAt   = new Date(Date.now() + delayMs).toISOString();

      await db.execute(sql`
        UPDATE deferred_ghl_enrollments
        SET retry_count   = ${newRetryCount},
            last_error    = ${lastError},
            next_retry_at = ${nextRetryAt}::timestamptz
        WHERE id = ${entry.id}
      `).catch(e =>
        console.error("[GHL Recovery] Failed to update retry state:", e)
      );

      const delayMin = Math.round(delayMs / 60000);
      console.warn(
        `[GHL Recovery] Retry ${newRetryCount}/${MAX_RETRIES} failed:` +
        ` workflowKey=${entry.workflow_key} ghlContactId=${entry.ghl_contact_id}` +
        ` error="${lastError}" — next retry in ~${delayMin} min`
      );
      stats.stillPending++;
    }
  }

  console.log(
    `[GHL Recovery] Tick complete —` +
    ` attempted=${stats.attempted} succeeded=${stats.succeeded}` +
    ` permanentlyFailed=${stats.permanentlyFailed} stillPending=${stats.stillPending}`
  );
  return stats;
}

/**
 * Return a snapshot of the pending deferred-enrollment queue for admin visibility.
 * Used by GET /api/admin/ghl-deferred-queue.
 */
export async function getDeferredEnrollmentQueue(): Promise<{
  pending: DeferredEnrollment[];
  recentlyFailed: DeferredEnrollment[];
}> {
  const pendingRows = await db.execute(sql`
    SELECT id, ghl_contact_id, workflow_key, metadata,
           enqueued_at, retry_count, next_retry_at, last_error, status
    FROM   deferred_ghl_enrollments
    WHERE  status = 'pending'
    ORDER  BY next_retry_at
    LIMIT  100
  `);
  const failedRows = await db.execute(sql`
    SELECT id, ghl_contact_id, workflow_key, metadata,
           enqueued_at, retry_count, next_retry_at, last_error, status
    FROM   deferred_ghl_enrollments
    WHERE  status = 'failed'
    ORDER  BY failed_at DESC
    LIMIT  50
  `);

  const toObj = (r: any): DeferredEnrollment => ({
    id: r.id,
    ghlContactId: r.ghl_contact_id,
    workflowKey: r.workflow_key,
    metadata: r.metadata,
    enqueuedAt: r.enqueued_at,
    retryCount: r.retry_count,
    nextRetryAt: r.next_retry_at,
    lastError: r.last_error,
    status: r.status,
  });

  return {
    pending: (pendingRows.rows as any[]).map(toObj),
    recentlyFailed: (failedRows.rows as any[]).map(toObj),
  };
}
