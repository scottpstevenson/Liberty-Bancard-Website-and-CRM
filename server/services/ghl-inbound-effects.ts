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

export interface InboundCanonicalEventInput {
  contactId: number;
  dealId?: number | null;
  /** The provider payload that names this message (used only for its canonical identity). */
  payload: unknown;
  channel: "email" | "sms";
  provider?: "ghl";
  subject?: string | null;
  body?: string | null;
  status?: "received" | "replied" | "bounced" | "failed";
  ghlMessageId?: string | null;
  automationStopped?: boolean;
  automationStopReason?: string | null;
  metadata?: Record<string, unknown>;
  /** Distinguishes effects of one message; the default is the generic inbound message event. */
  effect?: string;
}

/**
 * The ONE canonical inbound-message event write shared by every delivery alias of a provider message (generic webhook,
 * specialized message-received route, bounce). The strict writer runs inside the effect-receipt transaction under the
 * same effect key the generic route uses, so a generic+specialized pair, a re-sent webhook, or a crash between the
 * event and the receipt yields exactly one canonical event. Failures propagate (the webhook is retryable); an
 * unavailable database is never reported as "no reply".
 */
export async function recordCanonicalInboundMessageEventOnce(input: InboundCanonicalEventInput): Promise<"applied" | "replay"> {
  const identity = canonicalInboundMessageIdentity(input.payload);
  const effect = input.effect ?? "communication_event";
  const { applyLocalEffectOnce } = await import("./workflow-local-actions");
  const { recordInboundEventInTx } = await import("./communication-events");
  const outcome = await applyLocalEffectOnce({
    effectKey: `ghl_inbound:${input.contactId}:${identity.key}:${effect}`,
    ownerKind: "ghl_inbound_message", ownerId: `${input.contactId}:${identity.key}`, channel: effect,
  }, async (tx) => {
    await recordInboundEventInTx(tx, {
      contactId: input.contactId,
      dealId: input.dealId ?? null,
      channel: input.channel,
      provider: input.provider ?? "ghl",
      subject: input.subject ?? null,
      body: input.body ?? null,
      status: input.status ?? "received",
      ghlMessageId: input.ghlMessageId ?? null,
      automationStopped: input.automationStopped,
      automationStopReason: input.automationStopReason,
      metadata: input.metadata,
    });
  });
  return outcome === "replay" ? "replay" : "applied";
}
