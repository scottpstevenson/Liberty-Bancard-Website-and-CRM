-- Durable worker ownership for statement-upload commands. The command row is
-- authoritative; BullMQ only delivers command IDs.
ALTER TABLE statement_upload_commands
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS terminal_code text;

CREATE INDEX IF NOT EXISTS suc_recovery_idx
  ON statement_upload_commands (status, lease_expires_at, updated_at)
  WHERE status = 'in_progress';