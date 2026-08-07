-- Add columns required by our Drizzle schema to executive_weekly_snapshots.
-- The table was already created by 0105_executive_kpi_tables.sql with different
-- column names. We add the columns our code expects, using ADD COLUMN IF NOT EXISTS
-- so this migration is safe to run even if a column already exists.

ALTER TABLE executive_weekly_snapshots
  ADD COLUMN IF NOT EXISTS closed_won_revenue NUMERIC(14, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_profit        NUMERIC(14, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_profit          NUMERIC(14, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_deals_closed    INTEGER        DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outreach_attempts   INTEGER        DEFAULT 0,
  ADD COLUMN IF NOT EXISTS per_rep_breakdown   JSONB,
  ADD COLUMN IF NOT EXISTS generated_at        TIMESTAMP,
  ADD COLUMN IF NOT EXISTS trigger             TEXT           DEFAULT 'schedule';

-- 0105_executive_kpi_tables.sql already declares week_start DATE NOT NULL UNIQUE
-- at the table level, which satisfies ON CONFLICT (week_start) in the route and
-- worker. That migration also created a non-unique index named
-- exec_snapshots_week_start_idx; drop it so the name is free and the table-level
-- unique constraint is the sole authority.
DROP INDEX IF EXISTS exec_snapshots_week_start_idx;
