-- Migration 0143: Make partial EIN fingerprint index UNIQUE
--
-- Drops the non-unique partial index added in 0142 and replaces it with a
-- UNIQUE partial index scoped to eligible finalized states. This prevents
-- two concurrent finalize calls with the same normalized EIN from both
-- succeeding. Legacy rows (ein_fingerprint IS NULL) remain excluded; they
-- never participate in equality/dedup collisions. No backfill required.
--
-- Concurrent finalize with duplicate EIN will receive a Postgres error code
-- 23505 (unique_violation); the service maps this to duplicate_ein ConflictError.

-- Drop the non-unique index from migration 0142 (if it exists under old name).
DROP INDEX IF EXISTS merchant_applications_ein_fingerprint_idx;

-- Create the unique partial index.
CREATE UNIQUE INDEX IF NOT EXISTS merchant_applications_ein_fingerprint_unique_idx
  ON merchant_applications (ein_fingerprint)
  WHERE ein_fingerprint IS NOT NULL
    AND status IN ('submitted', 'under_review', 'approved', 'declined', 'withdrawn');

-- Also add dead_letter status to the outbox worker status enum values.
-- The outbox table uses a plain text column, so no enum migration needed.
-- The application code already writes 'dead_letter' as a valid status value.

-- ── deals: boarding idempotency key ────────────────────────────────────────
ALTER TABLE deals ADD COLUMN IF NOT EXISTS boarding_idempotency_key text;

-- ── deal_boarding_outbox: durable processor_submit effects ─────────────────
CREATE TABLE IF NOT EXISTS deal_boarding_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id integer NOT NULL REFERENCES deals(id),
  application_id integer,
  event_type text NOT NULL DEFAULT 'processor_submit',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  processor_name text,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  available_at timestamp DEFAULT now(),
  locked_at timestamp,
  processed_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS deal_boarding_outbox_idempotency_uidx
  ON deal_boarding_outbox (idempotency_key);

CREATE INDEX IF NOT EXISTS deal_boarding_outbox_dispatch_idx
  ON deal_boarding_outbox (status, available_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS deal_boarding_outbox_deal_idx
  ON deal_boarding_outbox (deal_id);
