-- Task #2001 post-merge corrective patch (PM-04): give
-- sfp_campaign_staging_commands a real pending/executing/completed
-- lifecycle so a crash between per-row commits and receipt insertion can be
-- resumed and reconciled, instead of only ever recording a command after
-- every row already succeeded.
--
-- This is a NEW forward migration; 0290/0291 (already applied) are never
-- edited in place. Every statement is written to be safely re-runnable
-- (IF NOT EXISTS / guarded DO blocks) because this file was applied once
-- ahead of drizzle's own migration-tracking row during development.

ALTER TABLE sfp_campaign_staging_commands
  ALTER COLUMN stored_result DROP NOT NULL;

ALTER TABLE sfp_campaign_staging_commands
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'completed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sfp_campaign_staging_commands_state_check'
  ) THEN
    ALTER TABLE sfp_campaign_staging_commands
      ADD CONSTRAINT sfp_campaign_staging_commands_state_check
      CHECK (state IN ('pending', 'executing', 'completed'));
  END IF;
END $$;

-- Any row that already exists predates this lifecycle and, by definition,
-- only ever got inserted after full completion — backfill is a no-op given
-- the column default, kept explicit for clarity.
UPDATE sfp_campaign_staging_commands SET state = 'completed' WHERE state IS DISTINCT FROM 'completed';

ALTER TABLE sfp_campaign_staging_commands
  ALTER COLUMN state DROP DEFAULT;
