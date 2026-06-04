ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "converted_at" timestamp;

-- Backfill: for existing converted referrals, use updated_at as an approximation of when conversion happened
UPDATE "referrals"
SET "converted_at" = "updated_at"
WHERE "status" IN ('converted', 'qualified', 'paid', 'closed')
  AND "converted_at" IS NULL
  AND "updated_at" IS NOT NULL;
