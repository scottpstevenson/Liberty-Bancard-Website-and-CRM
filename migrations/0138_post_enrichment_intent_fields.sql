-- Migration 0138: Post-Enrichment Intent Fields (#1551 / 1548C)
-- Adds transactional safety columns, lease/claim fields, and error classification
-- to post_enrichment_enrollment_intents. Existing pending rows are failed as
-- they cannot be recovered without a sequence_id.
--
-- Depends on: 0137 (logical_job_control_holds)

-- ── Step 1: Add new columns (all nullable to allow in-place migration) ────────

ALTER TABLE post_enrichment_enrollment_intents
  ADD COLUMN IF NOT EXISTS sequence_id            INTEGER REFERENCES follow_up_sequences(id),
  ADD COLUMN IF NOT EXISTS purpose                VARCHAR(100),
  ADD COLUMN IF NOT EXISTS channels               JSONB,
  ADD COLUMN IF NOT EXISTS selection_policy_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS selection_snapshot     JSONB,
  ADD COLUMN IF NOT EXISTS claim_token            UUID,
  ADD COLUMN IF NOT EXISTS claimed_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_expires_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_by             VARCHAR(100),
  ADD COLUMN IF NOT EXISTS max_attempts           INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS last_error_code        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS last_error_class       VARCHAR(50),
  ADD COLUMN IF NOT EXISTS completed_enrollment_id INTEGER REFERENCES sequence_enrollments(id);

-- ── Step 2: Fail orphaned pending/processing rows ────────────────────────────
-- Existing rows pre-dating 0138 have no sequence_id and cannot be recovered.
-- Mark them failed so the recovery worker never attempts them.

UPDATE post_enrichment_enrollment_intents
SET
  status         = 'failed',
  last_error_code = 'schema_upgrade_no_sequence_id',
  last_error_class = 'permanent',
  updated_at     = NOW()
WHERE status IN ('pending', 'processing')
  AND sequence_id IS NULL;

-- ── Step 3: Efficient claim index ────────────────────────────────────────────
-- Supports the atomic FOR UPDATE SKIP LOCKED claim query:
-- WHERE status IN ('pending','processing') AND (eligible_after IS NULL OR eligible_after <= NOW())
-- OR (status = 'processing' AND lease_expires_at < NOW())

CREATE INDEX IF NOT EXISTS pe_intents_claim_idx
  ON post_enrichment_enrollment_intents (status, lease_expires_at)
  WHERE status IN ('pending', 'processing');
