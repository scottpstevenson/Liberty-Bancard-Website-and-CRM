-- Keep provider usage at PostgreSQL's arbitrary-precision NUMERIC scale and
-- persist the exact receipt bound to the operation's original dispatch claim.
ALTER TABLE provider_operations
  ALTER COLUMN provider_usage_quantity TYPE numeric
  USING provider_usage_quantity::numeric,
  ADD COLUMN sfp_dispatch_receipt jsonb,
  ADD COLUMN sfp_dispatch_receipt_fingerprint text,
  ADD CONSTRAINT provider_operations_dispatch_receipt_contract_chk CHECK (
    (sfp_dispatch_receipt IS NULL AND sfp_dispatch_receipt_fingerprint IS NULL)
    OR (
      sfp_dispatch_receipt IS NOT NULL
      AND sfp_dispatch_receipt_fingerprint IS NOT NULL
      AND jsonb_typeof(sfp_dispatch_receipt) = 'object'
      AND sfp_dispatch_receipt_fingerprint ~ '^[0-9a-f]{64}$'
    )
  );

ALTER TABLE sfp_provider_usage_reconciliations
  ALTER COLUMN usage_quantity TYPE numeric
  USING usage_quantity::numeric;

CREATE OR REPLACE FUNCTION guard_sfp_dispatch_receipt_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sfp_dispatch_receipt IS NOT NULL AND (
    NEW.sfp_dispatch_receipt IS DISTINCT FROM OLD.sfp_dispatch_receipt
    OR NEW.sfp_dispatch_receipt_fingerprint IS DISTINCT FROM OLD.sfp_dispatch_receipt_fingerprint
  ) THEN
    RAISE EXCEPTION 'SFP_DISPATCH_RECEIPT_IMMUTABLE';
  END IF;
  IF (NEW.sfp_dispatch_receipt IS NULL) <> (NEW.sfp_dispatch_receipt_fingerprint IS NULL) THEN
    RAISE EXCEPTION 'SFP_DISPATCH_RECEIPT_PAIR_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER provider_operations_dispatch_receipt_immutable_trg
BEFORE UPDATE ON provider_operations
FOR EACH ROW EXECUTE FUNCTION guard_sfp_dispatch_receipt_immutable();