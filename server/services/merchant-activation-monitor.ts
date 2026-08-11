/**
 * merchant-activation-monitor.ts  (#1405)
 *
 * Runs on a daily schedule and identifies MIDs that have been assigned
 * but not yet activated (first transaction) after a configurable grace period.
 * Fires admin notifications so the team can follow up with the processor.
 *
 * Activation signals:
 *  - merchantMids.activatedAt IS NULL  ← MID was assigned but never activated
 *  - merchantMids.status = "assigned"  ← not yet active/suspended/closed
 *  - merchantMids.assignedAt < NOW() - ACTIVATION_GRACE_DAYS
 */

import { db } from "../db";
import { merchantMids, contacts } from "@shared/schema";
import { isNull, eq, and } from "drizzle-orm";
import { storage } from "../storage";

const ACTIVATION_GRACE_DAYS =
  parseInt(process.env.MID_ACTIVATION_GRACE_DAYS ?? "7", 10);

export interface ActivationAlertItem {
  midId: number;
  mid: string;
  contactId: number;
  contactName: string | null;
  dealId: number | null;
  processorName: string;
  assignedAt: Date;
  daysSinceAssigned: number;
}

/**
 * Find all MIDs that are assigned but not yet activated and past the grace period.
 */
export async function findUnactivatedMids(): Promise<ActivationAlertItem[]> {
  const cutoff = new Date(Date.now() - ACTIVATION_GRACE_DAYS * 24 * 60 * 60 * 1000);

  // Avoid innerJoin to prevent potential column-mapping conflicts in Drizzle.
  // Query merchantMids first, then look up contact names separately.
  // Use raw SQL for the date comparison to avoid potential Drizzle lt() issues
  // with timestamp columns on some Drizzle versions.
  const { sql: rawSql } = await import("drizzle-orm");
  const midRows = await db
    .select({
      midId:         merchantMids.id,
      mid:           merchantMids.mid,
      contactId:     merchantMids.contactId,
      dealId:        merchantMids.dealId,
      processorName: merchantMids.processorName,
      assignedAt:    merchantMids.assignedAt,
    })
    .from(merchantMids)
    .where(
      and(
        eq(merchantMids.status, "assigned"),
        isNull(merchantMids.activatedAt),
        rawSql`${merchantMids.assignedAt} < ${cutoff.toISOString()}::timestamptz`,
      )
    );

  const results: ActivationAlertItem[] = [];
  for (const r of midRows) {
    const daysSince = Math.floor(
      (Date.now() - new Date(r.assignedAt).getTime()) / (24 * 60 * 60 * 1000)
    );

    let contactName: string | null = null;
    try {
      const [contact] = await db
        .select({ firstName: contacts.firstName, lastName: contacts.lastName, companyName: contacts.companyName })
        .from(contacts)
        .where(eq(contacts.id, r.contactId))
        .limit(1);
      if (contact) {
        contactName =
          contact.companyName ||
          [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
          null;
      }
    } catch (_) {
      // Contact lookup failure is non-fatal
    }

    results.push({
      midId:         r.midId,
      mid:           r.mid,
      contactId:     r.contactId,
      contactName,
      dealId:        r.dealId ?? null,
      processorName: r.processorName,
      assignedAt:    r.assignedAt,
      daysSinceAssigned: daysSince,
    });
  }
  return results;
}

/**
 * Main entry point for the BullMQ job.
 * Runs findUnactivatedMids(), creates a single batched admin notification,
 * and writes an audit log so operators can track when the check ran.
 */
export async function runActivationMonitor(): Promise<{ checked: number; alerts: number }> {
  let items: ActivationAlertItem[] = [];
  try {
    items = await findUnactivatedMids();
  } catch (err: any) {
    console.error("[ActivationMonitor] findUnactivatedMids error:", err?.stack ?? err);
    throw err;
  }

  if (items.length > 0) {
    const summary = items
      .map(i => `MID ${i.mid} (${i.contactName ?? `#${i.contactId}`}) — ${i.daysSinceAssigned}d since assigned`)
      .join("; ");

    try {
      const { createPreferenceAwareNotification } = await import("./digest-service");
      await createPreferenceAwareNotification(
        {
          channel: "internal",
          title: `${items.length} MID${items.length === 1 ? "" : "s"} pending activation`,
          message:
            `The following MIDs were assigned ≥${ACTIVATION_GRACE_DAYS} days ago but have not yet processed their first transaction: ${summary}. ` +
            `Review at /dashboard/admin?tab=mids or follow up with Payarc.`,
          type: "warning",
          metadata: {
            eventType: "mid_activation_alert",
            midCount: items.length,
            mids: items.map(i => ({ mid: i.mid, contactId: i.contactId, daysSinceAssigned: i.daysSinceAssigned })),
          },
        },
        "mid_activation_alert",
      );
    } catch (notifErr) {
      console.error("[ActivationMonitor] Notification error (non-fatal):", notifErr);
    }
  }

  try {
    await storage.createAuditLog({
      action: "mid_activation_monitor_ran",
      entityType: "system",
      entityId: null as any,
      actorType: "system",
      details: { checked: items.length, graceDays: ACTIVATION_GRACE_DAYS },
    });
  } catch (auditErr: any) {
    console.error("[ActivationMonitor] Audit log error (non-fatal):", auditErr?.message);
  }

  return { checked: items.length, alerts: items.length };
}
