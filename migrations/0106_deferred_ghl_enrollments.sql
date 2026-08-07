-- Create a durable, crash-safe table for deferred GHL workflow enrollments.
-- Replaces the previous system_settings JSON blob approach:
--   • Atomic upsert / update via ON CONFLICT — no read-modify-write race
--   • Survives process restarts and autoscale instance recycling
--   • Supports SELECT … FOR UPDATE SKIP LOCKED for concurrent-safe batches
--   • Enables per-row exponential back-off without in-process state

CREATE TABLE IF NOT EXISTS deferred_ghl_enrollments (
  id              TEXT        PRIMARY KEY,            -- "{ghlContactId}::{workflowKey}"
  ghl_contact_id  TEXT        NOT NULL,
  workflow_key    TEXT        NOT NULL,
  metadata        JSONB,
  enqueued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retry_count     INTEGER     NOT NULL DEFAULT 0,
  next_retry_at   TIMESTAMPTZ NOT NULL,
  last_error      TEXT        NOT NULL DEFAULT '',
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'failed')),
  failed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS deferred_ghl_pending_retry_idx
  ON deferred_ghl_enrollments (next_retry_at)
  WHERE status = 'pending';
