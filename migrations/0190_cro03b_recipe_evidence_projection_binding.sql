ALTER TABLE cro03b_recipe_items
  ADD COLUMN IF NOT EXISTS contact_id INTEGER REFERENCES contacts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES businesses(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT REFERENCES users(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS cro03b_evidence_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES cro03b_recipe_items(id) ON DELETE RESTRICT,
  step_key TEXT NOT NULL,
  source_observation_id UUID REFERENCES cro03_source_observations(id) ON DELETE RESTRICT,
  operation_id UUID REFERENCES provider_operations(id) ON DELETE RESTRICT,
  evidence_hash TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  outcome TEXT NOT NULL,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03b_evidence_hash_chk CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cro03b_evidence_outcome_chk CHECK
    (outcome IN ('success','no_result','disabled','failed','conflict')),
  CONSTRAINT cro03b_evidence_identity_uidx UNIQUE (item_id,step_key,evidence_hash)
);

CREATE TABLE IF NOT EXISTS cro03b_field_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES cro03b_recipe_items(id) ON DELETE RESTRICT,
  observation_id UUID NOT NULL REFERENCES cro03b_evidence_observations(id) ON DELETE RESTRICT,
  field TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  display_value TEXT NOT NULL,
  value_hash TEXT NOT NULL,
  authority_rank INTEGER NOT NULL,
  confidence INTEGER NOT NULL,
  protected_manual BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03b_candidate_hash_chk CHECK (value_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cro03b_candidate_score_chk CHECK
    (authority_rank BETWEEN 0 AND 1000 AND confidence BETWEEN 0 AND 100),
  CONSTRAINT cro03b_candidate_identity_uidx UNIQUE (item_id,observation_id,field,value_hash)
);

CREATE TABLE IF NOT EXISTS cro03b_field_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES cro03b_recipe_items(id) ON DELETE RESTRICT,
  field TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  policy_hash TEXT NOT NULL,
  candidate_set_hash TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  minimum_margin INTEGER NOT NULL,
  winner_candidate_id UUID REFERENCES cro03b_field_candidates(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  top_confidence INTEGER,
  runner_up_confidence INTEGER,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03b_decision_hashes_chk CHECK
    (policy_hash ~ '^[0-9a-f]{64}$' AND candidate_set_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cro03b_decision_outcome_chk CHECK (outcome IN ('winner','no_winner','review_required')),
  CONSTRAINT cro03b_field_decision_uidx UNIQUE (item_id,field)
);

CREATE TABLE IF NOT EXISTS cro03b_terminal_hook_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL UNIQUE REFERENCES cro03b_recipe_items(id) ON DELETE RESTRICT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  subject_generation INTEGER NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending',
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03b_terminal_hook_state_chk CHECK (state IN ('pending','claimed','completed'))
);

DROP TRIGGER IF EXISTS cro03b_evidence_observations_immutable ON cro03b_evidence_observations;
CREATE TRIGGER cro03b_evidence_observations_immutable BEFORE UPDATE OR DELETE ON cro03b_evidence_observations
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
DROP TRIGGER IF EXISTS cro03b_field_candidates_immutable ON cro03b_field_candidates;
CREATE TRIGGER cro03b_field_candidates_immutable BEFORE UPDATE OR DELETE ON cro03b_field_candidates
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
DROP TRIGGER IF EXISTS cro03b_field_decisions_immutable ON cro03b_field_decisions;
CREATE TRIGGER cro03b_field_decisions_immutable BEFORE UPDATE OR DELETE ON cro03b_field_decisions
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();