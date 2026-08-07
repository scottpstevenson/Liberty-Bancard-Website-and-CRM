-- Reconcile executive_goals with the current service/UI contract.
-- 0105_executive_kpi_tables.sql created the table with:
--   - key TEXT NOT NULL UNIQUE  (single-column constraint, wrong for period-aware model)
--   - set_by TEXT               (wrong type; code expects an integer user ID)
--   - period TEXT               (our schema uses period_type)
--   - legacy seed keys that don't match what executive-kpi.ts reads

-- 1. Add period_type column (our canonical column); period is kept for now to not drop old data.
ALTER TABLE executive_goals
  ADD COLUMN IF NOT EXISTS period_type TEXT NOT NULL DEFAULT 'weekly';

-- 2. set_by is TEXT in 0105_executive_kpi_tables.sql; users.id is UUID/varchar,
--    so TEXT is the correct type. No ALTER needed — keep it as-is.

-- 3. Drop the legacy single-key unique constraint so we can have the same key
--    stored under different period_types (weekly vs monthly).
--    PostgreSQL auto-names UNIQUE constraints as <table>_<col>_key.
ALTER TABLE executive_goals
  DROP CONSTRAINT IF EXISTS executive_goals_key_key;

-- 4. Create the correct composite unique index (idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS executive_goals_key_period_idx
  ON executive_goals (key, period_type);

-- 5. Migrate legacy seed keys → current service contract keys.
--    The KPI service reads: weekly_revenue, weekly_deals, weekly_proposals,
--    weekly_statements, gross_margin_pct, rep_deals_closed.
--    Legacy keys were: weekly_volume_goal, weekly_deals_closed_goal,
--    weekly_proposals_goal, weekly_statements_goal, gross_margin_pct_goal.
UPDATE executive_goals SET key = 'weekly_revenue'
  WHERE key = 'weekly_volume_goal' AND period_type = 'weekly';
UPDATE executive_goals SET key = 'weekly_deals'
  WHERE key = 'weekly_deals_closed_goal' AND period_type = 'weekly';
UPDATE executive_goals SET key = 'weekly_proposals'
  WHERE key = 'weekly_proposals_goal' AND period_type = 'weekly';
UPDATE executive_goals SET key = 'weekly_statements'
  WHERE key = 'weekly_statements_goal' AND period_type = 'weekly';
UPDATE executive_goals SET key = 'gross_margin_pct'
  WHERE key = 'gross_margin_pct_goal';

-- Remove monthly variants that have no matching service key.
DELETE FROM executive_goals
  WHERE key IN ('monthly_volume_goal', 'net_margin_pct_goal', 'weekly_meetings_goal');

-- 6. Insert missing seed rows for all keys the UI exposes (idempotent via ON CONFLICT).
INSERT INTO executive_goals (key, value, period_type) VALUES
  ('weekly_revenue',   50000, 'weekly'),
  ('weekly_deals',         4, 'weekly'),
  ('weekly_proposals',    10, 'weekly'),
  ('weekly_statements',    8, 'weekly'),
  ('gross_margin_pct',    35, 'weekly'),
  ('rep_deals_closed',     2, 'weekly')
ON CONFLICT (key, period_type) DO NOTHING;
