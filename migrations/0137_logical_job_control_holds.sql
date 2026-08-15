-- Migration 0137: Logical Job Control Holds + Reconciliation State (#1532)
-- Implements reason-scoped hold ledger for outbound queue backpressure.
-- Depends on: 0133 (outbound_pause_control), 0134 (outbound_inflight_sends)

-- ── Hold ledger ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS logical_job_control_holds (
  hold_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_job_key TEXT NOT NULL,
  reason_code     TEXT NOT NULL,   -- global_outbound | manual_operator | maintenance | incident | automation_kill_switch | channel_pause
  source_type     TEXT NOT NULL,   -- system | operator | automation | channel
  source_key      TEXT NOT NULL,   -- owner identity: actor email, incident ID, automation key, channel key
  source_epoch    BIGINT,          -- epoch from originating pause authority mutation (staleness guard)
  ledger_epoch    BIGINT NOT NULL, -- monotonic coordinator ordering (advisory-lock-serialized)
  active          BOOLEAN NOT NULL DEFAULT true,
  activated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  actor           TEXT,
  correlation_id  TEXT,
  metadata        JSONB,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial unique index: two holds with the same (key, reason, source_key) cannot
-- both be active simultaneously. Different source_keys (owners) coexist independently.
CREATE UNIQUE INDEX IF NOT EXISTS logical_job_holds_active_owner_idx
  ON logical_job_control_holds (logical_job_key, reason_code, source_key)
  WHERE active = true;

-- Secondary indexes for fast queries
CREATE INDEX IF NOT EXISTS logical_job_holds_active_idx
  ON logical_job_control_holds (logical_job_key)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS logical_job_holds_expires_idx
  ON logical_job_control_holds (expires_at)
  WHERE active = true AND expires_at IS NOT NULL;

-- ── Hold events audit log (immutable) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS logical_job_hold_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hold_id         UUID NOT NULL,
  event_type      TEXT NOT NULL,   -- activated | released | expired | superseded
  logical_job_key TEXT NOT NULL,
  reason_code     TEXT NOT NULL,
  source_key      TEXT NOT NULL,
  ledger_epoch    BIGINT NOT NULL,
  actor           TEXT,
  correlation_id  TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hold_events_hold_id_idx ON logical_job_hold_events (hold_id);
CREATE INDEX IF NOT EXISTS hold_events_created_at_idx ON logical_job_hold_events (created_at DESC);
CREATE INDEX IF NOT EXISTS hold_events_logical_job_key_idx ON logical_job_hold_events (logical_job_key, created_at DESC);

-- ── Queue reconciliation state ────────────────────────────────────────────────
-- Tracks desired vs. observed BullMQ queue pause/resume state per queue.
-- Committed before Redis actuation; updated after isPaused() readback.
-- 'applied' only when readback matches desired at the current epoch.
CREATE TABLE IF NOT EXISTS queue_reconciliation_state (
  physical_queue  TEXT PRIMARY KEY,
  desired_state   TEXT,            -- 'paused' | 'running'
  desired_epoch   BIGINT,
  observed_state  TEXT,            -- 'paused' | 'running' | null (unknown)
  observed_epoch  BIGINT,
  reconciled_at   TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_error      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Post-enrichment enrollment intents outbox ─────────────────────────────────
-- When post-enrichment enrollment is held, the intent is written here rather
-- than permanently lost. Processed when the hold clears.
CREATE TABLE IF NOT EXISTS post_enrichment_enrollment_intents (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deal_id         INTEGER NOT NULL,
  contact_id      INTEGER NOT NULL,
  entity_id       INTEGER,
  idempotency_key TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | processing | completed | failed | cancelled
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  eligible_after  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pe_intents_pending_idx
  ON post_enrichment_enrollment_intents (status, eligible_after)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS pe_intents_deal_idx ON post_enrichment_enrollment_intents (deal_id);

-- ── Backlog release runs ──────────────────────────────────────────────────────
-- Durable record of admin-triggered staged backlog release operations.
-- Each release processes bounded chunks with abort capability between chunks.
CREATE TABLE IF NOT EXISTS backlog_release_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           TEXT NOT NULL,   -- logical_job_key or '*' for all
  limits          JSONB NOT NULL,  -- { chunkSize, ratePerMin, maxTotal }
  actor           TEXT NOT NULL,
  stage           TEXT NOT NULL DEFAULT 'pending', -- pending | running | completed | aborted | failed
  cursor          JSONB,           -- resume cursor for chunked processing
  abort_requested BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  aborted_at      TIMESTAMPTZ,
  stats           JSONB
);
