-- Executive KPI Tables: weekly snapshots + configurable goals
-- Part of the Executive KPI Layer with AI Coaching (Task #1229)

CREATE TABLE IF NOT EXISTS executive_weekly_snapshots (
  id SERIAL PRIMARY KEY,
  week_start DATE NOT NULL UNIQUE,
  -- Revenue / volume
  closed_won_volume NUMERIC(15,2) NOT NULL DEFAULT 0,
  closed_won_count  INTEGER       NOT NULL DEFAULT 0,
  gross_profit_monthly NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_profit_monthly   NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross_margin_pct NUMERIC(8,4) NOT NULL DEFAULT 0,  -- stored as % (e.g. 0.45 = 0.45%)
  net_margin_pct   NUMERIC(8,4) NOT NULL DEFAULT 0,
  -- Pipeline
  pipeline_value     NUMERIC(15,2) NOT NULL DEFAULT 0,
  pipeline_deal_count INTEGER      NOT NULL DEFAULT 0,
  -- Funnel
  new_leads         INTEGER NOT NULL DEFAULT 0,
  proposals_sent    INTEGER NOT NULL DEFAULT 0,
  statements_received INTEGER NOT NULL DEFAULT 0,
  meetings_booked   INTEGER NOT NULL DEFAULT 0,
  -- Outreach
  emails_sent INTEGER NOT NULL DEFAULT 0,
  sms_sent    INTEGER NOT NULL DEFAULT 0,
  calls_made  INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  -- Goals comparison (stored at snapshot time)
  goals_snapshot  JSONB,   -- full goals object at generation time
  goals_vs_actuals JSONB,  -- {key:{goal,actual,status:'green'|'yellow'|'red',pct}}
  -- Per-rep breakdown
  rep_breakdown JSONB,  -- [{agentId,name,closedWon,volume,proposals,statements,meetings,emails,replies}]
  -- AI narratives
  gpt_briefing     TEXT,
  claude_coaching  JSONB,  -- [{agentId,name,coachingText,gapSummary}]
  ai_generated_at  TIMESTAMP,
  -- Meta
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS exec_snapshots_week_start_idx
  ON executive_weekly_snapshots(week_start DESC);

-- ─── Goals ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS executive_goals (
  id         SERIAL  PRIMARY KEY,
  key        TEXT    NOT NULL UNIQUE,
  value      NUMERIC(15,4) NOT NULL,
  period     TEXT    NOT NULL DEFAULT 'weekly',  -- 'weekly' | 'monthly'
  label      TEXT,
  set_by     TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Default goals seeded from the planning session (all editable via UI)
-- Volume goals: monthly $1,500,000; weekly derived as $1,500,000 / 4.33 ≈ $346,154
-- Margin goals entered as % (0.5 = 0.5%, 0.25 = 0.25%)
INSERT INTO executive_goals (key, value, period, label) VALUES
  ('monthly_volume_goal',      1500000,   'monthly', 'Monthly New Processing Volume ($)'),
  ('weekly_volume_goal',        346154,   'weekly',  'Weekly New Processing Volume ($)'),
  ('gross_margin_pct_goal',       0.50,   'monthly', 'Gross Margin % Target'),
  ('net_margin_pct_goal',         0.25,   'monthly', 'Net Margin % Target'),
  ('weekly_deals_closed_goal',       4,   'weekly',  'Deals Closed per Week'),
  ('weekly_proposals_goal',         10,   'weekly',  'Proposals Sent per Week'),
  ('weekly_statements_goal',         8,   'weekly',  'Statements Received per Week'),
  ('weekly_meetings_goal',           6,   'weekly',  'Meetings Booked per Week')
ON CONFLICT DO NOTHING;
