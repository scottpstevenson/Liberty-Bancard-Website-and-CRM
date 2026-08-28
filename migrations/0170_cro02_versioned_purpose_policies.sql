-- Frozen CRO-02 v1 executable purpose policies. New behavior requires a new
-- policy_version row; historical rows are immutable.
ALTER TABLE commercial_purpose_policies DROP CONSTRAINT IF EXISTS commercial_purpose_policies_pkey;
ALTER TABLE commercial_purpose_policies ADD PRIMARY KEY (purpose,policy_version);
ALTER TABLE commercial_classification_commands
  ADD COLUMN IF NOT EXISTS purpose_policy_fingerprint text;

CREATE OR REPLACE FUNCTION cro02_purpose_policy_immutable_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRO02_PURPOSE_POLICY_IMMUTABLE';
END $$;

CREATE OR REPLACE FUNCTION cro02_command_immutable_fields_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.subject_type IS DISTINCT FROM OLD.subject_type
     OR NEW.subject_id IS DISTINCT FROM OLD.subject_id OR NEW.target_class IS DISTINCT FROM OLD.target_class
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.evidence_fields IS DISTINCT FROM OLD.evidence_fields
     OR NEW.evidence_refs IS DISTINCT FROM OLD.evidence_refs OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.preview_dependency_fingerprint IS DISTINCT FROM OLD.preview_dependency_fingerprint
     OR NEW.purpose_policy_fingerprint IS DISTINCT FROM OLD.purpose_policy_fingerprint
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version OR NEW.preview_at IS DISTINCT FROM OLD.preview_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'CRO02_COMMAND_IMMUTABLE_FIELDS'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cro02_purpose_policy_immutable ON commercial_purpose_policies;
CREATE TRIGGER cro02_purpose_policy_immutable BEFORE UPDATE OR DELETE ON commercial_purpose_policies
  FOR EACH ROW EXECUTE FUNCTION cro02_purpose_policy_immutable_guard();

DO $$
DECLARE
  base jsonb := '{"schemaVersion":1,"allowedClasses":["production"],"allowUnknownWithInboundBinding":false,"testEnvironmentOnly":false,"axes":{"provenance":"optional","identity":"optional","organizationLink":"optional","relationship":"optional"},"edges":{"dealRoots":{"required":false,"min":0,"max":null},"prospectContact":{"required":false,"min":0,"max":null},"contactBusiness":{"required":false,"min":0,"max":null},"companyBusiness":{"required":false,"min":0,"max":null},"relationshipReviews":{"required":false,"min":0,"max":null}}}';
  marketing jsonb := '{"schemaVersion":1,"allowedClasses":["production"],"allowUnknownWithInboundBinding":false,"testEnvironmentOnly":false,"axes":{"provenance":"optional","identity":"optional","organizationLink":"required","relationship":"required"},"edges":{"dealRoots":{"required":true,"min":1,"max":2},"prospectContact":{"required":false,"min":0,"max":null},"contactBusiness":{"required":true,"min":1,"max":1},"companyBusiness":{"required":true,"min":1,"max":1},"relationshipReviews":{"required":true,"min":1,"max":1}}}';
  prespend jsonb := '{"schemaVersion":1,"allowedClasses":["production"],"allowUnknownWithInboundBinding":false,"testEnvironmentOnly":false,"axes":{"provenance":"required","identity":"required","organizationLink":"required","relationship":"optional"},"edges":{"dealRoots":{"required":true,"min":1,"max":2},"prospectContact":{"required":false,"min":0,"max":null},"contactBusiness":{"required":true,"min":1,"max":1},"companyBusiness":{"required":true,"min":1,"max":1},"relationshipReviews":{"required":false,"min":0,"max":null}}}';
  inbound jsonb := base || '{"allowUnknownWithInboundBinding":true}'::jsonb;
  test_policy jsonb := base || '{"allowedClasses":["test","demo","synthetic","unknown"],"testEnvironmentOnly":true}'::jsonb;
  item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('inbound_transactional_acknowledgement',inbound),
    ('account_transactional',base),
    ('internal_notification',base),
    ('marketing_outreach',marketing),
    ('commercial_reporting',base),
    ('financial_payout',base),
    ('provider_pre_spend',prespend),
    ('internal_test',test_policy)
  ) AS expected(purpose,document)
  LOOP
    INSERT INTO commercial_purpose_policies(purpose,policy_version,required_edges,mode)
      VALUES(item.purpose,1,item.document,'shadow') ON CONFLICT DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM commercial_purpose_policies
      WHERE purpose=item.purpose AND policy_version=1 AND mode='shadow' AND required_edges=item.document) THEN
      RAISE EXCEPTION 'CRO02_PURPOSE_POLICY_DIVERGENCE:%',item.purpose;
    END IF;
  END LOOP;
END $$;
