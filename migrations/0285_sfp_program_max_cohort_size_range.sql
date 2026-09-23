-- 0285: SFP round-3 correction (item 4) — enforce sfp_programs.max_cohort_size
-- BETWEEN 1 AND 100 at the database layer.
--
-- This is a DISTINCT owned layer from sfp_cohort_runs.cohort_size's own
-- 0-100 range check (migration 0284): that one bounds the RESULT of a
-- freeze, this one bounds what an operator may configure as the program's
-- ceiling. They must never be confused with each other.
--
-- Safe-apply against existing production data: clamp any existing
-- out-of-range value into [1, 100] before adding the constraint, so this
-- migration can never fail against a pre-existing row.

UPDATE sfp_programs
SET max_cohort_size = LEAST(GREATEST(max_cohort_size, 1), 100)
WHERE max_cohort_size < 1 OR max_cohort_size > 100;

ALTER TABLE sfp_programs
  DROP CONSTRAINT IF EXISTS sfp_programs_max_cohort_size_range;

ALTER TABLE sfp_programs
  ADD CONSTRAINT sfp_programs_max_cohort_size_range
  CHECK (max_cohort_size BETWEEN 1 AND 100);
