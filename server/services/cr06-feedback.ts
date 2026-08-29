import { pool } from "../db";
import { applyConsentCommand, recordReachabilityObservation } from "./consent-authority";
import { terminalizeSequenceEnrollment } from "./sequence-terminalization";

export const CR06_SYNTHETIC_FEEDBACK_SOURCE = "cr06_authenticated_synthetic";
export type Cr06FeedbackType =
  | "delivered"
  | "hard_bounce"
  | "soft_bounce"
  | "complaint"
  | "unsubscribe"
  | "provider_rejected"
  | "provider_failed"
  | "replied";

export interface Cr06FeedbackPayload {
  provider?: string;
  providerMessageId?: string;
  occurredAt?: string;
  reasonCode?: string;
  diagnosticCode?: string;
  smtpStatus?: number;
}

const PAYLOAD_KEYS = new Set([
  "provider", "providerMessageId", "occurredAt", "reasonCode", "diagnosticCode", "smtpStatus",
]);

function sanitizePayload(payload: Cr06FeedbackPayload | undefined): Cr06FeedbackPayload {
  const value = payload ?? {};
  for (const key of Object.keys(value)) {
    if (!PAYLOAD_KEYS.has(key)) throw new Error("CR06_FEEDBACK_PAYLOAD_FIELD_FORBIDDEN");
  }
  const boundedString = (key: keyof Cr06FeedbackPayload, max: number): string | undefined => {
    const candidate = value[key];
    if (candidate === undefined) return undefined;
    if (typeof candidate !== "string" || !candidate.trim() || candidate.length > max) {
      throw new Error("CR06_FEEDBACK_PAYLOAD_INVALID");
    }
    return candidate;
  };
  if (value.smtpStatus !== undefined && (
    !Number.isInteger(value.smtpStatus) || value.smtpStatus < 100 || value.smtpStatus > 599
  )) throw new Error("CR06_FEEDBACK_PAYLOAD_INVALID");
  const occurredAt = boundedString("occurredAt", 50);
  if (occurredAt && Number.isNaN(Date.parse(occurredAt))) throw new Error("CR06_FEEDBACK_PAYLOAD_INVALID");
  return {
    ...(boundedString("provider", 80) ? { provider: boundedString("provider", 80) } : {}),
    ...(boundedString("providerMessageId", 250) ? { providerMessageId: boundedString("providerMessageId", 250) } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    ...(boundedString("reasonCode", 120) ? { reasonCode: boundedString("reasonCode", 120) } : {}),
    ...(boundedString("diagnosticCode", 120) ? { diagnosticCode: boundedString("diagnosticCode", 120) } : {}),
    ...(value.smtpStatus !== undefined ? { smtpStatus: value.smtpStatus } : {}),
  };
}

function canonicalPayloadJson(payload: Cr06FeedbackPayload): string {
  return JSON.stringify(Object.fromEntries(
    Object.entries(payload).sort(([left], [right]) => left.localeCompare(right)),
  ));
}

/**
 * Exact revision CAS helper for a later gate command. It deliberately does not
 * release an intent or invoke a transport.
 */
export async function compareAndSetCr06GateRevision(input: {
  gateId: string;
  expectedRevision: number;
  state: "open" | "closed";
  actorId: string;
}): Promise<{ id: string; revision: number; state: string }> {
  const result = await pool.query(
    `UPDATE cr06_campaign_gates
     SET state=$3, revision=revision+1,
         opened_at=CASE WHEN $3='open' THEN NOW() ELSE opened_at END,
         closed_at=CASE WHEN $3='closed' THEN NOW() ELSE NULL END,
         actor_id=$4
     WHERE id=$1 AND revision=$2 AND state<>$3
     RETURNING id,revision,state`,
    [input.gateId, input.expectedRevision, input.state, input.actorId],
  );
  if (!result.rows[0]) throw new Error("CR06_GATE_REVISION_COMPARE_AND_SET_FAILED");
  return result.rows[0];
}

/**
 * Authenticated synthetic feedback ingress. The immutable receipt is persisted
 * before any projection side effect. An unacknowledged receipt is deliberately
 * retried, while the canonical authorities and attribution key make every
 * effect replay-safe.
 */
export async function ingestCr06SyntheticFeedback(input: {
  deliveryIntentId: string;
  eventKey: string;
  eventType: Cr06FeedbackType;
  actorId: string;
  payload?: Cr06FeedbackPayload;
}) {
  const eventKey = input.eventKey.trim();
  if (!eventKey) throw new Error("CR06_FEEDBACK_EVENT_KEY_REQUIRED");
  const payload = sanitizePayload(input.payload);

  // Receipt first: INSERT ... SELECT derives run/contact from the exact intent,
  // and the occurrence fence wins before consent or reachability is touched.
  const receiptClient = await pool.connect();
  let receipt: any;
  let inserted = false;
  try {
    await receiptClient.query("BEGIN");
    const created = await receiptClient.query(
      `INSERT INTO cr06_feedback_receipts
       (delivery_intent_id,preparation_run_id,contact_id,source,event_key,event_type,payload,received_by)
       SELECT di.id,di.preparation_run_id,di.recipient_contact_id,$2,$3,$4,$5::jsonb,$6
         FROM cr06_delivery_intents di WHERE di.id=$1
       ON CONFLICT (source,event_key) DO NOTHING
       RETURNING *`,
      [input.deliveryIntentId, CR06_SYNTHETIC_FEEDBACK_SOURCE, eventKey, input.eventType,
        JSON.stringify(payload), input.actorId],
    );
    inserted = created.rows.length === 1;
    const selected = inserted ? created : await receiptClient.query(
      `SELECT * FROM cr06_feedback_receipts WHERE source=$1 AND event_key=$2 FOR UPDATE`,
      [CR06_SYNTHETIC_FEEDBACK_SOURCE, eventKey],
    );
    receipt = selected.rows[0];
    if (!receipt) throw new Error("CR06_DELIVERY_INTENT_NOT_FOUND");
    if (
      receipt.delivery_intent_id !== input.deliveryIntentId ||
      receipt.event_type !== input.eventType ||
      canonicalPayloadJson(receipt.payload as Cr06FeedbackPayload) !== canonicalPayloadJson(payload)
    ) {
      throw new Error("CR06_FEEDBACK_EVENT_KEY_CONFLICT");
    }
    await receiptClient.query("COMMIT");
  } catch (error) {
    await receiptClient.query("ROLLBACK");
    throw error;
  } finally {
    receiptClient.release();
  }

  if (receipt.processed_at) {
    return { receiptId: receipt.id, replayed: true, dispatchAvailable: false };
  }

  const contactId = Number(receipt.contact_id);
  const occurrenceKey = String(receipt.id);
  const details = {
    deliveryIntentId: input.deliveryIntentId,
    feedbackReceiptId: occurrenceKey,
    eventType: input.eventType,
    synthetic: true,
  };

  if (input.eventType === "hard_bounce") {
    await recordReachabilityObservation({
      subject: { type: "contact", id: contactId },
      channel: "email",
      state: "bounced",
      eventNamespace: CR06_SYNTHETIC_FEEDBACK_SOURCE,
      eventKey: `${occurrenceKey}:reachability`,
      source: CR06_SYNTHETIC_FEEDBACK_SOURCE,
      details,
    });
  } else if (input.eventType === "complaint" || input.eventType === "unsubscribe") {
    await applyConsentCommand({
      subject: { type: "contact", id: contactId },
      kind: input.eventType === "unsubscribe" ? "opt_out" : "global_dnc",
      channel: input.eventType === "unsubscribe" ? "email" : undefined,
      eventNamespace: CR06_SYNTHETIC_FEEDBACK_SOURCE,
      eventKey: `${occurrenceKey}:consent`,
      source: CR06_SYNTHETIC_FEEDBACK_SOURCE,
      actorId: input.actorId,
      evidence: { ...details, reason: input.eventType },
    });
  }

  const stopsSequence = ["replied", "hard_bounce", "complaint", "unsubscribe"].includes(input.eventType);
  if (stopsSequence) {
    const enrollment = await pool.query(
      `SELECT se.id,se.contact_id,se.created_at,se.current_step
         FROM cr06_delivery_intents di
         JOIN cr06_prepared_enrollments pe ON pe.id=di.prepared_enrollment_id
         JOIN sequence_enrollments se ON se.id=pe.sequence_enrollment_id
        WHERE di.id=$1 AND se.contact_id=di.recipient_contact_id`,
      [input.deliveryIntentId],
    );
    if (enrollment.rows[0]) {
      const row = enrollment.rows[0];
      const terminalized = await terminalizeSequenceEnrollment({
        enrollmentId: Number(row.id),
        contactId,
        enrolledAt: new Date(row.created_at),
        expectedCurrentStep: Number(row.current_step),
        terminalCurrentStep: Number(row.current_step),
        noResponseReason: "sequence_exhausted_no_response",
        forcedReplyEventKey: input.eventType === "replied" ? occurrenceKey : undefined,
        terminalReason: `cr06_feedback_${input.eventType}`,
      });
      if (terminalized.outcome === "UNAVAILABLE") throw new Error("CR06_SEQUENCE_TERMINALIZATION_UNAVAILABLE");
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT processed_at FROM cr06_feedback_receipts WHERE id=$1 FOR UPDATE`,
      [receipt.id],
    );
    if (locked.rows[0]?.processed_at) {
      await client.query("COMMIT");
      return { receiptId: receipt.id, replayed: true, dispatchAvailable: false };
    }
    await client.query(
      `UPDATE cr06_delivery_intents
          SET state='terminal',terminal_reason=$2
        WHERE id=$1 AND state IN ('held','released','attempting')`,
      [input.deliveryIntentId, `feedback_${input.eventType}`],
    );
    await client.query(
      `INSERT INTO cr06_attribution_events
       (preparation_run_id,delivery_intent_id,contact_id,event_type,outcome,provider,provider_event_key,payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (provider,provider_event_key) DO NOTHING`,
      [receipt.preparation_run_id, input.deliveryIntentId, contactId, input.eventType,
        input.eventType === "delivered" || input.eventType === "replied" ? "success" : "terminal",
        CR06_SYNTHETIC_FEEDBACK_SOURCE, eventKey,
        JSON.stringify({ ...payload, feedbackReceiptId: receipt.id, synthetic: true })],
    );
    await client.query(`UPDATE cr06_feedback_receipts SET processed_at=NOW() WHERE id=$1`, [receipt.id]);
    await client.query("COMMIT");
    return { receiptId: receipt.id, replayed: !inserted, dispatchAvailable: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}