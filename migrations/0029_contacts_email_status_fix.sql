-- Fix missing columns in contacts table (email_status and related fields)
-- These were defined in the schema but the migration that adds them was never
-- registered in the journal, causing 500 errors on /api/contacts and /api/dashboard/stats.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_status text DEFAULT 'active';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_bounced_at timestamp;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_decision_maker boolean DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS decision_maker_confidence integer DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS management_type text DEFAULT 'unknown';

-- Add management_type to companies
ALTER TABLE companies ADD COLUMN IF NOT EXISTS management_type text DEFAULT 'unknown';

-- Create ma_events table (also missed from the same skipped migration)
CREATE TABLE IF NOT EXISTS ma_events (
  id serial PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id integer NOT NULL,
  event_type text NOT NULL,
  counterparty_name text,
  counterparty_contact_id integer REFERENCES contacts(id),
  event_date timestamp,
  note text,
  created_by text,
  created_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ma_events_entity_idx ON ma_events(entity_type, entity_id);
