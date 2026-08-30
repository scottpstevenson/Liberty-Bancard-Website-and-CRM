-- CRO-03B may create a durable winning-email intent, but CRO-03C must
-- explicitly authorize execution before queueing, provider accounting, or I/O.
ALTER TABLE validation_intents
  ADD COLUMN IF NOT EXISTS execution_authorized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_authority TEXT;

DO $$ BEGIN
  ALTER TABLE validation_intents
    ADD CONSTRAINT validation_intents_execution_authority_chk CHECK (
      (execution_authorized_at IS NULL AND execution_authority IS NULL)
      OR (execution_authorized_at IS NOT NULL AND execution_authority='cro03c_activation')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;