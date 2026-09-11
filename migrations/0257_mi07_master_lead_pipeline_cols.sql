-- MI-07: Add pipeline columns to master_leads
-- when: 1800000006600

-- Pipeline origin discriminator
ALTER TABLE master_leads
  ADD COLUMN IF NOT EXISTS pipeline_origin TEXT NOT NULL DEFAULT 'manual_import';

-- Pipeline canonical linkage
ALTER TABLE master_leads
  ADD COLUMN IF NOT EXISTS canonical_business_id INTEGER REFERENCES businesses(id);

ALTER TABLE master_leads
  ADD COLUMN IF NOT EXISTS cro03_generation_id UUID;

-- Email dedup token (SHA-256 hex of normalised email, never plaintext)
ALTER TABLE master_leads
  ADD COLUMN IF NOT EXISTS email_token_hash TEXT;

-- County FIPS from business_locations (upserted by MI-06/#1920 projection-service)
ALTER TABLE master_leads
  ADD COLUMN IF NOT EXISTS county_fips TEXT;

-- Masked email display value (e.g. j***@example.com) for pipeline rows
ALTER TABLE master_leads
  ADD COLUMN IF NOT EXISTS masked_email TEXT;

-- Pipeline status timestamps
ALTER TABLE master_leads
  ADD COLUMN IF NOT EXISTS suppressed_at TIMESTAMPTZ;

ALTER TABLE master_leads
  ADD COLUMN IF NOT EXISTS promoted_contact_id INTEGER REFERENCES contacts(id);

-- Indexes
CREATE INDEX IF NOT EXISTS master_leads_pipeline_origin_idx
  ON master_leads (pipeline_origin);

CREATE INDEX IF NOT EXISTS master_leads_canonical_business_id_idx
  ON master_leads (canonical_business_id);

CREATE INDEX IF NOT EXISTS master_leads_cro03_generation_id_idx
  ON master_leads (cro03_generation_id);

CREATE INDEX IF NOT EXISTS master_leads_email_token_hash_idx
  ON master_leads (email_token_hash);

-- updated_at column for pipeline status mutations
ALTER TABLE master_leads
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- One active pipeline row per business (prevents duplicate staging)
CREATE UNIQUE INDEX IF NOT EXISTS master_leads_pipeline_active_business_uidx
  ON master_leads (canonical_business_id)
  WHERE pipeline_origin = 'cro03_pipeline'
    AND status NOT IN ('duplicate', 'suppressed');
