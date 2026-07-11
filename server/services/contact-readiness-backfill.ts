/**
 * Contact Readiness Backfill Service
 *
 * Keyset-paginated, runId-fenced, restart-safe backfill of dataReadinessScore
 * across all CRM contacts. One active run at a time — enforced by:
 *   1. A DB partial unique index on contact_readiness_runs WHERE status='running'
 *      (migration 0059) — prevents concurrent starts even across processes.
 *   2. batchUpdateContactReadinessWithOwnershipCheck() — locks the run row FOR UPDATE
 *      inside each batch transaction so force-interruption cannot race with writes.
 *   3. updateReadinessRun() guards with status='running' — interrupted runs cannot
 *      have their metadata mutated by stale workers.
 *
 * Kill lines:
 * - No OFFSET pagination — uses WHERE id > lastProcessedContactId keyset cursor
 * - No overlapping runs — DB partial unique index + atomic SELECT FOR UPDATE per batch
 * - No fire-and-forget — terminal state (complete/failed) is always persisted
 * - Transactional per batch — batch write + ownership lock in one DB transaction;
 *   cursor advances only AFTER transaction commits
 * - updateReadinessRun is guarded — stale workers cannot mutate interrupted/complete runs
 */
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { computeDataReadinessScore, READINESS_MODEL_VERSION } from "./contact-readiness";

const BATCH_SIZE = 500;
const HEARTBEAT_STALE_MS = 5 * 60 * 1000; // 5 minutes

export type ReadinessBackfillStatus = {
  status: "idle" | "running" | "complete" | "failed" | "interrupted";
  runId?: string;
  modelVersion?: number;
  processed?: number;
  updated?: number;
  skipped?: number;
  errors?: number;
  lastProcessedContactId?: number | null;
  startedAt?: Date | null;
  lastHeartbeatAt?: Date | null;
  completedAt?: Date | null;
  lastError?: string | null;
};

/**
 * Start a readiness backfill run.
 * @param force If true, interrupts any active run regardless of heartbeat age.
 * Returns immediately — the backfill runs in a setImmediate loop.
 */
export async function startReadinessBackfill(force = false): Promise<{ runId: string; message: string }> {
  const existing = await storage.getActiveReadinessRun();

  if (existing) {
    const heartbeatAge = existing.lastHeartbeatAt
      ? Date.now() - new Date(existing.lastHeartbeatAt).getTime()
      : Infinity;
    const isStale = heartbeatAge > HEARTBEAT_STALE_MS;

    if (!force && !isStale) {
      return {
        runId: existing.runId,
        message: `Backfill already running (runId=${existing.runId}, heartbeat ${Math.round(heartbeatAge / 1000)}s ago). Use force=true to interrupt.`,
      };
    }

    // Interrupt the stale/forced run and carry its keyset cursor forward so the
    // replacement run continues from where the interrupted one stopped.
    await storage.updateReadinessRun(existing.runId, {
      status: "interrupted",
      completedAt: new Date(),
      lastError: force
        ? "Interrupted by force=true flag"
        : "Interrupted: heartbeat stale > 5 minutes",
    });
    console.log(`[ReadinessBackfill] Interrupted stale run ${existing.runId}`);
  }

  // Carry the interrupted run's keyset cursor forward (or start from 0 for a fresh start).
  const resumeCursor = existing?.lastProcessedContactId ?? null;

  const runId = randomUUID();
  try {
    await storage.createReadinessRun({
      runId,
      modelVersion: READINESS_MODEL_VERSION,
      status: "running",
      force,
      processed: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      startedAt: new Date(),
      lastHeartbeatAt: new Date(),
      lastProcessedContactId: resumeCursor,
      totalEligible: null,
      completedAt: null,
      lastError: null,
    });
  } catch (err: any) {
    // unique_violation (23505) from the partial unique index on status='running':
    // another process inserted a running row between our check and insert.
    if (err?.code === "23505" || (err?.message ?? "").includes("contact_readiness_runs_singleton_active")) {
      const concurrent = await storage.getActiveReadinessRun();
      return {
        runId: concurrent?.runId ?? "unknown",
        message: `Concurrent start detected — another run is already active (runId=${concurrent?.runId}). Use force=true to interrupt.`,
      };
    }
    throw err;
  }

  console.log(`[ReadinessBackfill] Started run ${runId} (modelVersion=${READINESS_MODEL_VERSION}, force=${force})`);

  // Kick off in the background — never blocks the HTTP response
  setImmediate(() => runBackfillLoop(runId));

  return { runId, message: `Backfill started (runId=${runId})` };
}

async function runBackfillLoop(runId: string): Promise<void> {
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  // Declared OUTSIDE the try block so the catch block can reference it for the
  // terminal-state progress persist without a TypeScript compile error.
  let lastProcessedId = 0;

  try {
    // Claim ownership atomically — bail if another process already owns this run.
    // The returned record also carries lastProcessedContactId so we can resume from
    // the right keyset cursor without a separate DB round-trip.
    const claimed = await storage.claimReadinessRun(runId);
    if (!claimed) {
      console.warn(`[ReadinessBackfill] Run ${runId} already claimed by another process — aborting`);
      return;
    }

    // Resume from the cursor persisted on THIS run record (carried forward from any
    // interrupted predecessor by startReadinessBackfill).
    lastProcessedId = claimed.lastProcessedContactId ?? 0;

    for (;;) {
      // Fetch next batch via keyset cursor
      const batch = await storage.getContactsForReadinessBackfill(lastProcessedId, BATCH_SIZE, READINESS_MODEL_VERSION);

      if (batch.length === 0) {
        // No more stale contacts — backfill complete
        await storage.updateReadinessRun(runId, {
          status: "complete",
          processed,
          updated,
          skipped,
          errors,
          lastProcessedContactId: lastProcessedId === 0 ? null : lastProcessedId,
          completedAt: new Date(),
          lastHeartbeatAt: new Date(),
        });
        console.log(`[ReadinessBackfill] Run ${runId} complete — processed=${processed} updated=${updated} skipped=${skipped} errors=${errors}`);
        return;
      }

      // Score all contacts in batch (pure, no I/O)
      const writes: Array<{ id: number; score: number; grade: string; breakdown: Record<string, unknown> }> = [];
      for (const contact of batch) {
        try {
          const result = computeDataReadinessScore(contact);
          writes.push({
            id: contact.id,
            score: result.score,
            grade: result.grade,
            breakdown: result.breakdown as unknown as Record<string, unknown>,
          });
        } catch (err) {
          errors++;
          console.error(`[ReadinessBackfill] Scoring error for contact ${contact.id}:`, (err as Error).message);
        }
      }

      // Write entire batch in a single DB transaction that also holds a SELECT FOR UPDATE
      // lock on the run row.  If the run was force-interrupted between scoring and writing,
      // the transaction sees status ≠ 'running' and throws — we stop the loop cleanly.
      try {
        await storage.batchUpdateContactReadinessWithOwnershipCheck(runId, writes, READINESS_MODEL_VERSION);
        updated += writes.length;
      } catch (err: any) {
        const isOwnershipLoss = (err?.message ?? "").includes("ownership lost");
        if (isOwnershipLoss) {
          console.warn(`[ReadinessBackfill] Ownership lost for run ${runId} — stopping at id=${lastProcessedId}`);
          return; // Run was interrupted; don't mutate its terminal state
        }
        errors += writes.length;
        console.error(`[ReadinessBackfill] Batch write failed for run ${runId} at id=${lastProcessedId}:`, err.message);
        // Don't advance cursor — contacts remain stale and will be retried
        await storage.updateReadinessRun(runId, {
          processed,
          updated,
          skipped,
          errors,
          lastHeartbeatAt: new Date(),
          lastError: `Batch write failed at id=${lastProcessedId}: ${err.message}`.slice(0, 500),
        });
        await new Promise(resolve => setImmediate(resolve));
        continue;
      }

      processed += batch.length;
      skipped += batch.length - writes.length;

      // Advance keyset cursor AFTER the batch transaction commits — safe because
      // batchUpdateContactReadinessWithOwnershipCheck is fully transactional.
      lastProcessedId = batch[batch.length - 1].id;

      // Persist progress + heartbeat
      await storage.updateReadinessRun(runId, {
        processed,
        updated,
        skipped,
        errors,
        lastProcessedContactId: lastProcessedId,
        lastHeartbeatAt: new Date(),
      });

      if (batch.length < BATCH_SIZE) break; // last partial page — done

      // Yield to event loop between batches
      await new Promise(resolve => setImmediate(resolve));
    }

    // Completed via partial-page exit
    await storage.updateReadinessRun(runId, {
      status: "complete",
      processed,
      updated,
      skipped,
      errors,
      lastProcessedContactId: lastProcessedId === 0 ? null : lastProcessedId,
      completedAt: new Date(),
      lastHeartbeatAt: new Date(),
    });
    console.log(`[ReadinessBackfill] Run ${runId} complete — processed=${processed} updated=${updated} skipped=${skipped} errors=${errors}`);
  } catch (err: any) {
    const msg = (err?.message ?? "Unknown error").slice(0, 500);
    console.error(`[ReadinessBackfill] Run ${runId} failed:`, msg);
    // Note: updateReadinessRun guards with status='running'. If the run was already
    // interrupted, this update is a no-op — that's correct.
    try {
      await storage.updateReadinessRun(runId, {
        status: "failed",
        processed,
        updated,
        skipped,
        errors,
        lastProcessedContactId: lastProcessedId === 0 ? null : lastProcessedId,
        completedAt: new Date(),
        lastHeartbeatAt: new Date(),
        lastError: msg,
      });
    } catch (_) {
      // Nothing we can do if the DB write fails too
    }
  }
}

/**
 * Get the status of the most recent readiness run (any terminal state included).
 */
export async function getReadinessBackfillStatus(): Promise<ReadinessBackfillStatus> {
  const run = await storage.getLatestReadinessRun();
  if (!run) return { status: "idle" };
  return {
    status: run.status as ReadinessBackfillStatus["status"],
    runId: run.runId,
    modelVersion: run.modelVersion,
    processed: run.processed,
    updated: run.updated,
    skipped: run.skipped,
    errors: run.errors,
    lastProcessedContactId: run.lastProcessedContactId,
    startedAt: run.startedAt,
    lastHeartbeatAt: run.lastHeartbeatAt,
    completedAt: run.completedAt,
    lastError: run.lastError,
  };
}
