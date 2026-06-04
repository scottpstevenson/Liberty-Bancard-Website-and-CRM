ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "share_token" varchar(64) UNIQUE;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "share_data" jsonb;
