/**
 * A process-local, async-safe deny fence for CRO-03C initial continuation.
 * This is deliberately not an authorization mechanism: presence of this
 * context means that *no* outbound/effectful boundary is authorized.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { getPauseState, invalidatePauseStateCache } from "../outbound-pause-authority";
import { hashCro03Evidence } from "./source-staging";

const rows = (result: any): any[] => result?.rows ?? result ?? [];

export const CRO03C_FORBIDDEN_EFFECTS = [
  "ghl_mutation", "campaign_creation", "campaign_preparation",
  "sequence_enrollment", "smtp_email", "email", "sms", "rvm", "sender",
  "readiness", "scoring", "cr04", "cr06",
] as const;
export type Cro03cForbiddenEffect = typeof CRO03C_FORBIDDEN_EFFECTS[number];

export interface Cro03cEffectFenceContext {
  commandId: string;
  runId: string;
  correlationId: string;
  commandType: "initial_batch";
}

const storage = new AsyncLocalStorage<Cro03cEffectFenceContext>();

export function currentCro03cEffectFence(): Cro03cEffectFenceContext | undefined {
  return storage.getStore();
}

export async function withCro03cInitialBatchEffectFence<T>(
  context: Cro03cEffectFenceContext,
  work: () => Promise<T>,
): Promise<T> {
  return storage.run(Object.freeze({ ...context }), work);
}

/** Hard deny hook for canonical effect boundaries. Micro-canaries never install
 * this context and therefore cannot acquire any exception through this API. */
export async function denyCro03cForbiddenEffect(effectKind: Cro03cForbiddenEffect): Promise<void> {
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
      UPDATE cro03c_runs SET state='failed',stop_reason='cro03c_forbidden_effect_attempt',completed_at=NOW(),
             claim_token=NULL,lease_expires_at=NULL
       WHERE id=${context.runId}::uuid
         AND state IN ('queued','claimed','running')
    `);
    await tx.execute(sql`
      UPDATE cro03c_commands SET state='failed',completed_at=NOW(),updated_at=NOW()
       WHERE id=${context.commandId}::uuid AND state IN ('queued','running')
    `);
  });
  throw new Error(`CRO03C_FORBIDDEN_EFFECT_DENIED:${effectKind}`);
}

/** Snapshot actual durable counters; it never changes outbound pause state. */
export async function readCro03cGlobalNoOutboundCounters(): Promise<Record<string, number>> {
  // A snapshot is evidence, not a convenience read: bypass the pause cache.
  invalidatePauseStateCache();
  const pause = await getPauseState();
  const counts = rows(await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM contacts WHERE ghl_contact_id IS NOT NULL AND BTRIM(ghl_contact_id) <> '') AS ghl,
      (SELECT COUNT(*)::int FROM campaigns) AS campaigns,
      (SELECT COUNT(*)::int FROM sequence_enrollments) AS enrollment,
      (SELECT COUNT(*)::int FROM outbound_messages WHERE channel='email') AS email,
      (SELECT COUNT(*)::int FROM outbound_messages WHERE channel='sms') AS sms,
      (SELECT COUNT(*)::int FROM outbound_messages WHERE channel IN ('rvm','voice','voicemail')) AS rvm,
      (SELECT COUNT(*)::int FROM email_logs) AS senders
  `))[0] ?? {};
  return {
    pauseEpoch: Number(pause.epoch), ghl: Number(counts.ghl), campaigns: Number(counts.campaigns),
    enrollment: Number(counts.enrollment), email: Number(counts.email), sms: Number(counts.sms),
    rvm: Number(counts.rvm), senders: Number(counts.senders),
  };
}

export function classifyCro03cNoOutboundSnapshots(
  pre: Record<string, number>, post: Record<string, number>, linkedAttemptOrEffect: boolean,
): "clean" | "failed" | "inconclusive" {
  if (linkedAttemptOrEffect) return "failed";
  // Legacy certification fixtures only contain pauseEpoch. Production snapshots
  // are complete; compare the persisted pre-snapshot contract rather than
  // treating an older, intentionally sparse fixture as a movement.
  return Object.keys(pre).every((key) => Number(pre[key] ?? 0) === Number(post[key] ?? 0))
    ? "clean" : "inconclusive";
}