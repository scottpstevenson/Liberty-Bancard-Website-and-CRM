-- Migration 0230: Identity Crosswalk Runs and Subjects
-- Adds the frozen-run orchestration tables for Gen-1 cross-system identity reconciliation.
-- Plain CREATE INDEX (no CONCURRENTLY) — migrate() runs inside a transaction per codebase convention.

-- ─── Runs table ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_identity_reconciliation_runs (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation                      int NOT NULL,
  rules_version                   text NOT NULL,
  requested_by_user_id            text NOT NULL REFERENCES users(id),
  environment                     text NOT NULL,
  release_sha                     text,
  status                          text NOT NULL DEFAULT 'pending',
  -- status: pending | running | paused | cancelled | completed | failed
  lease_owner                     text,
  lease_expires_at                timestamptz,
  started_at                      timestamptz,
  completed_at                    timestamptz,
  pause_reason                    text,
  fail_reason                     text,
  -- Frozen source high-water marks
  frozen_sunbiz_max_id            bigint,
  frozen_prospects_max_id         bigint,
  frozen_master_leads_created_at  timestamptz,
  frozen_master_leads_max_uuid    uuid,
  -- Frozen candidate-universe high-water marks
  frozen_contacts_max_id          bigint,
  frozen_businesses_max_id        bigint,
  -- Frozen denominators
  sunbiz_denominator              int,
  prospects_denominator           int,
  master_leads_denominator        int,
  -- Per-population keyset cursors
  sunbiz_cursor                   bigint DEFAULT 0,
  prospects_cursor                bigint DEFAULT 0,
  master_leads_cursor_created_at  timestamptz,
  master_leads_cursor_uuid        uuid,
  -- Per-population processed/exception counts
  sunbiz_processed                int NOT NULL DEFAULT 0,
  sunbiz_exceptions               int NOT NULL DEFAULT 0,
  prospects_processed             int NOT NULL DEFAULT 0,
  prospects_exceptions            int NOT NULL DEFAULT 0,
  master_leads_processed          int NOT NULL DEFAULT 0,
  master_leads_exceptions         int NOT NULL DEFAULT 0,
  -- Evidence-class totals
  explicit_link_count             int NOT NULL DEFAULT 0,
  deterministic_match_count       int NOT NULL DEFAULT 0,
  strong_candidate_count          int NOT NULL DEFAULT 0,
  ambiguous_count                 int NOT NULL DEFAULT 0,
  source_conflict_count           int NOT NULL DEFAULT 0,
  insufficient_evidence_count     int NOT NULL DEFAULT 0,
  no_match_count                  int NOT NULL DEFAULT 0,
  non_production_count            int NOT NULL DEFAULT 0,
  -- Pool snapshot at last checkpoint
  pool_waiting_count_at_checkpoint int,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

-- One-active-run global enforcement (mirrors census pattern: ON ((1)))
CREATE UNIQUE INDEX IF NOT EXISTS identity_runs_one_active
  ON contact_identity_reconciliation_runs ((1))
  WHERE status IN ('pending', 'running', 'paused');

-- ─── Subjects table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_identity_subjects (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                  uuid NOT NULL REFERENCES contact_identity_reconciliation_runs(id),
  source_table            text NOT NULL,
  -- source_table: 'sunbiz_entities' | 'prospects' | 'master_leads'
  source_id               text NOT NULL,
  -- cast to text; int for sunbiz/prospects, uuid for master_leads
  root_source_table       text NOT NULL,
  root_source_id          text NOT NULL,
  import_execution_id     text,
  -- Pre-resolved FK-chain denormalization
  existing_fk_contact_id  int,
  existing_fk_business_id int,
  -- Aggregate subject disposition
  disposition             text NOT NULL,
  -- MATCHED | AMBIGUOUS | CONFLICTING | NO_MATCH | INSUFFICIENT_EVIDENCE | NON_PRODUCTION
  candidate_count         int NOT NULL DEFAULT 0,
  -- Frozen identity-bearing fields as HMAC-keyed digests (no raw PII)
  source_fingerprint      text NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, source_table, source_id)
);

CREATE INDEX IF NOT EXISTS identity_subjects_run_id_idx
  ON contact_identity_subjects (run_id);

CREATE INDEX IF NOT EXISTS identity_subjects_disposition_idx
  ON contact_identity_subjects (run_id, disposition);

-- ─── Expression indexes on contacts for set-based matching ────────────────────
-- btree for equality matching; CONCURRENTLY banned inside migrate() transactions.
CREATE INDEX IF NOT EXISTS contacts_lower_email_crosswalk_idx
  ON contacts (lower(trim(email)))
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS contacts_lower_company_crosswalk_idx
  ON contacts (lower(trim(company_name)))
  WHERE archived_at IS NULL AND company_name IS NOT NULL;
