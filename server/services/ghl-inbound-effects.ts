import { ghlPayloadFingerprint } from "./ghl-webhook-receipts";

/**
 * Canonical identity of one inbound provider message, for the CRM-side local effects of a delivery.
 *
 * The generic (/api/webhooks/ghl) and specialized (/api/webhooks/ghl/message-received) deliveries of one message name
 * it with the same provider message id (the specialized route claims `ghl:inbound_message:<messageId ?? eventId>`), so
 * both resolve to the same key here. A delivery with no provider id is NOT folded into a shared key: its identity is
 * the canonical fingerprint of its own payload, and the basis is reported so the gap is visible. Two genuinely
 * different messages always carry different provider ids or different payloads.
 */
export type InboundMessageIdentity = { key: string; basis: "provider_message_id" | "provider_event_id" | "payload_fingerprint" };

export function canonicalInboundMessageIdentity(payload: unknown): InboundMessageIdentity {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" || typeof value === "number") && String(value).trim() ? String(value).trim().slice(0, 200) : null;
  const messageId = text(p.messageId);
  if (messageId) return { key: `msg:${messageId}`, basis: "provider_message_id" };
  const eventId = text(p.eventId);
  // Same precedence as the specialized route's verified-event claim (messageId, then eventId).
  if (eventId) return { key: `msg:${eventId}`, basis: "provider_event_id" };
  // The generic inbound-message payload's bare id names the message (this is only used for direction=inbound messages).
  const bareId = text(p.id);
  if (bareId) return { key: `msg:${bareId}`, basis: "provider_event_id" };
  return { key: `fp:${ghlPayloadFingerprint(payload)}`, basis: "payload_fingerprint" };
}
