CREATE TABLE IF NOT EXISTS sfp_global_recipient_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id integer NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  recipient_identity_hash text NOT NULL,
  slot integer NOT NULL CHECK (slot BETWEEN 1 AND 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sfp_global_slot_business_number_unique UNIQUE (business_id,slot),
  CONSTRAINT sfp_global_slot_address_unique UNIQUE (recipient_identity_hash),
  CONSTRAINT sfp_global_slot_subject_unique UNIQUE (id,business_id,recipient_identity_hash)
);
ALTER TABLE sfp_recipient_address_commitments ADD COLUMN IF NOT EXISTS global_slot_id uuid;
ALTER TABLE sfp_recipient_address_commitments
  DROP CONSTRAINT IF EXISTS sfp_recipient_global_slot_subject_fk;
ALTER TABLE sfp_recipient_address_commitments
  ADD CONSTRAINT sfp_recipient_global_slot_subject_fk
  FOREIGN KEY (global_slot_id,business_id,recipient_identity_hash)
  REFERENCES sfp_global_recipient_slots(id,business_id,recipient_identity_hash) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION crm_enforce_global_recipient_capacity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE count_addresses integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('sfp-business-recipient-capacity:'||NEW.business_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('sfp-recipient-address-owner:'||NEW.recipient_identity_hash,0));
  IF NEW.global_slot_id IS NULL THEN RAISE EXCEPTION 'SFP_GLOBAL_RECIPIENT_SLOT_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM sfp_recipient_address_commitments
    WHERE recipient_identity_hash=NEW.recipient_identity_hash AND business_id<>NEW.business_id) THEN
    RAISE EXCEPTION 'SFP_STAGING_RECIPIENT_BUSINESS_CONFLICT';
  END IF;
  SELECT count(DISTINCT recipient_identity_hash) INTO count_addresses
    FROM sfp_recipient_address_commitments WHERE business_id=NEW.business_id
      AND state IN ('claimed','committed');
  IF count_addresses>=3 AND NOT EXISTS (
    SELECT 1 FROM sfp_recipient_address_commitments WHERE business_id=NEW.business_id
      AND recipient_identity_hash=NEW.recipient_identity_hash AND state IN ('claimed','committed')) THEN
    RAISE EXCEPTION 'SFP_STAGING_BUSINESS_RECIPIENT_CAPACITY_REACHED';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sfp_global_recipient_capacity_contract ON sfp_recipient_address_commitments;
CREATE TRIGGER sfp_global_recipient_capacity_contract
  BEFORE INSERT ON sfp_recipient_address_commitments
  FOR EACH ROW EXECUTE FUNCTION crm_enforce_global_recipient_capacity();