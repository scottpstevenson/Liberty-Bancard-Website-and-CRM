-- Stage 5 (R07): versioned recipient/obligation for the merchant conditions chase, and a durable next-check cursor.
-- Forward-only and additive. Migration 0380 cleared underwriting_conditions.created_by/updated_by (they held contact
-- ids written by the auto-initializer, never actor ids); that is not reversible here. Real actor evidence for every
-- command since then is in audit_logs (underwriting_condition_* rows) and in the string actor columns.
ALTER TABLE underwriting_condition_chases ADD COLUMN IF NOT EXISTS recipient_version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE underwriting_condition_chases ADD COLUMN IF NOT EXISTS obligation_version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE underwriting_condition_chases ADD COLUMN IF NOT EXISTS sent_recipient_version integer;
--> statement-breakpoint
ALTER TABLE underwriting_condition_chases ADD COLUMN IF NOT EXISTS sent_obligation_version integer;
--> statement-breakpoint
ALTER TABLE underwriting_condition_chases ADD COLUMN IF NOT EXISTS next_check_at timestamp;
--> statement-breakpoint
UPDATE underwriting_condition_chases
   SET sent_recipient_version = recipient_version, sent_obligation_version = obligation_version
 WHERE status = 'sent' AND sent_recipient_version IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_uw_condition_chases_owed_next
  ON underwriting_condition_chases (next_check_at, id) WHERE status = 'owed';
