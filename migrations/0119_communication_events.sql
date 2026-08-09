-- Migration: 0119_communication_events
-- Creates the canonical communication_events table — a single normalized record
-- for every inbound and outbound communication across all channels.
-- This is an ADDITIVE migration: existing tables (ghl_activity_logs, outbound_messages,
-- call_logs, etc.) are not removed. Future reads should prefer communication_events.

CREATE TABLE IF NOT EXISTS "communication_events" (
  "id"                    SERIAL PRIMARY KEY,
  "contact_id"            INTEGER REFERENCES "contacts"("id") ON DELETE CASCADE,
  "deal_id"               INTEGER REFERENCES "deals"("id") ON DELETE SET NULL,
  "direction"             TEXT NOT NULL CHECK ("direction" IN ('inbound', 'outbound')),
  "channel"               TEXT NOT NULL CHECK ("channel" IN ('email', 'sms', 'call', 'voicemail', 'chat', 'form', 'portal', 'rvm')),
  "provider"              TEXT CHECK ("provider" IN ('ghl', 'smtp', 'twilio', 'internal', 'manual')),
  "subject"               TEXT,
  "body"                  TEXT,
  "status"                TEXT NOT NULL DEFAULT 'sent'
                            CHECK ("status" IN ('sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed', 'received', 'skipped')),
  "intent_classification" TEXT,
  "intent_confidence"     NUMERIC(5, 4),
  "automation_stopped"    BOOLEAN NOT NULL DEFAULT FALSE,
  "automation_stop_reason" TEXT,
  "sent_by"               TEXT NOT NULL DEFAULT 'automation'
                            CHECK ("sent_by" IN ('automation', 'human', 'system')),
  "sequence_id"           INTEGER REFERENCES "follow_up_sequences"("id") ON DELETE SET NULL,
  "sequence_step_id"      INTEGER REFERENCES "sequence_steps"("id") ON DELETE SET NULL,
  "external_message_id"   TEXT,
  "ghl_message_id"        TEXT,
  "metadata"              JSONB,
  "created_at"            TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at"            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "comm_events_contact_id_created_at_idx"
  ON "communication_events" ("contact_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "comm_events_deal_id_created_at_idx"
  ON "communication_events" ("deal_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "comm_events_direction_channel_idx"
  ON "communication_events" ("direction", "channel");

CREATE INDEX IF NOT EXISTS "comm_events_contact_id_direction_idx"
  ON "communication_events" ("contact_id", "direction");

CREATE INDEX IF NOT EXISTS "comm_events_status_idx"
  ON "communication_events" ("status");
