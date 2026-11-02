import crypto from "crypto";
import { runFollowupEffect } from "./followup-effects";
import { bookingForPurpose, type CalendarPurpose } from "./ghl-calendar-purpose";

/**
 * Explicit provider booking command (Stage 4C2): request -> preview -> execute -> readback.
 *  - preview is read-only and returns the exact reviewed payload plus its hash;
 *  - execute binds the actor, a command UUID, the expected resource version and the reviewed payload hash, is DENIED unless
 *    the owner has enabled the writer, and writes a durable receipt BEFORE the provider call (a lost response resolves from
 *    the receipt, never by sending again);
 *  - `toNotify` is always set explicitly from the owner contract (default false: no native message is implied by the
 *    calendar write); availability validation stays on and no ignore-slot/date-range bypass is ever sent;
 *  - success is confirmed only by a provider readback of the appointment id.
 * Cancel is a status change on the provider appointment; local history is never hard-deleted to represent it.
 */
export type BookingOperation = "create" | "reschedule" | "cancel";

export interface BookingRequest {
  operation: BookingOperation;
  purpose: CalendarPurpose;
  ghlContactId: string;
  startTimeIso?: string;
  endTimeIso?: string;
  title?: string;
  appointmentId?: string; // required for reschedule/cancel
  notifyContact?: boolean; // owner contract; default false
}

export type BookingPreview =
  | { ok: true; operation: BookingOperation; method: "POST" | "PUT"; path: string; payload: Record<string, unknown>; payloadHash: string }
  | { ok: false; reason: string };

const FORBIDDEN_PAYLOAD_KEYS = ["ignoreDateRange", "ignoreFreeSlotValidation", "ignoreFreeSlot"];

export function previewBookingCommand(req: BookingRequest, env: Record<string, string | undefined> = process.env): BookingPreview {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(req.ghlContactId)) return { ok: false, reason: "invalid_contact" };
  const booking = bookingForPurpose(req.purpose, env);
  if (!booking.available) return { ok: false, reason: `${req.purpose}_calendar_unavailable:${booking.reason}` };
  if (req.operation !== "create" && !(req.appointmentId && /^[A-Za-z0-9_-]{1,128}$/.test(req.appointmentId))) return { ok: false, reason: "appointment_id_required" };
  const toNotify = req.notifyContact === true;
  let payload: Record<string, unknown>;
  if (req.operation === "cancel") {
    payload = { calendarId: booking.calendarId, contactId: req.ghlContactId, appointmentStatus: "cancelled", toNotify };
  } else {
    const start = req.startTimeIso ? Date.parse(req.startTimeIso) : NaN;
    const end = req.endTimeIso ? Date.parse(req.endTimeIso) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { ok: false, reason: "invalid_interval" };
    payload = {
      calendarId: booking.calendarId, contactId: req.ghlContactId,
      startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString(),
      title: (req.title ?? "Appointment").slice(0, 120), toNotify,
    };
  }
  for (const key of FORBIDDEN_PAYLOAD_KEYS) if (key in payload) return { ok: false, reason: "bypass_not_allowed" };
  const method = req.operation === "create" ? "POST" : "PUT";
  const path = req.operation === "create" ? "/calendars/events/appointments" : `/calendars/events/appointments/${req.appointmentId}`;
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify({ method, path, payload })).digest("hex");
  return { ok: true, operation: req.operation, method, path, payload, payloadHash };
}

export interface BookingProvider {
  write(method: "POST" | "PUT", path: string, body: Record<string, unknown>): Promise<any>;
  readAppointment(appointmentId: string): Promise<{ found: boolean; status?: string } | null>;
}

export interface BookingExecuteInput {
  actorId: string; commandId: string; expectedVersion: number | null; reviewedPayloadHash: string;
  request: BookingRequest; writerEnabled: boolean; provider: BookingProvider;
}
export type BookingExecuteResult =
  | { state: "denied"; reason: string }
  | { state: "confirmed" | "unconfirmed" | "unknown" | "refused"; replay: boolean; appointmentId?: string; reason?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function executeBookingCommand(input: BookingExecuteInput, env: Record<string, string | undefined> = process.env): Promise<BookingExecuteResult> {
  if (!input.writerEnabled) return { state: "denied", reason: "booking_writer_not_enabled" };
  if (!UUID.test(input.commandId)) return { state: "denied", reason: "command_id_must_be_uuid_v4" };
  const preview = previewBookingCommand(input.request, env);
  if (!preview.ok) return { state: "denied", reason: preview.reason };
  if (preview.payloadHash !== input.reviewedPayloadHash) return { state: "denied", reason: "payload_changed_since_preview" };
  let appointmentId = input.request.appointmentId;
  const outcome = await runFollowupEffect(
    { effectKey: `booking_command:${input.actorId}:${input.commandId}`, ownerKind: "booking_command", ownerId: input.commandId,
      // Reschedule/cancel name their appointment in the channel so the Calendar can show a pending or unknown command
      // before the provider answered; a create is linkable only once accepted (its id is the receipt detail).
      channel: `calendar_${preview.operation}${input.request.appointmentId ? `:${input.request.appointmentId}` : ""}` },
    async () => {
      const response = await input.provider.write(preview.method, preview.path, preview.payload);
      appointmentId = appointmentId ?? (typeof response?.id === "string" ? response.id : response?.appointment?.id);
      return { success: true, detail: appointmentId };
    });
  if (outcome.state === "accepted" && outcome.replay && outcome.detail) appointmentId = outcome.detail;
  if (outcome.state === "unknown") return { state: "unknown", replay: outcome.replay, appointmentId, reason: outcome.detail ?? "prior_dispatch_outcome_unknown" };
  if (outcome.state === "refused") return { state: "refused", replay: outcome.replay, reason: outcome.detail };
  // Readback: only the provider's own record confirms the write.
  if (!appointmentId) return { state: "unconfirmed", replay: outcome.replay, reason: "no_appointment_id_to_read_back" };
  const read = await input.provider.readAppointment(appointmentId).catch(() => null);
  const confirmed = !!read?.found && (preview.operation !== "cancel" || /cancel/i.test(read.status ?? ""));
  return confirmed ? { state: "confirmed", replay: outcome.replay, appointmentId } : { state: "unconfirmed", replay: outcome.replay, appointmentId, reason: "readback_did_not_confirm" };
}
