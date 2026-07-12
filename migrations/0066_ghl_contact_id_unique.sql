-- Migration 0066: GHL Contact ID Uniqueness
--
-- PREREQUISITE: All duplicate ghl_contact_id values must be resolved before this migration
-- runs. Use scripts/resolve-ghl-contact-id-duplicates.ts to audit and detach duplicate GHL
-- IDs, retaining only the canonical contact (lowest id) per group. This migration will FAIL
-- LOUDLY if any duplicate non-empty ghl_contact_id values remain.

-- Step 1: Fail-fast guard — migration aborts immediately if duplicates remain.
-- Run scripts/resolve-ghl-contact-id-duplicates.ts to fix them first.
DO $$
DECLARE dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT ghl_contact_id
    FROM contacts
    WHERE ghl_contact_id IS NOT NULL AND BTRIM(ghl_contact_id) <> ''
    GROUP BY ghl_contact_id
    HAVING COUNT(*) > 1
  ) sub;
  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'Migration 0066 aborted: % duplicate ghl_contact_id group(s) remain. '
      'Run scripts/resolve-ghl-contact-id-duplicates.ts before applying this migration.',
      dup_count;
  END IF;
END $$;

-- Step 2: Normalize blank GHL IDs to NULL (belt-and-suspenders sweep).
UPDATE contacts SET ghl_contact_id = NULL
WHERE ghl_contact_id IS NOT NULL AND BTRIM(ghl_contact_id) = '';

-- Step 3: Partial unique index — enforces one contact per non-null, non-empty GHL ID.
-- NULLs are excluded from the index so unlinked contacts are never treated as collisions.
CREATE UNIQUE INDEX contacts_ghl_contact_id_unique
ON contacts (ghl_contact_id)
WHERE ghl_contact_id IS NOT NULL AND BTRIM(ghl_contact_id) <> '';
