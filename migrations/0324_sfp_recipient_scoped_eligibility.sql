-- Preserve every historical row and immutable staging reference. The former
-- business-wide projection cannot represent one primary and two alternatives.
CREATE UNIQUE INDEX IF NOT EXISTS sfp_outreach_run_business_recipient_policy_uidx
  ON sfp_outreach_eligibility
    (cohort_run_id,business_id,policy_version,normalized_value_hash);
CREATE UNIQUE INDEX IF NOT EXISTS sfp_outreach_run_business_unresolved_policy_uidx
  ON sfp_outreach_eligibility(cohort_run_id,business_id,policy_version)
  WHERE normalized_value_hash IS NULL;
DROP INDEX IF EXISTS sfp_outreach_run_business_policy_uidx;
-- Earlier schemas and disposable fixtures used a table-level UNIQUE rather
-- than the later named index. Remove precisely the old three-column shape;
-- keep every recipient-scoped, partial, and unrelated uniqueness contract.
DO $legacy_unique$
DECLARE old_constraint record;
BEGIN
  FOR old_constraint IN
    SELECT c.conname FROM pg_constraint c
    WHERE c.conrelid='sfp_outreach_eligibility'::regclass AND c.contype='u'
      AND (SELECT array_agg(a.attname::text ORDER BY key.ordinality)
        FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=key.attnum)
        = ARRAY['cohort_run_id','business_id','policy_version']::text[]
  LOOP
    EXECUTE format('ALTER TABLE sfp_outreach_eligibility DROP CONSTRAINT %I',old_constraint.conname);
  END LOOP;
END $legacy_unique$;