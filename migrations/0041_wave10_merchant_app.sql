-- Wave 10: Merchant Application + Onboarding Conversion
-- Adds server-side draft persistence token to merchant_applications

ALTER TABLE merchant_applications
  ADD COLUMN IF NOT EXISTS draft_token_hash text;

CREATE INDEX IF NOT EXISTS merchant_applications_draft_token_hash_idx
  ON merchant_applications (draft_token_hash)
  WHERE draft_token_hash IS NOT NULL;
