-- 0291 (Task #2001 corrective patch, PM-06 / PM-07):
--
-- PM-07: migration 0289 was previously edited in place (commit 735dbba),
-- weakening sfp_outreach_policy_control's singleton guarantee by dropping
-- CHECK(singleton). 0289 has been restored byte-for-byte to its originally
-- merged content. This forward migration re-asserts the guarantee for any
-- environment that already applied the weakened form, and removes any
-- singleton=false row that may have been inserted while the guarantee was
-- absent (none are expected — this is defense in depth).
DELETE FROM sfp_outreach_policy_control WHERE singleton = FALSE;

ALTER TABLE sfp_outreach_policy_control
  DROP CONSTRAINT IF EXISTS sfp_outreach_policy_control_singleton_check;
ALTER TABLE sfp_outreach_policy_control
  ADD CONSTRAINT sfp_outreach_policy_control_singleton_check CHECK (singleton);

-- PM-06: recurring campaign-staging must default OFF. Migration 0290
-- backfilled schedule_config.campaignStaging=10 into every existing program,
-- which — combined with an already-active program under the "full"
-- background profile — could activate the (at the time) broken recurring
-- staging worker without a deliberate operator decision. Flip both the
-- column default and every previously-backfilled program back to 0. An
-- operator must explicitly opt a program into recurring campaign staging
-- after package verification and a one-row canary.
ALTER TABLE sfp_programs
  ALTER COLUMN schedule_config SET DEFAULT '{"freeBatch":25,"paidBatch":10,"validationBatch":25,"campaignStaging":0}'::jsonb;

UPDATE sfp_programs
   SET schedule_config = schedule_config || '{"campaignStaging":0}'::jsonb
 WHERE (schedule_config ->> 'campaignStaging')::int = 10;
