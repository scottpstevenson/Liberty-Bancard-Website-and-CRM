import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "../db";
import { ghlBookingSmsConsentChecks } from "@shared/schema";
import { applyConsentCommand, BOOKING_CONFIRMATION_SMS_PURPOSE, normalizeConsentPhone } from "./consent-authority";
import { resolveSalesBooking } from "./message-cta-contract";

const LIBERTY_SALES_FORM_ID = "5u9f8xIZZCjSFSLTBx8j";
const DISCLOSURE_VERSION = "liberty-sales-booking-sms-2026-11-23";
const DISCLOSURE = "I agree to receive automated appointment confirmation texts from Liberty Bancard at the mobile number above. Message frequency: one confirmation text per opted-in appointment. This is optional and is not required to book or buy services. Message and data rates may apply. Reply STOP to opt out or HELP for help.";
const DISCLOSURE_HASH = createHash("sha256").update(DISCLOSURE).digest("hex");
const MATCH_WINDOW_MS = 5 * 60_000;
const RETRY_WINDOW_MS = 30 * 60_000;
const PAGE_SIZE = 20;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type QueueRow = {
  appointment_id: string; request_id: string; booking_created_at: Date;
  booking_start_time: Date; ghl_contact_id: string; contact_id: number | null;
  calendar_id: string; location_id: string; status: string; current_start_time: Date;
};

const id = z.string().min(1).max(200);
const dateTime = z.string().datetime({ offset: true });
const formsResponse = z.object({
  submissions: z.array(z.object({
    id, contactId: id, formId: id, createdAt: dateTime,
    others: z.object({
      internalSource: z.object({ type: z.string(), id }).optional(),
      location_id: id.optional(),
      selected_slot: dateTime.optional(),
      phone: z.string().max(64).optional(),
      terms_and_conditions: z.string().max(4000).nullish(),
    }),
  })).max(PAGE_SIZE),
});
type BookingProof =
  | { state: "pending" | "review_required"; reason: string }
  | { state: "opted_in" | "not_opted_in"; submission: z.infer<typeof formsResponse>["submissions"][number] };

export async function queueGhlBookingConsentCheck(tx: Tx, input: {
  appointmentId: string; requestId: string; createdAt: string; startTime: string;
}) {
  await tx.insert(ghlBookingSmsConsentChecks).values({
    appointmentId: input.appointmentId, requestId: input.requestId,
    bookingCreatedAt: new Date(input.createdAt), bookingStartTime: new Date(input.startTime),
  }).onConflictDoNothing();
}

async function findSubmission(row: QueueRow, token: string, formId: string): Promise<BookingProof> {
  const query = new URLSearchParams({
    locationId: row.location_id, formId, q: row.ghl_contact_id, limit: String(PAGE_SIZE),
    startAt: new Date(row.booking_created_at.getTime() - MATCH_WINDOW_MS).toISOString().slice(0, 10),
    endAt: new Date(row.booking_created_at.getTime() + MATCH_WINDOW_MS + 86_400_000).toISOString().slice(0, 10),
  });
  const result = await fetch(`https://services.leadconnectorhq.com/forms/submissions?${query}`, {
    headers: { Authorization: `Bearer ${token}`, Version: "v3" },
    signal: AbortSignal.timeout(6000),
  });
  if (!result.ok) throw new Error("GHL_BOOKING_FORMS_READ_FAILED");
  const { submissions } = formsResponse.parse(await result.json());
  if (submissions.length === PAGE_SIZE) return { state: "review_required", reason: "submission_search_full" } as const;
  const matches = submissions.filter(submission => {
    const fields = submission.others;
    return submission.formId === formId && submission.contactId === row.ghl_contact_id
      && fields.internalSource?.type === "calendars" && fields.internalSource.id === row.calendar_id
      && fields.location_id === row.location_id
      && Date.parse(fields.selected_slot ?? "") === row.booking_start_time.getTime()
      && Math.abs(Date.parse(submission.createdAt) - row.booking_created_at.getTime()) <= MATCH_WINDOW_MS;
  });
  if (matches.length === 0) return { state: "pending", reason: "form_submission_not_visible" } as const;
  if (matches.length !== 1) return { state: "review_required", reason: "ambiguous_form_submissions" } as const;
  const submission = matches[0];
  const disclosure = submission.others.terms_and_conditions?.trim();
  if (disclosure !== DISCLOSURE) {
    return disclosure?.includes("automated appointment confirmation texts")
      ? { state: "review_required", reason: "unrecognized_booking_disclosure" } as const
      : { state: "not_opted_in", submission } as const;
  }
  return { state: "opted_in", submission } as const;
}

async function settle(row: QueueRow, proof: BookingProof) {
  return db.transaction(async tx => {
    const check = (await tx.execute(sql`SELECT q.state, a.status, a.start_time
      FROM ghl_booking_sms_consent_checks q JOIN ghl_appointment_state a ON a.appointment_id=q.appointment_id
      WHERE q.appointment_id=${row.appointment_id} FOR UPDATE OF q FOR SHARE OF a`)).rows[0];
    if (check?.state !== "pending") return;
    let state: string = proof.state;
    let reason: string | null = "reason" in proof ? proof.reason : null;
    let submissionId: string | null = null;
    let eventId: number | null = null;
    if (check.status !== "booked" || new Date(check.start_time as string).getTime() !== row.booking_start_time.getTime()) {
      state = "cancelled";
      reason = "booking_changed";
    } else if ("submission" in proof) {
      const { submission } = proof;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"ghl:booking-form:" + submission.id},0))`);
      const used = (await tx.execute(sql`SELECT 1 FROM ghl_booking_sms_consent_checks WHERE submission_id=${submission.id}`)).rows.length;
      if (used) {
        state = "review_required";
        reason = "submission_already_matched";
      } else if (proof.state === "opted_in") {
        const linked = (await tx.execute(sql`SELECT c.id,c.phone FROM contacts c
          WHERE c.ghl_contact_id=${row.ghl_contact_id} AND c.record_class='production' AND c.archived_at IS NULL
          ORDER BY c.id LIMIT 2 FOR SHARE`)).rows;
        const phone = normalizeConsentPhone(submission.others.phone);
        if (linked.length !== 1 || (row.contact_id !== null && Number(linked[0].id) !== row.contact_id)) {
          state = "pending";
          reason = "contact_not_uniquely_linked";
        } else if (!phone || phone !== normalizeConsentPhone(linked[0].phone as string | null)) {
          state = "review_required";
          reason = "phone_does_not_match";
        } else {
          const command = await applyConsentCommand({
            subject: { type: "contact", id: Number(linked[0].id) },
            kind: "opt_in", channel: "sms", purpose: BOOKING_CONFIRMATION_SMS_PURPOSE,
            eventNamespace: "verified_ghl_booking_form", eventKey: submission.id,
            source: "ghl_sales_booking_form", effectiveAt: new Date(submission.createdAt),
            evidence: { consentedPhone: phone, disclosureVersion: DISCLOSURE_VERSION, disclosureHash: DISCLOSURE_HASH,
              appointmentId: row.appointment_id, formId: submission.formId, submissionId: submission.id },
          }, { transaction: tx, beforeWrite: async () => {} });
          eventId = command.eventId;
          submissionId = submission.id;
          if (command.recordKind !== "canonical_fact") {
            state = "review_required";
            reason = command.reasonCode ?? "existing_suppression";
          }
        }
      } else {
        submissionId = submission.id;
      }
    }
    if (state === "pending" && Date.now() - row.booking_created_at.getTime() > RETRY_WINDOW_MS) {
      state = "review_required";
    }
    await tx.execute(sql`UPDATE ghl_booking_sms_consent_checks
      SET state=${state},reason=${reason},submission_id=${submissionId},consent_event_id=${eventId},
        next_check_at=now()+interval '1 minute',updated_at=now()
      WHERE appointment_id=${row.appointment_id}`);
    if (eventId !== null) {
      await tx.execute(sql`UPDATE inbound_requests
        SET consent_evidence_refs=coalesce(consent_evidence_refs,'{}'::jsonb)
          || jsonb_build_object('bookingConfirmationSms',jsonb_build_object('eventId',${eventId}::integer,'state',${state}::text)),
          updated_at=now() WHERE id=${row.request_id}::uuid`);
    }
  });
}

/** Called by the existing recovery tick. All provider access in this path is read-only. */
export async function processGhlBookingConsentChecks() {
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN?.trim();
  const locationId = process.env.GHL_LOCATION_ID?.trim();
  const sales = resolveSalesBooking(process.env);
  if (!token || !locationId || !sales.available) return { checked: 0, configured: false };
  const formId = process.env.GHL_BOOKING_CONSENT_FORM_ID?.trim() || LIBERTY_SALES_FORM_ID;
  const result = await pool.query<QueueRow>(`SELECT q.appointment_id,q.request_id,q.booking_created_at,q.booking_start_time,
      a.ghl_contact_id,r.contact_id,a.calendar_id,a.location_id,a.status,a.start_time AS current_start_time
    FROM ghl_booking_sms_consent_checks q JOIN ghl_appointment_state a ON a.appointment_id=q.appointment_id
    JOIN inbound_requests r ON r.id=q.request_id
    WHERE q.state='pending' AND q.next_check_at<=now() AND a.location_id=$1 AND a.calendar_id=$2
    ORDER BY q.next_check_at LIMIT 10`, [locationId, sales.calendarId]);
  for (const row of result.rows) {
    if (row.status !== "booked" || row.current_start_time?.getTime() !== row.booking_start_time.getTime()) {
      await settle(row, { state: "review_required", reason: "booking_changed" });
      continue;
    }
    const proof = await findSubmission(row, token, formId)
      .catch(() => ({ state: "pending", reason: "provider_read_unavailable" } as const));
    await settle(row, proof);
  }
  return { checked: result.rowCount ?? 0, configured: true };
}
