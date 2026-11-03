import { pool } from "../db";
import { isAmbiguousDispatchMessage } from "./ghl-dispatch-recorder";

/**
 * Durable per-channel send receipts for follow-up work (workflow steps, statement requests/reminders, application
 * reminders). The 'started' row is written BEFORE the provider call, so a retry, a resumed run or a second worker never
 * re-sends over an accepted or possibly accepted message:
 *  - accepted: delivered; a replay returns the same result without sending;
 *  - refused: definitely not delivered; a later attempt may claim it again;
 *  - unknown: the outcome could not be determined (lost response, crash while 'started'); never re-sent automatically.
 * A run/step is only "delivered" when a receipt says accepted. Nothing here defaults a missing fact to success.
 */
export type EffectState = "accepted" | "refused" | "unknown";

/** `requestFingerprint` binds the key to the reviewed request: the same key with a different request is refused before I/O. */
export interface EffectIdentity { effectKey: string; ownerKind: string; ownerId: string; channel: string; requestFingerprint?: string }
export class EffectBindingConflictError extends Error {
  constructor(public readonly effectKey: string) { super("effect_key_bound_to_different_request"); this.name = "EffectBindingConflictError"; }
}
export interface EffectOutcome { state: EffectState; replay: boolean; detail?: string }
/** `detail` on success is stored on the accepted receipt (e.g. a provider resource id) and returned on replay. */
export interface EffectSendResult { success: boolean; error?: string; detail?: string }

export async function runFollowupEffect(
  identity: EffectIdentity, send: () => Promise<EffectSendResult>,
): Promise<EffectOutcome> {
  if (identity.requestFingerprint) {
    const bound = (await pool.query(`SELECT request_fingerprint FROM followup_effect_receipts WHERE effect_key = $1`, [identity.effectKey])).rows[0];
    if (bound?.request_fingerprint && bound.request_fingerprint !== identity.requestFingerprint) throw new EffectBindingConflictError(identity.effectKey);
  }
  const claimed = await pool.query(
    `INSERT INTO followup_effect_receipts AS r (effect_key, owner_kind, owner_id, channel, state, request_fingerprint)
     VALUES ($1, $2, $3, $4, 'started', $5)
     ON CONFLICT (effect_key) DO UPDATE SET state = 'started', detail = NULL, settled_at = NULL, created_at = now(),
       attempt_count = r.attempt_count + 1, request_fingerprint = COALESCE(r.request_fingerprint, EXCLUDED.request_fingerprint)
       WHERE r.state = 'refused'
     RETURNING state`,
    [identity.effectKey, identity.ownerKind, identity.ownerId, identity.channel, identity.requestFingerprint ?? null]);
  if (!claimed.rows[0]) {
    const existing = (await pool.query(`SELECT state, detail, request_fingerprint FROM followup_effect_receipts WHERE effect_key = $1`, [identity.effectKey])).rows[0];
    if (identity.requestFingerprint && existing?.request_fingerprint && existing.request_fingerprint !== identity.requestFingerprint) throw new EffectBindingConflictError(identity.effectKey);
    if (existing?.state === "accepted") return { state: "accepted", replay: true, detail: existing.detail ?? undefined };
    return { state: "unknown", replay: true, detail: "prior_dispatch_outcome_unknown" };
  }
  // A settlement that cannot be written is never reported as the provider result: the row stays 'started', which later
  // attempts read as unknown (fenced, visible), so neither a possible delivery nor a refusal is silently lost or re-sent.
  const settle = async (state: EffectState, detail?: string): Promise<boolean> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await pool.query(
          `UPDATE followup_effect_receipts SET state = $2, detail = $3, settled_at = now() WHERE effect_key = $1 AND state = 'started'`,
          [identity.effectKey, state, detail ? detail.slice(0, 300) : null]);
        return true;
      } catch (err) {
        console.error("[FollowupEffects] could not settle receipt:", err instanceof Error ? err.message : err);
      }
    }
    return false;
  };
  const settled = async (state: EffectState, detail?: string): Promise<EffectOutcome> =>
    (await settle(state, detail)) ? { state, replay: false, detail }
      : { state: "unknown", replay: false, detail: `settlement_write_failed_after_${state}` };
  try {
    const result = await send();
    if (result.success) return settled("accepted", result.detail);
    // A reported ambiguous failure may have been processed: stays 'started' semantics (unknown), never re-sent.
    if (isAmbiguousDispatchMessage(result.error)) return settled("unknown", result.error);
    return settled("refused", result.error);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isAmbiguousDispatchMessage(message)) return settled("unknown", message);
    return settled("refused", message);
  }
}

export async function hasAcceptedEffect(ownerKind: string, ownerId: string, channelPrefix?: string): Promise<boolean> {
  const row = (await pool.query(
    `SELECT 1 FROM followup_effect_receipts WHERE owner_kind = $1 AND owner_id = $2 AND state = 'accepted'
       AND ($3::text IS NULL OR channel LIKE $3 || '%') LIMIT 1`,
    [ownerKind, ownerId, channelPrefix ?? null])).rows[0];
  return !!row;
}
