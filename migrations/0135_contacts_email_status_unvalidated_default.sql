-- Change the column default so newly inserted contacts get 'unvalidated'
-- instead of 'active'. Existing rows are intentionally left unchanged;
-- they will continue to flow through the lazy ZeroBounce gate at send time.
ALTER TABLE contacts ALTER COLUMN email_status SET DEFAULT 'unvalidated';
