-- Partner program repair: validate the two introduction check constraints that 0385 added NOT VALID.
-- Publish compares the development and production databases and generates the production SQL from the development
-- catalog. For a check constraint that is NOT VALID it generated malformed SQL (an extra closing parenthesis and a
-- trailing NOT VALID inside the CHECK), and the whole Publish stopped at "Migrations failed validation", so the 0385 table,
-- columns, indexes and checks never reached production. A validated check is generated correctly (the 0384 checks and the
-- new review-event table check already round-trip). Validation only reads rows; it changes no data and sends nothing.
-- partner_introductions holds 0 rows in every environment that has been read (development and production), and the rows
-- that 0385's code writes satisfy both rules, so a failure here would mean a real rule violation and is left to fail loudly.
-- Idempotent: a constraint that is already validated (or absent) is skipped.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.partner_introductions'::regclass
             AND conname = 'partner_introductions_completion_chk' AND NOT convalidated) THEN
    ALTER TABLE partner_introductions VALIDATE CONSTRAINT partner_introductions_completion_chk;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.partner_introductions'::regclass
             AND conname = 'partner_introductions_decision_chk' AND NOT convalidated) THEN
    ALTER TABLE partner_introductions VALIDATE CONSTRAINT partner_introductions_decision_chk;
  END IF;
END $$;
