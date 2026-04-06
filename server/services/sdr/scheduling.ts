import { db } from "../../db";
import { sdrLeadState, sdrLeadEvents, sdrMerchants, sdrChannelAttempts } from "@shared/schema";
import type { SdrMerchant } from "@shared/schema";
import { eq } from "drizzle-orm";
import { fetchCalendars, isSdrGhlConfigured, triggerWorkflow } from "./ghl-client";
import { onStageChange } from "./ghl-sync-rules";

function getVerticalCalendarMap(): Record<string, string> {
  return {
    "Medical/Dental/Medspa": process.env.GHL_CALENDAR_MEDICAL || "",
    "Automotive": process.env.GHL_CALENDAR_AUTO || "",
    "Restaurant": process.env.GHL_CALENDAR_RESTAURANT || "",
    "Home Services": process.env.GHL_CALENDAR_HOME || "",
    "Retail": process.env.GHL_CALENDAR_RETAIL || "",
  };
}

function requireCalendarId(vertical: string): string {
  const map = getVerticalCalendarMap();
  const calendarId = map[vertical];
  if (!calendarId) {
    const envVarName = {
      "Medical/Dental/Medspa": "GHL_CALENDAR_MEDICAL",
      "Automotive": "GHL_CALENDAR_AUTO",
      "Restaurant": "GHL_CALENDAR_RESTAURANT",
      "Home Services": "GHL_CALENDAR_HOME",
      "Retail": "GHL_CALENDAR_RETAIL",
    }[vertical] || `GHL_CALENDAR_${vertical.toUpperCase().replace(/\s+/g, "_")}`;
    throw new Error(`Calendar not configured for vertical "${vertical}". Set the ${envVarName} environment variable.`);
  }
  return calendarId;
}

export interface CalendarSelection {
  calendarId: string;
  calendarName: string;
  reason: string;
}

export async function decideBestCalendar(merchant: SdrMerchant): Promise<CalendarSelection | null> {
  if (!isSdrGhlConfigured()) return null;

  if (merchant.vertical && merchant.vertical in getVerticalCalendarMap()) {
    const calendarId = requireCalendarId(merchant.vertical);
    return {
      calendarId,
      calendarName: `${merchant.vertical} Calendar`,
      reason: `Matched by vertical: ${merchant.vertical}`,
    };
  }

  const defaultCalendarId = process.env.GHL_DEFAULT_CALENDAR_ID;
  if (defaultCalendarId) {
    return {
      calendarId: defaultCalendarId,
      calendarName: "Default Calendar",
      reason: "Default calendar (no vertical-specific calendar configured)",
    };
  }

  try {
    const calendars = await fetchCalendars();
    if (calendars.length > 0) {
      return {
        calendarId: calendars[0].id,
        calendarName: calendars[0].name,
        reason: "First available calendar from GHL",
      };
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[Scheduling] Failed to fetch calendars:", errMsg);
  }

  return null;
}

export interface BookingLinkResult {
  sent: boolean;
  bookingUrl?: string;
  channel?: string;
  reason?: string;
}

export async function sendBookingLink(
  merchantId: number,
  channel: "sms" | "email" | "chat" = "sms"
): Promise<BookingLinkResult> {
  const [merchant] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.id, merchantId));
  if (!merchant) {
    return { sent: false, reason: "Merchant not found" };
  }

  const { checkAndLogCompliance } = await import("./compliance-engine");
  const complianceChannel = channel === "chat" ? "sms" : channel;
  const complianceResult = await checkAndLogCompliance(merchantId, complianceChannel as "sms" | "email");
  if (!complianceResult.allowed) {
    if (complianceResult.nextValidWindow) {
      await db.update(sdrLeadState).set({
        nextAction: "send_booking_link",
        nextActionType: "booking",
        nextActionAt: complianceResult.nextValidWindow,
        nextActionPayload: { channel },
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.merchantId, merchantId));
      return { sent: false, reason: `Deferred: ${complianceResult.reason}. Queued for ${complianceResult.nextValidWindow.toISOString()}` };
    }
    return { sent: false, reason: complianceResult.reason };
  }

  const calendar = await decideBestCalendar(merchant);
  if (!calendar) {
    return { sent: false, reason: "No calendar available" };
  }

  const locationId = process.env.GHL_LOCATION_ID || "";
  const bookingUrl = `https://api.leadconnectorhq.com/widget/bookings/${calendar.calendarId}`;

  if (!isSdrGhlConfigured() || !merchant.ghlContactId) {
    const reason = !isSdrGhlConfigured() ? "GHL not configured" : "No GHL contact ID";
    await db.insert(sdrLeadEvents).values({
      merchantId,
      eventType: "booking_link_queued",
      channel,
      actorType: "system",
      payloadJson: { bookingUrl, calendarId: calendar.calendarId, reason: `${reason} — link generated but not sent` },
      decisionReason: `Booking link generated but ${reason}`,
    });
    return { sent: false, bookingUrl, reason: `${reason} — link generated but not sent` };
  }

  try {
    const bookingWorkflowId = process.env.GHL_WORKFLOW_BOOKING_LINK;
    if (!bookingWorkflowId) {
      throw new Error("GHL_WORKFLOW_BOOKING_LINK environment variable is not set. Cannot trigger booking link workflow.");
    }
    await triggerWorkflow({
      workflowId: bookingWorkflowId,
      contactId: merchant.ghlContactId!,
      metadata: { calendarId: calendar.calendarId, bookingUrl, calendarName: calendar.calendarName, channel },
    });

    await db.insert(sdrChannelAttempts).values({
      merchantId,
      channel,
      attemptNo: 1,
      templateId: "booking_link",
      sentAt: new Date(),
      outcome: "sent",
    });

    await db.insert(sdrLeadEvents).values({
      merchantId,
      eventType: "booking_link_sent",
      channel,
      actorType: "system",
      payloadJson: {
        bookingUrl,
        calendarId: calendar.calendarId,
        calendarName: calendar.calendarName,
        selectionReason: calendar.reason,
      },
      decisionReason: `Booking link sent via ${channel}: ${calendar.calendarName}`,
    });

    console.log(`[Scheduling] Booking link sent for merchant ${merchantId} via ${channel}`);
    return { sent: true, bookingUrl, channel };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Scheduling] Failed to send booking link for merchant ${merchantId}:`, errMsg);

    await db.insert(sdrLeadEvents).values({
      merchantId,
      eventType: "booking_link_failed",
      channel,
      actorType: "system",
      payloadJson: { error: errMsg },
      decisionReason: `Failed to send booking link: ${errMsg}`,
    });

    return { sent: false, bookingUrl, reason: errMsg };
  }
}

export async function handleAppointmentBooked(webhookData: {
  contactId?: string;
  appointmentId?: string;
  id?: string;
  calendarId?: string;
  status?: string;
  startTime?: string;
  [key: string]: unknown;
}): Promise<void> {
  const ghlContactId = webhookData.contactId;
  if (!ghlContactId) return;

  const [merchant] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.ghlContactId, ghlContactId));
  if (!merchant) {
    await db.insert(sdrLeadEvents).values({
      merchantId: null,
      eventType: "appointment_booked",
      channel: "calendar",
      actorType: "merchant",
      payloadJson: webhookData,
      ghlRefId: webhookData.appointmentId || ghlContactId,
    });
    return;
  }

  const meetingId = webhookData.appointmentId || webhookData.id || null;
  const [state] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchant.id));
  const oldStage = state?.currentStage;

  if (state) {
    await db.update(sdrLeadState).set({
      currentStage: "MEETING_SET",
      meetingId,
      lastTouchAt: new Date(),
      nextAction: "send_appointment_reminder",
      nextActionType: "reminder",
      nextActionPayload: { appointmentId: meetingId, startTime: webhookData.startTime, outreachPaused: true },
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.merchantId, merchant.id));
  } else {
    await db.insert(sdrLeadState).values({
      merchantId: merchant.id,
      currentStage: "MEETING_SET",
      meetingId,
      nextAction: "send_appointment_reminder",
      nextActionType: "reminder",
      nextActionPayload: { appointmentId: meetingId, startTime: webhookData.startTime, outreachPaused: true },
    });
  }

  const { upsertOutreachPause } = await import("./compliance-engine");
  await upsertOutreachPause(merchant.id, true, "Outreach paused — appointment booked");

  if (oldStage !== "MEETING_SET") {
    await onStageChange(merchant.id, "MEETING_SET", oldStage);
  }

  await db.insert(sdrLeadEvents).values({
    merchantId: merchant.id,
    eventType: "appointment_booked",
    channel: "calendar",
    actorType: "merchant",
    payloadJson: webhookData,
    ghlRefId: meetingId,
    decisionReason: `Appointment booked — advanced to MEETING_SET from ${oldStage || "unknown"}`,
  });

  console.log(`[Scheduling] Appointment booked for merchant ${merchant.id}: ${meetingId}`);
}

export async function handleAppointmentCanceled(webhookData: {
  contactId?: string;
  appointmentId?: string;
  id?: string;
  calendarId?: string;
  status?: string;
  [key: string]: unknown;
}): Promise<void> {
  const ghlContactId = webhookData.contactId;
  if (!ghlContactId) return;

  const [merchant] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.ghlContactId, ghlContactId));
  if (!merchant) {
    await db.insert(sdrLeadEvents).values({
      merchantId: null,
      eventType: "appointment_canceled",
      channel: "calendar",
      actorType: "merchant",
      payloadJson: webhookData,
      ghlRefId: webhookData.appointmentId || ghlContactId,
    });
    return;
  }

  const [state] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchant.id));

  if (state?.currentStage === "MEETING_SET") {
    await db.update(sdrLeadState).set({
      currentStage: "ENGAGED",
      meetingId: null,
      nextAction: "no_show_recovery",
      nextActionType: "recovery_sequence",
      nextActionAt: new Date(Date.now() + 30 * 60_000),
      nextActionPayload: { canceledAppointmentId: webhookData.appointmentId || webhookData.id },
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.merchantId, merchant.id));
    await onStageChange(merchant.id, "ENGAGED", "MEETING_SET");

    const { upsertOutreachPause } = await import("./compliance-engine");
    await upsertOutreachPause(merchant.id, false, "Outreach resumed — appointment canceled, recovery sequence triggered");
  }

  await db.insert(sdrLeadEvents).values({
    merchantId: merchant.id,
    eventType: "appointment_canceled",
    channel: "calendar",
    actorType: "merchant",
    payloadJson: webhookData,
    ghlRefId: webhookData.appointmentId || webhookData.id || null,
    decisionReason: "Appointment canceled — triggered no-show recovery sequence",
  });

  console.log(`[Scheduling] Appointment canceled for merchant ${merchant.id}`);
}

export async function sendReminders(merchantId: number): Promise<boolean> {
  const [state] = await db.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchantId));
  if (!state || state.currentStage !== "MEETING_SET" || !state.meetingId) {
    return false;
  }

  const [merchant] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.id, merchantId));
  if (!merchant?.ghlContactId || !isSdrGhlConfigured()) {
    return false;
  }

  const { checkAndLogCompliance } = await import("./compliance-engine");
  const complianceResult = await checkAndLogCompliance(merchantId, "sms", "reminder");
  if (!complianceResult.allowed) {
    console.warn(`[Scheduling] Reminder blocked for merchant ${merchantId}: ${complianceResult.reason}`);
    return false;
  }

  try {
    const reminderWorkflowId = process.env.GHL_WORKFLOW_REMINDER;
    if (!reminderWorkflowId) {
      throw new Error("GHL_WORKFLOW_REMINDER environment variable is not set. Cannot trigger appointment reminder workflow.");
    }
    await triggerWorkflow({
      workflowId: reminderWorkflowId,
      contactId: merchant.ghlContactId,
    });

    await db.insert(sdrLeadEvents).values({
      merchantId,
      eventType: "reminder_sent",
      channel: "sms",
      actorType: "system",
      payloadJson: { meetingId: state.meetingId },
      decisionReason: "Appointment reminder sent",
    });

    console.log(`[Scheduling] Reminder sent for merchant ${merchantId}, meeting ${state.meetingId}`);
    return true;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Scheduling] Failed to send reminder for merchant ${merchantId}:`, errMsg);
    return false;
  }
}
