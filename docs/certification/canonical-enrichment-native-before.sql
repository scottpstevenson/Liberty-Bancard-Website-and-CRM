-- Read-only. Run in the selected PRODUCTION database; inspect results.
SELECT current_user,
       current_setting('transaction_read_only') AS transaction_read_only,
       has_schema_privilege(current_user,'public','CREATE') AS schema_create,
       EXISTS (
         SELECT 1 FROM pg_proc p
          WHERE p.oid=to_regprocedure('public.enforce_reviewed_contact_business_link()')
            AND pg_has_role(current_user,p.proowner,'USAGE')
       ) AS function_owner_membership,
       EXISTS (
         SELECT 1 FROM pg_class c
          WHERE c.oid='public.contact_business_system_link_evidence'::regclass
            AND pg_has_role(current_user,c.relowner,'USAGE')
       ) AS evidence_table_owner_membership;

SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS signature,
       p.prorettype::regtype AS return_type,md5(p.prosrc) AS body_md5,
       pg_get_userbyid(p.proowner) AS owner,p.proacl,
       p.prosecdef,p.proconfig,l.lanname,p.provolatile,p.proparallel
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname='public'
   AND p.proname IN ('crm_identity_name','crm_identity_domain',
       'crm_automatic_relationship_reasons','enforce_reviewed_contact_business_link',
       'cro02_system_link_evidence_append_only')
 ORDER BY p.proname;

SELECT t.tgname,t.tgenabled,t.tgtype,pg_get_triggerdef(t.oid) AS definition
  FROM pg_trigger t
 WHERE t.tgrelid IN ('public.contact_business_link_decisions'::regclass,
       'public.contact_business_system_link_evidence'::regclass)
   AND NOT t.tgisinternal
 ORDER BY t.tgname;

SELECT hash,created_at FROM drizzle.__drizzle_migrations
 WHERE hash IN (
   '2ad3368b98a06a849bea990ee117059bb6452e889a1087a10f937245016a2fee',
   '1086b507553d470df5e673b53ef11abc1ce343c3ae6efd605b268eadc92a574d',
   '51670bda2ec7efad4a9c4cd0c8fc639979708c379a3e6655631addff30329957'
 ) ORDER BY created_at;