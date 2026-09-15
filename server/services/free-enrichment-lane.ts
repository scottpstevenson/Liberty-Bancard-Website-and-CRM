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

export type FreeEnrichmentOutcome = "enriched" | "failed" | "skipped";

export interface FreeEnrichmentLaneResult {
  businessId: number;
  outcome: FreeEnrichmentOutcome;
  error?: string;
}

let laneRunning = false;

/**
 * Execute a bounded batch and wait for every member's terminal database state.
 * The dynamic import keeps the lane boundary explicit and avoids importing the
 * broad queue registry at module load time.
 */
export async function runFreeEnrichmentLane(
  businessIds: readonly number[],
): Promise<FreeEnrichmentLaneResult[]> {
  if (laneRunning) throw new Error("FREE_ENRICHMENT_LANE_BUSY");
  laneRunning = true;
  const ids = [...new Set(businessIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const results: FreeEnrichmentLaneResult[] = [];

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
        results.push({ businessId, outcome: "failed", error: String(error?.message ?? error).slice(0, 250) });
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

export async function getFreeEnrichmentLaneStatus(): Promise<Record<string, unknown>> {
  const state = await readLaneState();
  const counts = ((await db.execute(sql`
    SELECT
      COUNT(*)::int AS examined,
      COUNT(*) FILTER (WHERE free_enrichment_status = 'enriched')::int AS enriched,
      COUNT(*) FILTER (WHERE free_enrichment_status = 'skipped')::int AS skipped,
      COUNT(*) FILTER (WHERE free_enrichment_status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE free_enrichment_status IN ('processing'))::int AS running
    FROM businesses
    WHERE free_enrichment_last_attempt_at IS NOT NULL
  `)) as any).rows?.[0] ?? {};
  const pending = ((await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM businesses
    WHERE record_class = 'canonical'
      AND website_domain IS NOT NULL
      AND (free_enrichment_status IS NULL OR free_enrichment_status = 'failed')
  `)) as any).rows?.[0]?.count ?? 0;

  return {
    capabilityGroup: "free-enrichment-lane",
    configured: true,
    running: state.status === "running" || Number(counts.running ?? 0) > 0,
    status: state.status ?? "idle",
    lastRunAt: state.lastRunAt ?? null,
    nextRunAt: null, // manual/pilot lane; deliberately no cron schedule
    examined: Number(state.examined ?? counts.examined ?? 0),
    enriched: Number(state.enriched ?? counts.enriched ?? 0),
    skipped: Number(state.skipped ?? counts.skipped ?? 0),
    failed: Number(state.failed ?? counts.failed ?? 0),
    pending: Number(pending),
    error: state.error ?? null,
  };
}

async function readLaneState(): Promise<Record<string, any>> {
  const result = await db.execute(sql`
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
