-- 0290 (Task #2001): package-pinned ready_held campaign/sequence staging.
--
-- Corrects the structurally-impossible "enrolled" terminal state from the
-- original task design. New terminal boundary is `ready_held` — never a
-- sequence enrollment, never a campaign_queue row, never a GHL/outbound
-- write. See .local/tasks/task-2001.md for the full corrected contract.
--
-- Census performed against the live dev database before writing this
-- migration: `SELECT state, count(*) FROM sfp_campaign_staging_intents
-- GROUP BY state` returned zero rows. No 'promoted' (or any other) legacy
-- state value exists today, so the new CHECK below safely omits 'promoted'
-- without any compatibility branch or data migration.

-- ── Immutable, versioned five-package mapping (Defect 3/4) ─────────────────
CREATE TABLE IF NOT EXISTS sfp_campaign_package_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_key TEXT NOT NULL
    CHECK (package_key IN ('sfp.restaurant.v1','sfp.med_spa.v1','sfp.dental.v1','sfp.retail.v1','sfp.auto_repair.v1')),
  vertical TEXT NOT NULL,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  campaign_name TEXT NOT NULL,
  sequence_id INTEGER NOT NULL REFERENCES follow_up_sequences(id) ON DELETE RESTRICT,
  sequence_name TEXT NOT NULL,
  sequence_family TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_state IN ('draft','current','superseded','retired')),
  effective_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,
  actor_id TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Exactly one 'current' version may exist per package_key at a time.
CREATE UNIQUE INDEX IF NOT EXISTS sfp_campaign_package_versions_current_uidx
  ON sfp_campaign_package_versions (package_key)
  WHERE lifecycle_state = 'current';
CREATE INDEX IF NOT EXISTS sfp_campaign_package_versions_key_idx
  ON sfp_campaign_package_versions (package_key, created_at DESC);

-- ── One-of source schema for staging intents (Defect 5) ─────────────────────
ALTER TABLE sfp_campaign_staging_intents
  ALTER COLUMN candidate_id DROP NOT NULL;

ALTER TABLE sfp_campaign_staging_intents
  ADD COLUMN IF NOT EXISTS paid_candidate_evidence_id UUID REFERENCES sfp_paid_candidate_evidence(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_kind TEXT,
  ADD COLUMN IF NOT EXISTS package_version_id UUID REFERENCES sfp_campaign_package_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS package_key TEXT,
  ADD COLUMN IF NOT EXISTS policy_document_hash TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_hash TEXT,
  ADD COLUMN IF NOT EXISTS payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS command_key TEXT,
  ADD COLUMN IF NOT EXISTS operator_selected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS operator_selected_by TEXT,
  ADD COLUMN IF NOT EXISTS ready_held_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terminal_code TEXT,
  ADD COLUMN IF NOT EXISTS terminal_reason_detail TEXT;

-- Backfill source_kind for any pre-existing free-source rows (none exist in
-- dev today per the census above, but this keeps the migration correct for
-- any environment where rows do exist).
UPDATE sfp_campaign_staging_intents
   SET source_kind = 'free'
 WHERE source_kind IS NULL AND candidate_id IS NOT NULL;

ALTER TABLE sfp_campaign_staging_intents
  DROP CONSTRAINT IF EXISTS sfp_campaign_staging_intents_source_ref_one_of_chk;
ALTER TABLE sfp_campaign_staging_intents
  ADD CONSTRAINT sfp_campaign_staging_intents_source_ref_one_of_chk CHECK (
    (source_kind = 'free' AND candidate_id IS NOT NULL AND paid_candidate_evidence_id IS NULL)
    OR (source_kind = 'paid' AND paid_candidate_evidence_id IS NOT NULL AND candidate_id IS NULL)
  );

-- Corrected terminal-state vocabulary (Defect 1). The dev-database census
-- performed before writing this migration found zero 'promoted' rows, but
-- the constraint below must not assume that holds in every environment this
-- migration runs against (a fresh disposable-DB certification run, for
-- example, may seed a synthetic legacy 'promoted' row to prove exactly this
-- case). 'promoted' is therefore retained as a legal LEGACY-ONLY value: no
-- application code path in this task (or after it) ever writes 'promoted'
-- again, and a 'promoted' row is never silently reinterpreted as
-- 'ready_held' — it stays 'promoted' until an operator explicitly migrates
-- it through an individually-justified, audited procedure.
ALTER TABLE sfp_campaign_staging_intents
  DROP CONSTRAINT IF EXISTS sfp_campaign_staging_intents_state_check;
ALTER TABLE sfp_campaign_staging_intents
  ALTER COLUMN state SET DEFAULT 'staged';
ALTER TABLE sfp_campaign_staging_intents
  ADD CONSTRAINT sfp_campaign_staging_intents_state_check CHECK (
    state IN ('staged','operator_selected','ready_held','rejected','cancelled','superseded','promoted')
  );

-- Replace candidate-keyed uniqueness (broken for paid rows, where
-- candidate_id is NULL) with an eligibility-keyed uniqueness authority that
-- holds for exactly one live (non-terminal-rejected) intent per eligibility.
DROP INDEX IF EXISTS sfp_campaign_intent_cohort_business_candidate_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS sfp_campaign_intent_eligibility_live_uidx
  ON sfp_campaign_staging_intents (eligibility_id)
  WHERE state NOT IN ('rejected','cancelled','superseded');

CREATE INDEX IF NOT EXISTS sfp_campaign_staging_intents_package_idx
  ON sfp_campaign_staging_intents (package_version_id, state);

-- ── Command-receipt table for exact idempotent replay (Defect 6) ───────────
-- One row per (stage,command_key). Same key + same payload_hash replays
-- stored_result verbatim; same key + different payload_hash is a 409 at the
-- service layer, never a silent overwrite.
CREATE TABLE IF NOT EXISTS sfp_campaign_staging_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_run_id UUID NOT NULL REFERENCES sfp_cohort_runs(id) ON DELETE RESTRICT,
  command_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  stored_result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sfp_campaign_staging_commands_cohort_idx
  ON sfp_campaign_staging_commands (cohort_run_id, created_at DESC);

-- ── Recurring worker default-off wiring (Defect 15) ─────────────────────────
-- The new campaign-staging worker fails closed (disabled) unless
-- schedule_config.campaignStaging is a positive integer. Existing programs
-- predate this key; backfill it alongside the other three batch keys rather
-- than leaving the worker permanently disabled for pre-existing programs.
-- The key's presence does not itself enable execution — the worker also
-- requires recurring_enabled=true, the program to be active, and the
-- "sfp-campaign-staging" capability group to be running.
ALTER TABLE sfp_programs
  ALTER COLUMN schedule_config SET DEFAULT '{"freeBatch":25,"paidBatch":10,"validationBatch":25,"campaignStaging":10}'::jsonb;

UPDATE sfp_programs
   SET schedule_config = schedule_config || '{"campaignStaging":10}'::jsonb
 WHERE NOT (schedule_config ? 'campaignStaging');
