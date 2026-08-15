-- Migration 0133: Outbound Pause Control Authority
-- Creates the singleton outbound_pause_control table and outbound_pause_audit
-- audit trail. These tables are the atomic source of truth for global outbound
-- pause state and epoch, replacing the non-atomic Promise.all writes to
-- system_settings.
--
-- Atomicity proof:
--   outbound_pause_control and outbound_pause_audit are always written in the
--   SAME transaction by OutboundControlService. A transaction-level advisory
--   lock serializes concurrent mutations. If a fault is injected after the
--   control row write but before the audit write, both roll back together —
--   there is no committed state without a corresponding audit entry.

-- Singleton control table: exactly one row (enforced by application logic).
-- The epoch is a monotonically increasing bigint stamped on every mutation.
CREATE TABLE IF NOT EXISTS outbound_pause_control (
  id           SERIAL PRIMARY KEY,
  state        TEXT    NOT NULL CHECK (state IN ('paused', 'activating', 'unpaused')),
  reason       TEXT,
  epoch        BIGINT  NOT NULL DEFAULT 1,
  actor        TEXT,
  idempotency_key TEXT,
  committed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique index enforces singleton semantics (at most one row).
CREATE UNIQUE INDEX IF NOT EXISTS outbound_pause_control_singleton
  ON outbound_pause_control ((1));

-- Immutable audit trail for all pause mutations.
-- change_type:
--   state-transition  — state value changed
--   metadata-revision — same state, reason/actor changed, new epoch
--   idempotent-return — same idempotency key, no write occurred
CREATE TABLE IF NOT EXISTS outbound_pause_audit (
  id             SERIAL PRIMARY KEY,
  epoch          BIGINT  NOT NULL,
  change_type    TEXT    NOT NULL CHECK (change_type IN ('state-transition', 'metadata-revision', 'idempotent-return')),
  from_state     TEXT    NOT NULL,
  to_state       TEXT    NOT NULL,
  actor          TEXT,
  correlation_id TEXT,
  reason         TEXT,
  details        JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS outbound_pause_audit_epoch_idx
  ON outbound_pause_audit (epoch);

CREATE INDEX IF NOT EXISTS outbound_pause_audit_created_at_idx
  ON outbound_pause_audit (created_at);
