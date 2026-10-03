import { pool } from "../db";
import { hashEmailToken } from "./provider-readiness-control";
import { normalizedSfpEmailHash } from "./cro03/sfp-recipient-link-predicates";

/** Read-only ledger comparison. It never projects an SFP outcome into CRM status. */
export async function getContactSfpReadiness(contact: { id: number; email?: string | null; emailStatus?: string | null }) {
  const normalized = String(contact.email ?? "").trim().toLowerCase();
  const normalizedHash = normalizedSfpEmailHash(normalized, 1);
  const legacyHash = normalizedSfpEmailHash(normalized, 0);
  const tokenHash = normalized ? hashEmailToken(normalized) : null;
  const result = await pool.query(`
    SELECT DISTINCT ON (e.business_id,e.normalized_value_hash,e.normalized_value_hash_version,e.policy_document_hash)
      e.id AS eligibility_id,e.business_id,e.status AS policy_status,e.zb_outcome,
      e.validation_at,e.validation_expires_at,e.validation_operation_id,
      coalesce(e.contact_business_link_decision_id,enrollment.contact_business_link_decision_id) AS contact_business_link_decision_id,
      coalesce(e.contact_business_link_revision,enrollment.contact_business_link_revision) AS contact_business_link_revision,
      operation.state AS operation_state,receipt.id AS receipt_id,
      (e.validation_expires_at>NOW()) AS fresh,
      (d.decision='verified' AND d.superseded_at IS NULL AND d.business_id=e.business_id
        AND d.contact_id=c.id AND d.revision=coalesce(e.contact_business_link_revision,enrollment.contact_business_link_revision)
        AND c.business_id=e.business_id) AS current_link,
      intent.id AS intent_id,intent.state AS intent_state,intent.master_lead_id,
      enrollment.sequence_enrollment_id,se.status AS enrollment_status
    FROM sfp_outreach_eligibility e
    JOIN contacts c ON c.id=$1
    LEFT JOIN provider_operations operation ON operation.id=e.validation_operation_id
    LEFT JOIN LATERAL (
      SELECT observation.id FROM provider_observations observation
       WHERE observation.operation_id=operation.id AND observation.provider='zerobounce'
         AND observation.email_token_hash=$4 AND observation.outcome=e.zb_outcome
         AND observation.expires_at>NOW()
         AND ((observation.subject_type='contact' AND observation.subject_id=c.id)
           OR (observation.subject_type='business' AND observation.subject_id=e.business_id))
       ORDER BY observation.observed_at DESC,observation.id DESC LIMIT 1
    ) receipt ON TRUE
    LEFT JOIN LATERAL (
      SELECT i.id,i.state,i.master_lead_id FROM sfp_campaign_staging_intents i
       WHERE i.eligibility_id=e.id
       ORDER BY EXISTS(SELECT 1 FROM sfp_ready_held_enrollments held WHERE held.staging_intent_id=i.id) DESC,
         i.created_at DESC,i.id DESC LIMIT 1
    ) intent ON TRUE
    LEFT JOIN sfp_ready_held_enrollments enrollment ON enrollment.staging_intent_id=intent.id
    LEFT JOIN sequence_enrollments se ON se.id=enrollment.sequence_enrollment_id
    LEFT JOIN contact_business_link_decisions d
      ON d.id=coalesce(e.contact_business_link_decision_id,enrollment.contact_business_link_decision_id)
    WHERE ((e.contact_id=$1 AND e.source_kind='contact') OR EXISTS (
      SELECT 1 FROM sfp_recipient_address_commitments commitment
      JOIN sfp_campaign_staging_intents source_intent ON source_intent.id=commitment.staging_intent_id
      WHERE commitment.contact_id=$1 AND source_intent.eligibility_id=e.id AND commitment.state='committed'
        AND e.source_kind IN ('free','paid')
    ))
      AND ((e.normalized_value_hash_version=1 AND e.normalized_value_hash=$2)
        OR (e.normalized_value_hash_version=0 AND e.normalized_value_hash=$3))
    ORDER BY e.business_id,e.normalized_value_hash,e.normalized_value_hash_version,e.policy_document_hash,
      e.updated_at DESC,e.created_at DESC,e.id DESC LIMIT 10
  `, [contact.id, normalizedHash, legacyHash, tokenHash]);
  return {
    contactId: contact.id, crmEmailStatus: contact.emailStatus ?? "unvalidated",
    separateFromCrm: true,
    decisions: result.rows.map(row => ({
      eligibilityId: row.eligibility_id, businessId: row.business_id,
      policyStatus: row.policy_status, zbOutcome: row.zb_outcome,
      validatedAt: row.validation_at, expiresAt: row.validation_expires_at,
      fresh: row.fresh === true, operationId: row.validation_operation_id,
      receiptId: row.receipt_id, linkDecisionId: row.contact_business_link_decision_id,
      currentLink: row.current_link === true, intentId: row.intent_id,
      intentState: row.intent_state, masterLeadId: row.master_lead_id,
      enrollmentId: row.sequence_enrollment_id, enrollmentStatus: row.enrollment_status,
      receiptStatus: row.receipt_id && row.operation_state === "completed" ? "matched" : "unresolved",
    })),
  };
}