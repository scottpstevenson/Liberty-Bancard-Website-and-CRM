-- Follow-on idempotent hardening for environments where 0182 was applied
-- before the final CR-06 concurrency review.
DROP INDEX IF EXISTS cr06_artifacts_current_identity_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS cr06_preparation_runs_active_exact_uidx
  ON cr06_preparation_runs(program_artifact_id, approval_id, cohort_run_id)
  WHERE state IN ('building','ready_held');

CREATE TABLE IF NOT EXISTS cr06_manual_task_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preparation_run_id UUID NOT NULL REFERENCES cr06_preparation_runs(id) ON DELETE RESTRICT,
  prepared_enrollment_id UUID NOT NULL UNIQUE REFERENCES cr06_prepared_enrollments(id) ON DELETE RESTRICT,
  task_definition_artifact_id UUID NOT NULL REFERENCES cr06_artifacts(id) ON DELETE RESTRICT,
  trigger_touch_number INTEGER NOT NULL DEFAULT 2,
  state TEXT NOT NULL DEFAULT 'held',
  scheduled_after TIMESTAMPTZ NOT NULL,
  cr05_task_id INTEGER REFERENCES tasks(id) ON DELETE RESTRICT,
  command_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cr06_manual_task_intent_trigger_chk CHECK (trigger_touch_number = 2),
  CONSTRAINT cr06_manual_task_intent_state_chk CHECK (state IN ('held','eligible','created','cancelled','terminal'))
);