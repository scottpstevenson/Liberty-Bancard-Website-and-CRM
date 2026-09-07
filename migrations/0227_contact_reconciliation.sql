-- Contact Reconciliation tables
-- Mirrors the contact_census_runs / contact_census_members pattern.
-- Provides: per-run reconciliation classification, org-aggregation candidates,
-- duplicate-cluster model (N rows/cluster, never N×(N−1)/2 pairs),
-- normalization proposals with CAS contact_updated_at guard, and reversal ledger.
--
-- Single active run enforced by census_recon_one_active partial unique index.
-- All approval writes use direct db.update (no GHL projection insert).

-- ── 1. Reconciliation runs ─────────────────────────────────────────────────
CREATE TABLE contact_reconciliation_runs (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_census_run_id       UUID        NOT NULL,
  environment_label          TEXT        NOT NULL,
  rules_version              TEXT        NOT NULL DEFAULT '1.0.0',
  requested_by               TEXT        NOT NULL,
  status                     TEXT        NOT NULL DEFAULT 'running'
                               CHECK (status IN ('pending','running','paused','completed','failed','cancelled')),
  pause_reason               TEXT,
  failure_reason             TEXT,
  lease_owner                TEXT,
  lease_expires_at           TIMESTAMPTZ,
  max_contact_id_at_start    BIGINT      NOT NULL DEFAULT 0,
  denominator_at_start       BIGINT      NOT NULL DEFAULT 0,
  total_processed            BIGINT      NOT NULL DEFAULT 0,
  total_proposed             BIGINT      NOT NULL DEFAULT 0,
  total_org_candidates       BIGINT      NOT NULL DEFAULT 0,
  total_clusters             BIGINT      NOT NULL DEFAULT 0,
  cursor_contact_census_member_id BIGINT NOT NULL DEFAULT 0,
  lane_counts                JSONB,
  dimension_counts           JSONB,
  completed_at               TIMESTAMPTZ,
  failed_at                  TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one run in status pending/running at a time across all instances.
CREATE UNIQUE INDEX census_recon_one_active
  ON contact_reconciliation_runs (status)
  WHERE status IN ('pending','running');

-- ── 2. Reconciliation members (classified per contact per run) ────────────
CREATE TABLE contact_reconciliation_members (
  id                            BIGSERIAL   PRIMARY KEY,
  run_id                        UUID        NOT NULL REFERENCES contact_reconciliation_runs(id) ON DELETE CASCADE,
  contact_id                    INT         NOT NULL,
  census_member_id              BIGINT,
  census_lane                   TEXT,

  -- R1–R12 dimensions
  name_quality_state            TEXT        NOT NULL,
  email_quality_state           TEXT        NOT NULL,
  phone_quality_state           TEXT        NOT NULL,
  company_quality_state         TEXT        NOT NULL,
  vertical_state                TEXT        NOT NULL,
  duplicate_risk_state          TEXT        NOT NULL,
  business_gap_state            TEXT        NOT NULL,
  org_aggregation_state         TEXT        NOT NULL,
  normalization_opportunity     TEXT        NOT NULL,
  cluster_candidacy_state       TEXT        NOT NULL,
  overall_action_state          TEXT        NOT NULL,
  primary_lane                  TEXT        NOT NULL,
  gap_codes                     TEXT[]      NOT NULL DEFAULT '{}',

  -- Non-PII flags
  has_business_id               BOOLEAN     NOT NULL DEFAULT false,
  has_company_name              BOOLEAN     NOT NULL DEFAULT false,
  has_email                     BOOLEAN     NOT NULL DEFAULT false,
  has_phone                     BOOLEAN     NOT NULL DEFAULT false,
  has_vertical                  BOOLEAN     NOT NULL DEFAULT false,
  has_first_name                BOOLEAN     NOT NULL DEFAULT false,
  has_last_name                 BOOLEAN     NOT NULL DEFAULT false,

  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, contact_id)
);

CREATE INDEX recon_members_run_lane
  ON contact_reconciliation_members(run_id, primary_lane);

-- ── 3. Organization aggregation candidates ────────────────────────────────
-- One row per unique normalized company name per run.
-- Member count is always computed via COUNT(*) on the join table.
CREATE TABLE contact_organization_candidates (
  id                BIGSERIAL   PRIMARY KEY,
  run_id            UUID        NOT NULL REFERENCES contact_reconciliation_runs(id) ON DELETE CASCADE,
  normalized_name   TEXT        NOT NULL,
  raw_sample_name   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, normalized_name)
);

CREATE TABLE contact_organization_candidate_members (
  id             BIGSERIAL   PRIMARY KEY,
  candidate_id   BIGINT      NOT NULL REFERENCES contact_organization_candidates(id) ON DELETE CASCADE,
  run_id         UUID        NOT NULL,
  contact_id     INT         NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, contact_id)
);

CREATE INDEX org_candidate_members_run
  ON contact_organization_candidate_members(run_id, contact_id);

-- ── 4. Duplicate clusters (N rows / cluster, never pairwise) ─────────────
CREATE TABLE contact_duplicate_clusters (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID        NOT NULL REFERENCES contact_reconciliation_runs(id) ON DELETE CASCADE,
  cluster_key    TEXT        NOT NULL,
  cluster_reason TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, cluster_key)
);

CREATE TABLE contact_duplicate_cluster_members (
  id             BIGSERIAL   PRIMARY KEY,
  cluster_id     UUID        NOT NULL REFERENCES contact_duplicate_clusters(id) ON DELETE CASCADE,
  run_id         UUID        NOT NULL,
  contact_id     INT         NOT NULL,
  is_primary     BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cluster_id, contact_id)
);

CREATE INDEX dup_cluster_members_run
  ON contact_duplicate_cluster_members(run_id, contact_id);

-- ── 5. Normalization proposals ────────────────────────────────────────────
-- CAS guard: contact_updated_at is snapshotted at proposal creation.
-- Approval reads contacts.updated_at and skips if it differs.
CREATE TABLE contact_normalization_proposals (
  id                    BIGSERIAL   PRIMARY KEY,
  run_id                UUID        NOT NULL REFERENCES contact_reconciliation_runs(id) ON DELETE CASCADE,
  contact_id            INT         NOT NULL,
  proposal_type         TEXT        NOT NULL
                          CHECK (proposal_type IN ('name_normalization','email_normalization','phone_normalization','vertical_assignment','company_normalization')),
  field_name            TEXT        NOT NULL,
  current_value         TEXT,
  proposed_value        TEXT        NOT NULL,
  contact_updated_at    TIMESTAMPTZ NOT NULL,
  before_values         JSONB       NOT NULL DEFAULT '{}',
  confidence            INT         NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  status                TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','stale','reversed')),
  reviewed_by           TEXT,
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX recon_proposals_run_status
  ON contact_normalization_proposals(run_id, status);
CREATE INDEX recon_proposals_contact
  ON contact_normalization_proposals(contact_id, status);

-- ── 6. Normalization reversal ledger ─────────────────────────────────────
CREATE TABLE contact_normalization_reversals (
  id              BIGSERIAL   PRIMARY KEY,
  proposal_id     BIGINT      NOT NULL REFERENCES contact_normalization_proposals(id),
  contact_id      INT         NOT NULL,
  field_name      TEXT        NOT NULL,
  value_before    TEXT,
  value_after     TEXT,
  reversed_to     TEXT,
  reversed_by     TEXT        NOT NULL,
  reversed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
