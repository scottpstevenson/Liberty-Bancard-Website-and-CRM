-- CRO-03B unified recipe, evidence, arbitration, and local projection.
-- Provider/public transport remains disabled; this migration is additive.

ALTER TABLE cro03_source_occurrences
  ADD COLUMN IF NOT EXISTS import_observed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manually_attested_at TIMESTAMPTZ;
ALTER TABLE cro03_source_occurrences
  DROP CONSTRAINT IF EXISTS cro03a_occurrence_timestamp_provenance_chk,
  ADD CONSTRAINT cro03a_occurrence_timestamp_provenance_chk
    CHECK (timestamp_provenance IN ('source','import','ingestion_only')) NOT VALID;

ALTER TABLE cro03a_qualification_runs
  ADD COLUMN IF NOT EXISTS algorithm_identity JSONB,
  ADD COLUMN IF NOT EXISTS algorithm_identity_hash TEXT;
ALTER TABLE cro03a_qualification_decisions
  ADD COLUMN IF NOT EXISTS algorithm_identity JSONB,
  ADD COLUMN IF NOT EXISTS algorithm_identity_hash TEXT;
ALTER TABLE cro03a_handoffs
  ADD COLUMN IF NOT EXISTS algorithm_identity JSONB,
  ADD COLUMN IF NOT EXISTS algorithm_identity_hash TEXT;

ALTER TABLE cro03a_qualification_runs
  DROP CONSTRAINT IF EXISTS cro03a_run_algorithm_hash_chk,
  ADD CONSTRAINT cro03a_run_algorithm_hash_chk
    CHECK (algorithm_identity_hash IS NULL OR algorithm_identity_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE cro03a_qualification_decisions
  DROP CONSTRAINT IF EXISTS cro03a_decision_algorithm_hash_chk,
  ADD CONSTRAINT cro03a_decision_algorithm_hash_chk
    CHECK (algorithm_identity_hash IS NULL OR algorithm_identity_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE cro03a_handoffs
  DROP CONSTRAINT IF EXISTS cro03a_handoff_algorithm_hash_chk,
  ADD CONSTRAINT cro03a_handoff_algorithm_hash_chk
    CHECK (algorithm_identity_hash IS NULL OR algorithm_identity_hash ~ '^[0-9a-f]{64}$');

CREATE TABLE IF NOT EXISTS cro03a_census_cursors (
  source_system TEXT PRIMARY KEY,
  snapshot_key TEXT NOT NULL,
  snapshot_high_water BIGINT NOT NULL,
  cursor_value BIGINT NOT NULL DEFAULT 0,
  policy_id UUID NOT NULL REFERENCES cro03a_policy_documents(id) ON DELETE RESTRICT,
  policy_hash TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03a_census_cursor_bounds_chk
    CHECK (snapshot_high_water >= 0 AND cursor_value >= 0 AND cursor_value <= snapshot_high_water)
);

CREATE TABLE IF NOT EXISTS cro03b_recipe_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  recipe JSONB NOT NULL,
  recipe_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03b_recipe_hash_chk CHECK (recipe_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cro03b_recipe_status_chk CHECK (status IN ('draft','active','retired')),
  CONSTRAINT cro03b_recipe_identity_uidx UNIQUE (recipe_key,version)
);

CREATE TABLE IF NOT EXISTS cro03b_recipe_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_key TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  recipe_definition_id UUID NOT NULL REFERENCES cro03b_recipe_definitions(id) ON DELETE RESTRICT,
  recipe_version INTEGER NOT NULL,
  recipe_hash TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  reason TEXT,
  state TEXT NOT NULL DEFAULT 'queued',
  total_count INTEGER NOT NULL,
  terminal_count INTEGER NOT NULL DEFAULT 0,
  cancel_requested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03b_command_state_chk CHECK (state IN ('queued','running','completed','cancelled','failed')),
  CONSTRAINT cro03b_command_cap_chk CHECK (total_count BETWEEN 1 AND 250),
  CONSTRAINT cro03b_command_hashes_chk CHECK
    (recipe_hash ~ '^[0-9a-f]{64}$' AND payload_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS cro03b_recipe_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id UUID NOT NULL REFERENCES cro03b_recipe_commands(id) ON DELETE RESTRICT,
  handoff_id UUID NOT NULL REFERENCES cro03a_handoffs(id) ON DELETE RESTRICT,
  originating_run_id UUID NOT NULL REFERENCES cro03a_qualification_runs(id) ON DELETE RESTRICT,
  owner_actor_id TEXT NOT NULL,
  recipe_version INTEGER NOT NULL,
  frozen_handoff_hash TEXT NOT NULL,
  frozen_recipe_hash TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  execution_fence INTEGER NOT NULL DEFAULT 0,
  terminal_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03b_item_state_chk CHECK
    (state IN ('queued','running','waiting','review_required','completed','failed','cancelled','superseded')),
  CONSTRAINT cro03b_item_hashes_chk CHECK
    (frozen_handoff_hash ~ '^[0-9a-f]{64}$' AND frozen_recipe_hash ~ '^[0-9a-f]{64}$' AND payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cro03b_handoff_recipe_uidx UNIQUE (handoff_id,recipe_version)
);
CREATE INDEX IF NOT EXISTS cro03b_item_claim_idx
  ON cro03b_recipe_items(state,lease_expires_at,created_at);

CREATE TABLE IF NOT EXISTS cro03b_recipe_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id UUID NOT NULL REFERENCES cro03b_recipe_commands(id) ON DELETE RESTRICT,
  item_id UUID REFERENCES cro03b_recipe_items(id) ON DELETE RESTRICT,
  handoff_id UUID NOT NULL REFERENCES cro03a_handoffs(id) ON DELETE RESTRICT,
  receipt_type TEXT NOT NULL,
  receipt_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03b_receipt_type_chk CHECK (receipt_type IN ('admission','completion')),
  CONSTRAINT cro03b_receipt_hash_chk CHECK (payload_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS cro03b_step_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES cro03b_recipe_items(id) ON DELETE RESTRICT,
  step_key TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  contract_hash TEXT NOT NULL,
  execution_owner TEXT NOT NULL,
  accounting_owner TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  operation_id UUID REFERENCES provider_operations(id) ON DELETE RESTRICT,
  evidence_expires_at TIMESTAMPTZ,
  outcome_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03b_step_identity_uidx UNIQUE (item_id,step_key),
  CONSTRAINT cro03b_step_state_chk CHECK
    (state IN ('queued','running','completed','no_result','waiting','review_required','failed','cancelled','superseded')),
  CONSTRAINT cro03b_step_hash_chk CHECK (contract_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS cro03b_domain_limits (
  registrable_domain TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  window_count INTEGER NOT NULL DEFAULT 0,
  active_count INTEGER NOT NULL DEFAULT 0,
  lease_version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03b_domain_limit_counts_chk CHECK (window_count >= 0 AND active_count >= 0)
);

ALTER TABLE cro03_arbitration_decisions
  ADD COLUMN IF NOT EXISTS policy_version INTEGER,
  ADD COLUMN IF NOT EXISTS policy_hash TEXT,
  ADD COLUMN IF NOT EXISTS candidate_set_hash TEXT,
  ADD COLUMN IF NOT EXISTS confidence_threshold INTEGER,
  ADD COLUMN IF NOT EXISTS minimum_margin INTEGER,
  ADD COLUMN IF NOT EXISTS top_confidence INTEGER,
  ADD COLUMN IF NOT EXISTS runner_up_confidence INTEGER,
  ADD COLUMN IF NOT EXISTS review_reason TEXT;

CREATE TABLE IF NOT EXISTS cro03b_projection_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES cro03b_recipe_items(id) ON DELETE RESTRICT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  business_id INTEGER REFERENCES businesses(id) ON DELETE RESTRICT,
  contact_source_event_id INTEGER REFERENCES contact_source_events(id) ON DELETE RESTRICT,
  link_decision_id UUID REFERENCES contact_business_link_decisions(id) ON DELETE RESTRICT,
  field TEXT NOT NULL,
  candidate_set_hash TEXT NOT NULL,
  before_value_hash TEXT NOT NULL,
  after_value_hash TEXT NOT NULL,
  subject_generation INTEGER,
  disposition TEXT NOT NULL,
  receipt_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03b_projection_disposition_chk
    CHECK (disposition IN ('created','applied','noop','conflict','review_required')),
  CONSTRAINT cro03b_projection_hashes_chk CHECK
    (candidate_set_hash ~ '^[0-9a-f]{64}$' AND before_value_hash ~ '^[0-9a-f]{64}$' AND after_value_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS cro03b_finalization_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL UNIQUE REFERENCES cro03b_recipe_items(id) ON DELETE RESTRICT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  validation_intent_id UUID REFERENCES validation_intents(id) ON DELETE RESTRICT,
  subject_generation INTEGER NOT NULL,
  email_token_hash TEXT,
  link_disposition TEXT NOT NULL,
  scoring_request_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'validation_pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT cro03b_finalization_state_chk
    CHECK (state IN ('validation_pending','validation_terminal','scoring_requested','completed'))
);

CREATE TABLE IF NOT EXISTS cro03b_legacy_writer_fences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES cro03b_recipe_items(id) ON DELETE RESTRICT,
  subject_type TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  writer_key TEXT NOT NULL,
  disposition TEXT NOT NULL,
  evidence_ref TEXT,
  reason_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03b_legacy_fence_disposition_chk CHECK (disposition IN ('evidence_submitted','skipped')),
  CONSTRAINT cro03b_legacy_fence_identity_uidx UNIQUE (item_id,writer_key,subject_type,subject_key)
);

CREATE OR REPLACE FUNCTION cro03b_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRO03B_APPEND_ONLY';
END;
$$;

DROP TRIGGER IF EXISTS cro03b_recipe_definitions_immutable ON cro03b_recipe_definitions;
CREATE TRIGGER cro03b_recipe_definitions_immutable BEFORE UPDATE OR DELETE ON cro03b_recipe_definitions
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
DROP TRIGGER IF EXISTS cro03b_recipe_receipts_immutable ON cro03b_recipe_receipts;
CREATE TRIGGER cro03b_recipe_receipts_immutable BEFORE UPDATE OR DELETE ON cro03b_recipe_receipts
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
DROP TRIGGER IF EXISTS cro03b_projection_receipts_immutable ON cro03b_projection_receipts;
CREATE TRIGGER cro03b_projection_receipts_immutable BEFORE UPDATE OR DELETE ON cro03b_projection_receipts
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
DROP TRIGGER IF EXISTS cro03b_legacy_writer_fences_immutable ON cro03b_legacy_writer_fences;
CREATE TRIGGER cro03b_legacy_writer_fences_immutable BEFORE UPDATE OR DELETE ON cro03b_legacy_writer_fences
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();