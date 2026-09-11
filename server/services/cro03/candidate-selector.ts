/**
 * MI-05: Candidate pre-projection filter — placeholder rejection.
 *
 * Enforces the split rule:
 *  - Always reject (synthetic/invalid): noreply@, bounce@, postmaster@, mailer-daemon@,
 *    donotreply@, test@, example@, and disposable domains.
 *  - Accept as org-level email (subject_type='business'): info@, support@, contact@,
 *    hello@, sales@, admin@, billing@ — valid organization inboxes.
 *  - Reject as person-level Apollo email (subject_type='person'): any role-based
 *    address — Apollo person reveals returning generic inboxes indicate a
 *    failed reveal, not a valid owner email.
 *
 * MI-06 builds the full winner-selection service; this module owns only
 * the pre-projection filter needed by MI-05's projectBusinessEnrichmentFields().
 */

// ── Synthetic/invalid addresses — rejected for ALL subject types ───────────────

const SYNTHETIC_LOCAL_PARTS = new Set([
  "noreply", "no-reply", "donotreply", "do-not-reply",
  "bounce", "mailer-daemon", "postmaster", "abuse",
  "test", "example", "nobody", "null", "devnull", "spam",
]);

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com",
  "throwam.com", "trashmail.com", "yopmail.com", "tempmail.com",
  "dispostable.com", "sharklasers.com", "guerrillamailblock.com",
  "grr.la", "guerrillamail.info", "spam4.me", "fakeinbox.com",
]);

// ── Role-based addresses — valid for businesses, NOT for person reveals ────────

const ROLE_LOCAL_PARTS = new Set([
  "info", "support", "contact", "hello", "sales", "admin",
  "billing", "help", "enquiries", "enquiry", "general",
  "office", "team", "care", "service", "services",
]);

// ── Public API ─────────────────────────────────────────────────────────────────

export type EmailRejectionReason =
  | "synthetic_address"
  | "disposable_domain"
  | "role_address_rejected_for_person"
  | null;

/**
 * Returns null if the email passes, or a rejection reason string if it fails.
 * Call before writing candidate evidence or before projection.
 *
 * @param email      Normalized (lowercase, trimmed) email address.
 * @param subjectType 'business' or 'person' (Apollo reveal).
 */
export function rejectEmailCandidate(
  email: string,
  subjectType: "business" | "person",
): EmailRejectionReason {
  const lower = email.toLowerCase().trim();
  const atIdx = lower.indexOf("@");
  if (atIdx <= 0) return "synthetic_address";
  const local = lower.slice(0, atIdx);
  const domain = lower.slice(atIdx + 1);

  // Always reject: synthetic/invalid local parts.
  if (SYNTHETIC_LOCAL_PARTS.has(local)) return "synthetic_address";

  // Always reject: disposable domains.
  if (DISPOSABLE_DOMAINS.has(domain)) return "disposable_domain";

  // Always reject: non-FQDN domains.
  if (!domain.includes(".")) return "synthetic_address";

  // Role-based split:
  if (ROLE_LOCAL_PARTS.has(local)) {
    // Accept for business-level candidates (valid org inbox).
    if (subjectType === "business") return null;
    // Reject for person-level reveals — indicates a failed Apollo reveal.
    return "role_address_rejected_for_person";
  }

  return null;
}

/**
 * Returns true if the email should be accepted for the given subject type.
 */
export function isEmailCandidateAccepted(
  email: string,
  subjectType: "business" | "person",
): boolean {
  return rejectEmailCandidate(email, subjectType) === null;
}
