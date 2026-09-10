-- MI-02: Allow tombstone reactivation in cro03_source_subjects.
-- The original trigger in 0244 only allowed NULL → non-null (tombstone).
-- This migration replaces it to also allow non-null → NULL (reactivation)
-- when a previously-tombstoned merchant reappears in a subsequent full-snapshot import.
-- All other mutations (field edits, deletes) remain blocked.

CREATE OR REPLACE FUNCTION cro03_source_subject_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Allow one-way tombstone: NULL → non-null (tombstone a subject)
  IF TG_OP = 'UPDATE'
     AND OLD.tombstoned_at IS NULL
     AND NEW.tombstoned_at IS NOT NULL
     AND OLD.id               = NEW.id
     AND OLD.subject_type     = NEW.subject_type
     AND OLD.subject_key      = NEW.subject_key
     AND OLD.source_system    = NEW.source_system
     AND OLD.created_at       = NEW.created_at
  THEN
    RETURN NEW;  -- permit tombstone
  END IF;

  -- Allow reactivation: non-null → NULL (un-tombstone a returning merchant)
  IF TG_OP = 'UPDATE'
     AND OLD.tombstoned_at IS NOT NULL
     AND NEW.tombstoned_at IS NULL
     AND OLD.id               = NEW.id
     AND OLD.subject_type     = NEW.subject_type
     AND OLD.subject_key      = NEW.subject_key
     AND OLD.source_system    = NEW.source_system
     AND OLD.created_at       = NEW.created_at
  THEN
    RETURN NEW;  -- permit reactivation
  END IF;

  RAISE EXCEPTION 'CRO03_IMMUTABLE_ROW_GUARD: % on % is not permitted', TG_OP, TG_TABLE_NAME;
END $$;

-- Trigger already exists from 0244 — OR REPLACE above updates the function in place.
-- No need to drop/recreate the trigger (it references the function by name).
