-- Add DB-level email uniqueness backstop for new imports.
--
-- All existing prospects were inserted before migration 0062 added the
-- import_execution_id column, so they all have import_execution_id = NULL.
-- The partial index below only covers rows where import_execution_id IS NOT NULL
-- (i.e. rows written by the new idempotent import path), which means:
--   1. No existing data conflicts — no dedup or FK surgery required.
--   2. All new imports get a true DB-level uniqueness guard for concurrent uploads.
--
-- This index works in conjunction with the provenance index from migration 0062
-- (prospects_execution_row_uidx) and Drizzle's ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS prospects_email_import_unique_idx
  ON prospects (email)
  WHERE email IS NOT NULL AND import_execution_id IS NOT NULL;
