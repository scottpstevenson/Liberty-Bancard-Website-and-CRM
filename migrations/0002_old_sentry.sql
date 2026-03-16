CREATE TABLE IF NOT EXISTS "processor_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"signal_type" text NOT NULL,
	"vendor_name" text NOT NULL,
	"detection_method" text NOT NULL,
	"confidence_score" real DEFAULT 0,
	"evidence" text,
	"detected_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "processor_signals_business_id_idx" ON "processor_signals" ("business_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "processor_signals_vendor_name_idx" ON "processor_signals" ("vendor_name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ad_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"platform" text NOT NULL,
	"is_running_ads" boolean DEFAULT false,
	"confidence_score" real DEFAULT 0,
	"ad_count_estimate" integer DEFAULT 0,
	"last_seen_at" timestamp,
	"evidence" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_signals_business_id_idx" ON "ad_signals" ("business_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_signals_platform_idx" ON "ad_signals" ("platform");
--> statement-breakpoint
ALTER TABLE "sdr_lead_state" ADD COLUMN IF NOT EXISTS "processor_score" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "sdr_lead_state" ADD COLUMN IF NOT EXISTS "growth_score" integer DEFAULT 0;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "processor_signals" ADD CONSTRAINT "processor_signals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ad_signals" ADD CONSTRAINT "ad_signals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
