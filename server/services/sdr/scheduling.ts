import { db } from "../../db";
import { sdrLeadState, sdrLeadEvents, sdrMerchants, sdrChannelAttempts } from "@shared/schema";
import type { SdrMerchant } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { isSdrGhlConfigured } from "./ghl-client";
import { onStageChange } from "./ghl-sync-rules";
import { runReceiptStep, runReceiptTxStep, type DbTx } from "../ghl-webhook-effects";
import {
  ghlAppointmentSuperseded, ghlAppointmentIdOf, lockGhlContactPurpose, ghlContactIdOf, ghlStartTimeOf, readOpenAppointments, deriveCurrentAppointmentId,
} from "../ghl-appointment-events";
import { calendarPurposeOf, bookingForPurpose, type CalendarPurpose } from "../ghl-calendar-purpose";
import { enrollWorkflowHandoff, type AppointmentEnrollmentOutcome } from "../ghl-workflow-enrollment";

async function enrollMerchantWorkflow(
  merchant: Pick<SdrMerchant, "id" | "ghlContactId">,
  workflowKey: string,
  metadata?: Record<string, unknown>,
) {
  if (!merchant.ghlContactId) return { success: false, error: "No GHL contact ID", skipped: true };
  const { enrollInGhlWorkflowCompliant, resolveLocalContactIdForGhlContactId } = await import("../ghl-workflows");
  const contactId = await resolveLocalContactIdForGhlContactId(merchant.ghlContactId);
  if (!contactId) return { success: false, error: "No unique local contact mapped to this SDR merchant", skipped: true };
  return enrollInGhlWorkflowCompliant({ workflowKey, ghlContactId: merchant.ghlContactId, contactId, metadata });
}

const VERTICAL_CALENDAR_KEY_MAP: Record<string, { envVar: string; calendarKey: string }> = {
  "Medical/Dental/Medspa": { envVar: "GHL_CALENDAR_MEDICAL",     calendarKey: "MEDICAL" },
  "Healthcare":            { envVar: "GHL_CALENDAR_MEDICAL",     calendarKey: "MEDICAL" },
  "Medical":               { envVar: "GHL_CALENDAR_MEDICAL",     calendarKey: "MEDICAL" },
  "Dental":                { envVar: "GHL_CALENDAR_DENTAL",      calendarKey: "DENTAL" },
  "Med Spa":               { envVar: "GHL_CALENDAR_MEDSPA",      calendarKey: "MEDSPA" },
  "Medspa":                { envVar: "GHL_CALENDAR_MEDSPA",      calendarKey: "MEDSPA" },
  "Automotive":            { envVar: "GHL_CALENDAR_AUTO",        calendarKey: "AUTO" },
  "Auto":                  { envVar: "GHL_CALENDAR_AUTO",        calendarKey: "AUTO" },
  "Auto Repair":           { envVar: "GHL_CALENDAR_AUTO",        calendarKey: "AUTO" },
  "Restaurant":            { envVar: "GHL_CALENDAR_RESTAURANT",  calendarKey: "RESTAURANT" },
  "Home Services":         { envVar: "GHL_CALENDAR_HOME",        calendarKey: "HOME" },
  "Retail":                { envVar: "GHL_CALENDAR_RETAIL",      calendarKey: "RETAIL" },
  "Salon/Spa":             { envVar: "GHL_CALENDAR_SALON",       calendarKey: "SALON" },
  "Salon":                 { envVar: "GHL_CALENDAR_SALON",       calendarKey: "SALON" },
  "Gym":                   { envVar: "GHL_CALENDAR_GYM",         calendarKey: "GYM" },
  "Fitness":               { envVar: "GHL_CALENDAR_GYM",         calendarKey: "GYM" },
  "Fitness/Recreation":    { envVar: "GHL_CALENDAR_GYM",         calendarKey: "GYM" },
  "Hotel":                 { envVar: "GHL_CALENDAR_HOTEL",       calendarKey: "HOTEL" },
  "Hospitality":           { envVar: "GHL_CALENDAR_HOTEL",       calendarKey: "HOTEL" },
  "Landscaping":           { envVar: "GHL_CALENDAR_LANDSCAPING", calendarKey: "LANDSCAPING" },
  "Construction":          { envVar: "GHL_CALENDAR_CONSTRUCTION",calendarKey: "CONSTRUCTION" },
  "Legal":                 { envVar: "GHL_CALENDAR_LEGAL",       calendarKey: "LEGAL" },
  "Professional Services": { envVar: "GHL_CALENDAR_LEGAL",       calendarKey: "LEGAL" },
};

function normalizeVerticalForCalendar(vertical: string): string {
  const v = vertical.toLowerCase().trim();
  if (/^auto$|automotive|auto repair|collision|body shop|tire/i.test(v)) return "Automotive";
  if (/med.?spa|medspa/i.test(v)) return "Med Spa";
  if (/dental|dentist/i.test(v)) return "Dental";
  if (/medical|healthcare|clinic|health/i.test(v)) return "Medical/Dental/Medspa";
  if (/salon|spa|hair|nail|barber|beauty/i.test(v)) return "Salon/Spa";
  if (/gym|fitness|yoga|pilates|crossfit|martial arts|wellness/i.test(v)) return "Gym";
  if (/hotel|motel|lodge|resort|hospitality|inn/i.test(v)) return "Hotel";
  if (/landscap|lawn|tree service|grounds|irrigation/i.test(v)) return "Landscaping";
  if (/construct|contractor|builder|roofer|plumb|electrician|hvac|remodel/i.test(v)) return "Construction";
  if (/attorney|law firm|lawyer|legal|solicitor|paralegal/i.test(v)) return "Legal";
  if (/restaurant|food|cafe|bakery|diner|bistro/i.test(v)) return "Restaurant";
  if (/retail|shop|store|boutique/i.test(v)) return "Retail";
  if (/home service|handyman|cleaning|maid|janitorial/i.test(v)) return "Home Services";
  return vertical;
}

function getVerticalCalendarMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [key, { envVar }] of Object.entries(VERTICAL_CALENDAR_KEY_MAP)) {
    map[key] = process.env[envVar] || "";
  }
  return map;
}

function requireCalendarId(vertical: string): string {
  const normalized = normalizeVerticalForCalendar(vertical);
  const entry = VERTICAL_CALENDAR_KEY_MAP[normalized] || VERTICAL_CALENDAR_KEY_MAP[vertical];
  if (!entry) {
    throw new Error(`No calendar configuration found for vertical "${vertical}". Add it to VERTICAL_CALENDAR_KEY_MAP.`);
  }
  const calendarId = process.env[entry.envVar] || "";
  if (!calendarId) {
    throw new Error(`Calendar not configured for vertical "${vertical}". Set the ${entry.envVar} environment variable.`);
  }
  return calendarId;
}

export interface CalendarSelection {
  calendarId: string;
  calendarName: string;
  reason: string;
  bookingUrl: string;
}

/**
 * Calendar for a merchant's sales booking link: the vertical-specific calendar when configured, otherwise the one
 * validated sales booking resolution. There is no "first calendar GHL returns" fallback: if neither is configured the
 * caller gets null and reports that no calendar is available.
 */
export async function decideBestCalendar(merchant: SdrMerchant): Promise<CalendarSelection | null> {
  if (!isSdrGhlConfigured()) return null;

  if (merchant.vertical) {
    const normalized = normalizeVerticalForCalendar(merchant.vertical);
    const entry = VERTICAL_CALENDAR_KEY_MAP[normalized] || VERTICAL_CALENDAR_KEY_MAP[merchant.vertical];
    const calendarId = entry ? (process.env[entry.envVar] || "") : "";
    if (calendarId) {
      return {
        calendarId,
        calendarName: `${normalized} Calendar`,
        reason: `Matched by vertical: ${merchant.vertical} → ${normalized}`,
        bookingUrl: `https://api.leadconnectorhq.com/widget/booking/${encodeURIComponent(calendarId)}`,
      };
    }
  }

  const sales = bookingForPurpose("sales");
  if (!sales.available) return null;
  return {
    calendarId: sales.calendarId,
    calendarName: "Sales Calendar",
    reason: "Validated sales booking (no vertical-specific calendar configured)",
    bookingUrl: sales.widgetUrl,
  };
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

  const bookingUrl = calendar.bookingUrl;

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
    const enrollment = await enrollMerchantWorkflow(merchant, "booking_link", {
      calendarId: calendar.calendarId, bookingUrl, calendarName: calendar.calendarName, channel,
    });
    if (!enrollment.success) return { sent: false, bookingUrl, reason: enrollment.error || "Booking link workflow was suppressed" };

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

type AppointmentWebhookData = {
  contactId?: string;
  appointmentId?: string;
  id?: string;
  calendarId?: string;
  status?: string;
  startTime?: string;
  [key: string]: unknown;
};

/**
 * Provider enrollment through the one shared handoff (compliant gate + durable deferred-enrollment recovery). The step
 * result is a structured outcome, never a bare success:
 *  - enrolled: provider accepted;
 *  - held / skipped / unknown / failed-with-durable-owner: recorded as a visible lead event and returned; a pause or a
 *    transient provider failure leaves a deferred enrollment that the recovery job owns, so the handoff is not lost;
 *  - failed without a durable owner: throws so the provider's retry of the webhook recovers it.
 * The external call carries the stable identity {receiptId, stepKey, attempt}.
 */
async function enrollStep(
  stepKey: string, merchant: Pick<SdrMerchant, "id" | "ghlContactId">, workflowKey: string, metadata: Record<string, unknown>,
) {
  return runReceiptStep(stepKey, async info => {
    let outcome: AppointmentEnrollmentOutcome;
    if (!merchant.ghlContactId) {
      outcome = { state: "skipped", reason: "No GHL contact ID" };
    } else {
      const { resolveLocalContactIdForGhlContactId } = await import("../ghl-workflows");
      const contactId = await resolveLocalContactIdForGhlContactId(merchant.ghlContactId);
      outcome = contactId
        ? await enrollWorkflowHandoff({ workflowKey, ghlContactId: merchant.ghlContactId, contactId, metadata, identity: info })
        : { state: "skipped", reason: "No unique local contact mapped to this SDR merchant" };
    }
    if (outcome.state === "enrolled") return { enrolled: true, held: false, state: "enrolled" as const, durable: false };
    if (outcome.state === "failed" && !outcome.durable) {
      throw new Error(`workflow_enrollment_failed:${workflowKey}:${outcome.reason.slice(0, 120)}`);
    }
    // A required hold only satisfies the handoff once its obligation is verified durable. A hold whose persistence
    // failed (database error, terminal-row conflict) has no future owner, so the step stays retryable and visible.
    if (outcome.state === "held" && !outcome.durable) {
      throw new Error(`workflow_hold_not_durable:${workflowKey}:${outcome.reason.slice(0, 120)}`);
    }
    const durable = outcome.state === "skipped" ? false : outcome.durable;
    await db.insert(sdrLeadEvents).values({
      merchantId: merchant.id, eventType: "workflow_enrollment_held", channel: "system", actorType: "system",
      payloadJson: { workflowKey, state: outcome.state, durable, reason: outcome.state === "skipped" ? outcome.reason : outcome.reason.slice(0, 200), stepKey: info.stepKey, attempt: info.attempt },
      decisionReason: `Workflow ${workflowKey} not enrolled (${outcome.state}${durable ? ", retry owned by deferred enrollments" : ""}): ${outcome.reason.slice(0, 120)}`,
    });
    return { enrolled: false, held: true, state: outcome.state, durable };
  });
}

/** Orphan (no matching merchant) appointment event is recorded locally and ends the handler. */
async function recordOrphanAppointmentEvent(tx: DbTx, eventType: string, webhookData: AppointmentWebhookData, ghlContactId: string) {
  await tx.insert(sdrLeadEvents).values({
    merchantId: null, eventType, channel: "calendar", actorType: "merchant", payloadJson: webhookData,
    ghlRefId: webhookData.appointmentId || ghlContactId,
  });
}

/**
 * Cross-appointment authority (Stage 4C2). Lock order for every lifecycle handler: contact+calendar-purpose lock,
 * then the per-appointment lock (inside ghlAppointmentSuperseded), then the merchant/lead-state rows. The recorded
 * transition (ghl_appointment_state) is the only source of "which appointment is current": the earliest open
 * appointment of the sales purpose, ties by appointment id. The last webhook to arrive never decides it, and an event
 * about one appointment never moves the pointer, the stage or the outreach pause that belong to another.
 */
async function eventPurpose(tx: DbTx, webhookData: AppointmentWebhookData): Promise<CalendarPurpose> {
  const appointmentId = ghlAppointmentIdOf(webhookData);
  const nested = (webhookData.appointment && typeof webhookData.appointment === "object" ? webhookData.appointment : {}) as Record<string, unknown>;
  let calendarId = typeof webhookData.calendarId === "string" ? webhookData.calendarId
    : typeof nested.calendarId === "string" ? nested.calendarId : null;
  if (!calendarId && appointmentId) {
    const row = (await tx.execute(sql`SELECT calendar_id FROM ghl_appointment_state WHERE appointment_id = ${appointmentId}`)).rows[0] as { calendar_id: string | null } | undefined;
    calendarId = row?.calendar_id ?? null;
  }
  return calendarPurposeOf(calendarId);
}

interface CurrentMeeting { appointmentId: string | null; startTime: string | null }
async function currentSalesMeeting(tx: DbTx, ghlContactId: string): Promise<CurrentMeeting> {
  const rows = await readOpenAppointments(tx, ghlContactId);
  const id = deriveCurrentAppointmentId(rows, calendarPurposeOf, "sales");
  const row = rows.find(r => r.appointment_id === id);
  return { appointmentId: id, startTime: row?.start_time ? new Date(row.start_time).toISOString() : null };
}

/** A pointer owned by another appointment never matches. An empty pointer is claimable. */
function pointerMatches(current: string | null | undefined, eventAppointmentId: string | null): boolean {
  return !current || current === eventAppointmentId;
}

async function recordHistoryOnly(tx: DbTx, merchantId: number, eventType: string, webhookData: AppointmentWebhookData, reason: string) {
  await tx.insert(sdrLeadEvents).values({
    merchantId, eventType, channel: "calendar", actorType: "merchant", payloadJson: webhookData,
    ghlRefId: ghlAppointmentIdOf(webhookData), decisionReason: reason,
  });
}

export async function handleAppointmentBooked(webhookData: AppointmentWebhookData): Promise<void> {
  const ghlContactId = ghlContactIdOf(webhookData);
  if (!ghlContactId) return;

  // Local effects commit together with their step record, under the appointment lock, unless a later accepted
  // transition (cancel/showed) already superseded this booked effect.
  const { result: local } = await runReceiptTxStep("booked:local", async tx => {
    const purpose = await eventPurpose(tx, webhookData);
    await lockGhlContactPurpose(tx, ghlContactId, purpose);
    if (await ghlAppointmentSuperseded(tx, webhookData, "booked")) return { outcome: "superseded" as const };
    const [merchant] = await tx.select().from(sdrMerchants).where(eq(sdrMerchants.ghlContactId, ghlContactId));
    if (!merchant) {
      await recordOrphanAppointmentEvent(tx, "appointment_booked", webhookData, ghlContactId);
      return { outcome: "orphan" as const };
    }
    const bookedId = ghlAppointmentIdOf(webhookData);
    if (purpose !== "sales") {
      await recordHistoryOnly(tx, merchant.id, "appointment_booked", webhookData, `Appointment booked on the ${purpose} calendar; the sales pipeline is unchanged`);
      return { outcome: "history" as const };
    }
    const current = await currentSalesMeeting(tx, ghlContactId);
    const meetingId = current.appointmentId ?? bookedId;
    const [state] = await tx.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchant.id));
    const oldStage = state?.currentStage ?? null;
    const becomesCurrent = meetingId === bookedId;
    const nextActionPayload = { appointmentId: meetingId, startTime: current.startTime ?? ghlStartTimeOf(webhookData), outreachPaused: true };
    if (state) {
      await tx.update(sdrLeadState).set({
        currentStage: "MEETING_SET", meetingId, lastTouchAt: new Date(),
        ...(becomesCurrent || oldStage !== "MEETING_SET" ? { nextAction: "send_appointment_reminder", nextActionType: "reminder", nextActionPayload } : {}),
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.merchantId, merchant.id));
    } else {
      await tx.insert(sdrLeadState).values({
        merchantId: merchant.id, currentStage: "MEETING_SET", meetingId, nextAction: "send_appointment_reminder",
        nextActionType: "reminder", nextActionPayload,
      });
    }
    await tx.insert(sdrLeadEvents).values({
      merchantId: merchant.id, eventType: "appointment_booked", channel: "calendar", actorType: "merchant",
      payloadJson: webhookData, ghlRefId: bookedId,
      decisionReason: becomesCurrent
        ? `Appointment booked — advanced to MEETING_SET from ${oldStage || "unknown"}`
        : `Appointment booked — current meeting remains ${meetingId} (earlier appointment)`,
    });
    return { outcome: "applied" as const, merchantId: merchant.id, oldStage, meetingId: bookedId };
  });
  if (local.outcome !== "applied") return;

  const merchant = { id: local.merchantId, ghlContactId };
  const { upsertOutreachPause } = await import("./compliance-engine");
  await runReceiptStep("booked:outreach_pause", () => upsertOutreachPause(local.merchantId, true, "Outreach paused — appointment booked"));
  if (local.oldStage !== "MEETING_SET") {
    await runReceiptStep("booked:stage_sync", () => onStageChange(local.merchantId, "MEETING_SET", local.oldStage ?? undefined));
  }
  if (await ghlAppointmentSuperseded(null, webhookData, "booked")) return;
  // Awaited: a failed handoff fails the webhook receipt so the provider retry recovers it. Every booked appointment
  // owes its own confirmation (its own occurrence), whether or not it is the current meeting.
  await enrollStep("booked:enroll_booking_confirmation", merchant, "booking_confirmation",
    { appointmentId: local.meetingId, meetingId: local.meetingId, startTime: ghlStartTimeOf(webhookData) });

  console.log(`[Scheduling] Appointment booked for merchant ${local.merchantId}: ${local.meetingId}`);
}

/**
 * #appointment-to-statement — When GHL fires an appointment-showed event for the CURRENT meeting, advance the lead to
 * STATEMENT_REQUESTED and enroll in the statement-request workflow. A showed event for any other appointment is
 * recorded as history and changes nothing.
 */
export async function handleAppointmentShowed(webhookData: AppointmentWebhookData): Promise<void> {
  const ghlContactId = ghlContactIdOf(webhookData);
  if (!ghlContactId) return;

  const { result: local } = await runReceiptTxStep("showed:local", async tx => {
    const purpose = await eventPurpose(tx, webhookData);
    await lockGhlContactPurpose(tx, ghlContactId, purpose);
    if (await ghlAppointmentSuperseded(tx, webhookData, "showed")) return { outcome: "superseded" as const };
    const [merchant] = await tx.select().from(sdrMerchants).where(eq(sdrMerchants.ghlContactId, ghlContactId));
    if (!merchant) {
      await recordOrphanAppointmentEvent(tx, "appointment_showed", webhookData, ghlContactId);
      return { outcome: "orphan" as const };
    }
    const meetingId = ghlAppointmentIdOf(webhookData);
    if (purpose !== "sales") {
      await recordHistoryOnly(tx, merchant.id, "appointment_showed", webhookData, `Appointment showed on the ${purpose} calendar; the sales pipeline is unchanged`);
      return { outcome: "history" as const };
    }
    const [state] = await tx.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchant.id));
    if (state && !pointerMatches(state.meetingId, meetingId)) {
      await recordHistoryOnly(tx, merchant.id, "appointment_showed", webhookData,
        `Appointment ${meetingId} showed but the current meeting is ${state.meetingId} — history only, stage unchanged`);
      return { outcome: "history" as const };
    }
    const next = await currentSalesMeeting(tx, ghlContactId);
    if (next.appointmentId && next.appointmentId !== meetingId) {
      // Another sales appointment is still open: the lead stays in its meeting stage, B becomes current, and no
      // post-meeting statement chase starts until the last open meeting has been held.
      if (state) {
        await tx.update(sdrLeadState).set({
          meetingId: next.appointmentId, nextAction: "send_appointment_reminder", nextActionType: "reminder",
          nextActionPayload: { appointmentId: next.appointmentId, startTime: next.startTime, outreachPaused: true },
          updatedAt: new Date(),
        }).where(eq(sdrLeadState.merchantId, merchant.id));
      }
      await recordHistoryOnly(tx, merchant.id, "appointment_showed", webhookData,
        `Appointment ${meetingId} showed — current meeting is now ${next.appointmentId}; stage unchanged, no statement request started`);
      return { outcome: "history" as const };
    }
    const oldStage = state?.currentStage ?? null;
    if (state) {
      await tx.update(sdrLeadState).set({
        currentStage: "STATEMENT_REQUESTED", meetingId: next.appointmentId ?? meetingId, lastTouchAt: new Date(),
        nextAction: "statement_request_followup", nextActionType: "email",
        nextActionPayload: { meetingId, shownAt: ghlStartTimeOf(webhookData) }, updatedAt: new Date(),
      }).where(eq(sdrLeadState.merchantId, merchant.id));
    } else {
      await tx.insert(sdrLeadState).values({
        merchantId: merchant.id, currentStage: "STATEMENT_REQUESTED", meetingId,
        nextAction: "statement_request_followup", nextActionType: "email",
      });
    }
    await tx.insert(sdrLeadEvents).values({
      merchantId: merchant.id, eventType: "appointment_showed", channel: "calendar", actorType: "merchant",
      payloadJson: webhookData, ghlRefId: meetingId,
      decisionReason: `Appointment showed — advanced to STATEMENT_REQUESTED from ${oldStage || "unknown"}`,
    });
    return { outcome: "applied" as const, merchantId: merchant.id, oldStage, meetingId };
  });
  if (local.outcome !== "applied") return;

  if (local.oldStage !== "STATEMENT_REQUESTED") {
    await runReceiptStep("showed:stage_sync", () => onStageChange(local.merchantId, "STATEMENT_REQUESTED", local.oldStage ?? undefined));
  }
  if (isSdrGhlConfigured()) {
    await enrollStep("showed:enroll_statement_request", { id: local.merchantId, ghlContactId }, "statement_request_after_meeting",
      { meetingId: local.meetingId, appointmentId: local.meetingId, shownAt: ghlStartTimeOf(webhookData) });
  }
  console.log(`[Scheduling] Appointment showed for merchant ${local.merchantId}: ${local.meetingId}`);
}

/**
 * Canceled and no-show share one authority: they end ONE appointment. Only that appointment's owed obligations are
 * removed. The pointer, the stage, the outreach pause and the recovery workflow move only when the ended appointment
 * is the current meeting AND no other open appointment remains; otherwise the next open appointment becomes current.
 */
async function handleAppointmentEnded(kind: "canceled" | "no_show", webhookData: AppointmentWebhookData): Promise<void> {
  const ghlContactId = ghlContactIdOf(webhookData);
  if (!ghlContactId) return;
  const endedId = ghlAppointmentIdOf(webhookData);
  const eventType = kind === "canceled" ? "appointment_canceled" : "appointment_no_show";
  const label = kind === "canceled" ? "canceled" : "no-show";

  const { result: local } = await runReceiptTxStep(`${kind}:local`, async tx => {
    const purpose = await eventPurpose(tx, webhookData);
    await lockGhlContactPurpose(tx, ghlContactId, purpose);
    if (await ghlAppointmentSuperseded(tx, webhookData, kind)) return { outcome: "superseded" as const };
    // Obligations still owed by the deferred-enrollment recovery (held by a pause or a lost response) must not be
    // delivered for an appointment that has ended. Only THIS occurrence's obligations are cancelled (a second booking
    // is a different occurrence; an event without an identity cancels nothing), serialised with the recovery worker's
    // final dispatch so a claimed item cannot still be sent. Committed with the transition itself.
    const { cancelDeferredEnrollmentsInTx } = await import("../ghl-enrollment-recovery");
    for (const workflowKey of ["booking_confirmation", "booking_reminder_24h"]) {
      await cancelDeferredEnrollmentsInTx(tx, { ghlContactId, workflowKey, occurrenceKey: endedId });
    }
    const [merchant] = await tx.select().from(sdrMerchants).where(eq(sdrMerchants.ghlContactId, ghlContactId));
    if (!merchant) {
      await recordOrphanAppointmentEvent(tx, eventType, webhookData, ghlContactId);
      return { outcome: "orphan" as const };
    }
    if (purpose !== "sales") {
      await recordHistoryOnly(tx, merchant.id, eventType, webhookData, `Appointment ${label} on the ${purpose} calendar; the sales pipeline is unchanged`);
      return { outcome: "history" as const };
    }
    const [state] = await tx.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchant.id));
    if (state && !pointerMatches(state.meetingId, endedId)) {
      await recordHistoryOnly(tx, merchant.id, eventType, webhookData,
        `Appointment ${endedId} ${label} but the current meeting is ${state.meetingId} — its obligations were cancelled, stage and pointer unchanged`);
      return { outcome: "history" as const };
    }
    const next = await currentSalesMeeting(tx, ghlContactId);
    if (next.appointmentId) {
      await tx.update(sdrLeadState).set({
        meetingId: next.appointmentId, nextAction: "send_appointment_reminder", nextActionType: "reminder",
        nextActionPayload: { appointmentId: next.appointmentId, startTime: next.startTime, outreachPaused: true },
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.merchantId, merchant.id));
      await recordHistoryOnly(tx, merchant.id, eventType, webhookData,
        `Appointment ${endedId} ${label} — current meeting is now ${next.appointmentId}; no recovery started`);
      return { outcome: "history" as const };
    }
    const wasMeetingSet = state?.currentStage === "MEETING_SET";
    if (kind === "canceled") {
      // An explicit cancellation is not a no-show: no automatic recovery workflow, and the outreach pause is left as
      // found (it may belong to a rep or a consent decision). The lead leaves the meeting stage with an owed rep review.
      if (wasMeetingSet) {
        await tx.update(sdrLeadState).set({
          currentStage: "ENGAGED", meetingId: null, nextAction: "cancellation_rep_review", nextActionType: "task",
          nextActionAt: null, nextActionPayload: { canceledAppointmentId: endedId }, updatedAt: new Date(),
        }).where(eq(sdrLeadState.merchantId, merchant.id));
      }
      await tx.insert(sdrLeadEvents).values({
        merchantId: merchant.id, eventType, channel: "calendar", actorType: "merchant", payloadJson: webhookData, ghlRefId: endedId,
        decisionReason: `Appointment canceled — last open appointment; no recovery sequence started, outreach pause unchanged, rep review owed`,
      });
      return { outcome: "applied" as const, merchantId: merchant.id, wasMeetingSet, canceled: true };
    }
    if (wasMeetingSet) {
      await tx.update(sdrLeadState).set({
        currentStage: "ENGAGED", meetingId: null, nextAction: "no_show_recovery", nextActionType: "recovery_sequence",
        nextActionAt: new Date(Date.now() + 30 * 60_000), nextActionPayload: { canceledAppointmentId: endedId },
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.merchantId, merchant.id));
    }
    await tx.insert(sdrLeadEvents).values({
      merchantId: merchant.id, eventType, channel: "calendar", actorType: "merchant",
      payloadJson: webhookData, ghlRefId: endedId,
      decisionReason: `Appointment ${label} — last open appointment, triggered recovery sequence`,
    });
    return { outcome: "applied" as const, merchantId: merchant.id, wasMeetingSet, canceled: false };
  });
  if (local.outcome !== "applied") return;

  if (local.wasMeetingSet) {
    await runReceiptStep(`${kind}:stage_sync`, () => onStageChange(local.merchantId, "ENGAGED", "MEETING_SET"));
    if (!local.canceled) {
      const { upsertOutreachPause } = await import("./compliance-engine");
      await runReceiptStep(`${kind}:outreach_resume`, () => upsertOutreachPause(local.merchantId, false, `Outreach resumed — appointment ${label}, recovery sequence triggered`));
    }
  }
  if (local.canceled) {
    console.log(`[Scheduling] Appointment canceled for merchant ${local.merchantId}; rep review owed, no recovery workflow`);
    return;
  }
  await enrollStep(`${kind}:enroll_no_show_reschedule`, { id: local.merchantId, ghlContactId }, "no_show_reschedule",
    { canceledAppointmentId: endedId, reason: kind });

  console.log(`[Scheduling] Appointment ${label} for merchant ${local.merchantId}`);
}

export const handleAppointmentCanceled = (webhookData: AppointmentWebhookData) => handleAppointmentEnded("canceled", webhookData);
export const handleAppointmentNoShow = (webhookData: AppointmentWebhookData) => handleAppointmentEnded("no_show", webhookData);

/**
 * Updated / rescheduled appointment: re-derives the current meeting from recorded state (the transition already stored
 * the new start time) and, for a reschedule, retargets the occurrence's owed obligations: the stale 24h reminder is
 * cancelled, a pending first confirmation keeps its identity and carries the new time. It never creates another first
 * confirmation and never changes the stage.
 */
export async function handleAppointmentTimeChange(kind: "updated" | "rescheduled", webhookData: AppointmentWebhookData): Promise<void> {
  const ghlContactId = ghlContactIdOf(webhookData);
  const appointmentId = ghlAppointmentIdOf(webhookData);
  if (!ghlContactId || !appointmentId) return;
  await runReceiptTxStep("time_change:local", async tx => {
    const purpose = await eventPurpose(tx, webhookData);
    await lockGhlContactPurpose(tx, ghlContactId, purpose);
    if (kind === "rescheduled") {
      const stored = (await tx.execute(sql`SELECT start_time FROM ghl_appointment_state WHERE appointment_id = ${appointmentId}`)).rows[0] as { start_time: string | Date | null } | undefined;
      const { applyRescheduleToDeferredEnrollmentsInTx } = await import("../ghl-enrollment-recovery");
      await applyRescheduleToDeferredEnrollmentsInTx(tx, {
        ghlContactId, occurrenceKey: appointmentId, startTime: stored?.start_time ? new Date(stored.start_time).toISOString() : null,
      });
    }
    if (purpose !== "sales") return { moved: false };
    const [merchant] = await tx.select().from(sdrMerchants).where(eq(sdrMerchants.ghlContactId, ghlContactId));
    if (!merchant) return { moved: false };
    const [state] = await tx.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchant.id));
    if (!state || state.currentStage !== "MEETING_SET") return { moved: false };
    const current = await currentSalesMeeting(tx, ghlContactId);
    if (!current.appointmentId) return { moved: false };
    const prior = (state.nextActionPayload && typeof state.nextActionPayload === "object" ? state.nextActionPayload : {}) as Record<string, unknown>;
    if (current.appointmentId === state.meetingId && prior.startTime === current.startTime) return { moved: false };
    // The same appointment moved in time (or the current meeting changed): the one owed reminder is revised to the
    // recorded start, never left carrying the old time. The revision counter lets a reminder sent for the old time be told apart.
    await tx.update(sdrLeadState).set({
      meetingId: current.appointmentId, nextAction: "send_appointment_reminder", nextActionType: "reminder",
      nextActionPayload: { appointmentId: current.appointmentId, startTime: current.startTime, outreachPaused: true,
        reminderRevision: (typeof prior.reminderRevision === "number" ? prior.reminderRevision : 0) + 1 },
      updatedAt: new Date(),
    }).where(eq(sdrLeadState.merchantId, merchant.id));
    return { moved: true };
  });
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
    const reminderResult = await enrollMerchantWorkflow(merchant, "booking_reminder_24h", { meetingId: state.meetingId });
    if (!reminderResult.success) {
      console.warn(`[Scheduling] Appointment reminder suppressed for merchant ${merchantId}: ${reminderResult.error}`);
      return false;
    }

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
