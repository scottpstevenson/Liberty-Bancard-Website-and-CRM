import type { Contact } from "@shared/schema";

export type BlockedReason =
  | "global_dnc"
  | "existing_email_opt_out"
  | "existing_sms_opt_out";

export interface ConsentMergeResult {
  updates: { consentEmail?: boolean; consentSms?: boolean };
  blockedAttempts: Array<{
    channel: "email" | "sms";
    reasonCode: BlockedReason;
    attemptedValue: boolean;
    persistedValue: boolean | null;
  }>;
}

/**
 * Evaluates each consent channel independently against the existing contact's
 * persisted opt-out/DNC state.
 *
 * Rules:
 * - Channels are evaluated independently — email opt-out does not affect SMS.
 * - doNotAutoContact is NOT treated as consent withdrawal here; it gates
 *   automated sends via contactability.ts only.
 * - Absent incoming value (undefined) → no update for that channel.
 * - incoming false → permitted withdrawal; included in updates (no conflict).
 * - incoming true when contact is opted-out or global DNC → blocked; no DB
 *   change to emailStatus, smsStatus, doNotContact, or consentTier.
 */
export function mergePersistedConsentState(args: {
  existingContact: Contact;
  incomingConsent: { consentEmail?: boolean; consentSms?: boolean };
}): ConsentMergeResult {
  const { existingContact, incomingConsent } = args;
  const updates: { consentEmail?: boolean; consentSms?: boolean } = {};
  const blockedAttempts: ConsentMergeResult["blockedAttempts"] = [];

  // --- Email channel ---
  if (incomingConsent.consentEmail !== undefined) {
    const incoming = incomingConsent.consentEmail;

    let emailBlockReason: BlockedReason | null = null;
    if (existingContact.doNotContact === true) {
      emailBlockReason = "global_dnc";
    } else if (
      existingContact.emailStatus === "opted_out" ||
      existingContact.emailStatus === "unsubscribed"
    ) {
      emailBlockReason = "existing_email_opt_out";
    }

    if (emailBlockReason !== null && incoming === true) {
      blockedAttempts.push({
        channel: "email",
        reasonCode: emailBlockReason,
        attemptedValue: incoming,
        persistedValue: existingContact.consentEmail ?? null,
      });
    } else {
      updates.consentEmail = incoming;
    }
  }

  // --- SMS channel ---
  if (incomingConsent.consentSms !== undefined) {
    const incoming = incomingConsent.consentSms;

    let smsBlockReason: BlockedReason | null = null;
    if (existingContact.doNotContact === true) {
      smsBlockReason = "global_dnc";
    } else if (
      existingContact.smsStatus === "opted_out" ||
      existingContact.smsStatus === "unsubscribed" ||
      existingContact.smsStatus === "blocked"
    ) {
      smsBlockReason = "existing_sms_opt_out";
    }

    if (smsBlockReason !== null && incoming === true) {
      blockedAttempts.push({
        channel: "sms",
        reasonCode: smsBlockReason,
        attemptedValue: incoming,
        persistedValue: existingContact.consentSms ?? null,
      });
    } else {
      updates.consentSms = incoming;
    }
  }

  return { updates, blockedAttempts };
}
