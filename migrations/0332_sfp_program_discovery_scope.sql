-- Historical cohort rows retain their original authority. Ordinary discovery
-- uses explicit program/business pins in the SAME durable stage ledger.
ALTER TABLE sfp_stage_runs
  ALTER COLUMN cohort_run_id DROP NOT NULL,
  ADD COLUMN program_id uuid REFERENCES sfp_programs(id) ON DELETE RESTRICT,
  ADD COLUMN selection_snapshot jsonb,
  ADD CONSTRAINT sfp_stage_runs_parent_scope_chk CHECK (
    (cohort_run_id IS NOT NULL AND program_id IS NULL AND selection_snapshot IS NULL)
    OR (cohort_run_id IS NULL AND program_id IS NOT NULL
      AND selection_snapshot IS NOT NULL AND jsonb_typeof(selection_snapshot)='object'
      AND selection_snapshot ? 'programHash' AND selection_snapshot ? 'businessPins')
  );
--> statement-breakpoint
CREATE INDEX sfp_stage_runs_program_stage_idx ON sfp_stage_runs(program_id,stage,created_at);
--> statement-breakpoint
ALTER TABLE sfp_provider_retrieval_tasks ALTER COLUMN cohort_run_id DROP NOT NULL;