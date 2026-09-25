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
import { selectSunbizBootstrapCandidateWindow, runSunbizBootstrapBatch, SUNBIZ_BACKFILL_MAX_RETRIES } from "./sunbiz-bootstrap";
import { getWorkerCapabilityStatus } from "./queue-manager";
import { QUEUE_NAMES } from "./queue-names";
import { CRO03A_GEOGRAPHY_REFERENCE_VERSION } from "./cro03a/geography";

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
   * South Florida prioritization (Task #2002 corrective patch): the corpus
   * scan runs in two ordered phases over the SAME full id range --
   * 'south_florida' first (Miami-Dade/Broward/Palm Beach only, per the
   * versioned CRO-03A geography reference), then 'remaining' (everything
   * else, including rows the first phase examined and found ineligible).
   * 'completed' means both phases finished; no row in the eligible universe
   * is ever silently skipped -- the 'remaining' phase re-scans the entire id
   * range from 0 regardless of where the South Florida phase's cursor
   * ended up, and per-filing idempotency (sunbiz_bootstrap_claims) makes
   * re-examining an already-claimed id a no-op rather than reprocessing it.
   */
  phase: "south_florida" | "remaining" | "completed";
  geographyReferenceVersion: string;
  southFlorida: {
    highWaterEntityId: number;
    processedCount: number;
    deadLetterCount: number;
    remainingEligible: number;
  };
  remainingUniverse: {
    highWaterEntityId: number;
    processedCount: number;
    deadLetterCount: number;
    remainingEligible: number;
  };
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

/**
 * Base eligibility predicate shared by both phases -- everything except the
 * geography filter and the cursor bound, which vary per phase/lane.
 */
const BASE_ELIGIBILITY_SQL = sql`
  se.filing_number IS NOT NULL
  AND se.entity_name IS NOT NULL
  AND se.score IN ('hot', 'warm')
  AND (se.website IS NOT NULL OR se.phone IS NOT NULL
       OR (se.principal_city IS NOT NULL AND se.principal_state IS NOT NULL))
  AND NOT EXISTS (
    SELECT 1 FROM sunbiz_bootstrap_claims c
    WHERE c.filing_number = se.filing_number
      AND NOT (
        (c.status = 'failed' AND c.retry_count < ${SUNBIZ_BACKFILL_MAX_RETRIES})
        OR (c.status = 'claimed' AND c.claimed_at < now() - interval '15 minutes')
      )
  )
`;

/**
 * Counts remaining-eligible rows for a lane by pulling candidate identity
 * evidence and evaluating it in-process with the same
 * evaluateSouthFloridaGeography() reference used for selection, so this
 * count can never drift from what selectSunbizBootstrapCandidateWindow()
 * would actually pick up. Bounded to a sample cap to keep this cheap on a
 * ~1.9M-row table; returns the exact count when the lane has fewer
 * remaining rows than the cap, otherwise a floor ("at least this many").
 */
const REMAINING_COUNT_SAMPLE_CAP = 5000;

async function countRemainingEligible(
  afterId: number,
  geography: "south_florida" | "any",
): Promise<{ count: number; isFloor: boolean }> {
  if (geography === "any") {
    const result = rows(await db.execute(sql`
      SELECT COUNT(*)::bigint AS n FROM sunbiz_entities se
      WHERE ${BASE_ELIGIBILITY_SQL} AND se.id > ${afterId}
    `))[0] as any;
    return { count: Number(result?.n ?? 0), isFloor: false };
  }

  const sampleRows = rows(await db.execute(sql`
    SELECT se.principal_state, se.principal_city, se.principal_zip
    FROM sunbiz_entities se
    WHERE ${BASE_ELIGIBILITY_SQL} AND se.id > ${afterId}
    ORDER BY se.id ASC
    LIMIT ${REMAINING_COUNT_SAMPLE_CAP}
  `)) as any[];
  const { isSouthFloridaEligible } = await import("./sunbiz-bootstrap");
  const eligibleInSample = sampleRows.filter((r) =>
    isSouthFloridaEligible({
      principalState: r.principal_state ?? null,
      principalCity: r.principal_city ?? null,
      principalZip: r.principal_zip ?? null,
    }),
  ).length;
  return { count: eligibleInSample, isFloor: sampleRows.length === REMAINING_COUNT_SAMPLE_CAP };
}

/** Truthful, live-read status for the Lead Ops admin surface. No caching. */
export async function getSunbizFullBackfillStatus(): Promise<SunbizBackfillStatus> {
  const run = rows(await db.execute(sql`
    SELECT status, phase, high_water_entity_id, total_entities, processed_count, dead_letter_count,
           soflo_high_water_entity_id, remaining_high_water_entity_id,
           soflo_processed_count, soflo_dead_letter_count,
           remaining_processed_count, remaining_dead_letter_count,
           geography_reference_version,
           last_batch_at, last_error, lease_owner, lease_expires_at
    FROM sunbiz_bootstrap_runs WHERE id = ${RUN_ID}
  `))[0] as any;

  const emptyLane = { highWaterEntityId: 0, processedCount: 0, deadLetterCount: 0, remainingEligible: 0 };
  if (!run) {
    // Table/seed row not provisioned yet in this environment (e.g. before a
    // deploy has run the migration) -- report a truthful "not set up" idle
    // state rather than throwing or fabricating numbers.
    return {
      status: "idle", highWaterEntityId: 0, totalEntities: null, remainingEligible: 0,
      processedCount: 0, deadLetterCount: 0, lastBatchAt: null, lastError: null, leaseHeld: false,
      phase: "south_florida", geographyReferenceVersion: CRO03A_GEOGRAPHY_REFERENCE_VERSION,
      southFlorida: emptyLane, remainingUniverse: emptyLane,
      workerCapability: computeWorkerCapability(),
    };
  }

  const sofloAfterId = Number(run.soflo_high_water_entity_id ?? 0);
  const remainingAfterId = Number(run.remaining_high_water_entity_id ?? 0);

  const [sofloRemaining, remainingRemaining] = await Promise.all([
    countRemainingEligible(sofloAfterId, "south_florida"),
    countRemainingEligible(remainingAfterId, "any"),
  ]);

  const leaseHeld = !!run.lease_owner && run.lease_expires_at && new Date(run.lease_expires_at).getTime() > Date.now();

  return {
    status: run.status,
    highWaterEntityId: Number(run.high_water_entity_id),
    totalEntities: run.total_entities == null ? null : Number(run.total_entities),
    remainingEligible: sofloRemaining.count + remainingRemaining.count,
    processedCount: Number(run.processed_count),
    deadLetterCount: Number(run.dead_letter_count),
    lastBatchAt: run.last_batch_at ? new Date(run.last_batch_at).toISOString() : null,
    lastError: run.last_error ?? null,
    leaseHeld,
    phase: (run.phase ?? "south_florida") as SunbizBackfillStatus["phase"],
    geographyReferenceVersion: run.geography_reference_version ?? CRO03A_GEOGRAPHY_REFERENCE_VERSION,
    southFlorida: {
      highWaterEntityId: sofloAfterId,
      processedCount: Number(run.soflo_processed_count ?? 0),
      deadLetterCount: Number(run.soflo_dead_letter_count ?? 0),
      remainingEligible: sofloRemaining.count,
    },
    remainingUniverse: {
      highWaterEntityId: remainingAfterId,
      processedCount: Number(run.remaining_processed_count ?? 0),
      deadLetterCount: Number(run.remaining_dead_letter_count ?? 0),
      remainingEligible: remainingRemaining.count,
    },
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
    INSERT INTO sunbiz_bootstrap_runs (id, status, phase, geography_reference_version)
    VALUES (${RUN_ID}, 'running', 'south_florida', ${CRO03A_GEOGRAPHY_REFERENCE_VERSION})
    ON CONFLICT (id) DO UPDATE SET status = 'running', last_error = NULL, updated_at = now(),
      geography_reference_version = COALESCE(sunbiz_bootstrap_runs.geography_reference_version, ${CRO03A_GEOGRAPHY_REFERENCE_VERSION})
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
export async function runSunbizBackfillMicrobatch(): Promise<{ skipped: boolean; reason?: string; processed?: number; completed?: boolean; phase?: string; phaseTransition?: boolean }> {
  const owner = crypto.randomUUID();
  const leaseExpiry = new Date(Date.now() + LEASE_TTL_MS);

  const acquired = rows(await db.execute(sql`
    UPDATE sunbiz_bootstrap_runs
    SET lease_owner = ${owner}, lease_expires_at = ${leaseExpiry.toISOString()}, updated_at = now()
    WHERE id = ${RUN_ID}
      AND status = 'running'
      AND (lease_owner IS NULL OR lease_expires_at < now())
    RETURNING phase, soflo_high_water_entity_id, remaining_high_water_entity_id
  `)) as Array<{ phase: string; soflo_high_water_entity_id: number; remaining_high_water_entity_id: number }>;

  if (acquired.length === 0) {
    // Either not 'running' (idle/paused/completed -- the "disabled by
    // default" no-op path), or another executor currently holds the lease.
    return { skipped: true, reason: "not_running_or_leased" };
  }

  const phase = (acquired[0].phase ?? "south_florida") as "south_florida" | "remaining";
  const geography = phase === "south_florida" ? "south_florida" : "any";
  const afterId = phase === "south_florida"
    ? Number(acquired[0].soflo_high_water_entity_id)
    : Number(acquired[0].remaining_high_water_entity_id);

  try {
    const { candidates, maxIdExamined } = await selectSunbizBootstrapCandidateWindow(MICROBATCH_LIMIT, { afterId, geography });

    if (candidates.length === 0) {
      if (maxIdExamined !== null && maxIdExamined > afterId) {
        // South-Florida-only scans can walk long runs of non-South-Florida
        // ids without finding an eligible candidate. Advance the lane
        // cursor to the highest id actually examined so the NEXT tick
        // doesn't re-fetch and re-evaluate the same ineligible window --
        // this never skips a row: the 'remaining' phase below re-scans the
        // ENTIRE id range from 0 independently of this lane's cursor, so
        // every id ineligible for South Florida is still guaranteed a pass.
        const col = phase === "south_florida" ? sql`soflo_high_water_entity_id` : sql`remaining_high_water_entity_id`;
        await db.execute(sql`
          UPDATE sunbiz_bootstrap_runs
          SET ${col} = ${maxIdExamined},
              lease_owner = NULL, lease_expires_at = NULL,
              last_batch_at = now(), last_error = NULL, updated_at = now()
          WHERE id = ${RUN_ID} AND lease_owner = ${owner}
        `);
        return { skipped: false, processed: 0, phase };
      }

      if (phase === "south_florida") {
        // South Florida lane fully exhausted (no eligible row anywhere
        // ahead of the cursor) -- advance to the remaining-universe pass.
        // The remaining pass starts its OWN independent cursor at 0 and
        // scans the full id range with no geography filter, so every row
        // this lane found ineligible (or never reached) still gets a pass;
        // nothing is silently skipped.
        await db.execute(sql`
          UPDATE sunbiz_bootstrap_runs
          SET phase = 'remaining', lease_owner = NULL, lease_expires_at = NULL,
              last_batch_at = now(), last_error = NULL, updated_at = now()
          WHERE id = ${RUN_ID} AND lease_owner = ${owner}
        `);
        return { skipped: false, processed: 0, phaseTransition: true, phase: "remaining" };
      }

      // Remaining-universe lane fully exhausted -- both phases are done.
      await db.execute(sql`
        UPDATE sunbiz_bootstrap_runs
        SET status = 'completed', phase = 'completed', lease_owner = NULL, lease_expires_at = NULL,
            last_batch_at = now(), updated_at = now()
        WHERE id = ${RUN_ID} AND lease_owner = ${owner}
      `);
      return { skipped: false, processed: 0, completed: true, phase: "completed" };
    }

    const outcomes = await runSunbizBootstrapBatch(MICROBATCH_LIMIT, { afterId }, candidates.map((c) => c.filingNumber));
    const deadLettered = outcomes.filter((o) => o.outcome === "dead_letter").length;
    // See computeNextHighWaterEntityId() doc comment: the cursor must never
    // advance past a still-retryable ("failed") row, or it becomes
    // permanently unreachable even though it's eligible for retry. Use the
    // wider maxIdExamined (not just the eligible candidates' max id) as the
    // upper bound so a South-Florida-lane batch also skips past the
    // ineligible ids it already scanned in this same window.
    const candidateMaxAdvance = computeNextHighWaterEntityId(afterId, candidates, outcomes);
    // When nothing in this batch is still-retryable, it's safe to advance
    // the cursor to the widest id actually examined in the scan window
    // (maxIdExamined), not just the highest *eligible* candidate id -- this
    // is what lets a South-Florida-lane batch skip past a long run of
    // ineligible ids without re-scanning them on every tick.
    const hasRetryable = outcomes.some((o) => o.outcome === "failed");
    const nextCursor = hasRetryable ? candidateMaxAdvance : (maxIdExamined ?? candidateMaxAdvance);

    const cursorCol = phase === "south_florida" ? sql`soflo_high_water_entity_id` : sql`remaining_high_water_entity_id`;
    const processedCol = phase === "south_florida" ? sql`soflo_processed_count` : sql`remaining_processed_count`;
    const deadLetterCol = phase === "south_florida" ? sql`soflo_dead_letter_count` : sql`remaining_dead_letter_count`;

    await db.execute(sql`
      UPDATE sunbiz_bootstrap_runs
      SET ${cursorCol} = ${nextCursor},
          high_water_entity_id = GREATEST(high_water_entity_id, ${nextCursor}),
          ${processedCol} = ${processedCol} + ${outcomes.length},
          ${deadLetterCol} = ${deadLetterCol} + ${deadLettered},
          processed_count = processed_count + ${outcomes.length},
          dead_letter_count = dead_letter_count + ${deadLettered},
          lease_owner = NULL, lease_expires_at = NULL,
          last_batch_at = now(), last_error = NULL, updated_at = now()
      WHERE id = ${RUN_ID} AND lease_owner = ${owner}
    `);
    return { skipped: false, processed: outcomes.length, phase };
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
