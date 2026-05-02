ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "category" text;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "file_size" integer;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "mime_type" text;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "uploaded_by" text;

CREATE INDEX IF NOT EXISTS "documents_contact_id_idx" ON "documents" ("contact_id");
CREATE INDEX IF NOT EXISTS "documents_category_idx" ON "documents" ("category");
