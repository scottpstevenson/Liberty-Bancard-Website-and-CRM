CREATE TABLE IF NOT EXISTS "live_chats" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"visitor_name" text,
	"visitor_email" text,
	"page_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"contact_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	CONSTRAINT "live_chats_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "live_chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" integer NOT NULL,
	"sender_type" text NOT NULL,
	"sender_name" text,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_chats" ADD CONSTRAINT "live_chats_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_chat_messages" ADD CONSTRAINT "live_chat_messages_chat_id_live_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."live_chats"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "live_chats_session_id_idx" ON "live_chats" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "live_chats_status_idx" ON "live_chats" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "live_chat_messages_chat_id_idx" ON "live_chat_messages" USING btree ("chat_id");
