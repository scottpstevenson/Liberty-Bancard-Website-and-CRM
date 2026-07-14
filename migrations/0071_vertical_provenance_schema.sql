-- Migration: 0071_vertical_provenance_schema
-- Adds vertical provenance columns to contacts, sdr_merchants, and sdr_lead_state.
-- All new columns are nullable with no defaults (NULL = provenance not yet established).
-- Named CHECK constraints enforce that confidence values are 0–100 or NULL.
-- No data changes, no backfill, no trigger creation.

-- contacts: authority table (owns manual override)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS vertical_source text,
  ADD COLUMN IF NOT EXISTS vertical_confidence integer,
  ADD COLUMN IF NOT EXISTS manual_vertical_override boolean;

ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_vertical_confidence_range,
  ADD CONSTRAINT contacts_vertical_confidence_range
    CHECK (vertical_confidence IS NULL OR (vertical_confidence BETWEEN 0 AND 100));

-- sdr_merchants: separate provenance for coarse vertical and fine subvertical
ALTER TABLE sdr_merchants
  ADD COLUMN IF NOT EXISTS vertical_source text,
  ADD COLUMN IF NOT EXISTS vertical_confidence integer,
  ADD COLUMN IF NOT EXISTS subvertical_source text,
  ADD COLUMN IF NOT EXISTS subvertical_confidence integer,
  ADD COLUMN IF NOT EXISTS manual_vertical_override boolean;

ALTER TABLE sdr_merchants
  DROP CONSTRAINT IF EXISTS sdr_merchants_vertical_confidence_range,
  ADD CONSTRAINT sdr_merchants_vertical_confidence_range
    CHECK (vertical_confidence IS NULL OR (vertical_confidence BETWEEN 0 AND 100));

ALTER TABLE sdr_merchants
  DROP CONSTRAINT IF EXISTS sdr_merchants_subvertical_confidence_range,
  ADD CONSTRAINT sdr_merchants_subvertical_confidence_range
    CHECK (subvertical_confidence IS NULL OR (subvertical_confidence BETWEEN 0 AND 100));

-- sdr_lead_state: resolved projection (no override authority)
ALTER TABLE sdr_lead_state
  ADD COLUMN IF NOT EXISTS vertical_source text,
  ADD COLUMN IF NOT EXISTS vertical_confidence integer,
  ADD COLUMN IF NOT EXISTS vertical_resolution_reason text;

ALTER TABLE sdr_lead_state
  DROP CONSTRAINT IF EXISTS sdr_lead_state_vertical_confidence_range,
  ADD CONSTRAINT sdr_lead_state_vertical_confidence_range
    CHECK (vertical_confidence IS NULL OR (vertical_confidence BETWEEN 0 AND 100));
