-- Scheduled discovery repair: rewrite the two single-row "id" checks so Publish can carry them to production.
-- 0388 declared `id boolean ... CHECK(id)` on discovery_schedules and discovery_lane. PostgreSQL stores that check as the
-- bare column expression `CHECK (id)`. Publish generates production SQL from the development catalog and wrapped the bare
-- column in a second CHECK, producing `CHECK (CHECK (id))`; the whole Publish stopped at "Migrations failed validation"
-- (syntax error at or near "CHECK") and none of the 0388 tables, indexes or constraints reached production.
-- `CHECK (id = true)` has the same meaning for these primary-key (NOT NULL) columns and is stored as `CHECK ((id = true))`,
-- the same shape as every other check in the 0388 tables that already round-trips. The replacement is a normal validated
-- check (never NOT VALID). Both tables hold at most one row, so the brief lock is negligible. No data changes and nothing
-- is sent. Idempotent: a table that does not exist, or a check that is already rewritten, is skipped.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['discovery_schedules', 'discovery_lane'] LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL
       AND EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = ('public.' || tbl)::regclass
                     AND conname = tbl || '_id_check'
                     AND pg_get_constraintdef(oid) = 'CHECK (id)') THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', tbl, tbl || '_id_check');
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (id = true)', tbl, tbl || '_id_check');
    END IF;
  END LOOP;
END $$;
