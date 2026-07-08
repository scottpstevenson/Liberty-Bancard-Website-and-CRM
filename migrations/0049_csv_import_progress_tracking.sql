-- 0049_csv_import_progress_tracking.sql
-- Task #822 — Fix import row loss, lead_source collision & stale import recovery.
-- Adds progress-tracking columns so a crash mid-import leaves visible partial
-- progress rather than zeroed counters, and supports new status values:
--   interrupted / legacy_interrupted / stale
-- Idempotent: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE csv_imports ADD COLUMN IF NOT EXISTS processed_rows   integer;
ALTER TABLE csv_imports ADD COLUMN IF NOT EXISTS last_progress_at  timestamp;
ALTER TABLE csv_imports ADD COLUMN IF NOT EXISTS stale_reason      text;
