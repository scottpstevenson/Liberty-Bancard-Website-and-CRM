-- Task #1990: Add geography_backfill_attempted_at sentinel to cro03_source_observations
-- This column lets the geography backfill job skip observations that have already been
-- processed (including those outside South Florida where no countyFips is resolvable),
-- preventing unbounded re-scanning on every tick as the table grows.
ALTER TABLE cro03_source_observations
  ADD COLUMN IF NOT EXISTS geography_backfill_attempted_at timestamptz;

-- Partial index so the backfill WHERE clause (geography_backfill_attempted_at IS NULL)
-- is efficient even on a large table.
CREATE INDEX IF NOT EXISTS cro03_obs_geo_backfill_pending_idx
  ON cro03_source_observations (created_at ASC)
  WHERE geography_backfill_attempted_at IS NULL;
