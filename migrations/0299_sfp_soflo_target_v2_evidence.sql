-- SFP South Florida target-vertical taxonomy v2: evidence rows must identify
-- exactly which of the five new target groups they resolved to, and whether
-- that resolution came from the deterministic classifier's high-confidence
-- tier (the only tier the selector may admit a business on evidence alone).
ALTER TABLE sfp_classification_evidence
  ADD COLUMN IF NOT EXISTS resolved_vertical_id text,
  ADD COLUMN IF NOT EXISTS admission_tier text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sfp_classification_evidence_admission_tier_chk'
  ) THEN
    ALTER TABLE sfp_classification_evidence
      ADD CONSTRAINT sfp_classification_evidence_admission_tier_chk
      CHECK (admission_tier IS NULL OR admission_tier IN ('resolved_high', 'resolved_medium'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sfp_classification_evidence_resolved_vertical_target_chk'
  ) THEN
    ALTER TABLE sfp_classification_evidence
      ADD CONSTRAINT sfp_classification_evidence_resolved_vertical_target_chk
      CHECK (resolved_vertical_id IS NULL OR outcome = 'target');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sfp_classification_evidence_resolved_vertical_idx
  ON sfp_classification_evidence (business_id, classifier_version, policy_version, resolved_vertical_id)
  WHERE resolved_vertical_id IS NOT NULL;

-- Each SFP program pins which vertical taxonomy version its live-text
-- classification and evidence admission must use. Existing programs default
-- to 1 (the legacy five-package taxonomy) so this migration changes nothing
-- for any program that isn't explicitly moved to v2.
ALTER TABLE sfp_programs
  ADD COLUMN IF NOT EXISTS taxonomy_version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sfp_programs_taxonomy_version_chk'
  ) THEN
    ALTER TABLE sfp_programs
      ADD CONSTRAINT sfp_programs_taxonomy_version_chk
      CHECK (taxonomy_version IN (1, 2));
  END IF;
END $$;
