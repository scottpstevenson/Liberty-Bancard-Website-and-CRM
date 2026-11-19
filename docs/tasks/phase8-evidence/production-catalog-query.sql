-- Executed as SELECT only through Replit Production Database, Enable Editing off.
-- Captures catalog/aggregate data only; no customer rows, DDL, ANALYZE or counter reset.
SELECT json_build_object(
 'checked_at',clock_timestamp(),
 'database',current_database(),
 'pause',(SELECT json_build_object('state',state,'epoch',epoch) FROM public.outbound_pause_control LIMIT 1),
 'outscraper_limit_micros',(SELECT limit_micros FROM public.outscraper_budget_policy WHERE id),
 'pg_stat_statements_installed',EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements'),
 'pg_stat_statements_view',to_regclass('public.pg_stat_statements'),
 'indexes',(SELECT json_agg(json_build_object('table',t.relname,'index',i.relname,'valid',x.indisvalid,'definition',pg_get_indexdef(i.oid)))
   FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
   WHERE n.nspname='public' AND t.relname IN ('contacts','sequence_enrollments','deals','audit_logs')
    AND (pg_get_indexdef(i.oid) ILIKE '%assigned_to%' OR pg_get_indexdef(i.oid) ILIKE '%contact_id%' OR pg_get_indexdef(i.oid) ILIKE '%pipeline%' OR pg_get_indexdef(i.oid) ILIKE '%entity_type%' OR pg_get_indexdef(i.oid) ILIKE '%entity_key%')),
 'table_stats',(SELECT json_agg(json_build_object('table',relname,'estimated_rows',n_live_tup,'estimated_dead_rows',n_dead_tup,'sequential_scans',seq_scan,'index_scans',idx_scan,'last_autoanalyze',last_autoanalyze,'last_autovacuum',last_autovacuum))
   FROM pg_stat_user_tables WHERE schemaname='public' AND relname IN ('contacts','sequence_enrollments','deals','audit_logs'))
) AS phase8_readonly_audit;
