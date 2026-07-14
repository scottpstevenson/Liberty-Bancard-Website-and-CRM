ALTER TABLE "registry_import_log" ADD COLUMN IF NOT EXISTS "match_confidence" integer;
ALTER TABLE "registry_import_log" ADD COLUMN IF NOT EXISTS "match_basis" jsonb;
ALTER TABLE "registry_import_log" ADD COLUMN IF NOT EXISTS "contradictions" jsonb;
ALTER TABLE "registry_import_log" ADD COLUMN IF NOT EXISTS "runner_up_merchant_id" integer REFERENCES "sdr_merchants"("id");
ALTER TABLE "registry_import_log" ADD COLUMN IF NOT EXISTS "runner_up_confidence" integer;
ALTER TABLE "registry_import_log" ADD COLUMN IF NOT EXISTS "match_algorithm_version" text;
