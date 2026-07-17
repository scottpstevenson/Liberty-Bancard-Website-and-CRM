-- Rebuild system_audit_runs with the canonical schema from the spec.
-- The table was only created moments ago (no production data to preserve).
DROP TABLE IF EXISTS "system_audit_runs";

CREATE TABLE "system_audit_runs" (
  "id"               serial PRIMARY KEY NOT NULL,
  "ran_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "overall_score"    integer,
  "probe_results"    jsonb,
  "claude_narrative" text,
  "slack_status"     text NOT NULL DEFAULT 'skipped',
  "triggered_by"     text NOT NULL DEFAULT 'schedule',
  "created_at"       timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "system_audit_runs_ran_at_idx"     ON "system_audit_runs" ("ran_at");
CREATE INDEX IF NOT EXISTS "system_audit_runs_triggered_idx"  ON "system_audit_runs" ("triggered_by");
