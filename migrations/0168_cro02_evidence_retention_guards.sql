-- CRO-02 retention and immutability guards.  These are forward-only and do
-- not reconstruct or alter existing commercial decisions.

CREATE OR REPLACE FUNCTION cro02_source_event_immutable_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contact_id IS DISTINCT FROM OLD.contact_id
     OR NEW.event_key IS DISTINCT FROM OLD.event_key
     OR NEW.source_category IS DISTINCT FROM OLD.source_category
     OR NEW.source_type IS DISTINCT FROM OLD.source_type
     OR NEW.source_external_id IS DISTINCT FROM OLD.source_external_id
     OR NEW.import_execution_id IS DISTINCT FROM OLD.import_execution_id
     OR NEW.source_row_number IS DISTINCT FROM OLD.source_row_number
     OR NEW.row_fingerprint IS DISTINCT FROM OLD.row_fingerprint
     OR NEW.actor_type IS DISTINCT FROM OLD.actor_type
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
     OR NEW.metadata IS DISTINCT FROM OLD.metadata
     OR NEW.first_seen_at IS DISTINCT FROM OLD.first_seen_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'CRO02_SOURCE_EVENT_IMMUTABLE';
  END IF;
  IF NEW.last_seen_at < OLD.last_seen_at THEN
    RAISE EXCEPTION 'CRO02_SOURCE_EVENT_LAST_SEEN_REGRESSION';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cro02_source_event_immutable ON contact_source_events;
CREATE TRIGGER cro02_source_event_immutable BEFORE UPDATE ON contact_source_events
  FOR EACH ROW EXECUTE FUNCTION cro02_source_event_immutable_guard();

CREATE OR REPLACE FUNCTION cro02_primary_source_same_contact_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.primary_source_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM contact_source_events
    WHERE id=NEW.primary_source_event_id AND contact_id=NEW.id
  ) THEN RAISE EXCEPTION 'CRO02_PRIMARY_SOURCE_CONTACT_MISMATCH'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cro02_primary_source_same_contact ON contacts;
CREATE CONSTRAINT TRIGGER cro02_primary_source_same_contact
  AFTER INSERT OR UPDATE OF primary_source_event_id ON contacts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION cro02_primary_source_same_contact_guard();

CREATE OR REPLACE FUNCTION cro02_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'CRO02_IMMUTABLE_%', TG_TABLE_NAME; END $$;
DROP TRIGGER IF EXISTS cro02_snapshot_immutable ON commercial_resolution_snapshots;
CREATE TRIGGER cro02_snapshot_immutable BEFORE UPDATE OR DELETE ON commercial_resolution_snapshots
  FOR EACH ROW EXECUTE FUNCTION cro02_append_only_guard();
DROP TRIGGER IF EXISTS cro02_dependency_immutable ON commercial_resolution_dependencies;
CREATE TRIGGER cro02_dependency_immutable BEFORE UPDATE OR DELETE ON commercial_resolution_dependencies
  FOR EACH ROW EXECUTE FUNCTION cro02_append_only_guard();
DROP TRIGGER IF EXISTS cro02_evidence_reference_immutable ON commercial_evidence_references;
CREATE TRIGGER cro02_evidence_reference_immutable BEFORE UPDATE OR DELETE ON commercial_evidence_references
  FOR EACH ROW EXECUTE FUNCTION cro02_append_only_guard();

-- Existing BT-10 snapshots are retained evidence once written. Replace the
-- anonymous inline cascade FK regardless of the generated constraint name.
DO $$
DECLARE fk_name text;
BEGIN
  SELECT conname INTO fk_name FROM pg_constraint
   WHERE conrelid='eligibility_snapshots'::regclass AND contype='f'
     AND confrelid='contacts'::regclass LIMIT 1;
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE eligibility_snapshots DROP CONSTRAINT %I', fk_name);
    ALTER TABLE eligibility_snapshots ADD CONSTRAINT eligibility_snapshots_contact_retained_fk
      FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE RESTRICT;
  END IF;
END $$;
