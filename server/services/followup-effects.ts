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
  // The binding is part of the one atomic claim: a refused row is re-claimed only by the SAME request fingerprint.
  // Fingerprints must match exactly; NULL matches only NULL. A legacy row without a fingerprint therefore cannot be
  // adopted by a fingerprinted request (it conflicts, with no provider call) and a fingerprinted row cannot be
  // reclaimed by an unbound caller. Existing receipts are never reset or rebound.
  const fingerprint = identity.requestFingerprint ?? null;
  const claimed = await pool.query(
    `INSERT INTO followup_effect_receipts AS r (effect_key, owner_kind, owner_id, channel, state, request_fingerprint)
     VALUES ($1, $2, $3, $4, 'started', $5)
     ON CONFLICT (effect_key) DO UPDATE SET state = 'started', detail = NULL, settled_at = NULL, created_at = now(),
       attempt_count = r.attempt_count + 1
       WHERE r.state = 'refused' AND r.request_fingerprint IS NOT DISTINCT FROM EXCLUDED.request_fingerprint
         AND r.owner_kind = EXCLUDED.owner_kind AND r.owner_id = EXCLUDED.owner_id AND r.channel = EXCLUDED.channel
     RETURNING state`,
    [identity.effectKey, identity.ownerKind, identity.ownerId, identity.channel, fingerprint]);
  if (!claimed.rows[0]) {
    const existing = (await pool.query(
      `SELECT state, detail, request_fingerprint, owner_kind, owner_id, channel FROM followup_effect_receipts WHERE effect_key = $1`, [identity.effectKey])).rows[0];
    const sameBinding = !!existing && (existing.request_fingerprint ?? null) === fingerprint
      && existing.owner_kind === identity.ownerKind && existing.owner_id === identity.ownerId && existing.channel === identity.channel;
    // Only a request carrying a fingerprint can be told it is a different request; unbound callers keep replay semantics.
    if (existing && !sameBinding && (identity.requestFingerprint || existing.request_fingerprint)) throw new EffectBindingConflictError(identity.effectKey);
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
