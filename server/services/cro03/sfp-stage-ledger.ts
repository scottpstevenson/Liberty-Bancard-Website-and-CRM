/**
 * sfp-stage-ledger.ts (Task #2001, PM-10)
 *
 * Canonical run/item accounting for SFP campaign staging. Both the manual
 * preview/execute path (sfp-campaign-staging-v2.ts) and the recurring
 * worker (sfp-campaign-staging-worker.ts) write through this module so a
 * staging mutation, its item outcome, and the run's aggregate counters can
 * never diverge:
 *
 * - Every staged command (manual or recurring) gets its own durable
 *   `sfp_stage_runs` row and one `sfp_stage_items` row per business
 *   attempted, not just recurring-worker-driven ones.
 * - A successful item's completion is written INSIDE the same transaction
 *   as the staging mutation (see markStageItemCompletedInTx), so a crash
 *   between "intent committed" and "item marked complete" cannot happen —
 *   they are the same commit.
 * - Run-level counters are never incremented ad hoc (`processed_count =
 *   processed_count + N`), which can double count across a resumed/retried
 *   tick. They are always recomputed from the authoritative item rows via
 *   reconcileStageRunCounters(), so the run row can never show a count that
 *   disagrees with the items that actually exist.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

export const CAMPAIGN_STAGING_PROVIDER = "campaign_staging";

/** Idempotent: returns the existing run if idempotencyKey already has one. */
export async function getOrCreateStageRun(opts: {
  cohortRunId: string;
  actorId: string;
  idempotencyKey: string;
  maxItems: number;
}): Promise<string> {
  const created = rows(await db.execute(sql`
    INSERT INTO sfp_stage_runs
      (cohort_run_id, stage, idempotency_key, actor_id, state, max_items, provider_keys, estimated_cost_micros, started_at)
    VALUES (${opts.cohortRunId}::uuid, 'campaign_staging', ${opts.idempotencyKey}, ${opts.actorId}, 'running', ${opts.maxItems}, '[]'::jsonb, 0, NOW())
    ON CONFLICT (stage, idempotency_key) DO NOTHING
    RETURNING id
  `))[0];
  if (created) return String(created.id);
  const existing = rows(await db.execute(sql`
    SELECT id FROM sfp_stage_runs WHERE stage = 'campaign_staging' AND idempotency_key = ${opts.idempotencyKey} LIMIT 1
  `))[0];
  if (!existing) throw new Error(`sfp_stage_ledger: failed to get-or-create stage run for idempotency key ${opts.idempotencyKey}`);
  return String(existing.id);
}

/** Idempotent: one item row per (stageRunId, businessId, provider). */
export async function ensureStageItem(stageRunId: string, businessId: number): Promise<string> {
  const inserted = rows(await db.execute(sql`
    INSERT INTO sfp_stage_items (stage_run_id, business_id, provider, state)
    VALUES (${stageRunId}::uuid, ${businessId}, ${CAMPAIGN_STAGING_PROVIDER}, 'pending')
    ON CONFLICT (stage_run_id, business_id, provider) DO NOTHING
    RETURNING id
  `))[0];
  if (inserted) return String(inserted.id);
  const existing = rows(await db.execute(sql`
    SELECT id FROM sfp_stage_items
     WHERE stage_run_id = ${stageRunId}::uuid AND business_id = ${businessId} AND provider = ${CAMPAIGN_STAGING_PROVIDER}
     LIMIT 1
  `))[0];
  if (!existing) throw new Error(`sfp_stage_ledger: failed to get-or-create stage item for run ${stageRunId} business ${businessId}`);
  return String(existing.id);
}

/**
 * Marks an item completed as part of the caller's own transaction — this
 * MUST be called with the same `tx` the staging mutation itself committed
 * in, so the item's completion and the mutation are one atomic commit.
 * Idempotent against a resumed retry that already completed this item.
 */
/**
 * Retry-contract correction: `incrementAttempt` defaults to true for the
 * manual flow, which never claims a stage item (no prior attempt_count bump
 * exists to account for). The recurring worker DOES bump attempt_count once
 * at claim time (see sfp-campaign-staging-worker.ts) to mark that a real
 * attempt has started, so it passes `incrementAttempt: false` here — a
 * second bump on completion/dead-letter would silently count every actual
 * worker attempt twice against MAX_ATTEMPTS.
 */
export async function markStageItemCompletedInTx(tx: any, itemId: string, outcomeCode = "ready_held", opts?: { incrementAttempt?: boolean }): Promise<void> {
  const incrementAttempt = opts?.incrementAttempt ?? true;
  await tx.execute(sql`
    UPDATE sfp_stage_items
       SET state = 'completed', outcome_code = ${outcomeCode},
           attempt_count = attempt_count ${incrementAttempt ? sql`+ 1` : sql``},
           completed_at = NOW(), updated_at = NOW(), lease_expires_at = NULL
     WHERE id = ${itemId}::uuid AND state <> 'completed'
  `);
}

/** Manual-flow items are single-attempt: a rejection or a thrown mutation error goes straight to dead_letter (no retry schedule). */
export async function markStageItemDeadLetter(itemId: string, outcomeCode: string, opts?: { incrementAttempt?: boolean }): Promise<void> {
  const incrementAttempt = opts?.incrementAttempt ?? true;
  await db.execute(sql`
    UPDATE sfp_stage_items
       SET state = 'dead_letter', outcome_code = ${outcomeCode.slice(0, 200)},
           attempt_count = attempt_count ${incrementAttempt ? sql`+ 1` : sql``},
           completed_at = NOW(), updated_at = NOW(), lease_expires_at = NULL
     WHERE id = ${itemId}::uuid AND state NOT IN ('completed', 'dead_letter')
  `);
}

export interface StageRunCounters {
  selected: number;
  processed: number;
  succeeded: number;
  failed: number;
}

/**
 * Recomputes selected/processed/succeeded/failed directly from the item
 * rows that exist for this run and writes those exact numbers — never an
 * incremental delta — so the run row can never drift from reality across
 * retries, resumed ticks, or partial crashes. Returns the counters used.
 */
export async function reconcileStageRunCounters(runId: string, opts?: { setState?: string; terminalReason?: string | null }): Promise<StageRunCounters> {
  const c = rows(await db.execute(sql`
    SELECT
      COUNT(*)::int AS selected,
      COUNT(*) FILTER (WHERE state <> 'pending')::int AS processed,
      COUNT(*) FILTER (WHERE state = 'completed')::int AS succeeded,
      COUNT(*) FILTER (WHERE state = 'dead_letter')::int AS failed
    FROM sfp_stage_items
    WHERE stage_run_id = ${runId}::uuid AND provider = ${CAMPAIGN_STAGING_PROVIDER}
  `))[0];
  const counters: StageRunCounters = {
    selected: Number(c?.selected ?? 0), processed: Number(c?.processed ?? 0),
    succeeded: Number(c?.succeeded ?? 0), failed: Number(c?.failed ?? 0),
  };
  if (opts?.setState) {
    await db.execute(sql`
      UPDATE sfp_stage_runs
         SET selected_count = ${counters.selected}, processed_count = ${counters.processed},
             succeeded_count = ${counters.succeeded}, failed_count = ${counters.failed},
             state = ${opts.setState}, terminal_reason = ${opts.terminalReason ?? null},
             completed_at = NOW(), lease_expires_at = NULL, updated_at = NOW()
       WHERE id = ${runId}::uuid
    `);
  } else {
    await db.execute(sql`
      UPDATE sfp_stage_runs
         SET selected_count = ${counters.selected}, processed_count = ${counters.processed},
             succeeded_count = ${counters.succeeded}, failed_count = ${counters.failed},
             updated_at = NOW()
       WHERE id = ${runId}::uuid
    `);
  }
  return counters;
}
