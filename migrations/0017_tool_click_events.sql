CREATE TABLE IF NOT EXISTS "tool_click_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tool_id" text NOT NULL,
	"tool_title" text,
	"source" text DEFAULT 'sales-tools-hub',
	"user_id" text,
	"session_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_click_events_tool_id_idx" ON "tool_click_events" USING btree ("tool_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_click_events_created_at_idx" ON "tool_click_events" USING btree ("created_at");
