-- Florida Mini-TCPA (SB 1120) Express Written Consent Tracking
-- Adds consentType to distinguish general_optin from express_written (PEWC)
-- FL contacts require express_written before automated call/SMS outreach

ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS consent_type text NOT NULL DEFAULT 'general_optin';

CREATE INDEX IF NOT EXISTS consent_audit_logs_consent_type_idx ON consent_audit_logs(consent_type);
CREATE INDEX IF NOT EXISTS consent_audit_logs_contact_channel_idx ON consent_audit_logs(contact_id, channel);
