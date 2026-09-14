-- Migration 0266: repair drifted CHECK constraints on production
--   (businesses.record_class, cro03_source_subjects.subject_type)
--
-- Background (Task #1955 BUILD verification, corrected):
--   Migrations 0240 and 0250 already contain the corrected constraint
--   definitions (adding 'canonical' to businesses_record_class_check and
--   'business' to cro03_source_subject_type_chk). Development has received
--   those migrations. Production has not yet been Published since before
--   0240/0250 were added, so the live production constraints still lack
--   both values. This migration does NOT change 0240 or 0250 — it is a new,
--   forward, idempotent repair that reaches the same end state regardless
--   of whether 0240/0250 ever get replayed against production directly.
--
-- Safety properties:
--   - State-aware: inspects the live constraint definition via
--     pg_get_constraintdef() and only touches it when the required value
--     is absent.
--   - Rerunnable: running this migration twice (or after 0240/0250 already
--     applied the fix through some other path) is a no-op the second time.
--   - Non-destructive: always rewrites the FULL known-good value list, so a
--     partial run can never narrow the constraint to fewer allowed values
--     than exist today.
--   - No data is touched; only the two constraint definitions.

DO $$
DECLARE
  current_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO current_def
  FROM pg_constraint
  WHERE conname = 'businesses_record_class_check'
    AND conrelid = 'businesses'::regclass;

  IF current_def IS NULL THEN
    RAISE EXCEPTION 'businesses_record_class_check not found on businesses; refusing to guess a definition';
  END IF;

  IF current_def NOT ILIKE '%''canonical''::text%' THEN
    ALTER TABLE businesses DROP CONSTRAINT businesses_record_class_check;
    ALTER TABLE businesses ADD CONSTRAINT businesses_record_class_check
      CHECK (record_class IN ('production', 'test', 'demo', 'synthetic', 'unknown', 'canonical'));
  END IF;
END $$;

DO $$
DECLARE
  current_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO current_def
  FROM pg_constraint
  WHERE conname = 'cro03_source_subject_type_chk'
    AND conrelid = 'cro03_source_subjects'::regclass;

  IF current_def IS NULL THEN
    RAISE EXCEPTION 'cro03_source_subject_type_chk not found on cro03_source_subjects; refusing to guess a definition';
  END IF;

  IF current_def NOT ILIKE '%''business''::text%' THEN
    ALTER TABLE cro03_source_subjects
      DROP CONSTRAINT cro03_source_subject_type_chk,
      ADD CONSTRAINT cro03_source_subject_type_chk CHECK (subject_type IN
        ('contact', 'prospect', 'sunbiz_entity', 'sdr_merchant', 'provider_csv_row',
         'public_web', 'lead_discovery_result', 'master_lead', 'business'));
  END IF;
END $$;
