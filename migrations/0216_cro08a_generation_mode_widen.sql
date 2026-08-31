-- CRO-08A follow-up: cro03c_generations.mode CHECK must also accept the
-- continuous occurrence generation mode (cro03c_runs.mode was already
-- widened in 0214, but the parallel constraint on cro03c_generations was
-- missed). Additive only; does not touch CRO-03A/B/C rows.
ALTER TABLE cro03c_generations DROP CONSTRAINT IF EXISTS cro03c_generation_mode_chk;
ALTER TABLE cro03c_generations
  ADD CONSTRAINT cro03c_generation_mode_chk
  CHECK (mode IN ('cro03c_live_v1', 'cro03c_continuous_occurrence_v1'));
