-- CRO-03 source/staging evidence foundation. This migration never enables or
-- invokes a provider; all provider controls remain explicitly disabled.

CREATE TABLE IF NOT EXISTS cro03_source_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  source_system TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03_source_subject_type_chk CHECK (subject_type IN
    ('contact','prospect','sunbiz_entity','sdr_merchant','provider_csv_row','public_web')),
  CONSTRAINT cro03_source_subject_key_chk CHECK (length(btrim(subject_key)) > 0),
  CONSTRAINT cro03_source_subject_unique UNIQUE (subject_type, subject_key)
);

CREATE TABLE IF NOT EXISTS cro03_source_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_subject_id UUID NOT NULL REFERENCES cro03_source_subjects(id) ON DELETE RESTRICT,
  observed_at TIMESTAMPTZ NOT NULL,
  observed_by_actor_type TEXT NOT NULL,
  observed_by_actor_id TEXT,
  provenance JSONB NOT NULL,
  payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  hash_algorithm_version TEXT NOT NULL DEFAULT 'sha256-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03_source_observation_hash_algorithm_chk CHECK (hash_algorithm_version = 'sha256-v1'),
  CONSTRAINT cro03_source_observation_hash_chk CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cro03_source_observation_unique UNIQUE (source_subject_id, payload_hash)
);
CREATE INDEX IF NOT EXISTS cro03_source_observations_subject_observed_idx
  ON cro03_source_observations(source_subject_id, observed_at DESC);

ALTER TABLE cro03_batch_memberships
  ADD COLUMN IF NOT EXISTS source_subject_id UUID REFERENCES cro03_source_subjects(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_observation_id UUID REFERENCES cro03_source_observations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_recipe_key TEXT,
  ADD COLUMN IF NOT EXISTS source_recipe_version INTEGER;
CREATE INDEX IF NOT EXISTS cro03_membership_source_subject_idx
  ON cro03_batch_memberships(source_subject_id, created_at);

CREATE TABLE IF NOT EXISTS cro03_normalized_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_observation_id UUID NOT NULL REFERENCES cro03_source_observations(id) ON DELETE RESTRICT,
  field TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  display_value TEXT NOT NULL,
  value_hash TEXT NOT NULL,
  hash_algorithm_version TEXT NOT NULL DEFAULT 'sha256-v1',
  normalization_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03_normalized_candidate_field_chk CHECK (field IN
    ('business_name','website','email','phone','address','city','state','postal_code',
     'category','owner_name','owner_title','registry_id','entity_status',
     'domain_registrant','classification','summary')),
  CONSTRAINT cro03_normalized_candidate_value_chk CHECK (length(normalized_value) > 0),
  CONSTRAINT cro03_normalized_candidate_hash_algorithm_chk CHECK (hash_algorithm_version = 'sha256-v1'),
  CONSTRAINT cro03_normalized_candidate_hash_chk CHECK (value_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cro03_normalized_candidate_unique UNIQUE (source_observation_id, field, value_hash)
);
CREATE INDEX IF NOT EXISTS cro03_normalized_candidates_field_hash_idx
  ON cro03_normalized_candidates(field, value_hash);

CREATE TABLE IF NOT EXISTS cro03_candidate_dispositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES cro03_normalized_candidates(id) ON DELETE RESTRICT,
  disposition TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  decided_by_actor_type TEXT NOT NULL,
  decided_by_actor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03_candidate_disposition_chk CHECK (disposition IN
    ('staged','accepted','rejected','duplicate','quarantined','excluded','superseded')),
  CONSTRAINT cro03_candidate_disposition_reason_chk CHECK (length(btrim(reason_code)) > 0)
);
CREATE INDEX IF NOT EXISTS cro03_candidate_dispositions_candidate_created_idx
  ON cro03_candidate_dispositions(candidate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cro03_staging_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'disabled',
  geography_policy JSONB NOT NULL,
  fit_policy JSONB NOT NULL,
  provenance_policy JSONB NOT NULL,
  exclusion_policy JSONB NOT NULL,
  duplicate_policy JSONB NOT NULL,
  quarantine_policy JSONB NOT NULL,
  purpose_policy JSONB NOT NULL,
  actor_policy JSONB NOT NULL,
  route_policy JSONB NOT NULL,
  cost_policy JSONB NOT NULL,
  hash_algorithm_version TEXT NOT NULL DEFAULT 'sha256-v1',
  recipe_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cro03_staging_recipe_status_chk CHECK (status = 'disabled'),
  CONSTRAINT cro03_staging_recipe_hash_algorithm_chk CHECK (hash_algorithm_version = 'sha256-v1'),
  CONSTRAINT cro03_staging_recipe_hash_chk CHECK (recipe_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cro03_staging_recipe_version_unique UNIQUE (recipe_key, version)
);

INSERT INTO cro03_staging_recipes (
  recipe_key, version, geography_policy, fit_policy, provenance_policy,
  exclusion_policy, duplicate_policy, quarantine_policy, purpose_policy,
  actor_policy, route_policy, cost_policy, recipe_hash
) VALUES (
  'south_florida_staging', 1,
  '{"states":["FL"],"counties":["Miami-Dade","Broward","Palm Beach"],"mode":"allowlist"}',
  '{"mode":"evidence_only","minimumEvidence":1}',
  '{"requireObservation":true,"allowedSubjectTypes":["contact","prospect","sunbiz_entity","sdr_merchant","provider_csv_row","public_web"]}',
  '{"excludeDoNotContact":true,"excludeExistingCustomer":true}',
  '{"strategy":"hash_then_review","fields":["email","phone","website","registry_id"]}',
  '{"default":"quarantined","releaseRequires":"reviewed_disposition"}',
  '{"allowed":["provider_pre_spend","staging_review"],"default":"staging_review"}',
  '{"requireActor":true,"allowedActorTypes":["user","system","import"]}',
  '{"providers":[],"execution":"disabled","requiresFrozenEvidence":true}',
  '{"currency":"USD","maxAmountMicros":0,"providerSpendAllowed":false}',
  'acb953300783e95cd61c8ad18f068d13233a587d99fb4dae4d9999982b8a38cc'
) ON CONFLICT (recipe_key, version) DO NOTHING;

-- Evidence rows are journal records. They cannot be edited, deleted, or
-- converted into an execution recipe after insertion.
DROP TRIGGER IF EXISTS cro03_source_subject_immutable ON cro03_source_subjects;
CREATE TRIGGER cro03_source_subject_immutable BEFORE UPDATE OR DELETE ON cro03_source_subjects
  FOR EACH ROW EXECUTE FUNCTION cro03_immutable_row_guard();
DROP TRIGGER IF EXISTS cro03_source_observation_immutable ON cro03_source_observations;
CREATE TRIGGER cro03_source_observation_immutable BEFORE UPDATE OR DELETE ON cro03_source_observations
  FOR EACH ROW EXECUTE FUNCTION cro03_immutable_row_guard();
DROP TRIGGER IF EXISTS cro03_normalized_candidate_immutable ON cro03_normalized_candidates;
CREATE TRIGGER cro03_normalized_candidate_immutable BEFORE UPDATE OR DELETE ON cro03_normalized_candidates
  FOR EACH ROW EXECUTE FUNCTION cro03_immutable_row_guard();
DROP TRIGGER IF EXISTS cro03_candidate_disposition_immutable ON cro03_candidate_dispositions;
CREATE TRIGGER cro03_candidate_disposition_immutable BEFORE UPDATE OR DELETE ON cro03_candidate_dispositions
  FOR EACH ROW EXECUTE FUNCTION cro03_immutable_row_guard();
DROP TRIGGER IF EXISTS cro03_staging_recipe_immutable ON cro03_staging_recipes;
CREATE TRIGGER cro03_staging_recipe_immutable BEFORE UPDATE OR DELETE ON cro03_staging_recipes
  FOR EACH ROW EXECUTE FUNCTION cro03_immutable_row_guard();

UPDATE provider_controls
   SET enabled = FALSE, updated_at = NOW()
 WHERE provider IN ('apollo', 'outscraper', 'serper', 'zerobounce');