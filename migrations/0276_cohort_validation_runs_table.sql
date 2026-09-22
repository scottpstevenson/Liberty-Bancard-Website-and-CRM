-- 0276: Create mi09_cohort_validation_runs table (was runtime DDL in cohort-validation.ts)
CREATE TABLE IF NOT EXISTS mi09_cohort_validation_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_run_id          UUID NOT NULL,
  idempotency_key       TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','running','completed','failed')),
  addresses_validated   INTEGER NOT NULL DEFAULT 0,
  master_leads_created  INTEGER NOT NULL DEFAULT 0,
  outcomes              JSONB NOT NULL DEFAULT '[]'::jsonb,
  actor_id              TEXT NOT NULL,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_cohort_validation_runs_pilot
  ON mi09_cohort_validation_runs (pilot_run_id, started_at DESC);
