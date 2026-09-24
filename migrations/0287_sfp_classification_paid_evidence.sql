-- 0287: Task #1999 — unified SFP discovery: pre-cohort classification evidence,
-- paid-provider evidence table, and sfp_stage_items typed candidate reference.
--
-- Additive only. Does not alter provider_controls, serper_control,
-- free_discovery_candidates' existing shape, or cro03c_candidate_evidence's
-- generation_id NOT NULL constraint.

-- C1: append-only pre-cohort classification contract. Independent of
-- cohort_run_id by design (pre-cohort work happens before a cohort exists).
CREATE TABLE IF NOT EXISTS sfp_classification_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES sfp_programs(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  max_businesses INTEGER NOT NULL,
  policy_version INTEGER NOT NULL,
  classifier_version INTEGER NOT NULL,
  config_hash TEXT NOT NULL,
  estimated_cost_micros BIGINT NOT NULL DEFAULT 0,
  reserved_cost_micros BIGINT NOT NULL DEFAULT 0,
  settled_cost_micros BIGINT NOT NULL DEFAULT 0,
  selected_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  succeeded_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  terminal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sfp_classification_runs_program_idx ON sfp_classification_runs (program_id, created_at);

CREATE TABLE IF NOT EXISTS sfp_classification_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  evidence_hash TEXT NOT NULL,
  source_refs JSONB NOT NULL DEFAULT '[]',
  classifier_version INTEGER NOT NULL,
  model_version TEXT,
  prompt_version TEXT,
  policy_version INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  confidence NUMERIC(4,3),
  reason_codes JSONB NOT NULL DEFAULT '[]',
  idempotency_key TEXT NOT NULL UNIQUE,
  cost_micros BIGINT NOT NULL DEFAULT 0,
  terminal_state TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sfp_classification_evidence_outcome_chk CHECK (outcome IN ('target', 'non_target', 'review_required'))
);
CREATE INDEX IF NOT EXISTS sfp_classification_evidence_business_idx ON sfp_classification_evidence (business_id, policy_version, created_at);

CREATE TABLE IF NOT EXISTS sfp_classification_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES sfp_classification_runs(id) ON DELETE RESTRICT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'pending',
  outcome_code TEXT,
  evidence_id UUID REFERENCES sfp_classification_evidence(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sfp_classification_items_run_business_uidx ON sfp_classification_items (run_id, business_id);
CREATE INDEX IF NOT EXISTS sfp_classification_items_business_idx ON sfp_classification_items (business_id, created_at);

-- C3: paid-provider candidate evidence, physically separate from
-- free_discovery_candidates and cro03c_candidate_evidence.
CREATE TABLE IF NOT EXISTS sfp_paid_candidate_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  field TEXT NOT NULL DEFAULT 'email',
  subject_type TEXT NOT NULL,
  provider_operation_id UUID REFERENCES provider_operations(id) ON DELETE SET NULL,
  disposition TEXT NOT NULL DEFAULT 'staged',
  confidence INTEGER NOT NULL DEFAULT 0,
  envelope_ciphertext TEXT NOT NULL,
  envelope_nonce TEXT NOT NULL,
  envelope_tag TEXT NOT NULL,
  envelope_key_version INTEGER NOT NULL DEFAULT 1,
  normalized_value_hash TEXT NOT NULL,
  masked_value TEXT NOT NULL,
  person_name_evidence TEXT,
  person_title_evidence TEXT,
  candidate_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sfp_paid_candidate_evidence_provider_chk CHECK (provider IN ('outscraper', 'apollo', 'serper'))
);
CREATE UNIQUE INDEX IF NOT EXISTS sfp_paid_candidate_evidence_provider_biz_field_value_uniq ON sfp_paid_candidate_evidence (provider, business_id, field, normalized_value_hash);
CREATE INDEX IF NOT EXISTS sfp_paid_candidate_evidence_business_idx ON sfp_paid_candidate_evidence (business_id);

-- C3: sfp_stage_items gains a nullable paid-evidence FK alongside the existing
-- free-only candidate_id, with a CHECK enforcing exactly one populated
-- reference for a candidate-producing terminal item and neither for a
-- non-candidate terminal outcome.
ALTER TABLE sfp_stage_items
  ADD COLUMN IF NOT EXISTS paid_candidate_evidence_id UUID REFERENCES sfp_paid_candidate_evidence(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sfp_stage_items_paid_evidence_idx ON sfp_stage_items (paid_candidate_evidence_id);

-- Scoped to 'outscraper'/'apollo': those are the only providers this task's
-- paid-candidate-discovery path writes through (sfp-paid-waterfall.ts +
-- writeSfpPaidCandidateEvidence). Pre-existing 'zerobounce' validation items
-- populate candidate_id for an unrelated purpose (validating an existing free
-- candidate, not discovering a new one) and their outcome_code is a
-- validation verdict ('valid'/'invalid'/'risky'/...), never 'candidate_found'
-- — scoping the one-of-reference rule to outscraper/apollo keeps that
-- existing, unrelated write path unaffected.
ALTER TABLE sfp_stage_items
  DROP CONSTRAINT IF EXISTS sfp_stage_items_candidate_ref_one_of_chk;
ALTER TABLE sfp_stage_items
  ADD CONSTRAINT sfp_stage_items_candidate_ref_one_of_chk CHECK (
    NOT (candidate_id IS NOT NULL AND paid_candidate_evidence_id IS NOT NULL)
    AND (
      provider NOT IN ('outscraper', 'apollo')
      OR outcome_code IS DISTINCT FROM 'candidate_found'
      OR ((candidate_id IS NOT NULL) <> (paid_candidate_evidence_id IS NOT NULL))
    )
    AND (
      provider NOT IN ('outscraper', 'apollo')
      OR outcome_code = 'candidate_found'
      OR (candidate_id IS NULL AND paid_candidate_evidence_id IS NULL)
    )
    AND (
      provider IN ('outscraper', 'apollo') OR paid_candidate_evidence_id IS NULL
    )
  );

-- C1/Architecture correction 1: freeze-time evidence pinning on the immutable
-- cohort/decision snapshot.
ALTER TABLE sfp_cohort_decisions
  ADD COLUMN IF NOT EXISTS classification_evidence_id UUID REFERENCES sfp_classification_evidence(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS classification_policy_version INTEGER;
