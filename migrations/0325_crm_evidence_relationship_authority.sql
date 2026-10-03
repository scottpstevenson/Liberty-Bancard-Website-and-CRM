-- Development/disposable migration only. Production schema belongs to Publish.
-- Relationship identity is independent of deliverability and permission to send.
CREATE OR REPLACE FUNCTION crm_identity_name(value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(
    regexp_replace(lower(normalize(coalesce(value,''),NFKD)),
      '\m(incorporated|inc|limited|ltd|llc|llp|corp|corporation|company|co)\M','','g'),
    '[^a-z0-9]','','g')
$$;

CREATE OR REPLACE FUNCTION crm_identity_domain(value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(lower(regexp_replace(split_part(split_part(
    regexp_replace(btrim(coalesce(value,'')),'^[a-zA-Z]+://',''), '/',1),':',1),
    '^www[.]','','i')),'')
$$;

CREATE OR REPLACE FUNCTION crm_automatic_relationship_reasons(
  contact_key integer, business_key integer, source_key uuid, entity_key integer)
RETURNS text[] LANGUAGE plpgsql STABLE AS $$
DECLARE
  c contacts%ROWTYPE; b businesses%ROWTYPE;
  s canonical_source_links%ROWTYPE; e sunbiz_entities%ROWTYPE;
  reasons text[] := ARRAY[]::text[];
  name_match boolean := false; stable_match boolean := false;
  address_match boolean := false; phone_match boolean := false;
  domain_match boolean := false; source_name text; source_dba text;
  contact_domain text; canonical_domain text;
BEGIN
  SELECT * INTO c FROM contacts WHERE id=contact_key;
  IF NOT FOUND THEN RETURN ARRAY['contact_missing']; END IF;
  SELECT * INTO b FROM businesses WHERE id=business_key;
  IF NOT FOUND THEN RETURN ARRAY['business_missing']; END IF;
  IF c.archived_at IS NOT NULL OR c.record_class IS NULL
      OR c.record_class IN ('test','demo','synthetic') OR b.record_class IS DISTINCT FROM 'canonical' THEN
    reasons := array_append(reasons,'non_production_record_class');
  END IF;
  IF c.business_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM contact_business_link_decisions d
    WHERE d.contact_id=c.id AND d.superseded_at IS NULL) THEN
    reasons := array_append(reasons,'current_link_decision_exists');
  END IF;
  SELECT * INTO s FROM canonical_source_links WHERE id=source_key AND business_id=b.id;
  IF NOT FOUND THEN RETURN array_append(reasons,'independent_source_link_missing'); END IF;
  IF s.source_system='sunbiz' AND s.source_type='sunbiz_entity' THEN
    SELECT * INTO e FROM sunbiz_entities
      WHERE id=entity_key AND filing_number=s.stable_key AND source IN ('cordata','corevt','sunbiz');
    IF NOT FOUND THEN RETURN array_append(reasons,'independent_registry_identity_missing'); END IF;
    source_name := crm_identity_name(e.entity_name);
    source_dba := crm_identity_name(to_jsonb(e)->>'dba');
    IF crm_identity_name(b.canonical_name) NOT IN (source_name,source_dba) THEN
      reasons := array_append(reasons,'canonical_registry_name_conflict');
    END IF;
    name_match := crm_identity_name(c.company_name)<>''
      AND crm_identity_name(c.company_name) IN (source_name,source_dba);
    -- A selected event must contain its own identifier; never borrow a contact's
    -- unrelated identifier to manufacture event/business corroboration.
    stable_match := EXISTS (
      SELECT 1 FROM contact_source_events ev WHERE ev.contact_id=c.id
        AND (ev.metadata->>'filingNumber'=s.stable_key OR ev.metadata->>'filing_number'=s.stable_key)
        AND NOT (ev.metadata ? 'businessId' AND ev.metadata->>'businessId'<>b.id::text));
    address_match := crm_identity_name(c.address)<>''
      AND crm_identity_name(c.address)=crm_identity_name(e.principal_address)
      AND crm_identity_name(c.city)<>'' AND crm_identity_name(c.city)=crm_identity_name(e.principal_city)
      AND crm_identity_name(c.state)<>'' AND crm_identity_name(c.state)=crm_identity_name(e.principal_state)
      AND (NULLIF(b.street_address,'') IS NULL OR crm_identity_name(b.street_address)=crm_identity_name(c.address));
    phone_match := length(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'))>=10
      AND right(regexp_replace(c.phone,'[^0-9]','','g'),10)
         =right(regexp_replace(coalesce(nullif(to_jsonb(e)->>'phone',''),to_jsonb(e)->>'owner_phone',''),'[^0-9]','','g'),10)
      AND right(regexp_replace(c.phone,'[^0-9]','','g'),10)
          =right(regexp_replace(coalesce(b.main_phone,''),'[^0-9]','','g'),10)
      AND (SELECT count(*) FROM businesses other WHERE other.record_class='canonical'
        AND right(regexp_replace(coalesce(other.main_phone,''),'[^0-9]','','g'),10)
            =right(regexp_replace(c.phone,'[^0-9]','','g'),10))=1;
  ELSIF s.source_system IN ('google_maps','google','outscraper') AND entity_key IS NULL THEN
    stable_match := b.google_place_id IS NOT NULL AND s.stable_key<>'' AND s.stable_key=b.google_place_id AND EXISTS (
      SELECT 1 FROM contact_source_events ev WHERE ev.contact_id=c.id
        AND (ev.metadata->>'place_id'=s.stable_key OR ev.metadata->>'placeId'=s.stable_key
             OR ev.metadata->>'google_place_id'=s.stable_key)
        AND NOT (ev.metadata ? 'businessId' AND ev.metadata->>'businessId'<>b.id::text));
    name_match := crm_identity_name(c.company_name)<>'' AND
      crm_identity_name(c.company_name)=crm_identity_name(b.canonical_name);
  ELSE
    RETURN array_append(reasons,'unsupported_identity_source');
  END IF;
  contact_domain := crm_identity_domain(c.website);
  canonical_domain := crm_identity_domain(b.website_domain);
  domain_match := contact_domain IS NOT NULL AND canonical_domain IS NOT NULL AND contact_domain=canonical_domain
    AND coalesce((s.source_system='sunbiz' AND crm_identity_domain(e.website)=contact_domain)
      OR (s.source_system IN ('google_maps','google','outscraper') AND stable_match),FALSE)
    AND contact_domain NOT IN ('instagram.com','facebook.com','waze.com','linktr.ee',
       'linkedin.com','maps.google.com','google.com','yelp.com','tiktok.com','bit.ly')
    AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['instagram.com','facebook.com','waze.com',
      'linktr.ee','linkedin.com','google.com','yelp.com','tiktok.com','bit.ly']) host
      WHERE contact_domain LIKE '%.'||host)
    AND (SELECT count(*) FROM businesses other WHERE other.record_class='canonical'
      AND crm_identity_domain(other.website_domain)=contact_domain)=1;
  IF NOT name_match THEN reasons:=array_append(reasons,'company_or_trade_name_conflict'); END IF;
  IF NOT (stable_match OR address_match OR phone_match OR domain_match) THEN
    reasons:=array_append(reasons,'independent_corroboration_required');
  END IF;
  IF address_match AND NOT stable_match AND EXISTS (
    SELECT 1 FROM canonical_source_links os
    JOIN businesses ob ON ob.id=os.business_id AND ob.record_class='canonical'
    JOIN sunbiz_entities oe ON oe.filing_number=os.stable_key AND oe.source IN ('cordata','corevt','sunbiz')
    WHERE os.source_system='sunbiz' AND os.source_type='sunbiz_entity' AND ob.id<>b.id
      AND crm_identity_name(c.company_name) IN (crm_identity_name(oe.entity_name),crm_identity_name(oe.dba))
      AND crm_identity_name(c.address)=crm_identity_name(oe.principal_address)
      AND crm_identity_name(c.city)=crm_identity_name(oe.principal_city)
      AND crm_identity_name(c.state)=crm_identity_name(oe.principal_state)) THEN
    reasons:=array_append(reasons,'address_competing_businesses');
  END IF;
  IF EXISTS (SELECT 1 FROM canonical_source_links other
    JOIN businesses ob ON ob.id=other.business_id AND ob.record_class='canonical'
    WHERE other.source_system=s.source_system AND other.source_type=s.source_type
      AND other.stable_key=s.stable_key AND other.business_id<>b.id) THEN
    reasons:=array_append(reasons,'stable_identifier_competing_businesses');
  END IF;
  IF c.state IS NOT NULL AND b.state IS NOT NULL
    AND upper(btrim(c.state))<>upper(btrim(b.state)) THEN
    reasons:=array_append(reasons,'location_state_conflict');
  END IF;
  RETURN reasons;
END $$;

ALTER TABLE contact_business_system_link_evidence ALTER COLUMN source_entity_id DROP NOT NULL;

-- Retain the complete reviewed/SFP contracts; replace only the legacy general
-- system predicate, with an exact fingerprint and bounded substring guard.
DO $migration$
DECLARE body text; start_at integer; end_at integer; replacement text;
BEGIN
  SELECT prosrc INTO body FROM pg_proc
    WHERE oid='public.enforce_reviewed_contact_business_link()'::regprocedure;
  IF strpos(body,'crm_automatic_relationship_reasons')>0 THEN RETURN; END IF;
  IF md5(body)<>'30910090e380e90ea27bff572d2c5847' THEN
    RAISE EXCEPTION 'CRM_RELATIONSHIP_UPSTREAM_GUARD_DRIFT';
  END IF;
  start_at:=strpos(body,E'        IF NOT EXISTS (\n          SELECT 1\n            FROM contacts c\n            JOIN businesses b ON b.id=NEW.business_id\n            JOIN canonical_source_links csl');
  end_at:=strpos(body,E'      ELSE\n        RAISE EXCEPTION ''COMMERCIAL_SYSTEM_LINK_CONTRACT_REQUIRED'';\n      END IF;');
  IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'CRM_RELATIONSHIP_GUARD_BOUNDARY_MISSING'; END IF;
  replacement:=E'        IF evidence_row.rule_version <> ''crm_evidence_identity_v2'' OR cardinality(crm_automatic_relationship_reasons(NEW.contact_id,NEW.business_id,evidence_row.source_link_id,evidence_row.source_entity_id))<>0 THEN\n          RAISE EXCEPTION ''COMMERCIAL_SYSTEM_LINK_AUTHORITY_FENCE_LOST'';\n        END IF;\n';
  body:=substring(body from 1 for start_at-1)||replacement||substring(body from end_at);
  EXECUTE 'CREATE OR REPLACE FUNCTION public.enforce_reviewed_contact_business_link() RETURNS trigger LANGUAGE plpgsql AS '||quote_literal(body);
END $migration$;