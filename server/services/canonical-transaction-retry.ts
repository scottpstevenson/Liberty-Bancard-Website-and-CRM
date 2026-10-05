import {sql} from "drizzle-orm";
import {withTransactionPhase} from "../lib/transaction-observability";

export const CANONICAL_TRANSACTION_PHASES = [
  "preparation_owner_claim","preparation_commit","preparation_cursor_claim","preparation_retirement",
  "link_owner_claim","link_bootstrap","link_cursor_claim","link_commit",
  "import_owner_claim","import_cursor_claim","import_finalize","import_failure",
  "import_materialize","preparation_checkpoint","preparation_release",
] as const;
export type CanonicalTransactionPhase = typeof CANONICAL_TRANSACTION_PHASES[number];

/** Retry only a PostgreSQL-aborted transaction, never an uncertain connection
 * failure or an authority denial. Callers must start a new transaction and
 * rerun their native/runtime/lease guards inside every attempt. */
export async function runCanonicalTransaction<T>(
  phase: CanonicalTransactionPhase,
  transaction: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTransactionPhase(phase, transaction);
    } catch (error: unknown) {
      if (error && typeof error === "object" && Object.isExtensible(error)) {
        Object.assign(error, { canonicalTransactionPhase: phase });
      }
      let current: any = error;
      let deadlock = false;
      for (let depth = 0; current && depth < 4; depth++, current = current.cause) {
        if (current.code === "40P01") deadlock = true;
      }
      if (!deadlock || attempt >= 3) throw error;
      console.warn("[CanonicalTransaction] retry", JSON.stringify({
        phase, sqlState: "40P01", attempt,
      }));
      await new Promise(resolve => setTimeout(resolve, attempt * 25));
    }
  }
}

/** Bound authority-pinned waits and idle application work, not just the outer
 * loop's start deadline. PostgreSQL aborts these transactions; callers do NOT
 * retry ambiguous connection/commit failures. Keep native statement checks. */
const boundedTransactions = new WeakSet<object>();
export async function boundCanonicalWriteTransaction(tx:any) {
  if (boundedTransactions.has(tx)) return;
  await tx.execute(sql`SELECT set_config('lock_timeout','1000ms',true),
    set_config('idle_in_transaction_session_timeout','5000ms',true),
    set_config('statement_timeout','10000ms',true)`);
  boundedTransactions.add(tx);
}
