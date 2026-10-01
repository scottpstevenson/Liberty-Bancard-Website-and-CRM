/**
 * Durable bounded consumer for SFP ready_held staging intents.
 *
 * The ledger owns claims, leases, retries and operator-visible holds. All
 * recipient eligibility and paused enrollment writes remain in the canonical
 * sfp-enrollment-bridge authority; this worker never sends or activates.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import {
  drainClaimedReadyHeldIntents,
  classifyReadyHeldBridgeError,
  classifyReadyHeldBridgeOutcome,
  type ReadyHeldClaim,
  type ReadyHeldConsumerDisposition,
} from "./sfp-ready-held-consumer-contract";
import {
  assertSfpRuntimeJobLease,
  claimSfpRuntimeDeploymentOwner,
  lockCurrentSfpRuntimeOwner,
  type SfpRuntimeJobLeaseBinding,
} from "./sfp-provider-operations";
import { randomUUID } from "node:crypto";

const rows = (result: any): any[] => result?.rows ?? result ?? [];
const MAX_BATCH_SIZE = 25;
const LEASE_SECONDS = 300;
const RETRY_DELAYS_SECONDS = [60, 300, 900, 1800];

function runtimeOwnerHeldReason(error: unknown): string | null {
  const message = String((error as any)?.message ?? error);
  return message.startsWith("SFP_RUNTIME_OWNER_BLOCKED:") ||
      message.startsWith("SFP_RUNTIME_OWNER_FENCE") ||
      message === "SFP_RUNTIME_JOB_OWNER_FENCE_LOST"
    ? message
    : null;
}

async function getProgramConfig() {
  const program = rows(await db.execute(sql`
    SELECT id, is_active, recurring_enabled,
           COALESCE((schedule_config->>'campaignStaging')::int,0) AS campaign_staging_batch
      FROM sfp_programs WHERE name='south-florida-v1' LIMIT 1
  `))[0];
  if (!program || program.is_active !== true) return null;
  const batchSize = Number(program.campaign_staging_batch);
  if (!Number.isInteger(batchSize) || batchSize < 1) return null;
  return { programId: String(program.id), recurringEnabled: program.recurring_enabled === true, batchSize };
}

async function enqueueReadyHeldIntents(programId: string, actorId: string, limit: number): Promise<number> {
  return db.transaction(async (tx) => {
    await lockCurrentSfpRuntimeOwner(tx);
    const inserted = rows(await tx.execute(sql`
      WITH candidates AS (
        SELECT i.id
          FROM sfp_campaign_staging_intents i
          JOIN sfp_cohort_runs c ON c.id=i.cohort_run_id
         WHERE c.program_id=${programId}::uuid
           AND c.cohort_state='frozen' AND c.voided_at IS NULL AND c.superseded_at IS NULL
           AND i.state='ready_held'
           AND NOT EXISTS (
             SELECT 1 FROM sfp_ready_held_consumer_items q WHERE q.staging_intent_id=i.id
           )
         ORDER BY i.ready_held_at NULLS LAST, i.created_at, i.id
         LIMIT ${limit}
      )
      INSERT INTO sfp_ready_held_consumer_items (staging_intent_id, actor_id)
      SELECT id, ${actorId} FROM candidates
      ON CONFLICT (staging_intent_id) DO NOTHING
      RETURNING id
    `));
    return inserted.length;
  });
}

async function claimReadyHeldBatch(limit: number): Promise<ReadyHeldClaim[]> {
  return db.transaction(async (tx) => {
    const owner = await lockCurrentSfpRuntimeOwner(tx);
    return rows(await tx.execute(sql`
      WITH candidates AS (
        SELECT id
          FROM sfp_ready_held_consumer_items
         WHERE (state IN ('pending','retry') AND next_attempt_at <= NOW())
            OR (state='claimed' AND (lease_expires_at IS NULL OR lease_expires_at < NOW()))
         ORDER BY next_attempt_at, created_at, id
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE sfp_ready_held_consumer_items q
           SET state='claimed', claim_token=gen_random_uuid(),
               attempt_count=q.attempt_count+1,
               lease_expires_at=NOW()+(${LEASE_SECONDS} * INTERVAL '1 second'),
               runtime_owner_epoch=${owner.ownerEpoch},
               runtime_owner_token=${owner.ownerToken}::uuid,
               runtime_deployment_identity=${owner.deploymentIdentity},
               runtime_environment_identity=${owner.environmentIdentity},
               runtime_artifact_sha=${owner.artifactSha},
               runtime_process_identity=${owner.processIdentity},
               runtime_queue_topology_hash=${owner.queueTopologyHash},
               updated_at=NOW()
          FROM candidates c
         WHERE q.id=c.id
         RETURNING q.id, q.staging_intent_id, q.claim_token, q.attempt_count,
                   q.runtime_owner_epoch,q.runtime_owner_token,
                   q.runtime_deployment_identity,q.runtime_environment_identity,
                   q.runtime_artifact_sha,q.runtime_process_identity,q.runtime_queue_topology_hash
      )
      SELECT * FROM claimed
    `)).map((row: any) => ({
      id: String(row.id),
      stagingIntentId: String(row.staging_intent_id),
      claimToken: String(row.claim_token),
      attemptCount: Number(row.attempt_count),
      runtimeOwnerEpoch: Number(row.runtime_owner_epoch),
      runtimeOwnerToken: String(row.runtime_owner_token),
      runtimeDeploymentIdentity: String(row.runtime_deployment_identity),
      runtimeEnvironmentIdentity: String(row.runtime_environment_identity),
      runtimeArtifactSha: String(row.runtime_artifact_sha),
      runtimeProcessIdentity: String(row.runtime_process_identity),
      runtimeQueueTopologyHash: String(row.runtime_queue_topology_hash),
    }));
  });
}

function runtimeLease(claim: ReadyHeldClaim): SfpRuntimeJobLeaseBinding {
  return {
    jobType: "sfp_ready_held_consumer",
    jobId: claim.id,
    claimToken: claim.claimToken,
    ownerEpoch: claim.runtimeOwnerEpoch,
    ownerToken: claim.runtimeOwnerToken,
    deploymentIdentity: claim.runtimeDeploymentIdentity,
    environmentIdentity: claim.runtimeEnvironmentIdentity,
    artifactSha: claim.runtimeArtifactSha,
    processIdentity: claim.runtimeProcessIdentity,
    queueTopologyHash: claim.runtimeQueueTopologyHash,
  };
}

async function renewReadyHeldClaim(claim: ReadyHeldClaim): Promise<void> {
  await db.transaction(async (tx) => {
    await assertSfpRuntimeJobLease(tx, runtimeLease(claim));
    const renewed = rows(await tx.execute(sql`
      UPDATE sfp_ready_held_consumer_items
         SET lease_expires_at=NOW()+(${LEASE_SECONDS} * INTERVAL '1 second'),updated_at=NOW()
       WHERE id=${claim.id}::uuid AND state='claimed'
         AND claim_token=${claim.claimToken}::uuid AND lease_expires_at>NOW()
       RETURNING id
    `))[0];
    if (!renewed) throw new Error("SFP_READY_HELD_CLAIM_LOST");
  });
}

async function claimReadyHeldIntentForOperator(
  stagingIntentId: string,
  actorId: string,
): Promise<ReadyHeldClaim> {
  return db.transaction(async (tx) => {
    const owner = await lockCurrentSfpRuntimeOwner(tx);
    const claimToken = randomUUID();
    const row = rows(await tx.execute(sql`
      INSERT INTO sfp_ready_held_consumer_items
        (staging_intent_id,actor_id,state,attempt_count,next_attempt_at,claim_token,lease_expires_at,
         runtime_owner_epoch,runtime_owner_token,runtime_deployment_identity,runtime_environment_identity,
         runtime_artifact_sha,runtime_process_identity,runtime_queue_topology_hash,updated_at)
      VALUES (${stagingIntentId}::uuid,${actorId},'claimed',1,NOW(),${claimToken}::uuid,
              NOW()+(${LEASE_SECONDS} * INTERVAL '1 second'),${owner.ownerEpoch},${owner.ownerToken}::uuid,
              ${owner.deploymentIdentity},${owner.environmentIdentity},${owner.artifactSha},
              ${owner.processIdentity},${owner.queueTopologyHash},NOW())
      ON CONFLICT (staging_intent_id) DO UPDATE SET
        actor_id=EXCLUDED.actor_id,state='claimed',
        attempt_count=sfp_ready_held_consumer_items.attempt_count+1,next_attempt_at=NOW(),
        claim_token=EXCLUDED.claim_token,lease_expires_at=EXCLUDED.lease_expires_at,
        runtime_owner_epoch=EXCLUDED.runtime_owner_epoch,runtime_owner_token=EXCLUDED.runtime_owner_token,
        runtime_deployment_identity=EXCLUDED.runtime_deployment_identity,
        runtime_environment_identity=EXCLUDED.runtime_environment_identity,
        runtime_artifact_sha=EXCLUDED.runtime_artifact_sha,
        runtime_process_identity=EXCLUDED.runtime_process_identity,
        runtime_queue_topology_hash=EXCLUDED.runtime_queue_topology_hash,
        outcome_code=NULL,completed_at=NULL,updated_at=NOW()
      WHERE sfp_ready_held_consumer_items.state<>'claimed'
         OR sfp_ready_held_consumer_items.lease_expires_at<=NOW()
      RETURNING id,staging_intent_id,claim_token,attempt_count,runtime_owner_epoch,runtime_owner_token,
                runtime_deployment_identity,runtime_environment_identity,runtime_artifact_sha,
                runtime_process_identity,runtime_queue_topology_hash
    `))[0];
    if (!row) throw new Error("SFP_READY_HELD_CLAIM_ALREADY_ACTIVE");
    return {
      id: String(row.id),
      stagingIntentId: String(row.staging_intent_id),
      claimToken: String(row.claim_token),
      attemptCount: Number(row.attempt_count),
      runtimeOwnerEpoch: Number(row.runtime_owner_epoch),
      runtimeOwnerToken: String(row.runtime_owner_token),
      runtimeDeploymentIdentity: String(row.runtime_deployment_identity),
      runtimeEnvironmentIdentity: String(row.runtime_environment_identity),
      runtimeArtifactSha: String(row.runtime_artifact_sha),
      runtimeProcessIdentity: String(row.runtime_process_identity),
      runtimeQueueTopologyHash: String(row.runtime_queue_topology_hash),
    };
  });
}

/** Admin/manual and bulk execution use the same durable consumer claim and bridge fence. */
export async function bridgeReadyHeldIntentAsOperator(
  stagingIntentId: string,
  actorId: string,
  testFaultInjector?: (stage: "after_source_contact_locked" | "after_contact_before_enrollment" | "after_enrollment_before_ledger") => void | Promise<void>,
) {
  if (!await getProgramConfig()) throw new Error("SFP_PROGRAM_INACTIVE_OR_STAGING_DISABLED");
  const { getPauseState } = await import("../outbound-pause-authority");
  const pause = await getPauseState();
  if (pause.state !== "paused") throw new Error("SFP_READY_HELD_BRIDGE_BLOCKED:GLOBAL_OUTBOUND_NOT_PAUSED");
  await claimSfpRuntimeDeploymentOwner();
  const claim = await claimReadyHeldIntentForOperator(stagingIntentId, actorId);
  try {
    await renewReadyHeldClaim(claim);
    const { bridgeReadyHeldIntentToPausedEnrollment } = await import("./sfp-enrollment-bridge");
    const result = await bridgeReadyHeldIntentToPausedEnrollment(
      stagingIntentId, actorId, testFaultInjector, runtimeLease(claim),
    );
    await persistDisposition(claim, classifyReadyHeldBridgeOutcome(result));
    return result;
  } catch (error) {
    await persistDisposition(claim, classifyReadyHeldBridgeError(error, claim.attemptCount)).catch(() => {});
    throw error;
  }
}

async function persistDisposition(claim: ReadyHeldClaim, disposition: ReadyHeldConsumerDisposition): Promise<void> {
  const delaySeconds = disposition.state === "retry"
    ? RETRY_DELAYS_SECONDS[Math.min(Math.max(claim.attemptCount - 1, 0), RETRY_DELAYS_SECONDS.length - 1)]
    : 0;
  await db.transaction(async (tx) => {
    await assertSfpRuntimeJobLease(tx, runtimeLease(claim));
    const updated = rows(await tx.execute(sql`
      UPDATE sfp_ready_held_consumer_items
         SET state=${disposition.state},
             outcome_code=${disposition.outcomeCode.slice(0, 200)},
             result=${JSON.stringify(disposition.result)}::jsonb,
             next_attempt_at=CASE WHEN ${disposition.state === "retry"}
               THEN NOW()+(${delaySeconds} * INTERVAL '1 second') ELSE next_attempt_at END,
             completed_at=CASE WHEN ${["completed", "held", "dead_letter"].includes(disposition.state)}
               THEN NOW() ELSE NULL END,
             claim_token=NULL, lease_expires_at=NULL,
             runtime_owner_epoch=NULL,runtime_owner_token=NULL,runtime_deployment_identity=NULL,
             runtime_environment_identity=NULL,runtime_artifact_sha=NULL,runtime_process_identity=NULL,
             runtime_queue_topology_hash=NULL,
             updated_at=NOW()
      WHERE id=${claim.id}::uuid AND state='claimed'
        AND claim_token=${claim.claimToken}::uuid AND lease_expires_at>NOW()
      RETURNING id
    `));
    if (updated.length !== 1) throw new Error("SFP_READY_HELD_CLAIM_LOST");
  });
}

export async function processSfpReadyHeldConsumerBatch(opts: {
  limit?: number;
  actorId: string;
  recurringOnly?: boolean;
}): Promise<{
  enabled: boolean;
  discovered: number;
  attempted: number;
  completed: number;
  held: number;
  retrying: number;
  deadLettered: number;
  persistenceFailures: number;
  stopReason: string;
}> {
  const config = await getProgramConfig();
  if (!config) {
    return {
      enabled: false, discovered: 0, attempted: 0, completed: 0, held: 0,
      retrying: 0, deadLettered: 0, persistenceFailures: 0, stopReason: "program_inactive_or_staging_disabled",
    };
  }
  if (opts.recurringOnly && !config.recurringEnabled) {
    return {
      enabled: false, discovered: 0, attempted: 0, completed: 0, held: 0,
      retrying: 0, deadLettered: 0, persistenceFailures: 0, stopReason: "recurring_disabled",
    };
  }
  const { getPauseState } = await import("../outbound-pause-authority");
  const pause = await getPauseState();
  if (pause.state !== "paused") {
    return {
      enabled: false, discovered: 0, attempted: 0, completed: 0, held: 0,
      retrying: 0, deadLettered: 0, persistenceFailures: 0, stopReason: "global_outbound_not_paused",
    };
  }

  const limit = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(Number(opts.limit) || config.batchSize)));
  try {
    await claimSfpRuntimeDeploymentOwner();
  } catch (error) {
    const reason = runtimeOwnerHeldReason(error);
    if (!reason) throw error;
    return {
      enabled: false,
      discovered: 0,
      attempted: 0,
      completed: 0,
      held: 0,
      retrying: 0,
      deadLettered: 0,
      persistenceFailures: 0,
      stopReason: `runtime_release_held:${reason}`,
    };
  }
  const discovered = await enqueueReadyHeldIntents(config.programId, opts.actorId, limit);
  const claims = await claimReadyHeldBatch(limit);
  const summary = await drainClaimedReadyHeldIntents(claims, {
    actorId: opts.actorId,
    bridge: async (intentId, actorId, claim) => {
      await renewReadyHeldClaim(claim);
      const { bridgeReadyHeldIntentToPausedEnrollment } = await import("./sfp-enrollment-bridge");
      return bridgeReadyHeldIntentToPausedEnrollment(intentId, actorId, undefined, runtimeLease(claim));
    },
    persist: persistDisposition,
  });
  return {
    enabled: true,
    discovered,
    ...summary,
    stopReason: claims.length === 0 ? "no_claimable_ready_held_work" : "batch_limit_reached",
  };
}