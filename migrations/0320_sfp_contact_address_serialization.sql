-- Database-enforced address serialization for SFP suppression decisions.
-- Direct SQL writers and canonical contact-writer paths share the same
-- normalized-address transaction advisory lock used by staging and bridge.
CREATE OR REPLACE FUNCTION cro03_sfp_contact_address_commit_serialization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_address TEXT;
  new_address TEXT;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NULLIF(BTRIM(NEW.email), '') IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(
        'sfp-contact-address-v1:' ||
        lower(btrim(NEW.email, E' \t\n\r\f')), 0
      ));
    END IF;
    RETURN NEW;
  END IF;

  old_address := NULLIF(lower(btrim(OLD.email, E' \t\n\r\f')), '');
  new_address := NULLIF(lower(btrim(NEW.email, E' \t\n\r\f')), '');
  IF ROW(
       NEW.email, NEW.email_token_hash, NEW.record_class, NEW.archived_at,
       NEW.existing_merchant_customer, NEW.do_not_contact, NEW.do_not_auto_contact,
       NEW.opted_out_email, NEW.opt_out_status, NEW.unsubscribe_status,
       NEW.complaint_status, NEW.bounce_status, NEW.email_status,
       NEW.suppression_reason
     ) IS DISTINCT FROM ROW(
       OLD.email, OLD.email_token_hash, OLD.record_class, OLD.archived_at,
       OLD.existing_merchant_customer, OLD.do_not_contact, OLD.do_not_auto_contact,
       OLD.opted_out_email, OLD.opt_out_status, OLD.unsubscribe_status,
       OLD.complaint_status, OLD.bounce_status, OLD.email_status,
       OLD.suppression_reason
     )
  THEN
    IF old_address IS NOT NULL AND new_address IS NOT NULL AND old_address<>new_address THEN
      IF old_address<new_address THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('sfp-contact-address-v1:'||old_address,0));
        PERFORM pg_advisory_xact_lock(hashtextextended('sfp-contact-address-v1:'||new_address,0));
      ELSE
        PERFORM pg_advisory_xact_lock(hashtextextended('sfp-contact-address-v1:'||new_address,0));
        PERFORM pg_advisory_xact_lock(hashtextextended('sfp-contact-address-v1:'||old_address,0));
      END IF;
    ELSIF new_address IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('sfp-contact-address-v1:'||new_address,0));
    ELSIF old_address IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('sfp-contact-address-v1:'||old_address,0));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cro03_sfp_contact_address_commit_serialization_trg ON contacts;
CREATE TRIGGER cro03_sfp_contact_address_commit_serialization_trg
  BEFORE INSERT OR UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION cro03_sfp_contact_address_commit_serialization();