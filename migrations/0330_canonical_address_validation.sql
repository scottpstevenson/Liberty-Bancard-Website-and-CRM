CREATE TABLE canonical_address_validation_claims (
  email_token_hash text PRIMARY KEY
    CONSTRAINT canonical_address_validation_claims_hash_check CHECK (email_token_hash ~ '^[a-f0-9]{64}$'),
  normalization_version integer NOT NULL DEFAULT 1
    CONSTRAINT canonical_address_validation_claims_version_check CHECK (normalization_version=1),
  claim_token uuid,
  lease_expires_at timestamptz,
  operation_id uuid REFERENCES provider_operations(id) ON DELETE RESTRICT,
  dispatched_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canonical_address_validation_claims_lease_check
    CHECK ((claim_token IS NULL) = (lease_expires_at IS NULL)),
  CONSTRAINT canonical_address_validation_claims_dispatch_check
    CHECK (dispatched_at IS NULL OR operation_id IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX canonical_address_receipt_lookup_idx
ON provider_observations(email_token_hash,observed_at DESC)
WHERE provider='zerobounce' AND retryable=FALSE AND outcome IN ('valid','invalid');
--> statement-breakpoint
-- Change ONLY the original-receipt subject restriction. Affiliation, current
-- candidate/source pins, policy, suppression, expiry and reviewed-link checks
-- remain byte-for-byte identical. An address receipt never proves affiliation.
DO $migration$
DECLARE body text;
  old_clause text := 'AND po.subject_type=''business'' AND po.subject_id=NEW.business_id';
  new_clause text := 'AND po.subject_type IN (''business'',''contact'') /* canonical_address_receipt_v1 */';
BEGIN
  SELECT prosrc INTO body FROM pg_proc
    WHERE oid='public.enforce_reviewed_contact_business_link()'::regprocedure;
  IF strpos(body,new_clause)>0 AND
     md5(replace(body,new_clause,old_clause))='46f89326f7c158ac739814ce343c2559' THEN
    RETURN;
  END IF;
  IF md5(body)<>'46f89326f7c158ac739814ce343c2559'
     OR strpos(body,old_clause)=0 THEN
    RAISE EXCEPTION 'CANONICAL_ADDRESS_UPSTREAM_NATIVE_GUARD_DRIFT';
  END IF;
  body:=replace(body,old_clause,new_clause);
  EXECUTE 'CREATE OR REPLACE FUNCTION public.enforce_reviewed_contact_business_link() RETURNS trigger LANGUAGE plpgsql AS '||quote_literal(body);
END $migration$;