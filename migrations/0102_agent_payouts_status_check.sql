-- Migration 0102: Add CHECK constraint enforcing valid payout status values.
-- Prevents direct DB writes (migrations, admin tooling) from persisting invalid statuses.
ALTER TABLE agent_payouts
  ADD CONSTRAINT agent_payouts_status_check
  CHECK (status IN ('pending', 'approved', 'paid'));
