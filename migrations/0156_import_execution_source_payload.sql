-- BT-08: retain the normalized CSV source for independent restart recovery.
ALTER TABLE import_executions
  ADD COLUMN IF NOT EXISTS source_payload jsonb;