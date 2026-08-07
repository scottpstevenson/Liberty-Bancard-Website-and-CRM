-- contacts_ghl_unsynced_idx: partial index supporting getUnsyncedContactsForGhl keyset scans.
-- Covers the WHERE ghl_contact_id IS NULL AND archived_at IS NULL AND email <> '' ORDER BY id
-- predicate added by the production-scale GHL dedup fix so full-sync never does a sequential scan.
CREATE INDEX IF NOT EXISTS contacts_ghl_unsynced_idx
  ON contacts (id ASC)
  WHERE ghl_contact_id IS NULL AND archived_at IS NULL AND email <> '';
