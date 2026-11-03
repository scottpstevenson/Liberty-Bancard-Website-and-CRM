import { sql } from "drizzle-orm";
import { db } from "../db";

/**
 * Local database mutations written in ONE transaction with their unique effect receipt (followup_effect_receipts):
 *  - the receipt is inserted first inside the transaction; if the mutation fails the receipt rolls back, so a retry
 *    performs the effect exactly once;
 *  - if the receipt cannot be written nothing is mutated;
 *  - when a lease is supplied, the lease row is share-locked and checked in the same transaction, so a worker that
 *    lost its lease writes nothing and a takeover cannot interleave with the commit;
 *  - an effect whose receipt already exists is a replay: the mutation is not repeated.
 * Callers use one effect key per mutation, so a partially finished unit of work leaves only the missing effects owed.
 * Task creation keeps its own durable command key and does not need this.
 */
export type LocalActionExecutor = Pick<typeof db, "insert"> & { execute: typeof db.execute };
export type LocalActionOutcome = "applied" | "replay" | "lost_lease";

export interface LocalEffectIdentity {
  effectKey: string; ownerKind: string; ownerId: string; channel: string;
  /** workflow_runs lease that must still be held at the commit boundary. */
  runLease?: { runId: number; token: string };
}

class LeaseLost extends Error {}

export async function applyLocalEffectOnce(
  identity: LocalEffectIdentity,
  mutate: (executor: LocalActionExecutor) => Promise<void>,
): Promise<LocalActionOutcome> {
  try {
    return await db.transaction(async (tx) => {
      if (identity.runLease) {
        const held = await tx.execute(sql`SELECT 1 FROM workflow_runs
          WHERE id = ${identity.runLease.runId} AND lease_token = ${identity.runLease.token} AND lease_expires_at > now() FOR SHARE`);
        if (!held.rows.length) throw new LeaseLost();
      }
      const claimed = await tx.execute(sql`INSERT INTO followup_effect_receipts (effect_key, owner_kind, owner_id, channel, state, settled_at)
        VALUES (${identity.effectKey}, ${identity.ownerKind}, ${identity.ownerId}, ${identity.channel}, 'accepted', now())
        ON CONFLICT (effect_key) DO NOTHING RETURNING effect_key`);
      if (!claimed.rows.length) return "replay" as const;
      await mutate(tx);
      return "applied" as const;
    });
  } catch (error) {
    if (error instanceof LeaseLost) return "lost_lease";
    throw error;
  }
}

/** Workflow step form: one receipt per run and step, fenced by the run's lease when one is held. */
export function applyLocalWorkflowAction(
  runId: number, step: number, leaseToken: string | undefined,
  mutate: (executor: LocalActionExecutor) => Promise<void>,
): Promise<LocalActionOutcome> {
  return applyLocalEffectOnce({
    effectKey: `wf_local:${runId}:${step}`, ownerKind: "workflow_local", ownerId: String(runId), channel: `local:${step}`,
    runLease: leaseToken ? { runId, token: leaseToken } : undefined,
  }, mutate);
}
