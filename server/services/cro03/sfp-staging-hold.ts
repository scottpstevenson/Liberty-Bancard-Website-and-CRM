/**
 * Cross-window campaign-staging holds (Stage 4B / F03).
 *
 * A recipient whose staging was refused for a permanent, item-local reason
 * must not be re-selected by every 15-minute recurring window. The hold is
 * recorded on the existing sfp_stage_items ledger (redacted_result.hold) and
 * is bound to a *relevant-fact revision* of the eligibility decision, not to
 * the run id, the clock bucket or updated_at. No new schema object is needed:
 * history stays in the existing ledger and a changed relevant fact simply
 * stops matching the stored revision, which lets exactly one new evaluation
 * through (the new outcome writes a new revision-bound hold).
 *
 * The same SQL expression computes the revision at claim time and is the one
 * the selection predicate compares against, so there is a single definition.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { getActiveSfpOutreachPolicy } from "./sfp-outreach-policy";
import { getCurrentPackageForVertical } from "./sfp-campaign-packages";

const rows = (result: any): any[] => result?.rows ?? result ?? [];

export const STAGING_HOLD_VERSION = 1;

/** Item-local refusals that cannot succeed until one of the revision facts changes. */
const PERMANENT_ROW_CODES = new Set([
  "SFP_STAGING_SOURCE_REFERENCE_INVALID",
  "SFP_STAGING_ELIGIBILITY_NOT_FOUND",
  "SFP_STAGING_CLASSIFICATION_STALE",
  "SFP_STAGING_EMAIL_POLICY_REVIEW_REQUIRED",
  "SFP_STAGING_PACKAGE_CLASSIFICATION_MISMATCH",
  "SFP_STAGING_CANDIDATE_MISSING",
  "SFP_STAGING_PAID_EVIDENCE_MISSING",
  "SFP_STAGING_CONTACT_SOURCE_MISSING",
  "SFP_STAGING_CONTACT_VALIDATION_PIN_MISSING",
  "SFP_STAGING_CONTACT_LINK_NOT_VERIFIED",
  "SFP_STAGING_EVIDENCE_BUSINESS_MISMATCH",
  "SFP_STAGING_EMAIL_INVALID",
  "SFP_STAGING_RECIPIENT_IDENTITY_INVALID",
]);

/**
 * Suppression refusals are held only for a bounded recheck window. Suppression is decided from contact opt-outs and
 * consent-subject state keyed by the plain address, which the revision cannot read (the address is sealed), so an
 * un-suppression would not change the revision. A time-bounded hold lets a lifted suppression be re-evaluated.
 */
const TIMED_ROW_CODES = new Set(["SFP_STAGING_SUPPRESSED"]);
export const TIMED_HOLD_RECHECK_HOURS = 12;

/** Preview-level blocks recorded by executeStagingV2 for a single row. */
const PERMANENT_PREVIEW_REASONS = new Set([
  "source_reference_invalid",
  "contact_link_or_email_pin_stale",
  "validation_stale",
  "frozen_v2_classification_unresolved_or_stale",
  "no_current_package_for_vertical",
  "named_email_requires_eligibility_review",
  "unclassified_email_requires_eligibility_review",
  "named_email_policy_status_mismatch",
]);

export type StagingRefusalClass = "permanent_item" | "timed_item" | "retryable";

/**
 * Classify a recorded row outcome by its stable domain code. Anything not
 * explicitly proven permanent (unknown errors, 409 drift, safety-gate or
 * capacity refusals whose facts are not part of the hold revision) stays
 * retryable: an unknown failure is never a permanent data-quality exclusion.
 */
export function classifyStagingRefusal(outcomeCode: string | null | undefined): StagingRefusalClass {
  const code = String(outcomeCode ?? "");
  if (PERMANENT_ROW_CODES.has(code) || PERMANENT_PREVIEW_REASONS.has(code)) return "permanent_item";
  if (TIMED_ROW_CODES.has(code)) return "timed_item";
  return "retryable";
}

/** Vertical → "<package id>:<content hash>" for the program's verticals. */
export async function readCurrentPackageFingerprints(programId: string): Promise<Record<string, string>> {
  const program = rows(await db.execute(sql`
    SELECT vertical_ids FROM sfp_programs WHERE id=${programId}::uuid LIMIT 1
  `))[0];
  const verticals: string[] = Array.isArray(program?.vertical_ids) ? program.vertical_ids.map(String) : [];
  const out: Record<string, string> = {};
  for (const vertical of verticals) {
    try {
      const pkg = await getCurrentPackageForVertical(vertical);
      out[vertical] = pkg ? `${pkg.id}:${pkg.contentHash}` : "none";
    } catch {
      out[vertical] = "ambiguous";
    }
  }
  return out;
}

export interface StagingHoldContext {
  policyDocumentHash: string;
  packageFingerprints: Record<string, string>;
}

export async function readStagingHoldContext(programId: string): Promise<StagingHoldContext> {
  const policy = await getActiveSfpOutreachPolicy();
  return {
    policyDocumentHash: String(policy.documentHash),
    packageFingerprints: await readCurrentPackageFingerprints(programId),
  };
}

/**
 * Relevant-fact revision of one eligibility decision. Aliases required in the
 * enclosing query: e = sfp_outreach_eligibility, d = sfp_cohort_decisions
 * (LEFT), ce = sfp_classification_evidence (LEFT). Deliberately excludes
 * updated_at, run ids and clock buckets.
 */
export function stagingHoldRevisionSql(context: StagingHoldContext) {
  return sql`md5(concat_ws('|',
    ${`v${STAGING_HOLD_VERSION}`}::text, e.id::text, e.status, COALESCE(e.source_kind,''),
    COALESCE(e.candidate_id::text,''), COALESCE(e.paid_candidate_evidence_id::text,''), COALESCE(e.contact_id::text,''),
    COALESCE(e.normalized_value_hash,''), COALESCE(e.normalized_value_hash_version::text,''),
    COALESCE(e.contact_business_link_decision_id::text,''), COALESCE(e.contact_business_link_revision::text,''),
    COALESCE(e.policy_document_hash,''), COALESCE(e.validation_operation_id::text,''),
    COALESCE(e.reused_from_operation_id::text,''),
    COALESCE(EXTRACT(EPOCH FROM e.validation_expires_at)::text,''),
    e.named_contact::text, e.role_inbox::text, e.recipient_association_pins::text,
    COALESCE(d.classification_evidence_hash,''), COALESCE(d.classifier_matched_target,''),
    COALESCE(d.classifier_version::text,''), COALESCE(d.classification_policy_version::text,''),
    COALESCE(ce.evidence_hash,''), COALESCE(ce.outcome::text,''), COALESCE(ce.resolved_vertical_id::text,''),
    ${context.policyDocumentHash}::text,
    COALESCE((${JSON.stringify(context.packageFingerprints)}::jsonb)->>(ce.resolved_vertical_id::text),'none'),
    COALESCE((SELECT l.id::text||':'||l.revision::text FROM contact_business_link_decisions l
               WHERE l.contact_id=e.contact_id AND l.business_id=e.business_id
                 AND l.decision='verified' AND l.superseded_at IS NULL
               ORDER BY l.revision DESC LIMIT 1),''),
    COALESCE((SELECT c.email_token_hash FROM contacts c WHERE c.id=e.contact_id),''),
    COALESCE((SELECT r.id::text||':'||r.decision FROM sfp_named_email_eligibility_reviews r
               WHERE r.eligibility_id=e.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1),'')
  ))`;
}

/** SQL join fragment supplying the d/ce aliases used by the revision. */
export const STAGING_HOLD_JOINS = sql`
  LEFT JOIN sfp_cohort_decisions d
    ON d.cohort_run_id=e.cohort_run_id AND d.business_id=e.business_id AND d.selected=TRUE
  LEFT JOIN sfp_classification_evidence ce ON ce.id=d.classification_evidence_id`;

/** Hold class and (for timed holds) freshness; shared by selection and census. Alias h = sfp_stage_items. */
function holdClassActiveSql() {
  return sql`(
    h.redacted_result->'hold'->>'class'='permanent'
    OR (h.redacted_result->'hold'->>'class'='timed'
        AND h.updated_at > NOW() - (${TIMED_HOLD_RECHECK_HOURS} * INTERVAL '1 hour'))
  )`;
}

/** Predicate: this eligibility has an active hold whose revision still matches. */
export function activeStagingHoldPredicate(context: StagingHoldContext) {
  return sql`EXISTS (
    SELECT 1 FROM sfp_stage_items h
     WHERE h.provider='campaign_staging' AND h.business_id=e.business_id
       AND h.state='dead_letter'
       AND ${holdClassActiveSql()}
       AND h.redacted_result->'hold'->>'eligibilityId'=e.id::text
       AND h.redacted_result->'hold'->>'revision'=${stagingHoldRevisionSql(context)}
  )`;
}

/** Read-only reconsideration census for the program's frozen cohorts. */
export async function readStagingHoldCensus(programId: string, context?: StagingHoldContext) {
  const ctx = context ?? await readStagingHoldContext(programId);
  const result = rows(await db.execute(sql`
    SELECT COALESCE(NULLIF(h.outcome_code,''),'unknown') AS code,
           COUNT(DISTINCT e.id)::int AS held_current,
           COUNT(DISTINCT e.business_id)::int AS businesses
      FROM sfp_outreach_eligibility e
      JOIN sfp_cohort_runs r ON r.id=e.cohort_run_id AND r.cohort_state='frozen'
       AND r.voided_at IS NULL AND r.superseded_at IS NULL AND r.program_id=${programId}::uuid
      ${STAGING_HOLD_JOINS}
      JOIN sfp_stage_items h ON h.provider='campaign_staging' AND h.business_id=e.business_id
       AND h.state='dead_letter'
       AND h.redacted_result->'hold'->>'class'='permanent'
       AND h.redacted_result->'hold'->>'eligibilityId'=e.id::text
       AND h.redacted_result->'hold'->>'revision'=${stagingHoldRevisionSql(ctx)}
     WHERE e.status='validated_outreach_eligible' AND e.staging_intent_id IS NULL
     GROUP BY 1 ORDER BY 1
  `));
  return result.map((row) => ({ code: String(row.code), eligibilities: Number(row.held_current), businesses: Number(row.businesses) }));
}
