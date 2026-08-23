-- BT-07 privacy repair: identity evidence is HMAC-token-only. Existing
-- observations never need plaintext normalized values for matching, so redact
-- any values created during the initial migration window and enforce null.
UPDATE "contact_identity_observations"
SET "normalized_value" = NULL, "invalid_reason" = COALESCE("invalid_reason", 'redacted_token_only')
WHERE "normalized_value" IS NOT NULL;

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'contact_identity_observations'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%normalized_value%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE contact_identity_observations DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;
ALTER TABLE "contact_identity_observations"
  ADD CONSTRAINT "cio_normalized_value_redacted_check" CHECK ("normalized_value" IS NULL);