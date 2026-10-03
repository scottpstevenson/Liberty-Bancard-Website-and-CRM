/** Prints bounded read-only statements; it never connects to a database. */
import { contactTargetVerticalSql } from "../shared/contact-vertical-taxonomy";
const mapped = contactTargetVerticalSql("c.vertical");
export const evidenceQueries = {
  verticals: `SELECT ${mapped} AS canonical_vertical,c.record_class,
    count(*) AS contacts,
    count(*) FILTER (WHERE c.archived_at IS NULL AND NULLIF(btrim(c.email),'') IS NOT NULL) AS active_email,
    count(*) FILTER (WHERE c.archived_at IS NULL AND EXISTS (
      SELECT 1 FROM contact_business_link_decisions d WHERE d.contact_id=c.id
        AND d.business_id=c.business_id AND d.decision='verified' AND d.superseded_at IS NULL)) AS verified_linked
    FROM contacts c GROUP BY 1,2 ORDER BY 1,2`,
  legacyFilters: `SELECT vertical,count(*) AS contacts,
    count(*) FILTER (WHERE archived_at IS NULL AND NULLIF(btrim(email),'') IS NOT NULL) AS active_email
    FROM contacts WHERE record_class='production' AND vertical IN ('Auto Repair','Medical/Dental/Medspa','Gym')
    GROUP BY vertical ORDER BY vertical`,
  actualChains: `SELECT commitment.id AS commitment_id,commitment.business_id,
    commitment.contact_id,commitment.contact_business_link_decision_id AS link_id,
    intent.id AS intent_id,intent.master_lead_id,enrollment.sequence_enrollment_id,
    e.id AS eligibility_id,e.validation_operation_id,observation.id AS validation_receipt_id,
    e.validation_expires_at,operation.state AS validation_operation_state,
    e.status AS policy_status,intent.state AS intent_state,se.status AS enrollment_status,
    (d.decision='verified' AND d.superseded_at IS NULL AND d.business_id=commitment.business_id
      AND d.id=enrollment.contact_business_link_decision_id AND d.revision=enrollment.contact_business_link_revision) AS current_link,
    (e.validation_expires_at>NOW()) AS fresh
    FROM sfp_recipient_address_commitments commitment
    JOIN sfp_campaign_staging_intents intent ON intent.id=commitment.staging_intent_id
    LEFT JOIN sfp_ready_held_enrollments enrollment ON enrollment.recipient_commitment_id=commitment.id
    LEFT JOIN sequence_enrollments se ON se.id=enrollment.sequence_enrollment_id
    LEFT JOIN contact_business_link_decisions d ON d.id=enrollment.contact_business_link_decision_id
    LEFT JOIN sfp_outreach_eligibility e ON e.id=intent.eligibility_id
    LEFT JOIN provider_operations operation ON operation.id=e.validation_operation_id
    LEFT JOIN LATERAL (SELECT id FROM provider_observations WHERE operation_id=operation.id
      AND provider='zerobounce' AND outcome='valid' ORDER BY observed_at DESC,id DESC LIMIT 1) observation ON TRUE
    WHERE commitment.state='committed'
    ORDER BY commitment.committed_at DESC,commitment.id LIMIT 5`,
  capacity: `SELECT recipients,count(*) AS businesses FROM (
    SELECT business_id,count(DISTINCT recipient_identity_hash) AS recipients
    FROM sfp_recipient_address_commitments GROUP BY program_id,objective_key,business_id
    ) distribution GROUP BY recipients ORDER BY recipients`,
  retries: `SELECT state,outcome_code,count(*) AS items,min(next_attempt_at) AS next_attempt
    FROM sfp_stage_items WHERE state NOT IN ('completed','failed','skipped')
    GROUP BY state,outcome_code ORDER BY state,outcome_code`,
  consumerHolds: `SELECT state,outcome_code,count(*) AS items,min(next_attempt_at) AS next_attempt
    FROM sfp_ready_held_consumer_items GROUP BY state,outcome_code ORDER BY state,outcome_code`,
};
if (import.meta.url === new URL(`file://${process.argv[1]}`).href) console.log(JSON.stringify(evidenceQueries));