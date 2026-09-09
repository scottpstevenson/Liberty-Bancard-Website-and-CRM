-- Migration 0236: Rep Identity, Canonical Queue & Cold-Call Ops Readiness
-- Adds:
--   1. Partial unique index on agents(user_id) WHERE status = 'active' — blocks duplicate active bindings
--   2. Non-unique index on calendar_events(owner_id) — read-path performance
--   3. CHECK constraint on calendar_events(owner_id) — non-null value must have length > 0
--   4. idempotency_key column + unique index on call_logs — dedup log-activity requests
--
-- Authority note: calendar_events.owner_id (TEXT, nullable) is hereby designated as the canonical
-- authenticated-user owner field, storing users.id.  All new server-side INSERT paths set this
-- from req.user.id (never from request body).  Existing null rows are treated as unowned.

-- 1. Partial unique index on agents(user_id) for active agents
CREATE UNIQUE INDEX IF NOT EXISTS agents_active_user_id_unique
  ON agents (user_id)
  WHERE status = 'active';

-- 2. Non-unique index on calendar_events(owner_id)
CREATE INDEX IF NOT EXISTS calendar_events_owner_id_idx
  ON calendar_events (owner_id);

-- 3. CHECK constraint: owner_id, when non-null, must be non-empty
ALTER TABLE calendar_events
  ADD CONSTRAINT calendar_events_owner_id_nonempty
  CHECK (owner_id IS NULL OR length(owner_id) > 0);

-- 4. idempotency_key column on call_logs for deduplication at log-activity endpoint
ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS call_logs_idempotency_key_unique
  ON call_logs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
