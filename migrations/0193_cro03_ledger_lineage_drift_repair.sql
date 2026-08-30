-- Additive repair for environments where historical 0175 was journaled but
-- its CRO-03 provider accounting lineage DDL was not applied.
ALTER TABLE cro03_provider_runs
  ADD COLUMN IF NOT EXISTS outcome_code TEXT,
  ADD COLUMN IF NOT EXISTS retryable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS retry_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_request_hash TEXT,
  ADD COLUMN IF NOT EXISTS receipt_id UUID REFERENCES cro03_receipts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS provider_attempt_id UUID REFERENCES provider_attempts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS validation_intent_id UUID REFERENCES validation_intents(id) ON DELETE RESTRICT;

ALTER TABLE cro03_receipts ADD COLUMN IF NOT EXISTS provider TEXT;
DROP TRIGGER IF EXISTS cro03_receipt_immutable ON cro03_receipts;
UPDATE cro03_receipts receipt SET provider=run.provider
  FROM cro03_provider_runs run
 WHERE receipt.provider_run_id=run.id AND receipt.provider IS NULL;
ALTER TABLE cro03_receipts ALTER COLUMN provider SET NOT NULL;
CREATE TRIGGER cro03_receipt_immutable BEFORE UPDATE OR DELETE ON cro03_receipts
  FOR EACH ROW EXECUTE FUNCTION cro03_immutable_row_guard();

ALTER TABLE cro03_provider_ledger
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'reservation',
  ADD COLUMN IF NOT EXISTS reservation_entry_id UUID REFERENCES cro03_provider_ledger(id) ON DELETE RESTRICT;
DROP TRIGGER IF EXISTS cro03_ledger_immutable ON cro03_provider_ledger;
UPDATE cro03_provider_ledger SET event_type='terminal' WHERE disposition<>'outstanding';
INSERT INTO cro03_provider_ledger
  (provider_run_id,provider_operation_id,provider,entry_key,event_type,disposition,units,amount_micros)
SELECT l.provider_run_id,l.provider_operation_id,l.provider,'reserve:legacy:'||l.id,
       'reservation','outstanding',l.units,l.amount_micros
  FROM cro03_provider_ledger l
 WHERE l.event_type='terminal' AND l.reservation_entry_id IS NULL
ON CONFLICT(entry_key) DO NOTHING;
UPDATE cro03_provider_ledger terminal SET reservation_entry_id=reservation.id
  FROM cro03_provider_ledger reservation
 WHERE terminal.event_type='terminal' AND terminal.reservation_entry_id IS NULL
   AND reservation.entry_key='reserve:legacy:'||terminal.id;
CREATE TRIGGER cro03_ledger_immutable BEFORE UPDATE OR DELETE ON cro03_provider_ledger
  FOR EACH ROW EXECUTE FUNCTION cro03_immutable_row_guard();

DO $$ BEGIN
  ALTER TABLE cro03_provider_ledger ADD CONSTRAINT cro03_ledger_event_type_chk
    CHECK (event_type IN ('reservation','terminal'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE cro03_provider_ledger ADD CONSTRAINT cro03_ledger_terminal_lineage_chk CHECK (
    (event_type='reservation' AND reservation_entry_id IS NULL AND disposition='outstanding')
    OR (event_type='terminal' AND reservation_entry_id IS NOT NULL
        AND disposition IN ('consumed','released','refunded','ambiguous'))
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS cro03_ledger_one_reservation_per_run
  ON cro03_provider_ledger(provider_run_id) WHERE event_type='reservation';
CREATE UNIQUE INDEX IF NOT EXISTS cro03_ledger_one_reservation_per_operation
  ON cro03_provider_ledger(provider_operation_id)
  WHERE event_type='reservation' AND provider_operation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cro03_ledger_one_terminal_per_run
  ON cro03_provider_ledger(provider_run_id) WHERE event_type='terminal';

CREATE OR REPLACE FUNCTION cro03_validate_ledger_terminal_lineage()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM cro03_provider_runs run
  JOIN provider_operations operation ON operation.id=NEW.provider_operation_id
   WHERE run.id=NEW.provider_run_id
     AND run.operation_id=NEW.provider_operation_id
     AND run.provider=NEW.provider
     AND operation.provider=NEW.provider
   FOR UPDATE OF run,operation;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRO03_LEDGER_RUN_OPERATION_PROVIDER_MISMATCH'; END IF;
  IF NEW.event_type='terminal' AND NOT EXISTS (
    SELECT 1 FROM cro03_provider_ledger reservation
     WHERE reservation.id=NEW.reservation_entry_id
       AND reservation.event_type='reservation'
       AND reservation.provider_run_id=NEW.provider_run_id
       AND reservation.provider_operation_id IS NOT DISTINCT FROM NEW.provider_operation_id
       AND reservation.provider=NEW.provider
       AND reservation.units=NEW.units
       AND reservation.amount_micros=NEW.amount_micros
  ) THEN RAISE EXCEPTION 'CRO03_LEDGER_LINEAGE_MISMATCH'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cro03_ledger_lineage_guard ON cro03_provider_ledger;
CREATE TRIGGER cro03_ledger_lineage_guard BEFORE INSERT OR UPDATE ON cro03_provider_ledger
  FOR EACH ROW EXECUTE FUNCTION cro03_validate_ledger_terminal_lineage();

CREATE OR REPLACE FUNCTION cro03_validate_receipt_lineage()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM cro03_provider_runs run
  JOIN provider_operations operation ON operation.id=NEW.provider_operation_id
   WHERE run.id=NEW.provider_run_id
     AND run.operation_id=NEW.provider_operation_id
     AND run.provider=NEW.provider
     AND operation.provider=NEW.provider
   FOR UPDATE OF run,operation;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRO03_RECEIPT_RUN_OPERATION_PROVIDER_MISMATCH'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cro03_provider_ledger ledger
     WHERE ledger.provider_run_id=NEW.provider_run_id
       AND ledger.provider_operation_id=NEW.provider_operation_id
       AND ledger.provider=NEW.provider
       AND ledger.units=NEW.units AND ledger.amount_micros=NEW.amount_micros
       AND ((NEW.billing_disposition='outstanding' AND ledger.event_type='reservation'
             AND ledger.disposition='outstanding')
         OR (NEW.billing_disposition<>'outstanding' AND ledger.event_type='terminal'
             AND ledger.disposition=NEW.billing_disposition))
  ) THEN RAISE EXCEPTION 'CRO03_RECEIPT_LEDGER_LINEAGE_MISMATCH'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cro03_receipt_lineage_guard ON cro03_receipts;
CREATE TRIGGER cro03_receipt_lineage_guard BEFORE INSERT OR UPDATE ON cro03_receipts
  FOR EACH ROW EXECUTE FUNCTION cro03_validate_receipt_lineage();