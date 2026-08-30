CREATE TABLE IF NOT EXISTS cro03b_stage_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES cro03b_recipe_items(id) ON DELETE RESTRICT,
  step_key TEXT NOT NULL,
  execution_owner TEXT NOT NULL,
  accounting_owner TEXT NOT NULL,
  operation_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  requested_units INTEGER NOT NULL DEFAULT 0,
  settled_units INTEGER NOT NULL DEFAULT 0,
  outcome_code TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03b_stage_operation_state_chk CHECK (state IN ('completed','failed','deferred')),
  CONSTRAINT cro03b_stage_operation_units_chk CHECK
    (requested_units >= 0 AND settled_units >= 0 AND settled_units <= requested_units),
  CONSTRAINT cro03b_stage_operation_identity_uidx UNIQUE (item_id,step_key)
);

CREATE TABLE IF NOT EXISTS cro03b_stage_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES cro03b_stage_operations(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  transport_invoked BOOLEAN NOT NULL DEFAULT FALSE,
  error_code TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT cro03b_stage_attempt_identity_uidx UNIQUE (operation_id,attempt_number),
  CONSTRAINT cro03b_stage_attempt_transport_chk CHECK
    (outcome <> 'transport_denied' OR transport_invoked=FALSE)
);

CREATE TABLE IF NOT EXISTS cro03b_stage_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL UNIQUE REFERENCES cro03b_stage_operations(id) ON DELETE RESTRICT,
  receipt_key TEXT NOT NULL UNIQUE,
  outcome TEXT NOT NULL,
  requested_units INTEGER NOT NULL DEFAULT 0,
  settled_units INTEGER NOT NULL DEFAULT 0,
  evidence_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03b_stage_receipt_hash_chk CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cro03b_stage_receipt_units_chk CHECK
    (requested_units >= 0 AND settled_units >= 0 AND settled_units <= requested_units)
);

ALTER TABLE cro03b_evidence_observations
  ADD COLUMN IF NOT EXISTS stage_operation_id UUID REFERENCES cro03b_stage_operations(id) ON DELETE RESTRICT;

DROP TRIGGER IF EXISTS cro03b_stage_operations_immutable ON cro03b_stage_operations;
CREATE TRIGGER cro03b_stage_operations_immutable BEFORE UPDATE OR DELETE ON cro03b_stage_operations
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
DROP TRIGGER IF EXISTS cro03b_stage_attempts_immutable ON cro03b_stage_attempts;
CREATE TRIGGER cro03b_stage_attempts_immutable BEFORE UPDATE OR DELETE ON cro03b_stage_attempts
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
DROP TRIGGER IF EXISTS cro03b_stage_receipts_immutable ON cro03b_stage_receipts;
CREATE TRIGGER cro03b_stage_receipts_immutable BEFORE UPDATE OR DELETE ON cro03b_stage_receipts
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();