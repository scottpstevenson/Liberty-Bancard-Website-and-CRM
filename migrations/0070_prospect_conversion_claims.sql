ALTER TABLE "prospects"
  ADD COLUMN IF NOT EXISTS "conversion_claim_id" text,
  ADD COLUMN IF NOT EXISTS "conversion_claimed_at" timestamp,
  ADD COLUMN IF NOT EXISTS "conversion_claim_owner_id" text,
  ADD COLUMN IF NOT EXISTS "conversion_contact_id" integer REFERENCES "contacts"("id"),
  ADD COLUMN IF NOT EXISTS "conversion_last_error" text;

CREATE INDEX IF NOT EXISTS "prospects_conversion_claim_idx"
  ON "prospects" ("conversion_claim_id")
  WHERE "conversion_claim_id" IS NOT NULL;
