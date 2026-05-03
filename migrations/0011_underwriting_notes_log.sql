ALTER TABLE "merchant_applications" ADD COLUMN IF NOT EXISTS "underwriting_notes_log" jsonb DEFAULT '[]'::jsonb;
