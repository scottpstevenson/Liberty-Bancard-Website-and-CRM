-- BT-08 Canonical Intake Authority: permanent execution identity, row ledger,
-- and durable local-to-provider projection work. This migration is additive.

ALTER TABLE import_executions
  ADD COLUMN IF NOT EXISTS execution_key text,
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamp,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamp,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS import_executions_execution_key_uidx
  ON import_executions (execution_key)
  WHERE execution_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS import_executions_lease_idx
  ON import_executions (status, lease_expires_at);

CREATE TABLE IF NOT EXISTS import_row_dispositions (
  id serial PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES import_executions(id) ON DELETE CASCADE,
  source_row_number integer NOT NULL,
  row_fingerprint text NOT NULL,
  disposition text NOT NULL,
  reason_code text NOT NULL,
  contact_id integer REFERENCES contacts(id) ON DELETE SET NULL,
  diagnostic jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS import_row_dispositions_execution_row_uidx
  ON import_row_dispositions (execution_id, source_row_number);
CREATE INDEX IF NOT EXISTS import_row_dispositions_execution_disposition_idx
  ON import_row_dispositions (execution_id, disposition);

CREATE TABLE IF NOT EXISTS contact_provider_projections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id integer NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'ghl',
  projection_key text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamp NOT NULL DEFAULT now(),
  claim_token uuid,
  lease_expires_at timestamp,
  terminal_reason text,
  last_error_code text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS contact_provider_projections_contact_key_uidx
  ON contact_provider_projections (contact_id, provider, projection_key);
CREATE INDEX IF NOT EXISTS contact_provider_projections_claim_idx
  ON contact_provider_projections (provider, state, next_attempt_at);

-- Serialize exact organization creation where evidence is strong.
-- Existing deployments may contain historical casing variants or duplicate
-- place IDs. Advisory-lock resolution is the forward-write serialization
-- authority, so use lookup indexes here rather than failing a forward-only
-- migration by imposing destructive uniqueness on legacy rows.
CREATE INDEX IF NOT EXISTS businesses_domain_unique_nonempty_uidx
  ON businesses (lower(website_domain))
  WHERE website_domain IS NOT NULL AND btrim(website_domain) <> '';
CREATE INDEX IF NOT EXISTS businesses_place_unique_nonempty_uidx
  ON businesses (google_place_id)
  WHERE google_place_id IS NOT NULL AND btrim(google_place_id) <> '';