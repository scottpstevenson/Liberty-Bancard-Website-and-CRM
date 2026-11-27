import { z } from "zod";
import { pool } from "../db";
import { normalizeAppointmentStatus, recordGhlAppointmentEvent } from "./ghl-appointment-events";
import { resolveSalesBooking } from "./message-cta-contract";

const BATCH_SIZE = 8;

const appointmentSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  calendarId: z.string(),
  contactId: z.string(),
  appointmentStatus: z.string(),
  dateUpdated: z.string().datetime({ offset: true }),
});
const responseSchema = z.union([
  z.object({ appointment: appointmentSchema }).transform(result => result.appointment),
  z.object({ event: appointmentSchema }).transform(result => result.event),
]);

async function readAppointment(id: string, token: string) {
  try {
    const response = await fetch(`https://services.leadconnectorhq.com/calendars/events/appointments/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}`, Version: "v3" },
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok ? responseSchema.safeParse(await response.json()).data : undefined;
  } catch {
    return undefined;
  }
}

/** Recover missed cancellations through the same ordered transition as the webhook. */
export async function reconcileGhlBookingCancellations(cursor = "") {
  const sales = resolveSalesBooking(process.env);
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN?.trim();
  const locationId = process.env.GHL_LOCATION_ID?.trim();
  if (!sales.available || !token || !locationId) return { state: "unconfigured" as const, cursor: "" };

  const { rows } = await pool.query<{ appointment_id: string; ghl_contact_id: string }>(`
    SELECT appointment_id, ghl_contact_id
    FROM ghl_appointment_state
    WHERE appointment_id > $1 AND location_id = $2 AND calendar_id = $3
      AND ghl_contact_id IS NOT NULL AND status IN ('booked','updated','rescheduled')
      AND start_time >= now() - interval '7 days'
    ORDER BY appointment_id
    LIMIT $4
  `, [cursor, locationId, sales.calendarId, BATCH_SIZE]);

  const outcomes = await Promise.all(rows.map(async row => {
    const appointment = await readAppointment(row.appointment_id, token);
    if (!appointment || appointment.id !== row.appointment_id || appointment.contactId !== row.ghl_contact_id
      || appointment.locationId !== locationId || appointment.calendarId !== sales.calendarId) return "unverified";
    if (normalizeAppointmentStatus(appointment.appointmentStatus) !== "canceled") return "unchanged";

    const { applied } = await recordGhlAppointmentEvent({
      kind: "canceled",
      payload: appointment,
      allowedLocationId: locationId,
      allowedCalendarIds: [sales.calendarId],
    });
    return applied ? "canceled" : "unchanged";
  }));

  return {
    state: "active" as const,
    checked: rows.length,
    canceled: outcomes.filter(outcome => outcome === "canceled").length,
    unverified: outcomes.filter(outcome => outcome === "unverified").length,
    cursor: rows.length === BATCH_SIZE ? rows[BATCH_SIZE - 1].appointment_id : "",
  };
}
