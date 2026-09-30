/**
 * Shared historical accounting ledger used by the legacy ladder-wide paid
 * spend authority. SFP execution no longer uses this ledger for a financial
 * reservation gate; its operation receipts remain included in accounting reads.
 *
 * Two independent paid-spend paths exist in this codebase and, before this
 * module, each had its own accounting pool and its own lock scope:
 *  - SFP (south-florida-prospecting): sfp_stage_runs / sfp_classification_runs /
 *    sfp_classification_evidence records retained for historical accounting.
 *  - MI-09/CRO-03C: cro03c_stage_operations, serialized only by a per-command
 *    row lock (`FOR UPDATE OF c` in reserveCro03cProviderOperation /
 *    reserveCro03cStageOperation, live-execution.ts) — never global.
 *
 * Each path's own gate correctly stayed under $50 *within its own pool*, but
 * neither pool's committed sum ever included the other's spend, and neither
 * lock excluded the other path's concurrent reservation. Two concurrent
 * reservations — one SFP, one MI-09 — could each read a summary that showed
 * headroom and both commit, letting combined real spend exceed $50.
 *
 * The legacy shared authority serializes its own read/decide operation. SFP
 * retains the lock around receipt/settlement transitions for safe accounting,
 * but does not use financial headroom to gate provider execution.
 */
import { sql } from "drizzle-orm";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

/** Single lock key shared by every paid-spend path in the ladder. Do not
 * introduce a second key for a new path — reuse this one, or the same
 * cross-path race reappears. */
export const LADDER_BUDGET_LOCK_KEY = "ladder-aggregate-paid-budget:v2";

export interface SqlExecutor {
  execute: (query: any) => Promise<any>;
}

export interface LadderBudgetLedger {
  settledMicros: number;
  reservedMicros: number;
  failedOrCancelledMicros: number;
  operationCount: number;
}

/**
 * Canonical operation-level ledger totals for SFP/pre-cohort and CRO-03C.
 * SFP run rows are the durable amount ledger: stage-run settled/reserved
 * amounts are counted even after their parent run becomes terminal. The
 * classification evidence amount is counted instead of the classification
 * run's settled aggregate (the latter is a duplicate summary of that same
 * evidence). CRO-03C receipts remain attached to their operation rows, so
 * terminal outcomes retain their actual settled amount regardless of run
 * state; unreconciled ambiguous operations retain their full reservation.
 *
 * Must be called only after the caller has already
 * acquired LADDER_BUDGET_LOCK_KEY on the SAME connection/transaction, or the
 * read is not serialized against the other path.
 */
export async function computeLadderBudgetLedger(executor: SqlExecutor): Promise<LadderBudgetLedger> {
  const sfp = rows(await executor.execute(sql`
    SELECT
      COALESCE((SELECT SUM(reserved_cost_micros) FROM sfp_stage_runs), 0) +
      COALESCE((SELECT SUM(reserved_cost_micros) FROM sfp_classification_runs), 0) AS reserved,
      COALESCE((SELECT SUM(settled_cost_micros) FROM sfp_stage_runs), 0) +
      COALESCE((SELECT SUM(cost_micros) FROM sfp_classification_evidence), 0) AS settled,
      COALESCE((SELECT SUM(reserved_cost_micros + settled_cost_micros) FROM sfp_stage_runs WHERE state IN ('failed','cancelled')), 0) +
      COALESCE((SELECT SUM(reserved_cost_micros + settled_cost_micros) FROM sfp_classification_runs WHERE state IN ('failed','cancelled')), 0) AS failed_or_cancelled,
      (SELECT COUNT(*) FROM provider_operations
        WHERE operation_type IN ('sfp_enrichment','sfp_precohort_classification')) AS operation_count
  `))[0];
  const cro03c = rows(await executor.execute(sql`
    SELECT
      COALESCE(SUM(CASE
        WHEN terminal_disposition = 'released' THEN 0
        WHEN state IN ('reserved','dispatched','failed','cancelled')
          OR billing_certainty IN ('ambiguous','unknown')
          THEN GREATEST(max_reserved_amount_micros, settled_amount_micros)
        ELSE settled_amount_micros
      END), 0) AS committed,
      COALESCE(SUM(CASE
        WHEN terminal_disposition = 'released' THEN 0
        WHEN state IN ('reserved','dispatched','failed','cancelled')
          OR billing_certainty IN ('ambiguous','unknown')
          THEN GREATEST(max_reserved_amount_micros, settled_amount_micros)
        ELSE 0
      END), 0) AS reserved,
      COALESCE(SUM(CASE
        WHEN state IN ('failed','cancelled') AND terminal_disposition = 'released' THEN settled_amount_micros
        WHEN state IN ('failed','cancelled') THEN GREATEST(max_reserved_amount_micros, settled_amount_micros)
        ELSE 0
      END), 0) AS failed_or_cancelled,
      COUNT(*) AS operation_count
    FROM cro03c_stage_operations
  `))[0];
  const sfpSettled = Number(sfp?.settled ?? 0);
  const sfpReserved = Number(sfp?.reserved ?? 0);
  const croCommitted = Number(cro03c?.committed ?? 0);
  const croReserved = Number(cro03c?.reserved ?? 0);
  return {
    settledMicros: sfpSettled + Math.max(0, croCommitted - croReserved),
    reservedMicros: sfpReserved + croReserved,
    failedOrCancelledMicros: Number(sfp?.failed_or_cancelled ?? 0) + Number(cro03c?.failed_or_cancelled ?? 0),
    operationCount: Number(sfp?.operation_count ?? 0) + Number(cro03c?.operation_count ?? 0),
  };
}

/** Combined committed micros (settled + reserved), including ambiguous holds. */
export async function computeLadderCommittedMicros(executor: SqlExecutor): Promise<number> {
  const ledger = await computeLadderBudgetLedger(executor);
  return ledger.settledMicros + ledger.reservedMicros;
}

/** Acquire the same serialization boundary before changing any ledger amount. */
export async function acquireLadderBudgetLock(executor: SqlExecutor): Promise<void> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${LADDER_BUDGET_LOCK_KEY}, 0))`);
}
