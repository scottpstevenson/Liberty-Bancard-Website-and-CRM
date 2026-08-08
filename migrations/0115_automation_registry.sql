-- ---------------------------------------------------------------------------
-- Migration: 0114_automation_registry
-- Adds the automation_registry table used by the Automation Kill-Switch panel.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "automation_registry" (
  "id" serial PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "title" text,
  "trigger_description" text,
  "status" text NOT NULL DEFAULT 'active',
  "last_run_at" timestamp,
  "next_run_at" timestamp,
  "last_run_records_affected" integer,
  "last_run_errors" integer,
  "kill_switch_enabled" boolean NOT NULL DEFAULT false,
  "owner" text,
  "version" text,
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "automation_registry" ADD CONSTRAINT "automation_registry_key_unique" UNIQUE("key");
