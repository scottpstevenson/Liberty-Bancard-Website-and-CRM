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

export interface EffectIdentity { effectKey: string; ownerKind: string; ownerId: string; channel: string }
export interface EffectOutcome { state: EffectState; replay: boolean; detail?: string }
/** `detail` on success is stored on the accepted receipt (e.g. a provider resource id) and returned on replay. */
export interface EffectSendResult { success: boolean; error?: string; detail?: string }

export async function runFollowupEffect(
  identity: EffectIdentity, send: () => Promise<EffectSendResult>,
): Promise<EffectOutcome> {
  const claimed = await pool.query(
    `INSERT INTO followup_effect_receipts AS r (effect_key, owner_kind, owner_id, channel, state)
     VALUES ($1, $2, $3, $4, 'started')
     ON CONFLICT (effect_key) DO UPDATE SET state = 'started', detail = NULL, settled_at = NULL, created_at = now()
       WHERE r.state = 'refused'
     RETURNING state`,
    [identity.effectKey, identity.ownerKind, identity.ownerId, identity.channel]);
  if (!claimed.rows[0]) {
    const existing = (await pool.query(`SELECT state, detail FROM followup_effect_receipts WHERE effect_key = $1`, [identity.effectKey])).rows[0];
    if (existing?.state === "accepted") return { state: "accepted", replay: true, detail: existing.detail ?? undefined };
    return { state: "unknown", replay: true, detail: "prior_dispatch_outcome_unknown" };
  }
  const settle = (state: EffectState, detail?: string) => pool.query(
    `UPDATE followup_effect_receipts SET state = $2, detail = $3, settled_at = now() WHERE effect_key = $1 AND state = 'started'`,
    [identity.effectKey, state, detail ? detail.slice(0, 300) : null],
  ).catch(err => console.error("[FollowupEffects] could not settle receipt:", err instanceof Error ? err.message : err));
  try {
    const result = await send();
    if (result.success) { await settle("accepted", result.detail); return { state: "accepted", replay: false, detail: result.detail }; }
    // A reported ambiguous failure may have been processed: stays 'started' semantics (unknown), never re-sent.
    if (isAmbiguousDispatchMessage(result.error)) { await settle("unknown", result.error); return { state: "unknown", replay: false, detail: result.error }; }
    await settle("refused", result.error);
    return { state: "refused", replay: false, detail: result.error };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isAmbiguousDispatchMessage(message)) { await settle("unknown", message); return { state: "unknown", replay: false, detail: message }; }
    await settle("refused", message);
    return { state: "refused", replay: false, detail: message };
  }
}

export async function hasAcceptedEffect(ownerKind: string, ownerId: string, channelPrefix?: string): Promise<boolean> {
  const row = (await pool.query(
    `SELECT 1 FROM followup_effect_receipts WHERE owner_kind = $1 AND owner_id = $2 AND state = 'accepted'
       AND ($3::text IS NULL OR channel LIKE $3 || '%') LIMIT 1`,
    [ownerKind, ownerId, channelPrefix ?? null])).rows[0];
  return !!row;
}
