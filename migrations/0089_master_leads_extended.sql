-- Extend master_leads with lifecycle pipeline statuses, channel-status flags, address fields,
-- and promotion tracking. Status values (text field, not enum):
--   staged | imported | duplicate | suppressed | needs_website_check | needs_mx_verification
--   | ready_for_internal_test | ready_for_controlled_cohort | enrolled | paused
--   | bounced | unsubscribed | client_customer

ALTER TABLE "master_leads"
  ADD COLUMN IF NOT EXISTS "email_valid" boolean,
  ADD COLUMN IF NOT EXISTS "phone_valid" boolean,
  ADD COLUMN IF NOT EXISTS "sms_eligible" boolean,
  ADD COLUMN IF NOT EXISTS "state" text,
  ADD COLUMN IF NOT EXISTS "city" text,
  ADD COLUMN IF NOT EXISTS "address" text,
  ADD COLUMN IF NOT EXISTS "website" text,
  ADD COLUMN IF NOT EXISTS "promoted_at" timestamp,
  ADD COLUMN IF NOT EXISTS "promoted_by" text,
  ADD COLUMN IF NOT EXISTS "notes" text;

ALTER TABLE "master_lead_batches"
  ADD COLUMN IF NOT EXISTS "promoted_count" integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "ready_count" integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS "master_leads_status_source_idx" ON "master_leads" ("status", "source");
CREATE INDEX IF NOT EXISTS "master_leads_vertical_idx" ON "master_leads" ("vertical");
CREATE INDEX IF NOT EXISTS "master_leads_fit_tier_idx" ON "master_leads" ("fit_tier");
CREATE INDEX IF NOT EXISTS "master_leads_promoted_at_idx" ON "master_leads" ("promoted_at");
