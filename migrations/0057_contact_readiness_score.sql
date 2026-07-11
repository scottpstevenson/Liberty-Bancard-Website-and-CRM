-- Phase 2: Contact Readiness Score
-- Adds versioned data-completeness scoring to contacts,
-- a backfill-run tracking table, and readiness columns to campaigns/previews.

-- 1. New readiness columns on contacts
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS data_readiness_score INTEGER,
  ADD COLUMN IF NOT EXISTS data_readiness_grade TEXT,
  ADD COLUMN IF NOT EXISTS readiness_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS readiness_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS readiness_model_version INTEGER,
  ADD COLUMN IF NOT EXISTS last_meaningful_contact_mutation_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contacts_data_readiness_score ON contacts(data_readiness_score);

-- 2. Backfill run tracker
CREATE TABLE IF NOT EXISTS contact_readiness_runs (
  id SERIAL PRIMARY KEY,
  run_id UUID NOT NULL UNIQUE,
  model_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  total_eligible INTEGER,
  processed INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  force BOOLEAN NOT NULL DEFAULT FALSE,
  last_processed_contact_id INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT
);

-- 3. Readiness snapshot columns on campaign_previews
ALTER TABLE campaign_previews
  ADD COLUMN IF NOT EXISTS readiness_threshold INTEGER,
  ADD COLUMN IF NOT EXISTS readiness_model_version INTEGER;

-- 4. Readiness threshold on campaigns
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS readiness_threshold INTEGER;
