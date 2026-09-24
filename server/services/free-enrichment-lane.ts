/**
 * MI-09 Level 1 free-only enrichment lane.
 *
 * The lane is intentionally a small orchestration boundary around the
 * canonical free-business executor. It has no provider imports and exposes
 * only terminal outcomes to callers. The executor itself is the existing
 * kill-line implementation in queue-manager.ts (RDAP, JSON-LD, first-party
 * contact pages, HTML processor detection and CRO-03 evidence persistence).
 *
 * Do not add paid-provider, AI, GHL, outreach, or contact-writer calls here.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
import { QUEUE_NAMES } from "./queue-names";

export type FreeEnrichmentOutcome = "enriched" | "failed" | "skipped";

export interface FreeEnrichmentLaneResult {
  businessId: number;
  outcome: FreeEnrichmentOutcome;
  error?: string;
}

interface RepeatableSchedule {
  id?: string | null;
  every?: number | string | null;
  next?: number;
  pattern?: string | null;
}

interface FreeLaneStatusQueue {
  getRepeatableJobs(): Promise<RepeatableSchedule[]>;
  getJobCounts(...types: string[]): Promise<Record<string, number>>;
}

interface FreeLaneStatusDependencies {
  /** Optional read-only source seam for deterministic schedule-status tests. */
  db?: { execute(query: any): Promise<any> };
  queueManager?: {
    getQueue(name: string): FreeLaneStatusQueue | undefined;
    workers?: Map<string, { isRunning(): boolean }>;
  };
}

/**
 * BullMQ's repeatable-job metadata exposes `next` as an epoch-millisecond
 * timestamp. Older/partial metadata can omit it; for interval schedules,
 * derive the next cadence from the last execution (or the Unix-epoch interval
 * boundary, matching BullMQ's `every` cadence).
 */
export function getRepeatableNextRunAt(
  schedule: RepeatableSchedule | undefined,
  lastRunAt?: string | Date | null,
  nowMs = Date.now(),
): string | null {
  if (!schedule) return null;
  if (typeof schedule.next === "number" && Number.isFinite(schedule.next) && schedule.next > 0) {
    return new Date(schedule.next).toISOString();
  }

  const everyMs = Number(schedule.every);
  if (!Number.isFinite(everyMs) || everyMs <= 0) return null;
  const lastRunMs = lastRunAt
    ? lastRunAt instanceof Date
      ? lastRunAt.getTime()
      : new Date(lastRunAt).getTime()
    : Number.NaN;
  const anchorMs = Number.isFinite(lastRunMs) ? lastRunMs : 0;
  const intervalsElapsed = Math.floor((nowMs - anchorMs) / everyMs) + 1;
  return new Date(anchorMs + Math.max(1, intervalsElapsed) * everyMs).toISOString();
}

let laneRunning = false;

/**
 * Execute a bounded batch and wait for every member's terminal database state.
 * The dynamic import keeps the lane boundary explicit and avoids importing the
 * broad queue registry at module load time.
 */
/**
 * Preflight: confirm every free_enrichment_* column the lane writes actually
 * exists in the businesses table. A missing column would silently turn every
 * UPDATE into a PostgreSQL error, leaving free_enrichment_status=null for
 * the entire batch. This probe surfaces that as an immediate, named failure
 * rather than 20/20 silent losses per tick.
 */
async function assertFreeEnrichmentColumnsExist(): Promise<void> {
  const REQUIRED_COLUMNS = [
    "free_enrichment_status",
    "free_enrichment_attempt_count",
    "free_enrichment_last_attempt_at",
    "free_enrichment_completed_at",
    "free_enrichment_last_error_code",
    "free_enrichment_evidence",
  ] as const;

  const result = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'businesses'
      AND column_name = ANY(ARRAY[${sql.raw(REQUIRED_COLUMNS.map((c) => `'${c}'`).join(","))}])
  `);
  const found = new Set(((result as any).rows ?? result).map((r: any) => r.column_name as string));
  const missing = REQUIRED_COLUMNS.filter((c) => !found.has(c));
  if (missing.length > 0) {
    throw new Error(
      `FREE_ENRICHMENT_COLUMN_PREFLIGHT_FAILED: businesses table is missing column(s): ${missing.join(", ")}. ` +
      `Run migration 0250_free_enrichment_pipeline.sql against this database before starting the lane.`,
    );
  }
}

export async function runFreeEnrichmentLane(
  businessIds: readonly number[],
): Promise<FreeEnrichmentLaneResult[]> {
  if (laneRunning) throw new Error("FREE_ENRICHMENT_LANE_BUSY");
  laneRunning = true;
  const ids = [...new Set(businessIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const results: FreeEnrichmentLaneResult[] = [];

  // Fail loudly if the DB schema is missing required columns. This turns silent
  // 20/20 batch failures (each UPDATE throws a column-not-found SQL error that
  // was previously swallowed) into a single clear error logged before any work.
  try {
    await assertFreeEnrichmentColumnsExist();
  } catch (preflightErr: any) {
    console.error(`[FreeEnrichLane] Column preflight failed — aborting lane: ${preflightErr.message}`);
    laneRunning = false;
    await writeLaneState({ status: "error", error: preflightErr.message, lastRunAt: new Date().toISOString() }).catch(() => {});
    throw preflightErr;
  }

  await writeLaneState({ status: "running", total: ids.length, examined: 0, enriched: 0, skipped: 0, failed: 0 });
  try {
    // This is the sole execution seam. It is exported from queue-manager only
    // so the governed pilot lane can await the same implementation used by the
    // free queue handler; no paid queue is consulted.
    const { runFreeBusinessEnrichmentForBusiness } = await import("./queue-manager");
    for (const businessId of ids) {
      try {
        await runFreeBusinessEnrichmentForBusiness(businessId);
      } catch (error: any) {
        const errorMsg = String(error?.message ?? error).slice(0, 250);
        console.error(
          `[FreeEnrichLane] Business ${businessId} threw before claim UPDATE — status stays null. Error: ${errorMsg}`,
        );
        // Persist the failure to DB so the row doesn't silently re-queue on the next tick.
        // This UPDATE is intentionally unconditional: if the row is still null (no claim was
        // executed), write failed; if the function's own try/catch already wrote failed, the
        // WHERE guard makes this a safe no-op.
        await db.execute(sql`
          UPDATE businesses
          SET free_enrichment_status = 'failed',
              free_enrichment_last_error_code = 'LANE_UNCAUGHT_PRE_CLAIM',
              free_enrichment_last_attempt_at  = COALESCE(free_enrichment_last_attempt_at, NOW()),
              free_enrichment_attempt_count    = COALESCE(free_enrichment_attempt_count, 0) + 1
          WHERE id = ${businessId}
            AND (free_enrichment_status IS NULL OR free_enrichment_status = 'processing')
        `).catch((dbErr: any) =>
          console.error(`[FreeEnrichLane] Business ${businessId} — could not persist pre-claim failure: ${dbErr?.message}`)
        );
        results.push({ businessId, outcome: "failed", error: errorMsg });
        continue;
      }

      const row = ((await db.execute(sql`
        SELECT free_enrichment_status
        FROM businesses
        WHERE id = ${businessId}
      `)) as any).rows?.[0];
      const status = String(row?.free_enrichment_status ?? "skipped");
      results.push({
        businessId,
        outcome: status === "enriched" ? "enriched" : status === "failed" ? "failed" : "skipped",
      });
    }
    return results;
  } finally {
    laneRunning = false;
    const counts = results.reduce((acc, result) => {
      acc[result.outcome]++;
      return acc;
    }, { enriched: 0, skipped: 0, failed: 0 } as Record<FreeEnrichmentOutcome, number>);
    await writeLaneState({
      status: "idle",
      total: ids.length,
      examined: results.length,
      ...counts,
      lastRunAt: new Date().toISOString(),
    });
  }
}

export async function getFreeEnrichmentLaneStatus(
  dependencies: FreeLaneStatusDependencies = {},
): Promise<Record<string, unknown>> {
  const statusDb = dependencies.db ?? db;
  const state = await readLaneState(statusDb);
  const queueManagerApi = dependencies.queueManager
    ? null
    : await import("./queue-manager");
  let queueRegistered = false;
  let workerRunning = false;
  let activeJobs = 0;
  let nextRunAt: string | null = null;

  // Status reads must never lazily initialize the worker fleet. A queue can be
  // registered in BullMQ/Redis without a live local worker, so report those
  // states separately instead of treating registration as "running".
  const queueManagerReady = dependencies.queueManager
    ? true
    : Boolean(queueManagerApi?.isQueueManagerReady());
  if (queueManagerReady) {
    const queueManager = dependencies.queueManager
      ?? queueManagerApi!.requireQueueManagerReady() as any;
    const queue = queueManager.getQueue(QUEUE_NAMES.FREE_ENRICHMENT_LANE);
    const worker = queueManager.workers?.get(QUEUE_NAMES.FREE_ENRICHMENT_LANE);
    queueRegistered = Boolean(queue);
    workerRunning = Boolean(worker?.isRunning?.());

    if (queue) {
      const [repeatableJobs, jobCounts] = await Promise.all([
        queue.getRepeatableJobs(),
        queue.getJobCounts("active"),
      ]);
      // The queue's base schedule is installed under this exact job id.
      // Match it preferentially; tolerate other repeatable entries if one is
      // present, while never claiming a schedule that does not exist.
      const schedule = repeatableJobs.find((job: any) =>
        job.id === `${QUEUE_NAMES.FREE_ENRICHMENT_LANE}-repeatable`
      ) ?? repeatableJobs[0];
      nextRunAt = getRepeatableNextRunAt(schedule, state.lastRunAt);
      activeJobs = Number(jobCounts.active ?? 0);
    }
  }

  const counts = ((await statusDb.execute(sql`
    SELECT
      COUNT(*)::int AS examined,
      COUNT(*) FILTER (WHERE free_enrichment_status = 'enriched')::int AS enriched,
      COUNT(*) FILTER (WHERE free_enrichment_status = 'skipped')::int AS skipped,
      COUNT(*) FILTER (WHERE free_enrichment_status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE free_enrichment_status IN ('processing'))::int AS running
    FROM businesses
    WHERE free_enrichment_last_attempt_at IS NOT NULL
  `)) as any).rows?.[0] ?? {};
  const pending = ((await statusDb.execute(sql`
    SELECT COUNT(*)::int AS count FROM businesses
    WHERE record_class = 'canonical'
      AND website_domain IS NOT NULL
      AND (free_enrichment_status IS NULL OR free_enrichment_status = 'failed')
  `)) as any).rows?.[0]?.count ?? 0;
  const processingBusinesses = Number(counts.running ?? 0);
  const running = laneRunning || (workerRunning && (activeJobs > 0 || processingBusinesses > 0));
  const status = running
    ? "running"
    : !workerRunning
      ? "unavailable"
      : state.status === "error"
        ? "error"
        : "idle";

  return {
    capabilityGroup: "free-enrichment-lane",
    configured: true,
    running,
    status,
    queueRegistered,
    workerRunning,
    lastRunAt: state.lastRunAt ?? null,
    nextRunAt,
    examined: Number(state.examined ?? counts.examined ?? 0),
    enriched: Number(state.enriched ?? counts.enriched ?? 0),
    skipped: Number(state.skipped ?? counts.skipped ?? 0),
    failed: Number(state.failed ?? counts.failed ?? 0),
    pending: Number(pending),
    error: state.error ?? null,
  };
}

async function readLaneState(statusDb: { execute(query: any): Promise<any> } = db): Promise<Record<string, any>> {
  const result = await statusDb.execute(sql`
    SELECT value FROM system_settings WHERE key = 'free_enrichment_lane_status' LIMIT 1
  `);
  const value = ((result as any).rows ?? result)[0]?.value;
  if (!value) return { status: "idle" };
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function writeLaneState(value: Record<string, unknown>): Promise<void> {
  await db.execute(sql`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES ('free_enrichment_lane_status', ${JSON.stringify(value)}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `).catch(() => {});
}
