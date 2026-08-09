-- #1407 — Churn/Save Desk Automation
-- When a merchant crosses the churn threshold, a save case is created with
-- a structured playbook. Reps log outcomes; the engine auto-escalates.

CREATE TABLE IF NOT EXISTS save_cases (
  id               SERIAL PRIMARY KEY,
  contact_id       INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id          INTEGER REFERENCES deals(id),
  health_alert_id  INTEGER REFERENCES health_alerts(id),
  churn_score      INTEGER,                                  -- score at time of case creation
  risk_tier        TEXT    NOT NULL,                         -- High | Critical
  trigger_signals  JSONB   NOT NULL DEFAULT '[]',            -- array of signal names that fired
  status           TEXT    NOT NULL DEFAULT 'open',          -- open | retained | churned | escalated | closed
  assigned_to      TEXT,                                     -- rep email
  outcome          TEXT,                                     -- retained | churned | transferred | pending
  outcome_notes    TEXT,
  playbook_day     INTEGER NOT NULL DEFAULT 0,               -- current day in playbook (0=just opened)
  escalation_level INTEGER NOT NULL DEFAULT 0,               -- 0=rep, 1=manager, 2=executive
  day2_email_sent  BOOLEAN NOT NULL DEFAULT false,
  day5_manager_notified BOOLEAN NOT NULL DEFAULT false,
  day10_exec_notified BOOLEAN NOT NULL DEFAULT false,
  last_activity_at TIMESTAMP,
  resolved_at      TIMESTAMP,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_save_cases_contact_id
  ON save_cases(contact_id);

CREATE INDEX IF NOT EXISTS idx_save_cases_status
  ON save_cases(status) WHERE status = 'open';

-- Prevent duplicate open cases per contact
CREATE UNIQUE INDEX IF NOT EXISTS idx_save_cases_open_unique
  ON save_cases(contact_id) WHERE status = 'open';
