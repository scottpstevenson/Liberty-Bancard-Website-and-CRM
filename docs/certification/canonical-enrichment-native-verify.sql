
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
  ;
