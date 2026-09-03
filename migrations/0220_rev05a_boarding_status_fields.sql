-- REV-05A: Boarding Status & Program Fields
-- Add processorProgram to deals for program-specific lifecycle routing.
-- boardingStatus remains text (not enum) to allow zero-downtime additions;
-- application-layer validation enforces the typed set.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS processor_program TEXT,
  -- 'traditional' | 'payfac' — populated from activation snapshot at submission
  ADD COLUMN IF NOT EXISTS boarding_ambiguous_at TIMESTAMPTZ,
  -- set when a submission result is ambiguous (timeout / no provider ID)
  ADD COLUMN IF NOT EXISTS boarding_reconciled_at TIMESTAMPTZ;
  -- set when ambiguous result is reconciled by operator or reconciliation poll

-- Inert Payarc webhook log table:
-- raw payloads are stored here; canonical state is NOT mutated until
-- Payarc provides fixture + signature spec and PAYARC_WEBHOOK_VERIFIED=true.
-- REV-05A §8: raw_headers intentionally omitted — headers can contain
-- signatures, cookies, or bearer tokens that must not be stored until
-- Payarc provides the signing spec and authorized header allowlist.
CREATE TABLE IF NOT EXISTS payarc_webhook_events (
  id           SERIAL PRIMARY KEY,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_payload  JSONB,
  notes        TEXT DEFAULT 'non-authoritative — awaiting Payarc fixture verification'
);

CREATE INDEX IF NOT EXISTS payarc_webhook_events_received_at_idx
  ON payarc_webhook_events (received_at DESC);
