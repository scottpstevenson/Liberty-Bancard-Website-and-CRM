-- Migration: inbox_items + statement_reviews
-- Adds ownership/routing table for AI inbox items and statement review workflow table.

CREATE TABLE IF NOT EXISTS "inbox_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "source_item_id" text NOT NULL,
  "source_item_type" text NOT NULL DEFAULT 'email',
  "contact_id" integer REFERENCES "contacts"("id"),
  "deal_id" integer REFERENCES "deals"("id"),
  "owner_id" text,
  "owner_name" text,
  "department" text DEFAULT 'sales',
  "status" text DEFAULT 'new',
  "priority" text DEFAULT 'normal',
  "sla_due_at" timestamp,
  "next_action" text,
  "escalation_path" text,
  "notes" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "inbox_items_source_item_id_uidx" ON "inbox_items" ("source_item_id");
CREATE INDEX IF NOT EXISTS "inbox_items_status_idx" ON "inbox_items" ("status");
CREATE INDEX IF NOT EXISTS "inbox_items_contact_id_idx" ON "inbox_items" ("contact_id");
CREATE INDEX IF NOT EXISTS "inbox_items_sla_due_at_idx" ON "inbox_items" ("sla_due_at");

CREATE TABLE IF NOT EXISTS "statement_reviews" (
  "id" serial PRIMARY KEY NOT NULL,
  "document_id" integer REFERENCES "documents"("id"),
  "contact_id" integer REFERENCES "contacts"("id"),
  "deal_id" integer REFERENCES "deals"("id"),
  "status" text DEFAULT 'received',
  "analyst_id" text,
  "analyst_name" text,
  "ai_summary" jsonb,
  "analyst_notes" text,
  "savings_estimate_override" text,
  "follow_up_draft" text,
  "follow_up_sent_at" timestamp,
  "reviewed_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "statement_reviews_contact_id_idx" ON "statement_reviews" ("contact_id");
CREATE INDEX IF NOT EXISTS "statement_reviews_status_idx" ON "statement_reviews" ("status");
CREATE INDEX IF NOT EXISTS "statement_reviews_document_id_idx" ON "statement_reviews" ("document_id");
