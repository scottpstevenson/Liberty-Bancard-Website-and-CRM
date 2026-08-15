-- Migration 0134: outbound_inflight_sends
-- Cross-process in-flight send registry.
-- Rows are inserted on registerInflight() and deleted on deregisterInflight().
-- The activation barrier queries this table (not just a process-local Set) so
-- a drain in process A waits for sends authorized in process B.
-- TTL (expires_at) prevents leaked rows from stalling future pauses.

CREATE TABLE IF NOT EXISTS outbound_inflight_sends (
  token_id       TEXT        PRIMARY KEY,
  process_pid    INTEGER     NOT NULL,
  granted_epoch  BIGINT      NOT NULL,
  registered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '60 seconds')
);

CREATE INDEX IF NOT EXISTS outbound_inflight_expires_idx
  ON outbound_inflight_sends (expires_at);
