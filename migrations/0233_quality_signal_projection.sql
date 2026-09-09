-- Migration 0233: Contact Quality Signal Projection
-- Adds quality signal columns to contact_reconciliation_runs and contact_reconciliation_members.
-- Historical rows (from legacy-reconciliation and 1.0.0 runs) receive empty defaults.
-- New quality-v1 runs populate these columns during classification.

-- ── 1. Extend contact_reconciliation_runs ─────────────────────────────────
ALTER TABLE contact_reconciliation_runs
  ADD COLUMN IF NOT EXISTS quality_signal_counts        jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS quality_flagged_contacts     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quality_signal_instances     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS suppressed_cosmetic_candidates integer NOT NULL DEFAULT 0;

-- ── 2. Extend contact_reconciliation_members ───────────────────────────────
ALTER TABLE contact_reconciliation_members
  ADD COLUMN IF NOT EXISTS quality_signal_codes   text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS quality_signal_details jsonb   NOT NULL DEFAULT '{}'::jsonb;

-- ── 3. Indexes ─────────────────────────────────────────────────────────────

-- GIN index for quality signal code filtering (only where signals are present)
CREATE INDEX IF NOT EXISTS recon_members_quality_codes_run_idx
  ON contact_reconciliation_members USING GIN (quality_signal_codes)
  WHERE array_length(quality_signal_codes, 1) > 0;

-- Composite index: run_id + quality signal presence (for summary queries)
CREATE INDEX IF NOT EXISTS recon_members_run_quality_idx
  ON contact_reconciliation_members (run_id, array_length(quality_signal_codes, 1))
  WHERE array_length(quality_signal_codes, 1) > 0;

-- Shared-phone normalized lookup: digits-only grouping for quality-v1 classification.
-- Used in the set-based shared-phone cohort query during quality runs.
-- regexp_replace is immutable so this is a legal expression index.
-- Scoped to archived_at IS NULL to exclude archived contacts.
CREATE INDEX IF NOT EXISTS contacts_digits_phone_idx
  ON contacts (regexp_replace(phone, '[^0-9]', '', 'g'))
  WHERE archived_at IS NULL AND phone IS NOT NULL AND TRIM(phone) <> '';

-- Shared-email normalized lookup: lower(email) grouping for quality-v1 classification.
CREATE INDEX IF NOT EXISTS contacts_lower_email_quality_idx
  ON contacts (lower(TRIM(email)))
  WHERE archived_at IS NULL AND email IS NOT NULL AND TRIM(email) <> '';
