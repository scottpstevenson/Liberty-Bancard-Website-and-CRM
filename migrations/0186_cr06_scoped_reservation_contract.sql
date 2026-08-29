-- CR-06 reservations are immutable evidence for every limiting authority.
-- Dispatch is unavailable, so every scope intentionally has zero send capacity.

-- 0184 installed a blanket history trigger. It must be removed before the
-- one-time compatibility backfill; the narrower transition guard is installed
-- only after every retained row has the new contract.
DROP TRIGGER IF EXISTS cr06_reservation_immutable ON cr06_preparation_reservations;
DROP TRIGGER IF EXISTS cr06_scoped_reservation_guard ON cr06_preparation_reservations;

ALTER TABLE cr06_preparation_reservations
  DROP CONSTRAINT IF EXISTS cr06_preparation_reservations_preparation_run_id_key,
  DROP CONSTRAINT IF EXISTS cr06_preparation_reservations_reservation_key_key;
DROP INDEX IF EXISTS cr06_preparation_reservations_preparation_run_id_key;
DROP INDEX IF EXISTS cr06_preparation_reservations_reservation_key_key;

ALTER TABLE cr06_preparation_reservations
  ADD COLUMN IF NOT EXISTS scope_type TEXT,
  ADD COLUMN IF NOT EXISTS scope_identity TEXT,
  ADD COLUMN IF NOT EXISTS scope_window TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reserved_member_cap INTEGER,
  ADD COLUMN IF NOT EXISTS effective_cap INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_usage INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receipt JSONB,
  ADD COLUMN IF NOT EXISTS receipt_hash TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'held',
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciliation_receipt JSONB,
  ADD COLUMN IF NOT EXISTS reconciliation_receipt_hash TEXT,
  ADD COLUMN IF NOT EXISTS reconciliation_actor_id TEXT,
  ADD COLUMN IF NOT EXISTS reconciliation_as_of TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciliation_key TEXT;

-- 0184 could have created one legacy evidence row. Retain it rather than
-- deleting history; new preparations always create the complete seven scopes.
UPDATE cr06_preparation_reservations
SET scope_type = COALESCE(scope_type, 'legacy'),
    scope_identity = COALESCE(scope_identity, reservation_key),
    reserved_member_cap = COALESCE(reserved_member_cap, reserved_members),
    receipt = COALESCE(receipt, jsonb_build_object('receiptVersion', 1, 'legacy', true)),
    receipt_hash = COALESCE(receipt_hash, md5(COALESCE(receipt, jsonb_build_object('receiptVersion', 1, 'legacy', true))::text)),
    expires_at = COALESCE(expires_at, created_at),
    state = CASE WHEN scope_type IS NULL THEN 'superseded' ELSE state END;

ALTER TABLE cr06_preparation_reservations
  ALTER COLUMN scope_type SET NOT NULL,
  ALTER COLUMN scope_identity SET NOT NULL,
  ALTER COLUMN reserved_member_cap SET NOT NULL,
  ALTER COLUMN receipt SET NOT NULL,
  ALTER COLUMN receipt_hash SET NOT NULL,
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE cr06_preparation_reservations
  ADD CONSTRAINT cr06_preparation_reservation_scope_chk
    CHECK (scope_type IN ('sender','campaign','provider','minute','hour','day','canary','legacy')),
  ADD CONSTRAINT cr06_preparation_reservation_state_chk
    CHECK (state IN ('held','reconciled','expired','superseded')),
  ADD CONSTRAINT cr06_preparation_reservation_caps_chk
    CHECK (reserved_members >= 0 AND reserved_member_cap >= 0 AND effective_cap >= 0 AND current_usage >= 0),
  ADD CONSTRAINT cr06_preparation_reservation_zero_send_capacity_chk
    CHECK (send_capacity_units = 0),
  ADD CONSTRAINT cr06_preparation_reservation_reconciliation_evidence_chk CHECK (
    scope_type = 'legacy' OR
    (state = 'held' AND reconciled_at IS NULL AND reconciliation_receipt IS NULL
      AND reconciliation_receipt_hash IS NULL AND reconciliation_actor_id IS NULL
      AND reconciliation_as_of IS NULL AND reconciliation_key IS NULL) OR
    (state IN ('reconciled','expired','superseded') AND reconciled_at IS NOT NULL
      AND reconciliation_receipt IS NOT NULL AND reconciliation_receipt_hash ~ '^[0-9a-f]{64}$'
      AND reconciliation_actor_id IS NOT NULL AND reconciliation_as_of IS NOT NULL
      AND reconciliation_key IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS cr06_preparation_reservation_run_scope_uidx
  ON cr06_preparation_reservations(preparation_run_id, scope_type);
CREATE UNIQUE INDEX IF NOT EXISTS cr06_preparation_reservation_key_uidx
  ON cr06_preparation_reservations(reservation_key);
CREATE INDEX IF NOT EXISTS cr06_preparation_reservation_expiry_idx
  ON cr06_preparation_reservations(state, expires_at);

CREATE OR REPLACE FUNCTION cr06_guard_scoped_reservation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CR06_RESERVATION_IMMUTABLE';
  END IF;
  IF NEW.preparation_run_id IS DISTINCT FROM OLD.preparation_run_id OR
     NEW.reservation_key IS DISTINCT FROM OLD.reservation_key OR
     NEW.scope_type IS DISTINCT FROM OLD.scope_type OR
     NEW.scope_identity IS DISTINCT FROM OLD.scope_identity OR
     NEW.scope_window IS DISTINCT FROM OLD.scope_window OR
     NEW.reserved_members IS DISTINCT FROM OLD.reserved_members OR
     NEW.reserved_member_cap IS DISTINCT FROM OLD.reserved_member_cap OR
     NEW.effective_cap IS DISTINCT FROM OLD.effective_cap OR
     NEW.current_usage IS DISTINCT FROM OLD.current_usage OR
     NEW.send_capacity_units IS DISTINCT FROM OLD.send_capacity_units OR
     NEW.dependency_snapshot IS DISTINCT FROM OLD.dependency_snapshot OR
     NEW.receipt IS DISTINCT FROM OLD.receipt OR
     NEW.receipt_hash IS DISTINCT FROM OLD.receipt_hash OR
     NEW.expires_at IS DISTINCT FROM OLD.expires_at OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'CR06_RESERVATION_IMMUTABLE';
  END IF;
  IF OLD.reconciliation_receipt IS NOT NULL OR
     NEW.reconciliation_receipt IS NULL OR
     NEW.reconciliation_receipt_hash IS NULL OR
     NEW.reconciliation_actor_id IS NULL OR
     NEW.reconciliation_as_of IS NULL OR
     NEW.reconciliation_key IS NULL THEN
    RAISE EXCEPTION 'CR06_RESERVATION_RECONCILIATION_EVIDENCE_INVALID';
  END IF;
  IF NOT (
    (OLD.state = 'held' AND NEW.state = 'reconciled' AND NEW.reconciled_at = NEW.reconciliation_as_of) OR
    (OLD.state = 'held' AND NEW.state = 'expired' AND OLD.expires_at <= clock_timestamp() AND NEW.reconciled_at = NEW.reconciliation_as_of) OR
    (OLD.state = 'held' AND NEW.state = 'superseded' AND NEW.reconciled_at = NEW.reconciliation_as_of)
  ) THEN
    RAISE EXCEPTION 'CR06_RESERVATION_TRANSITION_FORBIDDEN';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cr06_scoped_reservation_guard
  BEFORE UPDATE OR DELETE ON cr06_preparation_reservations
  FOR EACH ROW EXECUTE FUNCTION cr06_guard_scoped_reservation();