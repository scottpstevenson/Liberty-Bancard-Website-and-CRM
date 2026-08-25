-- BT-10 provider health and readiness control plane.
-- This migration is intentionally local-only: it records durable control,
-- operation, evidence, eligibility, and queue ownership state. It performs no
-- provider I/O and does not fabricate historical validation evidence.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email_mutation_generation INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS email_validation_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS provider_controls (
  provider TEXT PRIMARY KEY,
  capability TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  circuit_state TEXT NOT NULL DEFAULT 'closed',
  local_budget_units INTEGER,
  reserved_units INTEGER NOT NULL DEFAULT 0,
  consumed_units INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ,
  window_ends_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  last_outcome TEXT,
  last_error_code TEXT,
  observed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT provider_controls_circuit_state_chk
    CHECK (circuit_state IN ('closed', 'open', 'half_open', 'unavailable')),
  CONSTRAINT provider_controls_budget_chk
    CHECK (local_budget_units IS NULL OR local_budget_units >= 0),
  CONSTRAINT provider_controls_units_chk
    CHECK (reserved_units >= 0 AND consumed_units >= 0)
);

CREATE TABLE IF NOT EXISTS provider_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL REFERENCES provider_controls(provider),
  operation_type TEXT NOT NULL,
  purpose TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  target_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  requested_units INTEGER NOT NULL DEFAULT 0,
  reserved_units INTEGER NOT NULL DEFAULT 0,
  billing_state TEXT NOT NULL DEFAULT 'none',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  cancel_requested_at TIMESTAMPTZ,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT provider_operations_state_chk
    CHECK (state IN ('pending', 'deferred', 'running', 'completed', 'failed', 'cancelled', 'superseded')),
  CONSTRAINT provider_operations_billing_state_chk
    CHECK (billing_state IN ('none', 'reserved', 'committed', 'released', 'ambiguous')),
  CONSTRAINT provider_operations_units_chk
    CHECK (requested_units >= 0 AND reserved_units >= 0),
  CONSTRAINT provider_operations_idempotency_uidx UNIQUE (provider, idempotency_key)
);
CREATE INDEX IF NOT EXISTS provider_operations_claim_idx
  ON provider_operations(provider, state, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS provider_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES provider_operations(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'pending',
  retryable BOOLEAN NOT NULL DEFAULT FALSE,
  safe_http_class TEXT,
  request_id TEXT,
  error_code TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT provider_attempts_outcome_chk
    CHECK (outcome IN ('pending', 'completed', 'no_result', 'blocked', 'retryable_failed', 'failed', 'ambiguous')),
  CONSTRAINT provider_attempts_operation_number_uidx UNIQUE (operation_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS provider_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL REFERENCES provider_controls(provider),
  operation_id UUID REFERENCES provider_operations(id) ON DELETE SET NULL,
  attempt_id UUID REFERENCES provider_attempts(id) ON DELETE SET NULL,
  subject_type TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  email_token_hash TEXT,
  subject_generation INTEGER,
  outcome TEXT NOT NULL,
  safe_http_class TEXT,
  request_id TEXT,
  evidence_hash TEXT,
  retryable BOOLEAN NOT NULL DEFAULT FALSE,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  CONSTRAINT provider_observations_outcome_chk
    CHECK (outcome IN ('valid', 'invalid', 'risky', 'unknown', 'not_configured', 'budget_blocked',
                       'circuit_blocked', 'rate_limited', 'rejected', 'timeout', 'transport',
                       'parse_error', 'ambiguous_billing', 'no_result', 'superseded'))
);
CREATE INDEX IF NOT EXISTS provider_observations_subject_idx
  ON provider_observations(subject_type, subject_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS provider_observations_email_evidence_idx
  ON provider_observations(subject_id, email_token_hash, subject_generation, observed_at DESC);

CREATE TABLE IF NOT EXISTS field_arbitration_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id UUID REFERENCES provider_observations(id) ON DELETE SET NULL,
  subject_type TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  subject_generation INTEGER,
  decision TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT field_arbitration_decisions_decision_chk
    CHECK (decision IN ('accepted', 'rejected', 'deferred', 'manual_authority'))
);

CREATE TABLE IF NOT EXISTS validation_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  normalized_email_token_hash TEXT NOT NULL,
  subject_generation INTEGER NOT NULL,
  policy_version INTEGER NOT NULL DEFAULT 1,
  purpose TEXT NOT NULL DEFAULT 'marketing_outreach',
  state TEXT NOT NULL DEFAULT 'pending',
  enqueue_state TEXT NOT NULL DEFAULT 'deferred',
  operation_id UUID REFERENCES provider_operations(id) ON DELETE SET NULL,
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  terminal_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT validation_intents_state_chk
    CHECK (state IN ('pending', 'processing', 'completed', 'blocked', 'superseded', 'cancelled')),
  CONSTRAINT validation_intents_enqueue_state_chk
    CHECK (enqueue_state IN ('deferred', 'enqueued', 'unavailable')),
  CONSTRAINT validation_intents_generation_chk CHECK (subject_generation > 0),
  CONSTRAINT validation_intents_current_generation_uidx
    UNIQUE (contact_id, normalized_email_token_hash, subject_generation, purpose)
);
CREATE INDEX IF NOT EXISTS validation_intents_claim_idx
  ON validation_intents(state, next_attempt_at, lease_expires_at);

CREATE TABLE IF NOT EXISTS eligibility_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  subject_generation INTEGER NOT NULL,
  decision TEXT NOT NULL,
  reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  CONSTRAINT eligibility_snapshots_decision_chk
    CHECK (decision IN ('eligible', 'blocked', 'deferred', 'unavailable'))
);
CREATE INDEX IF NOT EXISTS eligibility_snapshots_contact_purpose_idx
  ON eligibility_snapshots(contact_id, purpose, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS campaign_preview_members (
  preview_id INTEGER NOT NULL REFERENCES campaign_previews(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  subject_generation INTEGER NOT NULL,
  subject_mutation_at TIMESTAMPTZ,
  normalized_email_token_hash TEXT NOT NULL,
  eligibility_decision TEXT NOT NULL,
  reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  taxonomy_version TEXT,
  prerequisite_version INTEGER NOT NULL DEFAULT 1,
  readiness_model_version INTEGER,
  contactability_snapshot_ref UUID REFERENCES eligibility_snapshots(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (preview_id, contact_id),
  CONSTRAINT campaign_preview_members_decision_chk
    CHECK (eligibility_decision IN ('eligible', 'blocked', 'deferred', 'unavailable'))
);
CREATE INDEX IF NOT EXISTS campaign_preview_members_eligible_idx
  ON campaign_preview_members(preview_id, contact_id)
  WHERE eligibility_decision = 'eligible';

CREATE TABLE IF NOT EXISTS campaign_queue_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  preview_id INTEGER NOT NULL REFERENCES campaign_previews(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  actor_id TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  cursor_contact_id INTEGER,
  queued_count INTEGER NOT NULL DEFAULT 0,
  excluded_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  failure_code TEXT,
  CONSTRAINT campaign_queue_runs_state_chk
    CHECK (state IN ('pending', 'deferred', 'running', 'completed', 'failed', 'cancelled')),
  CONSTRAINT campaign_queue_runs_preview_uidx UNIQUE (preview_id),
  CONSTRAINT campaign_queue_runs_idempotency_uidx UNIQUE (campaign_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS campaign_queue_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_run_id UUID NOT NULL REFERENCES campaign_queue_runs(id) ON DELETE CASCADE,
  preview_id INTEGER NOT NULL,
  contact_id INTEGER NOT NULL,
  step_id INTEGER REFERENCES campaign_steps(id) ON DELETE SET NULL,
  disposition TEXT NOT NULL DEFAULT 'pending',
  reason_code TEXT,
  outbound_message_id INTEGER REFERENCES outbound_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT campaign_queue_items_disposition_chk
    CHECK (disposition IN ('pending', 'queued', 'excluded', 'failed', 'superseded')),
  CONSTRAINT campaign_queue_items_preview_member_fk
    FOREIGN KEY (preview_id, contact_id) REFERENCES campaign_preview_members(preview_id, contact_id),
  CONSTRAINT campaign_queue_items_member_uidx UNIQUE (queue_run_id, contact_id, step_id)
);
CREATE INDEX IF NOT EXISTS campaign_queue_items_run_disposition_idx
  ON campaign_queue_items(queue_run_id, disposition, contact_id);

CREATE TABLE IF NOT EXISTS provider_run_dispositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES provider_operations(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  disposition TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT provider_run_dispositions_state_chk
    CHECK (disposition IN ('pending', 'completed', 'skipped', 'deferred', 'retryable_failed', 'failed', 'superseded')),
  CONSTRAINT provider_run_dispositions_subject_uidx UNIQUE (operation_id, subject_type, subject_id)
);

CREATE OR REPLACE FUNCTION prevent_provider_observation_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'provider_observations is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS provider_observations_append_only ON provider_observations;
CREATE TRIGGER provider_observations_append_only
  BEFORE UPDATE OR DELETE ON provider_observations
  FOR EACH ROW EXECUTE FUNCTION prevent_provider_observation_mutation();