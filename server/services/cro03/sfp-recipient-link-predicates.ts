import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { computeLivePackageContentHash, lockLivePackageContentRows } from "./sfp-campaign-packages";
import {
  evaluateSfpEmailTypePolicy,
  evaluateSfpMutableSafetyGates,
  isCanonicallySuppressed,
  lockCurrentSfpOutreachPolicy,
  lookupConsentTierByEmailHash,
  type SfpActivePolicy,
} from "./sfp-outreach-policy";
import { resolveGeographyForBusiness } from "./sfp-geography-resolver";
import { CLASSIFIER_VERSION, SFP_TARGET_VERTICALS_V2, TAXONOMY_VERSION_V2 } from "./sfp-vertical-classifier";
import {
  lockSfpBusinessSafetySentinel,
  lockSfpEligibilityProjectionReadGate,
  lockSfpEligibilityProjectionKey,
  lockSfpEligibilityProjectionWriteGate,
} from "./sfp-eligibility-locks";
import { lockSfpContactAddress } from "./sfp-contact-address-lock";

const rows = (result: any): any[] => result?.rows ?? result ?? [];
export const SFP_INITIAL_RECIPIENT_OBJECTIVE_KEY = "sfp.initial_recipient_acquisition.v1";

export function normalizedSfpEmailHash(email: unknown, version: unknown): string | null {
  const value = String(email ?? "").trim().toLowerCase();
  if (!value || !value.includes("@")) return null;
  if (Number(version) === 0) return createHash("sha256").update(value).digest("hex");
  if (Number(version) === 1) return createHash("sha256").update(`email\u0000${value}`).digest("hex");
  return null;
}

export function sfpRecipientIdentityHash(email: unknown): string | null {
  const value = String(email ?? "").trim().toLowerCase();
  if (!value || !value.includes("@")) return null;
  return createHash("sha256").update(`email\u0000${value}`).digest("hex");
}

export function isValidSfpSourceReference(input: {
  sourceKind: unknown;
  candidateId?: unknown;
  paidCandidateEvidenceId?: unknown;
  contactId?: unknown;
}): boolean {
  const kind = String(input.sourceKind ?? "");
  return (kind === "free" && Boolean(input.candidateId) && !input.paidCandidateEvidenceId && !input.contactId)
    || (kind === "paid" && Boolean(input.paidCandidateEvidenceId) && !input.candidateId && !input.contactId)
    || (kind === "contact" && Boolean(input.contactId) && !input.candidateId && !input.paidCandidateEvidenceId);
}

export function mapSfpEligibilitySourceReference(row: Record<string, unknown>): {
  sourceKind: unknown;
  candidateId: unknown;
  paidCandidateEvidenceId: unknown;
  contactId: unknown;
} {
  return {
    sourceKind: row.source_kind,
    candidateId: row.candidate_id,
    paidCandidateEvidenceId: row.paid_candidate_evidence_id,
    contactId: row.contact_id,
  };
}

export function isFrozenSfpV2ClassificationAdmissible(input: {
  targetVertical: unknown;
  classifierVersion: unknown;
  taxonomyVersion: unknown;
  currentTaxonomyVersion: unknown;
  classificationPolicyVersion: unknown;
  currentPolicyVersion: unknown;
  decisionTarget: unknown;
  evidenceTarget: unknown;
  evidenceOutcome: unknown;
  decisionEvidenceHash: unknown;
  evidenceHash: unknown;
}): boolean {
  const target = String(input.targetVertical ?? "");
  return Number(input.taxonomyVersion) === TAXONOMY_VERSION_V2
    && Number(input.currentTaxonomyVersion) === TAXONOMY_VERSION_V2
    && Number(input.classifierVersion) === CLASSIFIER_VERSION
    && input.classificationPolicyVersion != null
    && Number(input.classificationPolicyVersion) === Number(input.currentPolicyVersion)
    && input.decisionEvidenceHash === input.evidenceHash
    && input.decisionTarget === input.evidenceTarget
    && input.evidenceOutcome === "target"
    && SFP_TARGET_VERTICALS_V2.includes(target as any);
}

export interface CurrentSfpEligibilityAndPackageInput {
  eligibilityId: string;
  businessId: number;
  cohortRunId: string;
  packageKey: string;
  packageVersionId?: string | null;
  eligibilityReviewId?: string | null;
  expectedSourceKind?: "free" | "paid" | "contact";
  emailTokenHash?: string | null;
  emailAddress?: string | null;
  projectionWrite?: boolean;
}

export type CurrentSfpEligibilityAndPackage =
  | { eligible: true; row: any; policy: SfpActivePolicy; package: any; geography: any }
  | { eligible: false; reason: string };

/**
 * Shared commit-time gate for staging and the ready-held bridge. It re-reads
 * the mutable eligibility, policy, cohort, geography/classification and live
 * package state through the caller's transaction. Callers must retain the
 * transaction through their writes.
 */
export async function checkCurrentSfpEligibilityAndPackage(
  tx: { execute: (query: any) => Promise<any> },
  input: CurrentSfpEligibilityAndPackageInput,
): Promise<CurrentSfpEligibilityAndPackage> {
  // Take the global fence before retaining any policy, business-sentinel or
  // address lock. A projection writer may need those same locks at commit.
  if (input.projectionWrite) await lockSfpEligibilityProjectionWriteGate(tx);
  else await lockSfpEligibilityProjectionReadGate(tx);
  let policy: SfpActivePolicy;
  try {
    policy = await lockCurrentSfpOutreachPolicy(tx);
  } catch (error: any) {
    if (String(error?.message ?? error) === "SFP_OUTREACH_POLICY_NOT_CONFIGURED") {
      return { eligible: false, reason: "outreach_policy_not_configured" };
    }
    throw error;
  }
  await lockSfpBusinessSafetySentinel(tx, input.businessId);
  if (input.emailAddress) await lockSfpContactAddress(tx, input.emailAddress);
  if (input.projectionWrite) {
    await lockSfpEligibilityProjectionKey(tx, input.cohortRunId, input.businessId, policy.version);
  }

  const result = rows(await tx.execute(sql`
    SELECT e.id AS eligibility_id,e.business_id,e.cohort_run_id,e.source_kind,e.candidate_id,
           e.paid_candidate_evidence_id,e.contact_id,e.contact_business_link_decision_id,
           e.contact_business_link_revision,e.normalized_value_hash,e.normalized_value_hash_version,
           e.status,e.validation_at,e.validation_expires_at,e.zb_outcome,e.raw_provider_status,
           e.suppression_status,e.validation_operation_id,e.reused_from_operation_id,
           e.named_contact,e.role_inbox,e.policy_document_id,e.policy_document_hash,
           e.outreach_policy_version,e.updated_at,e.staging_intent_id,
           b.canonical_name,b.record_class AS business_record_class,b.do_not_visit,
           r.cohort_state,r.voided_at,r.superseded_at,r.program_id,
           p.is_active AS program_active,p.county_fips AS program_counties,
           p.vertical_ids AS program_verticals,
           p.taxonomy_version AS current_taxonomy_version,
           p.policy_version AS current_classification_policy_version,
           d.classifier_matched_target,d.classifier_version,
           d.classification_evidence_id,d.classification_policy_version,
           d.classification_evidence_hash,
           ce.taxonomy_version,ce.outcome AS evidence_outcome,
           ce.resolved_vertical_id,ce.evidence_hash,
           EXISTS (
             SELECT 1 FROM provider_observations po
             JOIN provider_operations op ON op.id=po.operation_id
              WHERE po.operation_id=COALESCE(e.validation_operation_id,e.reused_from_operation_id)
                AND po.provider='zerobounce' AND po.outcome='valid' AND po.retryable=FALSE
                AND po.subject_type='business' AND po.subject_id=e.business_id
                AND (po.email_token_hash IS NULL OR ${input.emailTokenHash ?? null}::text IS NULL
                     OR po.email_token_hash=${input.emailTokenHash ?? null}::text)
                AND op.state='completed'
           ) AS has_valid_business_receipt,
           EXISTS (
             SELECT 1 FROM free_discovery_candidates fc
              WHERE fc.id=e.candidate_id AND fc.business_id=e.business_id
                AND fc.field='email' AND fc.subject_type='business'
                AND fc.disposition='staged' AND fc.contact_id IS NULL
           ) AS free_source_current,
           EXISTS (
             SELECT 1 FROM sfp_paid_candidate_evidence pe
              WHERE pe.id=e.paid_candidate_evidence_id AND pe.business_id=e.business_id
                AND pe.field='email' AND pe.subject_type='business' AND pe.disposition='staged'
           ) AS paid_source_current,
           review.id AS eligibility_review_id
      FROM sfp_outreach_eligibility e
      JOIN businesses b ON b.id=e.business_id
      JOIN sfp_cohort_runs r ON r.id=e.cohort_run_id
      JOIN sfp_programs p ON p.id=r.program_id
      JOIN sfp_cohort_decisions d
        ON d.cohort_run_id=e.cohort_run_id AND d.business_id=e.business_id AND d.selected=TRUE
      JOIN sfp_classification_evidence ce ON ce.id=d.classification_evidence_id
      LEFT JOIN LATERAL (
        SELECT rv.id
          FROM sfp_named_email_eligibility_reviews rv
         WHERE rv.eligibility_id=e.id AND rv.decision='approved'
           AND rv.id=(SELECT latest.id FROM sfp_named_email_eligibility_reviews latest
                       WHERE latest.eligibility_id=e.id
                       ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
           AND (${input.eligibilityReviewId ?? null}::uuid IS NULL
                OR rv.id=${input.eligibilityReviewId ?? null}::uuid)
           AND rv.expected_updated_at=e.updated_at
           AND rv.policy_document_id=${policy.id}::uuid
           AND rv.policy_document_hash=${policy.documentHash}
           AND rv.validation_operation_id=COALESCE(e.validation_operation_id,e.reused_from_operation_id)
           AND rv.source_kind=e.source_kind
           AND rv.source_reference_id=CASE e.source_kind
             WHEN 'free' THEN e.candidate_id::text
             WHEN 'paid' THEN e.paid_candidate_evidence_id::text
             WHEN 'contact' THEN e.contact_id::text ELSE '' END
           AND rv.contact_business_link_decision_id IS NOT DISTINCT FROM e.contact_business_link_decision_id
           AND rv.contact_business_link_revision IS NOT DISTINCT FROM e.contact_business_link_revision
           AND rv.normalized_value_hash=e.normalized_value_hash
           AND rv.normalized_value_hash_version=e.normalized_value_hash_version
           AND rv.validation_expires_at=e.validation_expires_at
           AND EXISTS (
             SELECT 1 FROM provider_observations po
              WHERE po.operation_id=rv.validation_operation_id
                AND po.provider='zerobounce' AND po.outcome='valid'
                AND po.subject_type='business' AND po.subject_id=e.business_id
           )
         LIMIT 1
      ) review ON TRUE
     WHERE e.id=${input.eligibilityId}::uuid
       AND e.business_id=${input.businessId}
       AND e.cohort_run_id=${input.cohortRunId}::uuid
     FOR SHARE OF e,r,p,d,ce,b
  `));
  const row = result[0];
  if (!row) return { eligible: false, reason: "eligibility_cohort_or_classification_not_found" };
  if (row.cohort_state !== "frozen" || row.voided_at || row.superseded_at) {
    return { eligible: false, reason: "cohort_not_current_frozen" };
  }
  if (row.program_active !== true) return { eligible: false, reason: "program_inactive" };
  if (row.business_record_class !== "canonical" || row.do_not_visit === true) {
    return { eligible: false, reason: "business_not_currently_outreach_eligible" };
  }
  if (!isValidSfpSourceReference(mapSfpEligibilitySourceReference(row))
      || (input.expectedSourceKind && row.source_kind !== input.expectedSourceKind)) {
    return { eligible: false, reason: "typed_source_reference_invalid_or_changed" };
  }
  if ((row.source_kind === "free" && row.free_source_current !== true)
      || (row.source_kind === "paid" && row.paid_source_current !== true)) {
    return { eligible: false, reason: "typed_source_missing_or_business_changed" };
  }
  const quarantine = rows(await tx.execute(sql`
    SELECT business_id FROM sfp_identity_quarantines
     WHERE business_id=${input.businessId} AND cleared_at IS NULL
     FOR SHARE
  `));
  if (quarantine.length) return { eligible: false, reason: "business_identity_quarantined" };
  if (row.source_kind === "free") {
    const source = rows(await tx.execute(sql`
      SELECT id,business_id,normalized_value_hash FROM free_discovery_candidates
       WHERE id=${String(row.candidate_id)}::uuid AND business_id=${input.businessId}
         AND field='email' AND subject_type='business' AND disposition='staged' AND contact_id IS NULL
       FOR SHARE
    `))[0];
    if (!source) return { eligible: false, reason: "free_source_changed" };
    if (Number(row.normalized_value_hash_version) === 1
        && String(source.normalized_value_hash) !== String(row.normalized_value_hash)) {
      return { eligible: false, reason: "free_source_address_hash_changed" };
    }
  } else if (row.source_kind === "paid") {
    const source = rows(await tx.execute(sql`
      SELECT id,business_id,normalized_value_hash FROM sfp_paid_candidate_evidence
       WHERE id=${String(row.paid_candidate_evidence_id)}::uuid AND business_id=${input.businessId}
         AND field='email' AND subject_type='business' AND disposition='staged'
       FOR SHARE
    `))[0];
    if (!source) return { eligible: false, reason: "paid_source_changed" };
    if (Number(row.normalized_value_hash_version) === 1
        && String(source.normalized_value_hash) !== String(row.normalized_value_hash)) {
      return { eligible: false, reason: "paid_source_address_hash_changed" };
    }
  } else {
    if (!row.contact_business_link_decision_id || row.contact_business_link_revision == null) {
      return { eligible: false, reason: "contact_source_link_pins_missing" };
    }
    const sourceContact = rows(await tx.execute(sql`
      SELECT c.email,c.email_token_hash,d.id AS decision_id,d.revision
        FROM contacts c
        JOIN contact_business_link_decisions d
          ON d.contact_id=c.id AND d.business_id=c.business_id
         AND d.decision='verified' AND d.superseded_at IS NULL
       WHERE c.id=${Number(row.contact_id)} AND c.business_id=${input.businessId}
         AND c.archived_at IS NULL
         AND d.id=${String(row.contact_business_link_decision_id)}::uuid
         AND d.revision=${Number(row.contact_business_link_revision)}
        FOR SHARE OF d
    `))[0];
    if (!sourceContact
        || normalizedSfpEmailHash(sourceContact.email, row.normalized_value_hash_version) !== String(row.normalized_value_hash ?? "")) {
      return { eligible: false, reason: "contact_source_link_or_address_changed" };
    }
    if (input.emailTokenHash && String(sourceContact.email_token_hash ?? "") !== input.emailTokenHash) {
      return { eligible: false, reason: "contact_source_validation_address_changed" };
    }
  }
  if (row.policy_document_id == null || String(row.policy_document_id) !== policy.id
      || String(row.policy_document_hash ?? "") !== policy.documentHash
      || (row.outreach_policy_version != null && Number(row.outreach_policy_version) !== policy.version)) {
    return { eligible: false, reason: "outreach_policy_changed" };
  }
  if (!Array.isArray(policy.acceptedOutcomes) || !policy.acceptedOutcomes.includes("valid")
      || !Array.isArray(policy.retryableOutcomes) || policy.retryableOutcomes.includes("valid")) {
    return { eligible: false, reason: "active_policy_no_longer_accepts_valid_outcome" };
  }
  const approvedNamed = row.status === "validated_review_required" && row.named_contact === true
    && row.zb_outcome === "valid" && row.suppression_status === "not_suppressed"
    && row.eligibility_review_id != null
    && (!input.eligibilityReviewId || String(row.eligibility_review_id) === input.eligibilityReviewId);
  if (row.status !== "validated_outreach_eligible" && !approvedNamed) {
    return { eligible: false, reason: row.status === "validated_review_required" ? "independent_email_review_required" : `eligibility_status_${row.status}` };
  }
  if (approvedNamed) {
    const currentReview = rows(await tx.execute(sql`
      SELECT id FROM sfp_named_email_eligibility_reviews
       WHERE id=${String(row.eligibility_review_id)}::uuid AND eligibility_id=${input.eligibilityId}::uuid
         AND decision='approved'
       FOR SHARE
    `));
    if (currentReview.length !== 1) return { eligible: false, reason: "independent_email_review_no_longer_current" };
  }
  const emailPolicy = evaluateSfpEmailTypePolicy({
    namedContact: row.named_contact === true,
    roleInbox: row.role_inbox === true,
    policy,
  });
  if (emailPolicy.status === "eligibility_review_required" && !approvedNamed) {
    return { eligible: false, reason: emailPolicy.reasonCode };
  }
  if (row.zb_outcome !== "valid" || row.suppression_status !== "not_suppressed" || row.has_valid_business_receipt !== true) {
    return { eligible: false, reason: "matching_valid_business_receipt_missing" };
  }
  if (input.emailTokenHash) {
    if (await isCanonicallySuppressed(
      [input.emailTokenHash], tx, input.emailAddress ? [input.emailAddress] : [],
    )) {
      return { eligible: false, reason: "address_suppressed" };
    }
  }
  const consentTier = input.emailTokenHash
    ? await lookupConsentTierByEmailHash(input.emailTokenHash, tx)
    : null;
  const mutableGate = await evaluateSfpMutableSafetyGates({
    businessId: input.businessId,
    consentTier,
    policy,
    emailAddress: input.emailAddress,
  }, tx);
  if (!mutableGate.eligible) return { eligible: false, reason: mutableGate.reasonCode };
  const validationAt = row.validation_at ? new Date(String(row.validation_at)) : null;
  const expiresAt = row.validation_expires_at
    ? new Date(String(row.validation_expires_at))
    : validationAt
      ? new Date(validationAt.getTime() + policy.validationTtlDays * 86_400_000)
      : null;
  if (!validationAt || !expiresAt || Number.isNaN(validationAt.getTime()) || Number.isNaN(expiresAt.getTime())
      || validationAt.getTime() > Date.now()
      || expiresAt.getTime() <= Date.now()
      || expiresAt.getTime() > validationAt.getTime() + policy.validationTtlDays * 86_400_000) {
    return { eligible: false, reason: "validation_expired_or_original_age_invalid" };
  }
  if (!isFrozenSfpV2ClassificationAdmissible({
    targetVertical: row.resolved_vertical_id,
    classifierVersion: row.classifier_version,
    taxonomyVersion: row.taxonomy_version,
    currentTaxonomyVersion: row.current_taxonomy_version,
    classificationPolicyVersion: row.classification_policy_version,
    currentPolicyVersion: row.current_classification_policy_version,
    decisionTarget: row.classifier_matched_target,
    evidenceTarget: row.resolved_vertical_id,
    evidenceOutcome: row.evidence_outcome,
    decisionEvidenceHash: row.classification_evidence_hash,
    evidenceHash: row.evidence_hash,
  })) return { eligible: false, reason: "classification_evidence_stale_or_not_v2_target" };
  if (!Array.isArray(row.program_verticals)
      || !row.program_verticals.includes(String(row.resolved_vertical_id))) {
    return { eligible: false, reason: "classification_vertical_not_in_active_program" };
  }

  await tx.execute(sql`SELECT id FROM business_locations WHERE business_id=${input.businessId} FOR SHARE`);
  const geography = await resolveGeographyForBusiness(input.businessId, tx);
  const counties = Array.isArray(row.program_counties) ? row.program_counties.map(String) : [];
  if (!geography.eligible || geography.outcome !== "resolved" || !geography.countyFips
      || !counties.includes(String(geography.countyFips))) {
    return { eligible: false, reason: "current_operating_geography_unresolved_or_outside_program" };
  }

  const packages = rows(await tx.execute(sql`
     SELECT v.id,v.package_key,v.vertical,v.campaign_id,v.sequence_id,v.content_hash
       FROM sfp_campaign_package_versions v
     WHERE v.lifecycle_state='current'
       AND v.package_key=${input.packageKey}
       AND (${input.packageVersionId ?? null}::uuid IS NULL OR v.id=${input.packageVersionId ?? null}::uuid)
      FOR UPDATE OF v
  `));
  if (packages.length !== 1) return { eligible: false, reason: "exact_current_package_missing_or_ambiguous" };
  const pkg = packages[0];
  const lockedContent = await lockLivePackageContentRows(
    tx, Number(pkg.campaign_id), Number(pkg.sequence_id),
  );
  pkg.campaign_status = lockedContent.campaign.status;
  pkg.sequence_status = lockedContent.sequence.status;
  pkg.sequence_trigger_config = lockedContent.sequence.trigger_config;
  if (!String(pkg.package_key).endsWith(".v2") || String(pkg.vertical) !== String(row.resolved_vertical_id)) {
    return { eligible: false, reason: "package_vertical_or_taxonomy_mismatch" };
  }
  if (pkg.campaign_status !== "draft") return { eligible: false, reason: "campaign_not_draft" };
  if (pkg.sequence_status !== "paused") return { eligible: false, reason: "sequence_not_paused" };
  const liveContentHash = await computeLivePackageContentHash(tx, Number(pkg.campaign_id), Number(pkg.sequence_id));
  if (liveContentHash !== String(pkg.content_hash)) return { eligible: false, reason: "live_package_content_changed" };
  if (input.packageVersionId && String(pkg.id) !== input.packageVersionId) {
    return { eligible: false, reason: "pinned_package_version_changed" };
  }
  if (input.emailTokenHash) {
    const observation = rows(await tx.execute(sql`
      SELECT po.id,po.observed_at,po.expires_at FROM provider_observations po
       JOIN provider_operations op ON op.id=po.operation_id AND op.state='completed'
       WHERE po.operation_id=COALESCE(${row.validation_operation_id ?? null}::uuid,${row.reused_from_operation_id ?? null}::uuid)
         AND po.provider='zerobounce' AND po.outcome='valid' AND po.retryable=FALSE
         AND po.subject_type='business' AND po.subject_id=${input.businessId}
         AND po.email_token_hash=${input.emailTokenHash}
           AND po.observed_at<=clock_timestamp()
          AND LEAST(
            COALESCE(po.expires_at,po.observed_at+(${policy.validationTtlDays}::text||' days')::interval),
            po.observed_at+(${policy.validationTtlDays}::text||' days')::interval
           )>clock_timestamp()
          AND ${row.validation_at}::timestamptz BETWEEN po.observed_at-INTERVAL '5 minutes'
                                                     AND po.observed_at+INTERVAL '5 minutes'
          AND ${row.validation_expires_at}::timestamptz<=LEAST(
            COALESCE(po.expires_at,po.observed_at+(${policy.validationTtlDays}::text||' days')::interval),
            po.observed_at+(${policy.validationTtlDays}::text||' days')::interval
           )
       LIMIT 1 FOR SHARE OF po,op
    `));
    if (observation.length !== 1) return { eligible: false, reason: "receipt_subject_or_address_changed" };
  }
  return { eligible: true, row, policy, package: { ...pkg, content_hash: liveContentHash }, geography };
}

/**
 * Final database-clock receipt fence. Call after all potentially blocking
 * locks and writes for a successful stage/bridge result have completed. The
 * transaction must remain open through commit.
 */
export async function isCurrentSfpValidationReceiptFresh(
  tx: { execute: (query: any) => Promise<any> },
  input: { eligibilityId: string; businessId: number; emailTokenHash: string },
): Promise<boolean> {
  const matching = rows(await tx.execute(sql`
    WITH fence_clock AS MATERIALIZED (SELECT clock_timestamp() AS at)
    SELECT po.id
      FROM fence_clock fc
      JOIN sfp_outreach_eligibility e
        ON e.id=${input.eligibilityId}::uuid AND e.business_id=${input.businessId}
      JOIN sfp_outreach_policy_control pc ON pc.singleton=TRUE
      JOIN sfp_outreach_policy_documents pd
        ON pd.id=pc.active_policy_id
       AND pd.id=e.policy_document_id
       AND pd.document_hash=e.policy_document_hash
      JOIN provider_observations po
        ON po.operation_id=COALESCE(e.validation_operation_id,e.reused_from_operation_id)
      JOIN provider_operations op ON op.id=po.operation_id AND op.state='completed'
     WHERE po.provider='zerobounce' AND po.outcome='valid' AND po.retryable=FALSE
       AND po.subject_type='business' AND po.subject_id=e.business_id
       AND po.email_token_hash=${input.emailTokenHash}
       AND po.observed_at<=fc.at
       AND e.validation_at<=fc.at
       AND e.validation_at BETWEEN po.observed_at-INTERVAL '5 minutes'
                               AND po.observed_at+INTERVAL '5 minutes'
       AND COALESCE(
         e.validation_expires_at,
         e.validation_at+(pd.validation_ttl_days::text||' days')::interval
       )>fc.at
       AND LEAST(
         COALESCE(po.expires_at,po.observed_at+(pd.validation_ttl_days::text||' days')::interval),
         po.observed_at+(pd.validation_ttl_days::text||' days')::interval
       )>fc.at
       AND COALESCE(
         e.validation_expires_at,
         e.validation_at+(pd.validation_ttl_days::text||' days')::interval
       )<=LEAST(
         COALESCE(po.expires_at,po.observed_at+(pd.validation_ttl_days::text||' days')::interval),
         po.observed_at+(pd.validation_ttl_days::text||' days')::interval
       )
     LIMIT 1
     FOR SHARE OF e,po,op
  `));
  return matching.length === 1;
}