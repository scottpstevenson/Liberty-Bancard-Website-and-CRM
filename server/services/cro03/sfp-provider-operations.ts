/**
 * Durable paid-provider boundary for the independent SFP program.
 *
 * A credential is never authority.  Live I/O requires, in order: program
 * activation, a current runtime attestation, typed aggregate-budget authority,
 * an unexpired reviewed price, provider manifest admission, an enabled/closed
 * control row, a committed unit/cost reservation, and a final pre-I/O lease
 * check.  Tests may inject a fake transport; fake execution never reserves or
 * consumes provider budget.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { assertProviderActivation, type ProviderSourceId } from "../provider-manifest";
import {
  assertAggregatePaidBudgetAvailable,
  assertPaidBudgetAuthorized,
  getCurrentPricingSchedule,
} from "../mi09-pilot-authority";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const CALLER = "server/services/cro03/sfp-provider-operations.ts";

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

/**
 * Shared in-transaction $50 ledger gate for Phase A and cohort-bound SFP
 * reservations. The caller must commit the returned reservation in the same
 * transaction as its provider operation/control-unit reservation. Exported
 * for deterministic disposable-Postgres race certification; it performs no
 * provider I/O and cannot authorize transport.
 */
export async function reserveSfpAggregateBudgetInTransaction(
  executor: { execute: (query: any) => Promise<any> },
  input: {
    reservationMicros: number;
    capMicros: number;
    externalSpendMicros: number;
    target: { kind: "precohort"; runId: string } | { kind: "cohort"; stageRunId: string };
  },
): Promise<void> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('sfp-paid-budget',0))`);
  const current = rows(await executor.execute(sql`
    SELECT
      (SELECT COALESCE(SUM(reserved_cost_micros+settled_cost_micros),0)
         FROM sfp_stage_runs WHERE state IN ('authorized','running','completed','partial')) +
      (SELECT COALESCE(SUM(reserved_cost_micros),0)
         FROM sfp_classification_runs WHERE state IN ('authorized','running')) +
      (SELECT COALESCE(SUM(cost_micros),0) FROM sfp_classification_evidence) AS micros
  `))[0];
  if (Number(current?.micros ?? 0) + input.externalSpendMicros + input.reservationMicros > input.capMicros) {
    throw new Error("SFP_PAID_BLOCKED:AGGREGATE_BUDGET_EXCEEDED");
  }
  const reserved = input.target.kind === "precohort"
    ? rows(await executor.execute(sql`
        UPDATE sfp_classification_runs
           SET reserved_cost_micros=reserved_cost_micros+${input.reservationMicros},
               state='running',updated_at=NOW()
         WHERE id=${input.target.runId}::uuid AND state IN ('running','authorized')
         RETURNING id
      `))[0]
    : rows(await executor.execute(sql`
        UPDATE sfp_stage_runs
           SET state='running',reserved_cost_micros=reserved_cost_micros+${input.reservationMicros},
               last_heartbeat_at=NOW(),updated_at=NOW()
         WHERE id=${input.target.stageRunId}::uuid AND state IN ('authorized','running')
         RETURNING id
      `))[0];
  if (!reserved) throw new Error("SFP_BUDGET_RESERVATION_TARGET_NOT_RUNNING");
}

export async function assertSfpRuntimeAuthority(cohortRunId: string): Promise<{ attestationId: string }> {
  const authority = rows(await db.execute(sql`
    SELECT a.id AS attestation_id
      FROM sfp_cohort_runs r
      JOIN sfp_programs p ON p.id=r.program_id
      JOIN LATERAL (
        SELECT id FROM cro03c_runtime_attestations
         WHERE expires_at>NOW() AND db_healthy=TRUE AND redis_healthy=TRUE
         ORDER BY captured_at DESC LIMIT 1
      ) a ON TRUE
     WHERE r.id=${cohortRunId}::uuid AND r.cohort_state='frozen' AND r.voided_at IS NULL
       AND r.superseded_at IS NULL AND p.is_active=TRUE
  `))[0];
  if (!authority) throw new Error("SFP_PAID_BLOCKED:NO_LIVE_RUNTIME_AUTHORITY");
  return { attestationId: String(authority.attestation_id) };
}

export async function currentSfpUnitPrice(provider: SfpPaidProvider): Promise<number> {
  const pricing = await getCurrentPricingSchedule();
  const key = provider === "openai_classification" ? "openai" : provider;
  const entry = pricing.priceSchedules[key] as any;
  const amount = Number(entry?.amountMicros);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`SFP_PAID_BLOCKED:PRICING_UNAVAILABLE:${key}`);
  }
  return amount;
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
  const authority = await assertSfpRuntimeAuthority(input.cohortRunId);
  const budgetAuth = await assertPaidBudgetAuthorized();
  const aggregate = await assertAggregatePaidBudgetAvailable();
  const units = Math.max(1, Math.min(MAX_UNITS_PER_RESERVATION[input.provider] ?? 100, Number(input.units ?? 1)));
  const amountMicros = await currentSfpUnitPrice(input.provider);
  const reservedMicros = units * amountMicros;
  if (!Number.isSafeInteger(reservedMicros) || reservedMicros > aggregate.remainingMicros) {
    throw new Error("SFP_PAID_BLOCKED:AGGREGATE_BUDGET_EXCEEDED");
  }
  const controlProvider = CONTROL_KEY[input.provider];

  return db.transaction(async (tx) => {
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
        replayed:true,resultData:existing.sfp_result_data ?? null,
      };
    }

    // Include independent SFP reservations/settlements in the same fixed $50
    // ceiling used by the pilot authority; getAggregatePilotSpend cannot see
    // SFP rows because they are intentionally not MI-09 pilot effect links.
    await reserveSfpAggregateBudgetInTransaction(tx, {
      reservationMicros: reservedMicros, capMicros: aggregate.capMicros,
      externalSpendMicros: aggregate.settledMicros + aggregate.reservedMicros,
      target: { kind: "cohort", stageRunId: input.stageRunId },
    });
    const reserved = rows(await tx.execute(sql`
      UPDATE provider_controls SET reserved_units=reserved_units+${units},version=version+1,updated_at=NOW()
       WHERE provider=${controlProvider} AND enabled=TRUE AND circuit_state='closed'
         AND local_budget_units IS NOT NULL
         AND reserved_units+consumed_units+${units}<=local_budget_units
       RETURNING provider
    `))[0];
    if (!reserved) throw new Error(`SFP_PAID_BLOCKED:PROVIDER_CONTROL:${controlProvider}`);
    const claimToken = randomUUID();
    const operation = rows(await tx.execute(sql`
      INSERT INTO provider_operations
        (provider,operation_type,purpose,idempotency_key,actor_type,actor_id,target_fingerprint,
         state,requested_units,reserved_units,billing_state,attempt_count,claim_token,lease_expires_at,started_at)
      VALUES (${controlProvider},'sfp_enrichment',${input.purpose},${input.idempotencyKey},'user',${input.actorId},
              ${`business:${input.businessId}`},'running',${units},${units},'reserved',1,${claimToken}::uuid,
              NOW()+INTERVAL '5 minutes',NOW()) RETURNING id
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
 * credential presence, provider-manifest admission, paid-budget authorization,
 * the provider_controls enabled/circuit-breaker/local-budget gate, and the
 * shared aggregate cap. The common in-transaction cap gate sums Phase A's
 * outstanding reservations and `sfp_classification_evidence` spend together
 * with cohort-bound stage-run reservations/settlements, so neither ledger
 * can race the other past the shared ceiling.
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
  await assertPaidBudgetAuthorized();
  const aggregate = await assertAggregatePaidBudgetAvailable();
  const units = Math.max(1, Math.min(MAX_UNITS_PER_RESERVATION[input.provider] ?? 100, Number(input.units ?? 1)));
  const amountMicros = await currentSfpUnitPrice(input.provider);
  const reservedMicros = units * amountMicros;
  const controlProvider = CONTROL_KEY[input.provider];

  return db.transaction(async (tx) => {
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
        controlProvider,amountMicros,units:Number(existing.reserved_units),runId:input.runId,
        replayed:true,resultData:existing.sfp_result_data ?? null,
      };
    }
    // Same $50 aggregate ceiling as reserveSfpProviderOperation, but also
    // folding in Phase A's own classification-evidence spend ledger (see
    // doc comment above) so both ledgers share one authoritative cap check.
    await reserveSfpAggregateBudgetInTransaction(tx, {
      reservationMicros: reservedMicros, capMicros: aggregate.capMicros,
      externalSpendMicros: aggregate.settledMicros + aggregate.reservedMicros,
      target: { kind: "precohort", runId: input.runId },
    });
    const reserved = rows(await tx.execute(sql`
      UPDATE provider_controls SET reserved_units=reserved_units+${units},version=version+1,updated_at=NOW()
       WHERE provider=${controlProvider} AND enabled=TRUE AND circuit_state='closed'
         AND local_budget_units IS NOT NULL
         AND reserved_units+consumed_units+${units}<=local_budget_units
       RETURNING provider
    `))[0];
    if (!reserved) throw new Error(`SFP_PAID_BLOCKED:PROVIDER_CONTROL:${controlProvider}`);
    const claimToken = randomUUID();
    const operation = rows(await tx.execute(sql`
      INSERT INTO provider_operations
        (provider,operation_type,purpose,idempotency_key,actor_type,actor_id,target_fingerprint,
         state,requested_units,reserved_units,billing_state,attempt_count,claim_token,lease_expires_at,started_at)
      VALUES (${controlProvider},'sfp_precohort_classification',${input.purpose},${input.idempotencyKey},'user',${input.actorId},
              ${`business:${input.businessId}`},'running',${units},${units},'reserved',1,${claimToken}::uuid,
              NOW()+INTERVAL '5 minutes',NOW()) RETURNING id
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
  outcome: "completed" | "no_result" | "failed" | "ambiguous";
  observation: "valid" | "invalid" | "risky" | "unknown" | "no_result" | "transport";
  businessId: number;
  settledUnits?: number;
  resultData?: unknown;
}, executor?: { execute: (query: any) => Promise<any> }): Promise<{ settledMicros: number; replayed: boolean }> {
  const completed = input.outcome === "completed" || input.outcome === "no_result";
  const settledUnits = completed ? Math.max(0, Math.min(input.reservation.units, input.settledUnits ?? input.reservation.units)) : 0;
  const settledMicros = settledUnits * input.reservation.amountMicros;
  const settle = async (tx: { execute: (query: any) => Promise<any> }) => {
    // The provider operation is the settlement fence. Only the claimant that
    // still owns a live reserved operation may move money or counters. A
    // concurrent/retried settlement observes the terminal row and becomes a
    // no-op instead of consuming units and spend twice.
    const operation = rows(await tx.execute(sql`
       UPDATE provider_operations SET state=${completed ? "completed" : "failed"},
             billing_state=${completed ? "committed" : input.outcome === "ambiguous" ? "ambiguous" : "released"},
              sfp_result_data=${input.resultData == null ? null : JSON.stringify(input.resultData)}::jsonb,
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
      UPDATE provider_controls SET reserved_units=GREATEST(0,reserved_units-${input.reservation.units}),
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
         SET reserved_cost_micros=GREATEST(0,reserved_cost_micros-${input.reservation.amountMicros * input.reservation.units}),
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
             AND r.reserved_cost_micros>0
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
  return transport();
}

export async function assertCurrentSfpProviderReservation(reservation: SfpProviderReservation): Promise<void> {
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
                    WHERE a.expires_at>NOW() AND a.db_healthy=TRUE AND a.redis_healthy=TRUE)
  `))[0];
  if (!current) throw new Error("SFP_PROVIDER_RESERVATION_INVALID");
}

/** Final fenced invocation used by cohort-bound paid provider paths. */
export async function invokeSfpProviderTransport<T>(
  reservation: SfpProviderReservation,
  transport: () => Promise<T>,
): Promise<T> {
  await assertCurrentSfpProviderReservation(reservation);
  return transport();
}

export async function settleSfpProviderOperation(input: {
  reservation: SfpProviderReservation;
  outcome: "completed" | "no_result" | "failed" | "ambiguous";
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
    const operation = rows(await tx.execute(sql`
      UPDATE provider_operations SET state=${completed ? "completed" : "failed"},
             billing_state=${completed ? "committed" : input.outcome === "ambiguous" ? "ambiguous" : "released"},
              sfp_result_data=${input.resultData == null ? null : JSON.stringify(input.resultData)}::jsonb,
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
      UPDATE provider_controls SET reserved_units=GREATEST(0,reserved_units-${input.reservation.units}),
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
      UPDATE sfp_stage_runs SET reserved_cost_micros=GREATEST(0,reserved_cost_micros-${input.reservation.amountMicros * input.reservation.units}),
             settled_cost_micros=settled_cost_micros+${settledMicros},processed_count=processed_count+1,
             succeeded_count=succeeded_count+${completed ? 1 : 0},failed_count=failed_count+${completed ? 0 : 1},
             last_heartbeat_at=NOW(),updated_at=NOW() WHERE id=${input.reservation.stageRunId}::uuid
    `);
    return { settledMicros, replayed: false };
  };
  return executor ? settle(executor) : db.transaction(settle);
}
