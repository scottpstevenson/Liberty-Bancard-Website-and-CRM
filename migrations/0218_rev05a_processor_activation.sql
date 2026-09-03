-- REV-05A: Processor Activation Snapshots
-- Owner must confirm program, entitlements, and authorized endpoints before
-- transport activates. Transport is fail-closed until a row with
-- status='owner_confirmed' or higher exists.

CREATE TABLE IF NOT EXISTS processor_activation_snapshots (
  id                      SERIAL PRIMARY KEY,
  processor_name          TEXT NOT NULL,             -- e.g. 'payarc', 'nmi'
  processor_program       TEXT NOT NULL,             -- 'traditional' | 'payfac'
  sandbox_entitlement     BOOLEAN NOT NULL DEFAULT FALSE,
  production_entitlement  BOOLEAN NOT NULL DEFAULT FALSE,
  authorized_base_url     TEXT,
  supported_operations    JSONB NOT NULL DEFAULT '[]',
  owner_confirmed_at      TIMESTAMPTZ,
  owner_confirmed_by      TEXT,
  status                  TEXT NOT NULL DEFAULT 'pending',
    -- pending | owner_confirmed | sandbox_verified | production_authorized
    -- | expired_or_drifted | held
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS processor_activation_snapshots_processor_name_idx
  ON processor_activation_snapshots (processor_name);

CREATE INDEX IF NOT EXISTS processor_activation_snapshots_status_idx
  ON processor_activation_snapshots (status);
