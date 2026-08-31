-- CRO-08A follow-up #2: 0216 widened cro03c_generations.mode for the
-- continuous_occurrence mode but missed the pre-existing micro_canary mode.
-- resolveCro03cGenerationMode() (the single source of truth for both
-- cro03c_runs.mode and cro03c_generations.mode) writes CRO03C_CANARY_MODE
-- ('cro03c_micro_canary_v1') for every micro_canary command, so the
-- generation-level CHECK must accept it too or micro_canary generation
-- inserts fail post-migration. Additive only; does not touch existing rows.
ALTER TABLE cro03c_generations DROP CONSTRAINT IF EXISTS cro03c_generation_mode_chk;
ALTER TABLE cro03c_generations
  ADD CONSTRAINT cro03c_generation_mode_chk
  CHECK (mode IN ('cro03c_live_v1', 'cro03c_micro_canary_v1', 'cro03c_continuous_occurrence_v1'));
