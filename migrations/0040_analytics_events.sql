-- Wave 8: Analytics Events table
-- Stores server-side CRM milestone events for conversion attribution

CREATE TABLE IF NOT EXISTS "analytics_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "event_name" text NOT NULL,
  "event_id" text,
  "occurred_at" timestamp DEFAULT now() NOT NULL,
  "session_id" text,
  "visitor_id" text,
  "booking_tracking_id" text,
  "contact_id" integer,
  "deal_id" integer,
  "sequence_id" integer,
  "page_path" text,
  "landing_page" text,
  "utm_source" text,
  "utm_medium" text,
  "utm_campaign" text,
  "utm_content" text,
  "utm_term" text,
  "gclid_present" boolean,
  "fbclid_present" boolean,
  "msclkid_present" boolean,
  "offer_route" text,
  "vertical" text,
  "consent_tier" text,
  "lifecycle_stage" text,
  "source_category" text,
  "form_id" text,
  "channel" text,
  "block_reason" text,
  "deal_stage" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "analytics_events_event_name_idx" ON "analytics_events" ("event_name");
CREATE INDEX IF NOT EXISTS "analytics_events_occurred_at_idx" ON "analytics_events" ("occurred_at");
CREATE INDEX IF NOT EXISTS "analytics_events_contact_id_idx" ON "analytics_events" ("contact_id");
CREATE INDEX IF NOT EXISTS "analytics_events_utm_source_campaign_idx" ON "analytics_events" ("utm_source", "utm_campaign");
CREATE INDEX IF NOT EXISTS "analytics_events_page_path_idx" ON "analytics_events" ("page_path");
CREATE INDEX IF NOT EXISTS "analytics_events_booking_tracking_id_idx" ON "analytics_events" ("booking_tracking_id");
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_events_event_id_idx" ON "analytics_events" ("event_id") WHERE "event_id" IS NOT NULL;
