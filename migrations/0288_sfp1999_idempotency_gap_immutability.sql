-- Task #1999 correction: payload-bound executions, persisted gap vectors,
-- and database-enforced insert-only evidence.
ALTER TABLE sfp_stage_runs
  ADD COLUMN IF NOT EXISTS payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS preview_snapshot_hash TEXT;
ALTER TABLE sfp_classification_runs
  ADD COLUMN IF NOT EXISTS payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS claim_token UUID,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE sfp_classification_items
  ADD COLUMN IF NOT EXISTS claim_token UUID,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE provider_operations
  ADD COLUMN IF NOT EXISTS sfp_result_data JSONB;
ALTER TABLE sfp_cohort_decisions
  ADD COLUMN IF NOT EXISTS classification_evidence_hash TEXT,
  ADD COLUMN IF NOT EXISTS classification_model_version TEXT,
  ADD COLUMN IF NOT EXISTS classification_prompt_version TEXT,
  ADD COLUMN IF NOT EXISTS classification_classifier_version INTEGER;
ALTER TABLE sfp_stage_items
  ADD COLUMN IF NOT EXISTS gap_vector JSONB;

-- Serper's accepted domain/identity facts are paid evidence too; preserve their
-- linkage without conflating them with free contact candidates.
ALTER TABLE sfp_stage_items DROP CONSTRAINT IF EXISTS sfp_stage_items_candidate_ref_one_of_chk;
ALTER TABLE sfp_stage_items ADD CONSTRAINT sfp_stage_items_candidate_ref_one_of_chk CHECK (
  NOT (candidate_id IS NOT NULL AND paid_candidate_evidence_id IS NOT NULL)
  AND (
    provider NOT IN ('outscraper', 'apollo', 'serper')
    OR outcome_code IS DISTINCT FROM 'candidate_found'
    OR ((candidate_id IS NOT NULL) <> (paid_candidate_evidence_id IS NOT NULL))
  )
  AND (
    provider NOT IN ('outscraper', 'apollo', 'serper')
    OR outcome_code = 'candidate_found'
    OR (candidate_id IS NULL AND paid_candidate_evidence_id IS NULL)
  )
  AND (
    provider IN ('outscraper', 'apollo', 'serper') OR paid_candidate_evidence_id IS NULL
  )
);

CREATE OR REPLACE FUNCTION sfp_reject_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SFP_EVIDENCE_IMMUTABLE:%', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS sfp_classification_evidence_immutable_trg ON sfp_classification_evidence;
CREATE TRIGGER sfp_classification_evidence_immutable_trg
  BEFORE UPDATE OR DELETE ON sfp_classification_evidence
  FOR EACH ROW EXECUTE FUNCTION sfp_reject_evidence_mutation();

DROP TRIGGER IF EXISTS sfp_paid_candidate_evidence_immutable_trg ON sfp_paid_candidate_evidence;
CREATE TRIGGER sfp_paid_candidate_evidence_immutable_trg
  BEFORE UPDATE OR DELETE ON sfp_paid_candidate_evidence
  FOR EACH ROW EXECUTE FUNCTION sfp_reject_evidence_mutation();