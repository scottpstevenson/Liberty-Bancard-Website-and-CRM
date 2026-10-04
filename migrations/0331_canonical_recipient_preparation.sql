ALTER TABLE cr04_enrollment_intents
  ADD COLUMN program_id uuid REFERENCES sfp_programs(id) ON DELETE RESTRICT,
  ADD COLUMN business_id integer REFERENCES businesses(id) ON DELETE RESTRICT,
  ADD COLUMN normalized_email_hash text,
  ADD COLUMN preparation_state text,
  ADD COLUMN preparation_snapshot jsonb,
  ADD CONSTRAINT canonical_preparation_scope_chk CHECK (
    (program_id IS NULL AND business_id IS NULL AND normalized_email_hash IS NULL
      AND preparation_state IS NULL AND preparation_snapshot IS NULL)
    OR (program_id IS NOT NULL AND business_id IS NOT NULL
      AND normalized_email_hash IS NOT NULL AND preparation_state IS NOT NULL
      AND preparation_snapshot IS NOT NULL
      AND normalized_email_hash ~ '^[a-f0-9]{64}$'
      AND preparation_state IN ('pending_validation','ready_held','exception','rejected','suppressed')
      AND jsonb_typeof(preparation_snapshot)='object'
      AND channel='email' AND status='blocked')
  );
--> statement-breakpoint
CREATE INDEX canonical_preparation_business_program_idx
 ON cr04_enrollment_intents(business_id,program_id,preparation_state);
--> statement-breakpoint
CREATE UNIQUE INDEX canonical_preparation_sequence_address_idx
 ON cr04_enrollment_intents(business_id,program_id,normalized_email_hash,sequence_id)
 WHERE program_id IS NOT NULL;
--> statement-breakpoint
-- Preparation is deliberately NOT CR-04 send approval. Native cardinality is
-- business/program scoped, so an unrelated program or shared address never
-- asserts affiliation or consumes this program's useful-recipient allowance.
CREATE FUNCTION crm_enforce_canonical_preparation_capacity()
RETURNS trigger LANGUAGE plpgsql AS $body$
DECLARE useful_count integer;
BEGIN
  IF NEW.program_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.preparation_state NOT IN ('pending_validation','ready_held') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'canonical-preparation:'||NEW.business_id::text||':'||NEW.program_id::text,0));
  IF NOT EXISTS (
    SELECT 1 FROM contacts c JOIN businesses b ON b.id=c.business_id
     JOIN sfp_programs p ON p.id=NEW.program_id
    WHERE c.id=NEW.contact_id AND b.id=NEW.business_id
      AND b.record_class='canonical' AND c.archived_at IS NULL AND c.do_not_contact IS NOT TRUE
      AND p.is_active
      AND encode(sha256(convert_to(lower(trim(c.email)),'UTF8')),'hex')=NEW.normalized_email_hash
      AND EXISTS (SELECT 1 FROM contact_business_link_decisions l
        WHERE l.contact_id=c.id AND l.business_id=b.id AND l.decision='verified'
          AND l.superseded_at IS NULL)
  ) THEN RAISE EXCEPTION 'CANONICAL_PREPARATION_AFFILIATION_OR_SCOPE_STALE'; END IF;
  SELECT count(DISTINCT email_hash) INTO useful_count FROM (
    SELECT NEW.normalized_email_hash AS email_hash
    UNION
    SELECT normalized_email_hash FROM cr04_enrollment_intents
     WHERE program_id=NEW.program_id AND business_id=NEW.business_id
       AND id<>NEW.id AND preparation_state IN ('pending_validation','ready_held')
    UNION
    SELECT po.email_token_hash
      FROM sfp_recipient_address_commitments rc
      JOIN sfp_campaign_staging_intents si ON si.id=rc.staging_intent_id
      JOIN sfp_outreach_eligibility e ON e.id=si.eligibility_id
      JOIN provider_observations po ON po.operation_id=COALESCE(e.reused_from_operation_id,e.validation_operation_id)
     WHERE rc.program_id=NEW.program_id AND rc.business_id=NEW.business_id
       AND rc.state IN ('claimed','committed') AND po.provider='zerobounce'
       AND po.outcome='valid' AND po.retryable=FALSE
       AND po.observed_at<=clock_timestamp()
       AND LEAST(COALESCE(po.expires_at,po.observed_at+INTERVAL '30 days'),
         po.observed_at+INTERVAL '30 days')>clock_timestamp()
       AND NOT EXISTS (SELECT 1 FROM provider_observations bad
         WHERE bad.provider='zerobounce' AND bad.email_token_hash=po.email_token_hash
           AND bad.outcome='invalid' AND bad.retryable=FALSE
           AND bad.observed_at>=po.observed_at AND bad.observed_at<=clock_timestamp())
  ) addresses;
  IF useful_count>3 THEN RAISE EXCEPTION 'CANONICAL_PREPARATION_RECIPIENT_CAPACITY'; END IF;
  RETURN NEW;
END $body$;
--> statement-breakpoint
CREATE TRIGGER canonical_preparation_capacity
BEFORE INSERT OR UPDATE ON cr04_enrollment_intents
FOR EACH ROW EXECUTE FUNCTION crm_enforce_canonical_preparation_capacity();