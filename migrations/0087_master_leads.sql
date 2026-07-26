-- Master Lead Database — staged import pipeline
-- Rows land here first (status=staged) before any CRM enrollment/outbound.

CREATE TABLE IF NOT EXISTS "master_lead_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_name" text NOT NULL,
  "sheet_id" text,
  "sheet_name" text,
  "tab_name" text,
  "source_method" text NOT NULL DEFAULT 'csv_upload',
  "total_rows" integer DEFAULT 0,
  "staged_count" integer DEFAULT 0,
  "duplicate_count" integer DEFAULT 0,
  "suppressed_count" integer DEFAULT 0,
  "invalid_count" integer DEFAULT 0,
  "status" text NOT NULL DEFAULT 'processing',
  "error_message" text,
  "imported_by" text,
  "imported_at" timestamp DEFAULT now(),
  "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "master_leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_batch_id" uuid REFERENCES "master_lead_batches"("id"),
  "status" text NOT NULL DEFAULT 'staged',
  "company" text,
  "normalized_company" text,
  "domain" text,
  "email" text,
  "email_type" text,
  "phone" text,
  "normalized_phone" text,
  "contact_name" text,
  "contact_title" text,
  "vertical" text,
  "quality_score" real,
  "fit_tier" text,
  "outreach_readiness" text,
  "readiness_reason" text,
  "source" text,
  "source_path" text,
  "source_modified_date" text,
  "sheet_id" text,
  "sheet_name" text,
  "tab_name" text,
  "row_number" integer,
  "canonical_lead_id" uuid,
  "duplicate_of_id" uuid REFERENCES "master_leads"("id"),
  "suppression_reason" text,
  "imported_at" timestamp DEFAULT now(),
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "master_leads_batch_id_idx" ON "master_leads" ("import_batch_id");
CREATE INDEX IF NOT EXISTS "master_leads_domain_idx" ON "master_leads" ("domain");
CREATE INDEX IF NOT EXISTS "master_leads_email_idx" ON "master_leads" ("email");
CREATE INDEX IF NOT EXISTS "master_leads_status_idx" ON "master_leads" ("status");
