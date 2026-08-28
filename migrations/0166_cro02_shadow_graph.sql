-- CRO-02 is deliberately shadow-only.  This migration creates no rows and
-- changes no legacy decision or record_class projection.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS record_class text NOT NULL DEFAULT 'unknown'
  CHECK (record_class IN ('production','test','demo','synthetic','unknown'));
CREATE TABLE IF NOT EXISTS commercial_subject_revisions (
  subject_type text NOT NULL CHECK (subject_type IN ('contact','deal','prospect','company','business')),
  subject_id integer NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  authority_version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_type, subject_id)
);
CREATE TABLE IF NOT EXISTS commercial_membership_revisions (
  edge_type text NOT NULL CHECK (edge_type IN ('contact_business','legacy_company_business','contact_redirect','identity','relationship')),
  left_subject_type text NOT NULL, left_subject_id integer NOT NULL,
  right_subject_type text NOT NULL, right_subject_id integer NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  authority_version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (edge_type,left_subject_type,left_subject_id,right_subject_type,right_subject_id)
);
CREATE TABLE IF NOT EXISTS contact_business_link_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id integer NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  business_id integer REFERENCES businesses(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('verified','missing','conflicted','legacy_unknown','rejected')),
  decision_key text NOT NULL UNIQUE, actor_id text, revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), superseded_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS contact_business_link_current_uidx ON contact_business_link_decisions(contact_id)
 WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS contact_business_link_business_current_idx ON contact_business_link_decisions(business_id) WHERE superseded_at IS NULL;
CREATE TABLE IF NOT EXISTS legacy_company_mapping_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id integer NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  business_id integer REFERENCES businesses(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('verified','conflicted','legacy_unknown','rejected')),
  decision_key text NOT NULL UNIQUE, actor_id text, revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), superseded_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_company_mapping_current_uidx ON legacy_company_mapping_decisions(company_id) WHERE superseded_at IS NULL;
CREATE TABLE IF NOT EXISTS commercial_relationship_candidates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id integer NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
 business_id integer NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT, source text NOT NULL, source_version text,
 confidence integer NOT NULL CHECK (confidence BETWEEN 0 AND 100), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS commercial_relationship_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id integer NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
 business_id integer NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
 decision text NOT NULL CHECK (decision IN ('decision_maker','not_decision_maker','unknown','conflicted')),
 review_key text NOT NULL UNIQUE, actor_id text NOT NULL, revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), superseded_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS commercial_relationship_review_current_uidx ON commercial_relationship_reviews(contact_id,business_id) WHERE superseded_at IS NULL;
CREATE TABLE IF NOT EXISTS commercial_resolution_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requested_subject_type text NOT NULL, requested_subject_id integer NOT NULL,
 effective_subject_type text NOT NULL, effective_subject_id integer NOT NULL, purpose text NOT NULL,
 policy_version integer NOT NULL, schema_version integer NOT NULL DEFAULT 1,
 mode text NOT NULL CHECK(mode IN ('shadow','compare','enforce')) DEFAULT 'shadow',
 resolution text NOT NULL CHECK(resolution IN ('allowed','quarantined')),
 record_class text NOT NULL CHECK(record_class IN ('production','test','demo','synthetic','unknown')),
 provenance_resolution text NOT NULL CHECK(provenance_resolution IN ('verified','untraceable','legacy_unknown','conflicted','invalid')),
 identity_resolution text NOT NULL CHECK(identity_resolution IN ('resolved','unresolved','collision','conflicted','legacy_unknown')),
 organization_link_resolution text NOT NULL CHECK(organization_link_resolution IN ('verified','missing','conflicted','legacy_unknown','rejected')),
 relationship_resolution text NOT NULL CHECK(relationship_resolution IN ('decision_maker','not_decision_maker','unknown','conflicted')),
 reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb, dependency_fingerprint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commercial_resolution_snapshot_subject_idx ON commercial_resolution_snapshots(effective_subject_type,effective_subject_id,purpose,created_at);
CREATE TABLE IF NOT EXISTS commercial_resolution_dependencies (
 snapshot_id uuid NOT NULL REFERENCES commercial_resolution_snapshots(id) ON DELETE RESTRICT,
 object_type text NOT NULL, object_id text NOT NULL, revision integer NOT NULL, authority_version integer NOT NULL,
 rank integer NOT NULL, PRIMARY KEY(snapshot_id,object_type,object_id)
);
CREATE TABLE IF NOT EXISTS commercial_evidence_references (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), snapshot_id uuid REFERENCES commercial_resolution_snapshots(id) ON DELETE RESTRICT,
 classification_event_id integer REFERENCES commercial_classification_events(id) ON DELETE RESTRICT,
 contact_source_event_id integer REFERENCES contact_source_events(id) ON DELETE RESTRICT,
 import_row_disposition_id integer REFERENCES import_row_dispositions(id) ON DELETE RESTRICT,
 identity_observation_id uuid REFERENCES contact_identity_observations(id) ON DELETE RESTRICT,
 merge_operation_id uuid REFERENCES contact_merge_operations(id) ON DELETE RESTRICT,
 merge_redirect_id uuid REFERENCES contact_merge_redirects(id) ON DELETE RESTRICT,
 business_link_decision_id uuid REFERENCES contact_business_link_decisions(id) ON DELETE RESTRICT,
 legacy_company_mapping_decision_id uuid REFERENCES legacy_company_mapping_decisions(id) ON DELETE RESTRICT,
 relationship_review_id uuid REFERENCES commercial_relationship_reviews(id) ON DELETE RESTRICT,
 CHECK (num_nonnulls(classification_event_id,contact_source_event_id,import_row_disposition_id,identity_observation_id,merge_operation_id,merge_redirect_id,business_link_decision_id,legacy_company_mapping_decision_id,relationship_review_id)=1)
);
CREATE TABLE IF NOT EXISTS commercial_purpose_policies (
 purpose text PRIMARY KEY, policy_version integer NOT NULL, required_edges jsonb NOT NULL DEFAULT '{}'::jsonb,
 mode text NOT NULL DEFAULT 'shadow' CHECK(mode IN ('shadow','compare','enforce')), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS commercial_shadow_controls (
 control_key text PRIMARY KEY DEFAULT 'commercial', mode text NOT NULL DEFAULT 'shadow' CHECK(mode='shadow'),
 schema_version integer NOT NULL DEFAULT 1, coverage_high_water bigint NOT NULL DEFAULT 0,
 approved_discrepancy_threshold numeric, release_sha text, rollback_marker text NOT NULL DEFAULT 'legacy-effective',
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO commercial_shadow_controls(control_key) VALUES ('commercial') ON CONFLICT DO NOTHING;
ALTER TABLE eligibility_snapshots ADD COLUMN IF NOT EXISTS commercial_resolution_snapshot_id uuid REFERENCES commercial_resolution_snapshots(id) ON DELETE RESTRICT;
ALTER TABLE commercial_classification_commands
 ADD COLUMN IF NOT EXISTS payload_hash text,
 ADD COLUMN IF NOT EXISTS preview_dependency_fingerprint text,
 ADD COLUMN IF NOT EXISTS policy_version integer NOT NULL DEFAULT 1,
 ADD COLUMN IF NOT EXISTS executor_id text,
 ADD COLUMN IF NOT EXISTS execution_fence integer NOT NULL DEFAULT 0;