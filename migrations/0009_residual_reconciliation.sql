CREATE TABLE IF NOT EXISTS "residual_imports" (
        "id" serial PRIMARY KEY NOT NULL,
        "month" text NOT NULL,
        "file_name" text NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "imported_by" text,
        "total_rows" integer DEFAULT 0,
        "matched_rows" integer DEFAULT 0,
        "unmatched_rows" integer DEFAULT 0,
        "flagged_rows" integer DEFAULT 0,
        "total_gross_residual" text DEFAULT '0',
        "total_net_residual" text DEFAULT '0',
        "total_variance" text DEFAULT '0',
        "variance_threshold_pct" real DEFAULT 5,
        "variance_threshold_amt" real DEFAULT 50,
        "confirmed_at" timestamp,
        "confirmed_by" text,
        "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "residual_import_rows" (
        "id" serial PRIMARY KEY NOT NULL,
        "import_id" integer NOT NULL,
        "mid" text NOT NULL,
        "merchant_name" text,
        "volume" text DEFAULT '0',
        "gross_residual" text DEFAULT '0',
        "net_residual" text DEFAULT '0',
        "expected_residual" text DEFAULT '0',
        "variance" text DEFAULT '0',
        "variance_pct" text DEFAULT '0',
        "variance_status" text DEFAULT 'in_range',
        "is_matched" boolean DEFAULT false,
        "matched_deal_id" integer,
        "matched_profile_id" integer,
        "agent_id" integer,
        "agent_name" text,
        "raw_data" jsonb,
        "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "residual_import_rows" ADD CONSTRAINT "residual_import_rows_import_id_residual_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."residual_imports"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "residual_import_rows" ADD CONSTRAINT "residual_import_rows_matched_deal_id_deals_id_fk" FOREIGN KEY ("matched_deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "residual_import_rows" ADD CONSTRAINT "residual_import_rows_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "residual_import_rows_import_id_idx" ON "residual_import_rows" USING btree ("import_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "residual_import_rows_mid_idx" ON "residual_import_rows" USING btree ("mid");
