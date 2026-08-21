-- Keep the operation identity global while binding its result to the caller
-- that started it.  0147 originally used operation_scope for both concerns;
-- owner_scope makes them independent.

ALTER TABLE statement_upload_commands
  ADD COLUMN IF NOT EXISTS owner_scope text;

UPDATE statement_upload_commands
SET owner_scope = operation_scope
WHERE owner_scope IS NULL;

UPDATE statement_upload_commands
SET operation_scope = 'statement_upload'
WHERE operation_scope <> 'statement_upload';

ALTER TABLE statement_upload_commands
  ALTER COLUMN owner_scope SET NOT NULL;

DROP INDEX IF EXISTS suc_scope_request_id_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS suc_scope_request_id_uidx
  ON statement_upload_commands (operation_scope, request_id);