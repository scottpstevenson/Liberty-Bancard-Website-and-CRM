ALTER TABLE "contact_identity_observations"
  ADD COLUMN IF NOT EXISTS "superseded_at" timestamptz;
DROP INDEX IF EXISTS "cio_observation_dedupe_uidx";
CREATE UNIQUE INDEX IF NOT EXISTS "cio_current_observation_dedupe_uidx"
  ON "contact_identity_observations" ("contact_id", "identity_kind", "lookup_token", "normalization_version", "source_type")
  WHERE "superseded_at" IS NULL;
DROP INDEX IF EXISTS "cio_eligible_idx";
CREATE INDEX IF NOT EXISTS "cio_eligible_idx"
  ON "contact_identity_observations" ("identity_kind", "eligibility")
  WHERE "eligibility" = 'eligible' AND "superseded_at" IS NULL;