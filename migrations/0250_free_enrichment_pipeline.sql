-- Migration 0250: Free Enrichment Pipeline
-- Adds free enrichment tracking columns to businesses table and
-- extends cro03_source_subjects to permit subject_type = 'business'.

-- 1. Additive columns on businesses (all nullable, zero-downtime safe)
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS free_enrichment_status TEXT,
  ADD COLUMN IF NOT EXISTS free_enrichment_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_enrichment_last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS free_enrichment_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS free_enrichment_last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS free_enrichment_evidence JSONB;

-- 2. Partial index for queue selection — serves the exact batch predicate:
--    website_domain IS NOT NULL AND free_enrichment_status IS NULL
--    Allows efficient batch reads without scanning the full table.
CREATE INDEX IF NOT EXISTS businesses_free_enrich_queue_idx
  ON businesses (id)
  WHERE website_domain IS NOT NULL AND free_enrichment_status IS NULL;

-- 3. Extend cro03_source_subjects.subject_type to include 'business'.
--    The prior constraint (migration 0187) excludes this value; every
--    createCro03SourceBatch() call with subject_type='business' would
--    violate it and cause the enrichment job to fail and retry forever.
--    We drop and recreate the constraint with all prior values plus 'business'.
ALTER TABLE cro03_source_subjects
  DROP CONSTRAINT IF EXISTS cro03_source_subject_type_chk,
  ADD CONSTRAINT cro03_source_subject_type_chk CHECK (subject_type IN
    ('contact','prospect','sunbiz_entity','sdr_merchant','provider_csv_row',
     'public_web','lead_discovery_result','master_lead','business'));
