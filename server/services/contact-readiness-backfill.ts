/**
 * Contact Readiness Backfill Service
 *
 * Keyset-paginated, runId-fenced, restart-safe backfill of dataReadinessScore
 * across all CRM contacts. One active run at a time — enforced by the
 * `contact_readiness_runs` table and atomic claimReadinessRun() check.
 *
 * Kill lines:
 * - No OFFSET pagination — uses WHERE id > lastProcessedContactId keyset cursor
 * - No overlapping runs — runId claim before each batch commit
 * - No fire-and-forget — terminal state (complete/failed) is always persisted
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

    // Interrupt the stale/forced run
    await storage.updateReadinessRun(existing.runId, {
      status: "interrupted",
      completedAt: new Date(),
      lastError: force
        ? "Interrupted by force=true flag"
        : "Interrupted: heartbeat stale > 5 minutes",
    });
    console.log(`[ReadinessBackfill] Interrupted stale run ${existing.runId}`);
  }

  // Carry the interrupted run's keyset cursor forward so a restarted run
  // continues from where the interrupted one left off, not from id=0.
  const resumeCursor = existing?.lastProcessedContactId ?? null;

  const runId = randomUUID();
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
    // interrupted predecessor by startReadinessBackfill).  Never use getLatestReadinessRun()
    // here — it could return a different run's cursor after a race.
    let lastProcessedId: number = claimed.lastProcessedContactId ?? 0;

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
          writes.push({ id: contact.id, score: result.score, grade: result.grade, breakdown: result.breakdown as unknown as Record<string, unknown> });
        } catch (err) {
          errors++;
          console.error(`[ReadinessBackfill] Scoring error for contact ${contact.id}:`, (err as Error).message);
        }
      }

      // Verify ownership is still valid before committing writes
      const stillOwned = await storage.claimReadinessRun(runId);
      if (!stillOwned) {
        console.warn(`[ReadinessBackfill] Ownership lost for run ${runId} — stopping at id=${lastProcessedId}`);
        return;
      }

      // Write all successfully-scored contacts
      for (const w of writes) {
        try {
          await storage.updateContactReadiness(w.id, w.score, w.grade, w.breakdown, READINESS_MODEL_VERSION);
          updated++;
        } catch (err) {
          errors++;
          console.error(`[ReadinessBackfill] Write error for contact ${w.id}:`, (err as Error).message);
        }
      }

      processed += batch.length;
      skipped += batch.length - writes.length;

      // Advance keyset cursor to the last ID in this batch AFTER writes complete so
      // that cursor advancement only happens after the batch is durably committed.
      // Using the last batch contact's ID (not per-contact) ensures consistent paging.
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
