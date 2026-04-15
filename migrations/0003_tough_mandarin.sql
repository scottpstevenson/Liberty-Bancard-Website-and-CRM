CREATE TABLE "agent_merchants" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"deal_id" integer NOT NULL,
	"merchant_name" text,
	"assigned_at" timestamp DEFAULT now(),
	CONSTRAINT "agent_merchants_deal_id_unique" UNIQUE("deal_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_merchants" ADD CONSTRAINT "agent_merchants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_merchants" ADD CONSTRAINT "agent_merchants_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_merchants_agent_id_idx" ON "agent_merchants" USING btree ("agent_id");
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "vesting_months" integer DEFAULT 3;
