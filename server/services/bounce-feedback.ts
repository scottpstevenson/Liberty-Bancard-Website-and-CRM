import { db } from "../db";
import {
  contacts,
  outboundMessages,
  sendingIdentities,
  identityPerformanceDaily,
  auditLogs,
} from "@shared/schema";
import { eq, and, isNotNull, isNull, inArray, gte } from "drizzle-orm";

let lastRunAt: Date | null = null;

/**
 * Bounce feedback write-back.
 *
 * Uses outbound_messages.bounced_at (set when a specific message is known to have
 * bounced by GHL or external delivery tracking) to attribute bounces to the exact
 * contact who received the email.  This is accurate per-recipient — no domain
 * heuristics that could produce false positives.
 *
 * Contacts already marked bounced are skipped (idempotent).
 * Each write-back writes a contact_email_bounced audit log entry for traceability.
 */
export async function runBounceFeedbackWriteback(): Promise<{ updated: number; skipped: number }> {
  const now = new Date();
  const since = lastRunAt ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const bouncedMessages = await db
    .select({
      contactId: outboundMessages.contactId,
      toEmail: outboundMessages.toEmail,
    })
    .from(outboundMessages)
    .where(
      and(
        isNotNull(outboundMessages.bouncedAt),
        isNotNull(outboundMessages.contactId),
        gte(outboundMessages.bouncedAt, since)
      )
    );

  if (bouncedMessages.length === 0) {
    lastRunAt = now;
    return { updated: 0, skipped: 0 };
  }

  const contactIds = [...new Set(bouncedMessages.map(m => m.contactId!))];

  const existingContacts = await db
    .select({ id: contacts.id, email: contacts.email, emailStatus: contacts.emailStatus })
    .from(contacts)
    .where(
      and(
        inArray(contacts.id, contactIds),
        isNull(contacts.archivedAt)
      )
    );

  let updated = 0;
  let skipped = 0;

  for (const c of existingContacts) {
    if (c.emailStatus === "bounced") {
      skipped++;
      continue;
    }

    await db
      .update(contacts)
      .set({ emailStatus: "bounced", bouncedAt: now, updatedAt: now })
      .where(eq(contacts.id, c.id));

    await db.insert(auditLogs).values({
      actorType: "system",
      action: "contact_email_bounced",
      entityType: "contact",
      entityId: c.id,
      entityKey: c.email,
      details: {
        reason: "outbound_message_bounce",
        detectedAt: now.toISOString(),
      },
    });

    updated++;
  }

  lastRunAt = now;
  return { updated, skipped };
}

/**
 * Bounce feedback summary for the Operator Dashboard.
 *
 * Returns two views:
 * 1. contactsWrittenBackToday — count of contact_email_bounced audit logs written
 *    today, sourced directly from the audit log table. This is the accurate count
 *    of contacts whose emailStatus was updated to "bounced" by the write-back job.
 * 2. identities — per-sending-identity inbox bounce counts from
 *    identity_performance_daily (delivery-level, for warmup monitoring).
 *
 * Note: per-identity attribution for write-back contacts is not possible because
 * outbound_messages has no sending_identity_id FK. The two metrics are intentionally
 * separate: contactsWrittenBackToday tracks CRM record updates; identity bounces
 * track SMTP-level delivery health.
 */
export async function getBounceFeedbackSummary(): Promise<{
  contactsWrittenBackToday: number;
  identities: { emailAddress: string; label: string; inboxBouncesToday: number }[];
}> {
  // Count contact_email_bounced audit log entries written today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const writtenBackLogs = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, "contact_email_bounced"),
        gte(auditLogs.createdAt, todayStart)
      )
    );

  const contactsWrittenBackToday = writtenBackLogs.length;

  // Per-identity inbox bounce counts from identity_performance_daily
  const todayStr = todayStart.toISOString().slice(0, 10);
  const identities = await db.select().from(sendingIdentities);

  const todayRows = await db
    .select({
      sendingIdentityId: identityPerformanceDaily.sendingIdentityId,
      bounced: identityPerformanceDaily.bounced,
    })
    .from(identityPerformanceDaily)
    .where(eq(identityPerformanceDaily.date, todayStr));

  const bouncedByIdentity = new Map<number, number>();
  for (const row of todayRows) {
    const existing = bouncedByIdentity.get(row.sendingIdentityId) ?? 0;
    bouncedByIdentity.set(row.sendingIdentityId, existing + (row.bounced ?? 0));
  }

  return {
    contactsWrittenBackToday,
    identities: identities.map(identity => ({
      emailAddress: identity.emailAddress,
      label: identity.label,
      inboxBouncesToday: bouncedByIdentity.get(identity.id) ?? 0,
    })),
  };
}
