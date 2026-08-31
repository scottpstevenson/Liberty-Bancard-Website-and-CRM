/**
 * A process-local, async-safe deny fence for CRO-08A continuous_occurrence
 * commands. This is intentionally a SEPARATE fence from
 * withCro03cInitialBatchEffectFence: that fence is hard-typed to
 * commandType==="initial_batch" (zero provider spend, internal_source only)
 * and denies ALL provider I/O by design. continuous_occurrence commands are
 * expected to reserve and settle real provider spend (Serper/Outscraper/
 * Apollo/ZeroBounce/etc.), so they must not be routed through that fence.
 *
 * This fence denies exactly the same forbidden canonical-effect boundaries
 * (campaign/CR-04/CR-06/GHL-mutation/messaging) while allowing legitimate
 * provider reservation/settlement calls to pass through untouched. Provider
 * I/O itself continues to go through the unchanged, type-agnostic
 * assertCro03cCommandAuthorityBeforeIo / reserveCro03cProviderOperation /
 * settleCro03cProviderOperation pathway in live-execution.ts.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { hashCro03Evidence } from "./source-staging";
import {
  CRO03C_FORBIDDEN_EFFECTS, type Cro03cForbiddenEffect,
  currentCro03cEffectFence, denyCro03cForbiddenEffect,
} from "./cro03c-effect-fence";

export interface Cro08aEffectFenceContext {
  commandId: string;
  runId: string;
  correlationId: string;
  scheduleOccurrenceId: string;
  commandType: "continuous_occurrence";
}

const storage = new AsyncLocalStorage<Cro08aEffectFenceContext>();

export function currentCro08aEffectFence(): Cro08aEffectFenceContext | undefined {
  return storage.getStore();
}

export async function withCro08aContinuousOccurrenceEffectFence<T>(
  context: Cro08aEffectFenceContext,
  work: () => Promise<T>,
): Promise<T> {
  return storage.run(Object.freeze({ ...context }), work);
}

const rows = (result: any): any[] => result?.rows ?? result ?? [];

/** Hard deny hook for canonical effect boundaries reached from a
 * continuous_occurrence command. Presence of this fence context means every
 * one of CRO03C_FORBIDDEN_EFFECTS is denied; provider I/O is never checked
 * against this list and is unaffected. */
export async function denyCro08aForbiddenEffect(effectKind: Cro03cForbiddenEffect): Promise<void> {
  const context = storage.getStore();
  if (!context) return;
  const disposition = "failed_run";
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO cro03c_forbidden_effects
        (command_id,run_id,effect_kind,correlation_id,attempted_count,effective_count,disposition,evidence_hash)
      VALUES (${context.commandId}::uuid,${context.runId}::uuid,${effectKind},${context.correlationId},
              1,0,${disposition},
              ${hashCro03Evidence({ ...context, effectKind, attemptedCount: 1, effectiveCount: 0, disposition })})
    `);
    await tx.execute(sql`
      UPDATE cro03c_runs SET state='failed',stop_reason='cro08a_forbidden_effect_attempt',completed_at=NOW(),
             claim_token=NULL,lease_expires_at=NULL
       WHERE id=${context.runId}::uuid
         AND state IN ('queued','claimed','running')
    `);
    await tx.execute(sql`
      UPDATE cro03c_commands SET state='failed',completed_at=NOW(),updated_at=NOW()
       WHERE id=${context.commandId}::uuid AND state IN ('queued','running')
    `);
    await tx.execute(sql`
      UPDATE cro08a_schedule_occurrences SET state='failed',updated_at=NOW()
       WHERE id=${context.scheduleOccurrenceId}::uuid AND state NOT IN ('reconciled','cancelled')
    `);
  });
  throw new Error(`CRO08A_FORBIDDEN_EFFECT_DENIED:${effectKind}`);
}

/**
 * Unified deny hook for every canonical effect sink (GHL mutation, SMTP
 * email, sequence enrollment, campaign creation). Exactly one of the two
 * process-local fences can be active for a given async context, so this
 * simply checks the CRO-08A continuous_occurrence fence first (the newer,
 * narrower one) and falls back to the CRO-03C initial_batch fence
 * (unchanged); if neither is installed, this is a no-op, exactly matching
 * the prior per-fence behavior. Canonical effect sinks should call this
 * function instead of importing either fence's deny hook directly, so a
 * continuous_occurrence command dispatched through the live worker is
 * actually denied rather than silently bypassing both fences.
 */
export async function denyCro03OrCro08aForbiddenEffect(effectKind: Cro03cForbiddenEffect): Promise<void> {
  if (storage.getStore()) {
    await denyCro08aForbiddenEffect(effectKind);
    return;
  }
  if (currentCro03cEffectFence()) {
    await denyCro03cForbiddenEffect(effectKind);
  }
}

export { CRO03C_FORBIDDEN_EFFECTS };
export type { Cro03cForbiddenEffect };
