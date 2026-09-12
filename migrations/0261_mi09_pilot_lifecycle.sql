-- MI-09: Bounded Pilot Activation & CRO-08A Certification
-- Durable pilot lifecycle tables + operator pricing artifacts.
-- All `when` values above 1800000006900 (MI-08 high-water mark).

-- ── Composite pricing schedule snapshot ──────────────────────────────────────
-- Stores the operator-recorded composite of all provider pricing artifacts for
-- a ceremony. composite_hash = stableCro03RecipeHash(fullPriceSchedule) where
-- fullPriceSchedule is keyed by provider and contains all fields from the
-- individual mi09_pricing_artifacts rows. The certification gate verifies
-- priceScheduleHash against composite_hash so that one row represents the
-- entire multi-provider pricing evidence package.
CREATE TABLE mi09_pricing_schedule_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  composite_hash  TEXT NOT NULL UNIQUE,
  artifact_ids    JSONB NOT NULL,  -- array of mi09_pricing_artifacts.id UUIDs
  schedule_json   JSONB NOT NULL,  -- full pricing schedule at capture time
  captured_by     TEXT NOT NULL,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  notes           TEXT
);
CREATE INDEX mi09_pricing_schedule_snapshots_hash_idx
  ON mi09_pricing_schedule_snapshots (composite_hash, expires_at DESC);

-- ── Operator-verified pricing artifacts ─────────────────────────────────────
CREATE TABLE mi09_pricing_artifacts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key        TEXT NOT NULL,
  unit_type           TEXT NOT NULL,
  amount_micros       BIGINT NOT NULL CHECK (amount_micros >= 0),
  currency            TEXT NOT NULL DEFAULT 'USD',
  billing_semantics   TEXT NOT NULL,
  captured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  captured_by         TEXT NOT NULL,
  account_balance_units BIGINT,
  source_url          TEXT,
  artifact_version    INT NOT NULL DEFAULT 1,
  artifact_hash       TEXT NOT NULL,
  linked_policy_id    UUID,  -- FK to cro03c_activation_policies once policy exists
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX mi09_pricing_artifacts_provider_idx ON mi09_pricing_artifacts (provider_key, captured_at DESC);

-- ── Immutable pilot level definitions ────────────────────────────────────────
CREATE TABLE mi09_pilot_definitions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level                     INT NOT NULL CHECK (level IN (1, 2, 3)),
  county_scope              JSONB NOT NULL,          -- array of county_fips strings
  vertical_scope            JSONB NOT NULL,          -- array of vertical keys
  source_adapter_filter     JSONB NOT NULL,          -- array of adapter_key strings
  max_cohort_size           INT NOT NULL CHECK (max_cohort_size > 0),
  enrichment_recipe_version INT NOT NULL,
  paid_providers_allowed    JSONB NOT NULL,          -- {serper: bool, outscraper: bool, apollo: bool, openai: bool, zerobounce: bool}
  stop_condition_thresholds JSONB NOT NULL,          -- {conflict_pct: num, apollo_yield_pct: num, zb_unknown_pct: num, spend_cap_micros: num}
  pilot_definition_hash     TEXT NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                TEXT NOT NULL,
  UNIQUE (level, pilot_definition_hash)
);

-- ── Pilot run instances ───────────────────────────────────────────────────────
CREATE TABLE mi09_pilot_runs (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_definition_id         UUID NOT NULL REFERENCES mi09_pilot_definitions (id),
  release_sha                 TEXT NOT NULL,
  cro03c_selection_policy_version INT NOT NULL,
  cro03c_routing_policy_version   INT NOT NULL,
  cro03c_recipe_version           INT NOT NULL,
  cohort_frozen_hash          TEXT,
  cohort_frozen_at            TIMESTAMPTZ,
  started_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at                TIMESTAMPTZ,
  state                       TEXT NOT NULL DEFAULT 'draft'
                              CHECK (state IN ('draft','running','paused','completed','stopped')),
  stop_reason                 TEXT,
  advanced_by                 TEXT,
  advancement_receipt_id      UUID,  -- FK to mi09_pilot_advancement_receipts after advancement
  outbound_pause_epoch        BIGINT NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX mi09_pilot_runs_definition_idx ON mi09_pilot_runs (pilot_definition_id);
CREATE INDEX mi09_pilot_runs_state_idx ON mi09_pilot_runs (state);

-- ── Frozen cohort members ─────────────────────────────────────────────────────
CREATE TABLE mi09_pilot_cohort_members (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_run_id         UUID NOT NULL REFERENCES mi09_pilot_runs (id),
  canonical_business_id INTEGER NOT NULL REFERENCES businesses (id),
  included_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_adapter_key   TEXT NOT NULL,
  county_fips          TEXT,
  vertical             TEXT
);
CREATE UNIQUE INDEX mi09_pilot_cohort_members_unique ON mi09_pilot_cohort_members (pilot_run_id, canonical_business_id);
CREATE INDEX mi09_pilot_cohort_members_run_idx ON mi09_pilot_cohort_members (pilot_run_id);

-- ── Per-phase checkpoints ─────────────────────────────────────────────────────
CREATE TABLE mi09_pilot_checkpoints (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_run_id             UUID NOT NULL REFERENCES mi09_pilot_runs (id),
  phase                    TEXT NOT NULL CHECK (phase IN ('enrichment','validation','staging')),
  last_processed_business_id INTEGER,  -- references businesses.id (INTEGER serial)
  processed_count          INT NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pilot_run_id, phase)
);

-- ── Owner advancement receipts ────────────────────────────────────────────────
CREATE TABLE mi09_pilot_advancement_receipts (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_run_id              UUID NOT NULL REFERENCES mi09_pilot_runs (id),
  from_level                INT NOT NULL,
  to_level                  INT NOT NULL,
  approved_by               TEXT NOT NULL,
  approved_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pricing_artifact_id       UUID REFERENCES mi09_pricing_artifacts (id),
  stop_conditions_checked   JSONB NOT NULL,
  stop_conditions_passed    BOOLEAN NOT NULL,
  idempotency_key           TEXT NOT NULL UNIQUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX mi09_pilot_advancement_receipts_run_idx ON mi09_pilot_advancement_receipts (pilot_run_id);

-- ── Links from pilot run to generated artifacts ───────────────────────────────
CREATE TABLE mi09_pilot_effect_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_run_id  UUID NOT NULL REFERENCES mi09_pilot_runs (id),
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('cro03c_command','generation','staging_receipt','master_lead')),
  entity_id     UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX mi09_pilot_effect_links_run_idx ON mi09_pilot_effect_links (pilot_run_id, entity_type);
CREATE UNIQUE INDEX mi09_pilot_effect_links_unique ON mi09_pilot_effect_links (pilot_run_id, entity_type, entity_id);

-- ── Pilot reconciliation reports (durable before Drive publish) ───────────────
CREATE TABLE mi09_pilot_reconciliation_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_run_id     UUID NOT NULL REFERENCES mi09_pilot_runs (id),
  report_data      JSONB NOT NULL,
  drive_doc_id     TEXT,
  drive_published_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX mi09_pilot_reports_run_idx ON mi09_pilot_reconciliation_reports (pilot_run_id);
