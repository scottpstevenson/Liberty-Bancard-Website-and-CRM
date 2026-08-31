-- CRO-08A follow-up: cro03c_runs.mode CHECK must also accept the continuous
-- occurrence run mode. Additive only; does not touch CRO-03A/B/C rows.
ALTER TABLE cro03c_runs DROP CONSTRAINT IF EXISTS cro03c_run_mode_chk;
ALTER TABLE cro03c_runs
  ADD CONSTRAINT cro03c_run_mode_chk
  CHECK (mode IN ('cro03c_micro_canary_v1','cro03c_live_v1','cro03c_continuous_occurrence_v1'));
