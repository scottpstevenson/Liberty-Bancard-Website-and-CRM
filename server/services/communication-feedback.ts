/**
 * Communication Feedback Intelligence Engine
 *
 * Central processor for all communication outcomes (email, SMS, call, voicemail).
 * Applies weighted engagement/reachability scoring, updates contact flags, writes
 * back to GHL custom fields + tags, and detects the all-channels-failed state.
 */

import { db } from "../db";
import { contacts, auditLogs } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../storage";

export type CommEventType =
  | "email_bounce"
  | "email_open"
  | "email_reply"
  | "sms_undeliverable"
  | "sms_reply"
  | "call_answered"
  | "call_no_answer"
  | "call_busy"
  | "voicemail_left"
  | "inbound_call";

export interface CommEvent {
  type: CommEventType;
  contactId: number;
  severity?: "hard" | "soft";
  channel?: string;
  transcript?: string;
  metadata?: Record<string, unknown>;
}

export interface CommEventResult {
  nextAction: "sms_escalation" | "re_enrich" | "email_escalation" | "flip_to_email_first" | "human_review" | "none";
  phoneVerificationNeeded?: boolean;
  engagementDelta: number;
  reachabilityDelta: number;
  channelFailed?: "email" | "sms" | "call";
  allChannelsFailed?: boolean;
}

const SCORE_WEIGHTS: Record<CommEventType, { engagement: number; reachability: number }> = {
  email_reply:       { engagement: +20, reachability:   0 },
  email_open:        { engagement:  +5, reachability:   0 },
  email_bounce:      { engagement: -30, reachability: -15 },
  sms_reply:         { engagement: +20, reachability:   0 },
  sms_undeliverable: { engagement: -15, reachability: -10 },
  call_answered:     { engagement: +15, reachability:  +5 },
  call_no_answer:    { engagement:  -5, reachability:  -5 },
  call_busy:         { engagement:  -5, reachability:  -3 },
  voicemail_left:    { engagement:  -2, reachability:  -2 },
  inbound_call:      { engagement: +25, reachability: +10 },
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export async function processCommunicationEvent(event: CommEvent): Promise<CommEventResult> {
  const now = new Date();
  const weights = SCORE_WEIGHTS[event.type];
  const result: CommEventResult = {
    nextAction: "none",
    engagementDelta: weights.engagement,
    reachabilityDelta: weights.reachability,
  };

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, event.contactId));
  if (!contact) {
    console.warn(`[CommFeedback] Contact #${event.contactId} not found`);
    return result;
  }

  const updates: Partial<typeof contacts.$inferInsert> = {
    engagementScore: clamp((contact.engagementScore ?? 50) + weights.engagement, 0, 100),
    reachabilityScore: clamp((contact.reachabilityScore ?? 100) + weights.reachability, 0, 100),
    updatedAt: now,
  };

  const ghlTags: string[] = [];
  const ghlCustomFields: Record<string, string> = {};

  switch (event.type) {
    case "email_bounce": {
      if (event.severity === "hard" || !event.severity) {
        updates.emailStatus = "bounced";
        updates.bouncedAt = now;
        updates.consentEmail = false;
        ghlTags.push("Email Bounced");
        result.channelFailed = "email";
        result.nextAction = contact.phone && contact.smsStatus !== "undeliverable"
          ? "sms_escalation"
          : "re_enrich";
      }
      ghlCustomFields["lb_last_bounce_at"] = now.toISOString();
      break;
    }

    case "sms_undeliverable": {
      updates.smsStatus = "undeliverable";
      ghlTags.push("SMS Invalid", "Phone Needs Verification");
      result.channelFailed = "sms";
      result.nextAction = contact.emailStatus === "bounced" ? "human_review" : "email_escalation";
      result.phoneVerificationNeeded = true;
      break;
    }

    case "call_no_answer":
    case "call_busy": {
      const newAttempts = (contact.callAttempts ?? 0) + 1;
      updates.callAttempts = newAttempts;
      ghlCustomFields["lb_call_attempts"] = String(newAttempts);

      if (newAttempts >= 3) {
        ghlTags.push("No Answer ×3");
        result.nextAction = "flip_to_email_first";
        updates.preferredChannel = "email";
        ghlCustomFields["lb_preferred_channel"] = "email";
        ghlCustomFields["lb_outreach_strategy"] = "email_first";
      }
      if (newAttempts >= 5) {
        result.nextAction = "human_review";
      }
      break;
    }

    case "voicemail_left": {
      updates.lastVoicemailAt = now;
      if (event.transcript) {
        ghlCustomFields["lb_voicemail_transcript"] = event.transcript.substring(0, 500);
      }
      if (contact.ghlContactId && event.transcript) {
        const { addNote } = await import("./sdr/ghl-client");
        addNote({
          contactId: contact.ghlContactId,
          body: `Voicemail left — transcript:\n\n${event.transcript}`,
        }).catch((err: Error) => console.warn(`[CommFeedback] addNote (voicemail) failed:`, err.message));
      }
      break;
    }

    case "email_reply":
    case "sms_reply":
    case "inbound_call": {
      updates.coolingUntil = null;
      const channelMap: Record<string, string> = {
        email_reply: "email",
        sms_reply: "sms",
        inbound_call: "call",
      };
      updates.preferredChannel = channelMap[event.type] ?? contact.preferredChannel;
      ghlTags.push("Replied");
      break;
    }
  }

  ghlCustomFields["lb_engagement_score"] = String(updates.engagementScore ?? contact.engagementScore ?? 50);
  ghlCustomFields["lb_reachability_score"] = String(updates.reachabilityScore ?? contact.reachabilityScore ?? 100);
  if (updates.preferredChannel) {
    ghlCustomFields["lb_preferred_channel"] = updates.preferredChannel;
  }

  const emailFailed = (updates.emailStatus === "bounced") || contact.emailStatus === "bounced";
  const smsFailed = (updates.smsStatus === "undeliverable") || contact.smsStatus === "undeliverable";
  const callFailed = (updates.callAttempts ?? contact.callAttempts ?? 0) >= 5;

  if (emailFailed && smsFailed && callFailed) {
    updates.doNotAutoContact = true;
    updates.status = "Unreachable";
    result.allChannelsFailed = true;
    result.nextAction = "human_review";
    ghlTags.push("Unreachable");
    ghlCustomFields["lb_contact_status"] = "Unreachable";
  }

  await db.update(contacts).set(updates).where(eq(contacts.id, event.contactId));

  await db.insert(auditLogs).values({
    actorType: "system",
    action: `comm_event_${event.type}`,
    entityType: "contact",
    entityId: event.contactId,
    details: {
      eventType: event.type,
      severity: event.severity,
      engagementDelta: weights.engagement,
      reachabilityDelta: weights.reachability,
      newEngagement: updates.engagementScore,
      newReachability: updates.reachabilityScore,
      nextAction: result.nextAction,
      allChannelsFailed: result.allChannelsFailed ?? false,
      ...event.metadata,
    },
  });

  if (result.allChannelsFailed) {
    try {
      await storage.pauseAllActiveEnrollments(event.contactId);
    } catch (err) {
      console.warn(`[CommFeedback] pauseAllActiveEnrollments failed for contact #${event.contactId}:`, err);
    }

  }

  if (result.nextAction === "sms_escalation" && contact.phone) {
    try {
      const { getQueueManager } = await import("./queue-manager");
      const qm = await getQueueManager();
      const seqQueue = qm.getQueue("sequences");
      if (seqQueue) {
        await (seqQueue as any).add("sms-escalation", {
          contactId: event.contactId,
          reason: "email_bounce_sms_escalation",
          phone: contact.phone,
        }, { deduplication: { id: `sms-esc-${event.contactId}` } } as any);
        console.log(`[CommFeedback] SMS escalation job queued for contact #${event.contactId}`);
      }
    } catch (err) {
      console.warn(`[CommFeedback] SMS escalation enqueue failed for contact #${event.contactId}:`, err);
    }
  }

  if (result.nextAction === "re_enrich") {
    try {
      const { getQueueManager } = await import("./queue-manager");
      const qm = await getQueueManager();
      const enrichmentQueue = qm.getQueue("enrichment");
      if (enrichmentQueue) {
        await enrichmentQueue.add("free-enrich", {
          contactId: event.contactId,
          reason: "email_bounce_re_enrich",
        }, { deduplication: { id: `re-enrich-${event.contactId}` } } as any);
        console.log(`[CommFeedback] Re-enrichment job queued for contact #${event.contactId}`);
      }
    } catch (err) {
      console.warn(`[CommFeedback] Re-enrichment enqueue failed for contact #${event.contactId}:`, err);
    }
  }

  syncGhlFeedback(contact.ghlContactId, ghlTags, ghlCustomFields, event.contactId, result, contact, (contact as any).assignedUserId ?? null).catch(
    (err: Error) => console.warn(`[CommFeedback] GHL writeback failed for contact #${event.contactId}:`, err.message)
  );

  return result;
}

async function syncGhlFeedback(
  ghlContactId: string | null,
  tags: string[],
  customFields: Record<string, string>,
  contactId: number,
  result: CommEventResult,
  contact: { firstName: string; lastName: string; ghlContactId: string | null },
  assignedUserId: string | null = null,
): Promise<void> {
  if (!ghlContactId) return;

  const { isGhlConfigured, createGhlTask } = await import("./ghl");
  if (!isGhlConfigured()) return;

  const { addTag, updateCustomFields } = await import("./sdr/ghl-client");

  if (tags.length > 0) {
    await addTag({ contactId: ghlContactId, tags }).catch(
      (err: Error) => console.warn(`[CommFeedback] addTag failed:`, err.message)
    );
  }

  if (Object.keys(customFields).length > 0) {
    await updateCustomFields(ghlContactId, customFields).catch(
      (err: Error) => console.warn(`[CommFeedback] updateCustomFields failed:`, err.message)
    );
  }

  if (result.allChannelsFailed) {
    await createGhlTask({
      contactId: ghlContactId,
      title: `Manual Review Required: All Channels Failed — ${contact.firstName} ${contact.lastName}`,
      description: "Email bounced, SMS undeliverable, and 5+ call attempts with no answer. Human review needed to update contact information.",
      taskType: "FOLLOW_UP",
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      ...(assignedUserId ? { assignedTo: assignedUserId } : {}),
    }).catch((err: Error) => console.warn(`[CommFeedback] createGhlTask (unreachable) failed:`, err.message));
  }

  if (result.nextAction === "human_review" && !result.allChannelsFailed) {
    const [refreshed] = await db.select().from(contacts).where(eq(contacts.id, contactId));
    if (refreshed && (refreshed.callAttempts ?? 0) >= 5) {
      await createGhlTask({
        contactId: ghlContactId,
        title: `5+ No-Answer Calls — Manual Review: ${contact.firstName} ${contact.lastName}`,
        description: "This contact has not answered after 5 or more call attempts. Please review and update phone number or mark as inactive.",
        taskType: "FOLLOW_UP",
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        ...(assignedUserId ? { assignedTo: assignedUserId } : {}),
      }).catch((err: Error) => console.warn(`[CommFeedback] createGhlTask (no-answer) failed:`, err.message));
    }
  }

  if (result.phoneVerificationNeeded) {
    await createGhlTask({
      contactId: ghlContactId,
      title: `Phone Verification Required: SMS Undeliverable — ${contact.firstName} ${contact.lastName}`,
      description: "SMS delivery failed for this contact. Please verify the phone number is correct and update if needed before re-enrolling in SMS outreach.",
      taskType: "FOLLOW_UP",
      dueDate: new Date(Date.now() + 48 * 60 * 60 * 1000),
      ...(assignedUserId ? { assignedTo: assignedUserId } : {}),
    }).catch((err: Error) => console.warn(`[CommFeedback] createGhlTask (phone-verification) failed:`, err.message));
  }
}
