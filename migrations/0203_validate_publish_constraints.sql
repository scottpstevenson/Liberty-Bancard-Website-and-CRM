-- Publish-time schema diffs inline constraints when creating tables that do not
-- yet exist in production. PostgreSQL does not allow NOT VALID on an inline
-- CREATE TABLE constraint, so all retained development constraints must be
-- validated before Publish introspects the schema.
--
-- `import_execution_row` is retained as a historical provenance value because
-- source occurrences are append-only evidence. New writers use `import`.

ALTER TABLE cro03_source_occurrences
  DROP CONSTRAINT IF EXISTS cro03a_occurrence_timestamp_provenance_chk,
  ADD CONSTRAINT cro03a_occurrence_timestamp_provenance_chk
    CHECK (timestamp_provenance IN (
      'source',
      'import',
      'ingestion_only',
      'import_execution_row'
    ));

ALTER TABLE cr06_feedback_receipts
  VALIDATE CONSTRAINT cr06_feedback_receipt_event_type_chk;

ALTER TABLE cr06_feedback_receipts
  VALIDATE CONSTRAINT cr06_feedback_payload_allowlist_chk;

ALTER TABLE cr06_attribution_events
  VALIDATE CONSTRAINT cr06_attribution_event_type_chk;

ALTER TABLE cro03c_commands
  VALIDATE CONSTRAINT cro03c_initial_validation_caps_chk;

ALTER TABLE cro03c_stage_dispositions
  VALIDATE CONSTRAINT cro03c_stage_input_reference_required_chk;