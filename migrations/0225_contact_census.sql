-- Migration 0225: Contact Census & Deterministic Grouping tables (#1817)
-- contact_census_runs: immutable snapshot run records
-- contact_census_members: per-contact lane + dimension results (no raw PII)

CREATE TABLE IF NOT EXISTS contact_census_runs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_type          text NOT NULL DEFAULT 'full',
  environment_label      text NOT NULL CHECK (environment_label IN (
                           'development_preview',
                           'production_readonly_preview',
                           'frozen_production_snapshot'
                         )),
  selector_hash          text NOT NULL,
  selector_params        jsonb NOT NULL DEFAULT '{}',
  rules_version          text NOT NULL,
  release_sha            text NOT NULL,
  db_identity_token      text NOT NULL,
  as_of                  timestamptz NOT NULL DEFAULT now(),
  requested_by           text NOT NULL,
  status                 text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','running','paused','completed','failed','cancelled')),
  pause_reason           text,
  cursor_contact_id      integer,
  denominator_at_start   integer,
  total_processed        integer,
  total_excluded         integer,
  lane_counts            jsonb,
  dimension_counts       jsonb,
  phone_quality_counts   jsonb,
  query_duration_ms      integer,
  pool_metrics_before    jsonb,
  pool_metrics_during    jsonb,
  pool_metrics_after     jsonb,
  mutation_proof_before  jsonb,
  mutation_proof_after   jsonb,
  provider_call_count    integer NOT NULL DEFAULT 0,
  completed_at           timestamptz,
  failed_at              timestamptz,
  failure_reason         text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS census_runs_status_idx ON contact_census_runs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS census_runs_created_at_idx ON contact_census_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS contact_census_members (
  id                              bigserial PRIMARY KEY,
  run_id                          uuid NOT NULL REFERENCES contact_census_runs(id) ON DELETE CASCADE,
  contact_id                      integer NOT NULL,
  selection_hash                  text NOT NULL,
  -- D1–D10 dimensions
  record_class                    text NOT NULL,
  identity_state                  text NOT NULL,
  business_materialization_state  text NOT NULL,
  contactability_state            text NOT NULL,
  vertical_state                  text NOT NULL,
  validation_state                text NOT NULL,
  compliance_state                text NOT NULL,
  evidence_state                  text NOT NULL,
  enrichment_state                text NOT NULL,
  phone_quality_state             text NOT NULL,
  -- Primary lane
  primary_lane                    text NOT NULL,
  gap_codes                       text[] NOT NULL DEFAULT '{}',
  -- Non-PII boolean context
  has_business_id                 boolean NOT NULL DEFAULT false,
  has_company_name                boolean NOT NULL DEFAULT false,
  has_email                       boolean NOT NULL DEFAULT false,
  has_phone                       boolean NOT NULL DEFAULT false,
  has_vertical                    boolean NOT NULL DEFAULT false,
  readiness_score                 integer,
  lead_score                      integer,
  has_ghl_link                    boolean NOT NULL DEFAULT false,
  has_deal                        boolean NOT NULL DEFAULT false,
  lead_source                     text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT census_members_run_contact_unique UNIQUE (run_id, contact_id)
);

CREATE INDEX IF NOT EXISTS census_members_run_lane_idx
  ON contact_census_members (run_id, primary_lane, contact_id);
CREATE INDEX IF NOT EXISTS census_members_run_d3_idx
  ON contact_census_members (run_id, business_materialization_state);
CREATE INDEX IF NOT EXISTS census_members_run_record_class_idx
  ON contact_census_members (run_id, record_class);
