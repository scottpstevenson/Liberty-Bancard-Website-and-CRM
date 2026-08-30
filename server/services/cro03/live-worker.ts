import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import {
  assertCro03cAuthorityBeforeIo,
  cro03cStagePlanHash,
  createCro03cNoOutboundSnapshot,
  deriveCro03cProviderInput,
  reserveCro03cProviderOperation,
  settleCro03cProviderOperation,
  CRO03C_RECIPE_HASH,
  CRO03C_RECIPE_VERSION,
  type Cro03cLiveProviderContext,
} from "./live-execution";
import { executeCro03cLiveProvider } from "./live-provider-executors";
import { hashCro03Evidence } from "./source-staging";
import { getPauseState } from "../outbound-pause-authority";
import {
  classifyCro03cNoOutboundSnapshots,
  readCro03cGlobalNoOutboundCounters,
  withCro03cInitialBatchEffectFence,
} from "./cro03c-effect-fence";
import { continueCro03cInitialGeneration } from "./initial-continuation";
import { CRO03B_UNIFIED_RECIPE } from "./recipe-contract";

const rows = (result: any): any[] => result?.rows ?? result ?? [];
const LEASE_SECONDS = 120;
export const CRO03C_LIVE_RECOVERY_LIMIT = 25;
const contextProviderForStage = (stageKey: string): Cro03cLiveProviderContext["provider"] => {
  if (stageKey === "internal-source") return "internal_source";
  if (stageKey === "public-web") return "first_party_web";
  if (stageKey === "rdap" || stageKey === "jsonld" || stageKey === "serper" ||
      stageKey === "outscraper" || stageKey === "openai" || stageKey === "apollo") return stageKey;
  // Local-only recipe stages have no provider adapter.  The field is required
  // by the authority context but is not used to select transport here.
  return "first_party_web";
};

function freezeTree<T>(value: T, seen = new Map<object, true>()): T {
  if (value && typeof value === "object" && !seen.has(value as object)) {
    seen.set(value as object, true);
    for (const child of Object.values(value as Record<string, unknown>)) freezeTree(child, seen);
    Object.freeze(value);
  }
  return value;
}

/**
 * The only bridge from a durable CRO-03C plan to provider request material.
 * It locks and verifies the canonical observation and returns an object that
 * exists only in this worker's stack for the immediately following dispatch.
 */
async function resolveCro03cStageInput(
  claim: ClaimedGeneration,
  stage: any,
  provider: Cro03cLiveProviderContext["provider"],
): Promise<Readonly<Record<string, unknown>>> {
  return db.transaction(async (tx) => {
    const resolved = rows(await tx.execute(sql`
      SELECT d.input_hash,d.evidence_hash,d.recipe_hash,
             r.source_observation_id,r.source_payload_hash,r.evidence_hash AS reference_evidence_hash,
             r.provider,r.price_schedule_version,r.price_schedule_hash,r.reserved_units,r.units_hash,r.cap_hash,
             o.payload,o.payload_hash,
             g.recipe_version,g.recipe_hash AS generation_recipe_hash,g.stage_plan_hash,g.activation_revision,
             g.claim_token,g.execution_fence,g.state AS generation_state,
             c.stage_plan_hash AS command_stage_plan_hash,c.caps,
             p.price_schedules
        FROM cro03c_stage_dispositions d
        JOIN cro03c_stage_input_references r ON r.id=d.stage_input_reference_id
        JOIN cro03_source_observations o ON o.id=r.source_observation_id
        JOIN cro03c_generations g ON g.id=d.generation_id
        JOIN cro03c_commands c ON c.id=g.command_id
        JOIN cro03c_activation_policies p ON p.id=c.activation_policy_id
       WHERE d.id=${stage.id}::uuid AND d.generation_id=${claim.generation_id}::uuid
         AND d.stage_key=${stage.stage_key}
       FOR UPDATE OF o,g,d,r
    `))[0];
    if (!resolved) throw new Error(`CRO03C_STAGE_INPUT_REFERENCE_MISSING:${stage.stage_key}`);
    const step = CRO03B_UNIFIED_RECIPE.steps.find((candidate) => candidate.id === String(stage.stage_key));
    if (!step ||
        resolved.generation_state !== "running" ||
        String(resolved.claim_token) !== claim.claim_token ||
        Number(resolved.execution_fence) !== claim.execution_fence ||
        Number(resolved.activation_revision) !== claim.activation_revision ||
        Number(resolved.recipe_version) !== CRO03C_RECIPE_VERSION ||
        resolved.generation_recipe_hash !== CRO03C_RECIPE_HASH ||
        resolved.stage_plan_hash !== cro03cStagePlanHash() ||
        resolved.command_stage_plan_hash !== resolved.stage_plan_hash ||
        resolved.recipe_hash !== hashCro03Evidence(step) ||
        resolved.provider !== provider ||
        resolved.reference_evidence_hash !== resolved.evidence_hash ||
        hashCro03Evidence(resolved.payload) !== resolved.payload_hash ||
        resolved.payload_hash !== resolved.source_payload_hash) {
      throw new Error(`CRO03C_STAGE_INPUT_REFERENCE_INVALID:${stage.stage_key}`);
    }
    const schedules = resolved.price_schedules as Record<string, any>;
    const schedule = schedules?.[provider];
    if (!schedule ||
        Number(schedule.version) !== Number(resolved.price_schedule_version) ||
        hashCro03Evidence(schedule) !== resolved.price_schedule_hash) {
      throw new Error("CRO03C_PRICE_SCHEDULE_UNKNOWN");
    }
    const caps = resolved.caps ?? {};
    if (hashCro03Evidence({
      maxUnits: Number(caps.maxUnits ?? 0),
      maxAmountMicros: Number(caps.maxAmountMicros ?? 0),
    }) !== resolved.cap_hash ||
        hashCro03Evidence({ provider, reservedUnits: Number(resolved.reserved_units) }) !== resolved.units_hash) {
      throw new Error("CRO03C_STAGE_INPUT_CAP_MISMATCH");
    }
    const input = deriveCro03cProviderInput(provider, resolved.payload, schedule, {
      observation_id: resolved.source_observation_id,
      payload_hash: resolved.payload_hash,
    });
    if (!input || Number((input as any).reservedUnits) !== Number(resolved.reserved_units) ||
        hashCro03Evidence(input) !== resolved.input_hash) {
      throw new Error(`CRO03C_PROVIDER_INPUT_DERIVATION_MISMATCH:${stage.stage_key}`);
    }
    return freezeTree(input);
  });
}

type ClaimedGeneration = {
  command_id: string;
  run_id: string;
  generation_id: string;
  activation_revision: number;
  runtime_attestation_id: string;
  pre_run_snapshot_hash: string;
  effect_correlation_id: string;
  command_type: "initial_batch" | "micro_canary";
  claim_token: string;
  execution_fence: number;
};

/**
 * Claims one generation.  The database, rather than BullMQ, owns work
 * selection: an event may be delivered more than once and a recovery tick may
 * overlap an event without causing two workers to own a generation.
 */
async function claimGeneration(commandId?: string): Promise<ClaimedGeneration | null> {
  const claimToken = randomUUID();
  return db.transaction(async (tx) => {
    const claimed = rows(await tx.execute(sql`
      WITH candidate AS (
        SELECT g.id
          FROM cro03c_generations g
          JOIN cro03c_runs r ON r.id=g.run_id
          JOIN cro03c_commands c ON c.id=g.command_id
         WHERE c.cancel_requested_at IS NULL
           AND c.expires_at > NOW()
           AND c.state IN ('queued','running')
           AND (${commandId ?? null}::uuid IS NULL OR c.id=${commandId ?? null}::uuid)
           AND (g.state='queued' OR (g.state='running' AND g.lease_expires_at < NOW()))
            AND NOT EXISTS (
              SELECT 1 FROM cro03c_generations owned
               WHERE owned.run_id=g.run_id AND owned.id<>g.id AND owned.state='running'
                 AND owned.lease_expires_at>=NOW()
            )
         ORDER BY c.created_at,c.id,g.created_at,g.id
         FOR UPDATE OF g,r,c SKIP LOCKED
         LIMIT 1
      ), claimed_generation AS (
        UPDATE cro03c_generations g
           SET state='running',claim_token=${claimToken}::uuid,
               lease_expires_at=NOW()+(${LEASE_SECONDS} * INTERVAL '1 second'),
               execution_fence=g.execution_fence+1,updated_at=NOW()
          FROM candidate
         WHERE g.id=candidate.id
         RETURNING g.id,g.command_id,g.run_id,g.execution_fence
      ), claimed_run AS (
        UPDATE cro03c_runs r
           SET state='running',claim_token=${claimToken}::uuid,
               lease_expires_at=NOW()+(${LEASE_SECONDS} * INTERVAL '1 second'),
                -- The run fence identifies its currently owned generation.
                -- Token rotation still fences a successor generation while a
                -- reclaimed generation advances both fences together.
                execution_fence=g.execution_fence,
               started_at=COALESCE(r.started_at,NOW())
          FROM claimed_generation g
         WHERE r.id=g.run_id
         RETURNING r.id,r.execution_fence
      )
      UPDATE cro03c_commands c
         SET state='running',updated_at=NOW()
        FROM claimed_generation g
        JOIN claimed_run r ON r.id=g.run_id
        JOIN cro03c_no_outbound_snapshots s ON s.command_id=g.command_id AND s.phase='pre_run'
       WHERE c.id=g.command_id
      RETURNING c.id AS command_id,g.run_id,g.id AS generation_id,c.activation_revision,
                c.runtime_attestation_id,s.snapshot_hash AS pre_run_snapshot_hash,
                 c.effect_correlation_id, c.command_type,
                 ${claimToken}::text AS claim_token,r.execution_fence
    `))[0];
    return claimed ? claimed as ClaimedGeneration : null;
  });
}

/** Test-only observation seam for durable claim/fence certification.
 * It exposes the same database-backed claim path used by the dispatcher; it
 * grants no authority to bypass the pre-I/O authority check. */
export async function claimNextCro03cGenerationForTest(commandId?: string): Promise<ClaimedGeneration | null> {
  return claimGeneration(commandId);
}

async function finishClaim(claim: ClaimedGeneration, failed: boolean, reconciliation = false): Promise<boolean> {
  return db.transaction(async (tx) => {
    const generation = rows(await tx.execute(sql`
      UPDATE cro03c_generations
         SET state=${failed ? "failed" : "completed"},claim_token=NULL,lease_expires_at=NULL,updated_at=NOW()
       WHERE id=${claim.generation_id}::uuid AND state='running'
         AND claim_token=${claim.claim_token}::uuid AND execution_fence=${claim.execution_fence}
       RETURNING id
    `))[0];
    if (!generation) throw new Error("CRO03C_GENERATION_FENCE_LOST");
    await tx.execute(sql`
      UPDATE cro03c_generations
         SET state='inconclusive_pending_reconciliation',claim_token=NULL,
             lease_expires_at=NULL,updated_at=NOW()
       WHERE command_id=${claim.command_id}::uuid
         AND state IN ('queued','claimed')
    `);

    const summary = rows(await tx.execute(sql`
      SELECT COUNT(*) FILTER (WHERE state IN ('queued','claimed','running'))::int AS active,
             BOOL_OR(state='failed') AS failed
        FROM cro03c_generations WHERE run_id=${claim.run_id}::uuid
    `))[0];
    if (Number(summary?.active ?? 0) !== 0) return false;

    const terminal = reconciliation ? "inconclusive_pending_reconciliation" : summary?.failed ? "failed" : "completed";
    const run = rows(await tx.execute(sql`
      UPDATE cro03c_runs
         SET state=${terminal},claim_token=NULL,lease_expires_at=NULL,completed_at=NOW(),
              stop_reason=${reconciliation ? "dispatch_or_billing_ambiguity" : terminal === "failed" ? "dispatcher_authority_failed" : "no_outbound_dispatch_completed"}
       WHERE id=${claim.run_id}::uuid AND state='running'
         AND claim_token=${claim.claim_token}::uuid AND execution_fence=${claim.execution_fence}
       RETURNING id
    `))[0];
    if (!run) throw new Error("CRO03C_RUN_FENCE_LOST");
    await tx.execute(sql`
      UPDATE cro03c_commands
         SET state=${terminal},completed_at=NOW(),updated_at=NOW()
       WHERE id=${claim.command_id}::uuid AND state='running'
    `);
    await tx.execute(sql`
      UPDATE cro03c_initial_rollouts
         SET state=${terminal}
       WHERE command_id=${claim.command_id}::uuid AND state IN ('reserved','running')
    `);
    return true;
  });
}

async function stopClaimForRequiredReview(claim: ClaimedGeneration, stageKey: string): Promise<void> {
  await db.transaction(async (tx) => {
    const generation = rows(await tx.execute(sql`
      UPDATE cro03c_generations
         SET state='inconclusive_pending_reconciliation',claim_token=NULL,
             lease_expires_at=NULL,updated_at=NOW()
       WHERE id=${claim.generation_id}::uuid AND state='running'
         AND claim_token=${claim.claim_token}::uuid
         AND execution_fence=${claim.execution_fence}
       RETURNING id
    `))[0];
    if (!generation) throw new Error("CRO03C_GENERATION_FENCE_LOST");
    const run = rows(await tx.execute(sql`
      UPDATE cro03c_runs
         SET state='inconclusive_pending_reconciliation',claim_token=NULL,
             lease_expires_at=NULL,completed_at=NOW(),
             stop_reason=${`review_required:${stageKey}`}
       WHERE id=${claim.run_id}::uuid AND state='running'
         AND claim_token=${claim.claim_token}::uuid
         AND execution_fence=${claim.execution_fence}
       RETURNING id
    `))[0];
    if (!run) throw new Error("CRO03C_RUN_FENCE_LOST");
    await tx.execute(sql`
      UPDATE cro03c_commands
         SET state='inconclusive_pending_reconciliation',completed_at=NOW(),updated_at=NOW()
       WHERE id=${claim.command_id}::uuid AND state='running'
    `);
    await tx.execute(sql`
      UPDATE cro03c_initial_rollouts
         SET state='inconclusive_pending_reconciliation'
       WHERE command_id=${claim.command_id}::uuid AND state IN ('reserved','running')
    `);
  });
}

async function releaseWaitingClaim(claim: ClaimedGeneration): Promise<void> {
  await db.transaction(async (tx) => {
    const generation = rows(await tx.execute(sql`
      UPDATE cro03c_generations
         SET lease_expires_at=NOW(),updated_at=NOW()
       WHERE id=${claim.generation_id}::uuid AND state='running'
         AND claim_token=${claim.claim_token}::uuid AND execution_fence=${claim.execution_fence}
       RETURNING id
    `))[0];
    if (!generation) throw new Error("CRO03C_GENERATION_FENCE_LOST");
    const run = rows(await tx.execute(sql`
      UPDATE cro03c_runs SET lease_expires_at=NOW()
       WHERE id=${claim.run_id}::uuid AND state='running'
         AND claim_token=${claim.claim_token}::uuid AND execution_fence=${claim.execution_fence}
       RETURNING id
    `))[0];
    if (!run) throw new Error("CRO03C_RUN_FENCE_LOST");
  });
}

/** A reservation whose attempt has durably not crossed a transport boundary is
 * safely terminal.  Keep this restricted to the current fenced attempt: a
 * successor claim must never release or overwrite an earlier attempt. */
async function confirmCro03cNotDispatched(
  claim: ClaimedGeneration,
  operationId: string,
  attemptId: string,
  checkpointHash: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const operation = rows(await tx.execute(sql`
      UPDATE cro03c_stage_operations
         SET dispatch_state='confirmed_not_dispatched',state='completed',
             terminal_disposition='released',settled_units=0,settled_amount_micros=0,
             billing_certainty='none',completed_at=NOW()
       WHERE id=${operationId}::uuid AND attempt_id=${attemptId}::uuid
         AND dispatch_state='dispatching' AND terminal_disposition IS NULL
         AND claim_token=${claim.claim_token}::uuid AND execution_fence=${claim.execution_fence}
      RETURNING id
    `))[0];
    if (!operation) throw new Error("CRO03C_OPERATION_FENCE_LOST");
    await tx.execute(sql`
      INSERT INTO cro03c_dispatch_checkpoints(stage_operation_id,attempt_id,checkpoint,authority_hash)
      VALUES (${operationId}::uuid,${attemptId}::uuid,'confirmed_not_dispatched',
              ${hashCro03Evidence({ checkpointHash, disposition: "released" })})
      ON CONFLICT (stage_operation_id,attempt_id,checkpoint) DO NOTHING
    `);
  });
}

async function dispatchClaim(claim: ClaimedGeneration): Promise<"completed" | "waiting" | "inconclusive"> {
  const stages = rows(await db.execute(sql`
    SELECT d.id,d.stage_key,d.disposition,d.stage_input_reference_id,
           r.reserved_units,r.price_schedule_version,r.price_schedule_hash,
           p.price_schedules -> r.provider AS price_schedule
      FROM cro03c_stage_dispositions d
      LEFT JOIN cro03c_stage_input_references r ON r.id=d.stage_input_reference_id
      LEFT JOIN cro03c_generations g ON g.id=d.generation_id
      LEFT JOIN cro03c_commands c ON c.id=g.command_id
      LEFT JOIN cro03c_activation_policies p ON p.id=c.activation_policy_id
     WHERE d.generation_id=${claim.generation_id}::uuid
     ORDER BY d.created_at,d.id
  `));

  for (const stage of stages) {
    if (String(stage.disposition).startsWith("skipped_")) continue;
    // A disposition is a durable denial, not failed work.  In particular a
    // command that authorizes one bounded provider must not manufacture an
    // operation for every later recipe handoff.
    if (stage.disposition === "blocked_authority" || stage.disposition === "blocked_budget" ||
        stage.disposition === "blocked_control") continue;
    if (stage.disposition === "review_required") {
      // Initial continuation now has a generation-owned local projection and
      // finalization journal. These provider stages remain denied; they are not
      // treated as completed work and grant no provider authority.
      if (claim.command_type === "initial_batch") continue;
      await stopClaimForRequiredReview(claim, String(stage.stage_key));
      return "inconclusive";
    }
    if (stage.disposition !== "eligible") {
      throw new Error(`CRO03C_STAGE_STOPPED:${stage.stage_key}:${stage.disposition}`);
    }
    const provider = contextProviderForStage(String(stage.stage_key));
    const context: Cro03cLiveProviderContext = {
      kind: "cro03c_live",
      provider,
      activationRevision: Number(claim.activation_revision),
      generationId: String(claim.generation_id),
      commandId: String(claim.command_id),
      runId: String(claim.run_id),
      stageKey: String(stage.stage_key),
      claimToken: String(claim.claim_token),
      executionFence: Number(claim.execution_fence),
      runtimeAttestationId: String(claim.runtime_attestation_id),
      expiresAt: new Date(Date.now() + LEASE_SECONDS * 1000),
      noOutboundSnapshotHash: String(claim.pre_run_snapshot_hash),
      caller: "server/services/cro03/live-execution.ts",
    };
    await assertCro03cAuthorityBeforeIo(context);
    const operationKey = `cro03c:${claim.generation_id}:${stage.stage_key}`;
    const priorOperation = rows(await db.execute(sql`
      SELECT id,state,dispatch_state,terminal_disposition
        FROM cro03c_stage_operations
       WHERE generation_id=${claim.generation_id}::uuid AND stage_key=${stage.stage_key}
    `))[0];
    if (priorOperation?.dispatch_state === "ambiguous" || priorOperation?.state === "quarantined") {
      throw new Error("CRO03C_DISPATCH_RECONCILIATION_REQUIRED");
    }
    if (priorOperation?.terminal_disposition) continue;
    const reservedUnits = Number(stage.reserved_units);
    const priceScheduleVersion = Number(stage.price_schedule_version);
    const priceScheduleHash = stage.price_schedule_hash;
    const amountMicros = Number(stage.price_schedule?.amountMicros);
    if (!Number.isInteger(reservedUnits) || reservedUnits < 0 ||
        !Number.isInteger(priceScheduleVersion) || typeof priceScheduleHash !== "string" ||
        !Number.isInteger(amountMicros) || amountMicros < 0 ||
        !Number.isSafeInteger(amountMicros * reservedUnits)) {
      throw new Error("CRO03C_PRICE_SCHEDULE_UNKNOWN");
    }
    // Reservation validates the activation price schedule and command cap
    // before an operation can be made dispatchable.
    const reservation = await reserveCro03cProviderOperation({
      generationId: String(claim.generation_id), stageKey: String(stage.stage_key), provider,
      operationType: provider === "first_party_web" ? "first_party_crawl" : "evidence_receipt",
      operationKey, caller: "server/services/cro03/live-worker.ts",
       requestedUnits: reservedUnits,
       maxAmountMicros: amountMicros * reservedUnits,
       priceScheduleVersion,
       priceScheduleHash,
      activationRevision: Number(claim.activation_revision),
    });
    const operation = rows(await db.execute(sql`
      UPDATE cro03c_stage_operations
         SET command_id=${claim.command_id}::uuid,run_id=${claim.run_id}::uuid,
             claim_token=${claim.claim_token}::uuid,execution_fence=${claim.execution_fence}
       WHERE id=${reservation.id}::uuid
       RETURNING id,state,dispatch_state,terminal_disposition
    `))[0];
    if (operation.dispatch_state === "ambiguous" || operation.state === "quarantined") {
      throw new Error("CRO03C_DISPATCH_RECONCILIATION_REQUIRED");
    }
    if (operation.terminal_disposition) continue;
    const attemptId = randomUUID();
    const checkpointHash = hashCro03Evidence({
      commandId: claim.command_id, runId: claim.run_id, generationId: claim.generation_id,
      stageKey: stage.stage_key, claimToken: claim.claim_token, executionFence: claim.execution_fence,
    });
    const prepared = rows(await db.execute(sql`
      UPDATE cro03c_stage_operations
         SET attempt_id=${attemptId}::uuid,dispatch_state='dispatching',
              pre_io_authorized_at=NOW()
       WHERE id=${operation.id}::uuid AND state='reserved' AND dispatch_state='not_dispatched'
         AND claim_token=${claim.claim_token}::uuid AND execution_fence=${claim.execution_fence}
       RETURNING id
    `))[0];
    if (!prepared) throw new Error("CRO03C_OPERATION_FENCE_LOST");
    await db.execute(sql`
      INSERT INTO cro03c_dispatch_checkpoints(stage_operation_id,attempt_id,checkpoint,authority_hash)
      VALUES (${operation.id}::uuid,${attemptId}::uuid,'pre_io',${checkpointHash})
    `);
    let transportMayHaveBeenInvoked = false;
    const markTransportMayHaveBeenInvoked = async (): Promise<void> => {
      if (transportMayHaveBeenInvoked) return;
      const marked = rows(await db.execute(sql`
        UPDATE cro03c_stage_operations
           SET dispatch_state='dispatched',dispatched_at=NOW(),
               transport_may_have_been_invoked=TRUE
         WHERE id=${operation.id}::uuid AND attempt_id=${attemptId}::uuid
           AND dispatch_state='dispatching' AND state='reserved'
           AND claim_token=${claim.claim_token}::uuid AND execution_fence=${claim.execution_fence}
        RETURNING id
      `))[0];
      if (!marked) throw new Error("CRO03C_OPERATION_FENCE_LOST");
      // From the successful durable state transition onward even a failed
      // checkpoint insert is ambiguous: the provider edge may follow it.
      transportMayHaveBeenInvoked = true;
      await db.execute(sql`
        INSERT INTO cro03c_dispatch_checkpoints(stage_operation_id,attempt_id,checkpoint,authority_hash)
        VALUES (${operation.id}::uuid,${attemptId}::uuid,'transport_started',
                ${hashCro03Evidence({ checkpointHash, transport: "may_have_been_invoked" })})
        ON CONFLICT (stage_operation_id,attempt_id,checkpoint) DO NOTHING
      `);
    };
    try {
      // Reservation-to-dispatch is deliberately separated from this final
      // fence check: cancellation or expiry in that interval blocks all I/O.
      await assertCro03cAuthorityBeforeIo(context);
      const input = await resolveCro03cStageInput(claim, stage, provider);
      const dispatchInput = provider === "first_party_web"
        ? freezeTree({ ...input, crawl: { ...(input as any).crawl, operationId: String(operation.id) } })
        : input;
      const result = await executeCro03cLiveProvider(
          { ...context, caller: "server/services/cro03/live-provider-executors.ts", provider },
          dispatchInput as any,
          { beforeTransportInvocation: markTransportMayHaveBeenInvoked },
      );
      await db.execute(sql`
        INSERT INTO cro03c_dispatch_checkpoints(stage_operation_id,attempt_id,checkpoint,authority_hash)
        VALUES (${operation.id}::uuid,${attemptId}::uuid,'transport_returned',
                ${hashCro03Evidence({ checkpointHash, result: result.evidenceHash })})
      `);
      await settleCro03cProviderOperation({
        operationId: String(operation.id), outcome: result.outcome,
        settledUnits: result.settledUnits, settledAmountMicros: result.settledAmountMicros,
        billingCertainty: result.outcome === "ambiguous" ? "ambiguous" : "none",
        providerReceiptReference: result.providerReference, evidenceHash: result.evidenceHash,
        metadata: result.redactedMetadata,
      });
      await db.execute(sql`
        UPDATE cro03c_stage_operations SET dispatch_state='reconciled'
         WHERE id=${operation.id}::uuid AND attempt_id=${attemptId}::uuid
      `);
    } catch (error) {
      // Do not rely solely on process memory: a crash/error after the durable
      // marker but before this stack flag is observed remains ambiguous.
      let durableDispatchUncertain = transportMayHaveBeenInvoked;
      if (!durableDispatchUncertain) {
        try {
          const state = rows(await db.execute(sql`
            SELECT dispatch_state,transport_may_have_been_invoked
              FROM cro03c_stage_operations
             WHERE id=${operation.id}::uuid AND attempt_id=${attemptId}::uuid
          `))[0];
          durableDispatchUncertain = !state ||
            state.dispatch_state === "dispatched" ||
            Boolean(state.transport_may_have_been_invoked);
        } catch {
          // An unavailable durable record cannot prove pre-I/O safety.
          durableDispatchUncertain = true;
        }
      }
      if (!durableDispatchUncertain) {
        await confirmCro03cNotDispatched(claim, String(operation.id), attemptId, checkpointHash);
        throw error;
      }
      await db.execute(sql`
        UPDATE cro03c_stage_operations
           SET dispatch_state='ambiguous',state='quarantined',reconciliation_required=TRUE
         WHERE id=${operation.id}::uuid AND attempt_id=${attemptId}::uuid
      `);
      throw error;
    }
  }

  if (claim.command_type === "initial_batch") {
    const continuation = await continueCro03cInitialGeneration(claim);
    if (continuation === "review_required") {
      await stopClaimForRequiredReview(claim, "initial-continuation");
      return "inconclusive";
    }
    if (continuation === "waiting") {
      await releaseWaitingClaim(claim);
      return "waiting";
    }
  }

  {
    const pause = await getPauseState();
    const pre = rows(await db.execute(sql`
      SELECT counters FROM cro03c_no_outbound_snapshots
       WHERE command_id=${claim.command_id}::uuid AND phase='pre_run'
    `))[0]?.counters ?? {};
    const post = await readCro03cGlobalNoOutboundCounters();
    // A linked forbidden attempt/effect is a hard failure; unrelated global
    // movement is only evidence that this run is inconclusive.
    const linked = rows(await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM cro03c_forbidden_effects
       WHERE command_id=${claim.command_id}::uuid
         AND correlation_id=${claim.effect_correlation_id}
         AND (attempted_count > 0 OR effective_count > 0)
    `))[0];
    const snapshotDisposition = classifyCro03cNoOutboundSnapshots(pre, post, Number(linked?.n ?? 0) > 0);
    if (Number(pre.pauseEpoch) !== Number(pause.epoch)) {
      throw new Error("CRO03C_OUTBOUND_EPOCH_CHANGED");
    }
    if (snapshotDisposition === "failed") throw new Error("CRO03C_LINKED_FORBIDDEN_EFFECT");
    if (snapshotDisposition === "inconclusive") throw new Error("CRO03C_GLOBAL_OUTBOUND_MOVEMENT_INCONCLUSIVE");
    await createCro03cNoOutboundSnapshot({
      commandId: claim.command_id,
      runId: claim.run_id,
      phase: "post_run",
      counters: post,
    });
  }
  await finishClaim(claim, false);
  return "completed";
}

export async function dispatchCro03cLive(commandId?: string): Promise<"idle" | "completed" | "waiting" | "failed" | "inconclusive"> {
  const claim = await claimGeneration(commandId);
  if (!claim) return "idle";
  try {
    // Only initial-batch continuation receives the deny context. In
    // particular, micro canaries cannot inherit or manufacture this fence.
    let progression: "completed" | "waiting" | "inconclusive";
    if (claim.command_type === "initial_batch") {
      progression = await withCro03cInitialBatchEffectFence({
        commandId: claim.command_id, runId: claim.run_id,
        correlationId: claim.effect_correlation_id, commandType: "initial_batch",
      }, () => dispatchClaim(claim));
    } else {
      progression = await dispatchClaim(claim);
    }
    if (progression !== "completed") return progression;
    const terminal = rows(await db.execute(sql`
      SELECT state FROM cro03c_generations WHERE id=${claim.generation_id}::uuid
    `))[0];
    return terminal?.state === "inconclusive_pending_reconciliation" ? "inconclusive" : "completed";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The original exception need not carry a transport-specific code (for
    // example a process/runtime throw immediately after the marker). The
    // durable operation state is authoritative for terminal run disposition.
    const quarantined = rows(await db.execute(sql`
      SELECT 1 FROM cro03c_stage_operations
       WHERE generation_id=${claim.generation_id}::uuid
         AND (dispatch_state='ambiguous' OR state='quarantined')
       LIMIT 1
    `))[0];
    const ambiguous = Boolean(quarantined) ||
      /CRO03C_DISPATCH_RECONCILIATION_REQUIRED|CRO03C_TRANSPORT_AMBIGUOUS|CRO03C_BILLING_AMBIGUOUS/.test(message);
    await finishClaim(claim, true, ambiguous).catch(() => undefined);
    throw error;
  }
}

/** Bounded recovery for missed events and expired leases; it never enqueues a successor batch. */
export async function recoverCro03cLiveDispatches(limit = CRO03C_LIVE_RECOVERY_LIMIT): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > CRO03C_LIVE_RECOVERY_LIMIT) {
    throw new Error("CRO03C_RECOVERY_LIMIT_INVALID");
  }
  let processed = 0;
  while (processed < limit) {
    const result = await dispatchCro03cLive();
    if (result === "idle") break;
    processed++;
    if (result === "waiting") break;
  }
  return processed;
}