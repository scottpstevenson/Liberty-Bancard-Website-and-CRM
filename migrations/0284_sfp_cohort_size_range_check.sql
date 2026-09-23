-- 0284: SFP round-2 correction — apply the sfp_cohort_runs.cohort_size range
-- check constraint that was added to shared/schema.ts (Correction 5) but had
-- no corresponding migration, so the database never actually enforced it.
--
-- This is the database-owned enforcement layer for the program cohort cap:
-- application code already clamps maxCohortSize via
-- Math.min(SFP_PROGRAM_MAX_COHORT, ...) in freezeCohortLocked, but that is
-- app-layer discipline only — a direct write (or a future code path that
-- forgets the clamp) must still be rejected by the database itself.

ALTER TABLE sfp_cohort_runs
  DROP CONSTRAINT IF EXISTS sfp_cohort_runs_cohort_size_range;

ALTER TABLE sfp_cohort_runs
  ADD CONSTRAINT sfp_cohort_runs_cohort_size_range
  CHECK (cohort_size BETWEEN 0 AND 100);
