/**
 * Durable paid-provider boundary for the independent SFP program.
 *
 * A credential is never authority.  Live I/O requires, in order: program
 * activation, a current runtime attestation, explicit paid approval, provider
 * manifest admission, an enabled/closed control row, an operation receipt,
 * and a final pre-I/O lease
 * check.  Tests may inject a fake transport; fake execution never reserves or
 * updates operational usage receipts.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { assertProviderActivation, type ProviderSourceId } from "../provider-manifest";
import {
  assertPaidBudgetAuthorized,
  getCurrentPricingSchedule,
} from "../mi09-pilot-authority";
import { acquireLadderBudgetLock } from "./shared-paid-budget-ledger";
import { getCurrentSfpRuntimeFence } from "./sfp-runtime-fence";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const CALLER = "server/services/cro03/sfp-provider-operations.ts";
const publicProviderResultData = (value: any) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value ?? null;
  const { reservedUnitAmountMicros: _reservedUnitAmountMicros, ...result } = value;
  return Object.keys(result).length ? result : null;
};

type SfpPaidProvider = "zerobounce" | "serper" | "outscraper" | "apollo" | "openai_classification";
const CONTROL_KEY: Record<SfpPaidProvider, string> = {
  zerobounce: "zerobounce", serper: "serper", outscraper: "outscraper",
  apollo: "apollo", openai_classification: "openai",
};
const SECRET_KEY: Record<SfpPaidProvider, string> = {
  zerobounce: "ZEROBOUNCE_API_KEY", serper: "SERPER_API_KEY", outscraper: "OUTSCRAPER_API_KEY",
  apollo: "APOLLO_API_KEY", openai_classification: "AI_INTEGRATIONS_OPENAI_API_KEY",
};

// Per-provider reservation ceilings, keyed to each provider's real billing
// unit (see the C8 provider decision model): Serper/Outscraper/Apollo are
// bounded per-call by request/result counts, while OpenAI is token-priced
// and a fixed 100-unit ceiling would silently truncate a real completion's
// token reservation far below its actual usage, under-accounting real
// spend against the cost ledger. Each ceiling is a generous worst-case
// bound for a single call, not an unlimited allowance.
const MAX_UNITS_PER_RESERVATION: Record<SfpPaidProvider, number> = {
  zerobounce: 1,
  serper: 4,
  outscraper: 100,
  apollo: 100,
  openai_classification: 4000,
};

// Exported so any pre-flight gate that estimates provider-call consumption
// (e.g. the arm-pilot readiness check in routes/lead-ops.ts) reads the same
// per-reservation ceiling used by reserveSfpProviderOperation/
// reservePreCohortSfpProviderOperation, instead of hardcoding its own copy
// of the number. Both `provider_controls.reserved_units`/`consumed_units`
// (unit-denominated) and, for serper specifically, `serper_control.
// window_calls`/`local_budget` (raw API call counts) use "1 unit == 1 call"
// for this provider, so a single shared constant keeps both gates in sync.
export function maxUnitsPerSfpReservation(provider: SfpPaidProvider): number {
  return MAX_UNITS_PER_RESERVATION[provider] ?? 100;
}

export interface SfpProviderReservation {
  operationId: string;
  claimToken: string;
  provider: SfpPaidProvider;
  controlProvider: string;
  amountMicros: number;
  units: number;
  stageRunId: string;
  replayed?: boolean;
  resultData?: any;
}

export async function assertSfpRuntimeAuthority(cohortRunId: string): Promise<{ attestationId: string }> {
  const fence = await getCurrentSfpRuntimeFence();
  if (!fence) throw new Error("SFP_PAID_BLOCKED:NO_LIVE_RUNTIME_AUTHORITY");
  const authority = rows(await db.execute(sql`
    SELECT a.id AS attestation_id
      FROM sfp_cohort_runs r
      JOIN sfp_programs p ON p.id=r.program_id
      JOIN LATERAL (
        SELECT id FROM cro03c_runtime_attestations
         WHERE expires_at>NOW() AND db_healthy=TRUE AND redis_healthy=TRUE
           AND artifact_sha=${fence.artifactSha}
           AND deployment_identity=${fence.deploymentIdentity}
           AND environment_identity=${fence.environmentIdentity}
           AND queue_topology_hash=${fence.queueTopologyHash}
           AND worker_identities @> ${JSON.stringify([fence.processIdentity])}::jsonb
         ORDER BY captured_at DESC LIMIT 1
      ) a ON TRUE
     WHERE r.id=${cohortRunId}::uuid AND r.cohort_state='frozen' AND r.voided_at IS NULL
       AND r.superseded_at IS NULL AND p.is_active=TRUE
  `))[0];
  if (!authority) throw new Error("SFP_PAID_BLOCKED:NO_LIVE_RUNTIME_AUTHORITY");
  return { attestationId: String(authority.attestation_id) };
}

/**
 * Fast, side-effect-free readiness check for provider_controls
 * (enabled + circuit closed).
 * Continuous background ticks call this BEFORE touching any cohort/stage
 * row so a disabled or circuit-open provider becomes a durable "paused" outcome —
 * no cohort freeze, no stage claim, no reservation attempt, nothing to get
 * stuck in a partial state and no retry storm. This deliberately duplicates
 * (rather than weakens) the authoritative checks inside
 * reserveSfpProviderOperation/previewSfpValidation, which still run their
 * authoritative checks at actual reservation time.
 */
export async function getSfpProviderReadiness(
  provider: SfpPaidProvider,
): Promise<{ ready: boolean; reason: string | null }> {
  const controlProvider = CONTROL_KEY[provider];
  const control = rows(await db.execute(sql`
    SELECT enabled, circuit_state
      FROM provider_controls WHERE provider=${controlProvider}
  `))[0];
  if (!control) return { ready: false, reason: `provider_control_missing:${controlProvider}` };
  if (!control.enabled) return { ready: false, reason: `provider_disabled:${controlProvider}` };
  if (control.circuit_state !== "closed") return { ready: false, reason: `provider_circuit_${control.circuit_state}:${controlProvider}` };
  if (!process.env[SECRET_KEY[provider]]) return { ready: false, reason: `credential_missing:${SECRET_KEY[provider]}` };
  return { ready: true, reason: null };
}

/**
 * Side-effect-free pre-check mirroring assertSfpRuntimeAuthority's exact
 * SELECT, but returning {ready,reason} instead of throwing. The runtime
 * attestation is deliberately short-lived (<=15 min TTL) and, until this
 * fix, was only ever (re)created via a manual admin ceremony endpoint
 * (routes/cro03.ts) — nothing refreshed it on a schedule, so a scheduled
 * worker hitting an expired attestation looked identical to a hard failure
 * and could silently stall validation forever with no distinct signal.
 * Continuous ticks call this first so "no live attestation right now" is
 * its own quiet, resumable outcome (like provider_paused), not a crash.
 */
export async function getSfpAttestationReadiness(
  cohortRunId: string,
): Promise<{ ready: boolean; reason: string | null }> {
  const fence = await getCurrentSfpRuntimeFence();
  if (!fence) return { ready: false, reason: "runtime_identity_unverified" };
  const authority = rows(await db.execute(sql`
    SELECT a.id AS attestation_id
      FROM sfp_cohort_runs r
      JOIN sfp_programs p ON p.id=r.program_id
      JOIN LATERAL (
        SELECT id FROM cro03c_runtime_attestations
         WHERE expires_at>NOW() AND db_healthy=TRUE AND redis_healthy=TRUE
           AND artifact_sha=${fence.artifactSha}
           AND deployment_identity=${fence.deploymentIdentity}
           AND environment_identity=${fence.environmentIdentity}
           AND queue_topology_hash=${fence.queueTopologyHash}
           AND worker_identities @> ${JSON.stringify([fence.processIdentity])}::jsonb
         ORDER BY captured_at DESC LIMIT 1
      ) a ON TRUE
     WHERE r.id=${cohortRunId}::uuid AND r.cohort_state='frozen' AND r.voided_at IS NULL
       AND r.superseded_at IS NULL AND p.is_active=TRUE
  `))[0];
  if (!authority) return { ready: false, reason: "no_live_runtime_attestation" };
  return { ready: true, reason: null };
}

export async function currentSfpUnitPrice(provider: SfpPaidProvider): Promise<number | null> {
  try {
    const pricing = await getCurrentPricingSchedule();
    const key = provider === "openai_classification" ? "openai" : provider;
    const entry = pricing.priceSchedules[key] as any;
    const amount = Number(entry?.amountMicros);
    // Keep price data for historical estimates only. Its absence must never
    // authorize or prevent a paid provider request.
    return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
  } catch {
    return null;
  }
}

export function sfpPriceEstimateReceipt(unitPriceEstimateMicros: number | null): {
  unitPriceEstimateMicros: number | null;
  unitPriceEstimateStatus: "estimate" | "unknown";
  costEstimateStatus: "estimate" | "unknown";
} {
  return {
    unitPriceEstimateMicros,
    unitPriceEstimateStatus: unitPriceEstimateMicros === null ? "unknown" : "estimate",
    costEstimateStatus: unitPriceEstimateMicros === null ? "unknown" : "estimate",
  };
}

/**
 * Release only expired reservations whose durable attempt is still pending.
 * invoke*SfpProviderTransport changes that marker to ambiguous under the same
 * ledger lock immediately before transport; those post-dispatch rows are never
 * auto-released. Legacy reservations without the stored unit price or run
 * lineage are retained conservatively for operator reconciliation.
 */
export async function releaseExpiredPreDispatchSfpReservations(): Promise<number> {
  return db.transaction(async (tx) => {
    await acquireLadderBudgetLock(tx);
    const expired = rows(await tx.execute(sql`
      SELECT o.id,o.provider,o.reserved_units,o.idempotency_key,o.operation_type,
             o.sfp_result_data->>'reservedUnitAmountMicros' AS unit_amount_micros
        FROM provider_operations o
        JOIN provider_attempts a ON a.operation_id=o.id AND a.attempt_number=1
       WHERE o.operation_type IN ('sfp_enrichment','sfp_precohort_classification')
         AND o.state='running' AND o.billing_state='reserved'
         AND o.lease_expires_at<=NOW() AND a.outcome='pending' AND a.completed_at IS NULL
         AND o.sfp_result_data ? 'reservedUnitAmountMicros'
       FOR UPDATE OF o,a
    `));
    let released = 0;
    for (const operation of expired) {
      const amountMicros = Number(operation.unit_amount_micros) * Number(operation.reserved_units);
      if (!Number.isSafeInteger(amountMicros) || amountMicros < 0) continue;
      const updated = rows(await tx.execute(sql`
        UPDATE provider_operations
           SET state='failed',billing_state='released',failure_code='PRE_DISPATCH_LEASE_EXPIRED',
               claim_token=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW()
         WHERE id=${String(operation.id)}::uuid AND state='running' AND billing_state='reserved'
         RETURNING id
      `))[0];
      if (!updated) continue;
      await tx.execute(sql`
        UPDATE provider_attempts SET outcome='blocked',retryable=TRUE,error_code='PRE_DISPATCH_LEASE_EXPIRED',
               completed_at=NOW()
         WHERE operation_id=${String(operation.id)}::uuid AND attempt_number=1
           AND outcome='pending' AND completed_at IS NULL
      `);
      await tx.execute(sql`
        UPDATE provider_controls SET reserved_units=GREATEST(0,reserved_units-${Number(operation.reserved_units)}),
               version=version+1,updated_at=NOW()
         WHERE provider=${String(operation.provider)}
      `);
      if (String(operation.operation_type) === "sfp_enrichment") {
        await tx.execute(sql`
          UPDATE sfp_stage_runs sr
             SET reserved_cost_micros=GREATEST(0,sr.reserved_cost_micros-${amountMicros}),updated_at=NOW()
            FROM sfp_stage_items i
           WHERE i.provider_operation_id=${String(operation.id)}::uuid AND sr.id=i.stage_run_id
        `);
      } else {
        const runId = rows(await tx.execute(sql`
          SELECT id FROM sfp_classification_runs
           WHERE ${String(operation.idempotency_key)} LIKE '%' || ':run:' || id::text
           LIMIT 1
        `))[0]?.id;
        if (!runId) {
          // Do not commit a partial release if run lineage was not retained.
          throw new Error("SFP_EXPIRED_RESERVATION_RUN_LINEAGE_MISSING");
        }
        await tx.execute(sql`
          UPDATE sfp_classification_runs
             SET reserved_cost_micros=GREATEST(0,reserved_cost_micros-${amountMicros}),updated_at=NOW()
           WHERE id=${String(runId)}::uuid
        `);
      }
      released++;
    }
    return released;
  });
}

export async function reserveSfpProviderOperation(input: {
  stageRunId: string;
  cohortRunId: string;
  businessId: number;
  candidateId?: string | null;
  provider: SfpPaidProvider;
  purpose: string;
  idempotencyKey: string;
  actorId: string;
  units?: number;
}): Promise<SfpProviderReservation> {
  if (process.env.CRO03_PROVIDER_TRANSPORT_ENABLED !== "true") {
    throw new Error("SFP_PAID_BLOCKED:PROVIDER_TRANSPORT_DISABLED");
  }
  if (!process.env[SECRET_KEY[input.provider]]) {
    throw new Error(`SFP_PAID_BLOCKED:CREDENTIAL_MISSING:${SECRET_KEY[input.provider]}`);
  }
  const sourceId = input.provider as ProviderSourceId;
  assertProviderActivation({ sourceId, caller: CALLER, explicitPaidApproval: true });
  await releaseExpiredPreDispatchSfpReservations();
  const authority = await assertSfpRuntimeAuthority(input.cohortRunId);
  const budgetAuth = await assertPaidBudgetAuthorized();
  const units = Math.max(1, Math.min(MAX_UNITS_PER_RESERVATION[input.provider] ?? 100, Number(input.units ?? 1)));
  const unitPriceEstimateMicros = await currentSfpUnitPrice(input.provider);
  const amountMicros = unitPriceEstimateMicros ?? 0;
  const controlProvider = CONTROL_KEY[input.provider];

  return db.transaction(async (tx) => {
    const quarantine = rows(await tx.execute(sql`
      SELECT 1 FROM sfp_identity_quarantines
       WHERE business_id=${input.businessId} AND cleared_at IS NULL LIMIT 1
    `))[0];
    if (quarantine) throw new Error("SFP_PAID_BLOCKED:IDENTITY_QUARANTINED");
    const existing = rows(await tx.execute(sql`
       SELECT id,claim_token,reserved_units,state,sfp_result_data FROM provider_operations
       WHERE provider=${controlProvider} AND idempotency_key=${input.idempotencyKey} LIMIT 1
    `))[0];
    if (existing) {
      if (String(existing.state) === "running") throw new Error("SFP_PAID_BLOCKED:OPERATION_ALREADY_RUNNING");
      if (String(existing.state) !== "completed") {
        throw new Error(`SFP_PAID_BLOCKED:OPERATION_${String(existing.state).toUpperCase()}`);
      }
      return {
        operationId:String(existing.id),claimToken:String(existing.claim_token ?? ""),provider:input.provider,
        controlProvider,amountMicros,units:Number(existing.reserved_units),stageRunId:input.stageRunId,
         replayed:true,resultData:publicProviderResultData(existing.sfp_result_data),
      };
    }

    const reserved = rows(await tx.execute(sql`
      UPDATE provider_controls SET reserved_units=reserved_units+${units},version=version+1,updated_at=NOW()
       WHERE provider=${controlProvider} AND enabled=TRUE AND circuit_state='closed'
       RETURNING provider
    `))[0];
    if (!reserved) throw new Error(`SFP_PAID_BLOCKED:PROVIDER_CONTROL:${controlProvider}`);
    const claimToken = randomUUID();
    const operation = rows(await tx.execute(sql`
      INSERT INTO provider_operations
        (provider,operation_type,purpose,idempotency_key,actor_type,actor_id,target_fingerprint,
          state,requested_units,reserved_units,billing_state,attempt_count,claim_token,lease_expires_at,started_at,sfp_result_data)
      VALUES (${controlProvider},'sfp_enrichment',${input.purpose},${input.idempotencyKey},'user',${input.actorId},
              ${`business:${input.businessId}`},'running',${units},${units},'reserved',1,${claimToken}::uuid,
                NOW()+INTERVAL '5 minutes',NOW(),
                ${JSON.stringify({
                  reservedUnitAmountMicros: unitPriceEstimateMicros,
                  ...sfpPriceEstimateReceipt(unitPriceEstimateMicros),
                })}::jsonb) RETURNING id
    `))[0];
    await tx.execute(sql`
      INSERT INTO provider_attempts(operation_id,attempt_number,outcome,started_at)
      VALUES (${String(operation.id)}::uuid,1,'pending',NOW())
    `);
    await tx.execute(sql`
      UPDATE sfp_stage_runs SET
             "authorization"=${JSON.stringify({ attestationId: authority.attestationId, budgetAuthorizedAt: budgetAuth.authorizedAt })}::jsonb,
             last_heartbeat_at=NOW(),updated_at=NOW()
       WHERE id=${input.stageRunId}::uuid
    `);
    await tx.execute(sql`
      INSERT INTO sfp_stage_items(stage_run_id,business_id,provider,candidate_id,provider_operation_id,state,claim_token,lease_expires_at,attempt_count)
      VALUES (${input.stageRunId}::uuid,${input.businessId},${controlProvider},${input.candidateId ?? null}::uuid,
              ${String(operation.id)}::uuid,'claimed',${claimToken}::uuid,NOW()+INTERVAL '5 minutes',1)
      ON CONFLICT (stage_run_id,business_id,provider) DO UPDATE
        SET provider_operation_id=EXCLUDED.provider_operation_id,state='claimed',claim_token=EXCLUDED.claim_token,
            lease_expires_at=EXCLUDED.lease_expires_at,attempt_count=sfp_stage_items.attempt_count+1,updated_at=NOW()
    `);
    return { operationId:String(operation.id),claimToken,provider:input.provider,controlProvider,
             amountMicros,units,stageRunId:input.stageRunId };
  });
}

/**
 * Pre-cohort variant of {@link reserveSfpProviderOperation} for Phase A
 * (independent SFP classification bridge, sfp-classification-bridge.ts).
 * Phase A has no frozen cohort and is forbidden from writing
 * sfp_stage_runs/sfp_stage_items — so this omits `assertSfpRuntimeAuthority`
 * (which requires a frozen `sfp_cohort_runs` row) and the stage-run/item
 * writes, but keeps every other real guardrail: provider transport flag,
 * credential presence, provider-manifest admission, explicit paid approval,
 * and the provider_controls enabled/circuit-breaker gate.
 */
export interface SfpPreCohortProviderReservation {
  operationId: string;
  claimToken: string;
  provider: SfpPaidProvider;
  controlProvider: string;
  amountMicros: number;
  units: number;
  runId: string;
  replayed?: boolean;
  resultData?: any;
}

export async function reservePreCohortSfpProviderOperation(input: {
  runId: string;
  businessId: number;
  provider: SfpPaidProvider;
  purpose: string;
  idempotencyKey: string;
  actorId: string;
  units?: number;
}): Promise<SfpPreCohortProviderReservation> {
  if (process.env.CRO03_PROVIDER_TRANSPORT_ENABLED !== "true") {
    throw new Error("SFP_PAID_BLOCKED:PROVIDER_TRANSPORT_DISABLED");
  }
  if (!process.env[SECRET_KEY[input.provider]]) {
    throw new Error(`SFP_PAID_BLOCKED:CREDENTIAL_MISSING:${SECRET_KEY[input.provider]}`);
  }
  const sourceId = input.provider as ProviderSourceId;
  assertProviderActivation({ sourceId, caller: "server/services/cro03/sfp-classification-bridge.ts", explicitPaidApproval: true });
  await releaseExpiredPreDispatchSfpReservations();
  await assertPaidBudgetAuthorized();
  const units = Math.max(1, Math.min(MAX_UNITS_PER_RESERVATION[input.provider] ?? 100, Number(input.units ?? 1)));
  const unitPriceEstimateMicros = await currentSfpUnitPrice(input.provider);
  const amountMicros = unitPriceEstimateMicros ?? 0;
  const controlProvider = CONTROL_KEY[input.provider];
  // Include the owning run as durable lineage so an expired, provably
  // pre-dispatch reservation can be returned to precisely that run ledger.
  const idempotencyKey = `${input.idempotencyKey}:run:${input.runId}`;

  return db.transaction(async (tx) => {
    const quarantine = rows(await tx.execute(sql`
      SELECT 1 FROM sfp_identity_quarantines
       WHERE business_id=${input.businessId} AND cleared_at IS NULL LIMIT 1
    `))[0];
    if (quarantine) throw new Error("SFP_PAID_BLOCKED:IDENTITY_QUARANTINED");
    const existing = rows(await tx.execute(sql`
       SELECT id,claim_token,reserved_units,state,sfp_result_data FROM provider_operations
        WHERE provider=${controlProvider} AND idempotency_key=${idempotencyKey} LIMIT 1
    `))[0];
    if (existing) {
      if (String(existing.state) === "running") throw new Error("SFP_PAID_BLOCKED:OPERATION_ALREADY_RUNNING");
      if (String(existing.state) !== "completed") {
        throw new Error(`SFP_PAID_BLOCKED:OPERATION_${String(existing.state).toUpperCase()}`);
      }
      return {
        operationId:String(existing.id),claimToken:String(existing.claim_token ?? ""),provider:input.provider,
        controlProvider,amountMicros,units:Number(existing.reserved_units),runId:input.runId,
         replayed:true,resultData:publicProviderResultData(existing.sfp_result_data),
      };
    }
    const reserved = rows(await tx.execute(sql`
      UPDATE provider_controls SET reserved_units=reserved_units+${units},version=version+1,updated_at=NOW()
       WHERE provider=${controlProvider} AND enabled=TRUE AND circuit_state='closed'
       RETURNING provider
    `))[0];
    if (!reserved) throw new Error(`SFP_PAID_BLOCKED:PROVIDER_CONTROL:${controlProvider}`);
    const claimToken = randomUUID();
    const operation = rows(await tx.execute(sql`
      INSERT INTO provider_operations
        (provider,operation_type,purpose,idempotency_key,actor_type,actor_id,target_fingerprint,
          state,requested_units,reserved_units,billing_state,attempt_count,claim_token,lease_expires_at,started_at,sfp_result_data)
       VALUES (${controlProvider},'sfp_precohort_classification',${input.purpose},${idempotencyKey},'user',${input.actorId},
              ${`business:${input.businessId}`},'running',${units},${units},'reserved',1,${claimToken}::uuid,
                NOW()+INTERVAL '5 minutes',NOW(),
                ${JSON.stringify({
                  reservedUnitAmountMicros: unitPriceEstimateMicros,
                  ...sfpPriceEstimateReceipt(unitPriceEstimateMicros),
                })}::jsonb) RETURNING id
    `))[0];
    await tx.execute(sql`
      INSERT INTO provider_attempts(operation_id,attempt_number,outcome,started_at)
      VALUES (${String(operation.id)}::uuid,1,'pending',NOW())
    `);
    return { operationId:String(operation.id),claimToken,provider:input.provider,controlProvider,amountMicros,units,runId:input.runId };
  });
}

export async function settlePreCohortSfpProviderOperation(input: {
  reservation: SfpPreCohortProviderReservation;
  outcome: "completed" | "no_result" | "failed" | "ambiguous" | "not_dispatched";
  observation: "valid" | "invalid" | "risky" | "unknown" | "no_result" | "transport";
  businessId: number;
  settledUnits?: number;
  resultData?: unknown;
}, executor?: { execute: (query: any) => Promise<any> }): Promise<{ settledMicros: number; replayed: boolean }> {
  const completed = input.outcome === "completed" || input.outcome === "no_result";
  const settledUnits = completed ? Math.max(0, Math.min(input.reservation.units, input.settledUnits ?? input.reservation.units)) : 0;
  const settledMicros = settledUnits * input.reservation.amountMicros;
  const settle = async (tx: { execute: (query: any) => Promise<any> }) => {
    await acquireLadderBudgetLock(tx);
    const attemptState = rows(await tx.execute(sql`
      SELECT outcome FROM provider_attempts
       WHERE operation_id=${input.reservation.operationId}::uuid AND attempt_number=1
    `))[0];
    const dispatchWasMarked = String(attemptState?.outcome ?? "") === "ambiguous";
    const notDispatched = !completed && !dispatchWasMarked &&
      (input.outcome === "failed" || input.outcome === "not_dispatched");
    const billingAmbiguous = !completed && (input.outcome === "ambiguous" || dispatchWasMarked);
    // The provider operation is the settlement fence. Only the claimant that
    // still owns a live reserved operation may move money or counters. A
    // concurrent/retried settlement observes the terminal row and becomes a
    // no-op instead of consuming units and spend twice.
    const operation = rows(await tx.execute(sql`
       UPDATE provider_operations SET state=${completed ? "completed" : "failed"},
              billing_state=${completed ? "committed" : billingAmbiguous ? "ambiguous" : "released"},
               sfp_result_data=COALESCE(sfp_result_data,'{}'::jsonb) ||
                 ${JSON.stringify(input.resultData ?? {})}::jsonb,
              claim_token=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW()
        WHERE id=${input.reservation.operationId}::uuid
          AND state='running' AND billing_state='reserved'
          AND claim_token=${input.reservation.claimToken}::uuid
      RETURNING id
    `))[0];
    if (!operation) {
      const existing = rows(await tx.execute(sql`
        SELECT state,billing_state FROM provider_operations
         WHERE id=${input.reservation.operationId}::uuid
      `))[0];
      if (existing && ["completed", "failed", "cancelled"].includes(String(existing.state))
          && String(existing.billing_state) !== "reserved") {
        return { settledMicros: 0, replayed: true };
      }
      throw new Error("SFP_PROVIDER_SETTLEMENT_FENCE_LOST");
    }
    const attempt = rows(await tx.execute(sql`
      UPDATE provider_attempts SET outcome=${completed ? (input.outcome === "no_result" ? "no_result" : "completed") : input.outcome === "ambiguous" ? "ambiguous" : "retryable_failed"},
             retryable=${!completed},error_code=${completed ? null : input.observation},completed_at=NOW()
       WHERE operation_id=${input.reservation.operationId}::uuid AND attempt_number=1
         AND completed_at IS NULL
       RETURNING id
    `))[0];
    if (!attempt) throw new Error("SFP_PROVIDER_SETTLEMENT_ATTEMPT_MISSING");
     await tx.execute(sql`
       UPDATE provider_controls SET reserved_units=GREATEST(0,reserved_units-${notDispatched || completed ? input.reservation.units : 0}),
              consumed_units=consumed_units+${settledUnits},
             last_completed_at=${completed ? sql`NOW()` : sql`last_completed_at`},last_outcome=${input.observation},
             version=version+1,updated_at=NOW() WHERE provider=${input.reservation.controlProvider}
    `);
    await tx.execute(sql`
      INSERT INTO provider_observations(provider,operation_id,attempt_id,subject_type,subject_id,email_token_hash,outcome,retryable)
      VALUES (${input.reservation.controlProvider},${input.reservation.operationId}::uuid,${attempt ? String(attempt.id) : null}::uuid,
              'business',${input.businessId},NULL,${input.observation},${!completed})
    `);
    await tx.execute(sql`
       UPDATE sfp_classification_runs
          SET reserved_cost_micros=GREATEST(0,reserved_cost_micros-${notDispatched || completed ? input.reservation.amountMicros * input.reservation.units : 0}),
             settled_cost_micros=settled_cost_micros+${settledMicros},updated_at=NOW()
       WHERE id=${input.reservation.runId}::uuid
    `);
    return { settledMicros, replayed: false };
  };
  return executor ? settle(executor) : db.transaction(settle);
}

/** Last-mile Phase-A fence, called immediately before any provider fetch. */
export async function assertCurrentPreCohortSfpProviderReservation(
  reservation: SfpPreCohortProviderReservation,
): Promise<void> {
  const current = rows(await db.execute(sql`
    SELECT o.id
      FROM provider_operations o
      JOIN provider_controls pc ON pc.provider=o.provider
     WHERE o.id=${reservation.operationId}::uuid
       AND o.claim_token=${reservation.claimToken}::uuid
       AND o.state='running' AND o.lease_expires_at>NOW()
       AND o.cancel_requested_at IS NULL
        AND pc.enabled=TRUE AND pc.circuit_state='closed'
        AND EXISTS (
          SELECT 1 FROM sfp_classification_runs r
           WHERE r.id=${reservation.runId}::uuid AND r.state='running'
        )
  `))[0];
  if (!current) throw new Error("SFP_PROVIDER_RESERVATION_INVALID");
}

/** Final fenced invocation used by provider paths and transport-spy certification. */
export async function invokePreCohortSfpProviderTransport<T>(
  reservation: SfpPreCohortProviderReservation,
  transport: () => Promise<T>,
): Promise<T> {
  await assertCurrentPreCohortSfpProviderReservation(reservation);
  await markSfpProviderOperationDispatchBoundary(reservation.operationId, reservation.claimToken);
  return transport();
}

/**
 * Persist the point after which a lost process/transport error can no longer
 * safely be treated as an unbilled pre-dispatch expiry. The legacy schema has
 * no dedicated dispatch column; provider_attempts.outcome='ambiguous' is an
 * allowed in-flight marker and terminal settlement replaces it with the
 * resolved outcome. The shared lock serializes this boundary with ledger
 * reads and reservations.
 */
async function markSfpProviderOperationDispatchBoundary(operationId: string, claimToken: string): Promise<void> {
  await db.transaction(async (tx) => {
    await acquireLadderBudgetLock(tx);
    const marked = rows(await tx.execute(sql`
      UPDATE provider_attempts a SET outcome='ambiguous'
       FROM provider_operations o
       WHERE a.operation_id=o.id AND o.id=${operationId}::uuid
         AND o.claim_token=${claimToken}::uuid AND o.state='running'
         AND o.billing_state='reserved' AND o.lease_expires_at>NOW()
         AND a.attempt_number=1 AND a.outcome='pending' AND a.completed_at IS NULL
       RETURNING a.id
    `))[0];
    if (!marked) throw new Error("SFP_PROVIDER_DISPATCH_BOUNDARY_LOST");
  });
}

export async function assertCurrentSfpProviderReservation(reservation: SfpProviderReservation): Promise<void> {
  const fence = await getCurrentSfpRuntimeFence();
  if (!fence) throw new Error("SFP_PROVIDER_RESERVATION_INVALID");
  const current = rows(await db.execute(sql`
    SELECT o.id FROM provider_operations o
      JOIN provider_controls pc ON pc.provider=o.provider
      JOIN sfp_stage_items i ON i.provider_operation_id=o.id
      JOIN sfp_stage_runs sr ON sr.id=i.stage_run_id
      JOIN sfp_cohort_runs cr ON cr.id=sr.cohort_run_id
      JOIN sfp_programs p ON p.id=cr.program_id
     WHERE o.id=${reservation.operationId}::uuid AND o.claim_token=${reservation.claimToken}::uuid
       AND o.state='running' AND o.lease_expires_at>NOW() AND o.cancel_requested_at IS NULL
       AND pc.enabled=TRUE AND pc.circuit_state='closed'
       AND i.state='claimed' AND i.lease_expires_at>NOW()
       AND sr.state='running' AND p.is_active=TRUE
       AND EXISTS (SELECT 1 FROM cro03c_runtime_attestations a
                    WHERE a.expires_at>NOW() AND a.db_healthy=TRUE AND a.redis_healthy=TRUE
                      AND a.artifact_sha=${fence.artifactSha}
                      AND a.deployment_identity=${fence.deploymentIdentity}
                      AND a.environment_identity=${fence.environmentIdentity}
                      AND a.queue_topology_hash=${fence.queueTopologyHash}
                      AND a.worker_identities @> ${JSON.stringify([fence.processIdentity])}::jsonb)
  `))[0];
  if (!current) throw new Error("SFP_PROVIDER_RESERVATION_INVALID");
}

/** Final fenced invocation used by cohort-bound paid provider paths. */
export async function invokeSfpProviderTransport<T>(
  reservation: SfpProviderReservation,
  transport: () => Promise<T>,
): Promise<T> {
  await assertCurrentSfpProviderReservation(reservation);
  await markSfpProviderOperationDispatchBoundary(reservation.operationId, reservation.claimToken);
  return transport();
}

export async function settleSfpProviderOperation(input: {
  reservation: SfpProviderReservation;
  outcome: "completed" | "no_result" | "failed" | "ambiguous" | "not_dispatched";
  observation: "valid" | "invalid" | "risky" | "unknown" | "no_result" | "transport";
  businessId: number;
  emailTokenHash?: string | null;
  settledUnits?: number;
  resultData?: unknown;
}, executor?: { execute: (query: any) => Promise<any> }): Promise<{ settledMicros: number; replayed: boolean }> {
  const completed = input.outcome === "completed" || input.outcome === "no_result";
  const settledUnits = completed ? Math.max(0, Math.min(input.reservation.units, input.settledUnits ?? input.reservation.units)) : 0;
  const settledMicros = settledUnits * input.reservation.amountMicros;
  const settle = async (tx: { execute: (query: any) => Promise<any> }) => {
    await acquireLadderBudgetLock(tx);
    const attemptState = rows(await tx.execute(sql`
      SELECT outcome FROM provider_attempts
       WHERE operation_id=${input.reservation.operationId}::uuid AND attempt_number=1
    `))[0];
    const dispatchWasMarked = String(attemptState?.outcome ?? "") === "ambiguous";
    const notDispatched = !completed && !dispatchWasMarked &&
      (input.outcome === "failed" || input.outcome === "not_dispatched");
    const billingAmbiguous = !completed && (input.outcome === "ambiguous" || dispatchWasMarked);
    const operation = rows(await tx.execute(sql`
      UPDATE provider_operations SET state=${completed ? "completed" : "failed"},
              billing_state=${completed ? "committed" : billingAmbiguous ? "ambiguous" : "released"},
              sfp_result_data=COALESCE(sfp_result_data,'{}'::jsonb) ||
                ${JSON.stringify(input.resultData ?? {})}::jsonb,
              claim_token=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW()
       WHERE id=${input.reservation.operationId}::uuid
         AND state='running' AND billing_state='reserved'
         AND claim_token=${input.reservation.claimToken}::uuid
      RETURNING id
    `))[0];
    if (!operation) {
      const existing = rows(await tx.execute(sql`
        SELECT state,billing_state FROM provider_operations
         WHERE id=${input.reservation.operationId}::uuid
      `))[0];
      if (existing && ["completed", "failed", "cancelled"].includes(String(existing.state))
          && String(existing.billing_state) !== "reserved") {
        return { settledMicros: 0, replayed: true };
      }
      throw new Error("SFP_PROVIDER_SETTLEMENT_FENCE_LOST");
    }
    const attempt = rows(await tx.execute(sql`
      UPDATE provider_attempts SET outcome=${completed ? (input.outcome === "no_result" ? "no_result" : "completed") : input.outcome === "ambiguous" ? "ambiguous" : "retryable_failed"},
             retryable=${!completed},error_code=${completed ? null : input.observation},completed_at=NOW()
       WHERE operation_id=${input.reservation.operationId}::uuid AND attempt_number=1
         AND completed_at IS NULL
       RETURNING id
    `))[0];
    if (!attempt) throw new Error("SFP_PROVIDER_SETTLEMENT_ATTEMPT_MISSING");
     await tx.execute(sql`
       UPDATE provider_controls SET reserved_units=GREATEST(0,reserved_units-${notDispatched || completed ? input.reservation.units : 0}),
              consumed_units=consumed_units+${settledUnits},
             last_completed_at=${completed ? sql`NOW()` : sql`last_completed_at`},last_outcome=${input.observation},
             version=version+1,updated_at=NOW() WHERE provider=${input.reservation.controlProvider}
    `);
    await tx.execute(sql`
      INSERT INTO provider_observations(provider,operation_id,attempt_id,subject_type,subject_id,email_token_hash,outcome,retryable)
      VALUES (${input.reservation.controlProvider},${input.reservation.operationId}::uuid,${String(attempt.id)}::uuid,
              'business',${input.businessId},${input.emailTokenHash ?? null},${input.observation},${!completed})
    `);
    await tx.execute(sql`
      UPDATE sfp_stage_items SET state=${completed ? (input.outcome === "no_result" ? "no_result" : "completed") : "failed"},
             outcome_code=${input.observation},completed_at=NOW(),updated_at=NOW()
       WHERE provider_operation_id=${input.reservation.operationId}::uuid
    `);
    await tx.execute(sql`
       UPDATE sfp_stage_runs SET reserved_cost_micros=GREATEST(0,reserved_cost_micros-${notDispatched || completed ? input.reservation.amountMicros * input.reservation.units : 0}),
             settled_cost_micros=settled_cost_micros+${settledMicros},processed_count=processed_count+1,
             succeeded_count=succeeded_count+${completed ? 1 : 0},failed_count=failed_count+${completed ? 0 : 1},
             last_heartbeat_at=NOW(),updated_at=NOW() WHERE id=${input.reservation.stageRunId}::uuid
    `);
    return { settledMicros, replayed: false };
  };
  return executor ? settle(executor) : db.transaction(settle);
}
