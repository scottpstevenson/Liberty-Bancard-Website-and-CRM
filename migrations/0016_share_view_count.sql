ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "share_view_count" integer DEFAULT 0;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "share_last_viewed_at" timestamp;
