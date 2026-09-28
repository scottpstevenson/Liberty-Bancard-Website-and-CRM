/**
 * Single serialized authority for the $50 ladder-wide aggregate paid-provider
 * budget (Liberty Bancard enrichment Gate 2 hardening).
 *
 * Two independent paid-spend paths exist in this codebase and, before this
 * module, each had its own accounting pool and its own lock scope:
 *  - SFP (south-florida-prospecting): sfp_stage_runs / sfp_classification_runs /
 *    sfp_classification_evidence, serialized by a single global advisory
 *    lock (`reserveSfpAggregateBudgetInTransaction` in sfp-provider-operations.ts).
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
 * Fix: both paths now acquire the SAME advisory-lock key before reserving,
 * and both check the SAME combined sum (SFP tables + cro03c_stage_operations
 * together) against the SAME $50 constant, inside the transaction that
 * performs their own reservation write. This does not change the cap value,
 * does not reset any counter, and does not merge the two tables — it only
 * makes them share one serialized read-then-decide boundary.
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

/**
 * Combined committed micros (settled + in-flight reserved) across BOTH
 * accounting pools. Must be called only after the caller has already
 * acquired LADDER_BUDGET_LOCK_KEY on the SAME connection/transaction, or the
 * read is not serialized against the other path.
 */
export async function computeLadderCommittedMicros(executor: SqlExecutor): Promise<number> {
  const sfp = rows(await executor.execute(sql`
    SELECT
      (SELECT COALESCE(SUM(reserved_cost_micros + settled_cost_micros), 0)
         FROM sfp_stage_runs WHERE state IN ('authorized', 'running', 'completed', 'partial')) +
      (SELECT COALESCE(SUM(reserved_cost_micros), 0)
         FROM sfp_classification_runs WHERE state IN ('authorized', 'running')) +
      (SELECT COALESCE(SUM(cost_micros), 0) FROM sfp_classification_evidence) AS micros
  `))[0];
  const cro03c = rows(await executor.execute(sql`
    SELECT COALESCE(SUM(
      CASE WHEN state IN ('reserved', 'dispatched') THEN max_reserved_amount_micros
           ELSE settled_amount_micros END
    ), 0) AS micros
    FROM cro03c_stage_operations
    WHERE state NOT IN ('failed', 'cancelled')
  `))[0];
  return Number(sfp?.micros ?? 0) + Number(cro03c?.micros ?? 0);
}

/**
 * Acquires the shared lock, computes the combined committed total, and
 * throws unless `reservationMicros` still fits under `capMicros`. The caller
 * is responsible for performing its own actual reservation write in the same
 * transaction immediately afterward — this function makes no writes itself,
 * so it never touches either pool's counters or the cap value.
 */
export async function assertLadderBudgetHeadroom(
  executor: SqlExecutor,
  input: { reservationMicros: number; capMicros: number },
): Promise<{ committedMicros: number }> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${LADDER_BUDGET_LOCK_KEY}, 0))`);
  const committedMicros = await computeLadderCommittedMicros(executor);
  if (committedMicros + input.reservationMicros > input.capMicros) {
    throw new Error(
      `LADDER_AGGREGATE_BUDGET_EXCEEDED:committed=${committedMicros} reservation=${input.reservationMicros} cap=${input.capMicros}`,
    );
  }
  return { committedMicros };
}
