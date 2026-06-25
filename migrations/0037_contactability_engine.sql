-- Wave 1A: Backend Contactability Engine + Lifecycle Source of Truth
-- Adds five new columns to contacts (phoneType, consentTier, lifecycleStage, timezone, sourceCategory)
-- Adds four new columns to consent_audit_logs (disclosureVersion, disclosureText, formId, consentedPhone)

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS phone_type text,
  ADD COLUMN IF NOT EXISTS consent_tier text NOT NULL DEFAULT 'cold_no_consent',
  ADD COLUMN IF NOT EXISTS lifecycle_stage text NOT NULL DEFAULT 'prospect',
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS source_category text;

ALTER TABLE consent_audit_logs
  ADD COLUMN IF NOT EXISTS disclosure_version text,
  ADD COLUMN IF NOT EXISTS disclosure_text text,
  ADD COLUMN IF NOT EXISTS form_id text,
  ADD COLUMN IF NOT EXISTS consented_phone text;
