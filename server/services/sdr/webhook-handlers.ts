import { z } from "zod";
import { db } from "../../db";
import { sdrLeadEvents, sdrMerchants, sdrLeadState } from "@shared/schema";
import type { SdrMerchant } from "@shared/schema";
import { eq } from "drizzle-orm";
import { onOptOut, onAppointmentBooked, onStageChange } from "./ghl-sync-rules";

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
}).passthrough();

const optOutSchema = z.object({
  contactId: z.string().optional(),
  channel: z.enum(["sms", "email", "call", "all"]).optional(),
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

  if (merchant) {
    const [state] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchant.id));
    if (state) {
      await db.update(sdrLeadState).set({
        lastReplyAt: new Date(),
        lastTouchAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.merchantId, merchant.id));

      if (["OUTREACH_EMAIL", "OUTREACH_SMS", "OUTREACH_CHAT", "OUTREACH_CALL"].includes(state.currentStage)) {
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
  const merchant = ghlContactId ? await findMerchantByGhlId(ghlContactId) : null;

  if (merchant) {
    await onAppointmentBooked(merchant.id, payload);
  } else {
    await db.insert(sdrLeadEvents).values({
      merchantId: null,
      eventType: "appointment_booked",
      channel: "calendar",
      actorType: "merchant",
      payloadJson: payload,
      ghlRefId: payload.appointmentId || ghlContactId || null,
    });
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
  const merchant = ghlContactId ? await findMerchantByGhlId(ghlContactId) : null;

  await db.insert(sdrLeadEvents).values({
    merchantId: merchant?.id || null,
    eventType: "appointment_canceled",
    channel: "calendar",
    actorType: "merchant",
    payloadJson: payload,
    ghlRefId: payload.appointmentId || ghlContactId || null,
  });

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
  const merchant = ghlContactId ? await findMerchantByGhlId(ghlContactId) : null;

  if (merchant) {
    const channel = payload.channel || "all";
    await onOptOut(merchant.id, channel);
  } else {
    await db.insert(sdrLeadEvents).values({
      merchantId: null,
      eventType: "opt_out",
      channel: payload.channel || "all",
      actorType: "merchant",
      payloadJson: payload,
      ghlRefId: ghlContactId || null,
    });
  }

  console.log(`[SDR Webhook] opt-out processed for GHL contact ${ghlContactId}`);
}
