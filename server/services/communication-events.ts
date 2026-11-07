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

import { db, pool } from "../db";
import { communicationEvents, type InsertCommunicationEvent } from "@shared/schema";
import { storage } from "../storage";
import { and, eq, gt } from "drizzle-orm";
import { communicationContactLockKey } from "./communication-contact-lock";

export type { InsertCommunicationEvent };

/** The only reply-stop read result consumers may use.  `UNAVAILABLE` is
 * deliberately distinct from absence: callers must defer rather than send. */
export type ReplyDecision = "REPLIED" | "CONFIRMED_ABSENT" | "UNAVAILABLE";

export interface ReplyDecisionDependencies {
  /** Injectable for unit tests and for callers that need a bounded DB adapter. */
  findInboundSince?: (contactId: number, enrolledAt: Date) => Promise<boolean>;
  timeoutMs?: number;
}

/**
 * Canonical read-side authority for sequence reply-stop decisions.
 *
 * communication_events is the source of truth.  In particular, audit_logs are
 * intentionally not consulted here: they remain historical compatibility
 * evidence only and an unavailable canonical read must never be interpreted as
 * "no reply".
 */
export async function decideReplySinceEnrollment(
  contactId: number,
  enrolledAt: Date,
  deps: ReplyDecisionDependencies = {},
): Promise<ReplyDecision> {
  if (!Number.isFinite(contactId) || Number.isNaN(enrolledAt.getTime())) {
    return "UNAVAILABLE";
  }
  const findInboundSince = deps.findInboundSince ?? (async (id, since) => {
    const rows = await db
      .select({ id: communicationEvents.id })
      .from(communicationEvents)
      .where(and(
        eq(communicationEvents.contactId, id),
        eq(communicationEvents.direction, "inbound"),
        gt(communicationEvents.createdAt, since),
      ))
      .limit(1);
    return rows.length > 0;
  });
  const timeoutMs = deps.timeoutMs ?? 5_000;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const replyRead = findInboundSince(contactId, enrolledAt);
    const timeoutRead = new Promise<boolean>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("reply decision timeout")), timeoutMs);
    });
    const replied = await Promise.race<boolean>([replyRead, timeoutRead]);
    return replied ? "REPLIED" : "CONFIRMED_ABSENT";
  } catch {
    return "UNAVAILABLE";
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

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
  provider?: "ghl" | "smtp" | "gmail" | "twilio";
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
export interface InboundEventOptions {
  contactId: number;
  dealId?: number | null;
  channel: "email" | "sms" | "call" | "voicemail" | "chat" | "form" | "portal";
  provider?: "ghl" | "smtp" | "gmail" | "internal" | "manual";
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
  occurredAt?: Date;
}

export async function recordInboundEvent(opts: InboundEventOptions): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
      communicationContactLockKey(opts.contactId).toString(),
    ]);
    const result = await client.query<{ id: number }>(`
      INSERT INTO communication_events
        (contact_id, deal_id, direction, channel, provider, subject, body,
         status, sent_by, intent_classification, intent_confidence,
         automation_stopped, automation_stop_reason, ghl_message_id,
         external_message_id, metadata, created_at, updated_at)
      VALUES
        ($1, $2, 'inbound', $3, $4, $5, $6, $7, 'human', $8, $9,
         $10, $11, $12, $13, $14, $15, NOW())
      RETURNING id
    `, [
      opts.contactId,
      opts.dealId ?? null,
      opts.channel,
      opts.provider ?? "ghl",
      opts.subject ?? null,
      opts.body ?? null,
      opts.status ?? "received",
      opts.intentClassification ?? null,
      opts.intentConfidence ?? null,
      opts.automationStopped ?? false,
      opts.automationStopReason ?? null,
      opts.ghlMessageId ?? null,
      opts.externalMessageId ?? null,
      opts.metadata ?? null,
      opts.occurredAt ?? new Date(),
    ]);
    if (!result.rows[0]) throw new Error("Canonical inbound communication event persistence returned no row");
    await client.query("COMMIT");
    return Number(result.rows[0].id);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* connection may be broken */ }
    throw new Error("Canonical inbound communication event persistence failed", { cause: err });
  } finally {
    client.release();
  }
}


/**
 * Same strict canonical inbound writer, participating in the CALLER's transaction. The contact communication
 * advisory lock and critical-error propagation are identical to recordInboundEvent; the difference is that the insert
 * commits or rolls back together with the caller's other writes (for example an effect receipt), so a crash between
 * the event commit and the receipt commit cannot leave an event whose replay inserts a second copy.
 */
export async function recordInboundEventInTx(
  tx: { execute: typeof db.execute },
  opts: InboundEventOptions,
): Promise<number> {
  const { sql } = await import("drizzle-orm");
  try {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${communicationContactLockKey(opts.contactId).toString()}::bigint)`);
    const metadata = opts.metadata == null ? null : JSON.stringify(opts.metadata);
    const result = await tx.execute(sql`
      INSERT INTO communication_events
        (contact_id, deal_id, direction, channel, provider, subject, body,
         status, sent_by, intent_classification, intent_confidence,
         automation_stopped, automation_stop_reason, ghl_message_id,
         external_message_id, metadata, created_at, updated_at)
      VALUES
        (${opts.contactId}, ${opts.dealId ?? null}, 'inbound', ${opts.channel}, ${opts.provider ?? "ghl"},
         ${opts.subject ?? null}, ${opts.body ?? null}, ${opts.status ?? "received"}, 'human',
         ${opts.intentClassification ?? null}, ${opts.intentConfidence ?? null},
         ${opts.automationStopped ?? false}, ${opts.automationStopReason ?? null}, ${opts.ghlMessageId ?? null},
         ${opts.externalMessageId ?? null}, ${metadata}::jsonb, ${opts.occurredAt ?? new Date()}, NOW())
      RETURNING id
    `);
    const row = (result.rows as Array<{ id: number }>)[0];
    if (!row) throw new Error("Canonical inbound communication event persistence returned no row");
    return Number(row.id);
  } catch (err) {
    throw new Error("Canonical inbound communication event persistence failed", { cause: err });
  }
}

/**
 * Canonical OUTBOUND event written inside the caller's transaction. Used where the event must commit atomically with
 * the send receipt and the enrollment advance (website warm lane), so a crash cannot leave an accepted send without its
 * event or an event without its receipt. Same table and columns as recordOutboundSend; errors propagate.
 */
export async function recordOutboundSendInTx(
  tx: { execute: typeof db.execute },
  opts: {
    contactId: number;
    channel: "email" | "sms" | "rvm" | "voicemail";
    provider: "ghl" | "smtp" | "gmail" | "twilio";
    subject?: string | null;
    body?: string | null;
    sequenceId?: number | null;
    externalMessageId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<number> {
  const { sql } = await import("drizzle-orm");
  const metadata = opts.metadata == null ? null : JSON.stringify(opts.metadata);
  const result = await tx.execute(sql`
    INSERT INTO communication_events
      (contact_id, direction, channel, provider, subject, body, status, sent_by, sequence_id, external_message_id, metadata, created_at, updated_at)
    VALUES
      (${opts.contactId}, 'outbound', ${opts.channel}, ${opts.provider}, ${opts.subject ?? null}, ${opts.body ?? null}, 'sent', 'automation',
       ${opts.sequenceId ?? null}, ${opts.externalMessageId ?? null}, ${metadata}::jsonb, NOW(), NOW())
    RETURNING id
  `);
  const row = (result.rows as Array<{ id: number }>)[0];
  if (!row) throw new Error("Canonical outbound communication event persistence returned no row");
  return Number(row.id);
}
