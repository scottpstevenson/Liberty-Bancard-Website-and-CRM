import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { lockSfpEligibilityProjectionWriteGate, lockSfpBusinessSafetySentinel } from "./sfp-eligibility-locks";
import { lockCurrentSfpOutreachPolicy } from "./sfp-outreach-policy";
import { lockLivePackageContentRows } from "./sfp-campaign-packages";
import { sanitizeAuditPayload } from "../audit-sanitizer";
import { lockSfpContactAddress } from "./sfp-contact-address-lock";
import { claimSfpRuntimeDeploymentOwner, lockCurrentSfpRuntimeOwner } from "./sfp-provider-operations";
import { checkCurrentSfpEligibilityAndPackage, isCurrentSfpValidationReceiptFresh, normalizedSfpEmailHash } from "./sfp-recipient-link-predicates";
import { OUTBOUND_PAUSE_CONTROL_ADVISORY_LOCK_KEY } from "../outbound-pause-authority";
import { hashEmailToken } from "../provider-readiness-decision";

const rows = (result: any): any[] => result?.rows ?? result ?? [];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INTENTS = 25;

type PreviewRow = {
  intentId: string;
  eligibilityId: string;
  snapshotHash: string;
  projectionHash: string;
  disposition: "candidate_restore" | "no_op" | "rejected";
  reason: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown> | null;
  pins: Record<string, unknown>;
};

function canonicalSleFacts(row: any): Record<string, unknown> {
  return {
    contract: "sfp_typed_source_v1",
    sourceKind: String(row.sle_source_kind),
    sourceReferenceId: String(row.sle_free_candidate_id),
    eligibilityId: String(row.sle_eligibility_id),
    normalizedValueHash: String(row.sle_normalized_value_hash),
    normalizedValueHashVersion: Number(row.sle_hash_version),
    contactEmailTokenHash: String(row.sle_email_token_hash),
    validationOperationId: String(row.sle_operation_id),
    stagingIntentId: String(row.id),
    packageVersionId: String(row.package_version_id),
  };
}

function validSleFacts(row: any): boolean {
  const facts = canonicalSleFacts(row);
  const stable = (value: any): string => Array.isArray(value)
    ? `[${value.map(stable).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`
      : JSON.stringify(value);
  return stable(row.sle_facts) === stable(facts)
    && createHash("sha256").update(JSON.stringify(facts)).digest("hex") === String(row.sle_facts_hash);
}

function validateIntentIds(ids: string[]): string[] {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_INTENTS) {
    throw new Error("SFP_RECONCILIATION_IDS_MUST_CONTAIN_1_TO_25_UUIDS");
  }
  if (ids.some((id) => typeof id !== "string" || !UUID.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("SFP_RECONCILIATION_IDS_MUST_BE_UNIQUE_UUIDS");
  }
  return ids.map((id) => id.toLowerCase());
}

const projectionQuery = (ids: string[]) => sql`
  SELECT i.id,i.eligibility_id,i.cohort_run_id,i.business_id,i.package_key,i.package_version_id,
         i.state AS intent_state,i.source_kind AS intent_source_kind,i.candidate_id AS intent_candidate_id,
         i.paid_candidate_evidence_id AS intent_paid_id,i.contact_id AS intent_contact_id,
         i.contact_business_link_decision_id AS intent_link_id,
         i.contact_business_link_revision AS intent_link_revision,
         i.normalized_value_hash AS intent_hash,i.normalized_value_hash_version AS intent_hash_version,
         i.validation_snapshot,i.updated_at::text AS intent_updated_at,
         e.source_kind,e.candidate_id,e.paid_candidate_evidence_id,e.contact_id,
         e.contact_business_link_decision_id,e.contact_business_link_revision,
         e.normalized_value_hash,e.normalized_value_hash_version,e.validation_operation_id,
         e.reused_from_operation_id,e.validation_at::text AS validation_at_text,
         e.validation_expires_at::text AS validation_expires_at_text,e.masked_email,
          e.status,e.named_contact,e.role_inbox,e.decision_reason,e.reason_codes,
          e.suppression_status,e.zb_outcome,
         e.policy_document_id,e.policy_document_hash,e.outreach_policy_version,
         e.updated_at::text AS eligibility_updated_at,
         to_jsonb(e)->>'eligibility_review_id' AS eligibility_review_id,
         to_jsonb(e)->>'staging_intent_id' AS projection_staging_intent_id,
         EXISTS (SELECT 1 FROM sfp_named_email_eligibility_reviews rv WHERE rv.eligibility_id=e.id) AS has_any_review,
          le.id AS ledger_id,le.sequence_enrollment_id AS sequence_enrollment_id,
          le.contact_id AS ledger_contact_id,
         le.contact_business_link_decision_id AS ledger_link_id,
         le.contact_business_link_revision AS ledger_link_revision,
         d.id AS current_link_id,d.contact_id AS current_link_contact_id,d.business_id AS current_link_business_id,
         d.revision AS current_link_revision,
         d.decision AS current_link_decision,d.superseded_at,
         sle.id AS sle_id,sle.contact_id AS sle_contact_id,sle.business_id AS sle_business_id,
         sle.eligibility_id AS sle_eligibility_id,sle.source_kind AS sle_source_kind,
         sle.free_candidate_id AS sle_free_candidate_id,
         sle.paid_candidate_evidence_id AS sle_paid_id,
         sle.normalized_value_hash AS sle_normalized_value_hash,
         sle.normalized_value_hash_version AS sle_hash_version,
         sle.contact_email_token_hash AS sle_email_token_hash,
         sle.validation_operation_id AS sle_operation_id,sle.facts_hash AS sle_facts_hash,sle.facts AS sle_facts,
         c.email AS contact_email,c.email_token_hash AS current_email_token_hash,
         c.business_id AS contact_business_id,c.archived_at AS contact_archived_at,
         fc.business_id AS free_business_id,fc.field AS free_field,fc.subject_type AS free_subject_type,
          fc.attribution_scope AS free_attribution_scope,
          fc.disposition AS free_disposition,fc.contact_id AS free_contact_id,
          fc.normalized_value_hash AS free_hash,fc.masked_value AS free_masked_value,
         po.id AS receipt_id,po.subject_type AS receipt_subject_type,po.subject_id AS receipt_subject_id,
         po.provider AS receipt_provider,po.outcome AS receipt_outcome,po.retryable AS receipt_retryable,
         po.email_token_hash AS receipt_email_token_hash,po.observed_at::text AS receipt_observed_at,
         po.expires_at::text AS receipt_expires_at,op.state AS operation_state,
          cd.id AS classification_decision_id,cd.classification_evidence_id,
          cd.classification_evidence_hash,cce.evidence_hash AS current_classification_evidence_hash,
          cd.classification_policy_version AS current_classification_policy_version,
          cd.classifier_version AS current_classifier_version,
          cce.taxonomy_version AS current_taxonomy_version,
          LEAST(e.validation_expires_at,
                NULLIF(i.validation_snapshot->>'validationExpiresAt','')::timestamptz,
                po.observed_at+(pinned_pd.validation_ttl_days::text||' days')::interval,
                COALESCE(po.expires_at,po.observed_at+(pinned_pd.validation_ttl_days::text||' days')::interval)
          )::text AS restoration_validation_expires_at,
          (e.validation_expires_at IS NOT NULL
            AND NULLIF(i.validation_snapshot->>'validationExpiresAt','') IS NOT NULL
            AND po.observed_at IS NOT NULL AND pinned_pd.validation_ttl_days IS NOT NULL
            AND LEAST(e.validation_expires_at,
                      NULLIF(i.validation_snapshot->>'validationExpiresAt','')::timestamptz,
                      po.observed_at+(pinned_pd.validation_ttl_days::text||' days')::interval,
                      COALESCE(po.expires_at,po.observed_at+(pinned_pd.validation_ttl_days::text||' days')::interval)
                )>clock_timestamp()) AS restoration_expiry_current,
          q.id AS consumer_item_id,q.state AS consumer_state,se.id AS sequence_enrollment_row_id,
          se.status AS enrollment_status,
         md5(jsonb_build_object('intent',to_jsonb(i),'eligibility',to_jsonb(e),
           'ledger',to_jsonb(le),'link',to_jsonb(d),'sle',to_jsonb(sle),'contact',to_jsonb(c),
           'free',to_jsonb(fc),'receipt',to_jsonb(po),'operation',to_jsonb(op),
            'enrollment',to_jsonb(se),'consumer',to_jsonb(q),
            'classificationDecision',to_jsonb(cd),'classificationEvidence',to_jsonb(cce),
            'policyControl',to_jsonb(pc),'activePolicy',to_jsonb(active_pd))::text) AS snapshot_hash,
         md5(jsonb_build_object('intent',to_jsonb(i),'eligibility',to_jsonb(e))::text) AS projection_hash
    FROM sfp_campaign_staging_intents i
    JOIN sfp_outreach_eligibility e ON e.id=i.eligibility_id AND e.business_id=i.business_id
    LEFT JOIN sfp_outreach_policy_documents pinned_pd ON pinned_pd.id=e.policy_document_id
    LEFT JOIN sfp_cohort_decisions cd
      ON cd.cohort_run_id=i.cohort_run_id AND cd.business_id=i.business_id AND cd.selected=TRUE
    LEFT JOIN sfp_classification_evidence cce ON cce.id=cd.classification_evidence_id
    LEFT JOIN sfp_outreach_policy_control pc ON pc.singleton=TRUE
    LEFT JOIN sfp_outreach_policy_documents active_pd ON active_pd.id=pc.active_policy_id
    LEFT JOIN sfp_ready_held_enrollments le ON le.staging_intent_id=i.id
    LEFT JOIN sequence_enrollments se ON se.id=le.sequence_enrollment_id
    LEFT JOIN contact_business_link_decisions d
      ON d.id=le.contact_business_link_decision_id AND d.contact_id=le.contact_id
    LEFT JOIN contact_business_sfp_link_evidence sle ON sle.id=d.sfp_evidence_id
    LEFT JOIN contacts c ON c.id=sle.contact_id
    LEFT JOIN free_discovery_candidates fc ON fc.id=sle.free_candidate_id
    LEFT JOIN provider_operations op ON op.id=sle.validation_operation_id
    LEFT JOIN LATERAL (
       SELECT q.id,q.state FROM sfp_ready_held_consumer_items q
       WHERE q.staging_intent_id=i.id ORDER BY q.created_at DESC LIMIT 1
    ) q ON TRUE
    LEFT JOIN LATERAL (
      SELECT po.* FROM provider_observations po
       WHERE po.operation_id=sle.validation_operation_id AND po.provider='zerobounce'
         AND po.outcome='valid' AND po.retryable=FALSE
         AND po.subject_type='business' AND po.subject_id=i.business_id
         AND po.email_token_hash=sle.contact_email_token_hash
       ORDER BY po.observed_at DESC,po.id DESC LIMIT 1
    ) po ON TRUE
   WHERE i.id=ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[])
   ORDER BY i.id
`;

async function analyze(tx: any, ids: string[]): Promise<PreviewRow[]> {
  const found = rows(await tx.execute(projectionQuery(ids)));
  const byId = new Map(found.map((row: any) => [String(row.id), row]));
  const output: PreviewRow[] = [];
  for (const id of ids) {
    const row: any = byId.get(id);
    if (!row) {
      output.push({ intentId: id, eligibilityId: "", snapshotHash: "", projectionHash: "", disposition: "rejected",
        reason: "intent_or_projection_missing", before: {}, after: null, pins: {} });
      continue;
    }
    const before = {
      status: row.status, namedContact: row.named_contact, roleInbox: row.role_inbox,
      decisionReason: row.decision_reason, reasonCodes: row.reason_codes,
      sourceKind: row.source_kind, candidateId: row.candidate_id, paidCandidateEvidenceId: row.paid_candidate_evidence_id,
      contactId: row.contact_id, linkDecisionId: row.contact_business_link_decision_id,
      linkRevision: row.contact_business_link_revision, normalizedValueHash: row.normalized_value_hash,
      normalizedValueHashVersion: row.normalized_value_hash_version,
      validationOperationId: row.validation_operation_id, reusedFromOperationId: row.reused_from_operation_id,
      validationAt: row.validation_at_text, validationExpiresAt: row.validation_expires_at_text, maskedEmail: row.masked_email,
    };
    const reason = row.intent_state !== "ready_held" ? "intent_not_ready_held"
      : row.intent_source_kind !== "free" || row.intent_candidate_id == null || row.intent_paid_id != null || row.intent_contact_id != null
        ? "intent_not_original_free_source"
      : !(
          (row.status === "validated_outreach_eligible" && row.named_contact === false && row.role_inbox === true)
          || (row.status === "validated_review_required" && row.named_contact === true && row.role_inbox === false
              && row.decision_reason === "zb_valid:named_or_unclassified_address:operator_review_required"
              && Array.isArray(row.reason_codes) && row.reason_codes.includes("zb_valid_review_required"))
        ) ? `current_restrictive_or_unproven_state:${row.status}`
      : row.suppression_status !== "not_suppressed" ? "current_projection_suppressed"
      : row.zb_outcome !== "valid" ? "current_validation_outcome_restrictive"
      : row.eligibility_review_id != null || row.has_any_review === true ? "named_email_review_exists"
      : row.validation_snapshot?.status !== "validated_outreach_eligible"
        || row.validation_snapshot?.eligibilityReviewId != null
        || row.validation_snapshot?.sourceContactId != null
        || String(row.validation_snapshot?.classificationEvidenceId ?? "") !== String(row.classification_evidence_id)
        || String(row.validation_snapshot?.classificationEvidenceHash ?? "") !== String(row.current_classification_evidence_hash)
        || String(row.classification_evidence_hash ?? "") !== String(row.current_classification_evidence_hash)
        || Number(row.validation_snapshot?.classificationPolicyVersion) !== Number(row.current_classification_policy_version)
        || Number(row.validation_snapshot?.classifierVersion) !== Number(row.current_classifier_version)
        || Number(row.validation_snapshot?.taxonomyVersion) !== Number(row.current_taxonomy_version)
        ? "original_snapshot_not_eligible_free"
      : !(
           (row.source_kind === "contact" && row.contact_id && row.contact_business_link_decision_id)
           || (row.source_kind === "free" && row.candidate_id != null
               && row.paid_candidate_evidence_id == null && row.contact_id == null
              && row.contact_business_link_decision_id == null && row.contact_business_link_revision == null)
        )
        ? "projection_source_not_reconcilable"
      : row.sle_source_kind !== "free" || row.sle_free_candidate_id !== row.intent_candidate_id
        || row.sle_paid_id != null || String(row.sle_eligibility_id) !== String(row.eligibility_id)
        || Number(row.sle_business_id) !== Number(row.business_id)
        || String(row.intent_hash) !== String(row.sle_normalized_value_hash)
        || Number(row.intent_hash_version) !== Number(row.sle_hash_version)
        || row.intent_link_id != null || row.intent_link_revision != null
        || row.validation_snapshot?.normalizedValueHash !== row.sle_normalized_value_hash
        || Number(row.validation_snapshot?.normalizedValueHashVersion) !== Number(row.sle_hash_version)
        ? "immutable_source_evidence_mismatch"
      : !validSleFacts(row) ? "immutable_source_evidence_hash_invalid"
      : row.current_link_decision !== "verified" || row.superseded_at != null
        || String(row.current_link_id) !== String(row.ledger_link_id)
        || Number(row.current_link_revision) !== Number(row.ledger_link_revision)
        || Number(row.current_link_business_id) !== Number(row.business_id)
        || Number(row.current_link_contact_id) !== Number(row.ledger_contact_id)
        || Number(row.ledger_contact_id) !== Number(row.sle_contact_id)
        || Number(row.contact_business_id) !== Number(row.business_id)
        || row.contact_archived_at != null
        ? "verified_contact_link_not_current"
      : row.free_business_id == null || Number(row.free_business_id) !== Number(row.business_id)
        || row.free_field !== "email" || row.free_subject_type !== "business"
        || row.free_attribution_scope !== "role"
        || row.free_disposition !== "staged" || row.free_contact_id != null
        || row.free_hash !== row.sle_normalized_value_hash
        ? "original_free_candidate_not_current"
      : !row.receipt_id || row.receipt_provider !== "zerobounce" || row.receipt_outcome !== "valid"
        || row.receipt_retryable !== false || row.receipt_subject_type !== "business"
        || Number(row.receipt_subject_id) !== Number(row.business_id)
        || row.receipt_email_token_hash !== row.sle_email_token_hash || row.operation_state !== "completed"
        ? "original_validation_receipt_mismatch"
      : row.enrollment_status !== "paused" || !["pending", "completed"].includes(String(row.consumer_state))
        ? "native_paused_ready_held_enrollment_not_found"
      : row.restoration_expiry_current !== true
        ? "original_expiry_bounds_missing"
      : null;
    const contactEmail = String(row.contact_email ?? "").trim().toLowerCase();
    const needsRoleStatusRestore = row.status !== "validated_outreach_eligible"
      || row.named_contact !== false || row.role_inbox !== true;
    const restorationReason = "staged_projection_reconciled_from_immutable_business_role_evidence";
    const corePinMap: Record<string, keyof typeof before> = {
      status: "status", namedContact: "namedContact", roleInbox: "roleInbox",
      sourceKind: "sourceKind", candidateId: "candidateId", paidCandidateEvidenceId: "paidCandidateEvidenceId",
      contactId: "contactId", linkDecisionId: "linkDecisionId", linkRevision: "linkRevision",
      normalizedValueHash: "normalizedValueHash", normalizedValueHashVersion: "normalizedValueHashVersion",
      validationOperationId: "validationOperationId", reusedFromOperationId: "reusedFromOperationId",
      validationAt: "validationAt", validationExpiresAt: "validationExpiresAt", maskedEmail: "maskedEmail",
    };
    const corePinTarget: Record<string, unknown> = {
      status: "validated_outreach_eligible", namedContact: false, roleInbox: true,
      sourceKind: "free", candidateId: String(row.sle_free_candidate_id), paidCandidateEvidenceId: null,
      contactId: null, linkDecisionId: null, linkRevision: null,
      normalizedValueHash: String(row.sle_normalized_value_hash),
      normalizedValueHashVersion: Number(row.sle_hash_version),
      validationOperationId: String(row.sle_operation_id), reusedFromOperationId: null,
      validationAt: row.receipt_observed_at, validationExpiresAt: row.restoration_validation_expires_at,
      maskedEmail: String(row.free_masked_value ?? ""),
    };
    const corePinsAlreadyIntact = Object.entries(corePinTarget)
      .every(([key, value]) => String(before[corePinMap[key]]) === String(value));
    const needsReasonRestore = needsRoleStatusRestore || !corePinsAlreadyIntact;
    const newPins = {
      status: "validated_outreach_eligible", namedContact: false, roleInbox: true,
      decisionReason: needsReasonRestore ? restorationReason : row.decision_reason,
      reasonCodes: needsReasonRestore ? [restorationReason] : row.reason_codes,
      sourceKind: "free", candidateId: String(row.sle_free_candidate_id), paidCandidateEvidenceId: null,
      contactId: null, linkDecisionId: null, linkRevision: null,
      normalizedValueHash: String(row.sle_normalized_value_hash),
      normalizedValueHashVersion: Number(row.sle_hash_version),
      validationOperationId: String(row.sle_operation_id), reusedFromOperationId: null,
      validationAt: row.receipt_observed_at,
      validationExpiresAt: row.restoration_validation_expires_at,
      maskedEmail: String(row.free_masked_value ?? ""),
    };
    const alreadyIntact = Object.entries(newPins).every(([key, value]) => {
      const map: Record<string, keyof typeof before> = {
        status: "status", namedContact: "namedContact", roleInbox: "roleInbox",
        decisionReason: "decisionReason", reasonCodes: "reasonCodes",
        sourceKind: "sourceKind", candidateId: "candidateId", paidCandidateEvidenceId: "paidCandidateEvidenceId",
        contactId: "contactId", linkDecisionId: "linkDecisionId", linkRevision: "linkRevision",
        normalizedValueHash: "normalizedValueHash", normalizedValueHashVersion: "normalizedValueHashVersion",
        validationOperationId: "validationOperationId", reusedFromOperationId: "reusedFromOperationId",
        validationAt: "validationAt", validationExpiresAt: "validationExpiresAt", maskedEmail: "maskedEmail",
      };
      return String(before[map[key]]) === String(value);
    });
    const checked = reason ?? (!contactEmail
      || String(row.current_email_token_hash ?? "") !== String(row.sle_email_token_hash)
      || hashEmailToken(contactEmail) !== String(row.sle_email_token_hash)
      || normalizedSfpEmailHash(contactEmail, row.sle_hash_version) !== String(row.sle_normalized_value_hash)
      ? "original_contact_address_pin_mismatch" : null);
    output.push({
      intentId: id, eligibilityId: String(row.eligibility_id), snapshotHash: String(row.snapshot_hash),
      projectionHash: String(row.projection_hash),
      disposition: checked ? "rejected" : alreadyIntact ? "no_op" : "candidate_restore",
      reason: checked ?? (alreadyIntact ? "already_intact" : null), before,
      after: checked || alreadyIntact ? null : newPins,
      pins: { sourceReferenceId: String(row.sle_free_candidate_id), factsHash: String(row.sle_facts_hash),
        validationOperationId: String(row.sle_operation_id), linkDecisionId: String(row.ledger_link_id),
        linkRevision: Number(row.ledger_link_revision) },
    });
  }
  return output;
}

export async function previewSfpStagedProjectionReconciliation(idsInput: string[]) {
  const ids = validateIntentIds(idsInput);
  const results = await analyze(db, ids);
  return {
    maxIntents: MAX_INTENTS,
    previewIsNonAuthoritative: true,
    commitRechecksRequired: ["current_policy", "canonical_suppression", "mutable_safety", "geography",
      "classification", "package", "original_receipt_freshness"],
    results,
  };
}

async function lockOutboundPause(tx: any) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${Number(OUTBOUND_PAUSE_CONTROL_ADVISORY_LOCK_KEY)})`);
  const state = rows(await tx.execute(sql`SELECT state FROM outbound_pause_control ORDER BY id LIMIT 1 FOR SHARE`))[0]?.state;
  if (state !== "paused") throw new Error("SFP_RECONCILIATION_OUTBOUND_NOT_PAUSED");
}

export async function executeSfpStagedProjectionReconciliation(input: {
  ids: string[];
  expectedSnapshotHashes: Record<string, string>;
  actorId: string;
}) {
  const ids = validateIntentIds(input.ids);
  if (!input.actorId.trim()) throw new Error("SFP_RECONCILIATION_ACTOR_REQUIRED");
  const expectedSnapshotHashes = Object.fromEntries(
    Object.entries(input.expectedSnapshotHashes ?? {}).map(([id, hash]) => [id.toLowerCase(), hash]),
  );
  for (const id of ids) {
    if (!/^[a-f0-9]{32}$/i.test(String(expectedSnapshotHashes[id] ?? ""))) {
      throw new Error("SFP_RECONCILIATION_SNAPSHOT_HASH_REQUIRED");
    }
  }
  await claimSfpRuntimeDeploymentOwner();
  return db.transaction(async (tx) => {
    // The global projection fence is deliberately the first transaction lock.
    await lockSfpEligibilityProjectionWriteGate(tx);
    const policy = await lockCurrentSfpOutreachPolicy(tx);
    await lockCurrentSfpRuntimeOwner(tx);
    await lockOutboundPause(tx);
    const initial = rows(await tx.execute(projectionQuery(ids)));
    const businesses = [...new Set(initial.map((r: any) => Number(r.business_id)).filter(Number.isSafeInteger))].sort((a, b) => a - b);
    for (const businessId of businesses) await lockSfpBusinessSafetySentinel(tx, businessId, "exclusive");
    const addresses = [...new Set(initial.map((row: any) => String(row.contact_email ?? "").trim().toLowerCase()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    for (const email of addresses) await lockSfpContactAddress(tx, email);
    // Retain the cohort, classification and pinned package/content fences
    // across the projection write and commit-time predicate.
    for (const intentId of ids) {
      const pinned = rows(await tx.execute(sql`
        SELECT r.id AS cohort_id,p.id AS program_id,b.id AS business_id,d.id AS decision_id,
               ce.id AS classification_evidence_id,v.id AS package_version_id,
               v.campaign_id,v.sequence_id
          FROM sfp_campaign_staging_intents i
          JOIN sfp_outreach_eligibility e ON e.id=i.eligibility_id
          JOIN sfp_cohort_runs r ON r.id=i.cohort_run_id
          JOIN sfp_programs p ON p.id=r.program_id
          JOIN businesses b ON b.id=i.business_id
          JOIN sfp_cohort_decisions d
            ON d.cohort_run_id=i.cohort_run_id AND d.business_id=i.business_id AND d.selected=TRUE
          JOIN sfp_classification_evidence ce ON ce.id=d.classification_evidence_id
          JOIN sfp_campaign_package_versions v
            ON v.id=i.package_version_id AND v.package_key=i.package_key AND v.lifecycle_state='current'
         WHERE i.id=${intentId}::uuid AND i.package_version_id IS NOT NULL
         FOR SHARE OF r,p,b,d,ce
         FOR UPDATE OF v
      `))[0];
      if (!pinned) throw new Error(`SFP_RECONCILIATION_REJECTED:${intentId}:cohort_or_pinned_package_missing`);
      await lockLivePackageContentRows(tx, Number(pinned.campaign_id), Number(pinned.sequence_id));
    }
    // Retain the accepted source, verified-link and immutable receipt facts
    // after taking the global/policy/business/address fences and before CAS.
    for (const row of initial) {
      if (!row.id || !row.sle_contact_id || !row.ledger_link_id || !row.sle_id
          || !row.sle_free_candidate_id || !row.receipt_id || !row.ledger_id
          || !row.sequence_enrollment_id || !row.consumer_item_id) continue;
      await tx.execute(sql`
        SELECT c.id FROM contacts c
         WHERE c.id=${Number(row.sle_contact_id)} FOR SHARE
      `);
      await tx.execute(sql`
        SELECT d.id FROM contact_business_link_decisions d
         WHERE d.id=${String(row.ledger_link_id)}::uuid
           AND d.revision=${Number(row.ledger_link_revision)} FOR SHARE
      `);
      await tx.execute(sql`
        SELECT sle.id FROM contact_business_sfp_link_evidence sle
         WHERE sle.id=${String(row.sle_id)}::uuid FOR SHARE
      `);
      await tx.execute(sql`
        SELECT fc.id FROM free_discovery_candidates fc
         WHERE fc.id=${String(row.sle_free_candidate_id)}::uuid FOR SHARE
      `);
      await tx.execute(sql`
        SELECT po.id FROM provider_observations po
         JOIN provider_operations op ON op.id=po.operation_id
         WHERE po.id=${String(row.receipt_id)}::uuid FOR SHARE OF po,op
      `);
      await tx.execute(sql`
        SELECT id FROM sfp_ready_held_enrollments WHERE id=${String(row.ledger_id)}::uuid FOR SHARE
      `);
      await tx.execute(sql`
        SELECT id FROM sequence_enrollments WHERE id=${Number(row.sequence_enrollment_id)} AND status='paused' FOR SHARE
      `);
      await tx.execute(sql`
        SELECT id FROM sfp_ready_held_consumer_items WHERE id=${String(row.consumer_item_id)}::uuid FOR SHARE
      `);
    }
    const current = await analyze(tx, ids);
    const changed = current.find((r) => r.snapshotHash !== expectedSnapshotHashes[r.intentId]);
    if (changed) throw new Error(`SFP_RECONCILIATION_PREVIEW_CHANGED:${changed.intentId}`);
    const rejected = current.find((r) => r.disposition === "rejected");
    if (rejected) throw new Error(`SFP_RECONCILIATION_REJECTED:${rejected.intentId}:${rejected.reason}`);
    const completed: PreviewRow[] = [];
    for (const preview of current) {
      if (preview.disposition === "no_op") {
        const sourceRow: any = initial.find((r: any) => String(r.id) === preview.intentId);
        const email = String(sourceRow?.contact_email ?? "");
        const tokenHash = String(sourceRow?.sle_email_token_hash ?? "");
        const currentGate = await checkCurrentSfpEligibilityAndPackage(tx, {
          eligibilityId: preview.eligibilityId,
          businessId: Number(sourceRow.business_id),
          cohortRunId: String(sourceRow.cohort_run_id),
          packageKey: String(sourceRow.package_key),
          packageVersionId: String(sourceRow.package_version_id),
          expectedSourceKind: "free",
          emailTokenHash: tokenHash,
          emailAddress: email,
          projectionWrite: true,
        });
        if (!currentGate.eligible) {
          throw new Error(`SFP_RECONCILIATION_REJECTED:${preview.intentId}:${currentGate.reason}`);
        }
        completed.push(preview);
        continue;
      }
      const row = rows(await tx.execute(sql`
        SELECT i.*,e.policy_document_id,e.policy_document_hash,e.cohort_run_id
          FROM sfp_campaign_staging_intents i
          JOIN sfp_outreach_eligibility e ON e.id=i.eligibility_id
         WHERE i.id=${preview.intentId}::uuid
         FOR UPDATE OF i,e
      `))[0];
      if (!row) throw new Error(`SFP_RECONCILIATION_REJECTED:${preview.intentId}:projection_missing`);
      const source = current.find((r) => r.intentId === preview.intentId)!;
      const details = source.after!;
      const email = String((initial.find((r: any) => String(r.id) === preview.intentId) as any)?.contact_email ?? "");
      if (String(row.policy_document_id) !== policy.id || String(row.policy_document_hash) !== policy.documentHash) {
        throw new Error(`SFP_RECONCILIATION_REJECTED:${preview.intentId}:policy_changed`);
      }
      const restoreExpiry = rows(await tx.execute(sql`
        SELECT LEAST(e.validation_expires_at,
                     NULLIF(i.validation_snapshot->>'validationExpiresAt','')::timestamptz,
                     po.observed_at + (${policy.validationTtlDays}::text||' days')::interval,
                     COALESCE(po.expires_at,po.observed_at + (${policy.validationTtlDays}::text||' days')::interval)
                )::text AS expires_at
          FROM sfp_campaign_staging_intents i
          JOIN sfp_outreach_eligibility e ON e.id=i.eligibility_id
          JOIN provider_observations po ON po.operation_id=${details.validationOperationId}::uuid
         WHERE i.id=${preview.intentId}::uuid
           AND po.id=${String((initial.find((r: any) => String(r.id) === preview.intentId) as any)?.receipt_id)}::uuid
           AND po.provider='zerobounce' AND po.outcome='valid' AND po.retryable=FALSE
           AND po.subject_type='business' AND po.subject_id=i.business_id
           AND po.email_token_hash=${String((initial.find((r: any) => String(r.id) === preview.intentId) as any)?.sle_email_token_hash ?? "")}
           AND e.validation_expires_at IS NOT NULL
           AND NULLIF(i.validation_snapshot->>'validationExpiresAt','')::timestamptz IS NOT NULL
           AND po.observed_at<=clock_timestamp()
           AND LEAST(COALESCE(po.expires_at,po.observed_at+(${policy.validationTtlDays}::text||' days')::interval),
                     po.observed_at+(${policy.validationTtlDays}::text||' days')::interval)>clock_timestamp()
      `))[0];
      if (!restoreExpiry?.expires_at) throw new Error(`SFP_RECONCILIATION_REJECTED:${preview.intentId}:original_receipt_expired_or_unbounded`);
      const tokenHash = String((initial.find((r: any) => String(r.id) === preview.intentId) as any)?.sle_email_token_hash ?? "");
      const updated = rows(await tx.execute(sql`
         UPDATE sfp_outreach_eligibility e
            SET status='validated_outreach_eligible',named_contact=FALSE,role_inbox=TRUE,
                 decision_reason='staged_projection_reconciled_from_immutable_business_role_evidence',
                 reason_codes='["staged_projection_reconciled_from_immutable_business_role_evidence"]'::jsonb,
                source_kind='free',candidate_id=${details.candidateId}::uuid,paid_candidate_evidence_id=NULL,
               contact_id=NULL,contact_business_link_decision_id=NULL,contact_business_link_revision=NULL,
               normalized_value_hash=${details.normalizedValueHash},
               normalized_value_hash_version=${details.normalizedValueHashVersion},
               validation_operation_id=${details.validationOperationId}::uuid,reused_from_operation_id=NULL,
                validation_at=(SELECT po.observed_at FROM provider_observations po
                  WHERE po.id=${String((initial.find((r: any) => String(r.id) === preview.intentId) as any)?.receipt_id)}::uuid
                    AND po.operation_id=${details.validationOperationId}::uuid
                    AND po.provider='zerobounce' AND po.outcome='valid' AND po.retryable=FALSE
                    AND po.subject_type='business' AND po.subject_id=e.business_id
                    AND po.email_token_hash=${tokenHash}),
               validation_expires_at=${restoreExpiry.expires_at}::timestamptz,
               masked_email=${details.maskedEmail},updated_at=clock_timestamp()
         WHERE e.id=${preview.eligibilityId}::uuid
            AND (
              (e.status='validated_outreach_eligible' AND e.named_contact=FALSE AND e.role_inbox=TRUE)
              OR (e.status='validated_review_required' AND e.named_contact=TRUE AND e.role_inbox=FALSE)
            )
           AND e.suppression_status='not_suppressed'
           AND md5(jsonb_build_object('intent',to_jsonb((SELECT i FROM sfp_campaign_staging_intents i WHERE i.id=${preview.intentId}::uuid)),
                                      'eligibility',to_jsonb(e))::text)=${preview.projectionHash}
        RETURNING e.id
      `));
      if (!updated.length) throw new Error(`SFP_RECONCILIATION_PREVIEW_CHANGED:${preview.intentId}`);
      const gate = await checkCurrentSfpEligibilityAndPackage(tx, {
        eligibilityId: preview.eligibilityId, businessId: Number(row.business_id),
        cohortRunId: String(row.cohort_run_id), packageKey: String(row.package_key),
        packageVersionId: String(row.package_version_id), expectedSourceKind: "free",
        emailTokenHash: tokenHash, emailAddress: email, projectionWrite: true,
      });
      if (!gate.eligible) throw new Error(`SFP_RECONCILIATION_REJECTED:${preview.intentId}:${gate.reason}`);
      completed.push(preview);
    }
    const restoredIntentIds = completed.filter((r) => r.disposition === "candidate_restore").map((r) => r.intentId);
    const noOpIntentIds = completed.filter((r) => r.disposition === "no_op").map((r) => r.intentId);
    const nonPii = (value: Record<string, unknown> | null) => value
      ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "maskedEmail"))
      : null;
    const auditDetails = {
      actorId: input.actorId,
      restoredIntentIds,
      noOpIntentIds,
      changes: completed.map((row) => ({
        intentId: row.intentId, eligibilityId: row.eligibilityId, disposition: row.disposition,
        before: nonPii(row.before), after: nonPii(row.after),
      })),
      pins: completed.map((row) => ({ intentId: row.intentId, eligibilityId: row.eligibilityId, ...row.pins })),
      effects: { receiptWrites: 0, approvals: 0, sends: 0, providerCalls: 0 },
    };
    await tx.execute(sql`
      INSERT INTO audit_logs (user_id,action,entity_type,entity_key,details,actor_type,actor_id)
      VALUES (${input.actorId},'sfp_staged_projection_reconciled',
              'sfp_staged_projection_reconciliation',NULL,${JSON.stringify(sanitizeAuditPayload(auditDetails))}::jsonb,
              'user',${input.actorId})
    `);
    // The receipt fence is intentionally the last potentially blocking read:
    // run it after every row gate and the same-transaction audit insert.
    for (const preview of completed) {
      const sourceRow: any = initial.find((r: any) => String(r.id) === preview.intentId);
      if (!(await isCurrentSfpValidationReceiptFresh(tx, {
        eligibilityId: preview.eligibilityId,
        businessId: Number(sourceRow.business_id),
        emailTokenHash: String(sourceRow.sle_email_token_hash),
      }))) throw new Error(`SFP_RECONCILIATION_REJECTED:${preview.intentId}:receipt_not_fresh_at_commit`);
    }
    // A later row's database round trip must not let an earlier row expire
    // after its individual check. All retained receipt locks are already held;
    // compare every selected row against one final database-clock observation.
    const finalFence = rows(await tx.execute(sql`
      WITH fence_clock AS MATERIALIZED (SELECT clock_timestamp() AS at),
      pinned(intent_id,eligibility_id,business_id,email_hash,operation_id) AS (
        VALUES ${sql.join(completed.map((preview) => {
          const source: any = initial.find((r: any) => String(r.id) === preview.intentId);
          return sql`(${preview.intentId}::uuid,${preview.eligibilityId}::uuid,
            ${Number(source.business_id)}::integer,${String(source.sle_email_token_hash)}::text,
            ${String(source.sle_operation_id)}::uuid)`;
        }), sql`, `)}
      )
      SELECT count(DISTINCT pin.intent_id)::integer AS fresh_count
        FROM pinned pin
        CROSS JOIN fence_clock fc
        JOIN sfp_outreach_eligibility e
          ON e.id=pin.eligibility_id AND e.business_id=pin.business_id
        JOIN sfp_outreach_policy_control pc ON pc.singleton=TRUE
        JOIN sfp_outreach_policy_documents pd
          ON pd.id=pc.active_policy_id AND pd.id=e.policy_document_id
         AND pd.document_hash=e.policy_document_hash
        JOIN provider_observations po
          ON po.operation_id=pin.operation_id
         AND po.operation_id=COALESCE(e.validation_operation_id,e.reused_from_operation_id)
        JOIN provider_operations op ON op.id=po.operation_id AND op.state='completed'
       WHERE po.provider='zerobounce' AND po.outcome='valid' AND po.retryable=FALSE
         AND po.subject_type='business' AND po.subject_id=e.business_id
         AND po.email_token_hash=pin.email_hash
         AND po.observed_at<=fc.at AND e.validation_at<=fc.at
         AND e.validation_at BETWEEN po.observed_at-INTERVAL '5 minutes'
                                 AND po.observed_at+INTERVAL '5 minutes'
         AND e.validation_expires_at>fc.at
         AND LEAST(
           COALESCE(po.expires_at,po.observed_at+(pd.validation_ttl_days::text||' days')::interval),
           po.observed_at+(pd.validation_ttl_days::text||' days')::interval)>fc.at
         AND e.validation_expires_at<=LEAST(
           COALESCE(po.expires_at,po.observed_at+(pd.validation_ttl_days::text||' days')::interval),
           po.observed_at+(pd.validation_ttl_days::text||' days')::interval)
    `))[0];
    if (Number(finalFence?.fresh_count) !== completed.length) {
      throw new Error("SFP_RECONCILIATION_REJECTED:receipt_not_fresh_at_final_batch_commit");
    }
    return {
      actorId: input.actorId,
      restoredIntentIds,
      noOpIntentIds,
      results: completed,
      effects: { receiptWrites: 0, approvals: 0, sends: 0, providerCalls: 0 },
    };
  });
}