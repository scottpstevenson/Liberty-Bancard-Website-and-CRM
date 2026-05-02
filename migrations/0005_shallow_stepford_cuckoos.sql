-- Step 1: Deduplicate contacts by email
-- For each group of active contacts sharing the same email, keep the one with the lowest id
-- (oldest record) and archive all others, reassigning their related records to the primary.

DO $$
DECLARE
  dup RECORD;
  primary_id INTEGER;
  dup_id INTEGER;
BEGIN
  FOR dup IN
    SELECT email, array_agg(id ORDER BY id ASC) AS ids
    FROM contacts
    WHERE archived_at IS NULL
    GROUP BY email
    HAVING COUNT(*) > 1
  LOOP
    primary_id := dup.ids[1];

    FOREACH dup_id IN ARRAY dup.ids[2:]
    LOOP
      UPDATE deals SET contact_id = primary_id WHERE contact_id = dup_id;
      UPDATE tickets SET contact_id = primary_id WHERE contact_id = dup_id;
      UPDATE tasks SET contact_id = primary_id WHERE contact_id = dup_id;
      UPDATE documents SET contact_id = primary_id WHERE contact_id = dup_id;

      UPDATE contacts
      SET
        archived_at = NOW(),
        notes = '[Merged into Contact #' || primary_id || '] ' || COALESCE(notes, '')
      WHERE id = dup_id;
    END LOOP;
  END LOOP;
END $$;
--> statement-breakpoint

-- Step 2: Drop the existing non-unique email index
DROP INDEX IF EXISTS "contacts_email_idx";
--> statement-breakpoint

-- Step 3: Also drop performance index from add-indexes.sql if present
DROP INDEX IF EXISTS "idx_contacts_email";
--> statement-breakpoint

-- Step 4: Create partial unique index on contacts.email (active contacts only)
CREATE UNIQUE INDEX "contacts_email_unique_idx" ON "contacts" USING btree ("email") WHERE archived_at IS NULL;
