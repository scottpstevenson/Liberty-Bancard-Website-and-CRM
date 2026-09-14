-- Migration 0265: contacts NOT NULL convergence (Task #1958)
--
-- Task #1955's bounded schema-drift check found that email_status,
-- is_decision_maker, decision_maker_confidence, and management_type are
-- declared .notNull() in shared/schema.ts but were added to the live table
-- via migration 0029 without a NOT NULL constraint. All four columns carry
-- a DEFAULT and have zero NULL rows in production (verified 162,228 rows,
-- 0 nulls across all four columns), so this tightens the live constraint
-- to match the schema.ts contract rather than relaxing the type.
ALTER TABLE contacts ALTER COLUMN email_status SET NOT NULL;
ALTER TABLE contacts ALTER COLUMN is_decision_maker SET NOT NULL;
ALTER TABLE contacts ALTER COLUMN decision_maker_confidence SET NOT NULL;
ALTER TABLE contacts ALTER COLUMN management_type SET NOT NULL;
