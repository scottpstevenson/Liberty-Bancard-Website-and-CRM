-- MI-09: Widen cro03c_command_type_chk to include 'pilot_phase'.
-- pilot_phase commands are repeatable, independently bounded per page, and
-- provider-optional (Pilot 1 excludes all paid providers). Unlike initial_batch
-- they carry no global one-shot reservation guard.
ALTER TABLE cro03c_commands DROP CONSTRAINT IF EXISTS cro03c_command_type_chk;
ALTER TABLE cro03c_commands ADD CONSTRAINT cro03c_command_type_chk
  CHECK (command_type IN ('activation','micro_canary','initial_batch','continuous_occurrence','pilot_phase'));
