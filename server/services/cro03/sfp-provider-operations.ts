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

export interface SfpProviderReservation {
  operationId: string;
  claimToken: string;
  provider: SfpPaidProvider;
  controlProvider: string;
  amountMicros: number;
  units: number;
  stageRunId: string;
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
  const units = Math.max(1, Math.min(100, Number(input.units ?? 1)));
  const amountMicros = await currentSfpUnitPrice(input.provider);
  const reservedMicros = units * amountMicros;
  if (!Number.isSafeInteger(reservedMicros) || reservedMicros > aggregate.remainingMicros) {
    throw new Error("SFP_PAID_BLOCKED:AGGREGATE_BUDGET_EXCEEDED");
  }
  const controlProvider = CONTROL_KEY[input.provider];

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('sfp-paid-budget',0))`);
    const existing = rows(await tx.execute(sql`
      SELECT id,claim_token,reserved_units,state FROM provider_operations
       WHERE provider=${controlProvider} AND idempotency_key=${input.idempotencyKey} LIMIT 1
    `))[0];
    if (existing) {
      if (!['running','completed'].includes(String(existing.state))) {
        throw new Error(`SFP_PAID_BLOCKED:OPERATION_${String(existing.state).toUpperCase()}`);
      }
      return {
        operationId:String(existing.id),claimToken:String(existing.claim_token),provider:input.provider,
        controlProvider,amountMicros,units:Number(existing.reserved_units),stageRunId:input.stageRunId,
      };
    }

    // Include independent SFP reservations/settlements in the same fixed $50
    // ceiling used by the pilot authority; getAggregatePilotSpend cannot see
    // SFP rows because they are intentionally not MI-09 pilot effect links.
    const sfpSpend = rows(await tx.execute(sql`
      SELECT COALESCE(SUM(reserved_cost_micros+settled_cost_micros),0)::bigint AS micros
        FROM sfp_stage_runs WHERE state IN ('authorized','running','completed','partial')
    `))[0];
    if (Number(sfpSpend?.micros ?? 0) + aggregate.settledMicros + aggregate.reservedMicros + reservedMicros > aggregate.capMicros) {
      throw new Error("SFP_PAID_BLOCKED:AGGREGATE_BUDGET_EXCEEDED");
    }
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
      UPDATE sfp_stage_runs SET state='running',reserved_cost_micros=reserved_cost_micros+${reservedMicros},
             authorization=${JSON.stringify({ attestationId: authority.attestationId, budgetAuthorizedAt: budgetAuth.authorizedAt })}::jsonb,
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

export async function settleSfpProviderOperation(input: {
  reservation: SfpProviderReservation;
  outcome: "completed" | "no_result" | "failed" | "ambiguous";
  observation: "valid" | "invalid" | "risky" | "unknown" | "no_result" | "transport";
  businessId: number;
  emailTokenHash?: string | null;
  settledUnits?: number;
}): Promise<void> {
  const completed = input.outcome === "completed" || input.outcome === "no_result";
  const settledUnits = completed ? Math.max(0, Math.min(input.reservation.units, input.settledUnits ?? input.reservation.units)) : 0;
  const settledMicros = settledUnits * input.reservation.amountMicros;
  await db.transaction(async (tx) => {
    const attempt = rows(await tx.execute(sql`
      UPDATE provider_attempts SET outcome=${completed ? (input.outcome === "no_result" ? "no_result" : "completed") : input.outcome === "ambiguous" ? "ambiguous" : "retryable_failed"},
             retryable=${!completed},error_code=${completed ? null : input.observation},completed_at=NOW()
       WHERE operation_id=${input.reservation.operationId}::uuid AND attempt_number=1 RETURNING id
    `))[0];
    await tx.execute(sql`
      UPDATE provider_operations SET state=${completed ? "completed" : "failed"},
             billing_state=${completed ? "committed" : input.outcome === "ambiguous" ? "ambiguous" : "released"},
             completed_at=NOW(),updated_at=NOW() WHERE id=${input.reservation.operationId}::uuid
    `);
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
  });
}
