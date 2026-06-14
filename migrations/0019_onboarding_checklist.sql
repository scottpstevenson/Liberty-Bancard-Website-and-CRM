CREATE TABLE IF NOT EXISTS "onboarding_checklist_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "deal_id" integer NOT NULL REFERENCES "deals"("id"),
  "item_key" text NOT NULL,
  "status" text DEFAULT 'not_requested',
  "document_id" integer REFERENCES "documents"("id"),
  "notes" text,
  "updated_at" timestamp DEFAULT now(),
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "checklist_deal_id_idx" ON "onboarding_checklist_items" ("deal_id");
CREATE UNIQUE INDEX IF NOT EXISTS "checklist_deal_item_unique_idx" ON "onboarding_checklist_items" ("deal_id","item_key");
