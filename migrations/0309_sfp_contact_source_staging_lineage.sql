-- Contact-originated SFP candidates already pass through the frozen-cohort
-- ZeroBounce/policy path. Persist their exact contact identity through
-- ready_held so staging and the paused-enrollment bridge cannot substitute a
-- different contact. Existing free/paid lineage and rows remain unchanged.

ALTER TABLE sfp_outreach_eligibility
  ADD COLUMN IF NOT EXISTS contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL;

ALTER TABLE sfp_outreach_eligibility
  DROP CONSTRAINT IF EXISTS sfp_outreach_eligibility_source_ref_one_of_chk;
ALTER TABLE sfp_outreach_eligibility
  ADD CONSTRAINT sfp_outreach_eligibility_source_ref_one_of_chk CHECK (
    source_kind IS NULL
    OR (source_kind = 'free' AND candidate_id IS NOT NULL AND paid_candidate_evidence_id IS NULL AND contact_id IS NULL)
    OR (source_kind = 'paid' AND paid_candidate_evidence_id IS NOT NULL AND candidate_id IS NULL AND contact_id IS NULL)
    OR (source_kind = 'contact' AND contact_id IS NOT NULL AND candidate_id IS NULL AND paid_candidate_evidence_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS sfp_outreach_eligibility_contact_idx
  ON sfp_outreach_eligibility (contact_id);

ALTER TABLE sfp_campaign_staging_intents
  ADD COLUMN IF NOT EXISTS contact_id INTEGER REFERENCES contacts(id) ON DELETE RESTRICT;

ALTER TABLE sfp_campaign_staging_intents
  DROP CONSTRAINT IF EXISTS sfp_campaign_staging_intents_source_ref_one_of_chk;
ALTER TABLE sfp_campaign_staging_intents
  ADD CONSTRAINT sfp_campaign_staging_intents_source_ref_one_of_chk CHECK (
    (source_kind = 'free' AND candidate_id IS NOT NULL AND paid_candidate_evidence_id IS NULL AND contact_id IS NULL)
    OR (source_kind = 'paid' AND paid_candidate_evidence_id IS NOT NULL AND candidate_id IS NULL AND contact_id IS NULL)
    OR (source_kind = 'contact' AND contact_id IS NOT NULL AND candidate_id IS NULL AND paid_candidate_evidence_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS sfp_campaign_staging_intents_contact_idx
  ON sfp_campaign_staging_intents (contact_id);
