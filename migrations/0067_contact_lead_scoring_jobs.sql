CREATE TABLE "contact_lead_scoring_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "contact_id" integer NOT NULL REFERENCES "contacts"("id"),
  "requested_generation" integer DEFAULT 1 NOT NULL,
  "processed_generation" integer DEFAULT 0 NOT NULL,
  "status" text NOT NULL,
  "trigger_sources" text[],
  "input_version_snapshot" timestamptz,
  "enqueue_attempts" integer DEFAULT 0 NOT NULL,
  "execution_attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamptz,
  "last_error_code" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz
);

CREATE UNIQUE INDEX "contact_lead_scoring_jobs_active_unique_idx"
ON "contact_lead_scoring_jobs" ("contact_id")
WHERE status NOT IN ('completed', 'contact_not_found', 'failed_terminal');

CREATE INDEX "contact_lead_scoring_jobs_contact_id_idx" ON "contact_lead_scoring_jobs" ("contact_id");
CREATE INDEX "contact_lead_scoring_jobs_status_next_attempt_idx"
ON "contact_lead_scoring_jobs" ("status", "next_attempt_at")
WHERE status = 'deferred_queue_unavailable';
