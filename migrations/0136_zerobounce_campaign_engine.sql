-- Migration 0136: ZeroBounce durable batch campaign engine (task 1540B)
-- Replaces the setImmediate fire-and-forget batch flow with schema-backed
-- campaign / run / attempt tracking driven by a BullMQ worker.
--
-- Invariants enforced here:
--   * one attempt row per (campaign_id, contact_id) — the atomic contact claim
--   * at most one run in state 'running' per campaign (partial unique index)

CREATE TABLE IF NOT EXISTS zerobounce_campaigns (
  id                     VARCHAR     PRIMARY KEY DEFAULT gen_random_uuid(),
  filter_definition      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  initial_eligible_total INTEGER     NOT NULL DEFAULT 0,
  status                 TEXT        NOT NULL DEFAULT 'active', -- active | completed | cancelled
  created_by             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at           TIMESTAMPTZ
);

-- Only one active campaign at a time (task scope: single-campaign management)
CREATE UNIQUE INDEX IF NOT EXISTS zb_campaigns_one_active_idx
  ON zerobounce_campaigns ((true)) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS zerobounce_runs (
  id                VARCHAR     PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       VARCHAR     NOT NULL REFERENCES zerobounce_campaigns(id) ON DELETE CASCADE,
  bull_job_id       TEXT,
  -- running | completed | budget_stopped | cancelled | interrupted | error
  state             TEXT        NOT NULL DEFAULT 'running',
  stop_reason       TEXT,
  cancel_requested  BOOLEAN     NOT NULL DEFAULT FALSE,
  contact_limit     INTEGER     NOT NULL DEFAULT 100,
  claimed_count     INTEGER     NOT NULL DEFAULT 0,
  completed_count   INTEGER     NOT NULL DEFAULT 0,
  retryable_count   INTEGER     NOT NULL DEFAULT 0,
  skipped_count     INTEGER     NOT NULL DEFAULT 0,
  error_count       INTEGER     NOT NULL DEFAULT 0,
  valid_count       INTEGER     NOT NULL DEFAULT 0,
  blocked_count     INTEGER     NOT NULL DEFAULT 0,
  last_heartbeat_at TIMESTAMPTZ,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Active-run enforcement: at most ONE running run per campaign, enforced by
-- the database (not by a read-then-insert race).
CREATE UNIQUE INDEX IF NOT EXISTS zb_runs_one_running_per_campaign_idx
  ON zerobounce_runs (campaign_id) WHERE state = 'running';

CREATE INDEX IF NOT EXISTS zb_runs_campaign_idx ON zerobounce_runs (campaign_id, created_at);

CREATE TABLE IF NOT EXISTS zerobounce_attempts (
  id              BIGSERIAL   PRIMARY KEY,
  campaign_id     VARCHAR     NOT NULL REFERENCES zerobounce_campaigns(id) ON DELETE CASCADE,
  run_id          VARCHAR     NOT NULL REFERENCES zerobounce_runs(id) ON DELETE CASCADE,
  contact_id      INTEGER     NOT NULL,
  -- pending | completed | retryable_failed | skipped
  outcome         TEXT        NOT NULL DEFAULT 'pending',
  provider_status TEXT,
  sub_status      TEXT,
  -- none | reserved. NOTE: 'reserved' means a LOCAL daily-cap credit was
  -- claimed; it is NOT confirmation of provider-side billing.
  credit_state    TEXT        NOT NULL DEFAULT 'none',
  retryable       BOOLEAN     NOT NULL DEFAULT FALSE,
  error_code      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- THE atomic per-contact claim: a contact can be claimed at most once per
-- campaign. Claims are made with INSERT ... ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS zb_attempts_campaign_contact_idx
  ON zerobounce_attempts (campaign_id, contact_id);

CREATE INDEX IF NOT EXISTS zb_attempts_run_idx ON zerobounce_attempts (run_id);
