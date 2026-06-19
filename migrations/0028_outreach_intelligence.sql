-- Outreach Intelligence & Company Profile Feedback Loop
-- Adds email delivery status, decision maker fields, management type, and M&A events

-- 1. Contact email status tracking
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMP;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_decision_maker BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS decision_maker_confidence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS management_type TEXT NOT NULL DEFAULT 'unknown';

CREATE INDEX IF NOT EXISTS contacts_email_status_idx ON contacts(email_status);

-- 2. Companies management type
ALTER TABLE companies ADD COLUMN IF NOT EXISTS management_type TEXT NOT NULL DEFAULT 'unknown';

-- 3. M&A events table
CREATE TABLE IF NOT EXISTS ma_events (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  counterparty_name TEXT,
  counterparty_contact_id INTEGER REFERENCES contacts(id),
  event_date TIMESTAMP NOT NULL,
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ma_events_entity_idx ON ma_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS ma_events_created_at_idx ON ma_events(created_at);
