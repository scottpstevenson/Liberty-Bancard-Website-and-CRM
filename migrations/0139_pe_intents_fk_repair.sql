-- Migration 0139: Post-Enrichment Intents FK Repair (#1552 / 1548D)
-- Idempotently ensures the sequence_id FK on post_enrichment_enrollment_intents
-- references follow_up_sequences(id), not the non-existent 'sequences' table.
-- Safe to run on databases where 0138 was applied correctly (FK already points to
-- follow_up_sequences) — the DROP IF EXISTS is a no-op in that case.
--
-- Depends on: 0138 (post_enrichment_intent_fields)

DO $$
BEGIN
  -- Drop any existing sequence_id FK on this table (regardless of target table)
  -- so we can re-add it pointing to the correct table.
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_name = 'post_enrichment_enrollment_intents'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'sequence_id'
  ) THEN
    -- Find and drop the constraint by name
    DECLARE
      v_constraint_name TEXT;
    BEGIN
      SELECT tc.constraint_name INTO v_constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_name = 'post_enrichment_enrollment_intents'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'sequence_id'
      LIMIT 1;

      IF v_constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE post_enrichment_enrollment_intents DROP CONSTRAINT IF EXISTS %I', v_constraint_name);
      END IF;
    END;
  END IF;

  -- Re-add the FK pointing to follow_up_sequences(id) with a known stable name
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'post_enrichment_enrollment_intents'
      AND column_name = 'sequence_id'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.referential_constraints rc
      JOIN information_schema.table_constraints tc
        ON rc.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON rc.unique_constraint_name = ccu.constraint_name
      WHERE tc.table_name = 'post_enrichment_enrollment_intents'
        AND ccu.table_name = 'follow_up_sequences'
    ) THEN
      ALTER TABLE post_enrichment_enrollment_intents
        ADD CONSTRAINT pe_intents_sequence_id_fk
        FOREIGN KEY (sequence_id) REFERENCES follow_up_sequences(id);
    END IF;
  END IF;
END $$;
