ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "offer_confidence" integer;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "recommended_next_action" text;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "offer_reasoning" text;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "offer_routing_source" text;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "processor_detected" text;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "offer_routed_at" timestamp;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "offer_matched_signals" jsonb;
