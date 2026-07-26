-- Migration 0087: Demo data archival + lead list staging pipeline

-- Add archival and readiness-state columns to prospect_lists
ALTER TABLE prospect_lists
  ADD COLUMN IF NOT EXISTS archived_at  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS archived_reason TEXT,
  ADD COLUMN IF NOT EXISTS readiness_state TEXT NOT NULL DEFAULT 'uploaded',
  ADD COLUMN IF NOT EXISTS lead_source TEXT;

-- Index for filtering archived vs active lists
CREATE INDEX IF NOT EXISTS prospect_lists_archived_at_idx ON prospect_lists (archived_at);
