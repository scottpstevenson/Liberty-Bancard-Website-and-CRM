CREATE TABLE IF NOT EXISTS "statement_proposals" (
  "id" serial PRIMARY KEY,
  "deal_id" integer REFERENCES "deals"("id"),
  "contact_id" integer REFERENCES "contacts"("id"),
  "status" text DEFAULT 'draft',
  "merchant_name" text,
  "source" text,
  "statement_file_name" text,
  "plans" jsonb,
  "savings_estimate" text,
  "effective_rate" text,
  "notes" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "statement_proposals_deal_id_idx" ON "statement_proposals"("deal_id");
CREATE INDEX IF NOT EXISTS "statement_proposals_contact_id_idx" ON "statement_proposals"("contact_id");
