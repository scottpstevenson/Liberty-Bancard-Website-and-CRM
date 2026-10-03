-- Preserve every historical row and immutable staging reference. The former
-- business-wide projection cannot represent one primary and two alternatives.
CREATE UNIQUE INDEX IF NOT EXISTS sfp_outreach_run_business_recipient_policy_uidx
  ON sfp_outreach_eligibility
    (cohort_run_id,business_id,policy_version,normalized_value_hash);
CREATE UNIQUE INDEX IF NOT EXISTS sfp_outreach_run_business_unresolved_policy_uidx
  ON sfp_outreach_eligibility(cohort_run_id,business_id,policy_version)
  WHERE normalized_value_hash IS NULL;
DROP INDEX IF EXISTS sfp_outreach_run_business_policy_uidx;