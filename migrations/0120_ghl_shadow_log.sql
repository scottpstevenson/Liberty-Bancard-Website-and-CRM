-- Migration: 0120_ghl_shadow_log
-- Captures what GHL inbound sync WOULD have written to Liberty when
-- GHL_CRM_SYNC_MODE='shadow'. Allows admins to review drift before
-- disabling CRM write-back entirely.

CREATE TABLE IF NOT EXISTS "ghl_shadow_log" (
  "id"            SERIAL PRIMARY KEY,
  "entity_type"   TEXT NOT NULL,           -- 'contact' | 'deal' | 'task' | 'company' | 'tags'
  "entity_id"     INTEGER,                 -- Liberty entity id if resolvable
  "sync_function" TEXT NOT NULL,           -- e.g. 'syncContactFromGhl'
  "ghl_id"        TEXT,                    -- GHL object id
  "field"         TEXT,                    -- specific field that would have changed (NULL = full-payload log)
  "current_value" JSONB,                   -- what Liberty currently has
  "ghl_value"     JSONB,                   -- what GHL was trying to write
  "would_have_written" BOOLEAN NOT NULL DEFAULT TRUE,
  "reviewed_at"   TIMESTAMP,              -- admin marks reviewed
  "reviewed_by"   TEXT,
  "metadata"      JSONB,
  "created_at"    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "ghl_shadow_log_entity_type_entity_id_idx"
  ON "ghl_shadow_log" ("entity_type", "entity_id");

CREATE INDEX IF NOT EXISTS "ghl_shadow_log_sync_function_idx"
  ON "ghl_shadow_log" ("sync_function");

CREATE INDEX IF NOT EXISTS "ghl_shadow_log_created_at_idx"
  ON "ghl_shadow_log" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "ghl_shadow_log_reviewed_at_idx"
  ON "ghl_shadow_log" ("reviewed_at")
  WHERE "reviewed_at" IS NULL;
