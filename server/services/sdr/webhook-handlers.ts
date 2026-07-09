import { z } from "zod";
import { createHash } from "crypto";
import { db } from "../../db";
import { sdrLeadEvents, sdrMerchants, sdrLeadState, contacts } from "@shared/schema";
import type { SdrMerchant } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { storage } from "../../storage";
import { onOptOut, onAppointmentBooked, onStageChange } from "./ghl-sync-rules";
import { classifyIntent, executeIntentAction } from "./reply-intelligence";
import { handleCallDisposition, CALL_DISPOSITIONS, type CallDisposition } from "./voice-orchestrator";
import { handleAppointmentBooked as schedulingHandleBooked, handleAppointmentCanceled as schedulingHandleCanceled } from "./scheduling";
import { enrollInAppointmentWorkflow, tagContactForInboxOrganization } from "../ghl-workflow-enrollment";
import { checkAndLogCompliance } from "./compliance-engine";
import { processCommunicationEvent } from "../communication-feedback";
import { getCanonicalLeadVertical } from "./vertical-resolver";

const contactUpdatedSchema = z.object({
  contactId: z.string().optional(),
  id: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
}).passthrough();

const messageReceivedSchema = z.object({
  contactId: z.string(),
  type: z.string().optional(),
  messageId: z.string().optional(),
  body: z.string().optional(),
  direction: z.string().optional(),
}).passthrough();

const callOutcomeSchema = z.object({
  contactId: z.string().optional(),
  callId: z.string().optional(),
  direction: z.string().optional(),
  status: z.string().optional(),
  duration: z.number().optional(),
}).passthrough();

const appointmentSchema = z.object({
  contactId: z.string().optional(),
  appointmentId: z.string().optional(),
  id: z.string().optional(),
  calendarId: z.string().optional(),
  status: z.string().optional(),
  startTime: z.string().optional(),
}).passthrough();

const optOutSchema = z.object({
  contactId: z.string().optional(),
  channel: z.enum(["sms", "email", "call", "all"]).optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
}).passthrough();

async function findMerchantByGhlId(ghlContactId: string): Promise<SdrMerchant | null> {
  const [merchant] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.ghlContactId, ghlContactId));
  return merchant || null;
}

async function logInvalidPayload(eventType: string, rawPayload: unknown, validationError: string): Promise<void> {
  try {
    await db.insert(sdrLeadEvents).values({
      merchantId: null,
      eventType: `${eventType}_validation_failed`,
      channel: "ghl",
      actorType: "ghl_webhook",
      payloadJson: { rawPayload, validationError },
      ghlRefId: null,
    });
  } catch (logErr: unknown) {
    console.error("[SDR Webhook] Failed to log invalid payload:", logErr);
  }
}

export async function handleContactUpdated(rawPayload: unknown): Promise<void> {
  const parsed = contactUpdatedSchema.safeParse(rawPayload);
  if (!parsed.success) {
    console.warn("[SDR Webhook] contact-updated: invalid payload", parsed.error.message);
    await logInvalidPayload("contact_updated", rawPayload, parsed.error.message);
    return;
  }
  const payload = parsed.data;
  const ghlContactId = payload.contactId || payload.id;
  if (!ghlContactId) {
    console.warn("[SDR Webhook] contact-updated: no contactId in payload");
    await logInvalidPayload("contact_updated", rawPayload, "Missing contactId and id");
    return;
  }

  const merchant = await findMerchantByGhlId(ghlContactId);

  await db.insert(sdrLeadEvents).values({
    merchantId: merchant?.id || null,
    eventType: "contact_updated",
    channel: "ghl",
    actorType: "ghl_webhook",
    payloadJson: payload,
    ghlRefId: ghlContactId,
  });

  if (merchant) {
    const updates: Record<string, unknown> = {};
    if (payload.firstName || payload.lastName) {
      updates.businessName = [payload.firstName, payload.lastName].filter(Boolean).join(" ");
    }
    if (payload.email) updates.mainEmail = payload.email;
    if (payload.phone) updates.mainPhone = payload.phone;
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db.update(sdrMerchants).set(updates).where(eq(sdrMerchants.id, merchant.id));
    }
  }

  console.log(`[SDR Webhook] contact-updated processed for GHL contact ${ghlContactId}`);
}

export async function handleMessageReceived(rawPayload: unknown): Promise<void> {
  const parsed = messageReceivedSchema.safeParse(rawPayload);
  if (!parsed.success) {
    console.warn("[SDR Webhook] message-received: invalid payload", parsed.error.message);
    await logInvalidPayload("message_received", rawPayload, parsed.error.message);
    return;
  }
  const payload = parsed.data;
  const ghlContactId = payload.contactId;

  const merchant = await findMerchantByGhlId(ghlContactId);

  const channel = payload.type === "SMS" ? "sms" : payload.type === "Email" ? "email" : "chat";

  await db.insert(sdrLeadEvents).values({
    merchantId: merchant?.id || null,
    eventType: "message_received",
    channel,
    actorType: "merchant",
    payloadJson: payload,
    ghlRefId: payload.messageId || ghlContactId,
  });

  const deliveryStatus = (payload as any).status || (payload as any).deliveryStatus || "";
  const isSmsFailure = channel === "sms" && /failed|undelivered|undeliverable/i.test(deliveryStatus);
  const isInboundReply = (payload as any).direction === "inbound";

  if (isSmsFailure || isInboundReply) {
    const [crmContact] = await db.select().from(contacts).where(eq(contacts.ghlContactId, ghlContactId)).limit(1);
    if (crmContact) {
      if (isSmsFailure) {
        processCommunicationEvent({
          type: "sms_undeliverable",
          contactId: crmContact.id,
          metadata: { ghlContactId, deliveryStatus, messageId: payload.messageId },
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[SDR Webhook] processCommunicationEvent(sms_undeliverable) failed for contact #${crmContact.id}:`, msg);
        });
      } else if (isInboundReply) {
        const replyEventType = channel === "sms" ? "sms_reply" : channel === "email" ? "email_reply" : null;
        if (replyEventType) {
          processCommunicationEvent({
            type: replyEventType,
            contactId: crmContact.id,
            channel,
            metadata: { ghlContactId, messageId: payload.messageId },
          }).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[SDR Webhook] processCommunicationEvent(${replyEventType}) failed for contact #${crmContact.id}:`, msg);
          });
        }
      }
    }
  }

  if (merchant) {
    const [state] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchant.id));
    if (state) {
      await db.update(sdrLeadState).set({
        lastReplyAt: new Date(),
        lastTouchAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.merchantId, merchant.id));
    }

    const messageText = payload.body || "";
    if (messageText.trim()) {
      try {
        const recentMessages = await db.select()
          .from(sdrLeadEvents)
          .where(and(
            eq(sdrLeadEvents.merchantId, merchant.id),
            sql`${sdrLeadEvents.eventType} IN ('message_received', 'template_response_sent')`,
          ))
          .orderBy(sql`${sdrLeadEvents.createdAt} DESC`)
          .limit(5);
        const conversationHistory = recentMessages
          .reverse()
          .map(e => {
            const payload = e.payloadJson as Record<string, unknown> | null;
            const body = payload?.body || payload?.templateKey || "";
            const direction = e.actorType === "merchant" ? "Merchant" : "Agent";
            return `${direction}: ${body}`;
          })
          .filter(line => line.length > 10);

        const classification = await classifyIntent(messageText, {
          merchantVertical: getCanonicalLeadVertical({
            subvertical: merchant.subvertical,
            vertical: merchant.vertical,
          }),
          currentStage: state?.currentStage,
          merchantName: merchant.businessName,
          conversationHistory,
        });

        await executeIntentAction(merchant.id, classification, channel);

        console.log(`[SDR Webhook] message-received: merchant=${merchant.id}, intent=${classification.intent} (${(classification.confidence * 100).toFixed(0)}%)`);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[SDR Webhook] Intent classification failed for merchant ${merchant.id}:`, errMsg);

        if (state && ["OUTREACH_EMAIL", "OUTREACH_SMS", "OUTREACH_CHAT", "OUTREACH_CALL"].includes(state.currentStage)) {
          await db.update(sdrLeadState).set({
            currentStage: "ENGAGED",
            updatedAt: new Date(),
          }).where(eq(sdrLeadState.merchantId, merchant.id));
          await onStageChange(merchant.id, "ENGAGED", state.currentStage);
        }
      }
    } else {
      if (state && ["OUTREACH_EMAIL", "OUTREACH_SMS", "OUTREACH_CHAT", "OUTREACH_CALL"].includes(state.currentStage)) {
        await db.update(sdrLeadState).set({
          currentStage: "ENGAGED",
          updatedAt: new Date(),
        }).where(eq(sdrLeadState.merchantId, merchant.id));
        await onStageChange(merchant.id, "ENGAGED", state.currentStage);
      }
    }
  }

  console.log(`[SDR Webhook] message-received processed for GHL contact ${ghlContactId}`);
}

export async function handleCallOutcome(rawPayload: unknown): Promise<void> {
  const parsed = callOutcomeSchema.safeParse(rawPayload);
  if (!parsed.success) {
    console.warn("[SDR Webhook] call-outcome: invalid payload", parsed.error.message);
    await logInvalidPayload("call_outcome", rawPayload, parsed.error.message);
    return;
  }
  const payload = parsed.data;
  const ghlContactId = payload.contactId;
  const merchant = ghlContactId ? await findMerchantByGhlId(ghlContactId) : null;

  await db.insert(sdrLeadEvents).values({
    merchantId: merchant?.id || null,
    eventType: "call_outcome",
    channel: "call",
    actorType: payload.direction === "inbound" ? "merchant" : "system",
    payloadJson: payload,
    ghlRefId: payload.callId || ghlContactId || null,
  });

  if (merchant) {
    const [state] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchant.id));
    if (state) {
      await db.update(sdrLeadState).set({
        lastCallAt: new Date(),
        lastTouchAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.merchantId, merchant.id));
    }

    const rawDisposition = (payload.status || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (rawDisposition && (CALL_DISPOSITIONS as readonly string[]).includes(rawDisposition)) {
      try {
        await handleCallDisposition(merchant.id, rawDisposition as CallDisposition, {
          callId: payload.callId,
          direction: payload.direction,
          duration: payload.duration,
        });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[SDR Webhook] Call disposition handling failed for merchant ${merchant.id}:`, errMsg);
      }
    }
  }

  if (ghlContactId) {
    const [crmContact] = await db.select().from(contacts).where(eq(contacts.ghlContactId, ghlContactId)).limit(1);
    if (crmContact) {
      const eventTypeMap: Record<string, string> = {
        no_answer: "call_no_answer",
        busy: "call_busy",
        voicemail_left: "voicemail_left",
        interested: "call_answered",
        booked_meeting: "call_answered",
        promised_statement: "call_answered",
        callback_requested: "call_answered",
        not_interested: "call_answered",
        gatekeeper: "call_answered",
        wrong_number: "call_no_answer",
        do_not_call: "call_no_answer",
      };
      const rawDisp = (payload.status || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
      const commEventType = eventTypeMap[rawDisp] as Parameters<typeof processCommunicationEvent>[0]["type"] | undefined;
      if (commEventType) {
        processCommunicationEvent({
          type: commEventType,
          contactId: crmContact.id,
          metadata: { callId: payload.callId, disposition: payload.status, direction: payload.direction },
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[SDR Webhook] processCommunicationEvent(${commEventType}) failed for contact #${crmContact.id}:`, msg);
        });
      }

      if (payload.direction === "inbound" && commEventType === "call_answered") {
        processCommunicationEvent({
          type: "inbound_call",
          contactId: crmContact.id,
          metadata: { callId: payload.callId, direction: payload.direction },
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[SDR Webhook] processCommunicationEvent(inbound_call) failed for contact #${crmContact.id}:`, msg);
        });
      }
    }
  }

  if (ghlContactId && merchant) {
    const { enrollInGhlWorkflow } = await import("../ghl-workflows");
    enrollInGhlWorkflow({ workflowKey: "post_call_review", ghlContactId, metadata: { callId: (payload as any).callId, disposition: (payload as any).status, merchantId: merchant.id } }).catch(err =>
      console.error(`[SDR Webhook] GHL post_call_review enrollment error for contact ${ghlContactId}:`, err)
    );
  }

  console.log(`[SDR Webhook] call-outcome processed for GHL contact ${ghlContactId}`);
}

export async function handleAppointmentBooked(rawPayload: unknown): Promise<void> {
  const parsed = appointmentSchema.safeParse(rawPayload);
  if (!parsed.success) {
    console.warn("[SDR Webhook] appointment-booked: invalid payload", parsed.error.message);
    await logInvalidPayload("appointment_booked", rawPayload, parsed.error.message);
    return;
  }
  const payload = parsed.data;
  const ghlContactId = payload.contactId;

  await schedulingHandleBooked(payload);

  if (ghlContactId) {
    try {
      const [crmContact] = await db.select().from(contacts).where(eq(contacts.ghlContactId, ghlContactId)).limit(1);
      if (crmContact) {
        const appointmentDate = payload.startTime ? new Date(payload.startTime) : new Date(Date.now() + 24 * 60 * 60 * 1000);
        enrollInAppointmentWorkflow({
          contactId: crmContact.id,
          appointmentDate,
          calendarType: "sales",
        }).catch(err => console.error("[SDR Webhook] Appointment workflow enrollment failed:", err));

        import("../analytics-events").then(({ recordAnalyticsEvent }) => {
          recordAnalyticsEvent({
            eventName: "appointment_booked",
            contactId: crmContact.id,
            occurredAt: payload.startTime ? new Date(payload.startTime) : new Date(),
            metadata: { calendarType: "sales", source: "ghl_webhook" },
          });
        }).catch(() => {});

        tagContactForInboxOrganization({
          contactId: crmContact.id,
          ghlContactId,
          sequenceName: "Appointment Booked",
          stage: "meeting_set",
        }).catch(err => console.warn("[SDR Webhook] Appointment tagging failed:", err));
      }
    } catch (lookupErr) {
      console.warn("[SDR Webhook] CRM contact lookup for appointment failed:", lookupErr);
    }
  }

  console.log(`[SDR Webhook] appointment-booked processed for GHL contact ${ghlContactId}`);
}

export async function handleAppointmentCanceled(rawPayload: unknown): Promise<void> {
  const parsed = appointmentSchema.safeParse(rawPayload);
  if (!parsed.success) {
    console.warn("[SDR Webhook] appointment-canceled: invalid payload", parsed.error.message);
    await logInvalidPayload("appointment_canceled", rawPayload, parsed.error.message);
    return;
  }
  const payload = parsed.data;
  const ghlContactId = payload.contactId;

  await schedulingHandleCanceled(payload);

  console.log(`[SDR Webhook] appointment-canceled processed for GHL contact ${ghlContactId}`);
}

export async function handleOptOut(rawPayload: unknown): Promise<void> {
  const parsed = optOutSchema.safeParse(rawPayload);
  if (!parsed.success) {
    console.warn("[SDR Webhook] opt-out: invalid payload", parsed.error.message);
    await logInvalidPayload("opt_out", rawPayload, parsed.error.message);
    return;
  }
  const payload = parsed.data;
  const ghlContactId = payload.contactId;
  const channel = payload.channel || "all";

  const normalizedEmail = payload.email ? payload.email.toLowerCase().trim() : null;
  const normalizedPhone = payload.phone ? payload.phone.replace(/\D/g, "") : null;

  // ── 1. SDR merchant lookup (existing pipeline logic) ──────────────────────
  const merchant = ghlContactId ? await findMerchantByGhlId(ghlContactId) : null;
  if (merchant) {
    await onOptOut(merchant.id, channel);
  }

  // ── 2. Always store webhook event (regardless of match result) ────────────
  await db.insert(sdrLeadEvents).values({
    merchantId: merchant?.id || null,
    eventType: "opt_out",
    channel,
    actorType: "merchant",
    payloadJson: {
      ...payload,
      emailPresent: !!normalizedEmail,
      phonePresent: !!normalizedPhone,
    },
    ghlRefId: ghlContactId || null,
  });

  // ── 3. CRM contact suppression — three-tier fallback chain ────────────────
  const { suppressNewLeadAutoEnrollmentForContact } = await import("../new-lead-enrollment-job");
  const now = new Date();
  let matched = false;

  // Path A: exact ghlContactId match in contacts table
  if (ghlContactId) {
    try {
      const matchedContacts = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.ghlContactId, ghlContactId));

      if (matchedContacts.length > 0) {
        matched = true;
        for (const contact of matchedContacts) {
          await suppressNewLeadAutoEnrollmentForContact(contact.id, "ghl_opt_out");
          await db.update(contacts)
            .set({ optedOutEmail: true, emailStatus: "opted_out", consentTier: "opted_out", updatedAt: now })
            .where(eq(contacts.id, contact.id));
        }
        console.log(`[SDR Webhook] opt-out: GHL ID match — suppressed ${matchedContacts.length} contact(s)`);
      }
    } catch (err: any) {
      console.error("[SDR Webhook] opt-out GHL ID lookup error:", err?.message);
    }
  }

  // Path B: exact normalized email match (only if no GHL ID match)
  if (!matched && normalizedEmail) {
    try {
      const matchedContacts = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.email, normalizedEmail));

      if (matchedContacts.length > 0) {
        matched = true;
        const emailHash = createHash("sha256").update(normalizedEmail).digest("hex").slice(0, 16);
        const matchedCount = matchedContacts.length;
        for (const contact of matchedContacts) {
          await suppressNewLeadAutoEnrollmentForContact(contact.id, "ghl_opt_out_email_match");
          await db.update(contacts)
            .set({ optedOutEmail: true, emailStatus: "opted_out", consentTier: "opted_out", updatedAt: now })
            .where(eq(contacts.id, contact.id));
          await storage.createAuditLog({
            action: "ghl_opt_out_email_match",
            entityType: "contact",
            entityId: contact.id,
            actorType: "system",
            details: {
              matchedBy: "email",
              matchedCount,
              emailHash,
              ghlContactId: ghlContactId || null,
              channel,
            },
          });
        }
        console.log(`[SDR Webhook] opt-out: email fallback match — suppressed ${matchedCount} contact(s)`);
      }
    } catch (err: any) {
      console.error("[SDR Webhook] opt-out email fallback error:", err?.message);
    }
  }

  // Path C: exact normalized phone match (only if no prior match)
  if (!matched && normalizedPhone) {
    try {
      const matchedContacts = await db
        .select({ id: contacts.id, phone: contacts.phone })
        .from(contacts)
        .where(sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${normalizedPhone}`);

      if (matchedContacts.length > 0) {
        matched = true;
        const matchedCount = matchedContacts.length;
        for (const contact of matchedContacts) {
          await suppressNewLeadAutoEnrollmentForContact(contact.id, "ghl_opt_out_phone_match");
          await db.update(contacts)
            .set({ optedOutEmail: true, emailStatus: "opted_out", consentTier: "opted_out", updatedAt: now })
            .where(eq(contacts.id, contact.id));
          await storage.createAuditLog({
            action: "ghl_opt_out_phone_match",
            entityType: "contact",
            entityId: contact.id,
            actorType: "system",
            details: {
              matchedBy: "phone",
              matchedCount,
              phonePresent: true,
              ghlContactId: ghlContactId || null,
              channel,
            },
          });
        }
        console.log(`[SDR Webhook] opt-out: phone fallback match — suppressed ${matchedCount} contact(s)`);
      }
    } catch (err: any) {
      console.error("[SDR Webhook] opt-out phone fallback error:", err?.message);
    }
  }

  // Path D: no match — write anomaly audit, never drop silently
  if (!matched) {
    try {
      await storage.createAuditLog({
        action: "ghl_opt_out_unmatched_contact",
        entityType: "system",
        entityId: 0,
        actorType: "system",
        details: {
          ghlContactId: ghlContactId || null,
          emailPresent: !!normalizedEmail,
          phonePresent: !!normalizedPhone,
          reason: "no_contact_match",
          channel,
        },
      });
      console.warn(`[SDR Webhook] opt-out: no CRM contact matched (ghlContactId=${ghlContactId}, emailPresent=${!!normalizedEmail}, phonePresent=${!!normalizedPhone})`);
    } catch (err: any) {
      console.error("[SDR Webhook] opt-out anomaly audit error:", err?.message);
    }
  }

  console.log(`[SDR Webhook] opt-out processed for GHL contact ${ghlContactId} — matched=${matched}`);
}
