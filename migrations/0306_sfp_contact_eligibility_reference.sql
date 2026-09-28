-- Gate 1 (Liberty Bancard enrichment): existing CRM contacts linked to a
-- canonical business via contacts.business_id are now a third SFP candidate
-- source (see getUnifiedSfpCandidates in sfp-paid-evidence-writer.ts). This
-- adds the reference column so an eligibility decision made against a
-- contact-sourced candidate can be traced back to the exact contacts row,
-- the same way candidate_id/paid_candidate_evidence_id already do for the
-- free/paid sources.
ALTER TABLE sfp_outreach_eligibility
  ADD COLUMN IF NOT EXISTS contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sfp_outreach_eligibility_contact_idx ON sfp_outreach_eligibility (contact_id);
