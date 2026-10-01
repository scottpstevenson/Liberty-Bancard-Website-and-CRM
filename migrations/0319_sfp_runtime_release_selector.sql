-- Routine SFP ownership is admitted only for an explicitly selected,
-- non-expiring release/deployment tuple. This authority is separate from
-- CRO03C certificates, fleet inventory, and provider operational health.
CREATE TABLE sfp_runtime_release_selectors (
  authority_key TEXT PRIMARY KEY DEFAULT 'routine_sfp',
  deployment_identity TEXT NOT NULL,
  environment_identity TEXT NOT NULL,
  artifact_sha TEXT NOT NULL,
  queue_topology_hash TEXT NOT NULL,
  publisher_verified_artifact_sha TEXT NOT NULL,
  publisher_verified_deployment_identity TEXT NOT NULL,
  verification_reference TEXT NOT NULL,
  selected_by TEXT NOT NULL,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  selection_version BIGINT NOT NULL DEFAULT 1,
  selection_event_id UUID NOT NULL,
  CONSTRAINT sfp_runtime_release_selector_singleton_chk
    CHECK (authority_key = 'routine_sfp'),
  CONSTRAINT sfp_runtime_release_selector_sha_chk
    CHECK (artifact_sha ~ '^[0-9a-fA-F]{40}$'
       AND publisher_verified_artifact_sha = artifact_sha),
  CONSTRAINT sfp_runtime_release_selector_deployment_chk
    CHECK (deployment_identity <> ''
       AND publisher_verified_deployment_identity = deployment_identity),
  CONSTRAINT sfp_runtime_release_selector_environment_chk CHECK (environment_identity <> ''),
  CONSTRAINT sfp_runtime_release_selector_topology_chk
    CHECK (queue_topology_hash ~ '^[0-9a-fA-F]{64}$'),
  CONSTRAINT sfp_runtime_release_selector_verification_chk
    CHECK (length(btrim(verification_reference)) BETWEEN 1 AND 500),
  CONSTRAINT sfp_runtime_release_selector_actor_chk CHECK (length(btrim(selected_by)) > 0),
  CONSTRAINT sfp_runtime_release_selector_version_chk CHECK (selection_version > 0)
);

-- Append-only bootstrap/transfer evidence. The selector has no expiry and is
-- changed only by the authenticated SFP runtime-release admin control.
CREATE TABLE sfp_runtime_release_selection_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL CHECK (action IN ('bootstrap', 'transfer')),
  actor_id TEXT NOT NULL,
  previous_selection JSONB,
  selected_release JSONB NOT NULL,
  publisher_verification_reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sfp_runtime_release_selection_event_actor_chk CHECK (length(btrim(actor_id)) > 0),
  CONSTRAINT sfp_runtime_release_selection_event_verification_chk
    CHECK (length(btrim(publisher_verification_reference)) BETWEEN 1 AND 500),
  CONSTRAINT sfp_runtime_release_selection_event_release_object_chk
    CHECK (jsonb_typeof(selected_release) = 'object'),
  CONSTRAINT sfp_runtime_release_selection_event_previous_object_chk
    CHECK (previous_selection IS NULL OR jsonb_typeof(previous_selection) = 'object')
);
CREATE INDEX sfp_runtime_release_selection_events_created_idx
  ON sfp_runtime_release_selection_events(created_at DESC);

ALTER TABLE sfp_runtime_release_selectors
  ADD CONSTRAINT sfp_runtime_release_selectors_selection_event_id_sfp_runtime_release_selection_events_id_fk
  FOREIGN KEY (selection_event_id) REFERENCES sfp_runtime_release_selection_events(id) ON DELETE RESTRICT;

CREATE FUNCTION guard_sfp_runtime_release_selector_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evidence sfp_runtime_release_selection_events%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SFP_RUNTIME_RELEASE_SELECTOR_DELETE_FORBIDDEN';
  END IF;
  SELECT * INTO evidence
    FROM sfp_runtime_release_selection_events
   WHERE id=NEW.selection_event_id
   FOR SHARE;
  IF NOT FOUND
     OR evidence.actor_id IS DISTINCT FROM NEW.selected_by
     OR evidence.publisher_verification_reference IS DISTINCT FROM NEW.verification_reference
     OR evidence.selected_release->>'artifactSha' IS DISTINCT FROM NEW.artifact_sha
     OR evidence.selected_release->>'deploymentIdentity' IS DISTINCT FROM NEW.deployment_identity
     OR evidence.selected_release->>'environmentIdentity' IS DISTINCT FROM NEW.environment_identity
     OR evidence.selected_release->>'queueTopologyHash' IS DISTINCT FROM NEW.queue_topology_hash
     OR evidence.selected_release->>'publisherVerifiedArtifactSha' IS DISTINCT FROM NEW.publisher_verified_artifact_sha
     OR evidence.selected_release->>'publisherVerifiedDeploymentIdentity' IS DISTINCT FROM NEW.publisher_verified_deployment_identity
     OR evidence.selected_release->>'verificationReference' IS DISTINCT FROM NEW.verification_reference
     OR evidence.selected_release->>'selectionVersion' IS DISTINCT FROM NEW.selection_version::text THEN
    RAISE EXCEPTION 'SFP_RUNTIME_RELEASE_SELECTOR_AUDIT_EVIDENCE_MISMATCH';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF evidence.action <> 'bootstrap'
       OR evidence.previous_selection IS NOT NULL
       OR NEW.selection_version <> 1 THEN
      RAISE EXCEPTION 'SFP_RUNTIME_RELEASE_SELECTOR_BOOTSTRAP_EVIDENCE_INVALID';
    END IF;
  ELSE
    IF evidence.action <> 'transfer'
       OR NEW.selection_version <> OLD.selection_version + 1
       OR evidence.previous_selection->>'artifactSha' IS DISTINCT FROM OLD.artifact_sha
       OR evidence.previous_selection->>'deploymentIdentity' IS DISTINCT FROM OLD.deployment_identity
       OR evidence.previous_selection->>'environmentIdentity' IS DISTINCT FROM OLD.environment_identity
       OR evidence.previous_selection->>'queueTopologyHash' IS DISTINCT FROM OLD.queue_topology_hash
       OR evidence.previous_selection->>'selectionVersion' IS DISTINCT FROM OLD.selection_version::text
       OR evidence.previous_selection->>'selectionEventId' IS DISTINCT FROM OLD.selection_event_id::text THEN
      RAISE EXCEPTION 'SFP_RUNTIME_RELEASE_SELECTOR_TRANSFER_EVIDENCE_INVALID';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sfp_runtime_release_selector_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sfp_runtime_release_selectors
  FOR EACH ROW EXECUTE FUNCTION guard_sfp_runtime_release_selector_mutation();

CREATE FUNCTION reject_sfp_runtime_release_selection_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SFP_RUNTIME_RELEASE_SELECTION_EVENT_IMMUTABLE';
END;
$$;

CREATE TRIGGER sfp_runtime_release_selection_events_immutable
  BEFORE UPDATE OR DELETE ON sfp_runtime_release_selection_events
  FOR EACH ROW EXECUTE FUNCTION reject_sfp_runtime_release_selection_event_mutation();