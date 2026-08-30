-- CRO-03C owns its initial continuation journal.  It deliberately has no
-- foreign keys to, or identifiers from, the retired CRO-03B item pipeline.
CREATE TABLE cro03c_initial_subjects (
  generation_id UUID PRIMARY KEY REFERENCES cro03c_generations(id) ON DELETE RESTRICT,
  command_id UUID NOT NULL REFERENCES cro03c_commands(id) ON DELETE RESTRICT,
  run_id UUID NOT NULL REFERENCES cro03c_runs(id) ON DELETE RESTRICT,
  handoff_id UUID NOT NULL REFERENCES cro03a_handoffs(id) ON DELETE RESTRICT,
  frozen_handoff_hash TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_key_hash TEXT NOT NULL,
  source_payload_hash TEXT NOT NULL,
  lineage_state JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  contact_id INTEGER REFERENCES contacts(id) ON DELETE RESTRICT,
  business_id INTEGER REFERENCES businesses(id) ON DELETE RESTRICT,
  contact_source_event_id INTEGER REFERENCES contact_source_events(id) ON DELETE RESTRICT,
  link_decision_id UUID REFERENCES contact_business_link_decisions(id) ON DELETE RESTRICT,
  terminal_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (command_id, handoff_id),
  CONSTRAINT cro03c_initial_subject_hash_chk CHECK (
    frozen_handoff_hash ~ '^[0-9a-f]{64}$' AND source_key_hash ~ '^[0-9a-f]{64}$'
    AND source_payload_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT cro03c_initial_subject_state_chk CHECK (
    state IN ('pending','projecting','validation_pending','hooks_pending','completed','review_required')
  )
);

CREATE TABLE cro03c_projection_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID NOT NULL REFERENCES cro03c_initial_subjects(generation_id) ON DELETE RESTRICT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  contact_source_event_id INTEGER NOT NULL REFERENCES contact_source_events(id) ON DELETE RESTRICT,
  link_decision_id UUID NOT NULL REFERENCES contact_business_link_decisions(id) ON DELETE RESTRICT,
  field TEXT NOT NULL,
  candidate_set_hash TEXT NOT NULL,
  before_value_hash TEXT NOT NULL,
  after_value_hash TEXT NOT NULL,
  subject_generation INTEGER NOT NULL,
  disposition TEXT NOT NULL,
  receipt_key TEXT NOT NULL UNIQUE,
  claim_token UUID NOT NULL,
  execution_fence INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (generation_id, field),
  CONSTRAINT cro03c_projection_hash_chk CHECK (
    candidate_set_hash ~ '^[0-9a-f]{64}$' AND before_value_hash ~ '^[0-9a-f]{64}$'
    AND after_value_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT cro03c_projection_disposition_chk CHECK (disposition IN ('applied','noop'))
);

CREATE TABLE cro03c_finalization_receipts (
  generation_id UUID PRIMARY KEY REFERENCES cro03c_initial_subjects(generation_id) ON DELETE RESTRICT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  validation_intent_id UUID REFERENCES validation_intents(id) ON DELETE RESTRICT,
  subject_generation INTEGER NOT NULL,
  email_token_hash TEXT NOT NULL,
  link_disposition TEXT NOT NULL DEFAULT 'verified',
  scoring_request_key TEXT NOT NULL UNIQUE,
  authorization_expires_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'validation_pending',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03c_finalization_state_chk CHECK (
    state IN ('validation_pending','validation_terminal','hooks_pending','completed')
  )
);

-- This is both the durable terminal-hook request and its outbox.  Per-effect
-- completion columns make retries explicit while the generation key coalesces
-- readiness and scoring to one request.
CREATE TABLE cro03c_terminal_hooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID NOT NULL UNIQUE REFERENCES cro03c_initial_subjects(generation_id) ON DELETE RESTRICT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  subject_generation INTEGER NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending',
  readiness_enqueued_at TIMESTAMPTZ,
  scoring_enqueued_at TIMESTAMPTZ,
  claim_token UUID,
  execution_fence INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03c_terminal_hook_state_chk CHECK (state IN ('pending','claimed','completed'))
);

CREATE INDEX cro03c_terminal_hooks_claim_idx
  ON cro03c_terminal_hooks(state, lease_expires_at, created_at);

CREATE TRIGGER cro03c_initial_subject_lineage_immutable
  BEFORE UPDATE OF command_id,run_id,handoff_id,frozen_handoff_hash,source_type,source_system,
    source_key_hash,source_payload_hash,lineage_state OR DELETE ON cro03c_initial_subjects
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
CREATE TRIGGER cro03c_projection_receipt_immutable
  BEFORE UPDATE OR DELETE ON cro03c_projection_receipts
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();