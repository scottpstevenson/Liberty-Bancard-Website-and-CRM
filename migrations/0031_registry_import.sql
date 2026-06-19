ALTER TABLE "sdr_merchants"
  ADD COLUMN IF NOT EXISTS "formation_date" date,
  ADD COLUMN IF NOT EXISTS "years_in_business" integer,
  ADD COLUMN IF NOT EXISTS "registry_source" text,
  ADD COLUMN IF NOT EXISTS "license_number" text;

CREATE TABLE IF NOT EXISTS "registry_import_log" (
  "id" serial PRIMARY KEY,
  "import_id" text NOT NULL,
  "source" text NOT NULL,
  "state" text NOT NULL,
  "raw_row" jsonb NOT NULL,
  "matched_merchant_id" integer REFERENCES "sdr_merchants"("id"),
  "status" text NOT NULL DEFAULT 'unmatched',
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "registry_import_log_import_id_idx" ON "registry_import_log"("import_id");
CREATE INDEX IF NOT EXISTS "registry_import_log_status_idx" ON "registry_import_log"("status");
