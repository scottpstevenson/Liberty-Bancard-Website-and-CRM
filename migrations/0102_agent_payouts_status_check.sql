-- Migration 0102: Add CHECK constraint enforcing valid payout status values.
-- Prevents direct DB writes (migrations, admin tooling) from persisting invalid statuses.
-- Idempotent: DROP first so a re-run (or a DB where the constraint already exists
-- from a prior manual migration) does not fail with 42710 "already exists".
ALTER TABLE agent_payouts
  DROP CONSTRAINT IF EXISTS agent_payouts_status_check;
ALTER TABLE agent_payouts
  ADD CONSTRAINT agent_payouts_status_check
  CHECK (status IN ('pending', 'approved', 'paid'));
