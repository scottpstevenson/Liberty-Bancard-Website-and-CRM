import crypto from "crypto";
import { pool } from "../db";
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
  /** Test seam only: lets a certification hold a request between its durable intent record and its receipt claim. */
  hooks?: { afterIntentRecorded?: () => Promise<void> };
}
export type BookingExecuteResult =
  | { state: "denied"; reason: string; blockingCommandId?: string }
  | { state: "confirmed" | "unconfirmed" | "unknown" | "refused"; replay: boolean; appointmentId?: string; reason?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


/** The reviewed bindings a trusted confirmation compares against. Provider contact ids are server-side only. */
export interface BookingIntent {
  operation: BookingOperation; calendarId: string; locationId: string; ghlContactId: string;
  startTime?: string; endTime?: string; appointmentId?: string; payloadHash: string; expectedVersion: number | null; purpose: string;
}

/**
 * Exact identity AND content: the record read back must name the same appointment, calendar, location and contact as the
 * command, and carry the requested time (or cancelled status). A field the provider did not return is unconfirmed, never
 * assumed to match. Raw provider readability alone is never confirmation.
 */
export function readbackConfirms(read: ProviderAppointment | null | undefined, appointmentId: string,
  expect: { operation: BookingOperation; calendarId: string; locationId: string; ghlContactId: string; startTime?: string; endTime?: string }): boolean {
  const sameInstant = (a?: string, b?: unknown) => {
    const x = a ? Date.parse(a) : NaN, y = typeof b === "string" ? Date.parse(b) : NaN;
    return Number.isFinite(x) && Number.isFinite(y) && x === y;
  };
  const sameIdentity = !!read?.found && read.id === appointmentId
    && !!read.calendarId && read.calendarId === expect.calendarId
    && !!read.locationId && read.locationId === expect.locationId
    && !!read.contactId && read.contactId === expect.ghlContactId;
  if (!sameIdentity) return false;
  if (expect.operation === "cancel") return /cancel/i.test(read!.status ?? "");
  return sameInstant(read!.startTime, expect.startTime) && sameInstant(read!.endTime, expect.endTime) && !/cancel/i.test(read!.status ?? "");
}

const RECOVERY_WINDOW_DAYS = 30;
const IN_FLIGHT_GRACE_SECONDS = 120;

/** Durable, server-side record of what was reviewed and executed (no secrets; provider ids stay server-side). */
async function recordBookingIntent(client: { query: (q: string, v?: unknown[]) => Promise<any> }, commandId: string, actorId: string, intent: BookingIntent) {
  const exists = await client.query(
    `SELECT 1 FROM audit_logs WHERE action = 'booking_command_intent' AND entity_type = 'booking_command' AND entity_key = $1 LIMIT 1`, [commandId]);
  if (exists.rows[0]) return;
  await client.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_key, details, actor_type, actor_id)
     VALUES ($1, 'booking_command_intent', 'booking_command', $2, $3::jsonb, 'user', $1)`, [actorId, commandId, JSON.stringify(intent)]);
}

export async function recordBookingResolution(commandId: string, actorId: string, action: "booking_command_confirmed" | "booking_command_resolved", details: Record<string, unknown>) {
  await pool.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_key, details, actor_type, actor_id)
     VALUES ($1, $2, 'booking_command', $3, $4::jsonb, 'user', $1)`, [actorId, action, commandId, JSON.stringify(details)]);
}

/**
 * A create that was started but never confirmed, refused or explicitly resolved blocks any replacement create by the same
 * actor. Different command ids do not deduplicate the same human intent, so the block is keyed on the actor.
 */
async function findUnresolvedCreate(client: { query: (q: string, v?: unknown[]) => Promise<any> }, actorId: string, exceptCommandId: string): Promise<string | null> {
  const row = (await client.query(
    `SELECT i.entity_key FROM audit_logs i
      WHERE i.action = 'booking_command_intent' AND i.entity_type = 'booking_command' AND i.user_id = $1
        AND i.details->>'operation' = 'create' AND i.entity_key <> $2
        AND i.created_at > now() - ($3::int * interval '1 day')
        AND NOT EXISTS (SELECT 1 FROM audit_logs r WHERE r.entity_type = 'booking_command' AND r.entity_key = i.entity_key
                          AND r.action IN ('booking_command_confirmed', 'booking_command_resolved'))
        AND NOT EXISTS (SELECT 1 FROM followup_effect_receipts f WHERE f.owner_kind = 'booking_command' AND f.owner_id = i.entity_key AND f.state = 'refused')
      LIMIT 1`, [actorId, exceptCommandId, RECOVERY_WINDOW_DAYS])).rows[0];
  return row ? String(row.entity_key) : null;
}

export type BookingConfirmation = "confirmed" | "mismatch" | "unreadable" | "no_reviewed_intent" | "not_applicable";
export interface BookingReconciliation {
  commandId: string; operation: string | null; appointmentId: string | null;
  state: "accepted" | "refused" | "unknown" | "started"; confirmation: BookingConfirmation; resolved: boolean;
  attempts: number; startedAt: unknown; settledAt: unknown; provider: unknown; sent: false;
}

/** Read-only reconcile of one command. null = not observed (no receipt, or not visible to this actor). Never sends or settles. */
export async function reconcileBookingCommand(commandId: string, actor: { id: string; role: string }, readAppointment: (id: string) => Promise<ProviderAppointment | null>): Promise<BookingReconciliation | null> {
  const row = (await pool.query(
    `SELECT effect_key, channel, state, detail, attempt_count, created_at, settled_at FROM followup_effect_receipts
      WHERE owner_kind = 'booking_command' AND owner_id = $1 ORDER BY created_at DESC LIMIT 1`, [commandId])).rows[0];
  if (!row || (actor.role !== "admin" && !String(row.effect_key).startsWith(`booking_command:${actor.id}:`))) return null;
  const [, operation, namedAppointment] = String(row.channel).match(/^calendar_([a-z]+)(?::(.+))?$/) ?? [];
  const appointmentId = namedAppointment ?? (row.state === "accepted" ? row.detail : null);
  const audit = (await pool.query(
    `SELECT action, details FROM audit_logs WHERE entity_type = 'booking_command' AND entity_key = $1 ORDER BY id DESC`, [commandId])).rows;
  const intent = audit.find((a: any) => a.action === "booking_command_intent")?.details as BookingIntent | undefined;
  const resolved = audit.some((a: any) => a.action === "booking_command_resolved" || a.action === "booking_command_confirmed");
  let provider: unknown = { checked: false };
  let live: ProviderAppointment | null = null;
  if (appointmentId && /^[A-Za-z0-9_-]{1,128}$/.test(appointmentId)) {
    live = await readAppointment(appointmentId).catch(() => null);
    provider = live ? { checked: true, ...live } : { checked: false, reason: "provider_unreadable" };
  }
  let confirmation: BookingConfirmation = "not_applicable";
  if (row.state === "accepted") {
    if (!intent) confirmation = "no_reviewed_intent";
    else if (!live) confirmation = "unreadable";
    else confirmation = readbackConfirms(live, appointmentId!, intent) ? "confirmed" : "mismatch";
    if (confirmation === "confirmed" && !resolved) {
      await recordBookingResolution(commandId, actor.id, "booking_command_confirmed", { via: "status_readback", appointmentId }).catch(() => undefined);
    }
  }
  return {
    commandId, operation: operation ?? null, appointmentId: appointmentId ?? null,
    state: row.state === "accepted" ? "accepted" : row.state === "refused" ? "refused" : row.state === "started" ? "started" : "unknown",
    confirmation, resolved: resolved || confirmation === "confirmed", attempts: row.attempt_count ?? 1, startedAt: row.created_at, settledAt: row.settled_at, provider, sent: false,
  };
}

export type BookingResolutionResult = { ok: true } | { ok: false; status: number; reason: string };

/**
 * Explicit, recorded operator resolution for a command that trusted reconciliation cannot settle. "not_created" on a
 * command with no receipt writes a fence receipt so a delayed original request can never claim it afterwards; it is
 * refused while a receipt says accepted, or started within the in-flight grace period. Nothing is ever sent here.
 */
export async function resolveBookingCommand(commandId: string, actorId: string, resolution: "not_created" | "created_verified", note: string): Promise<BookingResolutionResult> {
  const effectKey = `booking_command:${actorId}:${commandId}`;
  const row = (await pool.query(
    `SELECT state, created_at, EXTRACT(EPOCH FROM (now() - created_at)) AS age FROM followup_effect_receipts WHERE effect_key = $1`, [effectKey])).rows[0];
  if (row?.state === "refused") return { ok: false, status: 409, reason: "already_refused" };
  if (row?.state === "started" && Number(row.age) < IN_FLIGHT_GRACE_SECONDS) return { ok: false, status: 409, reason: "still_in_flight" };
  if (resolution === "not_created" && row?.state === "accepted") return { ok: false, status: 409, reason: "receipt_says_accepted" };
  if (resolution === "created_verified" && !row) return { ok: false, status: 409, reason: "no_receipt_to_verify" };
  if (resolution === "not_created" && !row) {
    // Fence: a refused receipt bound to a fingerprint no real request can produce. The original request then fails its
    // claim with a binding conflict, before any provider I/O.
    await pool.query(
      `INSERT INTO followup_effect_receipts (effect_key, owner_kind, owner_id, channel, state, detail, request_fingerprint, settled_at)
       VALUES ($1, 'booking_command', $2, 'calendar_create', 'refused', 'operator_resolved_not_created', $3, now()) ON CONFLICT (effect_key) DO NOTHING`,
      [effectKey, commandId, `operator_fence:${commandId}`]);
    const check = (await pool.query(`SELECT state FROM followup_effect_receipts WHERE effect_key = $1`, [effectKey])).rows[0];
    if (check?.state !== "refused") return { ok: false, status: 409, reason: "command_started_concurrently" };
  }
  await recordBookingResolution(commandId, actorId, "booking_command_resolved", { resolution, note: note.slice(0, 300), receiptState: row?.state ?? "none" });
  return { ok: true };
}

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
  // Durable reviewed intent BEFORE any claim or provider I/O, serialized per actor with the unresolved-create check, so a
  // replacement create cannot start while an earlier one is neither confirmed, refused nor explicitly resolved. A record
  // that cannot be written is a denial with no provider call.
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`booking_create:${input.actorId}`]);
      const blocking = preview.operation === "create" ? await findUnresolvedCreate(client, input.actorId, input.commandId) : null;
      if (blocking) {
        await client.query("ROLLBACK");
        return { state: "denied", reason: "unresolved_prior_create", blockingCommandId: blocking };
      }
      await recordBookingIntent(client, input.commandId, input.actorId, {
        operation: preview.operation, calendarId: String(preview.payload.calendarId), locationId: preview.locationId, ghlContactId: input.request.ghlContactId,
        startTime: preview.payload.startTime as string | undefined, endTime: preview.payload.endTime as string | undefined,
        appointmentId: input.request.appointmentId, payloadHash: preview.payloadHash, expectedVersion: input.expectedVersion, purpose: input.request.purpose,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  } catch {
    return { state: "denied", reason: "intent_record_unavailable" };
  }
  if (input.hooks?.afterIntentRecorded) await input.hooks.afterIntentRecorded();
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
  const confirmed = readbackConfirms(read, appointmentId, {
    operation: preview.operation, calendarId: String(preview.payload.calendarId), locationId: preview.locationId,
    ghlContactId: input.request.ghlContactId, startTime: preview.payload.startTime as string | undefined, endTime: preview.payload.endTime as string | undefined,
  });
  if (confirmed) await recordBookingResolution(input.commandId, input.actorId, "booking_command_confirmed", { via: "execute_readback", appointmentId }).catch(() => undefined);
  return confirmed ? { state: "confirmed", replay: outcome.replay, appointmentId } : { state: "unconfirmed", replay: outcome.replay, appointmentId, reason: "readback_did_not_confirm" };
}
