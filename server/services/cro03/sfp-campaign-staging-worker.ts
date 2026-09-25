/**
 * Isolated recurring consumer for package-pinned SFP staging.
 *
 * This worker terminates at ready_held. It has no send, enrollment,
 * campaign-dispatch, provider, or GHL responsibilities.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { getBackgroundProfile, getSelectiveGroups } from "../background-profile";
import { SfpStagingV2Error, executeStagingV2, previewStagingV2 } from "./sfp-campaign-staging-v2";
import { reconcileStageRunCounters } from "./sfp-stage-ledger";

const rows = (result: any): any[] => result?.rows ?? result ?? [];
const MAX_BATCH_SIZE = 25;
const MAX_ATTEMPTS = 5;
const LEASE_MINUTES = 30;
const RETRY_DELAYS_MINUTES = [1, 5, 15, 30];

function capabilityIsActive(): boolean {
  const profile = getBackgroundProfile();
  return profile === "full" ||
    (profile === "selective" && getSelectiveGroups().includes("sfp-campaign-staging"));
}

async function getRecurringStageConfig(programId?: string) {
  const program = rows(await db.execute(sql`
    SELECT id, is_active, recurring_enabled,
           COALESCE((schedule_config->>'campaignStaging')::int, 0) AS campaign_staging_batch
      FROM sfp_programs
     WHERE ${programId ? sql`id = ${programId}::uuid` : sql`name = 'south-florida-v1'`}
     LIMIT 1
  `))[0];
  if (!program || !program.is_active || !program.recurring_enabled) return null;
  const configuredBatch = Number(program.campaign_staging_batch);
  if (!Number.isInteger(configuredBatch) || configuredBatch < 1) return null;
  return { programId: String(program.id), batchSize: Math.min(configuredBatch, MAX_BATCH_SIZE) };
}

async function claimStageRun(runId: string): Promise<string> {
  const claimed = rows(await db.execute(sql`
    UPDATE sfp_stage_runs
       SET state='running', claim_token=gen_random_uuid(),
           lease_expires_at=NOW()+(${LEASE_MINUTES} * INTERVAL '1 minute'),
           started_at=COALESCE(started_at,NOW()), last_heartbeat_at=NOW(), updated_at=NOW()
     WHERE id=${runId}::uuid AND stage='campaign_staging' AND (
       state IN ('pending','authorized','stalled')
       OR (state='running' AND lease_expires_at<NOW())
     )
    RETURNING claim_token
  `))[0];
  if (!claimed) throw new Error("SFP_CAMPAIGN_STAGING_RUN_ALREADY_CLAIMED");
  return String(claimed.claim_token);
}

async function renewStageRunClaim(runId: string, claimToken: string): Promise<void> {
  const renewed = rows(await db.execute(sql`
    UPDATE sfp_stage_runs
       SET lease_expires_at=NOW()+(${LEASE_MINUTES} * INTERVAL '1 minute'),
           last_heartbeat_at=NOW(), updated_at=NOW()
     WHERE id=${runId}::uuid AND stage='campaign_staging' AND state='running'
       AND claim_token=${claimToken}::uuid AND lease_expires_at>NOW()
    RETURNING id
  `))[0];
  if (!renewed) throw new Error("SFP_CAMPAIGN_STAGING_CLAIM_LOST");
}

async function prepareRecurringRun(config: { programId: string; batchSize: number }): Promise<string | null> {
  const cohort = rows(await db.execute(sql`
    SELECT r.id
      FROM sfp_cohort_runs r
      JOIN sfp_programs p ON p.id=r.program_id
      JOIN sfp_outreach_eligibility e ON e.cohort_run_id=r.id
     WHERE p.id=${config.programId}::uuid AND p.is_active=TRUE AND p.recurring_enabled=TRUE
       AND COALESCE((p.schedule_config->>'campaignStaging')::int,0)>0
       AND r.cohort_state='frozen' AND r.voided_at IS NULL AND r.superseded_at IS NULL
       AND e.status='validated_outreach_eligible' AND e.staging_intent_id IS NULL
     GROUP BY r.id, r.created_at
     ORDER BY r.created_at DESC
     LIMIT 1
  `))[0];
  if (!cohort) return null;

  const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
  const idempotencyKey = `campaign-staging:${cohort.id}:${bucket}`;
  const created = rows(await db.execute(sql`
    INSERT INTO sfp_stage_runs
      (cohort_run_id, stage, idempotency_key, actor_id, state, max_items, provider_keys, estimated_cost_micros)
    VALUES (${String(cohort.id)}::uuid, 'campaign_staging', ${idempotencyKey},
            'system:sfp-campaign-staging', 'pending', ${config.batchSize}, '[]'::jsonb, 0)
    ON CONFLICT (stage, idempotency_key) DO NOTHING
    RETURNING id
  `))[0];
  return created ? String(created.id) : null;
}

async function failRun(runId: string, claimToken: string, reason: string): Promise<void> {
  await db.execute(sql`
    UPDATE sfp_stage_runs
       SET state='failed', terminal_reason=${reason.slice(0, 500)},
           completed_at=NOW(), updated_at=NOW(), lease_expires_at=NULL
     WHERE id=${runId}::uuid AND claim_token=${claimToken}::uuid AND state='running'
  `);
}

async function processRun(runId: string): Promise<{ processed: number; succeeded: number; failed: number }> {
  const run = rows(await db.execute(sql`
    SELECT r.id, r.cohort_run_id, r.actor_id, r.max_items, r.state, r.claim_token,
           p.id AS program_id, p.is_active, p.recurring_enabled,
           COALESCE((p.schedule_config->>'campaignStaging')::int,0) AS campaign_staging_batch
      FROM sfp_stage_runs r
      JOIN sfp_cohort_runs c ON c.id=r.cohort_run_id
      JOIN sfp_programs p ON p.id=c.program_id
     WHERE r.id=${runId}::uuid AND r.stage='campaign_staging'
       AND c.cohort_state='frozen' AND c.voided_at IS NULL AND c.superseded_at IS NULL
     LIMIT 1
  `))[0];
  if (!run) return { processed: 0, succeeded: 0, failed: 0 };
  const config = await getRecurringStageConfig(String(run.program_id));
  if (!config) return { processed: 0, succeeded: 0, failed: 0 };
  const claimToken = await claimStageRun(runId);
  const limit = Math.max(1, Math.min(Number(run.max_items), config.batchSize, MAX_BATCH_SIZE));

  try {
    await renewStageRunClaim(runId, claimToken);
    const eligible = rows(await db.execute(sql`
      SELECT e.id, e.business_id
        FROM sfp_outreach_eligibility e
       WHERE e.cohort_run_id=${String(run.cohort_run_id)}::uuid
         AND e.status='validated_outreach_eligible' AND e.staging_intent_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM sfp_stage_items i
            WHERE i.stage_run_id=${runId}::uuid AND i.business_id=e.business_id
              AND i.provider='campaign_staging'
              AND (i.state IN ('completed','dead_letter')
                   OR (i.state IN ('retry','claimed') AND i.next_attempt_at>NOW()))
         )
       ORDER BY e.created_at, e.id
       LIMIT ${limit}
    `));
    if (eligible.length === 0) {
      const delayed = rows(await db.execute(sql`
        SELECT COUNT(*)::int AS count FROM sfp_stage_items
         WHERE stage_run_id=${runId}::uuid AND state='retry' AND next_attempt_at>NOW()
      `))[0];
      if (Number(delayed?.count ?? 0) > 0) {
        await reconcileStageRunCounters(runId);
        await db.execute(sql`
          UPDATE sfp_stage_runs SET state='pending', lease_expires_at=NULL, updated_at=NOW()
           WHERE id=${runId}::uuid AND claim_token=${claimToken}::uuid AND state='running'
        `);
        return { processed: 0, succeeded: 0, failed: 0 };
      }
      // PM-10: recompute counters from the item ledger rather than hardcoding
      // zeros — a run can reach "no more eligible rows" after some items were
      // already completed/dead-lettered in an earlier tick, and those must
      // still be reflected in the final counters.
      await reconcileStageRunCounters(runId, { setState: "completed" });
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    for (const item of eligible) {
      await db.execute(sql`
        INSERT INTO sfp_stage_items (stage_run_id, business_id, provider, state)
        VALUES (${runId}::uuid, ${Number(item.business_id)}, 'campaign_staging', 'pending')
        ON CONFLICT (stage_run_id, business_id, provider) DO NOTHING
      `);
    }

    const eligibilityIds = eligible.map((item) => String(item.id));
    await db.execute(sql`
      UPDATE sfp_stage_items
         SET state='claimed', claim_token=${claimToken}::uuid,
             attempt_count=attempt_count+1,
             lease_expires_at=NOW()+(${LEASE_MINUTES} * INTERVAL '1 minute'), updated_at=NOW()
       WHERE stage_run_id=${runId}::uuid AND provider='campaign_staging'
         AND business_id=ANY(ARRAY[${sql.join(eligible.map((item: any) => sql`${Number(item.business_id)}`), sql`, `)}]::int[])
         AND state IN ('pending','retry')
         AND (state='pending' OR next_attempt_at<=NOW())
    `);
    // Retry-contract correction: salt the preview/execute snapshot with this
    // tick's claim token so an unchanged eligibility selection produces a
    // genuinely new commandKey on a genuine retry attempt, instead of
    // replaying the previous attempt's stored (possibly failed) receipt —
    // see previewStagingV2's attemptSalt doc.
    const preview = await previewStagingV2({
      cohortRunId: String(run.cohort_run_id),
      eligibilityIds,
      actorId: String(run.actor_id),
      attemptSalt: claimToken,
    });
    await renewStageRunClaim(runId, claimToken);
    // The command key is server-issued by previewStagingV2() and validated
    // by executeStagingV2() to correspond exactly to cohortRunId+snapshotHash
    // — it must be passed through unmodified. Suffixing it (e.g. with the
    // stage-run ID) makes executeStagingV2() reject every recurring batch
    // with SFP_STAGING_COMMAND_KEY_MISMATCH (see PM-01).
    // Double-ledger fix: pass this worker's OWN stage_run_id through so
    // executeStagingV2()/stageOneRowTransactional() write into the same
    // sfp_stage_items rows this worker already inserted above (matched by
    // stage_run_id + business_id + provider), instead of independently
    // creating a second sfp_stage_runs/sfp_stage_items ledger keyed by
    // commandKey. There is exactly one run and one item per attempted
    // business for this recurring batch.
    const execution = await executeStagingV2({
      cohortRunId: String(run.cohort_run_id),
      eligibilityIds,
      commandKey: preview.commandKey,
      snapshotHash: preview.snapshotHash,
      actorId: String(run.actor_id),
      confirmPayloadHash: preview.payloadHash,
      stageRunId: runId,
      attemptSalt: claimToken,
    });

    // The authoritative completed/dead_letter state for every item in this
    // batch was already written by executeStagingV2 above, into THIS run's
    // items (same stage_run_id). The only worker-specific behavior layered
    // on top is retry backoff: a dead-lettered item below MAX_ATTEMPTS is
    // converted back to 'retry' with a delay instead of staying terminal.
    const batchItems = rows(await db.execute(sql`
      SELECT id, business_id, state, attempt_count FROM sfp_stage_items
       WHERE stage_run_id=${runId}::uuid AND provider='campaign_staging'
         AND business_id=ANY(ARRAY[${sql.join(eligible.map((item: any) => sql`${Number(item.business_id)}`), sql`, `)}]::int[])
    `));
    let succeeded = 0;
    let failed = 0;
    for (const item of batchItems) {
      if (item.state === "completed") { succeeded++; continue; }
      if (item.state !== "dead_letter") continue;
      failed++;
      const attemptCount = Number(item.attempt_count ?? 0);
      const terminal = attemptCount >= MAX_ATTEMPTS;
      if (!terminal) {
        const delay = RETRY_DELAYS_MINUTES[Math.min(Math.max(attemptCount - 1, 0), RETRY_DELAYS_MINUTES.length - 1)];
        await db.execute(sql`
          UPDATE sfp_stage_items
             SET state='retry', next_attempt_at=NOW()+(${delay} * INTERVAL '1 minute'),
                 completed_at=NULL, updated_at=NOW(), lease_expires_at=NULL
           WHERE id=${String(item.id)}::uuid
        `);
      }
    }
    void execution;
    const deadLetters = rows(await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM sfp_stage_items
       WHERE stage_run_id=${runId}::uuid AND state='dead_letter'
    `))[0];
    const hasDeadLetters = Number(deadLetters?.count ?? 0) > 0;
    // PM-10 correction: counters are recomputed from the authoritative item
    // rows for this ENTIRE run (not just this tick's batch) rather than
    // incremented by this tick's eligible.length/succeeded/failed — a run
    // that stalls and is resumed across multiple ticks would otherwise
    // double count items processed in an earlier tick.
    await reconcileStageRunCounters(runId);
    if (hasDeadLetters) {
      await db.execute(sql`
        UPDATE sfp_stage_runs
           SET state='failed', terminal_reason='campaign_staging_max_attempts_exceeded',
               completed_at=NOW(), lease_expires_at=NULL, updated_at=NOW()
         WHERE id=${runId}::uuid AND claim_token=${claimToken}::uuid AND state='running'
      `);
    } else if (failed > 0) {
      await db.execute(sql`
        UPDATE sfp_stage_runs
           SET state='pending', terminal_reason=NULL, completed_at=NULL, lease_expires_at=NULL, updated_at=NOW()
         WHERE id=${runId}::uuid AND claim_token=${claimToken}::uuid AND state='running'
      `);
    } else {
      await db.execute(sql`
        UPDATE sfp_stage_runs
           SET state='completed', terminal_reason=NULL, completed_at=NOW(), lease_expires_at=NULL, updated_at=NOW()
         WHERE id=${runId}::uuid AND claim_token=${claimToken}::uuid AND state='running'
      `);
    }
    return { processed: eligible.length, succeeded, failed };
  } catch (error: any) {
    const message = String(error?.message ?? error);
    const permanent = error instanceof SfpStagingV2Error && error.httpStatus === 422;
    const reason = permanent ? `permanent:${error.code}` : `transient:${message}`;
    const items = rows(await db.execute(sql`
      SELECT id, state, attempt_count FROM sfp_stage_items
       WHERE stage_run_id=${runId}::uuid AND state IN ('pending','retry','claimed')
       ORDER BY created_at LIMIT ${limit}
    `));
    let terminal = false;
    for (const item of items) {
      const currentAttempt = Number(item.attempt_count ?? 0);
      const nextAttempt = currentAttempt + (item.state === "claimed" ? 0 : 1);
      const dead = permanent || nextAttempt >= MAX_ATTEMPTS;
      terminal ||= dead;
      const delay = RETRY_DELAYS_MINUTES[Math.min(nextAttempt - 1, RETRY_DELAYS_MINUTES.length - 1)];
      await db.execute(sql`
        UPDATE sfp_stage_items
           SET attempt_count=${nextAttempt}, state=${dead ? "dead_letter" : "retry"},
               outcome_code=${reason.slice(0, 200)},
               next_attempt_at=NOW()+(${delay} * INTERVAL '1 minute'),
               completed_at=${dead ? sql`NOW()` : sql`NULL`}, updated_at=NOW(), lease_expires_at=NULL
         WHERE id=${String(item.id)}::uuid
      `);
    }
    // PM-10: recompute from the item ledger instead of an ad hoc
    // failed_count += delta, which could double count against whatever this
    // run's counters already reflected from a prior tick.
    await reconcileStageRunCounters(runId);
    if (terminal) await failRun(runId, claimToken, `campaign_staging_dead_letter:${reason}`);
    else await db.execute(sql`
      UPDATE sfp_stage_runs SET state='pending',
             terminal_reason=${reason.slice(0, 500)}, lease_expires_at=NULL, updated_at=NOW()
       WHERE id=${runId}::uuid AND claim_token=${claimToken}::uuid AND state='running'
    `);
    if (items.length === 0) await failRun(runId, claimToken, reason);
    return { processed: items.length, succeeded: 0, failed: items.length };
  }
}

/** Repeatable, bounded scan. No work is created unless both program controls are on. */
export async function processSfpCampaignStagingTick() {
  if (!capabilityIsActive()) return { enabled: false, processed: 0, succeeded: 0, failed: 0 };
  const baseConfig = await getRecurringStageConfig();
  if (!baseConfig) return { enabled: false, processed: 0, succeeded: 0, failed: 0 };
  const createdRunId = await prepareRecurringRun(baseConfig);
  const pendingRuns = rows(await db.execute(sql`
    SELECT id
      FROM sfp_stage_runs
     WHERE stage='campaign_staging'
       AND (state IN ('pending','authorized','stalled')
            OR (state='running' AND lease_expires_at<NOW()))
     ORDER BY created_at
     LIMIT 5
  `));
  const runIds = [...new Set([
    ...(createdRunId ? [createdRunId] : []),
    ...pendingRuns.map((run) => String(run.id)),
  ])].slice(0, 5);
  const results = [];
  for (const runId of runIds) results.push(await processRun(runId));
  return {
    enabled: true,
    processed: results.reduce((sum, result) => sum + result.processed, 0),
    succeeded: results.reduce((sum, result) => sum + result.succeeded, 0),
    failed: results.reduce((sum, result) => sum + result.failed, 0),
  };
}
