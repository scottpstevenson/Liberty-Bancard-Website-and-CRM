-- Development/disposable migration. Production DDL belongs to Publish.
ALTER TABLE sfp_outreach_eligibility
  ADD COLUMN IF NOT EXISTS recipient_association_pins jsonb NOT NULL DEFAULT '[]'::jsonb;