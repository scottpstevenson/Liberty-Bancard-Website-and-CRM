ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "processor_application_id" text;
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "mid" text;
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "boarding_status" text DEFAULT 'not_submitted';
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "boarding_log" jsonb;
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "boarding_submitted_at" timestamp;
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "boarding_approved_at" timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mid_daily_stats" (
        "id" serial PRIMARY KEY NOT NULL,
        "mid" text NOT NULL,
        "deal_id" integer,
        "contact_id" integer,
        "date" text NOT NULL,
        "volume" real DEFAULT 0,
        "tx_count" integer DEFAULT 0,
        "avg_ticket" real DEFAULT 0,
        "effective_rate" real DEFAULT 0,
        "chargeback_count" integer DEFAULT 0,
        "chargeback_amount" real DEFAULT 0,
        "refund_count" integer DEFAULT 0,
        "fetched_at" timestamp DEFAULT now(),
        "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mid_daily_stats" ADD CONSTRAINT "mid_daily_stats_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mid_daily_stats" ADD CONSTRAINT "mid_daily_stats_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mid_daily_stats_mid_idx" ON "mid_daily_stats" USING btree ("mid");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mid_daily_stats_date_idx" ON "mid_daily_stats" USING btree ("date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mid_daily_stats_deal_id_idx" ON "mid_daily_stats" USING btree ("deal_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mid_daily_stats_mid_date_unique" ON "mid_daily_stats" USING btree ("mid","date");
