import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { contacts, deals } from "@shared/schema";
import { configuredAppointmentCalendarIds, ghlAppointmentSuperseded } from "./ghl-appointment-events";
import { calendarPurposeOf } from "./ghl-calendar-purpose";
import { resolveSalesBooking } from "./message-cta-contract";
import { runReceiptTxStep } from "./ghl-webhook-effects";
import { claimVerifiedProviderEvent, settleVerifiedBookingProjection } from "./inbound-request-authority";
import { enqueueTeamIntakeAlert } from "./team-intake-alerts";
import { queueGhlBookingConsentCheck } from "./ghl-booking-consent";

export interface VerifiedBooking {
  appointmentId: string;
  contactId: string;
  calendarId: string | null;
  locationId: string | null;
  eventAt: string;
  startTime?: string;
  opportunityId?: string;
}

/** Called after the signed receipt owns the one-time booked transition. No provider work starts here. */
export async function projectVerifiedGhlBooking(booking: VerifiedBooking, legacyPayload?: Record<string, unknown>) {
  const claim = await claimVerifiedProviderEvent({
    sourceType: "appointment_booked",
    eventId: booking.appointmentId,
    payload: legacyPayload ?? booking,
  });
  if (claim.outcome !== "claimed" && claim.outcome !== "replay") {
    throw new Error("VERIFIED_PROVIDER_EVENT_CLAIM_CONFLICT");
  }

  return (await runReceiptTxStep("booked:crm_projection", async tx => {
    const requestId = claim.request.id;
    if (await ghlAppointmentSuperseded(tx, booking, "booked")) {
      await settleVerifiedBookingProjection(tx, requestId, { contactId: null, dealId: null }, "BOOKING_SUPERSEDED");
      return { requestId, outcome: "superseded" };
    }
    const [contact] = await tx.select({ id: contacts.id, businessId: contacts.businessId }).from(contacts)
      .where(and(eq(contacts.ghlContactId, booking.contactId), eq(contacts.recordClass, "production"), isNull(contacts.archivedAt)))
      .limit(1).for("share");

    const sales = resolveSalesBooking(process.env);
    const eligibleSalesCalendar = booking.calendarId !== null && calendarPurposeOf(booking.calendarId) === "sales"
      && ((sales.available && sales.calendarId === booking.calendarId) || configuredAppointmentCalendarIds().includes(booking.calendarId));
    const candidates = contact && eligibleSalesCalendar ? await tx.select({ id: deals.id }).from(deals)
      .where(and(eq(deals.contactId, contact.id), eq(deals.pipeline, "sales"), eq(deals.recordClass, "production"),
        isNull(deals.archivedAt), isNull(deals.closedAt), notInArray(deals.stage, ["Closed Won", "Closed Lost"]),
        booking.opportunityId ? eq(deals.ghlOpportunityId, booking.opportunityId) : undefined))
      .orderBy(deals.id).limit(2).for("share") : [];
    const dealId = candidates.length === 1 ? candidates[0].id : null;
    const reviewReason = !contact ? "BOOKING_CONTACT_UNVERIFIED"
      : eligibleSalesCalendar && !dealId ? "BOOKING_SALES_DEAL_UNRESOLVED"
      : eligibleSalesCalendar && !contact.businessId ? "BOOKING_BUSINESS_UNLINKED" : null;
    await settleVerifiedBookingProjection(tx, requestId, { contactId: contact?.id ?? null, dealId }, reviewReason);
    if (eligibleSalesCalendar) {
      await enqueueTeamIntakeAlert(tx, "ghl_booking", requestId);
      if (booking.startTime) {
        await queueGhlBookingConsentCheck(tx, {
          appointmentId: booking.appointmentId, requestId, createdAt: booking.eventAt, startTime: booking.startTime,
        });
      }
    }
    if (contact && dealId && !reviewReason) {
      await tx.execute(sql`SELECT phase7_emit_conversion(
        'ghl_appointment_booked', ${booking.appointmentId}, 'engaged', ${contact.id}, ${dealId},
        ${booking.eventAt}::timestamptz, '{"source":"ghl_webhook"}'::jsonb
      )`);
    }
    return { requestId, outcome: reviewReason ? "review_required" : "recorded" };
  })).result;
}
