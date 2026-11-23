import type { RequestHandler } from "express";
import { z } from "zod";
import { acceptGhlAppointmentTransition, normalizeAppointmentStatus } from "../services/ghl-appointment-events";
import { resolveSalesBooking } from "../services/message-cta-contract";
import { validateGhlWebhookSignatureEd25519 } from "../services/ghl";
import { projectVerifiedGhlBooking } from "../services/ghl-booking-projection";
import { ghlWebhookReceiptMiddleware } from "../services/ghl-webhook-receipts";
import { serverError } from "../utils/server-error";

const providerId = z.string().min(1).max(200);
const providerTime = z.string().datetime({ offset: true });
const appointmentCreated = z.object({
  type: z.literal("AppointmentCreate"),
  locationId: providerId,
  appointment: z.object({
    id: providerId,
    calendarId: providerId,
    contactId: providerId,
    appointmentStatus: z.string(),
    dateAdded: providerTime,
    startTime: providerTime,
    endTime: providerTime.optional(),
  }),
});
const marketplaceReceipt = ghlWebhookReceiptMiddleware("marketplace-appointment-create");

/** Dispatches the Marketplace event on the existing GHL webhook URL. */
export const handleMarketplaceBooking: RequestHandler = async (req, res, next) => {
  if (req.body?.type !== "AppointmentCreate") return next();

  const signature = req.get("x-ghl-signature");
  if (!signature || !Buffer.isBuffer(req.rawBody)) {
    return res.status(401).json({ received: false, error: "signed_raw_body_required" });
  }
  if (!(process.env.GHL_WEBHOOK_SIGNATURE_PUBLIC_KEY || process.env.GHL_WEBHOOK_PUBLIC_KEY)?.trim()) {
    return res.status(503).json({ received: false, error: "signing_key_not_configured" });
  }
  if (!validateGhlWebhookSignatureEd25519(req.rawBody.toString("utf8"), signature)) {
    return res.status(401).json({ received: false, error: "invalid_signature" });
  }
  const parsed = appointmentCreated.safeParse(req.body);
  if (!parsed.success) return res.status(422).json({ received: false, error: "invalid_appointment" });

  const event = parsed.data;
  const sales = resolveSalesBooking(process.env);
  const locationId = process.env.GHL_LOCATION_ID?.trim();
  if (!locationId || !sales.available) {
    return res.status(503).json({ received: false, error: "booking_scope_not_configured" });
  }
  if (event.locationId !== locationId || event.appointment.calendarId !== sales.calendarId
    || normalizeAppointmentStatus(event.appointment.appointmentStatus) !== "booked") {
    return res.json({ received: true, applied: false, reason: "outside_booking_scope" });
  }

  // The Marketplace envelope's dateAdded is the creation time, even on redelivery.
  const booking = {
    appointmentId: event.appointment.id,
    contactId: event.appointment.contactId,
    calendarId: event.appointment.calendarId,
    locationId,
    eventAt: event.appointment.dateAdded,
    startTime: event.appointment.startTime,
  };
  return marketplaceReceipt(req, res, async () => {
    try {
      const verdict = await acceptGhlAppointmentTransition({
        kind: "booked",
        payload: {
          ...booking,
          dateAdded: booking.eventAt,
          startTime: event.appointment.startTime,
          endTime: event.appointment.endTime,
        },
        allowedLocationId: locationId,
        allowedCalendarIds: [sales.calendarId],
      });
      if (verdict.decision === "rejected") {
        return res.status(422).json({ received: false, error: verdict.reason });
      }
      if (verdict.decision !== "apply") return res.json({ received: true, applied: false, reason: verdict.decision });

      // HighLevel's calendar workflow owns confirmations. This event writes CRM evidence only.
      const projection = await projectVerifiedGhlBooking(booking);
      return res.json({ received: true, applied: true, outcome: projection.outcome });
    } catch (error) {
      return serverError(res, error, "ghl_marketplace_booking");
    }
  });
};
