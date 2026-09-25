/**
 * Sunbiz full-backlog backfill (Task #2002 completion).
 *
 * Wraps the bounded per-filing bootstrap primitive (sunbiz-bootstrap.ts) in a
 * resumable, corpus-level cursor so the entire ~1.9M-row sunbiz_entities
 * universe can eventually be processed by repeated small microbatches,
 * instead of only manual admin-triggered bounded runs.
 *
 * Durable state lives in the single-row `sunbiz_bootstrap_runs` table
 * (id='default'):
 *   - high_water_entity_id: the highest sunbiz_entities.id examined so far.
 *     Restart-safe — a new process just reads this and resumes with
 *     afterId=high_water_entity_id instead of re-scanning from the start.
 *   - status: idle | running | paused | completed | failed. Starts 'idle' on
 *     every fresh environment (including production, once this table is
 *     provisioned there) — the recurring worker tick is registered
 *     unconditionally but is a no-op unless status='running', so turning the
 *     backfill on is an explicit admin action (resumeSunbizFullBackfill),
 *     never automatic activation.
 *   - lease_owner / lease_expires_at: fenced lease so at most one process
 *     (the recurring worker OR a concurrent manual trigger) advances the
 *     cursor at a time. A stale lease (holder crashed) is reclaimable after
 *     LEASE_TTL_MS.
 *
 * Per-filing idempotency, retry counting, and dead-lettering are unchanged
 * from the bounded primitive (sunbiz_bootstrap_claims); this module only
 * adds the corpus-level "what's next" pointer and pause/resume control.
 */
import { sql } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "../db";
import { selectSunbizBootstrapCandidates, runSunbizBootstrapBatch, SUNBIZ_BACKFILL_MAX_RETRIES } from "./sunbiz-bootstrap";
import { getWorkerCapabilityStatus } from "./queue-manager";
import { QUEUE_NAMES } from "./queue-names";

function rows<T = any>(result: unknown): T[] {
  return (result as { rows?: T[] })?.rows ?? [];
}

const RUN_ID = "default";
const MICROBATCH_LIMIT = 25;
const LEASE_TTL_MS = 5 * 60 * 1000;

/**
 * Pure cursor-advance calculation, extracted so it can be unit-tested without
 * a live database. Given the cursor position the batch started from, the
 * candidate rows it examined, and the per-filing outcomes produced by
 * runSunbizBootstrapBatch(), returns the next high_water_entity_id.
 *
 * Correctness requirement: the cursor must never advance past the id of a
 * row whose outcome is retryable ("failed", not yet "dead_letter") --
 * selectSunbizBootstrapCandidates() only re-offers a retryable-failed
 * filing_number when its id is still > high_water_entity_id, so advancing
 * past it would make that row permanently unreachable even though its claim
 * row says it should be retried. Terminal outcomes (created, matched_existing,
 * deferred_collision, identity_review, already_claimed, dead_letter,
 * lost_lease) never block the advance.
 */
export function computeNextHighWaterEntityId(
  afterId: number,
  candidates: Array<{ id: number; filingNumber: string }>,
  outcomes: Array<{ filingNumber: string; outcome: string }>,
): number {
  const idByFilingNumber = new Map(candidates.map((c) => [c.filingNumber, c.id]));
  const retryableFailedIds = outcomes
    .filter((o) => o.outcome === "failed")
    .map((o) => idByFilingNumber.get(o.filingNumber))
    .filter((id): id is number => typeof id === "number");

  const candidateMaxId = candidates.length === 0 ? afterId : Math.max(afterId, ...candidates.map((c) => c.id));
  if (retryableFailedIds.length === 0) return candidateMaxId;
  return Math.min(candidateMaxId, Math.min(...retryableFailedIds) - 1);
}

export interface SunbizBackfillStatus {
  status: "idle" | "running" | "paused" | "completed" | "failed";
  highWaterEntityId: number;
  totalEntities: number | null;
  remainingEligible: number;
  processedCount: number;
  deadLetterCount: number;
  lastBatchAt: string | null;
  lastError: string | null;
  leaseHeld: boolean;
  /**
   * Task #2002 corrective patch: truthful worker-capability evidence.
   * `status: 'running'` in the DB row means an admin has armed the backfill —
   * it does NOT mean the corpus scan is actually advancing. Callers (the
   * Lead Ops admin UI) must check `workerCapability.active` and surface
   * WORKER_CAPABILITY_NOT_ACTIVE rather than implying progress when false.
   */
  workerCapability: {
    active: boolean;
    /** Machine-readable reason code when active=false; null when active=true. */
    reasonCode: "WORKER_CAPABILITY_NOT_ACTIVE" | null;
    /** BACKGROUND_JOB_PROFILE selects the sunbiz-full-backfill queue at all. */
    selected: boolean;
    /** The QueueManager singleton has finished initializing workers. */
    queueManagerReady: boolean;
    /** A live BullMQ Worker is actually instantiated for this queue right now. */
    workerActive: boolean;
  };
}

function computeWorkerCapability(): SunbizBackfillStatus["workerCapability"] {
  const cap = getWorkerCapabilityStatus(QUEUE_NAMES.SUNBIZ_FULL_BACKFILL);
  const active = cap.selected && cap.queueManagerReady && cap.workerActive;
  return {
    active,
    reasonCode: active ? null : "WORKER_CAPABILITY_NOT_ACTIVE",
    selected: cap.selected,
    queueManagerReady: cap.queueManagerReady,
    workerActive: cap.workerActive,
  };
}

/** Truthful, live-read status for the Lead Ops admin surface. No caching. */
export async function getSunbizFullBackfillStatus(): Promise<SunbizBackfillStatus> {
  const run = rows(await db.execute(sql`
    SELECT status, high_water_entity_id, total_entities, processed_count, dead_letter_count,
           last_batch_at, last_error, lease_owner, lease_expires_at
    FROM sunbiz_bootstrap_runs WHERE id = ${RUN_ID}
  `))[0] as any;

  if (!run) {
    // Table/seed row not provisioned yet in this environment (e.g. before a
    // deploy has run the migration) -- report a truthful "not set up" idle
    // state rather than throwing or fabricating numbers.
    return {
      status: "idle", highWaterEntityId: 0, totalEntities: null, remainingEligible: 0,
      processedCount: 0, deadLetterCount: 0, lastBatchAt: null, lastError: null, leaseHeld: false,
      workerCapability: computeWorkerCapability(),
    };
  }

  const remaining = rows(await db.execute(sql`
    SELECT COUNT(*)::bigint AS n
    FROM sunbiz_entities se
    WHERE se.filing_number IS NOT NULL
      AND se.entity_name IS NOT NULL
      AND se.score IN ('hot', 'warm')
      AND (se.website IS NOT NULL OR se.phone IS NOT NULL
           OR (se.principal_city IS NOT NULL AND se.principal_state IS NOT NULL))
      AND se.id > ${Number(run.high_water_entity_id)}
      AND NOT EXISTS (
        SELECT 1 FROM sunbiz_bootstrap_claims c
        WHERE c.filing_number = se.filing_number
          AND NOT (
            (c.status = 'failed' AND c.retry_count < ${SUNBIZ_BACKFILL_MAX_RETRIES})
            OR (c.status = 'claimed' AND c.claimed_at < now() - interval '15 minutes')
          )
      )
  `))[0] as any;

  const leaseHeld = !!run.lease_owner && run.lease_expires_at && new Date(run.lease_expires_at).getTime() > Date.now();

  return {
    status: run.status,
    highWaterEntityId: Number(run.high_water_entity_id),
    totalEntities: run.total_entities == null ? null : Number(run.total_entities),
    remainingEligible: Number(remaining?.n ?? 0),
    processedCount: Number(run.processed_count),
    deadLetterCount: Number(run.dead_letter_count),
    lastBatchAt: run.last_batch_at ? new Date(run.last_batch_at).toISOString() : null,
    lastError: run.last_error ?? null,
    leaseHeld,
    workerCapability: computeWorkerCapability(),
  };
}

/**
 * Thrown by resumeSunbizFullBackfill() when no worker can actually execute
 * the queue right now. The caller (route handler) must surface this as a
 * rejected resume, never as a silent success -- the DB status is NOT changed
 * to 'running' in this case, so the admin UI can never show "running" while
 * zero workers exist to advance the cursor.
 */
export class WorkerCapabilityInactiveError extends Error {
  readonly reasonCode = "WORKER_CAPABILITY_NOT_ACTIVE" as const;
  readonly capability: SunbizBackfillStatus["workerCapability"];
  constructor(capability: SunbizBackfillStatus["workerCapability"]) {
    super("Cannot resume sunbiz-full-backfill: no active worker can execute the sunbiz-full-backfill queue right now.");
    this.name = "WorkerCapabilityInactiveError";
    this.capability = capability;
  }
}

/**
 * Admin-triggered: arms the recurring worker to start (or continue) advancing
 * the cursor. Refuses (throws WorkerCapabilityInactiveError) and leaves the
 * DB status untouched when no worker can actually consume the queue right
 * now -- Resume must never be able to put the run into a 'running' state
 * that the runtime cannot make true.
 *
 * `skipCapabilityCheck` exists ONLY for disposable-DB certification scripts
 * that verify cursor/lease/retry logic without a live QueueManager/Redis --
 * worker-capability wiring itself is covered separately by
 * test-2002-fix-sunbiz-backfill-capability.ts. The admin route never passes
 * this flag.
 */
export async function resumeSunbizFullBackfill(opts: { skipCapabilityCheck?: boolean } = {}): Promise<void> {
  if (!opts.skipCapabilityCheck) {
    const capability = computeWorkerCapability();
    if (!capability.active) {
      throw new WorkerCapabilityInactiveError(capability);
    }
  }
  await db.execute(sql`
    INSERT INTO sunbiz_bootstrap_runs (id, status)
    VALUES (${RUN_ID}, 'running')
    ON CONFLICT (id) DO UPDATE SET status = 'running', last_error = NULL, updated_at = now()
    WHERE sunbiz_bootstrap_runs.status <> 'running'
  `);
}

/** Admin-triggered: the recurring worker becomes a no-op on its next tick. In-flight microbatches still finish. */
export async function pauseSunbizFullBackfill(): Promise<void> {
  await db.execute(sql`
    UPDATE sunbiz_bootstrap_runs SET status = 'paused', updated_at = now()
    WHERE id = ${RUN_ID} AND status = 'running'
  `);
}

/**
 * Processes at most one microbatch of MICROBATCH_LIMIT filings, advancing
 * the durable cursor. Safe to call from a recurring worker tick or a manual
 * "run now" trigger -- concurrent callers race for the fenced lease and only
 * one proceeds; the loser returns immediately with skipped=true.
 */
export async function runSunbizBackfillMicrobatch(): Promise<{ skipped: boolean; reason?: string; processed?: number; completed?: boolean }> {
  const owner = crypto.randomUUID();
  const leaseExpiry = new Date(Date.now() + LEASE_TTL_MS);

  const acquired = rows(await db.execute(sql`
    UPDATE sunbiz_bootstrap_runs
    SET lease_owner = ${owner}, lease_expires_at = ${leaseExpiry.toISOString()}, updated_at = now()
    WHERE id = ${RUN_ID}
      AND status = 'running'
      AND (lease_owner IS NULL OR lease_expires_at < now())
    RETURNING high_water_entity_id
  `)) as Array<{ high_water_entity_id: number }>;

  if (acquired.length === 0) {
    // Either not 'running' (idle/paused/completed -- the "disabled by
    // default" no-op path), or another executor currently holds the lease.
    return { skipped: true, reason: "not_running_or_leased" };
  }

  const afterId = Number(acquired[0].high_water_entity_id);

  try {
    const candidates = await selectSunbizBootstrapCandidates(MICROBATCH_LIMIT, { afterId });

    if (candidates.length === 0) {
      // No more eligible entities ahead of the cursor -- the corpus scan is
      // done (terminal claims + dead-letters aside; those are permanently
      // excluded by design, not silently dropped).
      await db.execute(sql`
        UPDATE sunbiz_bootstrap_runs
        SET status = 'completed', lease_owner = NULL, lease_expires_at = NULL,
            last_batch_at = now(), updated_at = now()
        WHERE id = ${RUN_ID} AND lease_owner = ${owner}
      `);
      return { skipped: false, processed: 0, completed: true };
    }

    const outcomes = await runSunbizBootstrapBatch(MICROBATCH_LIMIT, { afterId });
    const deadLettered = outcomes.filter((o) => o.outcome === "dead_letter").length;
    // See computeNextHighWaterEntityId() doc comment: the cursor must never
    // advance past a still-retryable ("failed") row, or it becomes
    // permanently unreachable even though it's eligible for retry.
    const maxIdSeen = computeNextHighWaterEntityId(afterId, candidates, outcomes);

    await db.execute(sql`
      UPDATE sunbiz_bootstrap_runs
      SET high_water_entity_id = ${maxIdSeen},
          processed_count = processed_count + ${outcomes.length},
          dead_letter_count = dead_letter_count + ${deadLettered},
          lease_owner = NULL, lease_expires_at = NULL,
          last_batch_at = now(), last_error = NULL, updated_at = now()
      WHERE id = ${RUN_ID} AND lease_owner = ${owner}
    `);
    return { skipped: false, processed: outcomes.length };
  } catch (err: any) {
    await db.execute(sql`
      UPDATE sunbiz_bootstrap_runs
      SET lease_owner = NULL, lease_expires_at = NULL,
          last_error = ${String(err?.message ?? err).slice(0, 500)}, updated_at = now()
      WHERE id = ${RUN_ID} AND lease_owner = ${owner}
    `);
    throw err;
  }
}
