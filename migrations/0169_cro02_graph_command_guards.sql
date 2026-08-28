-- CRO-02 graph decision history and typed classification-command evidence.
ALTER TABLE commercial_classification_commands
  ADD COLUMN IF NOT EXISTS evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION cro02_supersedable_decision_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CRO02_DECISION_IMMUTABLE'; END IF;
  IF to_jsonb(NEW) - 'superseded_at' IS DISTINCT FROM to_jsonb(OLD) - 'superseded_at'
     OR OLD.superseded_at IS NOT NULL
     OR NEW.superseded_at IS NULL
     OR NEW.superseded_at < OLD.created_at THEN
    RAISE EXCEPTION 'CRO02_DECISION_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cro02_link_decision_guard ON contact_business_link_decisions;
CREATE TRIGGER cro02_link_decision_guard BEFORE UPDATE OR DELETE ON contact_business_link_decisions
  FOR EACH ROW EXECUTE FUNCTION cro02_supersedable_decision_guard();
DROP TRIGGER IF EXISTS cro02_mapping_decision_guard ON legacy_company_mapping_decisions;
CREATE TRIGGER cro02_mapping_decision_guard BEFORE UPDATE OR DELETE ON legacy_company_mapping_decisions
  FOR EACH ROW EXECUTE FUNCTION cro02_supersedable_decision_guard();
DROP TRIGGER IF EXISTS cro02_relationship_review_guard ON commercial_relationship_reviews;
CREATE TRIGGER cro02_relationship_review_guard BEFORE UPDATE OR DELETE ON commercial_relationship_reviews
  FOR EACH ROW EXECUTE FUNCTION cro02_supersedable_decision_guard();

DROP TRIGGER IF EXISTS cro02_relationship_candidate_guard ON commercial_relationship_candidates;
CREATE TRIGGER cro02_relationship_candidate_guard BEFORE UPDATE OR DELETE ON commercial_relationship_candidates
  FOR EACH ROW EXECUTE FUNCTION cro02_append_only_guard();

CREATE OR REPLACE FUNCTION cro02_command_immutable_fields_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.subject_type IS DISTINCT FROM OLD.subject_type
     OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
     OR NEW.target_class IS DISTINCT FROM OLD.target_class
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.evidence_fields IS DISTINCT FROM OLD.evidence_fields
     OR NEW.evidence_refs IS DISTINCT FROM OLD.evidence_refs
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.preview_dependency_fingerprint IS DISTINCT FROM OLD.preview_dependency_fingerprint
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.preview_at IS DISTINCT FROM OLD.preview_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'CRO02_COMMAND_IMMUTABLE_FIELDS';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cro02_command_immutable_fields ON commercial_classification_commands;
CREATE TRIGGER cro02_command_immutable_fields BEFORE UPDATE ON commercial_classification_commands
  FOR EACH ROW EXECUTE FUNCTION cro02_command_immutable_fields_guard();

CREATE INDEX IF NOT EXISTS commercial_classification_commands_graph_idx
  ON commercial_classification_commands(status,policy_version,preview_dependency_fingerprint);

-- Authority-edge writers automatically bump a deterministic membership row
-- and both endpoint subject revisions in the writer transaction.
CREATE OR REPLACE FUNCTION cro02_bump_graph_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE edge text; lt text; li integer; rt text; ri integer;
BEGIN
  IF TG_TABLE_NAME='contact_business_link_decisions' THEN
    edge:='contact_business'; lt:='contact'; li:=NEW.contact_id; rt:='business'; ri:=NEW.business_id;
  ELSIF TG_TABLE_NAME='legacy_company_mapping_decisions' THEN
    edge:='legacy_company_business'; lt:='company'; li:=NEW.company_id; rt:='business'; ri:=NEW.business_id;
  ELSIF TG_TABLE_NAME='commercial_relationship_reviews' THEN
    edge:='relationship'; lt:='contact'; li:=NEW.contact_id; rt:='business'; ri:=NEW.business_id;
  ELSIF TG_TABLE_NAME='contact_identity_observations' THEN
    edge:='identity'; lt:='contact'; li:=NEW.contact_id; rt:='contact'; ri:=NEW.contact_id;
  ELSIF TG_TABLE_NAME='contact_merge_redirects' THEN
    edge:='contact_redirect'; lt:='contact'; li:=NEW.deprecated_contact_id; rt:='contact'; ri:=NEW.survivor_contact_id;
  ELSE
    RAISE EXCEPTION 'CRO02_UNKNOWN_MEMBERSHIP_WRITER';
  END IF;
  IF ri IS NULL THEN rt:=lt; ri:=li; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('cro02:node:' || LEAST(lt || ':' || li,rt || ':' || ri)));
  IF lt<>rt OR li<>ri THEN
    PERFORM pg_advisory_xact_lock(hashtext('cro02:node:' || GREATEST(lt || ':' || li,rt || ':' || ri)));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('cro02:membership:' || edge || ':' || LEAST(lt || ':' || li,rt || ':' || ri)));
  IF lt<>rt OR li<>ri THEN
    PERFORM pg_advisory_xact_lock(hashtext('cro02:membership:' || edge || ':' || GREATEST(lt || ':' || li,rt || ':' || ri)));
  END IF;
  INSERT INTO commercial_membership_revisions
    (edge_type,left_subject_type,left_subject_id,right_subject_type,right_subject_id,revision,authority_version,updated_at)
  VALUES(edge,lt,li,rt,ri,1,1,now())
  ON CONFLICT(edge_type,left_subject_type,left_subject_id,right_subject_type,right_subject_id)
  DO UPDATE SET revision=commercial_membership_revisions.revision+1,updated_at=now();
  INSERT INTO commercial_subject_revisions(subject_type,subject_id,revision,authority_version,updated_at)
    VALUES(lt,li,1,1,now())
    ON CONFLICT(subject_type,subject_id) DO UPDATE
      SET revision=commercial_subject_revisions.revision+1,updated_at=now();
  IF lt<>rt OR li<>ri THEN
    INSERT INTO commercial_subject_revisions(subject_type,subject_id,revision,authority_version,updated_at)
      VALUES(rt,ri,1,1,now())
      ON CONFLICT(subject_type,subject_id) DO UPDATE
        SET revision=commercial_subject_revisions.revision+1,updated_at=now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cro02_link_membership_bump ON contact_business_link_decisions;
CREATE TRIGGER cro02_link_membership_bump AFTER INSERT OR UPDATE OF superseded_at ON contact_business_link_decisions
  FOR EACH ROW EXECUTE FUNCTION cro02_bump_graph_membership();
DROP TRIGGER IF EXISTS cro02_mapping_membership_bump ON legacy_company_mapping_decisions;
CREATE TRIGGER cro02_mapping_membership_bump AFTER INSERT OR UPDATE OF superseded_at ON legacy_company_mapping_decisions
  FOR EACH ROW EXECUTE FUNCTION cro02_bump_graph_membership();
DROP TRIGGER IF EXISTS cro02_review_membership_bump ON commercial_relationship_reviews;
CREATE TRIGGER cro02_review_membership_bump AFTER INSERT OR UPDATE OF superseded_at ON commercial_relationship_reviews
  FOR EACH ROW EXECUTE FUNCTION cro02_bump_graph_membership();
DROP TRIGGER IF EXISTS cro02_identity_membership_bump ON contact_identity_observations;
CREATE TRIGGER cro02_identity_membership_bump AFTER INSERT OR UPDATE OF superseded_at ON contact_identity_observations
  FOR EACH ROW EXECUTE FUNCTION cro02_bump_graph_membership();
DROP TRIGGER IF EXISTS cro02_redirect_membership_bump ON contact_merge_redirects;
CREATE TRIGGER cro02_redirect_membership_bump AFTER INSERT OR UPDATE OF active,retired_at ON contact_merge_redirects
  FOR EACH ROW EXECUTE FUNCTION cro02_bump_graph_membership();
