-- CRO-02 evidence references are meaningful only in the context of the
-- immutable commercial-resolution snapshot that selected the evidence.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM commercial_evidence_references WHERE snapshot_id IS NULL
  ) THEN
    RAISE EXCEPTION 'CRO02_EVIDENCE_REFERENCE_MISSING_SNAPSHOT';
  END IF;
END $$;

ALTER TABLE commercial_evidence_references
  ALTER COLUMN snapshot_id SET NOT NULL;

-- Replace any generated snapshot FK so retention semantics are explicit and
-- stable regardless of the constraint name emitted by an earlier migration.
DO $$
DECLARE fk record;
BEGIN
  FOR fk IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'commercial_evidence_references'::regclass
       AND contype = 'f'
       AND confrelid = 'commercial_resolution_snapshots'::regclass
  LOOP
    EXECUTE format(
      'ALTER TABLE commercial_evidence_references DROP CONSTRAINT %I',
      fk.conname
    );
  END LOOP;
END $$;

ALTER TABLE commercial_evidence_references
  ADD CONSTRAINT commercial_evidence_references_snapshot_retained_fk
  FOREIGN KEY (snapshot_id)
  REFERENCES commercial_resolution_snapshots(id)
  ON DELETE RESTRICT;

ALTER TABLE commercial_evidence_references
  DROP CONSTRAINT IF EXISTS commercial_evidence_references_snapshot_bound_exactly_one_chk;
ALTER TABLE commercial_evidence_references
  ADD CONSTRAINT commercial_evidence_references_snapshot_bound_exactly_one_chk
  CHECK (
    snapshot_id IS NOT NULL
    AND num_nonnulls(
      classification_event_id,
      contact_source_event_id,
      import_row_disposition_id,
      identity_observation_id,
      merge_operation_id,
      merge_redirect_id,
      business_link_decision_id,
      legacy_company_mapping_decision_id,
      relationship_review_id
    ) = 1
  );

-- A primary source event is authority-bearing even when it has not yet been
-- cited by a resolution snapshot. Keep disposable, wholly unreferenced source
-- fixtures deletable while making this authority edge immediately restrictive.
DO $$
DECLARE fk record;
BEGIN
  FOR fk IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'contacts'::regclass
       AND contype = 'f'
       AND confrelid = 'contact_source_events'::regclass
       AND conkey = ARRAY[(
         SELECT attnum
           FROM pg_attribute
          WHERE attrelid = 'contacts'::regclass
            AND attname = 'primary_source_event_id'
       )]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE contacts DROP CONSTRAINT %I', fk.conname);
  END LOOP;
END $$;

ALTER TABLE contacts
  ADD CONSTRAINT contacts_primary_source_event_retained_fk
  FOREIGN KEY (primary_source_event_id)
  REFERENCES contact_source_events(id)
  ON DELETE RESTRICT;