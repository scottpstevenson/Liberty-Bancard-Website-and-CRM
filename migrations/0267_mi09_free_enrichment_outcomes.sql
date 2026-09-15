-- MI-09 Level 1: durable, cohort-linked terminal evidence.
CREATE TABLE IF NOT EXISTS mi09_pilot_enrichment_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_run_id UUID NOT NULL REFERENCES mi09_pilot_runs(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK (outcome IN ('enriched', 'failed', 'skipped')),
  error_code TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pilot_run_id, business_id)
);
CREATE INDEX IF NOT EXISTS mi09_pilot_enrichment_outcomes_run_idx
  ON mi09_pilot_enrichment_outcomes (pilot_run_id, outcome);