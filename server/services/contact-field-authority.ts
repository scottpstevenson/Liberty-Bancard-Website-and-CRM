/**
 * Shared generic-contact field fence. These projections have dedicated
 * authorities and must never be silently accepted by generic writers.
 */
export const CONTACT_AUTHORITY_OWNED_FIELDS = [
  "recordClass",
  // Commercial graph compatibility projections are authority-only.
  "businessId", "isDecisionMaker", "decisionMakerConfidence",
  // Provider-validation state is written only by the generation-fenced
  // validation authority; it must never be forgeable through a generic edit.
  "emailTokenHash", "emailMutationGeneration", "emailValidationUpdatedAt",
  "consentEmail", "consentSms", "consentTier", "leadConsentLevel", "smsConsentStatus",
  "doNotContact", "doNotAutoContact",
  "emailStatus", "emailReadiness", "smsStatus", "phoneStatus",
  "optOutStatus", "optOutDate", "optOutChannel",
  "unsubscribeStatus", "unsubscribeDate",
  "dncReason", "dncDate", "dncSource",
  "suppressionReason", "suppressionHistory",
  "bounceStatus", "bouncedAt", "bounceDate", "bounceReason",
  "complaintStatus", "complaintDate", "nextAllowedContactDate", "consentAuditTrail",
] as const;

export type ContactAuthorityOwnedField = typeof CONTACT_AUTHORITY_OWNED_FIELDS[number];

export class ContactProtectedFieldError extends Error {
  readonly code = "CONTACT_PROTECTED_FIELD";
  constructor(readonly fields: readonly string[]) {
    super(`Generic contact mutation cannot write authority-owned field(s): ${fields.join(", ")}`);
    this.name = "ContactProtectedFieldError";
  }
}

export function protectedContactFields(input: Record<string, unknown>): ContactAuthorityOwnedField[] {
  return CONTACT_AUTHORITY_OWNED_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(input, field),
  );
}

export function assertNoProtectedContactFields(input: Record<string, unknown>): void {
  const fields = protectedContactFields(input);
  if (fields.length) throw new ContactProtectedFieldError(fields);
}

/** Legacy creation payloads may contain default-valued authority projections. */
export function stripContactAuthorityFields<T extends Record<string, unknown>>(input: T): Omit<T, ContactAuthorityOwnedField> {
  const result = { ...input } as Record<string, unknown>;
  for (const field of CONTACT_AUTHORITY_OWNED_FIELDS) delete result[field];
  return result as Omit<T, ContactAuthorityOwnedField>;
}