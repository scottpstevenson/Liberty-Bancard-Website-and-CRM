import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { BUSINESS_TIMEZONE } from "@shared/business-time";
import { pool } from "../db";
import { authorizeCommercialUse } from "./commercial-resolution";
import { BOOKING_CONFIRMATION_SMS_PURPOSE, normalizeConsentPhone } from "./consent-authority";
import { denyCro03OrCro08aForbiddenEffect } from "./cro03/cro08a-effect-fence";
import { runFollowupEffect, type EffectSendResult } from "./followup-effects";
import { getLatestAttestation } from "./ghl-channel-probes";
import { resolveSalesBooking } from "./message-cta-contract";
import { deregisterInflight, registerInflight } from "./outbound-control-service";
import { getPauseState, recheckSeedLeaseEpoch } from "./outbound-pause-authority";
import { resolveSmsRecipient } from "./sms-recipient-authority";

const EFFECT_KIND = "ghl_booking_confirmation";
const GHL_API = "https://services.leadconnectorhq.com";
const dateTime = z.string().datetime({ offset: true });
const usPhone = /^\+1[2-9]\d{9}$/;
const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIMEZONE, month: "short", day: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
});

type Booking = {
  appointment_id: string;
  ghl_contact_id: string;
  request_id: string;
  booking_start_time: Date;
};

function senderConfig() {
  const sales = resolveSalesBooking(process.env);
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN?.trim();
  const locationId = process.env.GHL_LOCATION_ID?.trim();
  const fromNumber = process.env.GHL_BOOKING_CONFIRMATION_SMS_FROM?.trim() ?? "";
  const campaign = process.env.GHL_BOOKING_CONFIRMATION_SMS_CAMPAIGN_ID?.trim() ?? "";
  const activation = dateTime.safeParse(process.env.GHL_BOOKING_CONFIRMATION_SMS_ENABLED_AT);
  if (!sales.available || !token || !locationId || !usPhone.test(fromNumber)
    || !/^[a-z0-9_-]{1,64}$/i.test(campaign) || !activation.success) return null;
  return {
    token, locationId, fromNumber, calendarId: sales.calendarId, enabledAt: activation.data,
    attestationKey: `ghl_booking_confirmation_a2p:${locationId}:${fromNumber}:${campaign}`,
  };
}
type SenderConfig = NonNullable<ReturnType<typeof senderConfig>>;

async function readBoundRecipient(config: SenderConfig, booking: Booking) {
  const { rows } = await pool.query<{ id: number; phone: string; consented_phone: string | null }>(`
    SELECT c.id, c.phone, e.consented_phone
    FROM ghl_booking_sms_consent_checks q
    JOIN ghl_appointment_state a ON a.appointment_id = q.appointment_id
    JOIN inbound_requests r ON r.id = q.request_id AND r.source_type = 'appointment_booked'
      AND r.occurrence_key = 'ghl:appointment_booked:' || a.appointment_id
      AND r.lifecycle_state <> 'cancelled'
    JOIN consent_audit_logs e ON e.id = q.consent_event_id AND e.record_kind = 'canonical_fact'
      AND e.channel = 'sms' AND e.purpose = $5 AND e.consented
      AND e.event_namespace = 'verified_ghl_booking_form' AND e.event_key = q.submission_id
      AND e.evidence->>'appointmentId' = a.appointment_id AND e.evidence->>'submissionId' = q.submission_id
    JOIN contacts c ON c.id = e.contact_id AND c.ghl_contact_id = a.ghl_contact_id
      AND (r.contact_id IS NULL OR r.contact_id = c.id)
    WHERE q.appointment_id = $1 AND q.request_id = $2 AND a.ghl_contact_id = $3
      AND q.state = 'opted_in' AND a.status = 'booked'
      AND a.start_time = q.booking_start_time AND a.start_time = $4::timestamptz
      AND a.location_id = $6 AND a.calendar_id = $7
      AND q.booking_created_at >= $8::timestamptz
      AND a.start_time > now() AND q.booking_created_at > now() - interval '30 minutes'
      AND c.record_class = 'production' AND c.archived_at IS NULL
      AND c.do_not_contact IS NOT TRUE AND c.do_not_auto_contact IS NOT TRUE
      AND NOT EXISTS (
        SELECT 1 FROM contacts other WHERE other.ghl_contact_id = a.ghl_contact_id
          AND other.record_class = 'production' AND other.archived_at IS NULL AND other.id <> c.id
      )
  `, [
    booking.appointment_id, booking.request_id, booking.ghl_contact_id, booking.booking_start_time,
    BOOKING_CONFIRMATION_SMS_PURPOSE, config.locationId, config.calendarId, config.enabledAt,
  ]);
  const recipient = rows[0];
  if (!recipient) return null;
  const phone = normalizeConsentPhone(recipient.phone);
  if (!phone || !usPhone.test(phone) || normalizeConsentPhone(recipient.consented_phone) !== phone) return null;
  const result = await resolveSmsRecipient({
    contactId: recipient.id, purpose: "booking_confirmation", boundPhone: phone,
    commercialPurpose: "transactional_response", transactionalConsentPurpose: BOOKING_CONFIRMATION_SMS_PURPOSE,
  });
  return result.allowed ? result : null;
}

const appointmentShape = z.object({
  id: z.string(), locationId: z.string(), contactId: z.string(), calendarId: z.string(),
  appointmentStatus: z.literal("confirmed"), startTime: dateTime, deleted: z.literal(false).optional(),
});
const appointmentResponse = z.union([
  z.object({ appointment: appointmentShape }).transform(value => value.appointment),
  z.object({ event: appointmentShape }).transform(value => value.event),
]);
const contactResponse = z.object({
  contact: z.object({
    id: z.string(), locationId: z.string(), phone: z.string(),
    dnd: z.literal(false).optional(),
    dndSettings: z.record(z.string(), z.object({ status: z.string() })).nullish(),
  }),
});

async function providerMatches(config: SenderConfig, booking: Booking, phone: string) {
  const get = async (path: string, version: string) => {
    const response = await fetch(GHL_API + path, {
      headers: { Authorization: `Bearer ${config.token}`, Version: version },
      redirect: "error", signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("ghl_booking_verification_read_failed");
    return response.json();
  };
  const [appointmentResult, contactResult] = await Promise.all([
    get(`/calendars/events/appointments/${encodeURIComponent(booking.appointment_id)}`, "v3"),
    get(`/contacts/${encodeURIComponent(booking.ghl_contact_id)}`, "2021-07-28"),
  ]);
  const appointment = appointmentResponse.safeParse(appointmentResult).data;
  const remote = contactResponse.safeParse(contactResult).data?.contact;
  return appointment?.id === booking.appointment_id && appointment.locationId === config.locationId
    && appointment.contactId === booking.ghl_contact_id && appointment.calendarId === config.calendarId
    && Date.parse(appointment.startTime) === booking.booking_start_time.getTime()
    && remote?.id === booking.ghl_contact_id && remote.locationId === config.locationId
    && normalizeConsentPhone(remote.phone) === phone
    && !Object.entries(remote.dndSettings ?? {}).some(([key, value]) =>
      key.toLowerCase() === "sms" && value.status.toLowerCase() !== "inactive");
}

async function dispatch(config: SenderConfig, booking: Booking, phone: string, message: string): Promise<EffectSendResult> {
  try {
    const response = await fetch(GHL_API + "/conversations/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json", Version: "v3" },
      body: JSON.stringify({
        type: "SMS", status: "pending", fromNumber: config.fromNumber, toNumber: phone,
        contactId: booking.ghl_contact_id, appointmentId: booking.appointment_id, message,
      }),
      redirect: "error", signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return { success: false, error: response.status >= 500 || [408, 409].includes(response.status)
        ? `GHL_AMBIGUOUS_DISPATCH: booking confirmation HTTP ${response.status}`
        : `booking_confirmation_http_${response.status}` };
    }
    const result: { messageId?: unknown } | null = await response.json();
    if (typeof result?.messageId === "string" && result.messageId.trim()) {
      return { success: true, detail: result.messageId };
    }
    return { success: false, error: "GHL_AMBIGUOUS_DISPATCH: booking confirmation response missing message ID" };
  } catch {
    return { success: false, error: "GHL_AMBIGUOUS_DISPATCH: booking confirmation response unavailable" };
  }
}

async function processBooking(config: SenderConfig, booking: Booking) {
  const recipient = await readBoundRecipient(config, booking);
  if (!recipient || !await providerMatches(config, booking, recipient.phone)) return "held";
  const message = `Liberty Bancard: Your sales call is confirmed for ${formatter.format(booking.booking_start_time)}. Check your email for meeting details. Reply STOP to opt out.`;
  const result = await runFollowupEffect({
    ownerKind: EFFECT_KIND, ownerId: booking.appointment_id, channel: "sms",
    effectKey: `${EFFECT_KIND}:${booking.appointment_id}:sms`,
    requestFingerprint: createHash("sha256")
      .update(JSON.stringify([config.locationId, config.fromNumber, booking.ghl_contact_id, recipient.phone, message]))
      .digest("hex"),
  }, async () => {
    const refuse = (error: string) => ({ success: false, error });
    await denyCro03OrCro08aForbiddenEffect("sms");
    // The enabled, appointment-bound receipt lane is independent of cold outreach.
    const pause = await getPauseState();
    if (pause.source !== "database" || pause.state === "activating") return refuse("pause_authority_unavailable");
    const sendToken = randomUUID();
    await registerInflight(sendToken, pause.epoch);
    try {
      const commercial = await authorizeCommercialUse({
        subjectType: "contact", subjectId: recipient.contactId,
        effect: "inbound_transactional_acknowledgement", inboundRequestId: booking.request_id,
        intendedRecipientId: recipient.contactId,
      });
      if (!commercial.effectiveDecision.allowed) return refuse("commercial_authority_denied");
      const current = await readBoundRecipient(config, booking);
      if (current?.contactId !== recipient.contactId || current.phone !== recipient.phone) {
        return refuse("recipient_or_booking_changed");
      }
      if (process.env.GHL_BOOKING_CONFIRMATION_SMS_ENABLED !== "true"
        || !await getLatestAttestation(config.attestationKey)) return refuse("booking_confirmation_authority_changed");
      if (!await recheckSeedLeaseEpoch(pause.epoch)) return refuse("pause_epoch_changed");
      return await dispatch(config, booking, recipient.phone, message);
    } finally {
      deregisterInflight(sendToken);
    }
  });
  return result.state;
}

/** Run after consent reconciliation. Receipts fence all further writes once a send attempt is recorded. */
export async function processGhlBookingConfirmationSms() {
  if (process.env.GHL_BOOKING_CONFIRMATION_SMS_ENABLED !== "true") return { state: "disabled" };
  const config = senderConfig();
  if (!config) return { state: "unconfigured" };
  if (!await getLatestAttestation(config.attestationKey)) return { state: "carrier_approval_required" };

  // Rotate held checks to the end of the queue. The durable send receipt owns
  // deduplication, even if a read lease expires before the attempt settles.
  const { rows } = await pool.query<Booking>(`
    WITH due AS (
      SELECT q.appointment_id, a.ghl_contact_id
      FROM ghl_booking_sms_consent_checks q
      JOIN ghl_appointment_state a ON a.appointment_id = q.appointment_id
      WHERE q.state = 'opted_in' AND q.next_check_at <= now()
        AND q.booking_created_at >= $1::timestamptz
        AND q.booking_created_at BETWEEN now() - interval '30 minutes' AND now()
        AND a.location_id = $2 AND a.calendar_id = $3 AND a.ghl_contact_id IS NOT NULL
        AND a.status = 'booked' AND a.start_time = q.booking_start_time AND a.start_time > now()
        AND NOT EXISTS (
          SELECT 1 FROM followup_effect_receipts r
          WHERE r.effect_key = 'ghl_booking_confirmation:' || q.appointment_id || ':sms'
        )
      ORDER BY q.next_check_at, q.appointment_id LIMIT 10
      FOR UPDATE OF q SKIP LOCKED
    )
    UPDATE ghl_booking_sms_consent_checks q SET next_check_at = now() + interval '1 minute'
    FROM due WHERE q.appointment_id = due.appointment_id
    RETURNING q.appointment_id, due.ghl_contact_id, q.request_id, q.booking_start_time
  `, [config.enabledAt, config.locationId, config.calendarId]);

  const counts = { accepted: 0, refused: 0, unknown: 0, held: 0, errors: 0 };
  for (const booking of rows) {
    try {
      counts[await processBooking(config, booking)]++;
    } catch {
      counts.errors++;
    }
  }
  return { state: "active", checked: rows.length, ...counts };
}
