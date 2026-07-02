-- 0044_statement_requests_and_ai_cache.sql
-- Adds statement_requests and contact_ai_cache tables for the Sales Prep + Statement Acquisition Command Center.
-- Idempotent: uses CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS statement_requests (
  id serial PRIMARY KEY,
  contact_id integer NOT NULL REFERENCES contacts(id),
  deal_id integer REFERENCES deals(id),
  sdr_lead_state_id integer REFERENCES sdr_lead_state(id),
  status text NOT NULL DEFAULT 'requested',
  upload_token text NOT NULL,
  upload_url text NOT NULL,
  requested_at timestamp NOT NULL,
  uploaded_at timestamp,
  reviewed_at timestamp,
  abandoned_at timestamp,
  last_reminder_task_at timestamp,
  created_by text,
  created_at timestamp NOT NULL DEFAULT NOW(),
  updated_at timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS statement_requests_upload_token_idx ON statement_requests(upload_token);
CREATE INDEX IF NOT EXISTS statement_requests_contact_id_idx ON statement_requests(contact_id);
CREATE INDEX IF NOT EXISTS statement_requests_status_idx ON statement_requests(status);

CREATE TABLE IF NOT EXISTS contact_ai_cache (
  id serial PRIMARY KEY,
  contact_id integer NOT NULL REFERENCES contacts(id),
  cache_key text NOT NULL,
  output jsonb NOT NULL,
  model text,
  generated_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS contact_ai_cache_contact_key_idx ON contact_ai_cache(contact_id, cache_key);
CREATE INDEX IF NOT EXISTS contact_ai_cache_contact_id_idx ON contact_ai_cache(contact_id);
