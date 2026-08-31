-- CRO-08A: Continuous Candidate Factory & Enrichment Operations
-- Adds: (1) a recurring continuous_occurrence CRO-03C command type, distinct
-- from micro_canary and initial_batch; (2) a versioned schedule-definition
-- authority scoped to discovery/enrichment/freshness/backfill only; (3) a
-- durable occurrence table (distinctly named from cro03_source_occurrences)
-- with two separately-advanced checkpoints; (4) an immutable provider budget
-- period ledger for archive-then-reset daily/monthly rollover; (5) a minimal
-- CRO-03D production-certification receipt table gating schedule activation.

-- 1) Widen the CRO-03C command type CHECK to add continuous_occurrence.
-- The dead 'activation' literal is intentionally left in place (never
-- created by any code path); this migration does not repurpose it.
ALTER TABLE cro03c_commands DROP CONSTRAINT IF EXISTS cro03c_command_type_chk;
ALTER TABLE cro03c_commands ADD CONSTRAINT cro03c_command_type_chk
  CHECK (command_type IN ('activation','micro_canary','initial_batch','continuous_occurrence'));

-- 2) Versioned schedule-definition authority. Scope is a hard CHECK: only
-- discovery/enrichment/freshness_refresh/backfill logical keys may ever be
-- inserted here (Correction 3's explicit exclusion boundary).
CREATE TABLE IF NOT EXISTS cro08a_schedule_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_key TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  purpose TEXT NOT NULL,
  source_recipe_policy_versions JSONB NOT NULL DEFAULT '{}'::jsonb,
  cadence_cron TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  window_seconds INTEGER NOT NULL,
  overlap_seconds INTEGER NOT NULL DEFAULT 0,
  batch_size INTEGER NOT NULL,
  concurrency_limit INTEGER NOT NULL,
  cursor_semantics JSONB NOT NULL DEFAULT '{}'::jsonb,
  budgets JSONB NOT NULL DEFAULT '{}'::jsonb,
  timeout_ms INTEGER NOT NULL,
  lease_ms INTEGER NOT NULL,
  heartbeat_ms INTEGER NOT NULL,
  retry_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  dead_letter_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  downstream_owner TEXT NOT NULL,
  cancellation_behavior TEXT NOT NULL DEFAULT 'preserve_completed_evidence',
  definition_hash TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT false,
  active_version INTEGER NOT NULL DEFAULT 0,
  activation_epoch BIGINT,
  activated_by TEXT,
  activation_reason TEXT,
  activation_expires_at TIMESTAMPTZ,
  certification_receipt_id UUID,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro08a_schedule_logical_key_chk CHECK (
    logical_key IN ('candidate_discovery','candidate_enrichment','candidate_freshness_refresh','candidate_backfill')
  ),
  CONSTRAINT cro08a_schedule_definition_version_uidx UNIQUE (logical_key, definition_version)
);
-- Compare-and-set active pointer: at most one active definition per logical
-- key at any time (a new version must deactivate the old one atomically).
CREATE UNIQUE INDEX IF NOT EXISTS cro08a_schedule_active_uidx
  ON cro08a_schedule_definitions (logical_key) WHERE active;

-- 3) Durable schedule occurrence: one row per logical due window, distinctly
-- named from the pre-existing per-subject-event cro03_source_occurrences
-- table (Correction 2's naming-collision note). Carries two separately
-- advanced checkpoints plus a frozen source-window/population snapshot.
CREATE TABLE IF NOT EXISTS cro08a_schedule_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_definition_id UUID NOT NULL REFERENCES cro08a_schedule_definitions(id) ON DELETE RESTRICT,
  definition_hash TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  -- Snapshot of the relevant cro03a_census_cursors row(s) taken at freeze
  -- time. Must never be re-derived from a later live cursor read.
  frozen_cursor_snapshot JSONB NOT NULL,
  frozen_population_hash TEXT NOT NULL,
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  state TEXT NOT NULL DEFAULT 'open',
  -- Enumeration checkpoint: advances only after selected subjects + their
  -- selection receipts are durably committed to this occurrence.
  enumeration_checkpoint TEXT NOT NULL DEFAULT 'pending',
  enumeration_committed_at TIMESTAMPTZ,
  selection_receipt_hash TEXT,
  selected_count INTEGER NOT NULL DEFAULT 0,
  -- Reconciliation checkpoint: advances only after every selected item has
  -- reached a terminal CRO-03C dispatch/projection/validation disposition.
  reconciliation_checkpoint TEXT NOT NULL DEFAULT 'pending',
  reconciliation_completed_at TIMESTAMPTZ,
  terminal_count INTEGER NOT NULL DEFAULT 0,
  -- 1:1 binding to the continuous_occurrence CRO-03C command created for
  -- this occurrence (Correction 1's race-safety requirement: UNIQUE means a
  -- second concurrent claim can create at most one command per occurrence).
  cro03c_command_id UUID REFERENCES cro03c_commands(id) ON DELETE RESTRICT,
  cancel_requested_at TIMESTAMPTZ,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro08a_occurrence_state_chk CHECK (
    state IN ('open','claimed','enumerating','enumerated','reconciling','reconciled','cancelled','failed')
  ),
  CONSTRAINT cro08a_occurrence_enum_checkpoint_chk CHECK (
    enumeration_checkpoint IN ('pending','committed')
  ),
  CONSTRAINT cro08a_occurrence_reconcile_checkpoint_chk CHECK (
    reconciliation_checkpoint IN ('pending','complete')
  ),
  CONSTRAINT cro08a_occurrence_command_uidx UNIQUE (cro03c_command_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS cro08a_occurrence_window_uidx
  ON cro08a_schedule_occurrences (schedule_definition_id, window_start, window_end);
CREATE INDEX IF NOT EXISTS cro08a_occurrence_claim_idx
  ON cro08a_schedule_occurrences (state, lease_expires_at);

-- 4) Immutable provider budget period ledger (Correction 5). provider_controls
-- keeps a single non-resetting cumulative cap; this ledger archives each
-- elapsed window's consumed_units before the window is rolled over, so
-- historical per-period spend is preserved for economics reporting and a
-- rollover can never silently double-execute or lose evidence.
CREATE TABLE IF NOT EXISTS provider_budget_period_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL REFERENCES provider_controls(provider) ON DELETE RESTRICT,
  period_key TEXT NOT NULL,
  period_started_at TIMESTAMPTZ NOT NULL,
  period_ended_at TIMESTAMPTZ NOT NULL,
  consumed_units INTEGER NOT NULL,
  local_budget_units INTEGER,
  closed_reservation_version INTEGER NOT NULL,
  closed_by TEXT NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT provider_budget_period_key_chk CHECK (period_key IN ('daily','monthly')),
  CONSTRAINT provider_budget_period_uidx UNIQUE (provider, period_key, period_started_at)
);
CREATE OR REPLACE FUNCTION provider_budget_period_ledger_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'provider_budget_period_ledger rows are immutable (archive-then-reset only)';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS provider_budget_period_ledger_immutable_trg ON provider_budget_period_ledger;
CREATE TRIGGER provider_budget_period_ledger_immutable_trg
  BEFORE UPDATE OR DELETE ON provider_budget_period_ledger
  FOR EACH ROW EXECUTE FUNCTION provider_budget_period_ledger_immutable();

-- 5) Minimal CRO-03D production-certification receipt (Correction 4, option
-- (ii): CRO-08A ships self-contained rather than depending on an
-- as-yet-unbuilt CRO-03D follow-up). No ceremony wires into this table yet
-- in this task; that integration is explicitly left as follow-up work. Until
-- a receipt exists, every schedule-activation attempt is denied by
-- construction, so CRO-08A ships CODE COMPLETE / SCHEDULES PAUSED.
CREATE TABLE IF NOT EXISTS cro08a_certification_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_sha TEXT NOT NULL,
  migration_head TEXT NOT NULL,
  provider_set JSONB NOT NULL,
  price_schedule_hash TEXT NOT NULL,
  approval_receipt_ids JSONB NOT NULL,
  runtime_attestation_id UUID NOT NULL REFERENCES cro03c_runtime_attestations(id) ON DELETE RESTRICT,
  outbound_pause_epoch BIGINT NOT NULL,
  issued_by TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT
);
CREATE INDEX IF NOT EXISTS cro08a_certification_receipts_release_idx
  ON cro08a_certification_receipts (release_sha, migration_head, expires_at);

ALTER TABLE cro08a_schedule_definitions
  ADD CONSTRAINT cro08a_schedule_certification_fk
  FOREIGN KEY (certification_receipt_id) REFERENCES cro08a_certification_receipts(id) ON DELETE RESTRICT;
