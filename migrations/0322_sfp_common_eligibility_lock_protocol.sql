-- One transaction-lock order for SFP eligibility facts:
-- policy -> CRO-02 graph -> business safety sentinel -> normalized address
-- -> cohort/source/projection rows -> provider controls/receipts.
--
-- Readers take the business sentinel in shared mode. Writers of DBPR lineage
-- and existing-customer facts take it exclusively. Contact writes take it in
-- shared mode and then the same normalized-address lock used by SFP readers.

CREATE OR REPLACE FUNCTION cro03_sfp_business_safety_fact_serialization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_business_id INTEGER;
  new_business_id INTEGER;
  business_id_to_lock INTEGER;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_business_id := OLD.business_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_business_id := NEW.business_id; END IF;

  FOR business_id_to_lock IN
    SELECT DISTINCT candidate_id
      FROM unnest(ARRAY[old_business_id,new_business_id]) AS ids(candidate_id)
     WHERE candidate_id IS NOT NULL
     ORDER BY candidate_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'sfp-business-safety-v1:' || business_id_to_lock::text, 0
    ));
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sfp_sdr_merchants_business_safety_serialization_trg ON sdr_merchants;
CREATE TRIGGER sfp_sdr_merchants_business_safety_serialization_trg
  BEFORE INSERT OR UPDATE OR DELETE ON sdr_merchants
  FOR EACH ROW EXECUTE FUNCTION cro03_sfp_business_safety_fact_serialization();

DROP TRIGGER IF EXISTS sfp_canonical_source_links_business_safety_serialization_trg ON canonical_source_links;
CREATE TRIGGER sfp_canonical_source_links_business_safety_serialization_trg
  BEFORE INSERT OR UPDATE OR DELETE ON canonical_source_links
  FOR EACH ROW EXECUTE FUNCTION cro03_sfp_business_safety_fact_serialization();

CREATE OR REPLACE FUNCTION cro03_sfp_contact_address_commit_serialization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_address TEXT;
  new_address TEXT;
  business_id_to_lock INTEGER;
  address_to_lock TEXT;
  address_facts_changed BOOLEAN := TRUE;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_address := NULLIF(lower(btrim(OLD.email, E' \t\n\r\f')), ''); END IF;
  IF TG_OP <> 'DELETE' THEN new_address := NULLIF(lower(btrim(NEW.email, E' \t\n\r\f')), ''); END IF;

  IF TG_OP = 'UPDATE' THEN
    address_facts_changed :=
      ROW(NEW.business_id, NEW.email, NEW.email_token_hash, NEW.record_class, NEW.archived_at,
          NEW.existing_merchant_customer, NEW.do_not_contact, NEW.do_not_auto_contact,
          NEW.opted_out_email, NEW.opt_out_status, NEW.unsubscribe_status, NEW.complaint_status,
          NEW.bounce_status, NEW.email_status, NEW.suppression_reason, NEW.consent_tier,
          NEW.consent_email)
        IS DISTINCT FROM
      ROW(OLD.business_id, OLD.email, OLD.email_token_hash, OLD.record_class, OLD.archived_at,
          OLD.existing_merchant_customer, OLD.do_not_contact, OLD.do_not_auto_contact,
          OLD.opted_out_email, OLD.opt_out_status, OLD.unsubscribe_status, OLD.complaint_status,
          OLD.bounce_status, OLD.email_status, OLD.suppression_reason, OLD.consent_tier,
          OLD.consent_email);
  END IF;

  IF address_facts_changed THEN
    -- A contact mutation follows the same business-sentinel -> address order
    -- as eligibility readers. The sentinel is shared because address locks
    -- serialize same-address contact changes while business fact writers use
    -- the sentinel exclusively.
    FOR business_id_to_lock IN
      SELECT DISTINCT candidate_id
        FROM unnest(ARRAY[
          CASE WHEN TG_OP <> 'INSERT' THEN OLD.business_id END,
          CASE WHEN TG_OP <> 'DELETE' THEN NEW.business_id END
        ]) AS ids(candidate_id)
       WHERE candidate_id IS NOT NULL
       ORDER BY candidate_id
    LOOP
      PERFORM pg_advisory_xact_lock_shared(hashtextextended(
        'sfp-business-safety-v1:' || business_id_to_lock::text, 0
      ));
    END LOOP;

    FOR address_to_lock IN
      SELECT DISTINCT candidate_address
        FROM unnest(ARRAY[old_address,new_address]) AS addresses(candidate_address)
       WHERE candidate_address IS NOT NULL
       ORDER BY candidate_address
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(
        'sfp-contact-address-v1:' || address_to_lock, 0
      ));
    END LOOP;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cro03_sfp_contact_address_commit_serialization_trg ON contacts;
CREATE TRIGGER cro03_sfp_contact_address_commit_serialization_trg
  BEFORE INSERT OR UPDATE OR DELETE ON contacts
  FOR EACH ROW EXECUTE FUNCTION cro03_sfp_contact_address_commit_serialization();

-- The global eligibility fence is deliberately statement-level: PostgreSQL
-- acquires UPDATE/DELETE tuple locks before row triggers run, which could
-- otherwise invert advisory-key -> eligibility-row order. Readers take the
-- shared gate before reading even when the unique eligibility row is absent.
CREATE OR REPLACE FUNCTION cro03_sfp_eligibility_projection_serialization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'sfp-eligibility-projection-global-v1', 0
  ));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sfp_eligibility_projection_serialization_trg ON sfp_outreach_eligibility;
CREATE TRIGGER sfp_eligibility_projection_serialization_trg
  BEFORE INSERT OR UPDATE OR DELETE ON sfp_outreach_eligibility
  FOR EACH STATEMENT EXECUTE FUNCTION cro03_sfp_eligibility_projection_serialization();