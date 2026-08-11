/**
 * communication-events.ts
 *
 * Single canonical write path for all inbound and outbound communications.
 * Every email send, SMS send, RVM drop, inbound reply, form submission, and
 * call event writes a row here in addition to any existing channel-specific tables.
 *
 * This is the foundational layer for:
 *   - Unified contact timelines
 *   - AI memory and decision logging (Wave F)
 *   - Full-funnel attribution (Wave G)
 *   - Cross-channel suppression and arbitration signals
 */

import { db } from "../db";
import { communicationEvents, type InsertCommunicationEvent } from "@shared/schema";
import { storage } from "../storage";

export type { InsertCommunicationEvent };

/**
 * Record a single communication event. This is the ONLY function that should
 * write to the communication_events table — do not insert directly.
 *
 * Returns the created event's id, or null if the write fails (non-blocking).
 */
export async function recordCommunicationEvent(
  payload: InsertCommunicationEvent
): Promise<number | null> {
  try {
    const [row] = await db
      .insert(communicationEvents)
      .values({
        ...payload,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: communicationEvents.id });
    return row?.id ?? null;
  } catch (err: any) {
    // Non-blocking — communication event logging must never block the actual send
    console.warn(
      `[CommEvents] Failed to record communication event (direction=${payload.direction} channel=${payload.channel}):`,
      err?.message
    );
    return null;
  }
}

/**
 * Fetch recent communication events for a contact, newest first.
 * Used for the unified contact timeline.
 */
export async function getContactCommunicationEvents(
  contactId: number,
  limit = 50
): Promise<Array<typeof communicationEvents.$inferSelect>> {
  const { eq, desc } = await import("drizzle-orm");
  return db
    .select()
    .from(communicationEvents)
    .where(eq(communicationEvents.contactId, contactId))
    .orderBy(desc(communicationEvents.createdAt))
    .limit(limit);
}

/**
 * Convenience helper for recording outbound automation sends (email/SMS/RVM).
 * Called from sequence-worker and campaign-engine after a successful send.
 */
export async function recordOutboundSend(opts: {
  contactId: number;
  dealId?: number | null;
  channel: "email" | "sms" | "rvm" | "voicemail";
  provider?: "ghl" | "smtp" | "twilio";
  subject?: string | null;
  body?: string | null;
  status?: "sent" | "failed" | "skipped" | "blocked";
  sequenceId?: number | null;
  sequenceStepId?: number | null;
  ghlMessageId?: string | null;
  externalMessageId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<number | null> {
  return recordCommunicationEvent({
    contactId: opts.contactId,
    dealId: opts.dealId ?? null,
    direction: "outbound",
    channel: opts.channel,
    provider: opts.provider ?? "ghl",
    subject: opts.subject ?? null,
    body: opts.body ?? null,
    status: opts.status ?? "sent",
    sentBy: "automation",
    sequenceId: opts.sequenceId ?? null,
    sequenceStepId: opts.sequenceStepId ?? null,
    ghlMessageId: opts.ghlMessageId ?? null,
    externalMessageId: opts.externalMessageId ?? null,
    metadata: opts.metadata ?? null,
  });
}

/**
 * Convenience helper for recording inbound events (replies, form submissions,
 * call outcomes, appointment bookings).
 */
export async function recordInboundEvent(opts: {
  contactId: number;
  dealId?: number | null;
  channel: "email" | "sms" | "call" | "voicemail" | "chat" | "form" | "portal";
  provider?: "ghl" | "smtp" | "internal" | "manual";
  subject?: string | null;
  body?: string | null;
  status?: "received" | "replied" | "bounced" | "failed";
  intentClassification?: string | null;
  intentConfidence?: number | null;
  automationStopped?: boolean;
  automationStopReason?: string | null;
  ghlMessageId?: string | null;
  externalMessageId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<number | null> {
  return recordCommunicationEvent({
    contactId: opts.contactId,
    dealId: opts.dealId ?? null,
    direction: "inbound",
    channel: opts.channel,
    provider: opts.provider ?? "ghl",
    subject: opts.subject ?? null,
    body: opts.body ?? null,
    status: opts.status ?? "received",
    sentBy: "human",
    intentClassification: opts.intentClassification ?? null,
    intentConfidence: opts.intentConfidence != null ? String(opts.intentConfidence) : null,
    automationStopped: opts.automationStopped ?? false,
    automationStopReason: opts.automationStopReason ?? null,
    ghlMessageId: opts.ghlMessageId ?? null,
    externalMessageId: opts.externalMessageId ?? null,
    metadata: opts.metadata ?? null,
  });
}
