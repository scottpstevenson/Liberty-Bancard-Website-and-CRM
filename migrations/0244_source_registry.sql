-- MI-02: South Florida Source Registry
-- Adds durable import run records and adapter registry.
-- Does NOT introduce source_registry_records; normalized records flow via
-- createCro03SourceBatch() into the existing CRO-03 source-staging tables.

CREATE TABLE IF NOT EXISTS source_registry_adapters (
  adapter_key          TEXT PRIMARY KEY,
  source_name          TEXT NOT NULL,
  source_type          TEXT NOT NULL CHECK (source_type IN ('dbpr', 'county_lbt', 'stub')),
  county_fips          TEXT,
  stable_key_column    TEXT NOT NULL,
  active               BOOLEAN NOT NULL DEFAULT FALSE,
  schedule_disabled    BOOLEAN NOT NULL DEFAULT TRUE,
  status               TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('active', 'unverified', 'failed', 'pending')),
  terms_url            TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_import_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adapter_key          TEXT NOT NULL REFERENCES source_registry_adapters(adapter_key),
  status               TEXT NOT NULL DEFAULT 'queued'
                         CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  lease_token          UUID,
  lease_expires_at     TIMESTAMPTZ,
  cursor               JSONB,
  snapshot_hash        TEXT,
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  records_processed    INTEGER NOT NULL DEFAULT 0,
  records_new          INTEGER NOT NULL DEFAULT 0,
  records_updated      INTEGER NOT NULL DEFAULT 0,
  records_tombstoned   INTEGER NOT NULL DEFAULT 0,
  error_text           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS source_import_runs_adapter_status_idx
  ON source_import_runs (adapter_key, status);

CREATE INDEX IF NOT EXISTS source_import_runs_lease_idx
  ON source_import_runs (status, lease_expires_at)
  WHERE status = 'running';

-- Extend cro03_source_subjects with tombstoning support (additive only)
ALTER TABLE cro03_source_subjects
  ADD COLUMN IF NOT EXISTS tombstoned_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS cro03_source_subjects_tombstoned_idx
  ON cro03_source_subjects (source_system, tombstoned_at)
  WHERE tombstoned_at IS NULL;

-- Replace the blanket immutability trigger on cro03_source_subjects with one
-- that allows a single one-way tombstone write (NULL → non-null tombstoned_at)
-- while still blocking all other mutations.
CREATE OR REPLACE FUNCTION cro03_source_subject_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Allow one-way tombstone: NULL → non-null, no other column changes
  IF TG_OP = 'UPDATE'
     AND OLD.tombstoned_at IS NULL
     AND NEW.tombstoned_at IS NOT NULL
     AND OLD.id               = NEW.id
     AND OLD.subject_type     = NEW.subject_type
     AND OLD.subject_key      = NEW.subject_key
     AND OLD.source_system    = NEW.source_system
     AND OLD.created_at       = NEW.created_at
  THEN
    RETURN NEW;  -- permit
  END IF;
  RAISE EXCEPTION 'CRO03_IMMUTABLE_ROW_GUARD: % on % is not permitted', TG_OP, TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS cro03_source_subject_immutable ON cro03_source_subjects;
CREATE TRIGGER cro03_source_subject_immutable
  BEFORE UPDATE OR DELETE ON cro03_source_subjects
  FOR EACH ROW EXECUTE FUNCTION cro03_source_subject_guard();

-- Seed adapter registry (schedules disabled; no cron fires automatically)
INSERT INTO source_registry_adapters
  (adapter_key, source_name, source_type, county_fips, stable_key_column, active, schedule_disabled, status, terms_url)
VALUES
  ('dbpr-hr',  'DBPR Hotels & Restaurants',       'dbpr',       NULL,    'dbpr_hr_license_number',   TRUE,  TRUE, 'active',     'https://www.myfloridalicense.com/DBPR/hotels-restaurants/licensing/public-records/'),
  ('dbpr-abt', 'DBPR Alcoholic Beverages & Tobacco', 'dbpr',    NULL,    'dbpr_abt_license_number',  TRUE,  TRUE, 'active',     'https://www.myfloridalicense.com/DBPR/alcoholic-beverages-tobacco/public-records/'),
  ('dbpr-cos', 'DBPR Cosmetology Establishments', 'dbpr',       NULL,    'dbpr_cos_license_number',  TRUE,  TRUE, 'active',     'https://www.myfloridalicense.com/DBPR/cosmetology/public-records/'),
  ('dbpr-bar', 'DBPR Barbers Establishments',     'dbpr',       NULL,    'dbpr_bar_license_number',  TRUE,  TRUE, 'active',     'https://www.myfloridalicense.com/barbers/public-records/'),
  ('mdade-lbt','Miami-Dade Local Business Tax',   'county_lbt', '12086', 'mdade_lbt_account_number', TRUE,  TRUE, 'active',     'https://opendata.miamidade.gov/Business/Local-Business-Tax-Receipts/'),
  ('broward-lbt','Broward County Business Tax',   'county_lbt', '12011', 'broward_lbt_account_number', FALSE, TRUE, 'unverified', NULL),
  ('palm-beach-lbt','Palm Beach County Business Tax','county_lbt','12099','palm_beach_lbt_account_number', FALSE, TRUE, 'unverified', NULL)
ON CONFLICT (adapter_key) DO NOTHING;
