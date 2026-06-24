-- Communication Feedback Intelligence Engine
-- Add channel-level status tracking and engagement scoring fields to contacts

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sms_status text NOT NULL DEFAULT 'active';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_voicemail_at timestamp;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS reachability_score integer NOT NULL DEFAULT 100;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS call_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS do_not_auto_contact boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS contacts_sms_status_idx ON contacts(sms_status);
CREATE INDEX IF NOT EXISTS contacts_do_not_auto_contact_idx ON contacts(do_not_auto_contact);
