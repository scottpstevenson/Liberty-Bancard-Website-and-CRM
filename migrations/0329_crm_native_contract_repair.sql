-- Forward native-contract reconciliation. No connection handling or startup/build hook.
-- Source bodies below are byte-for-byte from 0325; original files stay immutable.
-- A single DO statement is atomic even in SQL consoles that wrap transactions.
DO $crm_native_repair$
DECLARE guard_row record; old_hash text; old_search_path text; old_lock_timeout text; old_statement_timeout text; item record;
BEGIN
  old_search_path:=current_setting('search_path');
  old_lock_timeout:=current_setting('lock_timeout');
  old_statement_timeout:=current_setting('statement_timeout');
  PERFORM set_config('search_path','public, pg_catalog',true);
  PERFORM set_config('lock_timeout','5s',true);
  PERFORM set_config('statement_timeout','60s',true);
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-native-contract-repair-v1',0));
  SELECT md5(prosrc) INTO old_hash FROM pg_proc WHERE oid=to_regprocedure('public.enforce_reviewed_contact_business_link()');
  IF old_hash IS NULL OR old_hash NOT IN ('30910090e380e90ea27bff572d2c5847','46f89326f7c158ac739814ce343c2559') THEN
    RAISE EXCEPTION 'CRM_NATIVE_REPAIR_UNEXPECTED_REVIEW_BODY';
  END IF;
  IF NOT has_schema_privilege(current_user,'public','CREATE') THEN RAISE EXCEPTION 'CRM_NATIVE_REPAIR_SCHEMA_PERMISSION_REQUIRED'; END IF;
  FOR item IN SELECT p.proowner FROM pg_proc p WHERE p.oid=to_regprocedure('public.enforce_reviewed_contact_business_link()')
    UNION ALL SELECT c.relowner FROM pg_class c WHERE c.oid='public.contact_business_system_link_evidence'::regclass LOOP
    IF NOT pg_has_role(current_user,item.proowner,'USAGE') THEN RAISE EXCEPTION 'CRM_NATIVE_REPAIR_OWNER_PERMISSION_REQUIRED'; END IF;
  END LOOP;
  FOR item IN SELECT c.oid FROM pg_class c WHERE c.oid IN (
    'public.contacts'::regclass,'public.businesses'::regclass,'public.canonical_source_links'::regclass,
    'public.sunbiz_entities'::regclass,'public.contact_source_events'::regclass,'public.contact_business_link_decisions'::regclass) LOOP
    IF NOT has_table_privilege(current_user,item.oid,'SELECT') THEN RAISE EXCEPTION 'CRM_NATIVE_REPAIR_READ_PERMISSION_REQUIRED'; END IF;
  END LOOP;
  FOR item IN SELECT p.oid,md5(p.prosrc) body_hash,e.body_hash expected_hash, p.proowner
    FROM (VALUES ('public.crm_identity_name(text)','e45d1eb858ef5e5f9d94b8b9aa965c49'),
      ('public.crm_identity_domain(text)','d0af69048a9c4845df1589219a522629'),
      ('public.crm_automatic_relationship_reasons(integer,integer,uuid,integer)','6868a6d639a3fd0af7a10346821dad19')) e(signature,body_hash)
    JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) LOOP
    IF item.body_hash<>item.expected_hash THEN RAISE EXCEPTION 'CRM_NATIVE_REPAIR_UNEXPECTED_RELATIONSHIP_BODY'; END IF;
    IF NOT pg_has_role(current_user,item.proowner,'USAGE') THEN RAISE EXCEPTION 'CRM_NATIVE_REPAIR_FUNCTION_OWNER_REQUIRED'; END IF;
  END LOOP;
  SELECT * INTO guard_row FROM (

    SELECT EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE n.nspname='public' AND c.relname='contact_business_link_decisions'
        AND t.tgname='contact_business_link_review_contract'
        AND t.tgenabled IN ('O','A')
        AND NOT t.tgisinternal AND t.tgqual IS NULL
        AND t.tgtype=23
        AND p.proname='enforce_reviewed_contact_business_link'
        AND p.pronamespace='public'::regnamespace
        AND md5(p.prosrc)='46f89326f7c158ac739814ce343c2559'
    ) AS installed,
    EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE n.nspname='public' AND c.relname='contact_business_system_link_evidence'
        AND t.tgname='contact_business_system_link_evidence_append_only'
        AND t.tgenabled IN ('O','A')
        AND NOT t.tgisinternal AND t.tgqual IS NULL
        AND t.tgtype=27
        AND p.proname='cro02_system_link_evidence_append_only'
        AND p.pronamespace='public'::regnamespace
        AND md5(p.prosrc)='0851a20c34b3ce424364b5c3fc6e556b'
    ) AS immutable_evidence_trigger,
    to_regclass('public.contact_business_system_link_evidence') IS NOT NULL AS evidence_table,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='contact_business_link_decisions'
        AND column_name='system_evidence_id' AND data_type='uuid'
    ) AS evidence_column,
    (SELECT bool_and(EXISTS (
        SELECT 1
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid=con.conrelid
          JOIN pg_namespace ns ON ns.oid=rel.relnamespace
          JOIN pg_attribute local_col ON local_col.attrelid=con.conrelid
                                    AND local_col.attnum=con.conkey[1]
          JOIN pg_class referenced_rel ON referenced_rel.oid=con.confrelid
          JOIN pg_namespace referenced_ns ON referenced_ns.oid=referenced_rel.relnamespace
          JOIN pg_attribute referenced_col ON referenced_col.attrelid=con.confrelid
                                          AND referenced_col.attnum=con.confkey[1]
         WHERE ns.nspname='public' AND rel.relname=expected.table_name
           AND con.conname=expected.constraint_name AND con.contype='f'
           AND con.convalidated AND con.confdeltype='r'
           AND array_length(con.conkey,1)=1 AND array_length(con.confkey,1)=1
           AND local_col.attname=expected.column_name
           AND referenced_ns.nspname='public'
           AND referenced_rel.relname=expected.referenced_table
           AND referenced_col.attname=expected.referenced_column
      ))
       FROM (VALUES
         ('contact_business_system_link_evidence','contact_business_system_link_evidence_contact_id_fkey','contact_id','contacts','id'),
         ('contact_business_system_link_evidence','contact_business_system_link_evidence_business_id_fkey','business_id','businesses','id'),
         ('contact_business_system_link_evidence','contact_business_system_link_evidence_source_link_id_fkey','source_link_id','canonical_source_links','id'),
         ('contact_business_system_link_evidence','contact_business_system_link_evidence_source_entity_id_fkey','source_entity_id','sunbiz_entities','id'),
         ('contact_business_link_decisions','contact_business_link_decisions_system_evidence_id_fkey','system_evidence_id','contact_business_system_link_evidence','id')
       ) AS expected(table_name,constraint_name,column_name,referenced_table,referenced_column)
    ) AS evidence_foreign_keys,
    (SELECT COUNT(*) = 2 AND bool_and(
        CASE rel.relname
          WHEN 'sfp_outreach_eligibility' THEN
            md5(lower(regexp_replace(btrim(pg_get_expr(con.conbin,con.conrelid,true)),
                                     '[[:space:]]+',' ','g')))='e83217cf6cea8fb0a75857ac2100d4e3'
          WHEN 'sfp_campaign_staging_intents' THEN
            md5(lower(regexp_replace(btrim(pg_get_expr(con.conbin,con.conrelid,true)),
                                     '[[:space:]]+',' ','g')))='ddb906e4ac5e57a0700b1ea776bf8ed6'
          ELSE false
        END
      )
       FROM pg_constraint con
      JOIN pg_class rel ON rel.oid=con.conrelid
      JOIN pg_namespace ns ON ns.oid=rel.relnamespace
      WHERE (rel.relname,con.conname) IN (
        ('sfp_outreach_eligibility','sfp_outreach_eligibility_source_ref_one_of_chk'),
        ('sfp_campaign_staging_intents','sfp_campaign_staging_intents_source_ref_one_of_chk')
      )
       AND ns.nspname='public' AND con.contype='c' AND con.convalidated
       AND con.conislocal AND con.coninhcount=0
    ) AS sfp_contact_checks
    ,(SELECT count(*)=3 AND bool_and(md5(p.prosrc)=expected.body_hash)
      FROM (VALUES
        ('crm_identity_name','e45d1eb858ef5e5f9d94b8b9aa965c49'),
        ('crm_identity_domain','d0af69048a9c4845df1589219a522629'),
        ('crm_automatic_relationship_reasons','6868a6d639a3fd0af7a10346821dad19')
      ) expected(function_name,body_hash)
      JOIN pg_proc p ON p.proname=expected.function_name
        AND p.pronamespace='public'::regnamespace
    ) AS relationship_evaluator
  
  ) checked;
  IF NOT coalesce(guard_row.immutable_evidence_trigger AND guard_row.evidence_table AND guard_row.evidence_column
      AND guard_row.evidence_foreign_keys AND guard_row.sfp_contact_checks,FALSE) THEN
    RAISE EXCEPTION 'CRM_NATIVE_REPAIR_UPSTREAM_CONTRACT_MISSING';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.contact_business_link_decisions'::regclass
      AND t.tgname='contact_business_link_review_contract' AND t.tgenabled IN ('O','A')
      AND t.tgtype=23 AND NOT t.tgisinternal AND t.tgqual IS NULL
      AND t.tgfoid='public.enforce_reviewed_contact_business_link()'::regprocedure) THEN
    RAISE EXCEPTION 'CRM_NATIVE_REPAIR_REVIEW_TRIGGER_SHAPE_MISMATCH';
  END IF;
  EXECUTE $reviewed_0325$
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
$reviewed_0325$;
  SELECT * INTO guard_row FROM (

    SELECT EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE n.nspname='public' AND c.relname='contact_business_link_decisions'
        AND t.tgname='contact_business_link_review_contract'
        AND t.tgenabled IN ('O','A')
        AND NOT t.tgisinternal AND t.tgqual IS NULL
        AND t.tgtype=23
        AND p.proname='enforce_reviewed_contact_business_link'
        AND p.pronamespace='public'::regnamespace
        AND md5(p.prosrc)='46f89326f7c158ac739814ce343c2559'
    ) AS installed,
    EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE n.nspname='public' AND c.relname='contact_business_system_link_evidence'
        AND t.tgname='contact_business_system_link_evidence_append_only'
        AND t.tgenabled IN ('O','A')
        AND NOT t.tgisinternal AND t.tgqual IS NULL
        AND t.tgtype=27
        AND p.proname='cro02_system_link_evidence_append_only'
        AND p.pronamespace='public'::regnamespace
        AND md5(p.prosrc)='0851a20c34b3ce424364b5c3fc6e556b'
    ) AS immutable_evidence_trigger,
    to_regclass('public.contact_business_system_link_evidence') IS NOT NULL AS evidence_table,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='contact_business_link_decisions'
        AND column_name='system_evidence_id' AND data_type='uuid'
    ) AS evidence_column,
    (SELECT bool_and(EXISTS (
        SELECT 1
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid=con.conrelid
          JOIN pg_namespace ns ON ns.oid=rel.relnamespace
          JOIN pg_attribute local_col ON local_col.attrelid=con.conrelid
                                    AND local_col.attnum=con.conkey[1]
          JOIN pg_class referenced_rel ON referenced_rel.oid=con.confrelid
          JOIN pg_namespace referenced_ns ON referenced_ns.oid=referenced_rel.relnamespace
          JOIN pg_attribute referenced_col ON referenced_col.attrelid=con.confrelid
                                          AND referenced_col.attnum=con.confkey[1]
         WHERE ns.nspname='public' AND rel.relname=expected.table_name
           AND con.conname=expected.constraint_name AND con.contype='f'
           AND con.convalidated AND con.confdeltype='r'
           AND array_length(con.conkey,1)=1 AND array_length(con.confkey,1)=1
           AND local_col.attname=expected.column_name
           AND referenced_ns.nspname='public'
           AND referenced_rel.relname=expected.referenced_table
           AND referenced_col.attname=expected.referenced_column
      ))
       FROM (VALUES
         ('contact_business_system_link_evidence','contact_business_system_link_evidence_contact_id_fkey','contact_id','contacts','id'),
         ('contact_business_system_link_evidence','contact_business_system_link_evidence_business_id_fkey','business_id','businesses','id'),
         ('contact_business_system_link_evidence','contact_business_system_link_evidence_source_link_id_fkey','source_link_id','canonical_source_links','id'),
         ('contact_business_system_link_evidence','contact_business_system_link_evidence_source_entity_id_fkey','source_entity_id','sunbiz_entities','id'),
         ('contact_business_link_decisions','contact_business_link_decisions_system_evidence_id_fkey','system_evidence_id','contact_business_system_link_evidence','id')
       ) AS expected(table_name,constraint_name,column_name,referenced_table,referenced_column)
    ) AS evidence_foreign_keys,
    (SELECT COUNT(*) = 2 AND bool_and(
        CASE rel.relname
          WHEN 'sfp_outreach_eligibility' THEN
            md5(lower(regexp_replace(btrim(pg_get_expr(con.conbin,con.conrelid,true)),
                                     '[[:space:]]+',' ','g')))='e83217cf6cea8fb0a75857ac2100d4e3'
          WHEN 'sfp_campaign_staging_intents' THEN
            md5(lower(regexp_replace(btrim(pg_get_expr(con.conbin,con.conrelid,true)),
                                     '[[:space:]]+',' ','g')))='ddb906e4ac5e57a0700b1ea776bf8ed6'
          ELSE false
        END
      )
       FROM pg_constraint con
      JOIN pg_class rel ON rel.oid=con.conrelid
      JOIN pg_namespace ns ON ns.oid=rel.relnamespace
      WHERE (rel.relname,con.conname) IN (
        ('sfp_outreach_eligibility','sfp_outreach_eligibility_source_ref_one_of_chk'),
        ('sfp_campaign_staging_intents','sfp_campaign_staging_intents_source_ref_one_of_chk')
      )
       AND ns.nspname='public' AND con.contype='c' AND con.convalidated
       AND con.conislocal AND con.coninhcount=0
    ) AS sfp_contact_checks
    ,(SELECT count(*)=3 AND bool_and(md5(p.prosrc)=expected.body_hash)
      FROM (VALUES
        ('crm_identity_name','e45d1eb858ef5e5f9d94b8b9aa965c49'),
        ('crm_identity_domain','d0af69048a9c4845df1589219a522629'),
        ('crm_automatic_relationship_reasons','6868a6d639a3fd0af7a10346821dad19')
      ) expected(function_name,body_hash)
      JOIN pg_proc p ON p.proname=expected.function_name
        AND p.pronamespace='public'::regnamespace
    ) AS relationship_evaluator
  
  ) checked;
  IF NOT coalesce(guard_row.installed AND guard_row.immutable_evidence_trigger AND guard_row.evidence_table
      AND guard_row.evidence_column AND guard_row.evidence_foreign_keys AND guard_row.sfp_contact_checks
      AND guard_row.relationship_evaluator,FALSE) THEN RAISE EXCEPTION 'CRM_NATIVE_REPAIR_POSTCHECK_FAILED'; END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.contact_business_system_link_evidence'::regclass
      AND attname='source_entity_id' AND attnotnull) THEN RAISE EXCEPTION 'CRM_NATIVE_REPAIR_SOURCE_ENTITY_NULLABILITY_FAILED'; END IF;
  IF crm_identity_name('Example LLC')<>'example' OR crm_identity_domain('https://www.example.com/path')<>'example.com'
      OR crm_automatic_relationship_reasons(-1,-1,NULL,NULL)<>ARRAY['contact_missing'] THEN
    RAISE EXCEPTION 'CRM_NATIVE_REPAIR_EXECUTION_CHECK_FAILED';
  END IF;
  PERFORM set_config('search_path',old_search_path,true);
  PERFORM set_config('lock_timeout',old_lock_timeout,true);
  PERFORM set_config('statement_timeout',old_statement_timeout,true);
END $crm_native_repair$;
