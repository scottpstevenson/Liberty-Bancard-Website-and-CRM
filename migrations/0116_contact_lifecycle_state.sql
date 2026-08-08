-- Migration 0116: Contact Lifecycle State Machine
-- Adds lifecycle_state to contacts and creates transition history table

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'PROSPECT';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lifecycle_state_updated_at timestamptz;
CREATE INDEX IF NOT EXISTS contacts_lifecycle_state_idx ON contacts (lifecycle_state);

CREATE TABLE IF NOT EXISTS contact_lifecycle_history (
  id serial PRIMARY KEY,
  contact_id integer NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  from_state text,
  to_state text NOT NULL,
  transitioned_at timestamptz NOT NULL DEFAULT now(),
  trigger text,
  actor_type text,
  actor_id text,
  source text,
  reason text,
  automation_key text,
  metadata jsonb
);
CREATE INDEX IF NOT EXISTS contact_lifecycle_history_contact_idx ON contact_lifecycle_history (contact_id, transitioned_at DESC);
