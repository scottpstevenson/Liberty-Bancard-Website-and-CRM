import crypto from "crypto";
import { runFollowupEffect, EffectBindingConflictError } from "./followup-effects";
import { bookingForPurpose, type CalendarPurpose } from "./ghl-calendar-purpose";

/**
 * Explicit provider booking command (Stage 4C2): request -> preview -> execute -> readback.
 *  - preview is read-only and returns the exact reviewed payload plus its hash;
 *  - execute binds the actor, a command UUID, the expected resource version and the reviewed payload hash, is DENIED unless
 *    the owner has enabled the writer, and writes a durable receipt BEFORE the provider call (a lost response resolves from
 *    the receipt, never by sending again);
 *  - `toNotify` is always set explicitly from the owner contract (default false: no native message is implied by the
 *    calendar write); availability validation stays on and no ignore-slot/date-range bypass is ever sent;
 *  - reschedule/cancel require the reviewed resource version; inside the receipt (before the provider write) the live
 *    appointment must exist on the purpose calendar at exactly that version, else the command is refused without any write;
 *  - success is confirmed only by a provider readback that matches the requested operation (times for create/reschedule,
 *    a cancelled status for cancel), never by the mere existence of the appointment id.
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
  | { ok: true; operation: BookingOperation; method: "POST" | "PUT"; path: string; payload: Record<string, unknown>; locationId: string; payloadHash: string }
  | { ok: false; reason: string };

const FORBIDDEN_PAYLOAD_KEYS = ["ignoreDateRange", "ignoreFreeSlotValidation", "ignoreFreeSlot"];

export function previewBookingCommand(req: BookingRequest, env: Record<string, string | undefined> = process.env): BookingPreview {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(req.ghlContactId)) return { ok: false, reason: "invalid_contact" };
  const booking = bookingForPurpose(req.purpose, env);
  if (!booking.available) return { ok: false, reason: `${req.purpose}_calendar_unavailable:${booking.reason}` };
  const locationId = (env.GHL_LOCATION_ID ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(locationId)) return { ok: false, reason: "location_unavailable" };
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
    // A create names its location in the provider payload; reschedule/cancel address an appointment id whose location is
    // verified from the provider record. The location is part of the reviewed fingerprint either way.
    if (req.operation === "create") payload.locationId = locationId;
  }
  for (const key of FORBIDDEN_PAYLOAD_KEYS) if (key in payload) return { ok: false, reason: "bypass_not_allowed" };
  const method = req.operation === "create" ? "POST" : "PUT";
  const path = req.operation === "create" ? "/calendars/events/appointments" : `/calendars/events/appointments/${req.appointmentId}`;
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify({ method, path, locationId, payload })).digest("hex");
  return { ok: true, operation: req.operation, method, path, payload, locationId, payloadHash };
}

export interface BookingProvider {
  write(method: "POST" | "PUT", path: string, body: Record<string, unknown>): Promise<any>;
  /** `version` is the provider's last-update time in epoch ms; it is the reviewed resource version for reschedule/cancel. */
  readAppointment(appointmentId: string): Promise<ProviderAppointment | null>;
}

export interface ProviderAppointment {
  found: boolean; id?: string; status?: string; calendarId?: string; contactId?: string; locationId?: string;
  startTime?: string; endTime?: string; version?: number | null;
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
  if (preview.operation !== "create" && !(typeof input.expectedVersion === "number" && Number.isFinite(input.expectedVersion))) {
    return { state: "denied", reason: "expected_version_required" };
  }
  if (preview.payloadHash !== input.reviewedPayloadHash) return { state: "denied", reason: "payload_changed_since_preview" };
  let appointmentId = input.request.appointmentId;
  // The receipt key is bound to the whole reviewed intent (payload hash, location and expected version): reusing a command
  // id for a different intent is refused before any provider I/O.
  const requestFingerprint = crypto.createHash("sha256").update(`${preview.payloadHash}:${input.expectedVersion ?? "none"}`).digest("hex");
  let outcome;
  try {
    outcome = await runFollowupEffect(
    { effectKey: `booking_command:${input.actorId}:${input.commandId}`, ownerKind: "booking_command", ownerId: input.commandId, requestFingerprint,
      // Reschedule/cancel name their appointment in the channel so the Calendar can show a pending or unknown command
      // before the provider answered; a create is linkable only once accepted (its id is the receipt detail).
      channel: `calendar_${preview.operation}${input.request.appointmentId ? `:${input.request.appointmentId}` : ""}` },
    async () => {
      if (preview.operation !== "create") {
        // Resource/version precondition, checked against the provider's own record immediately before the write.
        const live = await input.provider.readAppointment(input.request.appointmentId!).catch(() => null);
        if (!live) return { success: false, error: "precondition_unreadable" };
        if (!live.found) return { success: false, error: "appointment_not_found" };
        if (!live.calendarId || live.calendarId !== preview.payload.calendarId) return { success: false, error: "appointment_on_other_calendar" };
        if (!live.contactId || live.contactId !== input.request.ghlContactId) return { success: false, error: "appointment_belongs_to_other_contact" };
        if (!live.locationId || live.locationId !== preview.locationId) return { success: false, error: "appointment_in_other_location" };
        if (typeof live.version !== "number" || live.version !== input.expectedVersion) return { success: false, error: "stale_expected_version" };
      }
      const response = await input.provider.write(preview.method, preview.path, preview.payload);
      appointmentId = appointmentId ?? (typeof response?.id === "string" ? response.id : response?.appointment?.id);
      return { success: true, detail: appointmentId };
    });
  } catch (error) {
    if (error instanceof EffectBindingConflictError) return { state: "denied", reason: "command_id_bound_to_different_request" };
    throw error;
  }
  if (outcome.state === "accepted" && outcome.replay && outcome.detail) appointmentId = outcome.detail;
  if (outcome.state === "unknown") return { state: "unknown", replay: outcome.replay, appointmentId, reason: outcome.detail ?? "prior_dispatch_outcome_unknown" };
  if (outcome.state === "refused") return { state: "refused", replay: outcome.replay, reason: outcome.detail };
  // Readback: only the provider's own record confirms the write.
  if (!appointmentId) return { state: "unconfirmed", replay: outcome.replay, reason: "no_appointment_id_to_read_back" };
  const read = await input.provider.readAppointment(appointmentId).catch(() => null);
  const sameInstant = (a?: string, b?: unknown) => {
    const x = a ? Date.parse(a) : NaN, y = typeof b === "string" ? Date.parse(b) : NaN;
    return Number.isFinite(x) && Number.isFinite(y) && x === y;
  };
  // Exact identity AND content: the record read back must name the same appointment, calendar, location and contact as the
  // command, and carry the requested time (or cancelled status). A field the provider did not return is unconfirmed,
  // never assumed to match.
  const sameIdentity = !!read?.found
    && read.id === appointmentId
    && !!read.calendarId && read.calendarId === preview.payload.calendarId
    && !!read.locationId && read.locationId === preview.locationId
    && !!read.contactId && read.contactId === input.request.ghlContactId;
  const matchesRequest = sameIdentity
    && (preview.operation === "cancel"
      ? /cancel/i.test(read!.status ?? "")
      : sameInstant(read!.startTime, preview.payload.startTime) && sameInstant(read!.endTime, preview.payload.endTime)
        && !/cancel/i.test(read!.status ?? ""));
  const confirmed = matchesRequest;
  return confirmed ? { state: "confirmed", replay: outcome.replay, appointmentId } : { state: "unconfirmed", replay: outcome.replay, appointmentId, reason: "readback_did_not_confirm" };
}
