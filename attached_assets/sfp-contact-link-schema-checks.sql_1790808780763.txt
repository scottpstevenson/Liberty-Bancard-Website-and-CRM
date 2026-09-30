-- SFP contact-link prechecks AND postchecks. Run the same file at both boundaries.
-- READ ONLY: this is not a production migration and installs/changes nothing.
-- STOP: do not apply links unless the last SELECT returns schema_ready=true.
-- SELECT statements only; no explicit transaction keywords, so the managed
-- database console can wrap the script in its own transaction.

SELECT current_database() AS database_name, current_setting('transaction_read_only') AS read_only;

SELECT table_name,column_name,data_type,is_nullable,column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN
 ('contact_business_link_decisions','contact_business_system_link_evidence',
  'sfp_outreach_eligibility','sfp_campaign_staging_intents')
ORDER BY table_name,ordinal_position;

SELECT r.relname,c.conname,c.contype,c.convalidated,pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
JOIN pg_namespace n ON n.oid=r.relnamespace
WHERE n.nspname='public' AND r.relname IN
 ('contact_business_link_decisions','contact_business_system_link_evidence',
  'sfp_outreach_eligibility','sfp_campaign_staging_intents')
ORDER BY r.relname,c.conname;

SELECT r.relname,t.tgname,t.tgenabled,t.tgtype,t.tgqual IS NULL AS unconditional,
 pg_get_triggerdef(t.oid) AS trigger_definition,pg_get_functiondef(p.oid) AS function_definition,
 md5(p.prosrc) AS function_body_md5
FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=r.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
WHERE NOT t.tgisinternal AND n.nspname='public' AND r.relname IN
 ('contact_business_link_decisions','contact_business_system_link_evidence')
ORDER BY r.relname,t.tgname;

-- Exact content hashes, not migration count/timestamp, are application-history proof.
SELECT hash,created_at FROM drizzle.__drizzle_migrations
WHERE hash IN ('9aa3ff3555b12ec5ae91a2fbe27675ca97e5d2367141a03100b63f57e9fa2469',
 '2ad3368b98a06a849bea990ee117059bb6452e889a1087a10f937245016a2fee')
ORDER BY created_at;

-- This SELECT is compiled from the application's CURRENT exact readiness guard.
SELECT readiness.*, COALESCE(installed AND immutable_evidence_trigger
 AND evidence_table AND evidence_column AND evidence_foreign_keys
 AND sfp_contact_checks,false) AS schema_ready
FROM (
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
        AND md5(p.prosrc)='08832cf0204fbdd3207ff815d10fb9c7'
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
  ) AS readiness;
