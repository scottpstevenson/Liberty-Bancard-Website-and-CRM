-- CR-06 correction items 3, 4, and 6.  Preparation is a reservation of
-- immutable work only; it never reserves or consumes an outbound send budget.

ALTER TABLE cr06_approval_snapshots
  ADD COLUMN IF NOT EXISTS dependency_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS snapshot_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE cr06_campaign_gates
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS dependency_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE cr06_preparation_runs
  ADD COLUMN IF NOT EXISTS dependency_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dependency_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE cr06_delivery_intents
  ADD COLUMN IF NOT EXISTS recipient_contact_id INTEGER REFERENCES contacts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS dependency_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dependency_version INTEGER NOT NULL DEFAULT 1;

UPDATE cr06_delivery_intents di
SET recipient_contact_id = pe.contact_id
FROM cr06_prepared_enrollments pe
WHERE pe.id = di.prepared_enrollment_id AND di.recipient_contact_id IS NULL;

ALTER TABLE cr06_delivery_intents
  ALTER COLUMN recipient_contact_id SET NOT NULL;

-- Backwards-compatible derivation for the existing held-intent constructor.
-- The contact identity remains database-derived, never caller supplied.
CREATE OR REPLACE FUNCTION cr06_bind_delivery_intent_recipient()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE enrollment_contact_id INTEGER;
BEGIN
  SELECT contact_id INTO enrollment_contact_id
  FROM cr06_prepared_enrollments
  WHERE id = NEW.prepared_enrollment_id;
  IF enrollment_contact_id IS NULL THEN
    RAISE EXCEPTION 'CR06_DELIVERY_INTENT_RECIPIENT_REQUIRED';
  END IF;
  IF NEW.recipient_contact_id IS NOT NULL AND NEW.recipient_contact_id <> enrollment_contact_id THEN
    RAISE EXCEPTION 'CR06_DELIVERY_INTENT_RECIPIENT_MISMATCH';
  END IF;
  NEW.recipient_contact_id := enrollment_contact_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cr06_delivery_intent_recipient_bind ON cr06_delivery_intents;
CREATE TRIGGER cr06_delivery_intent_recipient_bind
  BEFORE INSERT ON cr06_delivery_intents
  FOR EACH ROW EXECUTE FUNCTION cr06_bind_delivery_intent_recipient();

DROP INDEX IF EXISTS cr06_delivery_intents_recipient_step_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS cr06_delivery_intents_run_recipient_step_uidx
  ON cr06_delivery_intents(preparation_run_id, recipient_contact_id, sequence_artifact_id, touch_number);

CREATE TABLE IF NOT EXISTS cr06_preparation_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preparation_run_id UUID NOT NULL UNIQUE REFERENCES cr06_preparation_runs(id) ON DELETE RESTRICT,
  reservation_key TEXT NOT NULL UNIQUE,
  reserved_members INTEGER NOT NULL,
  send_capacity_units INTEGER NOT NULL DEFAULT 0,
  dependency_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cr06_preparation_reservation_members_chk CHECK (reserved_members >= 0),
  CONSTRAINT cr06_preparation_reservation_no_send_capacity_chk CHECK (send_capacity_units = 0)
);

CREATE TABLE IF NOT EXISTS cr06_feedback_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_intent_id UUID NOT NULL REFERENCES cr06_delivery_intents(id) ON DELETE RESTRICT,
  preparation_run_id UUID NOT NULL REFERENCES cr06_preparation_runs(id) ON DELETE RESTRICT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  source TEXT NOT NULL,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cr06_feedback_receipt_event_type_chk CHECK (event_type IN ('replied','bounced','complaint','unsubscribed','suppressed','wrong_person','duplicate')),
  CONSTRAINT cr06_feedback_receipt_source_key_uidx UNIQUE (source, event_key)
);

CREATE OR REPLACE FUNCTION cr06_forbid_immutable_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CR06_IMMUTABLE_HISTORY';
END $$;

DROP TRIGGER IF EXISTS cr06_approval_snapshot_immutable ON cr06_approval_snapshots;
CREATE TRIGGER cr06_approval_snapshot_immutable
  BEFORE UPDATE OR DELETE ON cr06_approval_snapshots
  FOR EACH ROW EXECUTE FUNCTION cr06_forbid_immutable_history_mutation();

DROP TRIGGER IF EXISTS cr06_reservation_immutable ON cr06_preparation_reservations;
CREATE TRIGGER cr06_reservation_immutable
  BEFORE UPDATE OR DELETE ON cr06_preparation_reservations
  FOR EACH ROW EXECUTE FUNCTION cr06_forbid_immutable_history_mutation();

DROP TRIGGER IF EXISTS cr06_feedback_receipt_immutable ON cr06_feedback_receipts;
CREATE TRIGGER cr06_feedback_receipt_immutable
  BEFORE UPDATE OR DELETE ON cr06_feedback_receipts
  FOR EACH ROW EXECUTE FUNCTION cr06_forbid_immutable_history_mutation();

CREATE OR REPLACE FUNCTION cr06_guard_held_intent_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.state = 'held' THEN
    RAISE EXCEPTION 'CR06_HELD_INTENT_IMMUTABLE';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.state = 'held' AND (
    NEW.preparation_run_id IS DISTINCT FROM OLD.preparation_run_id OR
    NEW.prepared_enrollment_id IS DISTINCT FROM OLD.prepared_enrollment_id OR
    NEW.sequence_artifact_id IS DISTINCT FROM OLD.sequence_artifact_id OR
    NEW.content_artifact_id IS DISTINCT FROM OLD.content_artifact_id OR
    NEW.recipient_contact_id IS DISTINCT FROM OLD.recipient_contact_id OR
    NEW.touch_number IS DISTINCT FROM OLD.touch_number OR
    NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for OR
    NEW.recipient_snapshot IS DISTINCT FROM OLD.recipient_snapshot OR
    NEW.render_hash IS DISTINCT FROM OLD.render_hash OR
    NEW.dependency_snapshot IS DISTINCT FROM OLD.dependency_snapshot OR
    NEW.dependency_version IS DISTINCT FROM OLD.dependency_version
  ) THEN
    RAISE EXCEPTION 'CR06_HELD_INTENT_IMMUTABLE';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS cr06_held_delivery_intent_guard ON cr06_delivery_intents;
CREATE TRIGGER cr06_held_delivery_intent_guard
  BEFORE UPDATE OR DELETE ON cr06_delivery_intents
  FOR EACH ROW EXECUTE FUNCTION cr06_guard_held_intent_mutation();

DROP TRIGGER IF EXISTS cr06_attribution_immutable ON cr06_attribution_events;
CREATE TRIGGER cr06_attribution_immutable
  BEFORE UPDATE OR DELETE ON cr06_attribution_events
  FOR EACH ROW EXECUTE FUNCTION cr06_forbid_immutable_history_mutation();

CREATE OR REPLACE FUNCTION cr06_guard_manifest_receipt()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.receipt IS NOT NULL AND NEW.receipt IS DISTINCT FROM OLD.receipt THEN
    RAISE EXCEPTION 'CR06_RECEIPT_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cr06_manifest_receipt_guard ON cr06_rollout_manifests;
CREATE TRIGGER cr06_manifest_receipt_guard
  BEFORE UPDATE ON cr06_rollout_manifests
  FOR EACH ROW EXECUTE FUNCTION cr06_guard_manifest_receipt();