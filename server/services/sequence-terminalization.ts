import { pool } from "../db";
import { communicationContactLockKey } from "./communication-contact-lock";

export type SequenceTerminalizationResult =
  | { outcome: "COMPLETED_REPLY" }
  | { outcome: "COMPLETED_NO_RESPONSE" }
  | { outcome: "STALE" }
  | { outcome: "UNAVAILABLE" };

export async function terminalizeSequenceEnrollment(params: {
  enrollmentId: number;
  contactId: number;
  enrolledAt: Date;
  expectedCurrentStep: number;
  terminalCurrentStep: number;
  noResponseReason: "sequence_exhausted_no_response" | "sms_skipped_no_response";
}): Promise<SequenceTerminalizationResult> {
  const client = await pool.connect().catch(() => null);
  if (!client) return { outcome: "UNAVAILABLE" };
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
      communicationContactLockKey(params.contactId).toString(),
    ]);
    const inbound = await client.query(`
      SELECT 1 FROM communication_events
      WHERE contact_id = $1 AND direction = 'inbound' AND created_at > $2
      LIMIT 1
    `, [params.contactId, params.enrolledAt]);
    const isReply = inbound.rows.length > 0;
    const category = isReply ? "reply" : "no_response";
    const reason = isReply ? "contact_replied" : params.noResponseReason;
    const changed = await client.query(`
      UPDATE sequence_enrollments
      SET status = 'completed',
          completed_at = NOW(),
          current_step = $1,
          metadata = COALESCE(metadata, '{}'::jsonb)
            || jsonb_build_object('terminal', jsonb_build_object('category', $2::text, 'reason', $3::text)),
          updated_at = NOW()
      WHERE id = $4 AND status = 'active' AND current_step = $5 AND contact_id = $6
      RETURNING id
    `, [
      params.terminalCurrentStep,
      category,
      reason,
      params.enrollmentId,
      params.expectedCurrentStep,
      params.contactId,
    ]);
    await client.query("COMMIT");
    if (!changed.rows.length) return { outcome: "STALE" };
    return { outcome: isReply ? "COMPLETED_REPLY" : "COMPLETED_NO_RESPONSE" };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* connection may be broken */ }
    console.warn("[SequenceTerminalization] unavailable (failed closed):", err);
    return { outcome: "UNAVAILABLE" };
  } finally {
    client.release();
  }
}