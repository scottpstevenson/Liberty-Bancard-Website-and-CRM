-- Task #792: Global Kill Switch & Daily Send Caps
-- Creates the outbound_send_counters table for durable, atomic daily send counting.
-- Unique constraint on (date, channel, scope) enables atomic INSERT ... ON CONFLICT DO UPDATE.

CREATE TABLE IF NOT EXISTS "outbound_send_counters" (
  "id" serial PRIMARY KEY NOT NULL,
  "date" date NOT NULL,
  "channel" text NOT NULL,
  "scope" text NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outbound_send_counters_date_channel_scope_uidx'
  ) THEN
    ALTER TABLE "outbound_send_counters"
      ADD CONSTRAINT "outbound_send_counters_date_channel_scope_uidx"
      UNIQUE ("date", "channel", "scope");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "outbound_send_counters_date_idx" ON "outbound_send_counters" ("date");
