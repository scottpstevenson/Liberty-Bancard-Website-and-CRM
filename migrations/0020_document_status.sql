ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending';
