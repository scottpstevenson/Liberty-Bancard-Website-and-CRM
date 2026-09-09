-- Migration 0243: Sales Rep Operations Readiness Receipts
-- Stores durable, immutable gate results per exact release SHA + config + population fingerprint.
-- Pilot preview records store per-candidate verdicts without PII.

CREATE TABLE IF NOT EXISTS sales_rep_ops_readiness_runs (
  id                    SERIAL PRIMARY KEY,
  run_id                TEXT NOT NULL UNIQUE,          -- deterministic: SHA-256(release_sha||config_fingerprint||population_fingerprint)
  release_sha           TEXT NOT NULL,                 -- git SHA at run time
  migration_head        TEXT NOT NULL,                 -- last migration tag at run time
  config_fingerprint    TEXT NOT NULL,                 -- hash of flag states + policy versions
  population_fingerprint TEXT NOT NULL,               -- hash of pilot rep IDs + contact/location ID set
  status                TEXT NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running','complete','failed')),
  gate_results          JSONB NOT NULL DEFAULT '[]',  -- [{gate, status, reason_code, detail}]; never PII
  aggregate_verdict     TEXT,                          -- PASS | FAIL | BLOCKED_EXTERNAL
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  triggered_by_user_id  VARCHAR REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS srro_release_sha_idx ON sales_rep_ops_readiness_runs (release_sha);
CREATE INDEX IF NOT EXISTS srro_status_idx ON sales_rep_ops_readiness_runs (status);

-- Pilot preview records (preview-only, no production writes)
CREATE TABLE IF NOT EXISTS sales_rep_pilot_previews (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  readiness_run_id      INTEGER REFERENCES sales_rep_ops_readiness_runs(id),
  preview_fingerprint   TEXT NOT NULL UNIQUE,
  expires_at            TIMESTAMPTZ NOT NULL,
  rep_user_ids          TEXT[] NOT NULL,
  candidate_contact_ids INTEGER[] NOT NULL,
  candidate_location_ids INTEGER[] NOT NULL,
  policy_version        TEXT NOT NULL,
  verdict_summary       JSONB NOT NULL,               -- aggregate counts only; no PII
  created_by_user_id    VARCHAR REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS srpp_expires_idx ON sales_rep_pilot_previews (expires_at);
