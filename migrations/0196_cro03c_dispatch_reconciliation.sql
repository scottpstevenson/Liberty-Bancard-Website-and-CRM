-- CRO-03C durable dispatch and reconciliation boundaries.
-- 0195 may already be applied; this migration is strictly additive.

-- Approval is an externally issued, append-only authority artifact.  In
-- particular, an application role, deployment environment, or credential is
-- not itself an approval authority.
CREATE TABLE IF NOT EXISTS cro03c_approval_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  dimension TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  issuer_receipt_id TEXT NOT NULL,
  scope JSONB NOT NULL,
  scope_hash TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  signature TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dimension, issuer_id, issuer_receipt_id),
  CONSTRAINT cro03c_approval_receipt_dimension_chk CHECK (dimension IN ('operator','data','finance','legal')),
  CONSTRAINT cro03c_approval_receipt_hash_chk CHECK (scope_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cro03c_approval_receipt_expiry_chk CHECK (expires_at > issued_at)
);

CREATE TABLE IF NOT EXISTS cro03c_approval_receipt_revocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES cro03c_approval_receipts(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  revoked_by TEXT NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (receipt_id)
);

DROP TRIGGER IF EXISTS cro03c_approval_receipt_immutable ON cro03c_approval_receipts;
CREATE TRIGGER cro03c_approval_receipt_immutable BEFORE UPDATE OR DELETE ON cro03c_approval_receipts
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
DROP TRIGGER IF EXISTS cro03c_approval_receipt_revocation_immutable ON cro03c_approval_receipt_revocations;
CREATE TRIGGER cro03c_approval_receipt_revocation_immutable BEFORE UPDATE OR DELETE ON cro03c_approval_receipt_revocations
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();

ALTER TABLE cro03c_commands
  ADD COLUMN IF NOT EXISTS effect_authorized BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS effect_correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS pre_pause_epoch BIGINT,
  ADD CONSTRAINT cro03c_command_effect_denied_chk CHECK (effect_authorized = FALSE);

ALTER TABLE cro03c_stage_dispositions
  ADD COLUMN IF NOT EXISTS frozen_input JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE cro03c_stage_operations
  ADD COLUMN IF NOT EXISTS command_id UUID REFERENCES cro03c_commands(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES cro03c_runs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS claim_token UUID,
  ADD COLUMN IF NOT EXISTS execution_fence INTEGER,
  ADD COLUMN IF NOT EXISTS attempt_id UUID,
  ADD COLUMN IF NOT EXISTS pre_io_authorized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatch_state TEXT NOT NULL DEFAULT 'not_dispatched',
  ADD COLUMN IF NOT EXISTS reconciliation_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD CONSTRAINT cro03c_operation_dispatch_state_chk CHECK (
    dispatch_state IN ('not_dispatched','dispatching','dispatched','confirmed_not_dispatched','ambiguous','reconciled')
  );

CREATE UNIQUE INDEX IF NOT EXISTS cro03c_stage_operation_attempt_uidx
  ON cro03c_stage_operations(attempt_id) WHERE attempt_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cro03c_domain_request_limits (
  hostname_hash TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (hostname_hash, window_started_at),
  CONSTRAINT cro03c_domain_request_count_chk CHECK (request_count BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS cro03c_dispatch_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_operation_id UUID NOT NULL REFERENCES cro03c_stage_operations(id) ON DELETE RESTRICT,
  attempt_id UUID NOT NULL,
  checkpoint TEXT NOT NULL,
  authority_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(stage_operation_id, attempt_id, checkpoint),
  CONSTRAINT cro03c_dispatch_checkpoint_chk CHECK (
    checkpoint IN ('pre_reservation','pre_io','transport_returned','confirmed_not_dispatched','ambiguous','reconciled')
  ),
  CONSTRAINT cro03c_dispatch_checkpoint_hash_chk CHECK (authority_hash ~ '^[0-9a-f]{64}$')
);

DROP TRIGGER IF EXISTS cro03c_dispatch_checkpoint_immutable ON cro03c_dispatch_checkpoints;
CREATE TRIGGER cro03c_dispatch_checkpoint_immutable BEFORE UPDATE OR DELETE ON cro03c_dispatch_checkpoints
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();