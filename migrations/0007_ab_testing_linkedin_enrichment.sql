ALTER TABLE "sequence_steps" ADD COLUMN IF NOT EXISTS "variant_b_subject" text;
--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD COLUMN IF NOT EXISTS "variant_b_body" text;
--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD COLUMN IF NOT EXISTS "ab_test_config" jsonb;
--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD COLUMN IF NOT EXISTS "ab_test_results" jsonb;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "linkedin_enriched_at" timestamp;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "linkedin_enrichment_log" jsonb;
