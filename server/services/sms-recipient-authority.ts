/**
 * SMS recipient authority — the single answer to "may this text go to this person at this number for this purpose, now?"
 *
 * Consent comes only from the canonical consent authority (per-channel projections, global suppression, PEWC evidence)
 * and the contactability gate built on it. The legacy `consent_sms`, `opted_out_sms` and lead phone fields are
 * compatibility outputs and never grant permission here. The number is the contact's current phone; permission that was
 * captured for a different number, or a number that changed after the decision was made, never authorizes the send.
 *
 * Every SMS must pass this immediately before provider I/O (after receipt claim and pause authorization) so a STOP or a
 * number change that lands between an earlier check and the dispatch is honored.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { normalizeConsentPhone } from "./consent-authority";

export type SmsDenialCode =
  | "contact_not_found"
  | "no_phone"
  | "recipient_number_changed"
  | "consent_withdrawn"
  | "global_suppressed"
  | "consent_not_recorded"
  | "consent_not_bound_to_number"
  | "contactability_blocked"
  | "quiet_hours"
  | "provider_target_unverified"
  | "provider_number_mismatch";

/**
 * A denial that clears by itself with time; every other denial is a standing "no" for this recipient and number.
 * `provider_target_unverified` (the provider's number could not be read) is a transport-identity gap: nothing was sent
 * and it may clear, so it is transient, never an invented consent withdrawal.
 */
export const SMS_TRANSIENT_DENIAL_CODES: ReadonlySet<SmsDenialCode> = new Set<SmsDenialCode>(["quiet_hours", "provider_target_unverified"]);

/**
 * Denials about WHERE the provider would text, not about permission. They are not consent refusals: the recipient is
 * held for review (state "unknown") rather than recorded as a permanent "no".
 */
export const SMS_TRANSPORT_IDENTITY_CODES: ReadonlySet<SmsDenialCode> = new Set<SmsDenialCode>(["provider_number_mismatch"]);

export interface SmsRecipientInput {
  contactId: number;
  /** Why the text is being sent (workflow template, statement request ...). Recorded in the contactability audit trail. */
  purpose: string;
  /** SDR lead whose own consent subject must also permit the text (statement and proposal follow-ups). */
  leadStateId?: number;
  /**
   * The number the decision was made for. When present it must still be the contact's current number, so a number
   * change between decision and dispatch is refused instead of texting someone who never consented.
   */
  boundPhone?: string | null;
  commercialPurpose?: "marketing_outreach" | "transactional_response";
  inboundRequestId?: string;
  intendedRecipientContactId?: number;
  /** Test seam for quiet hours; production callers omit it. */
  currentTime?: Date;
}

export type SmsRecipientResolution =
  | { allowed: true; contactId: number; phone: string }
  | { allowed: false; code: SmsDenialCode; reason: string; transient: boolean };

const deny = (code: SmsDenialCode, reason: string): SmsRecipientResolution =>
  ({ allowed: false, code, reason, transient: SMS_TRANSIENT_DENIAL_CODES.has(code) });

/** Provider-boundary error text: `sms_not_permitted:<code>` lets callers separate standing denials from retryable ones. */
export function smsDenialDetail(resolution: Extract<SmsRecipientResolution, { allowed: false }>): string {
  return `sms_not_permitted:${resolution.code}`;
}

const KNOWN_SMS_DENIAL_CODES: ReadonlySet<string> = new Set<SmsDenialCode>([
  "contact_not_found", "no_phone", "recipient_number_changed", "consent_withdrawn", "global_suppressed",
  "consent_not_recorded", "consent_not_bound_to_number", "contactability_blocked", "quiet_hours",
  "provider_target_unverified", "provider_number_mismatch",
]);

/** An unrecognized code is `null`-coded unknown, never silently treated as a permanent refusal. */
export function parseSmsDenialDetail(detail: string | undefined | null):
  { code: SmsDenialCode; transient: boolean; transportIdentity: boolean } | null {
  const match = /^sms_not_permitted:([a-z_]+)/.exec(detail ?? "");
  if (!match || !KNOWN_SMS_DENIAL_CODES.has(match[1])) return null;
  const code = match[1] as SmsDenialCode;
  return { code, transient: SMS_TRANSIENT_DENIAL_CODES.has(code), transportIdentity: SMS_TRANSPORT_IDENTITY_CODES.has(code) };
}

interface SubjectRestriction {
  subject_type: string;
  normalized_phone: string | null;
  sms_state: string | null;
  sms_evidence: any;
  globally_suppressed: boolean;
}

export async function resolveSmsRecipient(input: SmsRecipientInput): Promise<SmsRecipientResolution> {
  const commercialPurpose = input.commercialPurpose ?? "marketing_outreach";
  const contactRow = ((await db.execute(sql`SELECT id, phone FROM contacts WHERE id = ${input.contactId}`)) as any).rows?.[0];
  if (!contactRow) return deny("contact_not_found", "Contact not found");
  const currentPhone = normalizeConsentPhone(contactRow.phone);
  if (!currentPhone || currentPhone.replace(/\D/g, "").length < 7) return deny("no_phone", "No valid phone number on file");

  if (input.boundPhone !== undefined && input.boundPhone !== null) {
    const bound = normalizeConsentPhone(input.boundPhone);
    if (bound !== currentPhone) {
      return deny("recipient_number_changed", "The number this text was prepared for is no longer the contact's number");
    }
  }

  // Canonical restrictions on the contact subject and, when a lead is the actor, on the lead subject too: a STOP recorded
  // against either one ends SMS for this purpose.
  const leadStateId = input.leadStateId ?? -1;
  const subjects = ((await db.execute(sql`
    SELECT s.subject_type, s.normalized_phone,
           (SELECT cs.permission_state FROM consent_subject_channel_states cs
             WHERE cs.subject_id = s.id AND cs.channel = 'sms' AND cs.purpose = 'outreach') AS sms_state,
           (SELECT cs.evidence FROM consent_subject_channel_states cs
             WHERE cs.subject_id = s.id AND cs.channel = 'sms' AND cs.purpose = 'outreach') AS sms_evidence,
           COALESCE((SELECT g.is_suppressed FROM consent_subject_global_suppressions g WHERE g.subject_id = s.id), false) AS globally_suppressed
      FROM consent_subjects s
     WHERE (s.subject_type = 'contact' AND s.subject_record_id = ${input.contactId})
        OR (s.subject_type = 'sdr_lead_state' AND s.subject_record_id = ${leadStateId})
  `)) as any).rows as SubjectRestriction[] ?? [];
  for (const subject of subjects) {
    if (subject.globally_suppressed) return deny("global_suppressed", "Recipient is globally suppressed");
    if (subject.sms_state === "withdrawn" || subject.sms_state === "suppressed") {
      return deny("consent_withdrawn", `Canonical SMS permission is ${subject.sms_state}`);
    }
  }

  if (commercialPurpose === "marketing_outreach") {
    // Full gate: DNC, STOP projection, PEWC tier and evidence, number validity, feature flag, quiet hours.
    const { evaluateContactability } = await import("./contactability");
    const decision = await evaluateContactability({
      contactId: input.contactId,
      channel: "sms",
      campaignType: input.purpose,
      mode: "enforcement",
      commercialPurpose,
      currentTime: input.currentTime,
    });
    if (!decision.allowed) {
      return deny(/quiet hours/i.test(decision.reason) ? "quiet_hours" : "contactability_blocked", decision.reason);
    }
    // PEWC must be for the number we are about to text, not for a number the contact used to have.
    const evidence = ((await db.execute(sql`
      SELECT consented_phone FROM consent_audit_logs
       WHERE contact_id = ${input.contactId} AND consented = true AND consent_type = 'express_written'
         AND consented_phone IS NOT NULL
       ORDER BY created_at DESC LIMIT 50
    `)) as any).rows as Array<{ consented_phone: string }> ?? [];
    if (!evidence.some(row => normalizeConsentPhone(row.consented_phone) === currentPhone)) {
      return deny("consent_not_bound_to_number", "SMS consent was not captured for the contact's current number");
    }
    return { allowed: true, contactId: input.contactId, phone: currentPhone };
  }

  // Transactional responses to an inbound request: the contact subject must hold a positive SMS permission.
  const contactSubject = subjects.find(subject => subject.subject_type === "contact");
  if (!contactSubject || contactSubject.sms_state !== "permitted") {
    return deny("consent_not_recorded", "No canonical SMS permission is recorded for this contact");
  }
  const evidencePhone = normalizeConsentPhone(
    typeof contactSubject.sms_evidence?.consentedPhone === "string" ? contactSubject.sms_evidence.consentedPhone : null);
  // Positive evidence of the number the permission covers is required: a permission recorded before any number existed
  // must not extend to a number added later.
  const permittedFor = evidencePhone ?? normalizeConsentPhone(contactSubject.normalized_phone);
  if (!permittedFor || permittedFor !== currentPhone) {
    return deny("consent_not_bound_to_number", "SMS permission is not recorded for the contact's current number");
  }
  return { allowed: true, contactId: input.contactId, phone: currentPhone };
}

/** Throws `sms_not_permitted:<code>` unless the recipient may be texted now; for provider senders outside ghl.ts. */
export async function assertSmsRecipientAllowed(input: SmsRecipientInput): Promise<string> {
  const resolution = await resolveSmsRecipient(input);
  if (!resolution.allowed) throw new Error(smsDenialDetail(resolution));
  return resolution.phone;
}
