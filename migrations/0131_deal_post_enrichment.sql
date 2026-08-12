ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "next_action" text;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "post_enrichment_automation_at" timestamp;
