-- MI-02: Add pre-finalization snapshot manifest columns to source_import_runs.
-- These are populated BEFORE tombstoning so a failed/interrupted run can be
-- audited for completeness without trusting only the accepted key count.

ALTER TABLE source_import_runs
  ADD COLUMN IF NOT EXISTS csv_sha256        TEXT,           -- SHA-256 of raw uploaded CSV bytes
  ADD COLUMN IF NOT EXISTS source_row_count  INTEGER,        -- total rows parsed from CSV (before filtering)
  ADD COLUMN IF NOT EXISTS accepted_key_count INTEGER;       -- keys accepted after normalization filtering

-- Index to find runs by csv hash (useful for deduplicating accidental re-uploads)
CREATE INDEX IF NOT EXISTS source_import_runs_csv_sha256_idx
  ON source_import_runs (csv_sha256) WHERE csv_sha256 IS NOT NULL;
