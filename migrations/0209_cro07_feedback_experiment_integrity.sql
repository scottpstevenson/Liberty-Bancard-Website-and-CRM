-- CRO-07 correction (additive, post-0208-head):
-- 1. Experiment sample ingestion must be deduplicated against a real event
--    identity before any aggregate counter is incremented, so it can never
--    be inflated by an arbitrary repeated or fabricated call.
CREATE TABLE IF NOT EXISTS cro07_experiment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES cro07_experiments(id) ON DELETE RESTRICT,
  arm TEXT NOT NULL,
  event_key TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  guardrail_breach BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (experiment_id, event_key)
);
CREATE INDEX IF NOT EXISTS cro07_experiment_events_experiment_idx ON cro07_experiment_events (experiment_id);
