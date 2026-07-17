CREATE TABLE IF NOT EXISTS "system_audit_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "triggered_by" text NOT NULL DEFAULT 'schedule',
  "triggered_by_user_id" integer,
  "status" text NOT NULL DEFAULT 'running',
  "probe_results" jsonb,
  "narrative" text,
  "slack_delivery_status" text NOT NULL DEFAULT 'skipped',
  "slack_delivery_error" text,
  "duration_ms" integer,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "system_audit_runs_status_idx" ON "system_audit_runs" ("status");
CREATE INDEX IF NOT EXISTS "system_audit_runs_started_at_idx" ON "system_audit_runs" ("started_at");
