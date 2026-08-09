-- #1409 — Human Correction Loop, Prompt Versioning, Golden Examples

-- Rep corrections to AI-classified fields
CREATE TABLE IF NOT EXISTS ai_corrections (
  id                 SERIAL PRIMARY KEY,
  decision_log_id    INTEGER REFERENCES ai_decision_log(id) ON DELETE SET NULL,
  contact_id         INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  decision_type      TEXT    NOT NULL,
  original_value     JSONB   NOT NULL,    -- what the AI produced
  corrected_value    JSONB   NOT NULL,    -- what the rep changed it to
  correction_reason  TEXT,               -- structured: wrong_context | new_info | model_error | data_quality | other
  corrected_by       TEXT,               -- rep user id / email
  session_id         TEXT,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_corrections_decision_type
  ON ai_corrections(decision_type);

CREATE INDEX IF NOT EXISTS idx_ai_corrections_created_at
  ON ai_corrections(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_corrections_contact_id
  ON ai_corrections(contact_id);

-- Prompt version registry
CREATE TABLE IF NOT EXISTS prompt_versions (
  id              SERIAL PRIMARY KEY,
  prompt_key      TEXT    NOT NULL,   -- intent_classification | nba | lead_scoring | health_score
  version         TEXT    NOT NULL,   -- semver e.g. "1.0.0"
  prompt_text     TEXT    NOT NULL,
  model_id        TEXT,
  effective_from  TIMESTAMP NOT NULL DEFAULT NOW(),
  effective_to    TIMESTAMP,
  deployed_by     TEXT,
  notes           TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_versions_key_version
  ON prompt_versions(prompt_key, version);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_key_active
  ON prompt_versions(prompt_key, effective_from DESC);

-- Golden evaluation examples (ground truth for offline accuracy measurement)
CREATE TABLE IF NOT EXISTS golden_examples (
  id              SERIAL PRIMARY KEY,
  decision_type   TEXT    NOT NULL,
  input_snapshot  JSONB   NOT NULL,   -- sanitized input that produced a decision
  expected_output JSONB   NOT NULL,   -- what the correct answer should be
  source          TEXT    NOT NULL DEFAULT 'human_label',  -- human_label | correction | expert_review
  label           TEXT,               -- optional human-readable label
  active          BOOLEAN NOT NULL DEFAULT true,
  created_by      TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_golden_examples_decision_type
  ON golden_examples(decision_type) WHERE active = true;
