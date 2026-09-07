-- Standardize proposal status 'reversed' → 'reverted' to match UI/API contract.
-- IMPORTANT: constraint must be dropped BEFORE updating data, because the
-- existing CHECK still rejects 'reverted'. Then data is migrated, then the
-- new constraint is added with the correct allowed values.

-- 1. Drop the old constraint that rejects 'reverted'.
ALTER TABLE contact_normalization_proposals
  DROP CONSTRAINT IF EXISTS contact_normalization_proposals_status_check;

-- 2. Migrate existing rows (safe no-op when table is empty or contains no 'reversed' rows).
UPDATE contact_normalization_proposals
SET status = 'reverted'
WHERE status = 'reversed';

-- 3. Add the corrected constraint allowing 'reverted' (not 'reversed').
ALTER TABLE contact_normalization_proposals
  ADD CONSTRAINT contact_normalization_proposals_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'stale', 'reverted'));
