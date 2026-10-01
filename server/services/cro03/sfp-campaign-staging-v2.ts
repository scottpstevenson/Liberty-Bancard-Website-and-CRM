/**
 * sfp-campaign-staging-v2.ts
 *
 * Task #2001: the corrected, package-pinned, snapshot-bound, transactional
 * campaign/sequence staging boundary. Replaces the terminal state of
 * `stageForCampaign()` (south-florida-prospecting.ts) — that function still
 * exists and still writes the legacy `staged` no-consumer intent for
 * backward compatibility, but this module is the one that carries a staged
 * intent through `operator_selected -> ready_held`, admits paid-source rows,
 * and is transactional end to end.
 *
 * Terminal boundary: `ready_held`. This module NEVER writes to
 * sequence_enrollments, campaign_queue_runs/items, or any GHL/outbound
 * table. Zero sends occur from any code path in this file.
 */

import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { hashEmailToken } from "../provider-readiness-control";
import { db } from "../../db";
import {
  lockCommercialGraphMembershipSets,
  lockCommercialGraphNodes,
  type CommercialGraphNode,
} from "../commercial-graph-locks";
import {
  getActiveSfpOutreachPolicy,
  evaluateSfpEmailTypePolicy,
  lockCurrentSfpOutreachPolicy,
} from "./sfp-outreach-policy";
import { isCanonicallySuppressed } from "./sfp-outreach-policy";
import { businessLacksDbprLineageSql } from "../dbpr";
import { getCurrentPackageForVertical, computeLivePackageContentHash } from "./sfp-campaign-packages";
import { openSfpCandidatePlaintext } from "./sfp-paid-evidence-writer";
import { lockSfpContactAddress } from "./sfp-contact-address-lock";
import { lockSfpEligibilityProjectionWriteGate } from "./sfp-eligibility-locks";
import { evaluateSfpMutableSafetyGates, lookupConsentTierByEmailHash } from "./sfp-outreach-policy";
import { getOrCreateStageRun, ensureStageItem, markStageItemCompletedInTx, markStageItemDeadLetter, reconcileStageRunCounters } from "./sfp-stage-ledger";
import {
  checkCurrentSfpEligibilityAndPackage,
  isCurrentSfpValidationReceiptFresh,
  isFrozenSfpV2ClassificationAdmissible,
  isValidSfpSourceReference,
  mapSfpEligibilitySourceReference,
  normalizedSfpEmailHash,
  sfpRecipientIdentityHash,
  SFP_INITIAL_RECIPIENT_OBJECTIVE_KEY,
} from "./sfp-recipient-link-predicates";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const MAX_BATCH_SIZE = 25;
export function isFrozenV2ClassificationAdmissible(input: {
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
  return isFrozenSfpV2ClassificationAdmissible(input);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizedContactHash(email: unknown, version: unknown): string | null {
  return normalizedSfpEmailHash(email, version);
}

/** True only when the row's pinned hash matches this exact source value using
 * the row's declared hash version. Unknown source kinds/hash versions fail
 * closed rather than being compared against an unversioned digest. */
export function isValidatedSfpSourceEmailUnchanged(
  sourceKind: unknown,
  email: unknown,
  normalizedValueHash: unknown,
  normalizedValueHashVersion: unknown,
): boolean {
  if (!["free", "paid", "contact"].includes(String(sourceKind))) return false;
  const actualHash = normalizedContactHash(email, normalizedValueHashVersion);
  return actualHash !== null && actualHash === String(normalizedValueHash ?? "");
}

export class SfpStagingV2Error extends Error {
  constructor(public code: string, message: string, public httpStatus: 400 | 409 | 422 = 400) {
    super(message);
    this.name = "SfpStagingV2Error";
  }
}

export interface StagingV2PreviewRow {
  eligibilityId: string;
  businessId: number;
  sourceKind: "free" | "paid" | "contact";
  vertical: string | null;
  packageKey: string | null;
  disposition: "eligible" | "blocked";
  blockedReason?: string;
  maskedEmail: string | null;
  // PM-12 correction: an operator confirming a batch must be able to see —
  // per row, not just in aggregate — exactly which package version and
  // policy this row will be pinned to, and how much validation-freshness
  // margin it has, before committing. These fields are what
  // stageOneRowTransactional() will actually pin if this row executes.
  packageVersionId?: string;
  packageContentHash?: string;
  policyId?: string;
  policyVersion?: number;
  policyDocumentHash?: string;
  validationExpiresAt?: string;
  validationAgeSeconds?: number;
  sourceContactLinkDecisionId?: string;
  sourceContactLinkRevision?: number;
  normalizedValueHashVersion?: number;
  sourceReferenceId?: string;
  normalizedValueHash?: string;
  classificationEvidenceId?: string;
  classificationEvidenceHash?: string;
  eligibilityReviewId?: string;
}

export interface StagingV2Preview {
  cohortRunId: string;
  snapshotHash: string;
  commandKey: string;
  /**
   * Confirmation binding for execute() (PM-12): execute() requires this
   * exact payloadHash back, not just a commandKey/snapshotHash pair, so an
   * operator (or the UI on their behalf) must be looking at THIS preview's
   * exact row selection to confirm it — a stale UI holding an older
   * commandKey for the same ID set cannot silently execute a different
   * payloadHash without the caller explicitly re-deriving it.
   */
  payloadHash: string;
  policyDocumentHash: string;
  policyId: string;
  policyVersion: number;
  rows: StagingV2PreviewRow[];
  eligibleCount: number;
  blockedCount: number;
  /** Truthful terminal-state label surfaced to operators/UI (PM-12). */
  outcomeLabel: "READY_HELD_PENDING_CONFIRMATION";
  capturedAt: string;
}

/**
 * Snapshot-bound, zero-write preview. Requires an explicit set of
 * eligibility IDs — there is no "all eligible" mode (Defect 14).
 */
/**
 * Canonicalizes a caller-supplied ID list: rejects duplicates outright
 * (rather than silently de-duping, which would let a caller under-count
 * what it thinks it selected) and sorts so downstream ordering — the SQL
 * query, the preview row array, and the snapshot hash inputs — is
 * deterministic regardless of what order the caller happened to submit
 * (PM-04 correction).
 */
function canonicalizeEligibilityIds(ids: string[]): string[] {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new SfpStagingV2Error("SFP_STAGING_DUPLICATE_ID", `duplicate eligibilityId in request: ${id}`, 400);
    seen.add(id);
  }
  return [...ids].sort();
}

export async function previewStagingV2(opts: {
  cohortRunId: string;
  eligibilityIds: string[];
  actorId: string;
  /**
   * Crash-resumption fix: when executeStagingV2() re-derives a fresh
   * preview on a resumed/retried attempt of a command that already
   * committed some rows (crash between a row's commit and the outer
   * command's 'completed' transition), a row it already staged now carries
   * `staging_intent_id`. Without this, that row would flip from
   * 'eligible' to 'blocked: already_has_staging_intent', change the
   * snapshot hash, and force SFP_STAGING_SNAPSHOT_DRIFTED (409) before
   * stageOneRowTransactional()'s own same-command idempotent-no-op check
   * ever runs. When this commandKey is provided, a row whose existing
   * intent was created by THIS exact command is reconstructed as
   * 'eligible' with the same package/policy pin the intent already
   * recorded — reproducing the original snapshot hash exactly — rather
   * than reclassified as newly blocked.
   */
  resumeCommandKey?: string;
  /**
   * Retry-contract correction: the recurring worker passes its current
   * stage-run claim token here so a genuine new attempt at an UNCHANGED
   * eligibility selection (same IDs, same snapshot) produces a genuinely
   * different commandKey than the prior attempt. Without this, retrying the
   * exact same selection reproduces the exact same snapshotHash, so
   * executeStagingV2() finds its own prior 'completed' command row for that
   * commandKey and replays the stored receipt instead of ever touching the
   * stage item again — the item is claimed but never actually reprocessed.
   * The claim token is stable for the lifetime of one worker tick (renewals
   * do not change it) and changes on every fresh claim of the stage run, so
   * it salts the hash once per real attempt, not once per call. Manual
   * (non-worker) callers never pass this, so ordinary manual command replay
   * (protecting a double-submit from re-running side effects) is untouched.
   */
  attemptSalt?: string;
}): Promise<StagingV2Preview> {
  if (!opts.eligibilityIds || opts.eligibilityIds.length === 0) {
    throw new SfpStagingV2Error("SFP_STAGING_NO_SELECTION", "eligibilityIds must be explicitly provided and non-empty", 400);
  }
  if (opts.eligibilityIds.length > MAX_BATCH_SIZE) {
    throw new SfpStagingV2Error("SFP_STAGING_BATCH_TOO_LARGE", `at most ${MAX_BATCH_SIZE} eligibility IDs may be staged per command`, 400);
  }
  const orderedIds = canonicalizeEligibilityIds(opts.eligibilityIds);

  const activePolicy = await getActiveSfpOutreachPolicy();
  const eligibilityRows = rows(await db.execute(sql`
    SELECT soe.id, soe.business_id, soe.source_kind, soe.candidate_id, soe.paid_candidate_evidence_id,
           soe.contact_id, soe.named_contact, soe.role_inbox,
            soe.status, soe.validation_at, soe.validation_expires_at, soe.masked_email, soe.staging_intent_id,
           soe.normalized_value_hash, soe.normalized_value_hash_version,
           soe.contact_business_link_decision_id, soe.contact_business_link_revision, soe.policy_version,
            soe.updated_at AS eligibility_updated_at, soe.zb_outcome, soe.raw_provider_status,
             soe.suppression_status, soe.validation_operation_id, soe.reused_from_operation_id,
           b.vertical AS raw_vertical,
           d.classifier_matched_target, d.classifier_version, d.classification_evidence_id,
           d.classification_policy_version, d.classification_evidence_hash,
           ce.taxonomy_version, ce.outcome AS evidence_outcome, ce.resolved_vertical_id,
           ce.evidence_hash AS evidence_hash, p.taxonomy_version AS current_taxonomy_version,
           p.policy_version AS current_classification_policy_version,
           c_link.id AS source_contact_link_decision_id, c_link.revision AS source_contact_link_revision,
            c_link.email AS source_contact_email, c_link.email_token_hash AS source_contact_email_token_hash,
            eligibility_review.id AS eligibility_review_id
    FROM sfp_outreach_eligibility soe
    JOIN businesses b ON b.id = soe.business_id
    JOIN sfp_cohort_decisions d
      ON d.cohort_run_id = soe.cohort_run_id AND d.business_id = soe.business_id AND d.selected = TRUE
    JOIN sfp_classification_evidence ce ON ce.id = d.classification_evidence_id
    JOIN sfp_cohort_runs cr ON cr.id = soe.cohort_run_id
    JOIN sfp_programs p ON p.id = cr.program_id
    LEFT JOIN LATERAL (
      SELECT c.email, c.email_token_hash, d.id, d.revision
        FROM contacts c
        JOIN contact_business_link_decisions d ON d.contact_id=c.id
       WHERE c.id=soe.contact_id AND c.business_id=soe.business_id
         AND c.archived_at IS NULL
         AND d.business_id=soe.business_id AND d.decision='verified' AND d.superseded_at IS NULL
       ORDER BY d.revision DESC
       LIMIT 1
    ) c_link ON soe.source_kind='contact'
    LEFT JOIN LATERAL (
      SELECT r.id
        FROM sfp_named_email_eligibility_reviews r
       WHERE r.eligibility_id=soe.id AND r.decision='approved'
         AND r.id=(SELECT rr.id FROM sfp_named_email_eligibility_reviews rr
                    WHERE rr.eligibility_id=soe.id ORDER BY rr.created_at DESC,rr.id DESC LIMIT 1)
         AND r.expected_updated_at=soe.updated_at
         AND r.policy_document_id=${activePolicy.id}::uuid
         AND r.policy_document_hash=${activePolicy.documentHash}
         AND r.validation_operation_id=COALESCE(soe.validation_operation_id,soe.reused_from_operation_id)
         AND r.source_kind=soe.source_kind
         AND r.source_reference_id=CASE soe.source_kind
           WHEN 'free' THEN soe.candidate_id::text
           WHEN 'paid' THEN soe.paid_candidate_evidence_id::text
           WHEN 'contact' THEN soe.contact_id::text
           ELSE '' END
         AND r.contact_business_link_decision_id IS NOT DISTINCT FROM soe.contact_business_link_decision_id
         AND r.contact_business_link_revision IS NOT DISTINCT FROM soe.contact_business_link_revision
         AND r.normalized_value_hash=soe.normalized_value_hash
         AND r.normalized_value_hash_version=soe.normalized_value_hash_version
         AND r.validation_expires_at=soe.validation_expires_at
         AND EXISTS (
           SELECT 1 FROM provider_observations po
            WHERE po.operation_id=r.validation_operation_id
              AND po.subject_type='business' AND po.subject_id=soe.business_id
              AND po.provider='zerobounce' AND po.outcome='valid'
         )
       ORDER BY r.created_at DESC LIMIT 1
    ) eligibility_review ON TRUE
    WHERE soe.cohort_run_id = ${opts.cohortRunId}::uuid
      AND soe.id = ANY(ARRAY[${sql.join(orderedIds.map((id) => sql`${id}::uuid`), sql`, `)}])
    ORDER BY soe.id
  `));
  // Re-order strictly by the canonical (sorted) id list — never trust the
  // DB's own row order for the preview array — so the same ID set always
  // produces the same preview row order regardless of query-plan behavior.
  const byId = new Map(eligibilityRows.map((r) => [String(r.id), r]));

  const foundIds = new Set(eligibilityRows.map((r) => String(r.id)));
  const previewRows: StagingV2PreviewRow[] = [];
  for (const id of orderedIds) {
    if (!foundIds.has(id)) {
      previewRows.push({ eligibilityId: id, businessId: -1, sourceKind: "free", vertical: null, packageKey: null, disposition: "blocked", blockedReason: "not_found_in_cohort", maskedEmail: null });
    }
  }

  // Snapshot hashing input per row — captures everything that could
  // invalidate this preview by the time execute() runs: disposition,
  // package key AND the exact package content/campaign/sequence pin behind
  // it, and the exact validation-expiry instant used to admit the row.
  // Package-key alone is not enough: a package_key can stay 'current' while
  // its underlying content_hash, campaign, or sequence changes underneath
  // it, and that must force a fresh preview too.
  const hashInputRows: Array<{ id: string; disposition: string; packageKey: string | null; packageContentHash: string | null; effectiveExpiresAtIso: string | null }> = [];
  const frozenClassificationPins = eligibilityRows.map((row: any) => ({
    eligibilityId: String(row.id),
    targetVertical: row.resolved_vertical_id ?? null,
    classifierVersion: row.classifier_version ?? null,
    taxonomyVersion: row.taxonomy_version ?? null,
    evidenceId: row.classification_evidence_id ?? null,
    evidenceHash: row.classification_evidence_hash ?? null,
    policyVersion: row.classification_policy_version ?? null,
    currentTaxonomyVersion: row.current_taxonomy_version ?? null,
    currentPolicyVersion: row.current_classification_policy_version ?? null,
    validationContactLinkDecisionId: row.contact_business_link_decision_id ?? null,
    validationContactLinkRevision: row.contact_business_link_revision ?? null,
    validationNormalizedValueHash: row.normalized_value_hash ?? null,
    validationNormalizedValueHashVersion: row.normalized_value_hash_version ?? null,
    currentContactLinkDecisionId: row.source_contact_link_decision_id ?? null,
    currentContactLinkRevision: row.source_contact_link_revision ?? null,
    eligibilityReviewId: row.eligibility_review_id ?? null,
  }));
  const typedSourcePins = eligibilityRows.map((row: any) => ({
    eligibilityId: String(row.id),
    sourceKind: row.source_kind ?? null,
    candidateId: row.candidate_id ?? null,
    paidCandidateEvidenceId: row.paid_candidate_evidence_id ?? null,
    contactId: row.contact_id ?? null,
    sourceContactLinkDecisionId: row.contact_business_link_decision_id ?? null,
    sourceContactLinkRevision: row.contact_business_link_revision ?? null,
    normalizedValueHash: row.normalized_value_hash ?? null,
    normalizedValueHashVersion: row.normalized_value_hash_version ?? null,
  }));

  for (const row of eligibilityRows) {
    const sourceKind = row.source_kind === "free" || row.source_kind === "paid" || row.source_kind === "contact"
      ? row.source_kind as "free" | "paid" | "contact"
      : "free";
    const targetVertical = String(row.resolved_vertical_id ?? "");
    const base: StagingV2PreviewRow = {
      eligibilityId: String(row.id), businessId: Number(row.business_id), sourceKind,
      vertical: targetVertical || null, packageKey: null, disposition: "eligible", maskedEmail: row.masked_email ?? null,
      sourceContactLinkDecisionId: row.contact_business_link_decision_id ? String(row.contact_business_link_decision_id) : undefined,
      sourceContactLinkRevision: row.contact_business_link_revision == null ? undefined : Number(row.contact_business_link_revision),
      normalizedValueHashVersion: row.normalized_value_hash_version == null ? undefined : Number(row.normalized_value_hash_version),
      sourceReferenceId: row.source_kind === "free" ? String(row.candidate_id ?? "")
        : row.source_kind === "paid" ? String(row.paid_candidate_evidence_id ?? "")
          : row.source_kind === "contact" ? String(row.contact_id ?? "") : undefined,
      normalizedValueHash: row.normalized_value_hash == null ? undefined : String(row.normalized_value_hash),
      classificationEvidenceId: row.classification_evidence_id == null ? undefined : String(row.classification_evidence_id),
      classificationEvidenceHash: row.classification_evidence_hash == null ? undefined : String(row.classification_evidence_hash),
    };
    if (!["free", "paid", "contact"].includes(String(row.source_kind)) ||
        (row.source_kind === "free" && (!row.candidate_id || row.paid_candidate_evidence_id || row.contact_id)) ||
        (row.source_kind === "paid" && (!row.paid_candidate_evidence_id || row.candidate_id || row.contact_id)) ||
        (row.source_kind === "contact" && (!row.contact_id || row.candidate_id || row.paid_candidate_evidence_id))) {
      previewRows.push({ ...base, disposition: "blocked", blockedReason: "source_reference_invalid" });
      hashInputRows.push({ id: String(row.id), disposition: "blocked", packageKey: null, packageContentHash: null, effectiveExpiresAtIso: null });
      continue;
    }
    if (row.source_kind === "contact") {
      const sourceHash = normalizedContactHash(row.source_contact_email, row.normalized_value_hash_version);
      if (!row.contact_business_link_decision_id || !row.contact_business_link_revision ||
          row.normalized_value_hash_version == null ||
          ![0, 1].includes(Number(row.normalized_value_hash_version)) ||
          String(row.contact_business_link_decision_id) !== String(row.source_contact_link_decision_id ?? "") ||
          Number(row.contact_business_link_revision) !== Number(row.source_contact_link_revision) ||
          sourceHash !== String(row.normalized_value_hash ?? "") ||
          String(row.source_contact_email_token_hash ?? "") !== (hashEmailToken(String(row.source_contact_email ?? "")) ?? "")) {
        previewRows.push({ ...base, disposition: "blocked", blockedReason: "contact_link_or_email_pin_stale" });
        hashInputRows.push({ id: String(row.id), disposition: "blocked", packageKey: null, packageContentHash: null, effectiveExpiresAtIso: null });
        continue;
      }
    }
    const approvedNamedReview = row.status === "validated_review_required" &&
      row.named_contact === true && row.zb_outcome === "valid" &&
      row.suppression_status === "not_suppressed" &&
      !!(row.validation_operation_id || row.reused_from_operation_id);
    if (row.status !== "validated_outreach_eligible" &&
        !(approvedNamedReview && row.eligibility_review_id &&
          activePolicy.roleInboxPolicy?.named_or_unclassified_requires_review !== false)) {
      const emailPolicy = evaluateSfpEmailTypePolicy({
        namedContact: row.named_contact === true,
        roleInbox: row.role_inbox === true,
        policy: activePolicy,
      });
      previewRows.push({
        ...base,
        disposition: "blocked",
        blockedReason: row.named_contact === true && row.status === "validated_review_required"
          ? emailPolicy.status === "eligibility_review_required"
            ? emailPolicy.reasonCode
            : "named_email_policy_status_mismatch"
          : `status_${row.status}`,
      });
      hashInputRows.push({ id: String(row.id), disposition: "blocked", packageKey: null, packageContentHash: null, effectiveExpiresAtIso: null });
      continue;
    }
    if (row.staging_intent_id) {
      // Crash-resumption reconstruction: if the existing intent belongs to
      // the command currently being resumed, rebuild the SAME 'eligible'
      // preview row (same package/policy pin the intent already recorded)
      // instead of reclassifying it as blocked — this keeps the snapshot
      // hash identical to the original preview so a resumed
      // executeStagingV2() doesn't fail closed with a false-positive
      // SFP_STAGING_SNAPSHOT_DRIFTED before its own idempotent-no-op check
      // (in stageOneRowTransactional) ever gets a chance to run.
      if (opts.resumeCommandKey) {
        const existingIntent = rows(await db.execute(sql`
          SELECT command_key, package_key, policy_document_hash, validation_snapshot
          FROM sfp_campaign_staging_intents WHERE id = ${String(row.staging_intent_id)}::uuid LIMIT 1
        `))[0];
        if (existingIntent && existingIntent.command_key === opts.resumeCommandKey) {
          const snapshot = (existingIntent.validation_snapshot ?? {}) as any;
          const pinnedPackageContentHash: string | null = snapshot.pinnedPackageContentHash ?? null;
          const validationExpiresAtIso: string | null = snapshot.validationExpiresAt ?? null;
          previewRows.push({
            ...base,
            packageKey: existingIntent.package_key ?? null,
            disposition: "eligible",
            packageContentHash: pinnedPackageContentHash ?? undefined,
            policyDocumentHash: existingIntent.policy_document_hash ?? undefined,
            policyId: activePolicy.id,
            policyVersion: activePolicy.version,
            validationExpiresAt: validationExpiresAtIso ?? undefined,
          });
          hashInputRows.push({
            id: String(row.id), disposition: "eligible",
            packageKey: existingIntent.package_key ?? null,
            packageContentHash: pinnedPackageContentHash,
            effectiveExpiresAtIso: validationExpiresAtIso,
          });
          continue;
        }
      }
      previewRows.push({ ...base, disposition: "blocked", blockedReason: "already_has_staging_intent" });
      hashInputRows.push({ id: String(row.id), disposition: "blocked", packageKey: null, packageContentHash: null, effectiveExpiresAtIso: null });
      continue;
    }
    const effectiveExpiresAt = row.validation_expires_at
      ? new Date(String(row.validation_expires_at))
      : row.validation_at
        ? new Date(new Date(String(row.validation_at)).getTime() + activePolicy.validationTtlDays * 86_400_000)
        : null;
    if (!effectiveExpiresAt || effectiveExpiresAt.getTime() < Date.now()) {
      previewRows.push({ ...base, disposition: "blocked", blockedReason: "validation_stale" });
      hashInputRows.push({ id: String(row.id), disposition: "blocked", packageKey: null, packageContentHash: null, effectiveExpiresAtIso: null });
      continue;
    }
    if (!isFrozenV2ClassificationAdmissible({
      targetVertical,
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
    })) {
      previewRows.push({ ...base, disposition: "blocked", blockedReason: "frozen_v2_classification_unresolved_or_stale" });
      hashInputRows.push({ id: String(row.id), disposition: "blocked", packageKey: null, packageContentHash: null, effectiveExpiresAtIso: null });
      continue;
    }
    const emailPolicy = evaluateSfpEmailTypePolicy({
      namedContact: row.named_contact === true,
      roleInbox: row.role_inbox === true,
      policy: activePolicy,
    });
    if (emailPolicy.status === "eligibility_review_required" &&
        !(approvedNamedReview && row.eligibility_review_id &&
          activePolicy.roleInboxPolicy?.named_or_unclassified_requires_review !== false)) {
      previewRows.push({ ...base, disposition: "blocked", blockedReason: emailPolicy.reasonCode });
      hashInputRows.push({ id: String(row.id), disposition: "blocked", packageKey: null, packageContentHash: null, effectiveExpiresAtIso: null });
      continue;
    }
    const pkg = await getCurrentPackageForVertical(targetVertical);
    if (!pkg || !pkg.packageKey.endsWith(".v2")) {
      previewRows.push({ ...base, disposition: "blocked", blockedReason: "no_current_package_for_vertical" });
      hashInputRows.push({ id: String(row.id), disposition: "blocked", packageKey: null, packageContentHash: null, effectiveExpiresAtIso: null });
      continue;
    }
    // PM-12: surface the exact package version / policy pin / validation
    // freshness an operator needs to review THIS row before confirming —
    // not just the aggregate counts previously shown.
    previewRows.push({
      ...base,
      packageKey: pkg.packageKey,
      disposition: "eligible",
      packageVersionId: pkg.id,
      packageContentHash: pkg.contentHash,
      policyId: activePolicy.id,
      policyVersion: activePolicy.version,
      policyDocumentHash: activePolicy.documentHash,
      validationExpiresAt: effectiveExpiresAt.toISOString(),
      validationAgeSeconds: row.validation_at ? Math.max(0, Math.round((Date.now() - new Date(String(row.validation_at)).getTime()) / 1000)) : undefined,
      eligibilityReviewId: row.eligibility_review_id ? String(row.eligibility_review_id) : undefined,
    });
    hashInputRows.push({ id: String(row.id), disposition: "eligible", packageKey: pkg.packageKey, packageContentHash: pkg.contentHash, effectiveExpiresAtIso: effectiveExpiresAt.toISOString() });
  }

  const eligibleCount = previewRows.filter((r) => r.disposition === "eligible").length;
  const blockedCount = previewRows.length - eligibleCount;
  const policyDocumentHash = activePolicy.documentHash;

  const snapshotHash = sha256({
    cohortRunId: opts.cohortRunId,
    eligibilityIds: [...opts.eligibilityIds].sort(),
    policyDocumentHash,
    rows: hashInputRows,
    frozenClassificationPins,
    typedSourcePins,
    attemptSalt: opts.attemptSalt ?? null,
  });
  const commandKey = `sfp-stage-v2:${opts.cohortRunId}:${snapshotHash}`;
  const payloadHash = sha256({ cohortRunId: opts.cohortRunId, eligibilityIds: orderedIds });

  return {
    cohortRunId: opts.cohortRunId,
    snapshotHash,
    commandKey,
    payloadHash,
    policyDocumentHash,
    policyId: activePolicy.id,
    policyVersion: activePolicy.version,
    rows: previewRows,
    eligibleCount,
    blockedCount,
    outcomeLabel: "READY_HELD_PENDING_CONFIRMATION",
    capturedAt: new Date().toISOString(),
  };
}

export interface StagingV2ExecuteResult {
  commandKey: string;
  readyHeld: number;
  stagedIntents: Array<{ eligibilityId: string; intentId: string }>;
  rejected: number;
  reasons: Record<string, number>;
  zeroOutreachConfirmed: true;
  replayed: boolean;
  completedAt: string;
}

async function listStagedIntentIdsForCommand(
  cohortRunId: string,
  commandKey: string,
  eligibilityIds: string[],
): Promise<Array<{ eligibilityId: string; intentId: string }>> {
  const orderedIds = canonicalizeEligibilityIds(eligibilityIds);
  if (orderedIds.length === 0) return [];
  const stagedRows = rows(await db.execute(sql`
    SELECT eligibility_id, id
      FROM sfp_campaign_staging_intents
     WHERE cohort_run_id = ${cohortRunId}::uuid
       AND command_key = ${commandKey}
       AND eligibility_id = ANY(ARRAY[${sql.join(orderedIds.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[])
     ORDER BY eligibility_id ASC
  `));
  return stagedRows.map((row: any) => ({
    eligibilityId: String(row.eligibility_id),
    intentId: String(row.id),
  }));
}

/**
 * Transactional, snapshot-bound execution. Requires the exact commandKey +
 * snapshotHash returned by a prior previewStagingV2() call. Same commandKey
 * + same payload replays the stored result verbatim; same commandKey with a
 * mismatched payload fails closed with a 409 (never a silent overwrite).
 */
export async function executeStagingV2(opts: {
  cohortRunId: string;
  eligibilityIds: string[];
  commandKey: string;
  snapshotHash: string;
  actorId: string;
  /**
   * PM-12 correction: the caller must echo back the exact payloadHash the
   * preview it is confirming reported. commandKey/snapshotHash alone bind
   * to the ID *set*, but a UI holding a stale render of the same preview
   * object could otherwise re-submit execute without the operator having
   * actually seen (or re-fetched) the row-level package/policy detail this
   * payloadHash was computed over. A mismatch fails closed with 409 rather
   * than silently executing against unconfirmed detail.
   */
  confirmPayloadHash: string;
  /**
   * Double-ledger fix: the recurring worker (sfp-campaign-staging-worker.ts)
   * claims and owns its own `sfp_stage_runs` row before it ever calls this
   * function. Without this, executeStagingV2() would independently call
   * getOrCreateStageRun() keyed by commandKey and create a SECOND run (and
   * a second sfp_stage_items row per business) for the same recurring
   * batch. When the caller already owns a run, it passes that run's id
   * here so ensureStageItem()/markStageItem*() write into the caller's own
   * ledger row instead of manufacturing a parallel one.
   */
  stageRunId?: string;
  /**
   * Retry-contract correction: must be the exact same value the paired
   * previewStagingV2() call used to derive commandKey/snapshotHash — see
   * previewStagingV2's attemptSalt doc. Threaded through to the internal
   * freshness re-derivation below so it reproduces the identical
   * snapshotHash rather than false-positive SFP_STAGING_SNAPSHOT_DRIFTED.
   */
  attemptSalt?: string;
}): Promise<StagingV2ExecuteResult> {
  if (!opts.eligibilityIds || opts.eligibilityIds.length === 0) {
    throw new SfpStagingV2Error("SFP_STAGING_NO_SELECTION", "eligibilityIds must be explicitly provided and non-empty", 400);
  }
  if (opts.eligibilityIds.length > MAX_BATCH_SIZE) {
    throw new SfpStagingV2Error("SFP_STAGING_BATCH_TOO_LARGE", `at most ${MAX_BATCH_SIZE} eligibility IDs may be staged per command`, 400);
  }

  // The commandKey is server-issued by previewStagingV2() as a deterministic
  // function of cohortRunId + snapshotHash. Validate that the supplied
  // commandKey actually corresponds to the supplied snapshotHash/cohortRunId
  // rather than trusting the caller's pairing of the two — otherwise a
  // caller could present a valid commandKey/snapshotHash pair from a
  // different (or stale) preview than the one it claims to match.
  const expectedCommandKey = `sfp-stage-v2:${opts.cohortRunId}:${opts.snapshotHash}`;
  if (opts.commandKey !== expectedCommandKey) {
    throw new SfpStagingV2Error("SFP_STAGING_COMMAND_KEY_MISMATCH", "commandKey does not correspond to the given cohortRunId/snapshotHash", 400);
  }

  const orderedIds = canonicalizeEligibilityIds(opts.eligibilityIds);
  const payloadHash = sha256({ cohortRunId: opts.cohortRunId, eligibilityIds: orderedIds });
  if (!opts.confirmPayloadHash || opts.confirmPayloadHash !== payloadHash) {
    throw new SfpStagingV2Error("SFP_STAGING_PAYLOAD_NOT_CONFIRMED", "confirmPayloadHash does not match the payload derived from cohortRunId/eligibilityIds — re-fetch preview and confirm its exact payloadHash", 409);
  }

  // PM-04 correction: claim the command as 'pending' BEFORE any per-row work
  // starts, and only ever transition it forward (pending -> executing ->
  // completed) via a WHERE-guarded UPDATE. This makes the command row —
  // not an in-memory loop — the durable source of truth for "has this
  // command already run", so a crash between a row's commit and the old
  // "insert receipt last" step can no longer produce an ambiguous state:
  // the row exists, in 'executing', and a retry resumes into it rather than
  // re-deriving a preview that would see the just-committed rows as
  // "already_has_staging_intent" and misreport SFP_STAGING_SNAPSHOT_DRIFTED.
  const claim = rows(await db.execute(sql`
    INSERT INTO sfp_campaign_staging_commands (cohort_run_id, command_key, payload_hash, snapshot_hash, actor_id, state)
    VALUES (${opts.cohortRunId}::uuid, ${opts.commandKey}, ${payloadHash}, ${opts.snapshotHash}, ${opts.actorId}, 'pending')
    ON CONFLICT (command_key) DO NOTHING
    RETURNING id, state, payload_hash, stored_result
  `))[0];

  if (!claim) {
    // Someone else's row already exists for this exact command_key — lock
    // and read the canonical row rather than racing another in-memory
    // result. Loop briefly if it is still 'executing' (a concurrent caller
    // is actively finishing it).
    for (let attempt = 0; attempt < 20; attempt++) {
      const canonical = rows(await db.execute(sql`
        SELECT payload_hash, snapshot_hash, stored_result, state FROM sfp_campaign_staging_commands
        WHERE command_key = ${opts.commandKey} LIMIT 1
      `))[0];
      if (!canonical) break; // vanishingly unlikely; fall through to re-claim below
      if (canonical.payload_hash !== payloadHash) {
        throw new SfpStagingV2Error("SFP_STAGING_COMMAND_PAYLOAD_MISMATCH", "commandKey already used with a different payload; request a new preview", 409);
      }
      if (canonical.state === "completed" && canonical.stored_result) {
        return {
          ...(canonical.stored_result as any),
          stagedIntents: await listStagedIntentIdsForCommand(opts.cohortRunId, opts.commandKey, orderedIds),
          replayed: true,
        };
      }
      // pending/executing: another caller (or a prior crashed attempt) owns
      // it. Give it a moment, then re-check; if it never converges, fall
      // through and attempt to resume it ourselves below.
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  // Either we hold the fresh 'pending' claim, or no other caller ever
  // completed it — transition (or re-affirm) 'executing' and proceed. This
  // UPDATE is idempotent for a resumed same-process retry.
  await db.execute(sql`
    UPDATE sfp_campaign_staging_commands SET state = 'executing'
    WHERE command_key = ${opts.commandKey} AND state IN ('pending', 'executing')
  `);

  // Re-derive the preview fresh — a stale snapshotHash (drifted policy,
  // package mapping, or eligibility state since the client's preview call)
  // must fail closed and force a new preview rather than staging against
  // out-of-date dispositions. Resumed same-command rows are reconciled as
  // idempotent no-ops inside stageOneRowTransactional(), not reclassified
  // as drift, because they carry this exact commandKey.
  const freshPreview = await previewStagingV2({ cohortRunId: opts.cohortRunId, eligibilityIds: orderedIds, actorId: opts.actorId, resumeCommandKey: opts.commandKey, attemptSalt: opts.attemptSalt });
  if (freshPreview.snapshotHash !== opts.snapshotHash) {
    throw new SfpStagingV2Error("SFP_STAGING_SNAPSHOT_DRIFTED", "snapshot has drifted since preview (policy/package/eligibility changed) — request a new preview", 409);
  }

  // PM-10 correction: every command — manual or recurring — gets its own
  // durable sfp_stage_runs row (keyed 1:1 to this commandKey) and one
  // sfp_stage_items row per business attempted, so a staging mutation, its
  // item outcome, and the run's aggregate counters can never diverge, and
  // the same row/item ledger the recurring worker relies on for retries,
  // dead-letter tracking, and telemetry also covers manual staging.
  const stageRunId = opts.stageRunId ?? await getOrCreateStageRun({
    cohortRunId: opts.cohortRunId,
    actorId: opts.actorId,
    idempotencyKey: opts.commandKey,
    maxItems: freshPreview.rows.length,
  });

  let readyHeld = 0;
  const stagedIntents: Array<{ eligibilityId: string; intentId: string }> = [];
  let rejected = 0;
  const reasons: Record<string, number> = {};
  // Retry-contract correction: a worker-owned run already bumped
  // attempt_count once at claim time (sfp-campaign-staging-worker.ts) for
  // every item in this batch. Bumping it again here on completion/dead-letter
  // would count one real attempt twice against MAX_ATTEMPTS.
  const isWorkerOwnedAttempt = !!opts.stageRunId;

  for (const previewRow of freshPreview.rows) {
    const itemId = await ensureStageItem(stageRunId, previewRow.businessId);
    if (previewRow.disposition === "blocked") {
      rejected++;
      const reason = previewRow.blockedReason ?? "blocked";
      reasons[reason] = (reasons[reason] ?? 0) + 1;
      await markStageItemDeadLetter(itemId, reason, { incrementAttempt: !isWorkerOwnedAttempt });
      continue;
    }
    try {
      const intentId = await stageOneRowTransactional({
        cohortRunId: opts.cohortRunId,
        eligibilityId: previewRow.eligibilityId,
        businessId: previewRow.businessId,
        sourceKind: previewRow.sourceKind,
        sourceContactLinkDecisionId: previewRow.sourceContactLinkDecisionId,
        sourceContactLinkRevision: previewRow.sourceContactLinkRevision,
        normalizedValueHashVersion: previewRow.normalizedValueHashVersion,
        sourceReferenceId: previewRow.sourceReferenceId,
        normalizedValueHash: previewRow.normalizedValueHash,
        classificationEvidenceId: previewRow.classificationEvidenceId,
        classificationEvidenceHash: previewRow.classificationEvidenceHash,
        eligibilityReviewId: previewRow.eligibilityReviewId,
        packageKey: previewRow.packageKey!,
        actorId: opts.actorId,
        commandKey: opts.commandKey,
        payloadHash,
        snapshotHash: opts.snapshotHash,
        stageItemId: itemId,
        incrementAttempt: !isWorkerOwnedAttempt,
      });
      readyHeld++;
      stagedIntents.push({ eligibilityId: previewRow.eligibilityId, intentId });
    } catch (err: any) {
      rejected++;
      const code = err instanceof SfpStagingV2Error ? err.code : "staging_transaction_failed";
      reasons[code] = (reasons[code] ?? 0) + 1;
      await markStageItemDeadLetter(itemId, code, { incrementAttempt: !isWorkerOwnedAttempt });
    }
  }

  // Counters are recomputed FROM the item rows just written, never
  // incremented ad hoc — the run row can never disagree with what the
  // items actually show, including on a resumed/retried command.
  //
  // Retry-lifecycle fix: when the caller (the recurring worker) passed its
  // own stageRunId, that run is worker-owned — the worker still has retry
  // backoff and dead-letter-vs-pending decisions to make on top of these
  // item rows, and it applies its own final pending/completed/failed
  // transition afterward. Terminalizing the run here would leave the
  // worker's later `state='running'`-guarded UPDATE matching zero rows
  // (the run already reads 'completed'), silently discarding retry state
  // and attaching new 'retry' items to a run no future tick will reclaim.
  // Only a manual (non-worker-owned) run — created above via
  // getOrCreateStageRun — is terminalized here, since nothing else will.
  if (opts.stageRunId) {
    await reconcileStageRunCounters(stageRunId);
  } else {
    await reconcileStageRunCounters(stageRunId, { setState: "completed" });
  }

  const result: StagingV2ExecuteResult = {
    commandKey: opts.commandKey,
    readyHeld,
    stagedIntents,
    rejected,
    reasons,
    zeroOutreachConfirmed: true,
    replayed: false,
    completedAt: new Date().toISOString(),
  };

  // Transition to 'completed' with a WHERE guard: if another concurrent
  // caller already completed this same command_key first, this UPDATE
  // matches zero rows — re-read and return ITS stored result rather than
  // our own locally computed one, so two racing callers converge on one
  // canonical receipt instead of each returning a "winning" local result.
  const completedRow = rows(await db.execute(sql`
    UPDATE sfp_campaign_staging_commands
       SET state = 'completed', stored_result = ${JSON.stringify(result)}::jsonb
     WHERE command_key = ${opts.commandKey} AND state != 'completed'
    RETURNING stored_result
  `))[0];
  if (!completedRow) {
    const canonical = rows(await db.execute(sql`
      SELECT stored_result FROM sfp_campaign_staging_commands WHERE command_key = ${opts.commandKey} LIMIT 1
    `))[0];
    if (canonical?.stored_result) {
      return {
        ...(canonical.stored_result as any),
        stagedIntents: await listStagedIntentIdsForCommand(opts.cohortRunId, opts.commandKey, orderedIds),
        replayed: true,
      };
    }
  }

  return result;
}

async function stageOneRowTransactional(opts: {
  cohortRunId: string; eligibilityId: string; businessId: number; sourceKind: "free" | "paid" | "contact";
  sourceContactLinkDecisionId?: string; sourceContactLinkRevision?: number;
  normalizedValueHashVersion?: number;
  sourceReferenceId?: string;
  normalizedValueHash?: string;
  classificationEvidenceId?: string;
  classificationEvidenceHash?: string;
  eligibilityReviewId?: string;
  packageKey: string; actorId: string; commandKey: string; payloadHash: string; snapshotHash: string;
  stageItemId: string; incrementAttempt?: boolean;
}): Promise<string> {
  const activePolicy = await getActiveSfpOutreachPolicy();
  return db.transaction(async (tx) => {
    await lockSfpEligibilityProjectionWriteGate(tx);
    await lockCurrentSfpOutreachPolicy(tx, activePolicy);
    let initialSourceAddress: string | null = null;
    if (opts.sourceKind === "contact" && Number.isSafeInteger(Number(opts.sourceReferenceId))) {
      const sourceContactNode: CommercialGraphNode = { type: "contact", id: Number(opts.sourceReferenceId) };
      const sourceBusinessNode: CommercialGraphNode = { type: "business", id: opts.businessId };
      const sourceGraphNodes = [sourceContactNode, sourceBusinessNode];
      await lockCommercialGraphNodes(tx, sourceGraphNodes);
      await lockCommercialGraphMembershipSets(tx, sourceGraphNodes, ["contact_business"]);
      const sourceContact = rows(await tx.execute(sql`
        SELECT email FROM contacts WHERE id=${Number(opts.sourceReferenceId)} AND archived_at IS NULL
      `))[0];
      initialSourceAddress = sourceContact?.email == null ? null : String(sourceContact.email);
    }
    const sharedCurrentGate = await checkCurrentSfpEligibilityAndPackage(tx, {
      eligibilityId: opts.eligibilityId,
      businessId: opts.businessId,
      cohortRunId: opts.cohortRunId,
      packageKey: opts.packageKey,
      eligibilityReviewId: opts.eligibilityReviewId,
      expectedSourceKind: opts.sourceKind,
      emailAddress: initialSourceAddress,
      projectionWrite: true,
    });
    if (!sharedCurrentGate.eligible) {
      throw new SfpStagingV2Error(
        `SFP_STAGING_${sharedCurrentGate.reason.toUpperCase()}`,
        `current eligibility/package predicate failed: ${sharedCurrentGate.reason}`,
        409,
      );
    }
    if (!isValidSfpSourceReference(mapSfpEligibilitySourceReference(sharedCurrentGate.row))) {
      throw new SfpStagingV2Error("SFP_STAGING_SOURCE_REFERENCE_INVALID", "source reference is not a valid one-of source", 422);
    }
    if (!sharedCurrentGate.row.normalized_value_hash
        || ![0, 1].includes(Number(sharedCurrentGate.row.normalized_value_hash_version))) {
      throw new SfpStagingV2Error(
        "SFP_STAGING_ADDRESS_IDENTITY_PIN_MISSING",
        "all typed source kinds require a versioned validated address identity",
        422,
      );
    }
    // Cohort/program still authorize staging as of the exact moment this row
    // is written (Defect 12). previewStagingV2()/executeStagingV2()'s fresh
    // preview only re-checks eligibility rows and package status — it never
    // re-derives cohort lifecycle or program activation, so a cohort voided
    // or a program deactivated between preview and this write must still be
    // caught here, inside the same transaction that commits the intent.
    const cohortRow = rows(await tx.execute(sql`
      SELECT r.cohort_state, r.voided_at, r.superseded_at, p.is_active AS program_active,
             p.taxonomy_version AS current_taxonomy_version, p.policy_version AS current_classification_policy_version
      FROM sfp_cohort_runs r
      JOIN sfp_programs p ON p.id = r.program_id
      WHERE r.id = ${opts.cohortRunId}::uuid
      LIMIT 1
    `))[0];
    if (!cohortRow) throw new SfpStagingV2Error("SFP_STAGING_COHORT_NOT_FOUND", "cohort run not found", 422);
    if (cohortRow.cohort_state !== "frozen" || cohortRow.voided_at || cohortRow.superseded_at) {
      throw new SfpStagingV2Error("SFP_STAGING_COHORT_NOT_FROZEN", `cohort is ${cohortRow.cohort_state}, not a live frozen cohort`, 409);
    }
    if (cohortRow.program_active !== true) {
      throw new SfpStagingV2Error("SFP_STAGING_PROGRAM_INACTIVE", "owning program is no longer active", 409);
    }

    // Lock the eligibility row for the duration of this transaction.
    const eligRow = rows(await tx.execute(sql`
      SELECT soe.id, soe.status, soe.source_kind, soe.candidate_id, soe.paid_candidate_evidence_id, soe.contact_id,
              soe.normalized_value_hash, soe.normalized_value_hash_version,
              soe.contact_business_link_decision_id, soe.contact_business_link_revision,
              soe.named_contact, soe.masked_email, soe.role_inbox,
              soe.staging_intent_id, soe.policy_version, soe.updated_at AS eligibility_updated_at,
              soe.zb_outcome, soe.raw_provider_status, soe.suppression_status,
              soe.validation_operation_id, soe.reused_from_operation_id,
             soe.validation_at, soe.validation_expires_at,
             b.canonical_name, b.website_domain, b.main_phone, b.vertical, b.city, b.state,
             d.classifier_matched_target, d.classifier_version, d.classification_evidence_id,
             d.classification_policy_version, d.classification_evidence_hash,
             ce.taxonomy_version, ce.outcome AS evidence_outcome, ce.resolved_vertical_id,
              ce.evidence_hash AS evidence_hash,
              eligibility_review.id AS eligibility_review_id
      FROM sfp_outreach_eligibility soe
      JOIN businesses b ON b.id = soe.business_id
      JOIN sfp_cohort_decisions d
        ON d.cohort_run_id = soe.cohort_run_id AND d.business_id = soe.business_id AND d.selected = TRUE
      JOIN sfp_classification_evidence ce ON ce.id = d.classification_evidence_id
      LEFT JOIN LATERAL (
        SELECT r.id
          FROM sfp_named_email_eligibility_reviews r
         WHERE r.eligibility_id=soe.id AND r.decision='approved'
           AND r.id=(SELECT rr.id FROM sfp_named_email_eligibility_reviews rr
                      WHERE rr.eligibility_id=soe.id ORDER BY rr.created_at DESC,rr.id DESC LIMIT 1)
           AND r.id=${opts.eligibilityReviewId ?? null}::uuid
           AND r.expected_updated_at=soe.updated_at
           AND r.policy_document_id=${activePolicy.id}::uuid
           AND r.policy_document_hash=${activePolicy.documentHash}
           AND r.validation_operation_id=COALESCE(soe.validation_operation_id,soe.reused_from_operation_id)
           AND r.source_kind=soe.source_kind
           AND r.source_reference_id=CASE soe.source_kind
             WHEN 'free' THEN soe.candidate_id::text
             WHEN 'paid' THEN soe.paid_candidate_evidence_id::text
             WHEN 'contact' THEN soe.contact_id::text ELSE '' END
           AND r.contact_business_link_decision_id IS NOT DISTINCT FROM soe.contact_business_link_decision_id
           AND r.contact_business_link_revision IS NOT DISTINCT FROM soe.contact_business_link_revision
           AND r.normalized_value_hash=soe.normalized_value_hash
           AND r.normalized_value_hash_version=soe.normalized_value_hash_version
           AND r.validation_expires_at=soe.validation_expires_at
           AND EXISTS (
             SELECT 1 FROM provider_observations po
              WHERE po.operation_id=r.validation_operation_id
                AND po.subject_type='business' AND po.subject_id=soe.business_id
                AND po.provider='zerobounce' AND po.outcome='valid'
           )
         LIMIT 1
      ) eligibility_review ON TRUE
      WHERE soe.id = ${opts.eligibilityId}::uuid
      FOR UPDATE OF soe
    `))[0];
    if (!eligRow) throw new SfpStagingV2Error("SFP_STAGING_ELIGIBILITY_NOT_FOUND", "eligibility row not found", 422);
    const reviewedNamedValid = eligRow.status === "validated_review_required" &&
      eligRow.named_contact === true && eligRow.zb_outcome === "valid" &&
      eligRow.suppression_status === "not_suppressed" &&
      (eligRow.validation_operation_id || eligRow.reused_from_operation_id) &&
      String(eligRow.eligibility_review_id ?? "") === String(opts.eligibilityReviewId ?? "") &&
      activePolicy.roleInboxPolicy?.named_or_unclassified_requires_review !== false;
    if (eligRow.status !== "validated_outreach_eligible" && !reviewedNamedValid) {
      throw new SfpStagingV2Error("SFP_STAGING_STATUS_DRIFTED", `eligibility status is now ${eligRow.status}`, 409);
    }
    if (!["free", "paid", "contact"].includes(String(eligRow.source_kind)) ||
        (eligRow.source_kind === "free" && (!eligRow.candidate_id || eligRow.paid_candidate_evidence_id || eligRow.contact_id)) ||
        (eligRow.source_kind === "paid" && (!eligRow.paid_candidate_evidence_id || eligRow.candidate_id || eligRow.contact_id)) ||
        (eligRow.source_kind === "contact" && (!eligRow.contact_id || eligRow.candidate_id || eligRow.paid_candidate_evidence_id))) {
      throw new SfpStagingV2Error("SFP_STAGING_SOURCE_REFERENCE_INVALID", "eligibility must have exactly one typed source reference", 422);
    }
    if (eligRow.source_kind !== opts.sourceKind) {
      throw new SfpStagingV2Error("SFP_STAGING_SOURCE_KIND_DRIFTED", "source kind changed since preview", 409);
    }
    const currentSourceReferenceId = eligRow.source_kind === "free"
      ? String(eligRow.candidate_id ?? "")
      : eligRow.source_kind === "paid"
        ? String(eligRow.paid_candidate_evidence_id ?? "")
        : String(eligRow.contact_id ?? "");
    if (currentSourceReferenceId !== String(opts.sourceReferenceId ?? "")) {
      throw new SfpStagingV2Error("SFP_STAGING_SOURCE_REFERENCE_DRIFTED", "typed source reference changed since preview", 409);
    }
    if (String(eligRow.normalized_value_hash ?? "") !== String(opts.normalizedValueHash ?? "")) {
      throw new SfpStagingV2Error("SFP_STAGING_EMAIL_IDENTITY_DRIFTED", "validated normalized email identity changed since preview", 409);
    }
    if (eligRow.source_kind === "contact" &&
        (String(eligRow.contact_business_link_decision_id ?? "") !== String(opts.sourceContactLinkDecisionId ?? "") ||
         Number(eligRow.contact_business_link_revision) !== Number(opts.sourceContactLinkRevision) ||
         Number(eligRow.normalized_value_hash_version) !== Number(opts.normalizedValueHashVersion))) {
      throw new SfpStagingV2Error("SFP_STAGING_CONTACT_VALIDATION_PIN_DRIFTED", "persisted contact validation pins changed since preview", 409);
    }
    if (eligRow.staging_intent_id) {
      // If the existing intent was created by THIS exact command (a
      // concurrent duplicate call, or a resumed retry after a crash between
      // this row's commit and the outer command receipt), treat it as an
      // idempotent no-op rather than an error — the row is already
      // durably ready_held under this command, so returning success here
      // lets a resumed executeStagingV2() loop reconverge to the true
      // persisted count instead of a stale in-memory one.
      const existingIntent = rows(await tx.execute(sql`
        SELECT command_key, state, validation_snapshot
          FROM sfp_campaign_staging_intents WHERE id = ${String(eligRow.staging_intent_id)}::uuid
      `))[0];
      if (existingIntent && existingIntent.command_key === opts.commandKey && existingIntent.state === "ready_held") {
        await markStageItemCompletedInTx(tx, opts.stageItemId, "ready_held", { incrementAttempt: opts.incrementAttempt ?? true });
        if (!(await isCurrentSfpValidationReceiptFresh(tx, {
          eligibilityId: opts.eligibilityId,
          businessId: opts.businessId,
          emailTokenHash: String(existingIntent.validation_snapshot?.validatedEmailTokenHash ?? ""),
        }))) {
          throw new SfpStagingV2Error("SFP_STAGING_VALIDATION_EXPIRED_AT_COMMIT", "provider receipt expired before transaction commit", 409);
        }
        return String(eligRow.staging_intent_id);
      }
      throw new SfpStagingV2Error("SFP_STAGING_ALREADY_HAS_INTENT", "eligibility already has a staging intent", 409);
    }

    // Re-check validation freshness at the exact moment of the write, not
    // just at preview time — the preview snapshot can be minutes old by the
    // time a queued/retried row actually reaches this transaction.
    const effectiveExpiresAt = eligRow.validation_expires_at
      ? new Date(String(eligRow.validation_expires_at))
      : eligRow.validation_at
        ? new Date(new Date(String(eligRow.validation_at)).getTime() + activePolicy.validationTtlDays * 86_400_000)
        : null;
    if (!effectiveExpiresAt || effectiveExpiresAt.getTime() < Date.now()) {
      throw new SfpStagingV2Error("SFP_STAGING_VALIDATION_STALE", "validation has expired since preview", 409);
    }

    const targetVertical = String(eligRow.resolved_vertical_id ?? "");
    if (!isFrozenV2ClassificationAdmissible({
      targetVertical,
      classifierVersion: eligRow.classifier_version,
      taxonomyVersion: eligRow.taxonomy_version,
      currentTaxonomyVersion: cohortRow.current_taxonomy_version,
      classificationPolicyVersion: eligRow.classification_policy_version,
      currentPolicyVersion: cohortRow.current_classification_policy_version,
      decisionTarget: eligRow.classifier_matched_target,
      evidenceTarget: eligRow.resolved_vertical_id,
      evidenceOutcome: eligRow.evidence_outcome,
      decisionEvidenceHash: eligRow.classification_evidence_hash,
      evidenceHash: eligRow.evidence_hash,
    })) {
      throw new SfpStagingV2Error("SFP_STAGING_CLASSIFICATION_STALE", "frozen v2 classifier evidence is stale, conflicting, or unresolved", 422);
    }
    if (String(eligRow.classification_evidence_id) !== String(opts.classificationEvidenceId ?? "") ||
        String(eligRow.classification_evidence_hash) !== String(opts.classificationEvidenceHash ?? "")) {
      throw new SfpStagingV2Error("SFP_STAGING_CLASSIFICATION_DRIFTED", "frozen classifier evidence changed since preview", 409);
    }
    const emailPolicy = evaluateSfpEmailTypePolicy({
      namedContact: eligRow.named_contact === true,
      roleInbox: eligRow.role_inbox === true,
      policy: activePolicy,
    });
    if (emailPolicy.status !== "eligible_for_staging_review") {
      if (!reviewedNamedValid) {
        throw new SfpStagingV2Error("SFP_STAGING_EMAIL_POLICY_REVIEW_REQUIRED", emailPolicy.reasonCode, 422);
      }
    }

    // Package still current; campaign draft; sequence paused (Defect 12).
    const pkgRow = rows(await tx.execute(sql`
      SELECT v.id, v.campaign_id, v.sequence_id, v.content_hash, c.status AS campaign_status, s.status AS sequence_status
      FROM sfp_campaign_package_versions v
      JOIN campaigns c ON c.id = v.campaign_id
      JOIN follow_up_sequences s ON s.id = v.sequence_id
      WHERE v.package_key = ${opts.packageKey} AND v.lifecycle_state = 'current'
      LIMIT 1
    `))[0];
    if (!pkgRow) throw new SfpStagingV2Error("SFP_STAGING_PACKAGE_NOT_CURRENT", "package mapping is no longer current", 409);
    if (!String(opts.packageKey).endsWith(".v2") || !String(targetVertical) ||
        String(rows(await tx.execute(sql`
          SELECT vertical FROM sfp_campaign_package_versions
           WHERE id=${String(pkgRow.id)}::uuid
        `))[0]?.vertical ?? "") !== targetVertical) {
      throw new SfpStagingV2Error("SFP_STAGING_PACKAGE_CLASSIFICATION_MISMATCH", "package does not match the frozen v2 classifier target", 422);
    }
    if (pkgRow.campaign_status !== "draft") throw new SfpStagingV2Error("SFP_STAGING_PACKAGE_CAMPAIGN_NOT_DRAFT", "target campaign is no longer draft", 409);
    if (pkgRow.sequence_status !== "paused") throw new SfpStagingV2Error("SFP_STAGING_PACKAGE_SEQUENCE_NOT_PAUSED", "target sequence is no longer paused", 409);

    // Recompute the package's content hash LIVE, from the actual campaign +
    // sequence + step rows, inside this same transaction — never trust the
    // stored content_hash column alone. A copy edit or content-revision bump
    // to the pinned campaign/sequence after the package version was marked
    // `current` must be caught here and fail closed, not silently pinned.
    const liveContentHash = await computeLivePackageContentHash(tx, Number(pkgRow.campaign_id), Number(pkgRow.sequence_id));
    if (liveContentHash !== String(pkgRow.content_hash)) {
      throw new SfpStagingV2Error("SFP_STAGING_PACKAGE_CONTENT_DRIFTED", "campaign/sequence content has changed since this package version was pinned — reissue the package version before staging", 409);
    }

    // Pin the exact, authoritative policy document hash actually used to
    // admit this row — PM-05 correction: the prior implementation stored
    // sha256(activePolicy) (a locally re-derived hash of the in-process
    // object) rather than the canonical `activePolicy.documentHash` the
    // policy authority itself persists and versions. The two can diverge if
    // the in-memory policy object ever gains a field that isn't part of the
    // documented hash contract, silently pinning an unverifiable value.
    const pinnedPolicyHash = activePolicy.documentHash;
    const pinnedPackageContentHash = liveContentHash;

    // The policy control row was locked FOR SHARE at transaction entry. That
    // lock pins the pointer until commit: upgrading it to FOR UPDATE here
    // would deadlock against other eligibility writers at the global gate.
    const lockedPolicyControl = rows(await tx.execute(sql`
      SELECT active_policy_id FROM sfp_outreach_policy_control WHERE singleton = TRUE FOR SHARE
    `))[0];
    if (!lockedPolicyControl || String(lockedPolicyControl.active_policy_id) !== activePolicy.id) {
      throw new SfpStagingV2Error("SFP_STAGING_POLICY_DRIFTED", "active outreach policy changed since preview — request a new preview", 409);
    }

    // PM-05 correction: reuse the canonical, executor-aware safety-gate
    // authority (DBPR + existing-customer + consent-tier) instead of a
    // second, duplicated inline implementation — bound to `tx` so it reads
    // the same locked snapshot as everything else in this transaction.
    let consentEmailHash = String(eligRow.normalized_value_hash ?? "");
    let consentEmailAddress: string | null = null;
    if (eligRow.source_kind === "contact" && eligRow.contact_id) {
      const consentSource = rows(await tx.execute(sql`
        SELECT email FROM contacts WHERE id=${Number(eligRow.contact_id)} AND archived_at IS NULL
      `))[0];
      consentEmailAddress = consentSource?.email == null ? null : String(consentSource.email);
      consentEmailHash = hashEmailToken(String(consentEmailAddress ?? "")) ?? "";
    }
    const consentTier = consentEmailHash
      ? await lookupConsentTierByEmailHash(consentEmailHash, tx)
      : null;
    const gate = await evaluateSfpMutableSafetyGates({
      businessId: opts.businessId, consentTier, policy: activePolicy,
      emailAddress: consentEmailAddress,
    }, tx);
    if (!gate.eligible) {
      throw new SfpStagingV2Error(`SFP_STAGING_${gate.reasonCode.toUpperCase()}`, `safety gate failed: ${gate.reasonCode}`, 422);
    }

    // Suppression re-check against the masked/normalized hash on file, bound
    // to this same transaction rather than the global DB helper.
    if (eligRow.normalized_value_hash && eligRow.source_kind !== "contact") {
      const suppressed = await isCanonicallySuppressed([String(eligRow.normalized_value_hash)], tx);
      if (suppressed) throw new SfpStagingV2Error("SFP_STAGING_SUPPRESSED", "candidate address is suppressed", 422);
    }

    let idempotencyKey = opts.commandKey;
    let intentValues: {
      candidateId: string | null; paidCandidateEvidenceId: string | null; sourceContactId: number | null;
      contactEmailTokenHash: string; maskedEmailForLead: string | null;
      sourceContactLinkDecisionId: string | null; sourceContactLinkRevision: number | null;
      normalizedValueHash: string; normalizedValueHashVersion: number;
    };
    // Plaintext remains inside the audited callback. It is used to claim the
    // program/address identity before any master-lead projection is written.
    let sourceContactName: string | null = null;
    let sourceContactTitle: string | null = null;

    const reference = opts.sourceKind === "free"
      ? (() => {
          if (!eligRow.candidate_id) throw new SfpStagingV2Error("SFP_STAGING_CANDIDATE_MISSING", "free-source row missing candidate_id", 422);
          return { sourceKind: "free" as const, freeDiscoveryCandidateId: String(eligRow.candidate_id) };
        })()
      : opts.sourceKind === "paid"
      ? (() => {
          if (!eligRow.paid_candidate_evidence_id) throw new SfpStagingV2Error("SFP_STAGING_PAID_EVIDENCE_MISSING", "paid-source row missing paid_candidate_evidence_id", 422);
          return { sourceKind: "paid" as const, paidCandidateEvidenceId: String(eligRow.paid_candidate_evidence_id) };
        })()
      : await (async () => {
          if (!eligRow.contact_id) throw new SfpStagingV2Error("SFP_STAGING_CONTACT_SOURCE_MISSING", "contact-source row missing contact_id", 422);
           if (!eligRow.contact_business_link_decision_id || !eligRow.contact_business_link_revision ||
               eligRow.normalized_value_hash_version == null ||
               ![0, 1].includes(Number(eligRow.normalized_value_hash_version))) {
             throw new SfpStagingV2Error("SFP_STAGING_CONTACT_VALIDATION_PIN_MISSING", "contact source lacks its validation-time link and identity pins", 422);
           }
          const sourceContactId = Number(eligRow.contact_id);
          const verifiedLink = rows(await tx.execute(sql`
             SELECT c.id, c.email, c.email_token_hash, c.first_name,c.last_name,c.title,
                    d.id AS decision_id, d.revision
              FROM contacts c
              JOIN contact_business_link_decisions d ON d.contact_id=c.id
             WHERE c.id=${sourceContactId}
               AND c.business_id=${opts.businessId}
               AND c.archived_at IS NULL
               AND d.business_id=${opts.businessId}
                AND d.id=${String(eligRow.contact_business_link_decision_id)}::uuid
                AND d.revision=${Number(eligRow.contact_business_link_revision)}
               AND d.decision='verified' AND d.superseded_at IS NULL
             LIMIT 2
              FOR SHARE OF d
          `));
          if (verifiedLink.length !== 1) {
            throw new SfpStagingV2Error("SFP_STAGING_CONTACT_LINK_NOT_VERIFIED", "source contact has no unique current verified link to this business", 422);
          }
          const linkedContact = verifiedLink[0];
           sourceContactName = [linkedContact.first_name, linkedContact.last_name].filter(Boolean).join(" ").trim() || null;
           sourceContactTitle = linkedContact.title == null ? null : String(linkedContact.title);
          if (String(linkedContact.decision_id) !== String(opts.sourceContactLinkDecisionId ?? "") ||
              Number(linkedContact.revision) !== Number(opts.sourceContactLinkRevision)) {
            throw new SfpStagingV2Error("SFP_STAGING_CONTACT_LINK_REVISION_DRIFTED", "verified source-contact link changed after preview", 409);
          }
           const currentEmailHash = normalizedContactHash(linkedContact.email, eligRow.normalized_value_hash_version);
          const contactTokenHash = hashEmailToken(String(linkedContact.email ?? ""));
          if (!linkedContact.email || currentEmailHash !== String(eligRow.normalized_value_hash ?? "") || !contactTokenHash ||
              String(linkedContact.email_token_hash ?? "") !== contactTokenHash) {
            throw new SfpStagingV2Error("SFP_STAGING_CONTACT_EMAIL_DRIFTED", "source contact email changed since validation", 409);
          }
          if (await isCanonicallySuppressed([contactTokenHash], tx, [String(linkedContact.email)])) {
            throw new SfpStagingV2Error("SFP_STAGING_SUPPRESSED", "source contact address is suppressed", 422);
          }
           return {
             sourceKind: "contact" as const,
             contactId: String(sourceContactId),
             contactBusinessLinkDecisionId: String(eligRow.contact_business_link_decision_id),
             contactBusinessLinkRevision: Number(eligRow.contact_business_link_revision),
             normalizedValueHash: String(eligRow.normalized_value_hash),
             normalizedValueHashVersion: Number(eligRow.normalized_value_hash_version),
             sourceContactId,
           };
        })();

    const staged = await openSfpCandidatePlaintext(
      { reference, cohortRunId: opts.cohortRunId, actorId: opts.actorId, purpose: "sfp_campaign_staging_v2_master_lead_projection" },
      async (plaintext, resolved) => {
        // The candidate reference resolves to SOME business that is a
        // member of the cohort — but membership alone does not prove it is
        // THIS eligibility row's business. Without this check, a mismatched
        // or stale candidate_id could project another cohort member's
        // address into this row's master-lead record.
        if (resolved.businessId !== opts.businessId) {
          throw new SfpStagingV2Error("SFP_STAGING_EVIDENCE_BUSINESS_MISMATCH", "candidate/paid evidence resolves to a different business than this eligibility row", 422);
        }
        if (reference.sourceKind === "contact" && String(resolved.evidenceId) !== String(eligRow.contact_id)) {
          throw new SfpStagingV2Error("SFP_STAGING_CONTACT_IDENTITY_DRIFTED", "resolved contact no longer matches the validated contact reference", 409);
        }
        const contactEmailTokenHash = createHash("sha256").update(plaintext.trim().toLowerCase()).digest("hex");
        const tokenHashForSuppression = hashEmailToken(plaintext);
        if (!tokenHashForSuppression) throw new SfpStagingV2Error("SFP_STAGING_EMAIL_INVALID", "resolved source is not a valid normalized email", 422);
        await lockSfpContactAddress(tx, plaintext);
        const stillSuppressed = await isCanonicallySuppressed(
          [contactEmailTokenHash, tokenHashForSuppression], tx, [plaintext],
        );
        if (!isValidatedSfpSourceEmailUnchanged(
          reference.sourceKind,
          plaintext,
          eligRow.normalized_value_hash,
          eligRow.normalized_value_hash_version,
        )) {
          throw new SfpStagingV2Error("SFP_STAGING_VALIDATED_EMAIL_DRIFTED", "candidate email differs from the address that passed validation", 409);
        }
        const exactCurrentGate = await checkCurrentSfpEligibilityAndPackage(tx, {
          eligibilityId: opts.eligibilityId,
          businessId: opts.businessId,
          cohortRunId: opts.cohortRunId,
          packageKey: opts.packageKey,
          packageVersionId: String(sharedCurrentGate.package.id),
          eligibilityReviewId: opts.eligibilityReviewId,
          expectedSourceKind: opts.sourceKind,
          emailTokenHash: contactEmailTokenHash,
          emailAddress: plaintext,
          projectionWrite: true,
        });
        if (!exactCurrentGate.eligible) {
          throw new SfpStagingV2Error(
            `SFP_STAGING_${exactCurrentGate.reason.toUpperCase()}`,
            `exact address receipt/source gate failed: ${exactCurrentGate.reason}`,
            409,
          );
        }
        if (stillSuppressed) throw new SfpStagingV2Error("SFP_STAGING_SUPPRESSED", "resolved address is suppressed", 422);
         let contactName = sourceContactName;
         let contactTitle = sourceContactTitle;
         if (reference.sourceKind === "free") {
           const sourcePerson = rows(await tx.execute(sql`
             SELECT person_name_evidence,person_title_evidence
               FROM free_discovery_candidates
              WHERE id=${reference.freeDiscoveryCandidateId}::uuid AND business_id=${opts.businessId}
                AND field='email'
           `))[0];
           contactName = sourcePerson?.person_name_evidence == null ? null : String(sourcePerson.person_name_evidence);
           contactTitle = sourcePerson?.person_title_evidence == null ? null : String(sourcePerson.person_title_evidence);
         } else if (reference.sourceKind === "paid") {
           const sourcePerson = rows(await tx.execute(sql`
             SELECT person_name_evidence,person_title_evidence
               FROM sfp_paid_candidate_evidence
              WHERE id=${reference.paidCandidateEvidenceId}::uuid AND business_id=${opts.businessId}
                AND field='email'
           `))[0];
           contactName = sourcePerson?.person_name_evidence == null ? null : String(sourcePerson.person_name_evidence);
           contactTitle = sourcePerson?.person_title_evidence == null ? null : String(sourcePerson.person_title_evidence);
         }
         if (eligRow.role_inbox === true) {
           contactName = null;
           contactTitle = null;
         }
         const recipientIdentityHash = sfpRecipientIdentityHash(plaintext);
         if (!recipientIdentityHash) {
           throw new SfpStagingV2Error("SFP_STAGING_RECIPIENT_IDENTITY_INVALID", "recipient address cannot be normalized", 422);
         }
         intentValues = {
           candidateId: reference.sourceKind === "free" ? reference.freeDiscoveryCandidateId : null,
           paidCandidateEvidenceId: reference.sourceKind === "paid" ? reference.paidCandidateEvidenceId : null,
           sourceContactId: reference.sourceKind === "contact" ? reference.sourceContactId : null,
           contactEmailTokenHash, maskedEmailForLead: eligRow.masked_email ?? null,
           sourceContactLinkDecisionId: reference.sourceKind === "contact" ? String(eligRow.contact_business_link_decision_id) : null,
           sourceContactLinkRevision: reference.sourceKind === "contact" ? Number(eligRow.contact_business_link_revision) : null,
           normalizedValueHash: String(eligRow.normalized_value_hash),
           normalizedValueHashVersion: Number(eligRow.normalized_value_hash_version),
         };
         const intent = rows(await tx.execute(sql`
           INSERT INTO sfp_campaign_staging_intents
             (cohort_run_id, eligibility_id, business_id, candidate_id, paid_candidate_evidence_id, contact_id,
              contact_business_link_decision_id, contact_business_link_revision, normalized_value_hash, normalized_value_hash_version,
              source_kind,idempotency_key, actor_id, state, policy_version, validation_snapshot, lineage,
              package_version_id, package_key, policy_document_hash, snapshot_hash, payload_hash, command_key,
              operator_selected_at, operator_selected_by, ready_held_at)
           VALUES (${opts.cohortRunId}::uuid, ${opts.eligibilityId}::uuid, ${opts.businessId},
                    ${intentValues.candidateId}::uuid, ${intentValues.paidCandidateEvidenceId}::uuid, ${intentValues.sourceContactId},
                    ${intentValues.sourceContactLinkDecisionId}::uuid, ${intentValues.sourceContactLinkRevision},
                    ${intentValues.normalizedValueHash}, ${intentValues.normalizedValueHashVersion}, ${opts.sourceKind},
                   ${idempotencyKey}, ${opts.actorId}, 'ready_held', ${Number(eligRow.policy_version ?? 1)},
                    ${JSON.stringify({
                      status: eligRow.status, pinnedPackageContentHash, pinnedPolicyHash, validationExpiresAt: effectiveExpiresAt.toISOString(),
                      eligibilityReviewId: opts.eligibilityReviewId ?? null,
                      classifierVersion: Number(eligRow.classifier_version), taxonomyVersion: Number(eligRow.taxonomy_version),
                      classificationEvidenceId: String(eligRow.classification_evidence_id),
                      classificationEvidenceHash: String(eligRow.classification_evidence_hash),
                      classificationPolicyVersion: Number(eligRow.classification_policy_version),
                      targetVertical, sourceContactId: intentValues.sourceContactId,
                      validatedEmailTokenHash: intentValues.contactEmailTokenHash,
                      sourceContactLinkDecisionId: intentValues.sourceContactLinkDecisionId,
                      sourceContactLinkRevision: intentValues.sourceContactLinkRevision,
                      normalizedValueHash: intentValues.normalizedValueHash,
                      normalizedValueHashVersion: intentValues.normalizedValueHashVersion,
                    })}::jsonb,
                    ${JSON.stringify({
                      source: "sfp_staging_v2", cohortRunId: opts.cohortRunId, eligibilityId: opts.eligibilityId,
                      eligibilityReviewId: opts.eligibilityReviewId ?? null,
                      classificationEvidenceId: String(eligRow.classification_evidence_id),
                      classificationEvidenceHash: String(eligRow.classification_evidence_hash),
                      targetVertical, sourceContactId: intentValues.sourceContactId,
                      sourceContactLinkDecisionId: intentValues.sourceContactLinkDecisionId,
                      sourceContactLinkRevision: intentValues.sourceContactLinkRevision,
                      normalizedValueHash: intentValues.normalizedValueHash,
                      normalizedValueHashVersion: intentValues.normalizedValueHashVersion,
                    })}::jsonb,
                   ${pkgRow.id}::uuid, ${opts.packageKey}, ${pinnedPolicyHash}, ${opts.snapshotHash}, ${opts.payloadHash}, ${opts.commandKey},
                   NOW(), ${opts.actorId}, NOW())
           RETURNING id
         `))[0];
         if (!intent) throw new SfpStagingV2Error("SFP_STAGING_INTENT_WRITE_FAILED", "staging intent was not persisted", 422);

         const claimed = rows(await tx.execute(sql`
           INSERT INTO sfp_recipient_address_commitments
             (program_id,objective_key,recipient_identity_hash,recipient_identity_hash_version,
              business_id,package_version_id,staging_intent_id,state)
           VALUES (${String(sharedCurrentGate.row.program_id)}::uuid,${SFP_INITIAL_RECIPIENT_OBJECTIVE_KEY},
                   ${recipientIdentityHash},1,${opts.businessId},${String(pkgRow.id)}::uuid,
                   ${String(intent.id)}::uuid,'claimed')
           ON CONFLICT (program_id,objective_key,recipient_identity_hash) DO NOTHING
           RETURNING id
         `))[0];
         let recipientCommitmentId = claimed ? String(claimed.id) : "";
         if (!recipientCommitmentId) {
           const existingCommitment = rows(await tx.execute(sql`
             SELECT id FROM sfp_recipient_address_commitments
              WHERE program_id=${String(sharedCurrentGate.row.program_id)}::uuid
                AND objective_key=${SFP_INITIAL_RECIPIENT_OBJECTIVE_KEY}
                AND recipient_identity_hash=${recipientIdentityHash}
              FOR UPDATE
           `))[0];
           if (!existingCommitment) {
             throw new SfpStagingV2Error("SFP_STAGING_RECIPIENT_CLAIM_RACE_LOST", "unique recipient claim could not be resolved", 409);
           }
           recipientCommitmentId = String(existingCommitment.id);
         }
         await tx.execute(sql`
           UPDATE sfp_campaign_staging_intents
              SET recipient_commitment_id=${recipientCommitmentId}::uuid,updated_at=NOW()
            WHERE id=${String(intent.id)}::uuid
         `);

         let masterLeadId: string | null = null;
         if (claimed) {
           const sourceReferenceId = reference.sourceKind === "free"
             ? reference.freeDiscoveryCandidateId
             : reference.sourceKind === "paid"
               ? reference.paidCandidateEvidenceId
               : String(reference.sourceContactId);
           await tx.execute(sql`
             INSERT INTO sfp_recipient_commitment_aliases
               (commitment_id,staging_intent_id,source_kind,source_reference_id,
                normalized_value_hash,normalized_value_hash_version,disposition)
             VALUES (${recipientCommitmentId}::uuid,${String(intent.id)}::uuid,${reference.sourceKind},
               ${sourceReferenceId},${intentValues.normalizedValueHash},
               ${intentValues.normalizedValueHashVersion},'initial')
           `);
           const masterLead = rows(await tx.execute(sql`
             INSERT INTO master_leads
               (status, company, normalized_company, domain, email, email_type, phone, contact_name,contact_title,vertical,
                outreach_readiness, readiness_reason, source, source_path, city, state, website, email_valid,
                pipeline_origin, canonical_business_id, email_token_hash, masked_email, created_at, updated_at)
             VALUES ('staged', ${eligRow.canonical_name}, LOWER(TRIM(${eligRow.canonical_name})), ${eligRow.website_domain},
                     ${plaintext}, ${eligRow.role_inbox ? "role" : eligRow.named_contact ? "person" : "business"},
                     ${eligRow.main_phone}, ${contactName},${contactTitle},${targetVertical},
                     'not_ready', 'ready_held_package_pinned_pending_separate_activation', 'sfp_validated',
                     ${`sfp:${opts.cohortRunId}:${opts.eligibilityId}`}, ${eligRow.city}, ${eligRow.state},
                     ${eligRow.website_domain}, TRUE, 'sfp_pipeline', ${opts.businessId},
                     ${contactEmailTokenHash}, ${eligRow.masked_email ?? null}, NOW(), NOW())
             ON CONFLICT (canonical_business_id, email_token_hash)
               WHERE pipeline_origin = 'sfp_pipeline' AND canonical_business_id IS NOT NULL AND email_token_hash IS NOT NULL
             DO UPDATE SET status = 'staged', email_valid = TRUE,
                           contact_name=COALESCE(EXCLUDED.contact_name,master_leads.contact_name),
                           contact_title=COALESCE(EXCLUDED.contact_title,master_leads.contact_title),
                           updated_at = NOW()
             RETURNING id
           `))[0];
           if (!masterLead) {
             throw new SfpStagingV2Error("SFP_STAGING_MASTER_LEAD_WRITE_FAILED", "master lead projection did not complete", 422);
           }
           masterLeadId = String(masterLead.id);
           await tx.execute(sql`
             UPDATE sfp_campaign_staging_intents SET master_lead_id=${masterLeadId}::uuid,updated_at=NOW()
              WHERE id=${String(intent.id)}::uuid
           `);
         }
         return { contactEmailTokenHash, intentId: String(intent.id), masterLeadId, recipientIdentityHash };
       },
       tx,
     );

    await tx.execute(sql`
      UPDATE sfp_outreach_eligibility
       SET campaign_staged_at = NOW(), campaign_staged_by = ${opts.actorId}, staging_intent_id = ${String(staged.intentId)}::uuid
      WHERE id = ${opts.eligibilityId}::uuid
    `);

    // PM-10 correction: the item's completion is written in THIS SAME
    // transaction as the intent/master-lead/eligibility mutation above, not
    // as a separate follow-up statement — so a crash cannot leave a
    // ready_held intent whose stage item still reads pending/claimed, and
    // no separate reconciliation step is needed to catch that split state.
    await markStageItemCompletedInTx(tx, opts.stageItemId, "ready_held", { incrementAttempt: opts.incrementAttempt ?? true });
     if (await isCanonicallySuppressed([String(staged.contactEmailTokenHash)], tx)) {
       throw new SfpStagingV2Error("SFP_STAGING_SUPPRESSED", "address became suppressed before transaction commit", 409);
     }
     if (!(await isCurrentSfpValidationReceiptFresh(tx, {
       eligibilityId: opts.eligibilityId,
       businessId: opts.businessId,
       emailTokenHash: String(staged.contactEmailTokenHash),
     }))) {
       throw new SfpStagingV2Error("SFP_STAGING_VALIDATION_EXPIRED_AT_COMMIT", "provider receipt expired before transaction commit", 409);
     }
     return String(staged.intentId);
  });
}
