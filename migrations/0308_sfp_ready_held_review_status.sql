-- Liberty Bancard enrichment completion (continuation) — item 5: held-record
-- review/approval controls for the v2 staging path.
--
-- Adds review-decision METADATA ONLY to sfp_ready_held_enrollments. This does
-- not add or change any activation, campaign, sequence, or send behavior —
-- the enrollment's own paused status stays owned entirely by
-- sfp-enrollment-bridge.ts and is never written by these columns or by the
-- review route that uses them.

ALTER TABLE sfp_ready_held_enrollments
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sfp_ready_held_enrollments_review_status_chk'
  ) THEN
    ALTER TABLE sfp_ready_held_enrollments
      ADD CONSTRAINT sfp_ready_held_enrollments_review_status_chk
      CHECK (review_status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sfp_ready_held_enrollments_review_status_idx
  ON sfp_ready_held_enrollments (review_status);
