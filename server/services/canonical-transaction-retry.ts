export type CanonicalTransactionPhase =
  | "preparation_owner_claim"
  | "preparation_commit"
  | "preparation_cursor_claim"
  | "preparation_retirement";

/** Retry only a PostgreSQL-aborted transaction, never an uncertain connection
 * failure or an authority denial. Callers must start a new transaction and
 * rerun their native/runtime/lease guards inside every attempt. */
export async function runCanonicalTransaction<T>(
  phase: CanonicalTransactionPhase,
  transaction: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await transaction();
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
