-- #1408 — AI Memory Architecture: ai_decision_log table
-- Every AI decision is stored here with its inputs, outputs, confidence, and outcome linkage.
-- This is the audit trail that feeds the correction loop and accuracy metrics.

CREATE TABLE IF NOT EXISTS ai_decision_log (
  id                SERIAL PRIMARY KEY,
  decision_type     TEXT    NOT NULL,  -- intent_classification | nba | lead_scoring | health_score | sequence_select
  contact_id        INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id           INTEGER REFERENCES deals(id)    ON DELETE SET NULL,
  model             TEXT,
  prompt_key        TEXT,              -- which prompt template was used
  prompt_version    TEXT,             -- semver of the prompt version
  input_summary     JSONB   NOT NULL DEFAULT '{}',   -- sanitized key inputs (no PII)
  decision_output   JSONB   NOT NULL DEFAULT '{}',   -- the classification/score/recommendation
  confidence        REAL,
  confidence_tier   TEXT,             -- high (>0.85) | medium (0.65–0.85) | low (<0.65)
  was_overridden    BOOLEAN NOT NULL DEFAULT false,
  override_reason   TEXT,
  outcome           TEXT,             -- accepted | overridden | ignored | pending
  tokens_used       INTEGER,
  cost_cents        REAL,
  duration_ms       INTEGER,
  source_event_id   INTEGER,
  flagged           BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_decision_log_contact_id
  ON ai_decision_log(contact_id);

CREATE INDEX IF NOT EXISTS idx_ai_decision_log_decision_type
  ON ai_decision_log(decision_type);

CREATE INDEX IF NOT EXISTS idx_ai_decision_log_created_at
  ON ai_decision_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_decision_log_overridden
  ON ai_decision_log(was_overridden) WHERE was_overridden = true;
