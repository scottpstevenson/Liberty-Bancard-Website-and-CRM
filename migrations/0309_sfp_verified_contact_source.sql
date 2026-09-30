-- C1/C2: complete the typed contact source without rewriting legacy hashes or
-- guessing verified identity. Source-contact FKs use RESTRICT so retained
-- eligibility/staging evidence cannot lose its originating contact on delete.
ALTER TABLE sfp_outreach_eligibility
  ADD COLUMN IF NOT EXISTS contact_business_link_decision_id UUID
    REFERENCES contact_business_link_decisions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS contact_business_link_revision INTEGER,
  ADD COLUMN IF NOT EXISTS normalized_value_hash_version INTEGER;

-- Preserve any pre-existing contact token hash as version 0. It was computed
-- by the CRM token-hash path, not the shared free/paid email normalizer. Only
-- bind it to the current verified decision when the FK projection agrees.
UPDATE sfp_outreach_eligibility e
   SET contact_business_link_decision_id=d.id,
       contact_business_link_revision=d.revision,
       normalized_value_hash=c.email_token_hash,
       normalized_value_hash_version=0
  FROM contacts c
  JOIN contact_business_link_decisions d
    ON d.contact_id=c.id AND d.business_id=c.business_id
   AND d.decision='verified' AND d.superseded_at IS NULL
 WHERE e.source_kind='contact'
   AND e.contact_id=c.id
   AND e.normalized_value_hash IS NULL
   AND c.business_id=d.business_id
   AND c.email_token_hash IS NOT NULL;

-- Rows lacking the currently verified decision are retained as legacy-null
-- lineage rather than being grandfathered as a contact source.
UPDATE sfp_outreach_eligibility
   SET source_kind=NULL
 WHERE source_kind='contact'
   AND (contact_business_link_decision_id IS NULL
        OR contact_business_link_revision IS NULL
        OR normalized_value_hash IS NULL);

-- 0306 introduced contact_id with SET NULL; replace that deletion behavior so
-- historical validation evidence remains attributable instead of becoming
-- an untyped legacy row after a contact deletion.
ALTER TABLE sfp_outreach_eligibility
  DROP CONSTRAINT IF EXISTS sfp_outreach_eligibility_contact_id_fkey;
ALTER TABLE sfp_outreach_eligibility
  ADD CONSTRAINT sfp_outreach_eligibility_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE RESTRICT;

ALTER TABLE sfp_outreach_eligibility
  DROP CONSTRAINT IF EXISTS sfp_outreach_eligibility_source_ref_one_of_chk;
ALTER TABLE sfp_outreach_eligibility
  ADD CONSTRAINT sfp_outreach_eligibility_source_ref_one_of_chk CHECK (
    source_kind IS NULL
    OR (source_kind = 'free' AND candidate_id IS NOT NULL
        AND paid_candidate_evidence_id IS NULL AND contact_id IS NULL)
    OR (source_kind = 'paid' AND paid_candidate_evidence_id IS NOT NULL
        AND candidate_id IS NULL AND contact_id IS NULL)
    OR (source_kind = 'contact' AND contact_id IS NOT NULL
        AND candidate_id IS NULL AND paid_candidate_evidence_id IS NULL
        AND contact_business_link_decision_id IS NOT NULL
        AND contact_business_link_revision IS NOT NULL
        AND normalized_value_hash IS NOT NULL
        AND normalized_value_hash_version IS NOT NULL
        AND normalized_value_hash_version IN (0,1))
  );

CREATE INDEX IF NOT EXISTS sfp_outreach_eligibility_contact_idx
  ON sfp_outreach_eligibility (contact_id);
CREATE INDEX IF NOT EXISTS sfp_outreach_eligibility_link_decision_idx
  ON sfp_outreach_eligibility (contact_business_link_decision_id);

-- Typed immutable source lineage for package-pinned staging. Contact and link
-- decision deletions are restricted; legacy free/paid lineage is unchanged.
ALTER TABLE sfp_campaign_staging_intents
  ADD COLUMN IF NOT EXISTS contact_id INTEGER REFERENCES contacts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS contact_business_link_decision_id UUID
    REFERENCES contact_business_link_decisions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS contact_business_link_revision INTEGER,
  ADD COLUMN IF NOT EXISTS normalized_value_hash TEXT,
  ADD COLUMN IF NOT EXISTS normalized_value_hash_version INTEGER;

ALTER TABLE sfp_campaign_staging_intents
  DROP CONSTRAINT IF EXISTS sfp_campaign_staging_intents_source_ref_one_of_chk;
ALTER TABLE sfp_campaign_staging_intents
  ADD CONSTRAINT sfp_campaign_staging_intents_source_ref_one_of_chk CHECK (
    (source_kind = 'free' AND candidate_id IS NOT NULL
      AND paid_candidate_evidence_id IS NULL AND contact_id IS NULL)
    OR (source_kind = 'paid' AND paid_candidate_evidence_id IS NOT NULL
      AND candidate_id IS NULL AND contact_id IS NULL)
    OR (source_kind = 'contact' AND contact_id IS NOT NULL
      AND candidate_id IS NULL AND paid_candidate_evidence_id IS NULL
      AND contact_business_link_decision_id IS NOT NULL
      AND contact_business_link_revision IS NOT NULL
      AND normalized_value_hash IS NOT NULL
      AND normalized_value_hash_version IS NOT NULL
      AND normalized_value_hash_version IN (0,1))
  );

CREATE INDEX IF NOT EXISTS sfp_campaign_staging_intents_contact_idx
  ON sfp_campaign_staging_intents (contact_id);
CREATE INDEX IF NOT EXISTS sfp_campaign_staging_intents_link_decision_idx
  ON sfp_campaign_staging_intents (contact_business_link_decision_id);