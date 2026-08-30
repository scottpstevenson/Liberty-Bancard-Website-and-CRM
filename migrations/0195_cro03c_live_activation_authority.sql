-- CRO-03C live activation authority.
-- Additive only: CRO-03B records and migration history are not reopened or changed.

CREATE TABLE IF NOT EXISTS cro03c_activation_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  policy_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  policy JSONB NOT NULL,
  policy_hash TEXT NOT NULL,
  price_schedules JSONB NOT NULL DEFAULT '{}'::jsonb,
  required_approvals JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  expected_revision INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (policy_key, version),
  CONSTRAINT cro03c_activation_policy_hash_chk CHECK (policy_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cro03c_activation_policy_status_chk CHECK (status IN ('draft','approved','retired')),
  CONSTRAINT cro03c_activation_policy_revision_chk CHECK (expected_revision >= 0)
);

CREATE TABLE IF NOT EXISTS cro03c_runtime_attestations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  artifact_sha TEXT NOT NULL,
  migration_head TEXT NOT NULL,
  deployment_identity TEXT NOT NULL,
  environment_identity TEXT NOT NULL,
  web_boot_identity TEXT NOT NULL,
  worker_boot_identity TEXT NOT NULL,
  queue_topology_hash TEXT NOT NULL,
  worker_heartbeat_at TIMESTAMPTZ NOT NULL,
  db_healthy BOOLEAN NOT NULL,
  redis_healthy BOOLEAN NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  attestation_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE (attestation_hash),
  CONSTRAINT cro03c_runtime_sha_chk CHECK (artifact_sha ~ '^[0-9a-f]{40}$'),
  CONSTRAINT cro03c_runtime_hash_chk CHECK (attestation_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cro03c_runtime_expiry_chk CHECK (expires_at > captured_at)
);

CREATE TABLE IF NOT EXISTS cro03c_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_key TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  command_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  activation_policy_id UUID NOT NULL REFERENCES cro03c_activation_policies(id) ON DELETE RESTRICT,
  activation_revision INTEGER NOT NULL,
  recipe_version INTEGER NOT NULL,
  recipe_hash TEXT NOT NULL,
  stage_plan_hash TEXT NOT NULL,
  cohort_hash TEXT,
  runtime_attestation_id UUID NOT NULL REFERENCES cro03c_runtime_attestations(id) ON DELETE RESTRICT,
  caps JSONB NOT NULL,
  stop_policy_hash TEXT NOT NULL,
  approval_evidence JSONB NOT NULL,
  pre_run_snapshot_id UUID,
  state TEXT NOT NULL DEFAULT 'queued',
  cancel_requested_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03c_command_type_chk CHECK (command_type IN ('activation','micro_canary','initial_batch')),
  CONSTRAINT cro03c_command_state_chk CHECK (state IN ('queued','running','completed','failed','cancelled','inconclusive_pending_reconciliation')),
  CONSTRAINT cro03c_command_hash_chk CHECK (
    recipe_hash ~ '^[0-9a-f]{64}$' AND stage_plan_hash ~ '^[0-9a-f]{64}$' AND stop_policy_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT cro03c_command_expiry_chk CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS cro03c_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id UUID NOT NULL UNIQUE REFERENCES cro03c_commands(id) ON DELETE RESTRICT,
  run_key TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  claim_token UUID,
  execution_fence INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  stop_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03c_run_mode_chk CHECK (mode IN ('cro03c_micro_canary_v1','cro03c_live_v1')),
  CONSTRAINT cro03c_run_state_chk CHECK (state IN ('queued','claimed','running','completed','failed','cancelled','inconclusive_pending_reconciliation'))
);

CREATE TABLE IF NOT EXISTS cro03c_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handoff_id UUID NOT NULL REFERENCES cro03a_handoffs(id) ON DELETE RESTRICT,
  recipe_version INTEGER NOT NULL,
  recipe_hash TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'cro03c_live_v1',
  activation_revision INTEGER NOT NULL,
  command_id UUID NOT NULL REFERENCES cro03c_commands(id) ON DELETE RESTRICT,
  run_id UUID NOT NULL REFERENCES cro03c_runs(id) ON DELETE RESTRICT,
  frozen_handoff_hash TEXT NOT NULL,
  stage_plan_hash TEXT NOT NULL,
  cohort_hash TEXT NOT NULL,
  runtime_attestation_id UUID NOT NULL REFERENCES cro03c_runtime_attestations(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'queued',
  claim_token UUID,
  execution_fence INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (handoff_id, recipe_version),
  CONSTRAINT cro03c_generation_mode_chk CHECK (mode = 'cro03c_live_v1'),
  CONSTRAINT cro03c_generation_hash_chk CHECK (
    recipe_hash ~ '^[0-9a-f]{64}$' AND frozen_handoff_hash ~ '^[0-9a-f]{64}$' AND
    stage_plan_hash ~ '^[0-9a-f]{64}$' AND cohort_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT cro03c_generation_state_chk CHECK (state IN ('queued','claimed','running','completed','failed','cancelled','inconclusive_pending_reconciliation'))
);

CREATE TABLE IF NOT EXISTS cro03c_stage_dispositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID NOT NULL REFERENCES cro03c_generations(id) ON DELETE RESTRICT,
  stage_key TEXT NOT NULL,
  disposition TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  recipe_hash TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (generation_id, stage_key),
  CONSTRAINT cro03c_stage_disposition_chk CHECK (disposition IN (
    'eligible','skipped_sufficient_evidence','skipped_missing_anchor','skipped_not_applicable',
    'blocked_control','blocked_budget','blocked_authority','review_required'
  )),
  CONSTRAINT cro03c_stage_disposition_hash_chk CHECK (
    input_hash ~ '^[0-9a-f]{64}$' AND evidence_hash ~ '^[0-9a-f]{64}$' AND
    recipe_hash ~ '^[0-9a-f]{64}$' AND policy_hash ~ '^[0-9a-f]{64}$'
  )
);

CREATE TABLE IF NOT EXISTS cro03c_stage_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID NOT NULL REFERENCES cro03c_generations(id) ON DELETE RESTRICT,
  stage_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  operation_key TEXT NOT NULL UNIQUE,
  provider_operation_id UUID REFERENCES provider_operations(id) ON DELETE RESTRICT,
  caller TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  price_schedule_version INTEGER NOT NULL,
  price_schedule_hash TEXT NOT NULL,
  max_reserved_units INTEGER NOT NULL DEFAULT 0,
  max_reserved_amount_micros BIGINT NOT NULL DEFAULT 0,
  settled_units INTEGER NOT NULL DEFAULT 0,
  settled_amount_micros BIGINT NOT NULL DEFAULT 0,
  provider_receipt_reference TEXT,
  billing_certainty TEXT NOT NULL DEFAULT 'none',
  terminal_disposition TEXT,
  state TEXT NOT NULL DEFAULT 'reserved',
  dispatched_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (generation_id, stage_key),
  CONSTRAINT cro03c_operation_units_chk CHECK (
    max_reserved_units >= 0 AND max_reserved_amount_micros >= 0 AND settled_units >= 0 AND settled_amount_micros >= 0
  ),
  CONSTRAINT cro03c_operation_billing_chk CHECK (billing_certainty IN ('none','certain','ambiguous','unknown')),
  CONSTRAINT cro03c_operation_state_chk CHECK (state IN ('reserved','dispatched','completed','failed','cancelled','quarantined')),
  CONSTRAINT cro03c_operation_terminal_chk CHECK (
    terminal_disposition IS NULL OR terminal_disposition IN ('consumed','released','refunded','ambiguous','none')
  )
);

CREATE TABLE IF NOT EXISTS cro03c_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID NOT NULL REFERENCES cro03c_generations(id) ON DELETE RESTRICT,
  stage_operation_id UUID REFERENCES cro03c_stage_operations(id) ON DELETE RESTRICT,
  receipt_key TEXT NOT NULL UNIQUE,
  receipt_type TEXT NOT NULL,
  normalized_outcome TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  provider_receipt_reference TEXT,
  redacted_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  settled_units INTEGER NOT NULL DEFAULT 0,
  settled_amount_micros BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03c_receipt_units_chk CHECK (settled_units >= 0 AND settled_amount_micros >= 0),
  CONSTRAINT cro03c_receipt_hash_chk CHECK (evidence_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS cro03c_request_hop_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_operation_id UUID NOT NULL REFERENCES cro03c_stage_operations(id) ON DELETE RESTRICT,
  hop_number INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  hostname TEXT NOT NULL,
  pinned_address_hash TEXT NOT NULL,
  response_status INTEGER,
  redirect_target_hash TEXT,
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stage_operation_id, hop_number),
  CONSTRAINT cro03c_hop_bounds_chk CHECK (hop_number BETWEEN 0 AND 99 AND bytes >= 0)
);

CREATE TABLE IF NOT EXISTS cro03c_no_outbound_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id UUID NOT NULL REFERENCES cro03c_commands(id) ON DELETE RESTRICT,
  run_id UUID REFERENCES cro03c_runs(id) ON DELETE RESTRICT,
  phase TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  counters JSONB NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (command_id, phase),
  CONSTRAINT cro03c_snapshot_phase_chk CHECK (phase IN ('pre_run','post_run')),
  CONSTRAINT cro03c_snapshot_hash_chk CHECK (snapshot_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS cro03c_forbidden_effects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id UUID NOT NULL REFERENCES cro03c_commands(id) ON DELETE RESTRICT,
  run_id UUID REFERENCES cro03c_runs(id) ON DELETE RESTRICT,
  effect_kind TEXT NOT NULL,
  correlation_id TEXT,
  attempted_count INTEGER NOT NULL DEFAULT 0,
  effective_count INTEGER NOT NULL DEFAULT 0,
  disposition TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03c_effect_counts_chk CHECK (attempted_count >= 0 AND effective_count >= 0),
  CONSTRAINT cro03c_effect_disposition_chk CHECK (disposition IN ('blocked','failed_run','inconclusive','none'))
);

CREATE TABLE IF NOT EXISTS cro03c_validation_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_intent_id UUID NOT NULL UNIQUE REFERENCES validation_intents(id) ON DELETE RESTRICT,
  command_id UUID NOT NULL REFERENCES cro03c_commands(id) ON DELETE RESTRICT,
  run_id UUID NOT NULL REFERENCES cro03c_runs(id) ON DELETE RESTRICT,
  generation_id UUID NOT NULL REFERENCES cro03c_generations(id) ON DELETE RESTRICT,
  activation_revision INTEGER NOT NULL,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  normalized_email_hash TEXT NOT NULL,
  subject_generation INTEGER NOT NULL,
  runtime_attestation_id UUID NOT NULL REFERENCES cro03c_runtime_attestations(id) ON DELETE RESTRICT,
  expected_provider_control_revision INTEGER NOT NULL,
  unit_cap INTEGER NOT NULL,
  cost_cap_micros BIGINT NOT NULL DEFAULT 0,
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03c_validation_purpose_chk CHECK (unit_cap > 0 AND cost_cap_micros >= 0 AND expires_at > authorized_at)
);

CREATE TABLE IF NOT EXISTS cro03c_validation_revocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id UUID NOT NULL REFERENCES cro03c_validation_authorizations(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (authorization_id)
);

CREATE TABLE IF NOT EXISTS cro03c_initial_rollouts (
  rollout_key TEXT PRIMARY KEY,
  command_id UUID UNIQUE REFERENCES cro03c_commands(id) ON DELETE RESTRICT,
  activation_revision INTEGER,
  membership_hash TEXT,
  state TEXT NOT NULL DEFAULT 'reserved',
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03c_rollout_key_chk CHECK (rollout_key = 'cro03c_initial_v1'),
  CONSTRAINT cro03c_rollout_state_chk CHECK (state IN ('reserved','running','completed','failed','cancelled','inconclusive_pending_reconciliation'))
);

CREATE TABLE IF NOT EXISTS cro03c_initial_memberships (
  rollout_key TEXT NOT NULL REFERENCES cro03c_initial_rollouts(rollout_key) ON DELETE RESTRICT,
  generation_id UUID NOT NULL UNIQUE REFERENCES cro03c_generations(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL,
  handoff_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rollout_key, ordinal),
  CONSTRAINT cro03c_membership_ordinal_chk CHECK (ordinal BETWEEN 0 AND 99)
);

-- The following records are evidence, not mutable state.  Operational command,
-- run, generation, and operation rows remain mutable only for their lifecycle.
DROP TRIGGER IF EXISTS cro03c_activation_policy_immutable ON cro03c_activation_policies;
CREATE TRIGGER cro03c_activation_policy_immutable BEFORE UPDATE OR DELETE ON cro03c_activation_policies
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
DROP TRIGGER IF EXISTS cro03c_runtime_attestation_immutable ON cro03c_runtime_attestations;
CREATE TRIGGER cro03c_runtime_attestation_immutable BEFORE UPDATE OR DELETE ON cro03c_runtime_attestations
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
DROP TRIGGER IF EXISTS cro03c_stage_disposition_immutable ON cro03c_stage_dispositions;
CREATE TRIGGER cro03c_stage_disposition_immutable BEFORE UPDATE OR DELETE ON cro03c_stage_dispositions
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
DROP TRIGGER IF EXISTS cro03c_receipt_immutable ON cro03c_receipts;
CREATE TRIGGER cro03c_receipt_immutable BEFORE UPDATE OR DELETE ON cro03c_receipts
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
DROP TRIGGER IF EXISTS cro03c_hop_receipt_immutable ON cro03c_request_hop_receipts;
CREATE TRIGGER cro03c_hop_receipt_immutable BEFORE UPDATE OR DELETE ON cro03c_request_hop_receipts
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
DROP TRIGGER IF EXISTS cro03c_effect_immutable ON cro03c_forbidden_effects;
CREATE TRIGGER cro03c_effect_immutable BEFORE UPDATE OR DELETE ON cro03c_forbidden_effects
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
DROP TRIGGER IF EXISTS cro03c_validation_authorization_immutable ON cro03c_validation_authorizations;
CREATE TRIGGER cro03c_validation_authorization_immutable BEFORE UPDATE OR DELETE ON cro03c_validation_authorizations
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
DROP TRIGGER IF EXISTS cro03c_validation_revocation_immutable ON cro03c_validation_revocations;
CREATE TRIGGER cro03c_validation_revocation_immutable BEFORE UPDATE OR DELETE ON cro03c_validation_revocations
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
DROP TRIGGER IF EXISTS cro03c_initial_membership_immutable ON cro03c_initial_memberships;
CREATE TRIGGER cro03c_initial_membership_immutable BEFORE UPDATE OR DELETE ON cro03c_initial_memberships
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();