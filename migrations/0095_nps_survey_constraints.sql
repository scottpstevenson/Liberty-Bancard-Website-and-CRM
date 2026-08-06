-- Add send_attempted_at lease column to nps_responses
ALTER TABLE nps_responses ADD COLUMN IF NOT EXISTS send_attempted_at TIMESTAMP;

-- Deduplicate existing rows on (contact_id, day_trigger), keeping the row with
-- the highest id (most recent) to avoid constraint violations on add.
DELETE FROM nps_responses a
USING nps_responses b
WHERE a.contact_id IS NOT NULL
  AND a.contact_id = b.contact_id
  AND a.day_trigger = b.day_trigger
  AND a.id < b.id;

-- Partial unique index — only enforces uniqueness when contact_id is set,
-- so null-contact admin-created records are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS nps_responses_contact_day_unique_idx
  ON nps_responses(contact_id, day_trigger)
  WHERE contact_id IS NOT NULL;
