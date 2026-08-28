-- CRO-03 durable enrichment factory.
-- This migration adds only local control/evidence state.  It deliberately
-- creates no provider traffic, enables no provider, and starts no batches.

CREATE TABLE IF NOT EXISTS cro03_enrichment_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  purpose TEXT NOT NULL DEFAULT 'provider_pre_spend',
  selection_policy_version INTEGER NOT NULL DEFAULT 1,
  routing_policy_version INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'queued',
  total_count INTEGER NOT NULL DEFAULT 0,
  executable_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  cancelled_count INTEGER NOT NULL DEFAULT 0,
  selection_hash TEXT NOT NULL,
  cancel_requested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03_batches_state_chk CHECK (state IN
    ('queued','running','completed','failed','cancelled','partially_completed')),
  CONSTRAINT cro03_batches_counts_chk CHECK (
    total_count >= 0 AND executable_count >= 0 AND blocked_count >= 0
    AND completed_count >= 0 AND failed_count >= 0 AND cancelled_count >= 0
  )
);

CREATE TABLE IF NOT EXISTS cro03_batch_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES cro03_enrichment_batches(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  root_subject_type TEXT NOT NULL,
  root_subject_id INTEGER NOT NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE RESTRICT,
  business_id INTEGER REFERENCES businesses(id) ON DELETE RESTRICT,
  selection_policy_version INTEGER NOT NULL,
  dependency_fingerprint TEXT NOT NULL,
  pre_spend_snapshot_id UUID REFERENCES commercial_resolution_snapshots(id) ON DELETE RESTRICT,
  pre_spend_decision TEXT NOT NULL,
  disposition TEXT NOT NULL DEFAULT 'executable',
  disposition_reason TEXT,
  membership_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03_membership_disposition_chk CHECK (disposition IN
    ('executable','blocked','staging','superseded','deleted')),
  CONSTRAINT cro03_membership_decision_chk CHECK (pre_spend_decision IN
    ('allowed','quarantined')),
  CONSTRAINT cro03_membership_ordinal_chk CHECK (ordinal >= 0),
  CONSTRAINT cro03_membership_batch_ordinal_uidx UNIQUE (batch_id, ordinal),
  CONSTRAINT cro03_membership_subject_uidx UNIQUE (batch_id, subject_type, subject_id),
  CONSTRAINT cro03_membership_hash_uidx UNIQUE (batch_id, membership_hash)
);
CREATE INDEX IF NOT EXISTS cro03_membership_subject_idx
  ON cro03_batch_memberships(subject_type, subject_id, created_at);

CREATE TABLE IF NOT EXISTS cro03_enrichment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES cro03_enrichment_batches(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL UNIQUE REFERENCES cro03_batch_memberships(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'queued',
  current_provider TEXT,
  current_provider_run_id UUID,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  execution_fence INTEGER NOT NULL DEFAULT 0,
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  terminal_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03_items_state_chk CHECK (state IN
    ('queued','running','waiting','completed','failed','cancelled','superseded','blocked'))
);
CREATE INDEX IF NOT EXISTS cro03_items_claim_idx
  ON cro03_enrichment_items(state, next_attempt_at, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS cro03_items_batch_state_idx
  ON cro03_enrichment_items(batch_id, state);

CREATE TABLE IF NOT EXISTS cro03_provider_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES cro03_enrichment_items(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  operation_id UUID REFERENCES provider_operations(id) ON DELETE RESTRICT,
  route_policy_version INTEGER NOT NULL,
  purpose TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'planned',
  provider_outcome TEXT,
  billing_disposition TEXT NOT NULL DEFAULT 'none',
  target_fingerprint TEXT NOT NULL,
  authorization_context_hash TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT cro03_provider_runs_state_chk CHECK (state IN
    ('planned','reserved','running','completed','deferred','failed','cancelled','superseded')),
  CONSTRAINT cro03_provider_runs_billing_chk CHECK (billing_disposition IN
    ('none','outstanding','consumed','released','refunded','ambiguous')),
  CONSTRAINT cro03_provider_runs_item_provider_uidx UNIQUE (item_id, provider)
);
CREATE INDEX IF NOT EXISTS cro03_provider_runs_provider_state_idx
  ON cro03_provider_runs(provider, state, created_at);

CREATE TABLE IF NOT EXISTS cro03_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES cro03_enrichment_items(id) ON DELETE RESTRICT,
  provider_run_id UUID NOT NULL REFERENCES cro03_provider_runs(id) ON DELETE RESTRICT,
  observation_id UUID REFERENCES provider_observations(id) ON DELETE RESTRICT,
  field TEXT NOT NULL,
  normalized_value_hash TEXT NOT NULL,
  masked_value TEXT NOT NULL,
  envelope_ciphertext TEXT NOT NULL,
  envelope_nonce TEXT NOT NULL,
  envelope_tag TEXT NOT NULL,
  envelope_key_version INTEGER NOT NULL DEFAULT 1,
  subject_generation INTEGER,
  confidence INTEGER NOT NULL DEFAULT 0,
  source_rank INTEGER NOT NULL DEFAULT 100,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03_candidate_confidence_chk CHECK (confidence BETWEEN 0 AND 100),
  CONSTRAINT cro03_candidate_field_chk CHECK (field IN
    ('business_name','website','email','phone','address','city','state',
     'postal_code','category','owner_name','owner_title','registry_id',
     'entity_status','domain_registrant','classification','summary')),
  CONSTRAINT cro03_candidate_value_uidx UNIQUE
    (item_id, field, normalized_value_hash, provider_run_id)
);
CREATE INDEX IF NOT EXISTS cro03_candidates_item_field_idx
  ON cro03_candidates(item_id, field, created_at);

CREATE TABLE IF NOT EXISTS cro03_arbitration_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES cro03_enrichment_items(id) ON DELETE RESTRICT,
  field TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  winning_candidate_id UUID REFERENCES cro03_candidates(id) ON DELETE RESTRICT,
  decision_key TEXT NOT NULL UNIQUE,
  reason_code TEXT NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  CONSTRAINT cro03_arbitration_state_chk CHECK (state IN
    ('pending','winner','conflict','no_winner','superseded')),
  CONSTRAINT cro03_arbitration_field_chk CHECK (field IN
    ('business_name','website','email','phone','address','city','state',
     'postal_code','category','owner_name','owner_title','registry_id',
     'entity_status','domain_registrant','classification','summary')),
  CONSTRAINT cro03_arbitration_item_field_uidx UNIQUE (item_id, field)
);

CREATE TABLE IF NOT EXISTS cro03_mutation_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES cro03_enrichment_items(id) ON DELETE RESTRICT,
  candidate_id UUID NOT NULL REFERENCES cro03_candidates(id) ON DELETE RESTRICT,
  mutation_key TEXT NOT NULL UNIQUE,
  subject_type TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  field TEXT NOT NULL,
  expected_generation INTEGER,
  expected_value_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  disposition TEXT NOT NULL DEFAULT 'pending',
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03_mutation_state_chk CHECK (state IN
    ('pending','claimed','applied','superseded','failed')),
  CONSTRAINT cro03_mutation_disposition_chk CHECK (disposition IN
    ('pending','applied','already_applied','stale_generation','protected_field',
     'no_longer_authoritative','failed'))
);

CREATE OR REPLACE FUNCTION cro03_reject_cancelled_mutation_command()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owning_batch_id UUID;
BEGIN
  SELECT batch_id INTO owning_batch_id
    FROM cro03_enrichment_items
   WHERE id = NEW.item_id;

  PERFORM 1 FROM cro03_enrichment_batches
   WHERE id = owning_batch_id AND state IN ('queued','running')
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CRO03_MUTATION_AUTHORITY_INACTIVE';
  END IF;

  PERFORM 1 FROM cro03_enrichment_items
   WHERE id = NEW.item_id
     AND batch_id = owning_batch_id
     AND state NOT IN ('blocked','cancelled')
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CRO03_MUTATION_AUTHORITY_INACTIVE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cro03_mutation_authority_guard ON cro03_mutation_commands;
CREATE TRIGGER cro03_mutation_authority_guard
BEFORE INSERT ON cro03_mutation_commands
FOR EACH ROW EXECUTE FUNCTION cro03_reject_cancelled_mutation_command();
CREATE INDEX IF NOT EXISTS cro03_mutation_claim_idx
  ON cro03_mutation_commands(state, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS cro03_provider_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_run_id UUID NOT NULL REFERENCES cro03_provider_runs(id) ON DELETE RESTRICT,
  provider_operation_id UUID REFERENCES provider_operations(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  entry_key TEXT NOT NULL UNIQUE,
  disposition TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 0,
  amount_micros BIGINT NOT NULL DEFAULT 0,
  receipt_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03_ledger_disposition_chk CHECK (disposition IN
    ('outstanding','consumed','released','refunded','ambiguous')),
  CONSTRAINT cro03_ledger_units_chk CHECK (units >= 0),
  CONSTRAINT cro03_ledger_amount_chk CHECK (amount_micros >= 0)
);
CREATE INDEX IF NOT EXISTS cro03_provider_ledger_reconcile_idx
  ON cro03_provider_ledger(provider, provider_run_id, disposition);

CREATE TABLE IF NOT EXISTS cro03_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_run_id UUID NOT NULL REFERENCES cro03_provider_runs(id) ON DELETE RESTRICT,
  provider_operation_id UUID REFERENCES provider_operations(id) ON DELETE RESTRICT,
  receipt_key TEXT NOT NULL UNIQUE,
  provider_request_hash TEXT,
  receipt_reference TEXT,
  billing_disposition TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 0,
  amount_micros BIGINT NOT NULL DEFAULT 0,
  redacted_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03_receipt_billing_chk CHECK (billing_disposition IN
    ('consumed','released','refunded','ambiguous','outstanding')),
  CONSTRAINT cro03_receipt_units_chk CHECK (units >= 0),
  CONSTRAINT cro03_receipt_amount_chk CHECK (amount_micros >= 0)
);

CREATE OR REPLACE FUNCTION cro03_immutable_row_guard()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cro03_membership_immutable ON cro03_batch_memberships;
CREATE TRIGGER cro03_membership_immutable
  BEFORE UPDATE OR DELETE ON cro03_batch_memberships
  FOR EACH ROW EXECUTE FUNCTION cro03_immutable_row_guard();
DROP TRIGGER IF EXISTS cro03_candidate_immutable ON cro03_candidates;
CREATE TRIGGER cro03_candidate_immutable
  BEFORE UPDATE OR DELETE ON cro03_candidates
  FOR EACH ROW EXECUTE FUNCTION cro03_immutable_row_guard();
DROP TRIGGER IF EXISTS cro03_receipt_immutable ON cro03_receipts;
CREATE TRIGGER cro03_receipt_immutable
  BEFORE UPDATE OR DELETE ON cro03_receipts
  FOR EACH ROW EXECUTE FUNCTION cro03_immutable_row_guard();

-- Apollo and Outscraper controls are present but disabled and budgetless.
-- Their API adapters cannot become active from credentials alone.
INSERT INTO provider_controls
  (provider, capability, enabled, circuit_state, local_budget_units, reserved_units, consumed_units)
VALUES
  ('apollo', 'contact_enrichment', FALSE, 'closed', 0, 0, 0),
  ('outscraper', 'business_discovery', FALSE, 'closed', 0, 0, 0)
ON CONFLICT (provider) DO UPDATE SET
  enabled = FALSE,
  local_budget_units = 0,
  reserved_units = 0,
  updated_at = NOW();