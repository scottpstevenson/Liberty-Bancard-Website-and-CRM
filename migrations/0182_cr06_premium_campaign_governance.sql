-- CR-06 additive premium campaign governance.
-- This migration creates no production content and sends no messages.
-- Premium objects are installed only by the explicit rollout command.

CREATE TABLE IF NOT EXISTS cr06_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_key TEXT NOT NULL,
  artifact_kind TEXT NOT NULL,
  record_class TEXT NOT NULL DEFAULT 'production',
  purpose TEXT NOT NULL DEFAULT 'cold_marketing',
  governance_state TEXT NOT NULL DEFAULT 'draft',
  compatibility_state TEXT NOT NULL DEFAULT 'governed',
  preparation_state TEXT NOT NULL DEFAULT 'not_prepared',
  version INTEGER NOT NULL,
  parent_artifact_id UUID REFERENCES cr06_artifacts(id) ON DELETE RESTRICT,
  document JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  dependency_fingerprint TEXT,
  created_by TEXT NOT NULL,
  reviewed_by TEXT,
  approved_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cr06_artifact_kind_chk CHECK (artifact_kind IN ('program','sequence_version','content_version','manual_task_definition')),
  CONSTRAINT cr06_artifact_record_class_chk CHECK (record_class IN ('production','test')),
  CONSTRAINT cr06_artifact_purpose_chk CHECK (purpose IN ('cold_marketing','transactional_operational')),
  CONSTRAINT cr06_artifact_governance_chk CHECK (governance_state IN ('draft','review_ready','approved_inactive','retired','invalid')),
  CONSTRAINT cr06_artifact_compatibility_chk CHECK (compatibility_state IN ('governed','legacy_review_required','replaceable','incompatible')),
  CONSTRAINT cr06_artifact_preparation_chk CHECK (preparation_state IN ('not_prepared','building','ready_held','failed','superseded')),
  CONSTRAINT cr06_artifact_hash_chk CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cr06_artifact_approval_chk CHECK (
    (governance_state = 'approved_inactive' AND approved_at IS NOT NULL AND reviewed_by IS NOT NULL)
    OR governance_state <> 'approved_inactive'
  ),
  CONSTRAINT cr06_artifact_identity_version_uidx UNIQUE (identity_key, version)
);
CREATE INDEX IF NOT EXISTS cr06_artifacts_kind_state_idx
  ON cr06_artifacts(artifact_kind, governance_state, record_class);

CREATE TABLE IF NOT EXISTS cr06_rollout_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_version TEXT NOT NULL UNIQUE,
  manifest_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'dry_run',
  program_count INTEGER NOT NULL DEFAULT 0,
  sequence_count INTEGER NOT NULL DEFAULT 0,
  content_count INTEGER NOT NULL DEFAULT 0,
  manual_task_count INTEGER NOT NULL DEFAULT 0,
  document JSONB NOT NULL,
  actor_id TEXT,
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  fence INTEGER NOT NULL DEFAULT 0,
  receipt JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ,
  CONSTRAINT cr06_manifest_status_chk CHECK (status IN ('dry_run','applying','applied','verified','rejected','failed')),
  CONSTRAINT cr06_manifest_hash_chk CHECK (manifest_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS cr06_approval_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID NOT NULL UNIQUE REFERENCES cr06_artifacts(id) ON DELETE RESTRICT,
  artifact_hash TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  dependency_fingerprint TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  compare_and_set_hash TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cr06_approval_hash_chk CHECK (artifact_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS cr06_campaign_gates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_artifact_id UUID NOT NULL REFERENCES cr06_artifacts(id) ON DELETE RESTRICT,
  cohort_run_id UUID NOT NULL REFERENCES cr04_cohort_runs(id) ON DELETE RESTRICT,
  approval_id UUID NOT NULL REFERENCES cr06_approval_snapshots(id) ON DELETE RESTRICT,
  preflight_hash TEXT NOT NULL,
  cap INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'closed',
  confirmation TEXT,
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cr06_gate_state_chk CHECK (state IN ('closed','open')),
  CONSTRAINT cr06_gate_cap_chk CHECK (cap BETWEEN 1 AND 250),
  CONSTRAINT cr06_gate_confirmation_chk CHECK (
    (state = 'open' AND confirmation = 'CR06_OPEN_EXACT_VERSION_COHORT')
    OR state <> 'open'
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS cr06_campaign_gates_current_uidx
  ON cr06_campaign_gates(program_artifact_id, cohort_run_id) WHERE state = 'open';

CREATE TABLE IF NOT EXISTS cr06_preparation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  program_artifact_id UUID NOT NULL REFERENCES cr06_artifacts(id) ON DELETE RESTRICT,
  approval_id UUID NOT NULL REFERENCES cr06_approval_snapshots(id) ON DELETE RESTRICT,
  cohort_run_id UUID NOT NULL REFERENCES cr04_cohort_runs(id) ON DELETE RESTRICT,
  dependency_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'building',
  requested_count INTEGER NOT NULL DEFAULT 0,
  prepared_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  deferred_count INTEGER NOT NULL DEFAULT 0,
  run_hash TEXT,
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  fence INTEGER NOT NULL DEFAULT 0,
  blocker_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT cr06_preparation_state_chk CHECK (state IN ('building','ready_held','failed','superseded')),
  CONSTRAINT cr06_preparation_run_hash_chk CHECK (run_hash IS NULL OR run_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS cr06_preparation_runs_cohort_idx
  ON cr06_preparation_runs(cohort_run_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS cr06_preparation_runs_active_exact_uidx
  ON cr06_preparation_runs(program_artifact_id, approval_id, cohort_run_id)
  WHERE state IN ('building','ready_held');

CREATE TABLE IF NOT EXISTS cr06_prepared_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preparation_run_id UUID NOT NULL REFERENCES cr06_preparation_runs(id) ON DELETE RESTRICT,
  cohort_ordinal INTEGER NOT NULL,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  contact_generation INTEGER NOT NULL,
  email_token_hash TEXT,
  sender_policy_version TEXT NOT NULL,
  dependency_fingerprint TEXT NOT NULL,
  evidence_snapshot JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'ready_held',
  removal_reason TEXT,
  manual_task_id INTEGER REFERENCES tasks(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cr06_prepared_enrollment_state_chk CHECK (state IN ('ready_held','removed','deferred','superseded')),
  CONSTRAINT cr06_prepared_enrollment_removal_chk CHECK (
    (state = 'ready_held' AND removal_reason IS NULL) OR state <> 'ready_held'
  ),
  CONSTRAINT cr06_prepared_enrollment_unique UNIQUE (preparation_run_id, contact_id),
  CONSTRAINT cr06_prepared_enrollment_ordinal_unique UNIQUE (preparation_run_id, cohort_ordinal)
);

CREATE TABLE IF NOT EXISTS cr06_delivery_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preparation_run_id UUID NOT NULL REFERENCES cr06_preparation_runs(id) ON DELETE RESTRICT,
  prepared_enrollment_id UUID NOT NULL REFERENCES cr06_prepared_enrollments(id) ON DELETE RESTRICT,
  sequence_artifact_id UUID NOT NULL REFERENCES cr06_artifacts(id) ON DELETE RESTRICT,
  content_artifact_id UUID NOT NULL REFERENCES cr06_artifacts(id) ON DELETE RESTRICT,
  touch_number INTEGER NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'held',
  recipient_snapshot JSONB NOT NULL,
  render_hash TEXT NOT NULL,
  provider_attempt_count INTEGER NOT NULL DEFAULT 0,
  terminal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  CONSTRAINT cr06_delivery_intent_state_chk CHECK (state IN ('held','released','attempting','terminal')),
  CONSTRAINT cr06_delivery_intent_touch_chk CHECK (touch_number BETWEEN 1 AND 4),
  CONSTRAINT cr06_delivery_intent_hash_chk CHECK (render_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cr06_delivery_intent_unique UNIQUE (prepared_enrollment_id, touch_number)
);
CREATE INDEX IF NOT EXISTS cr06_delivery_intents_due_idx
  ON cr06_delivery_intents(state, scheduled_for);

CREATE TABLE IF NOT EXISTS cr06_manual_task_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preparation_run_id UUID NOT NULL REFERENCES cr06_preparation_runs(id) ON DELETE RESTRICT,
  prepared_enrollment_id UUID NOT NULL UNIQUE REFERENCES cr06_prepared_enrollments(id) ON DELETE RESTRICT,
  task_definition_artifact_id UUID NOT NULL REFERENCES cr06_artifacts(id) ON DELETE RESTRICT,
  trigger_touch_number INTEGER NOT NULL DEFAULT 2,
  state TEXT NOT NULL DEFAULT 'held',
  scheduled_after TIMESTAMPTZ NOT NULL,
  cr05_task_id INTEGER REFERENCES tasks(id) ON DELETE RESTRICT,
  command_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cr06_manual_task_intent_trigger_chk CHECK (trigger_touch_number = 2),
  CONSTRAINT cr06_manual_task_intent_state_chk CHECK (state IN ('held','eligible','created','cancelled','terminal'))
);

CREATE TABLE IF NOT EXISTS cr06_attribution_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preparation_run_id UUID NOT NULL REFERENCES cr06_preparation_runs(id) ON DELETE RESTRICT,
  delivery_intent_id UUID REFERENCES cr06_delivery_intents(id) ON DELETE RESTRICT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  provider TEXT,
  provider_event_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cr06_attribution_event_type_chk CHECK (event_type IN ('prepared','provider_attempt','sent','delivered','opened','replied','bounced','complaint','unsubscribed','suppressed','wrong_person','duplicate','provider_failed','manual_outcome')),
  CONSTRAINT cr06_attribution_outcome_chk CHECK (outcome IN ('success','blocked','deferred','terminal','unmatched','ambiguous','conflict')),
  CONSTRAINT cr06_attribution_provider_key_uidx UNIQUE (provider, provider_event_key)
);
CREATE INDEX IF NOT EXISTS cr06_attribution_contact_idx
  ON cr06_attribution_events(contact_id, created_at DESC);

CREATE OR REPLACE FUNCTION cr06_forbid_approved_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.governance_state = 'approved_inactive' AND (
    NEW.identity_key IS DISTINCT FROM OLD.identity_key OR
    NEW.artifact_kind IS DISTINCT FROM OLD.artifact_kind OR
    NEW.record_class IS DISTINCT FROM OLD.record_class OR
    NEW.purpose IS DISTINCT FROM OLD.purpose OR
    NEW.version IS DISTINCT FROM OLD.version OR
    NEW.document IS DISTINCT FROM OLD.document OR
    NEW.content_hash IS DISTINCT FROM OLD.content_hash OR
    NEW.dependency_fingerprint IS DISTINCT FROM OLD.dependency_fingerprint
  ) THEN
    RAISE EXCEPTION 'CR06_APPROVED_ARTIFACT_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cr06_approved_artifact_guard ON cr06_artifacts;
CREATE TRIGGER cr06_approved_artifact_guard
  BEFORE UPDATE ON cr06_artifacts FOR EACH ROW EXECUTE FUNCTION cr06_forbid_approved_mutation();

CREATE OR REPLACE FUNCTION cr06_forbid_history_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.record_class <> 'test' OR OLD.governance_state <> 'draft' THEN
    RAISE EXCEPTION 'CR06_HISTORY_DELETE_FORBIDDEN';
  END IF;
  IF EXISTS (
    SELECT 1 FROM cr06_preparation_runs pr
    JOIN cr06_approval_snapshots aps ON aps.id = pr.approval_id
    WHERE pr.program_artifact_id = OLD.id OR aps.artifact_id = OLD.id
  ) OR EXISTS (
    SELECT 1 FROM cr06_delivery_intents di
    WHERE di.sequence_artifact_id = OLD.id OR di.content_artifact_id = OLD.id
  ) OR EXISTS (
    SELECT 1 FROM cr06_manual_task_intents mi
    WHERE mi.task_definition_artifact_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'CR06_ARTIFACT_HAS_HISTORY';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS cr06_artifact_delete_guard ON cr06_artifacts;
CREATE TRIGGER cr06_artifact_delete_guard
  BEFORE DELETE ON cr06_artifacts FOR EACH ROW EXECUTE FUNCTION cr06_forbid_history_delete();