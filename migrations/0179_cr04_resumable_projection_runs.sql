-- CR-04 batches must be restartable without overloading the immutable final
-- membership fingerprint with mutable checkpoint data.
ALTER TABLE cr04_cohort_runs
  ADD COLUMN IF NOT EXISTS build_cursor INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reconciliation_cursor INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS build_phase TEXT NOT NULL DEFAULT 'building',
  ADD COLUMN IF NOT EXISTS lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS build_fence INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_code TEXT;

ALTER TABLE cr04_cohort_runs
  DROP CONSTRAINT IF EXISTS cr04_cohort_run_status_chk,
  ADD CONSTRAINT cr04_cohort_run_status_chk
    CHECK (status IN ('building','frozen','failed','consumed','cancelled','expired')),
  DROP CONSTRAINT IF EXISTS cr04_cohort_run_fingerprint_chk,
  ADD CONSTRAINT cr04_cohort_run_fingerprint_chk
    CHECK (membership_fingerprint ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT cr04_cohort_run_phase_chk
    CHECK (build_phase IN ('building','reconciling','complete'));

CREATE INDEX IF NOT EXISTS cr04_cohort_runs_resume_idx
  ON cr04_cohort_runs(status, build_phase, lease_expires_at, created_at);