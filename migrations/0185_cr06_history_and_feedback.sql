-- CR-06 strict-review corrections 3 and 4.
-- Frozen campaign evidence is append-only; mutable execution rows expose only
-- the small, enumerated transitions needed by their owning commands.

ALTER TABLE cr06_preparation_runs
  ADD COLUMN IF NOT EXISTS receipt JSONB,
  ADD COLUMN IF NOT EXISTS receipt_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE cr06_prepared_enrollments
  ADD COLUMN IF NOT EXISTS sequence_enrollment_id INTEGER REFERENCES sequence_enrollments(id) ON DELETE RESTRICT;

ALTER TABLE cr06_manual_task_intents
  ADD COLUMN IF NOT EXISTS dependency_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dependency_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE cr06_feedback_receipts
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS effect_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS cr06_campaign_gate_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_gate_id UUID NOT NULL REFERENCES cr06_campaign_gates(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  dependency_snapshot JSONB NOT NULL,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cr06_campaign_gate_revision_state_chk CHECK (state IN ('closed','open')),
  CONSTRAINT cr06_campaign_gate_revision_uidx UNIQUE (campaign_gate_id,revision)
);

ALTER TABLE cr06_feedback_receipts DROP CONSTRAINT IF EXISTS cr06_feedback_receipt_event_type_chk;
ALTER TABLE cr06_feedback_receipts ADD CONSTRAINT cr06_feedback_receipt_event_type_chk
  CHECK (event_type IN (
    'delivered','hard_bounce','soft_bounce','complaint','unsubscribe',
    'provider_rejected','provider_failed','replied'
  )) NOT VALID;
ALTER TABLE cr06_feedback_receipts ADD CONSTRAINT cr06_feedback_payload_allowlist_chk CHECK (
  jsonb_typeof(payload) = 'object'
  AND (payload - ARRAY['provider','providerMessageId','occurredAt','reasonCode','diagnosticCode','smtpStatus']::text[]) = '{}'::jsonb
  AND (NOT (payload ? 'provider') OR jsonb_typeof(payload->'provider') = 'string')
  AND (NOT (payload ? 'providerMessageId') OR jsonb_typeof(payload->'providerMessageId') = 'string')
  AND (NOT (payload ? 'occurredAt') OR jsonb_typeof(payload->'occurredAt') = 'string')
  AND (NOT (payload ? 'reasonCode') OR jsonb_typeof(payload->'reasonCode') = 'string')
  AND (NOT (payload ? 'diagnosticCode') OR jsonb_typeof(payload->'diagnosticCode') = 'string')
  AND (NOT (payload ? 'smtpStatus') OR jsonb_typeof(payload->'smtpStatus') = 'number')
) NOT VALID;

ALTER TABLE cr06_attribution_events DROP CONSTRAINT IF EXISTS cr06_attribution_event_type_chk;
ALTER TABLE cr06_attribution_events ADD CONSTRAINT cr06_attribution_event_type_chk CHECK (
  event_type IN (
    'prepared','provider_attempt','sent','delivered','opened','hard_bounce','soft_bounce',
    'complaint','unsubscribe','provider_rejected','provider_failed','replied','manual_outcome'
  )
) NOT VALID;

CREATE OR REPLACE FUNCTION cr06_guard_artifact_history()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_kind TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.record_class <> 'test' OR OLD.governance_state <> 'draft' THEN
      RAISE EXCEPTION 'CR06_HISTORY_DELETE_FORBIDDEN';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.governance_state = 'approved_inactive' AND NEW.governance_state NOT IN ('approved_inactive','retired') THEN
    RAISE EXCEPTION 'CR06_ARTIFACT_STATE_TRANSITION_FORBIDDEN';
  END IF;
  IF OLD.governance_state = 'retired' AND NEW.governance_state <> 'retired' THEN
    RAISE EXCEPTION 'CR06_ARTIFACT_STATE_TRANSITION_FORBIDDEN';
  END IF;
  IF OLD.governance_state IN ('approved_inactive','retired') AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.identity_key IS DISTINCT FROM OLD.identity_key OR
    NEW.artifact_kind IS DISTINCT FROM OLD.artifact_kind OR
    NEW.record_class IS DISTINCT FROM OLD.record_class OR
    NEW.purpose IS DISTINCT FROM OLD.purpose OR
    NEW.version IS DISTINCT FROM OLD.version OR
    NEW.parent_artifact_id IS DISTINCT FROM OLD.parent_artifact_id OR
    NEW.document IS DISTINCT FROM OLD.document OR
    NEW.content_hash IS DISTINCT FROM OLD.content_hash OR
    NEW.dependency_fingerprint IS DISTINCT FROM OLD.dependency_fingerprint OR
    NEW.created_by IS DISTINCT FROM OLD.created_by OR
    NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR
    NEW.approved_at IS DISTINCT FROM OLD.approved_at OR
    NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'CR06_APPROVED_ARTIFACT_IMMUTABLE';
  END IF;
  IF NEW.artifact_kind IS DISTINCT FROM OLD.artifact_kind AND EXISTS (
    SELECT 1 FROM cr06_artifacts child
    WHERE child.parent_artifact_id=OLD.id AND child.governance_state IN ('approved_inactive','retired')
  ) THEN
    RAISE EXCEPTION 'CR06_APPROVED_ARTIFACT_TOPOLOGY_IMMUTABLE';
  END IF;
  IF NEW.governance_state = 'approved_inactive' THEN
    IF NEW.artifact_kind = 'program' AND NEW.parent_artifact_id IS NOT NULL THEN
      RAISE EXCEPTION 'CR06_APPROVED_ARTIFACT_TOPOLOGY_INVALID';
    ELSIF NEW.artifact_kind <> 'program' THEN
      SELECT artifact_kind INTO parent_kind FROM cr06_artifacts WHERE id=NEW.parent_artifact_id;
      IF parent_kind IS NULL
        OR (NEW.artifact_kind IN ('sequence_version','manual_task_definition') AND parent_kind <> 'program')
        OR (NEW.artifact_kind = 'content_version' AND parent_kind <> 'sequence_version') THEN
        RAISE EXCEPTION 'CR06_APPROVED_ARTIFACT_TOPOLOGY_INVALID';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cr06_approved_artifact_guard ON cr06_artifacts;
CREATE TRIGGER cr06_approved_artifact_guard BEFORE UPDATE ON cr06_artifacts
  FOR EACH ROW EXECUTE FUNCTION cr06_guard_artifact_history();

CREATE OR REPLACE FUNCTION cr06_validate_approved_artifact_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_kind TEXT;
BEGIN
  IF NEW.governance_state <> 'approved_inactive' THEN RETURN NEW; END IF;
  IF NEW.artifact_kind='program' AND NEW.parent_artifact_id IS NOT NULL THEN
    RAISE EXCEPTION 'CR06_APPROVED_ARTIFACT_TOPOLOGY_INVALID';
  ELSIF NEW.artifact_kind <> 'program' THEN
    SELECT artifact_kind INTO parent_kind FROM cr06_artifacts WHERE id=NEW.parent_artifact_id;
    IF parent_kind IS NULL
      OR (NEW.artifact_kind IN ('sequence_version','manual_task_definition') AND parent_kind <> 'program')
      OR (NEW.artifact_kind='content_version' AND parent_kind <> 'sequence_version') THEN
      RAISE EXCEPTION 'CR06_APPROVED_ARTIFACT_TOPOLOGY_INVALID';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cr06_approved_artifact_insert_guard ON cr06_artifacts;
CREATE TRIGGER cr06_approved_artifact_insert_guard BEFORE INSERT ON cr06_artifacts
  FOR EACH ROW EXECUTE FUNCTION cr06_validate_approved_artifact_insert();

CREATE OR REPLACE FUNCTION cr06_guard_verified_manifest()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CR06_IMMUTABLE_HISTORY'; END IF;
  IF NEW.manifest_version IS DISTINCT FROM OLD.manifest_version OR
     NEW.manifest_hash IS DISTINCT FROM OLD.manifest_hash OR
     NEW.program_count IS DISTINCT FROM OLD.program_count OR
     NEW.sequence_count IS DISTINCT FROM OLD.sequence_count OR
     NEW.content_count IS DISTINCT FROM OLD.content_count OR
     NEW.manual_task_count IS DISTINCT FROM OLD.manual_task_count OR
     NEW.document IS DISTINCT FROM OLD.document OR
     NEW.created_at IS DISTINCT FROM OLD.created_at OR
     (OLD.receipt IS NOT NULL AND NEW.receipt IS DISTINCT FROM OLD.receipt) THEN
    RAISE EXCEPTION 'CR06_MANIFEST_EVIDENCE_IMMUTABLE';
  END IF;
  IF OLD.status = 'verified' THEN
    IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'CR06_VERIFIED_MANIFEST_IMMUTABLE'; END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'dry_run' AND NEW.status = 'applying') OR
    (OLD.status IN ('dry_run','failed') AND NEW.status = 'applying') OR
    (OLD.status = 'applying' AND NEW.status IN ('verified','failed','rejected'))
  ) THEN
    RAISE EXCEPTION 'CR06_MANIFEST_STATE_TRANSITION_FORBIDDEN';
  END IF;
  IF OLD.status = 'applying' AND NEW.status = 'verified' AND (
    NEW.manifest_hash IS NULL OR NEW.document IS NULL OR NEW.receipt IS NULL OR
    NEW.program_count < 0 OR NEW.sequence_count < 0 OR NEW.content_count < 0 OR NEW.manual_task_count < 0
  ) THEN RAISE EXCEPTION 'CR06_VERIFIED_MANIFEST_INCOMPLETE'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cr06_manifest_receipt_guard ON cr06_rollout_manifests;
DROP TRIGGER IF EXISTS cr06_verified_manifest_guard ON cr06_rollout_manifests;
CREATE TRIGGER cr06_verified_manifest_guard BEFORE UPDATE OR DELETE ON cr06_rollout_manifests
  FOR EACH ROW EXECUTE FUNCTION cr06_guard_verified_manifest();

CREATE OR REPLACE FUNCTION cr06_forbid_preverified_manifest_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='verified' THEN RAISE EXCEPTION 'CR06_VERIFIED_MANIFEST_REQUIRES_TRANSITION'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cr06_preverified_manifest_insert_guard ON cr06_rollout_manifests;
CREATE TRIGGER cr06_preverified_manifest_insert_guard BEFORE INSERT ON cr06_rollout_manifests
  FOR EACH ROW EXECUTE FUNCTION cr06_forbid_preverified_manifest_insert();

CREATE OR REPLACE FUNCTION cr06_guard_gate_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CR06_IMMUTABLE_HISTORY'; END IF;
  IF NEW.program_artifact_id IS DISTINCT FROM OLD.program_artifact_id OR
     NEW.cohort_run_id IS DISTINCT FROM OLD.cohort_run_id OR
     NEW.approval_id IS DISTINCT FROM OLD.approval_id OR
     NEW.preflight_hash IS DISTINCT FROM OLD.preflight_hash OR
     NEW.cap IS DISTINCT FROM OLD.cap OR
     NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
     NEW.dependency_snapshot IS DISTINCT FROM OLD.dependency_snapshot OR
     NEW.expires_at IS DISTINCT FROM OLD.expires_at OR
     NEW.created_at IS DISTINCT FROM OLD.created_at OR
     NEW.revision <> OLD.revision + 1 OR
     NOT ((OLD.state='closed' AND NEW.state='open') OR (OLD.state='open' AND NEW.state='closed')) THEN
    RAISE EXCEPTION 'CR06_GATE_MUTATION_FORBIDDEN';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cr06_campaign_gate_guard ON cr06_campaign_gates;
CREATE TRIGGER cr06_campaign_gate_guard BEFORE UPDATE OR DELETE ON cr06_campaign_gates
  FOR EACH ROW EXECUTE FUNCTION cr06_guard_gate_history();

CREATE OR REPLACE FUNCTION cr06_append_gate_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO cr06_campaign_gate_revisions
    (campaign_gate_id,revision,state,actor_id,dependency_snapshot,opened_at,closed_at)
  VALUES (NEW.id,NEW.revision,NEW.state,NEW.actor_id,NEW.dependency_snapshot,NEW.opened_at,NEW.closed_at)
  ON CONFLICT (campaign_gate_id,revision) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cr06_campaign_gate_revision_append ON cr06_campaign_gates;
CREATE TRIGGER cr06_campaign_gate_revision_append AFTER INSERT OR UPDATE ON cr06_campaign_gates
  FOR EACH ROW EXECUTE FUNCTION cr06_append_gate_revision();

INSERT INTO cr06_campaign_gate_revisions
  (campaign_gate_id,revision,state,actor_id,dependency_snapshot,opened_at,closed_at,created_at)
SELECT id,revision,state,actor_id,dependency_snapshot,opened_at,closed_at,created_at
FROM cr06_campaign_gates
ON CONFLICT (campaign_gate_id,revision) DO NOTHING;

DROP TRIGGER IF EXISTS cr06_campaign_gate_revision_immutable ON cr06_campaign_gate_revisions;
CREATE TRIGGER cr06_campaign_gate_revision_immutable
  BEFORE UPDATE OR DELETE ON cr06_campaign_gate_revisions
  FOR EACH ROW EXECUTE FUNCTION cr06_forbid_immutable_history_mutation();

CREATE OR REPLACE FUNCTION cr06_guard_preparation_run()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CR06_IMMUTABLE_HISTORY'; END IF;
  IF OLD.state='building' AND NEW.state IN ('ready_held','failed','superseded') AND NEW.receipt IS NULL THEN
    NEW.receipt := jsonb_build_object(
      'receiptVersion', NEW.receipt_version,
      'state', NEW.state,
      'requestedCount', NEW.requested_count,
      'preparedCount', NEW.prepared_count,
      'blockedCount', NEW.blocked_count,
      'deferredCount', NEW.deferred_count,
      'runHash', NEW.run_hash,
      'dependencyFingerprint', NEW.dependency_fingerprint,
      'blockerSummary', NEW.blocker_summary
    );
  END IF;
  IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
     NEW.program_artifact_id IS DISTINCT FROM OLD.program_artifact_id OR
     NEW.approval_id IS DISTINCT FROM OLD.approval_id OR
     NEW.cohort_run_id IS DISTINCT FROM OLD.cohort_run_id OR
     NEW.dependency_fingerprint IS DISTINCT FROM OLD.dependency_fingerprint OR
     NEW.dependency_snapshot IS DISTINCT FROM OLD.dependency_snapshot OR
     NEW.dependency_version IS DISTINCT FROM OLD.dependency_version OR
     NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
     (OLD.state <> 'building' AND NEW IS DISTINCT FROM OLD) OR
     (NEW.state IS DISTINCT FROM OLD.state AND NOT (OLD.state='building' AND NEW.state IN ('ready_held','failed','superseded'))) OR
     (OLD.receipt IS NOT NULL AND NEW.receipt IS DISTINCT FROM OLD.receipt) OR
     NEW.receipt_version IS DISTINCT FROM OLD.receipt_version THEN
    RAISE EXCEPTION 'CR06_PREPARATION_RUN_MUTATION_FORBIDDEN';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cr06_preparation_run_guard ON cr06_preparation_runs;
CREATE TRIGGER cr06_preparation_run_guard BEFORE UPDATE OR DELETE ON cr06_preparation_runs
  FOR EACH ROW EXECUTE FUNCTION cr06_guard_preparation_run();

CREATE OR REPLACE FUNCTION cr06_guard_prepared_enrollment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CR06_IMMUTABLE_HISTORY'; END IF;
  IF NEW.preparation_run_id IS DISTINCT FROM OLD.preparation_run_id OR
     NEW.cohort_ordinal IS DISTINCT FROM OLD.cohort_ordinal OR NEW.contact_id IS DISTINCT FROM OLD.contact_id OR
     NEW.contact_generation IS DISTINCT FROM OLD.contact_generation OR NEW.email_token_hash IS DISTINCT FROM OLD.email_token_hash OR
     NEW.sender_policy_version IS DISTINCT FROM OLD.sender_policy_version OR
     NEW.dependency_fingerprint IS DISTINCT FROM OLD.dependency_fingerprint OR NEW.evidence_snapshot IS DISTINCT FROM OLD.evidence_snapshot OR
     NEW.sequence_enrollment_id IS DISTINCT FROM OLD.sequence_enrollment_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
     (NEW.state IS DISTINCT FROM OLD.state AND NOT (OLD.state='ready_held' AND NEW.state IN ('removed','deferred','superseded'))) OR
     (NEW.manual_task_id IS DISTINCT FROM OLD.manual_task_id AND NOT (OLD.manual_task_id IS NULL AND NEW.manual_task_id IS NOT NULL)) OR
     (NEW.removal_reason IS DISTINCT FROM OLD.removal_reason AND NOT (
       OLD.state='ready_held' AND NEW.state IN ('removed','deferred','superseded') AND NEW.removal_reason IS NOT NULL
     )) THEN
    RAISE EXCEPTION 'CR06_PREPARED_ENROLLMENT_MUTATION_FORBIDDEN';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cr06_prepared_enrollment_guard ON cr06_prepared_enrollments;
CREATE TRIGGER cr06_prepared_enrollment_guard BEFORE UPDATE OR DELETE ON cr06_prepared_enrollments
  FOR EACH ROW EXECUTE FUNCTION cr06_guard_prepared_enrollment();

CREATE OR REPLACE FUNCTION cr06_bind_manual_task_dependencies()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_snapshot JSONB; run_version INTEGER;
BEGIN
  SELECT dependency_snapshot,dependency_version INTO run_snapshot,run_version
    FROM cr06_preparation_runs WHERE id=NEW.preparation_run_id;
  IF run_snapshot IS NULL THEN RAISE EXCEPTION 'CR06_MANUAL_TASK_RUN_REQUIRED'; END IF;
  IF NEW.dependency_snapshot = '{}'::jsonb THEN NEW.dependency_snapshot := run_snapshot; END IF;
  IF NEW.dependency_snapshot IS DISTINCT FROM run_snapshot OR NEW.dependency_version IS DISTINCT FROM run_version THEN
    RAISE EXCEPTION 'CR06_MANUAL_TASK_DEPENDENCY_MISMATCH';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cr06_manual_task_dependency_bind ON cr06_manual_task_intents;
CREATE TRIGGER cr06_manual_task_dependency_bind BEFORE INSERT ON cr06_manual_task_intents
  FOR EACH ROW EXECUTE FUNCTION cr06_bind_manual_task_dependencies();

CREATE OR REPLACE FUNCTION cr06_guard_manual_task_intent()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CR06_IMMUTABLE_HISTORY'; END IF;
  IF NEW.preparation_run_id IS DISTINCT FROM OLD.preparation_run_id OR NEW.prepared_enrollment_id IS DISTINCT FROM OLD.prepared_enrollment_id OR
     NEW.task_definition_artifact_id IS DISTINCT FROM OLD.task_definition_artifact_id OR NEW.trigger_touch_number IS DISTINCT FROM OLD.trigger_touch_number OR
     NEW.scheduled_after IS DISTINCT FROM OLD.scheduled_after OR NEW.command_key IS DISTINCT FROM OLD.command_key OR
     NEW.dependency_snapshot IS DISTINCT FROM OLD.dependency_snapshot OR NEW.dependency_version IS DISTINCT FROM OLD.dependency_version OR
     NEW.created_at IS DISTINCT FROM OLD.created_at OR
     (NEW.cr05_task_id IS DISTINCT FROM OLD.cr05_task_id AND NOT (
       OLD.state='eligible' AND NEW.state='created' AND OLD.cr05_task_id IS NULL AND NEW.cr05_task_id IS NOT NULL
     )) OR
     (NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state='held' AND NEW.state IN ('eligible','cancelled','terminal')) OR
       (OLD.state='eligible' AND NEW.state IN ('created','cancelled','terminal')) OR
       (OLD.state='created' AND NEW.state='terminal')
     )) THEN RAISE EXCEPTION 'CR06_MANUAL_TASK_INTENT_MUTATION_FORBIDDEN'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cr06_manual_task_intent_guard ON cr06_manual_task_intents;
CREATE TRIGGER cr06_manual_task_intent_guard BEFORE UPDATE OR DELETE ON cr06_manual_task_intents
  FOR EACH ROW EXECUTE FUNCTION cr06_guard_manual_task_intent();

CREATE OR REPLACE FUNCTION cr06_guard_delivery_intent()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CR06_IMMUTABLE_HISTORY'; END IF;
  IF NEW.preparation_run_id IS DISTINCT FROM OLD.preparation_run_id OR NEW.prepared_enrollment_id IS DISTINCT FROM OLD.prepared_enrollment_id OR
     NEW.sequence_artifact_id IS DISTINCT FROM OLD.sequence_artifact_id OR NEW.content_artifact_id IS DISTINCT FROM OLD.content_artifact_id OR
     NEW.recipient_contact_id IS DISTINCT FROM OLD.recipient_contact_id OR NEW.touch_number IS DISTINCT FROM OLD.touch_number OR
     NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for OR NEW.recipient_snapshot IS DISTINCT FROM OLD.recipient_snapshot OR
     NEW.render_hash IS DISTINCT FROM OLD.render_hash OR NEW.dependency_snapshot IS DISTINCT FROM OLD.dependency_snapshot OR
     NEW.dependency_version IS DISTINCT FROM OLD.dependency_version OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
     NEW.provider_attempt_count < OLD.provider_attempt_count OR
     (NEW.provider_attempt_count IS DISTINCT FROM OLD.provider_attempt_count AND OLD.state NOT IN ('released','attempting')) OR
     (NEW.released_at IS DISTINCT FROM OLD.released_at AND NOT (
       OLD.state='held' AND NEW.state='released' AND OLD.released_at IS NULL AND NEW.released_at IS NOT NULL
     )) OR
     (NEW.terminal_reason IS DISTINCT FROM OLD.terminal_reason AND NOT (
       NEW.state='terminal' AND OLD.state IN ('held','released','attempting') AND
       OLD.terminal_reason IS NULL AND NEW.terminal_reason IS NOT NULL
     )) OR
     (NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state='held' AND NEW.state IN ('released','terminal')) OR
       (OLD.state='released' AND NEW.state IN ('attempting','terminal')) OR
       (OLD.state='attempting' AND NEW.state='terminal')
     )) OR (OLD.state='terminal' AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'CR06_DELIVERY_INTENT_MUTATION_FORBIDDEN';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cr06_held_delivery_intent_guard ON cr06_delivery_intents;
DROP TRIGGER IF EXISTS cr06_delivery_intent_guard ON cr06_delivery_intents;
CREATE TRIGGER cr06_delivery_intent_guard BEFORE UPDATE OR DELETE ON cr06_delivery_intents
  FOR EACH ROW EXECUTE FUNCTION cr06_guard_delivery_intent();

-- A receipt is immutable except for its one-way processing acknowledgement.
CREATE OR REPLACE FUNCTION cr06_guard_feedback_receipt()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CR06_IMMUTABLE_HISTORY'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.delivery_intent_id IS DISTINCT FROM OLD.delivery_intent_id OR
     NEW.preparation_run_id IS DISTINCT FROM OLD.preparation_run_id OR NEW.contact_id IS DISTINCT FROM OLD.contact_id OR
     NEW.source IS DISTINCT FROM OLD.source OR NEW.event_key IS DISTINCT FROM OLD.event_key OR
     NEW.event_type IS DISTINCT FROM OLD.event_type OR NEW.payload IS DISTINCT FROM OLD.payload OR
     NEW.received_by IS DISTINCT FROM OLD.received_by OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
     NEW.effect_version IS DISTINCT FROM OLD.effect_version OR OLD.processed_at IS NOT NULL OR NEW.processed_at IS NULL THEN
    RAISE EXCEPTION 'CR06_FEEDBACK_RECEIPT_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cr06_feedback_receipt_immutable ON cr06_feedback_receipts;
CREATE TRIGGER cr06_feedback_receipt_immutable BEFORE UPDATE OR DELETE ON cr06_feedback_receipts
  FOR EACH ROW EXECUTE FUNCTION cr06_guard_feedback_receipt();