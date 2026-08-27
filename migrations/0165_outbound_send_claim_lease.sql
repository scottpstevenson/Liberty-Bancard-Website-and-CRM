ALTER TABLE outbound_send_log
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS outbound_send_log_pending_claim_lease_idx
  ON outbound_send_log (claim_expires_at)
  WHERE status = 'pending';