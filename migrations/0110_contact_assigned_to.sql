ALTER TABLE "contacts" ADD COLUMN "assigned_to" text;
--> statement-breakpoint
CREATE INDEX "contacts_assigned_to_idx" ON "contacts" ("assigned_to");
