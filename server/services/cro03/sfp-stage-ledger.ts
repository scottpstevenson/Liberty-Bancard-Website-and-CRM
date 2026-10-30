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
       -- A claim settled by recovery as superseded stays superseded: a late stale writer cannot turn it into a second success.
       AND NOT (state = 'skipped' AND COALESCE(redacted_result, '{}'::jsonb) ? 'recovery')
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

export interface ExpiredClaimSettlement {
  /** Items whose governed intent another run already completed; closed as `skipped`, linked to that completion. */
  superseded: number;
  /** Items released for this run to claim again (attempt history kept). */
  released: number;
  /** Items released with no attempts left; closed as dead_letter. */
  exhausted: number;
}

/**
 * Settles `claimed` items left on a run by an earlier claim generation (a worker that died or lost its lease), once
 * the run has been reclaimed. Every write is fenced on the caller still owning the running generation
 * (`claimToken`), so a stale caller changes nothing, and only items of an OLDER generation are touched.
 *
 *  - The governed intent already exists (another run completed it): the old item becomes `skipped`, with
 *    `redacted_result.recovery` naming the completing item, run and intent. It is never a second success.
 *  - No completion exists: the item is released as `retry` (due now) so the reclaiming run claims it again under
 *    its own token, or closed as `dead_letter` when attempts are exhausted.
 * Nothing is deleted, restaged or cleaned in bulk, and attempt_count is never reduced.
 */
export async function settleExpiredClaimedItems(
  runId: string, claimToken: string, opts: { maxAttempts: number },
): Promise<ExpiredClaimSettlement> {
  const fenced = sql`EXISTS (SELECT 1 FROM sfp_stage_runs gr WHERE gr.id = ${runId}::uuid
    AND gr.claim_token = ${claimToken}::uuid AND gr.state = 'running')`;
  const superseded = rows(await db.execute(sql`
    WITH winners AS (
      SELECT old.id AS old_id, w.id AS winner_id, w.stage_run_id AS winner_run_id, w.intent_id
        FROM sfp_stage_items old
        JOIN sfp_stage_runs r ON r.id = old.stage_run_id
        CROSS JOIN LATERAL (SELECT wi.id, wi.stage_run_id, it.id AS intent_id
                              FROM sfp_stage_items wi
                              JOIN sfp_campaign_staging_intents it ON it.business_id = wi.business_id
                               AND it.cohort_run_id = r.cohort_run_id AND it.state IN ('staged', 'operator_selected', 'ready_held', 'promoted')
                             WHERE wi.business_id = old.business_id AND wi.provider = old.provider
                               AND wi.state = 'completed' AND wi.id <> old.id
                             ORDER BY wi.completed_at DESC NULLS LAST, wi.id LIMIT 1) w
       WHERE old.stage_run_id = ${runId}::uuid AND old.provider = ${CAMPAIGN_STAGING_PROVIDER}
         AND old.state = 'claimed' AND old.claim_token IS DISTINCT FROM ${claimToken}::uuid)
    UPDATE sfp_stage_items o
       SET state = 'skipped', outcome_code = 'superseded_by_completed_intent',
           completed_at = NOW(), lease_expires_at = NULL, updated_at = NOW(),
           redacted_result = COALESCE(o.redacted_result, '{}'::jsonb) || jsonb_build_object('recovery', jsonb_build_object(
             'v', 1, 'kind', 'superseded', 'supersededByItemId', wn.winner_id::text, 'supersededByRunId', wn.winner_run_id::text,
             'intentId', wn.intent_id::text, 'expiredClaimToken', o.claim_token::text,
             'expiredLeaseAt', to_char(o.lease_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'attemptCount', o.attempt_count, 'settledByClaim', ${claimToken}::text,
             'settledAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
      FROM winners wn
     WHERE o.id = wn.old_id AND o.state = 'claimed' AND ${fenced}
    RETURNING o.id
  `)).length;
  const released = rows(await db.execute(sql`
    UPDATE sfp_stage_items
       SET state = 'retry', next_attempt_at = NOW(), lease_expires_at = NULL, updated_at = NOW(),
           outcome_code = 'lease_expired_released',
           redacted_result = COALESCE(redacted_result, '{}'::jsonb) || jsonb_build_object('recovery', jsonb_build_object(
             'v', 1, 'kind', 'released', 'expiredClaimToken', claim_token::text, 'attemptCount', attempt_count,
             'settledByClaim', ${claimToken}::text,
             'settledAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
     WHERE stage_run_id = ${runId}::uuid AND provider = ${CAMPAIGN_STAGING_PROVIDER}
       AND state = 'claimed' AND claim_token IS DISTINCT FROM ${claimToken}::uuid
       AND attempt_count < ${opts.maxAttempts} AND ${fenced}
    RETURNING id
  `)).length;
  const exhausted = rows(await db.execute(sql`
    UPDATE sfp_stage_items
       SET state = 'dead_letter', outcome_code = 'lease_expired_max_attempts', completed_at = NOW(),
           lease_expires_at = NULL, updated_at = NOW(),
           redacted_result = COALESCE(redacted_result, '{}'::jsonb) || jsonb_build_object('recovery', jsonb_build_object(
             'v', 1, 'kind', 'exhausted', 'expiredClaimToken', claim_token::text, 'attemptCount', attempt_count,
             'settledByClaim', ${claimToken}::text,
             'settledAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
     WHERE stage_run_id = ${runId}::uuid AND provider = ${CAMPAIGN_STAGING_PROVIDER}
       AND state = 'claimed' AND claim_token IS DISTINCT FROM ${claimToken}::uuid
       AND attempt_count >= ${opts.maxAttempts} AND ${fenced}
    RETURNING id
  `)).length;
  if (superseded + released + exhausted > 0) await reconcileStageRunCounters(runId);
  return { superseded, released, exhausted };
}
