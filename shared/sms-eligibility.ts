// Pure, framework-free SMS eligibility check shared by the Call Outcome UI
// and its regression tests. This is a UX/proactive-gating helper only — the
// backend /api/call-follow-ups/send route re-checks phone/consent itself and
// remains the final authority on whether an SMS actually sends.
export type SmsEligibilityContactInput = {
  phone?: string | null;
  consentSms?: boolean | null;
} | null | undefined;

export type SmsEligibilityResult = {
  eligible: boolean;
  checking: boolean;
  reason: string;
};

export function computeSmsEligibility(params: {
  selectedContactId: string;
  contactsLoading: boolean;
  contact: SmsEligibilityContactInput;
}): SmsEligibilityResult {
  const { selectedContactId, contactsLoading, contact } = params;

  if (!selectedContactId) {
    return { eligible: false, checking: false, reason: "Select a contact first." };
  }
  if (contactsLoading || !contact) {
    return { eligible: false, checking: true, reason: "Checking SMS eligibility…" };
  }
  if (!contact.phone) {
    return { eligible: false, checking: false, reason: "SMS unavailable — no phone number on file." };
  }
  if (contact.consentSms !== true) {
    return { eligible: false, checking: false, reason: "SMS unavailable — SMS consent is not recorded." };
  }
  return { eligible: true, checking: false, reason: "" };
}
