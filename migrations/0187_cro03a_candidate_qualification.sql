-- CRO-03A South Florida candidate qualification.
-- This migration is intentionally additive/forward-only. It owns source
-- evidence, qualification decisions, and the effect-denied handoff only.

ALTER TABLE cro03_source_subjects
  DROP CONSTRAINT IF EXISTS cro03_source_subject_unique;
ALTER TABLE cro03_source_subjects
  DROP CONSTRAINT IF EXISTS cro03_source_subject_type_chk;
ALTER TABLE cro03_source_subjects
  ADD CONSTRAINT cro03_source_subject_type_chk CHECK (subject_type IN
    ('contact','prospect','sunbiz_entity','sdr_merchant','provider_csv_row',
     'public_web','lead_discovery_result','master_lead')),
  ADD CONSTRAINT cro03_source_subject_unique UNIQUE (subject_type, source_system, subject_key);

CREATE TABLE IF NOT EXISTS cro03_source_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_subject_id UUID NOT NULL REFERENCES cro03_source_subjects(id) ON DELETE RESTRICT,
  source_observation_id UUID NOT NULL REFERENCES cro03_source_observations(id) ON DELETE RESTRICT,
  source_observed_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  timestamp_provenance TEXT NOT NULL,
  source_event_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL DEFAULT 'cro03a-source-v1',
  normalization_version INTEGER NOT NULL DEFAULT 1,
  hash_algorithm_version TEXT NOT NULL DEFAULT 'sha256-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03a_occurrence_hash_chk CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cro03a_occurrence_hash_algorithm_chk CHECK (hash_algorithm_version = 'sha256-v1'),
  CONSTRAINT cro03a_occurrence_timestamp_provenance_chk CHECK (length(btrim(timestamp_provenance)) > 0),
  CONSTRAINT cro03a_occurrence_event_key_chk CHECK (length(btrim(source_event_key)) > 0),
  CONSTRAINT cro03a_occurrence_source_event_uidx UNIQUE (source_subject_id, source_event_key)
);
CREATE INDEX IF NOT EXISTS cro03a_occurrences_subject_time_idx
  ON cro03_source_occurrences(source_subject_id, source_observed_at DESC, ingested_at DESC);

CREATE TABLE IF NOT EXISTS cro03a_policy_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  policy JSONB NOT NULL,
  policy_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03a_policy_status_chk CHECK (status IN ('draft','active','retired')),
  CONSTRAINT cro03a_policy_hash_chk CHECK (policy_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cro03a_policy_identity_uidx UNIQUE (policy_key, version)
);

CREATE TABLE IF NOT EXISTS cro03a_policy_control (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active_policy_id UUID REFERENCES cro03a_policy_documents(id) ON DELETE RESTRICT,
  expected_version INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO cro03a_policy_control(id, expected_version)
VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS cro03a_qualification_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  policy_id UUID NOT NULL REFERENCES cro03a_policy_documents(id) ON DELETE RESTRICT,
  policy_hash TEXT NOT NULL,
  scope_hash TEXT NOT NULL,
  frozen_occurrence_ids JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  total_count INTEGER NOT NULL DEFAULT 0,
  selected_count INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  terminal_count INTEGER NOT NULL DEFAULT 0,
  cursor_position INTEGER NOT NULL DEFAULT 0,
  cancel_requested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03a_run_state_chk CHECK (state IN ('queued','running','completed','cancelled','failed')),
  CONSTRAINT cro03a_run_counts_chk CHECK (total_count >= 0 AND selected_count >= 0 AND review_count >= 0 AND terminal_count >= 0)
);

CREATE TABLE IF NOT EXISTS cro03a_qualification_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES cro03a_qualification_runs(id) ON DELETE RESTRICT,
  occurrence_id UUID NOT NULL REFERENCES cro03_source_occurrences(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  execution_fence INTEGER NOT NULL DEFAULT 0,
  authority_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  authority_evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03a_item_state_chk CHECK (state IN ('queued','claimed','completed','cancelled')),
  CONSTRAINT cro03a_item_run_occurrence_uidx UNIQUE (run_id, occurrence_id),
  CONSTRAINT cro03a_item_run_ordinal_uidx UNIQUE (run_id, ordinal)
);

CREATE TABLE IF NOT EXISTS cro03a_qualification_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL UNIQUE REFERENCES cro03a_qualification_items(id) ON DELETE RESTRICT,
  run_id UUID NOT NULL REFERENCES cro03a_qualification_runs(id) ON DELETE RESTRICT,
  occurrence_id UUID NOT NULL REFERENCES cro03_source_occurrences(id) ON DELETE RESTRICT,
  disposition TEXT NOT NULL,
  score INTEGER NOT NULL,
  geography_result JSONB NOT NULL,
  vertical_result JSONB NOT NULL,
  active_state_evidence JSONB NOT NULL,
  identity_relationship_evidence JSONB NOT NULL,
  fit_components JSONB NOT NULL,
  reason_codes JSONB NOT NULL,
  missing_field_classes JSONB NOT NULL DEFAULT '[]'::jsonb,
  frozen_occurrence_ids JSONB NOT NULL,
  policy_id UUID NOT NULL REFERENCES cro03a_policy_documents(id) ON DELETE RESTRICT,
  policy_version INTEGER NOT NULL,
  policy_hash TEXT NOT NULL,
  selection_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03a_decision_disposition_chk CHECK (disposition IN
    ('selected','review_required','duplicate','existing_relationship','outside_geography',
     'suppressed','inactive_entity','insufficient_evidence','excluded')),
  CONSTRAINT cro03a_decision_score_chk CHECK (score BETWEEN 0 AND 100)
);
CREATE INDEX IF NOT EXISTS cro03a_decisions_disposition_idx
  ON cro03a_qualification_decisions(disposition, created_at DESC);

CREATE TABLE IF NOT EXISTS cro03a_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES cro03a_qualification_runs(id) ON DELETE RESTRICT,
  decision_id UUID NOT NULL UNIQUE REFERENCES cro03a_qualification_decisions(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_key TEXT NOT NULL,
  occurrence_ids JSONB NOT NULL,
  policy_id UUID NOT NULL REFERENCES cro03a_policy_documents(id) ON DELETE RESTRICT,
  policy_version INTEGER NOT NULL,
  policy_hash TEXT NOT NULL,
  reason_codes JSONB NOT NULL,
  missing_field_classes JSONB NOT NULL DEFAULT '[]'::jsonb,
  selection_hash TEXT NOT NULL,
  effect_authorized BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03a_handoff_effect_denied_chk CHECK (effect_authorized = FALSE)
);
CREATE INDEX IF NOT EXISTS cro03a_handoffs_source_idx
  ON cro03a_handoffs(source_type, source_system, source_key);
CREATE UNIQUE INDEX IF NOT EXISTS cro03a_handoffs_source_unique
  ON cro03a_handoffs(source_type, source_system, source_key);

CREATE TABLE IF NOT EXISTS cro03a_consumption_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handoff_id UUID NOT NULL REFERENCES cro03a_handoffs(id) ON DELETE RESTRICT,
  consumer_key TEXT NOT NULL UNIQUE,
  consumer_name TEXT NOT NULL DEFAULT 'cro03b',
  receipt_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Policy v1 is immutable and active by explicit admin activation only.
INSERT INTO cro03a_policy_documents
  (policy_key, version, policy, policy_hash, status, created_by)
VALUES
  ('south_florida_candidate_qualification', 1,
   '{"geographyReferenceVersion":"south-florida-fips-v1","counties":{"Broward":"12011","Miami-Dade":"12086","Palm Beach":"12099"},"disabledCounties":{"Monroe":"12087"},"verticalAlgorithmVersion":"v1","subverticalMapVersion":"1","fitVersion":"v1","targetVerticals":["Auto","Healthcare","Salon/Spa"],"selectedMinimum":70,"reviewMinimum":50,"freshnessDays":90,"sourceCensus":["prospects","sunbiz_entities","provider_csv_rows","sdr_merchants","lead_discovery_results","master_leads","public_web"]}'::jsonb,
   'c8e8e64ae1e50c3a56542db8413538f041432100f0852c1e89f7e6f3b2a91cac',
   'active', 'system')
ON CONFLICT (policy_key, version) DO NOTHING;

UPDATE cro03a_policy_control
   SET active_policy_id = (
         SELECT id FROM cro03a_policy_documents
          WHERE policy_key = 'south_florida_candidate_qualification' AND version = 1
       ),
       expected_version = 1,
       updated_by = 'system',
       updated_at = NOW()
 WHERE id = 1 AND active_policy_id IS NULL;

INSERT INTO audit_logs(action,entity_type,entity_key,details,actor_type,actor_id)
SELECT 'cro03a_policy_activated','cro03a_policy',p.id::text,
       jsonb_build_object('reason','initial governed policy activation',
                          'policyVersion',p.version,'policyHash',p.policy_hash,
                          'controlVersion',1),
       'system','system'
  FROM cro03a_policy_documents p
 WHERE p.policy_key='south_florida_candidate_qualification' AND p.version=1
   AND NOT EXISTS (
     SELECT 1 FROM audit_logs a
      WHERE a.action='cro03a_policy_activated' AND a.entity_key=p.id::text
   );

CREATE OR REPLACE FUNCTION cro03a_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRO03A_APPEND_ONLY:%', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS cro03a_occurrences_immutable ON cro03_source_occurrences;
CREATE TRIGGER cro03a_occurrences_immutable BEFORE UPDATE OR DELETE ON cro03_source_occurrences
  FOR EACH ROW EXECUTE FUNCTION cro03a_append_only_guard();
DROP TRIGGER IF EXISTS cro03a_policy_documents_immutable ON cro03a_policy_documents;
CREATE TRIGGER cro03a_policy_documents_immutable BEFORE UPDATE OR DELETE ON cro03a_policy_documents
  FOR EACH ROW EXECUTE FUNCTION cro03a_append_only_guard();
DROP TRIGGER IF EXISTS cro03a_decisions_immutable ON cro03a_qualification_decisions;
CREATE TRIGGER cro03a_decisions_immutable BEFORE UPDATE OR DELETE ON cro03a_qualification_decisions
  FOR EACH ROW EXECUTE FUNCTION cro03a_append_only_guard();
DROP TRIGGER IF EXISTS cro03a_handoffs_immutable ON cro03a_handoffs;
CREATE TRIGGER cro03a_handoffs_immutable BEFORE UPDATE OR DELETE ON cro03a_handoffs
  FOR EACH ROW EXECUTE FUNCTION cro03a_append_only_guard();
DROP TRIGGER IF EXISTS cro03a_consumption_receipts_immutable ON cro03a_consumption_receipts;
CREATE TRIGGER cro03a_consumption_receipts_immutable BEFORE UPDATE OR DELETE ON cro03a_consumption_receipts
  FOR EACH ROW EXECUTE FUNCTION cro03a_append_only_guard();