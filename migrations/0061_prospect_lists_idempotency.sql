-- Add idempotency fields to prospect_lists for file-fingerprint replay protection.
ALTER TABLE prospect_lists
  ADD COLUMN IF NOT EXISTS file_hash text,
  ADD COLUMN IF NOT EXISTS import_type text,
  ADD COLUMN IF NOT EXISTS inserted_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_within_file integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_existing integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conflict_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actor text;

-- Partial unique index: only one running-or-complete import per (import_type, file_hash).
-- Allows re-importing after a 'failed' status.
CREATE UNIQUE INDEX IF NOT EXISTS prospect_lists_import_type_hash_uidx
  ON prospect_lists (import_type, file_hash)
  WHERE status IN ('running', 'complete');
