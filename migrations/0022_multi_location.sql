ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "is_parent_account" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "parent_contact_id" integer;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "location_name" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_parent_contact_id_idx" ON "contacts" ("parent_contact_id");
