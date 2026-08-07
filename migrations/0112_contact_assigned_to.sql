ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "assigned_to" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_assigned_to_idx" ON "contacts" ("assigned_to");
