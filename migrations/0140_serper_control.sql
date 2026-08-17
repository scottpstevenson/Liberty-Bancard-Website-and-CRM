-- Migration 0140: Serper Canonical Gateway control table (#1600)
-- Singleton row (id=1) holding global enable flag, circuit breaker state,
-- billing-window accounting, and lifetime counters for all Serper API calls.

CREATE TABLE IF NOT EXISTS serper_control (
  id                          INTEGER PRIMARY KEY CHECK (id = 1),
  enabled                     BOOLEAN NOT NULL DEFAULT false,
  state                       TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed', 'open', 'half_open')),
  consecutive_failures        INTEGER NOT NULL DEFAULT 0,
  opened_at                   TIMESTAMPTZ,
  reason_code                 TEXT,
  last_failure_at             TIMESTAMPTZ,
  last_success_at             TIMESTAMPTZ,
  half_open_probe_claimed_at  TIMESTAMPTZ,
  policy_version              INTEGER NOT NULL DEFAULT 1,
  lifetime_calls              BIGINT NOT NULL DEFAULT 0,
  lifetime_successes          BIGINT NOT NULL DEFAULT 0,
  lifetime_failures           BIGINT NOT NULL DEFAULT 0,
  window_calls                INTEGER NOT NULL DEFAULT 0,
  window_successes            INTEGER NOT NULL DEFAULT 0,
  window_failures             INTEGER NOT NULL DEFAULT 0,
  window_started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_ends_at              TIMESTAMPTZ NOT NULL,
  local_budget                INTEGER NOT NULL DEFAULT 50000,
  provider_balance            INTEGER,
  yield_websites              BIGINT NOT NULL DEFAULT 0,
  yield_emails                BIGINT NOT NULL DEFAULT 0,
  yield_phones                BIGINT NOT NULL DEFAULT 0,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the singleton with enabled=false (fail-closed deploy default).
INSERT INTO serper_control (
  id, enabled, state, consecutive_failures, policy_version,
  window_calls, window_successes, window_failures,
  window_started_at, window_ends_at
)
VALUES (
  1, false, 'closed', 0, 1,
  0, 0, 0,
  now(), date_trunc('month', now()) + interval '1 month'
)
ON CONFLICT (id) DO NOTHING;
