/**
 * GHL Enrollment Recovery — deferred retry for transient enrollment failures.
 *
 * When enrollInGhlWorkflow() fails due to a transient error (network timeout,
 * 5xx, circuit open), callers invoke deferGhlEnrollment() to persist the
 * attempt.  A BullMQ repeatable job (every 30 minutes) calls
 * retryDeferredEnrollments() to re-attempt each pending record.
 *
 * Storage: system_settings key "deferred_ghl_enrollments" holds a JSON array
 * of DeferredEnrollment records.  No schema migration is required.
 *
 * Idempotency: before re-enrolling, the function checks whether the contact
 * already has a GHL contact ID and re-attempts the trigger; the GHL API itself
 * is idempotent for workflow triggers (duplicate enrollments are a no-op on
 * already-active workflows).
 *
 * Retry cap: after MAX_RETRIES attempts the record is removed and an audit log
 * entry "ghl_enrollment_permanently_failed" is written.
 */

import { storage } from "../storage";
import { auditChange } from "./audit-change";

const SETTINGS_KEY = "deferred_ghl_enrollments";
const MAX_RETRIES = 3;
const RETRY_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * In-process mutex that serializes all load-modify-save operations on the
 * deferred-enrollment queue.  Without this, concurrent async callers (e.g. two
 * simultaneous enrollment failures) can each load the same stale queue, make
 * independent edits, and the last writer silently overwrites the first.
 *
 * The mutex is a single Promise that each new operation chains onto; every
 * caller acquires the lock by appending itself to the chain and releasing by
 * resolving its own wrapper.  This is safe in a single Node.js process where
 * there is only one event loop.
 */
let _queueMutex: Promise<void> = Promise.resolve();

function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = _queueMutex.then(fn);
  // Even if fn rejects, subsequent lock holders must still run.
  _queueMutex = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Errors that are worth retrying (transient). */
export function isTransientGhlError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /timeout|timed out/i.test(msg) ||
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(msg) ||
    /5\d{2}/.test(msg) ||              // 500, 502, 503, 504 …
    /circuit.*open|circuit breaker/i.test(msg) ||
    /network error|fetch failed/i.test(msg) ||
    /429/.test(msg)                    // rate-limit counts as transient too
  );
}

export interface DeferredEnrollment {
  /** Unique key: prevents duplicates for the same contact+workflow */
  id: string;
  ghlContactId: string;
  workflowKey: string;
  metadata?: Record<string, any>;
  /** ISO string */
  enqueuedAt: string;
  retryCount: number;
  /** ISO string — when the next retry is allowed */
  nextRetryAt: string;
  lastError: string;
}

async function loadQueue(): Promise<DeferredEnrollment[]> {
  try {
    const raw = await storage.getSystemSetting(SETTINGS_KEY);
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as DeferredEnrollment[];
    // Stored as a JSON string in some DB drivers
    if (typeof raw === "string") return JSON.parse(raw) as DeferredEnrollment[];
    return [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: DeferredEnrollment[]): Promise<void> {
  await storage.setSystemSetting(SETTINGS_KEY, queue);
}

/**
 * Persist a failed enrollment so the recovery job can retry it.
 * Idempotent: if an entry for the same (ghlContactId, workflowKey) already
 * exists, the retryCount and lastError are updated but the enqueue time is
 * preserved.
 */
export async function deferGhlEnrollment(params: {
  ghlContactId: string;
  workflowKey: string;
  metadata?: Record<string, any>;
  error: unknown;
}): Promise<void> {
  const { ghlContactId, workflowKey, metadata, error } = params;
  const id = `${ghlContactId}::${workflowKey}`;
  const lastError = error instanceof Error ? error.message : String(error);

  try {
    await withQueueLock(async () => {
      const queue = await loadQueue();
      const existing = queue.find(e => e.id === id);

      if (existing) {
        existing.lastError = lastError;
        existing.nextRetryAt = new Date(Date.now() + RETRY_INTERVAL_MS).toISOString();
      } else {
        queue.push({
          id,
          ghlContactId,
          workflowKey,
          metadata,
          enqueuedAt: new Date().toISOString(),
          retryCount: 0,
          nextRetryAt: new Date(Date.now() + RETRY_INTERVAL_MS).toISOString(),
          lastError,
        });
      }

      await saveQueue(queue);
    });
    console.warn(
      `[GHL Recovery] Deferred enrollment queued: workflowKey=${workflowKey} ghlContactId=${ghlContactId} error="${lastError}"`
    );
  } catch (storageErr) {
    // Never let the deferral mechanism itself crash the caller
    console.error("[GHL Recovery] Failed to save deferred enrollment:", storageErr);
  }
}

/**
 * Called by the BullMQ repeatable job every 30 minutes.
 * Retries each pending enrollment whose nextRetryAt has passed.
 * After MAX_RETRIES failures, writes a permanent-failure audit log and removes
 * the record.
 */
export async function retryDeferredEnrollments(): Promise<{
  attempted: number;
  succeeded: number;
  permanentlyFailed: number;
  stillPending: number;
}> {
  return withQueueLock(() => _retryDeferredEnrollmentsLocked());
}

async function _retryDeferredEnrollmentsLocked(): Promise<{
  attempted: number;
  succeeded: number;
  permanentlyFailed: number;
  stillPending: number;
}> {
  const stats = { attempted: 0, succeeded: 0, permanentlyFailed: 0, stillPending: 0 };

  let queue: DeferredEnrollment[];
  try {
    queue = await loadQueue();
  } catch (err) {
    console.error("[GHL Recovery] Could not load deferred enrollment queue:", err);
    return stats;
  }

  if (queue.length === 0) return stats;

  const now = Date.now();
  const due = queue.filter(e => new Date(e.nextRetryAt).getTime() <= now);

  stats.stillPending = queue.length - due.length;

  // Import lazily to avoid circular deps
  const { enrollInGhlWorkflow } = await import("./ghl-workflows");

  for (const entry of due) {
    stats.attempted++;

    if (entry.retryCount >= MAX_RETRIES) {
      // Terminal — write permanent-failure audit log and drop
      await auditChange({
        actorType: "system",
        action: "ghl_enrollment_permanently_failed",
        entityType: "ghl_sync",
        entityKey: entry.ghlContactId,
        details: {
          workflowKey: entry.workflowKey,
          ghlContactId: entry.ghlContactId,
          metadata: entry.metadata,
          enqueuedAt: entry.enqueuedAt,
          retryCount: entry.retryCount,
          lastError: entry.lastError,
        },
      }).catch(e => console.error("[GHL Recovery] Failed to write permanent-failure audit log:", e));

      console.error(
        `[GHL Recovery] Permanently failed after ${entry.retryCount} retries: workflowKey=${entry.workflowKey} ghlContactId=${entry.ghlContactId} lastError="${entry.lastError}"`
      );

      queue = queue.filter(e => e.id !== entry.id);
      stats.permanentlyFailed++;
      continue;
    }

    // Attempt the enrollment
    try {
      const result = await enrollInGhlWorkflow({
        workflowKey: entry.workflowKey,
        ghlContactId: entry.ghlContactId,
        metadata: {
          ...(entry.metadata ?? {}),
          _recovery: true,
          _retryCount: entry.retryCount + 1,
        },
        // Signal that this is a recovery call so enrollInGhlWorkflow does NOT
        // call deferGhlEnrollment again (prevents infinite deferral recursion)
        _isRecoveryAttempt: true,
      } as any);

      if (result.success) {
        console.log(
          `[GHL Recovery] Successfully recovered enrollment: workflowKey=${entry.workflowKey} ghlContactId=${entry.ghlContactId} (attempt ${entry.retryCount + 1})`
        );
        await auditChange({
          actorType: "system",
          action: "ghl_enrollment_recovered",
          entityType: "ghl_sync",
          entityKey: entry.ghlContactId,
          details: {
            workflowKey: entry.workflowKey,
            retryCount: entry.retryCount + 1,
            enqueuedAt: entry.enqueuedAt,
          },
        }).catch(() => {});
        queue = queue.filter(e => e.id !== entry.id);
        stats.succeeded++;
      } else {
        // Non-retryable config errors: drop without counting against retry budget
        const errMsg = result.error ?? "enrollment returned success:false";
        if (
          errMsg.includes("not configured") ||
          errMsg.includes("Workflow") && errMsg.includes("not configured")
        ) {
          console.warn(
            `[GHL Recovery] Dropping deferred enrollment — non-retryable: workflowKey=${entry.workflowKey} reason="${errMsg}"`
          );
          queue = queue.filter(e => e.id !== entry.id);
          stats.permanentlyFailed++;
        } else {
          throw new Error(errMsg);
        }
      }
    } catch (retryErr) {
      const updatedEntry = queue.find(e => e.id === entry.id);
      if (updatedEntry) {
        updatedEntry.retryCount = entry.retryCount + 1;
        updatedEntry.lastError = retryErr instanceof Error ? retryErr.message : String(retryErr);
        updatedEntry.nextRetryAt = new Date(Date.now() + RETRY_INTERVAL_MS).toISOString();
      }
      console.warn(
        `[GHL Recovery] Retry ${entry.retryCount + 1}/${MAX_RETRIES} failed: workflowKey=${entry.workflowKey} ghlContactId=${entry.ghlContactId} error="${updatedEntry?.lastError}"`
      );
      stats.stillPending++;
    }
  }

  try {
    await saveQueue(queue);
  } catch (saveErr) {
    console.error("[GHL Recovery] Failed to persist updated queue after retries:", saveErr);
  }

  console.log(
    `[GHL Recovery] Tick complete — attempted=${stats.attempted} succeeded=${stats.succeeded} permanentlyFailed=${stats.permanentlyFailed} stillPending=${stats.stillPending}`
  );

  return stats;
}
