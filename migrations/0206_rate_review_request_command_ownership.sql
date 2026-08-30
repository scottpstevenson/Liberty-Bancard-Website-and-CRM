-- A portal rate-review is owned by its durable statement-upload request.
-- The partial unique index preserves legacy rows while fencing replay.
ALTER TABLE rate_review_requests
  ADD COLUMN IF NOT EXISTS statement_upload_command_id UUID
  REFERENCES statement_upload_commands(id);

CREATE UNIQUE INDEX IF NOT EXISTS rate_review_requests_statement_command_uidx
  ON rate_review_requests (statement_upload_command_id)
  WHERE statement_upload_command_id IS NOT NULL;