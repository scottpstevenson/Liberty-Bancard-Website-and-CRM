-- 0065_provenance_schema.sql
-- Intake Provenance: import_executions, contact_source_events,
-- contacts provenance columns, sunbiz_entities import_execution_id

-- 1. import_executions table
CREATE TABLE IF NOT EXISTS "import_executions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_type" text NOT NULL,
  "file_hash" text,
  "status" text NOT NULL DEFAULT 'running',
  "total_rows" integer,
  "inserted_rows" integer,
  "updated_rows" integer,
  "skipped_rows" integer,
  "error_rows" integer,
  "actor_type" text,
  "actor_id" text,
  "metadata" jsonb,
  "started_at" timestamp DEFAULT now(),
  "completed_at" timestamp
);
--> statement-breakpoint

-- Replay protection: same (importType, fileHash) cannot complete twice
CREATE UNIQUE INDEX IF NOT EXISTS "import_executions_type_hash_completed_uidx"
  ON "import_executions" ("import_type", "file_hash")
  WHERE file_hash IS NOT NULL AND status = 'completed';
--> statement-breakpoint

-- 2. contact_source_events table
CREATE TABLE IF NOT EXISTS "contact_source_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "contact_id" integer NOT NULL REFERENCES "contacts"("id"),
  "event_key" text NOT NULL,
  "source_category" text NOT NULL,
  "source_type" text NOT NULL,
  "source_external_id" text,
  "import_execution_id" uuid REFERENCES "import_executions"("id"),
  "source_row_number" integer,
  "row_fingerprint" text,
  "actor_type" text NOT NULL,
  "actor_id" text,
  "metadata" jsonb,
  "first_seen_at" timestamp NOT NULL DEFAULT now(),
  "last_seen_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "contact_source_events_contact_key_uidx"
  ON "contact_source_events" ("contact_id", "event_key");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "contact_source_events_contact_id_idx"
  ON "contact_source_events" ("contact_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "contact_source_events_import_execution_idx"
  ON "contact_source_events" ("import_execution_id");
--> statement-breakpoint

-- 3. New provenance columns on contacts (nullable — no NOT NULL until backfill verified)
ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "primary_source_category" text,
  ADD COLUMN IF NOT EXISTS "primary_source_type" text,
  ADD COLUMN IF NOT EXISTS "primary_source_event_id" integer
    REFERENCES "contact_source_events"("id")
    DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

-- 4. Backfill existing contacts to legacy_unknown
-- Leaves source_category untouched (contactability reads it and must not be disrupted)
UPDATE "contacts"
  SET
    "primary_source_category" = 'legacy_unknown',
    "primary_source_type" = 'historical_backfill'
  WHERE "primary_source_category" IS NULL;
--> statement-breakpoint

-- 5. importExecutionId on sunbiz_entities
ALTER TABLE "sunbiz_entities"
  ADD COLUMN IF NOT EXISTS "import_execution_id" uuid
    REFERENCES "import_executions"("id") ON DELETE SET NULL;
--> statement-breakpoint
