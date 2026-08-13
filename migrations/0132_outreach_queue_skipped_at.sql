-- Add outreach queue skip tracking to contacts
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS outreach_queue_skipped_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS contacts_outreach_queue_skipped_idx
  ON contacts (outreach_queue_skipped_at)
  WHERE outreach_queue_skipped_at IS NOT NULL;
