/** Operator wording for the typed reasons the website email lane returns. Unknown codes are shown as the code itself. */
const REASON_LABELS: Record<string, string> = {
  CONFIG_MISSING: "The lane has no configuration yet (closed by default).",
  CONFIG_CLOSED: "The lane is closed.",
  CONFIG_REVOKED: "The lane was revoked; admitted journeys were revoked.",
  CONFIG_MALFORMED: "The stored lane configuration failed its integrity check.",
  PROGRAM_NOT_MAPPED: "No approved revision is mapped to this source and program.",
  WARM_REVISION_MISSING: "The mapped revision does not exist.",
  WARM_REVISION_NOT_APPROVED: "The mapped revision is not approved.",
  WARM_REVISION_RETIRED: "The mapped revision was retired.",
  WARM_REVISION_PROGRAM_MISMATCH: "The mapped revision belongs to a different program.",
  WARM_REVISION_HASH_DRIFT: "The mapped revision no longer matches its frozen content.",
  WARM_REVISION_HAS_UNSUPPORTED_STEPS: "The mapped revision has steps that are not email.",
  BEFORE_ELIGIBILITY_START: "The request arrived before the lane opened, so it is never admitted.",
  HELD_TOO_LONG: "The request waited past the 72 hour hold and expired.",
  CONSENT_MISSING: "No email opt-in from this request.",
  CONSENT_WITHDRAWN: "The person has opted out of email.",
  CLASS_REVIEW_PENDING: "The record class is under review.",
  CLASS_NOT_PRODUCTION: "The record is not a production contact.",
  SENDER_REPLY_PATH_UNPROVEN: "The reply path is not proven (connected mailbox and a recent reader success are required).",
  SENDER_UNAVAILABLE: "The sender account is unavailable.",
  PROVIDER_LEDGER_NOT_READY: "The message ledger in this database does not accept Gmail yet (migration 0382 has not reached it), so nothing is admitted or sent.",
  EMAIL_MISSING: "The request has no email address.",
  EMAIL_CHANGED: "The address changed after the request.",
  PRIOR_JOURNEY_EXISTS: "This person already has a journey.",
  ENROLLMENT_CONFLICT_ACTIVE: "Another active enrollment blocks this journey.",
  ENROLLMENT_CONFLICT_PAUSED: "A paused enrollment blocks this journey.",
  STALE_REVISION: "The configuration changed after you previewed it. Preview again.",
  SENDER_ACCOUNT_REQUIRED: "Choose the sender account.",
  SENDER_ACCOUNT_NOT_CONNECTED_GMAIL: "The sender account is not the connected Gmail account.",
  REPLY_ADDRESS_NOT_ACCEPTED_BY_CONNECTED_GMAIL: "The reply address is not accepted by the connected Gmail account.",
  SENDER_POLICY_UNAVAILABLE: "The sender policy for this lane is unavailable.",
  DAILY_LIMIT_REQUIRED: "Set a daily limit above zero to open the lane.",
  DAILY_LIMIT_OUT_OF_RANGE: "The daily limit must be between 0 and 500.",
  NO_PROGRAM_MAPPED: "Map at least one approved revision.",
  MAP_MALFORMED: "The source and program mapping is malformed.",
  WARM_DAILY_LIMIT: "The daily limit was reached; the next step waits for the next UTC day.",
  INBOUND_AFTER_ENTRY: "A reply or other inbound message arrived, so the journey stopped.",
  NOT_FOUND: "That item no longer exists.",
};

export function describeWebsiteEmailReason(code: string | null | undefined): string {
  if (!code) return "";
  const [head, ...rest] = code.split(":");
  const base = REASON_LABELS[head] ?? REASON_LABELS[code];
  if (!base) return code;
  return rest.length > 0 ? `${base} (${rest.join(" / ")})` : base;
}

export const WEBSITE_SOURCE_LABELS: Record<string, string> = {
  "website_form|estimate_form": "Estimate form",
  "website_form|get_started_form": "Get Started form",
  "website_form|free_analysis": "Free Analysis form",
  "website_form|newsletter_signup": "Newsletter signup",
};

export const WEBSITE_SOURCE_PROGRAMS: Record<string, string[]> = {
  "website_form|estimate_form": ["requested_followup", "nurture"],
  "website_form|get_started_form": ["requested_followup", "nurture"],
  "website_form|free_analysis": ["requested_followup", "nurture"],
  "website_form|newsletter_signup": ["nurture"],
};

export const PROGRAM_LABELS: Record<string, string> = {
  requested_followup: "Requested follow-up (answers a request the person made)",
  nurture: "Opted-in nurture (marketing, needs this request's opt-in)",
};
