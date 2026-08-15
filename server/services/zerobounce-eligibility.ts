/**
 * Canonical ZeroBounce eligibility predicates + helpers (task #1540A).
 *
 * Extracted from server/routes/contacts.ts in #1541 so the durable BullMQ
 * campaign worker can share them without importing the whole route module.
 * server/routes/contacts.ts re-exports everything here to preserve existing
 * import paths (including scripts/test-zerobounce-batch-filter.ts).
 *
 * #1533 changed contacts.email_status default from 'active' to 'unvalidated'.
 * Every filter that selects contacts needing validation MUST use these
 * constants — do not hand-write the predicate anywhere else.
 */

export const UNVALIDATED_EMAIL_PREDICATE =
  `(email_status IS NULL OR email_status IN ('active', 'unvalidated'))`;

// Eligibility filter for ZeroBounce candidates: non-blank real addresses only.
// Excludes synthetic placeholders written by CSV import
// (no-email-<uuid>@no-email.libertybancard.internal).
export const VALID_EMAIL_ELIGIBILITY =
  `(COALESCE(TRIM(email), '') != '' AND email NOT ILIKE '%.internal' AND email NOT ILIKE 'no-email-%' AND archived_at IS NULL)`;

/** True for synthetic placeholder addresses that must never reach ZeroBounce. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email || email.trim() === "") return true;
  const e = email.trim().toLowerCase();
  return e.endsWith(".internal") || e.startsWith("no-email-");
}

/**
 * True when a ZeroBounce result represents a transport/configuration failure
 * (missing key, HTTP non-2xx, timeout, exception) rather than a completed
 * provider decision. Retryable failures must NOT overwrite email_status.
 */
export function isRetryableZbFailure(r: { skipped?: boolean; reason?: string }): boolean {
  return r.skipped === true || r.reason != null;
}

/** True when the ZeroBounce provider is configured (API key present). */
export function isZeroBounceConfigured(): boolean {
  return !!process.env.ZEROBOUNCE_API_KEY;
}

/**
 * Campaign filter snapshot stored on zerobounce_campaigns.filter_definition.
 * Immutable for the life of the campaign so daily runs process a stable cohort.
 */
export interface ZbCampaignFilter {
  issue: string;
  minLeadScore: number;
  contactIds?: number[];
}

/** Per-issue SQL fragments — same map the DataQuality batch route always used. */
export const ZB_ISSUE_FILTERS: Record<string, string> = {
  blank_name:        `COALESCE(TRIM(first_name), '') = ''`,
  unvalidated_email: UNVALIDATED_EMAIL_PREDICATE,
  bad_email:         `email_status IN ('bounced', 'invalid', 'unsafe')`,
  missing_vertical:  `COALESCE(TRIM(vertical), '') = ''`,
  missing_phone:     `COALESCE(TRIM(phone), '') = ''`,
};

/**
 * Build the canonical WHERE clause (no parameters) selecting contacts eligible
 * for a campaign's filter snapshot. Explicit contactIds campaigns keep the
 * operator's deliberate re-validation gate: only VALID_EMAIL_ELIGIBILITY is
 * applied on top of the ID list (terminal statuses are re-validated on purpose).
 */
export function buildZbEligibilityWhere(filter: ZbCampaignFilter): string {
  if (filter.contactIds && filter.contactIds.length > 0) {
    const ids = filter.contactIds.filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) return "FALSE";
    return `${VALID_EMAIL_ELIGIBILITY} AND id IN (${ids.join(",")})`;
  }
  const issueClause = ZB_ISSUE_FILTERS[filter.issue] ?? UNVALIDATED_EMAIL_PREDICATE;
  const minScore = Number.isFinite(filter.minLeadScore) ? Math.max(0, Math.floor(filter.minLeadScore)) : 0;
  return `${VALID_EMAIL_ELIGIBILITY} AND COALESCE(lead_score, 0) >= ${minScore} AND (${issueClause})`;
}
