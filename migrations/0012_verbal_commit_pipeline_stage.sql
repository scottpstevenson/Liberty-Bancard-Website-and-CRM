-- Add canonical 'Verbal Commit' stage to sales pipeline between
-- 'Negotiation / Follow-Up' (sort_order 5) and 'Closed Won' (sort_order 7).
-- Repositions 'Nurture / Not Now' from sort_order 6 to sort_order 9 (after 'Closed Lost').

-- Step 1: Move 'Nurture / Not Now' out of the way to sort_order 9
UPDATE pipeline_stages
SET sort_order = 9
WHERE stage_name = 'Nurture / Not Now'
  AND pipeline = 'sales';

-- Step 2: Insert 'Verbal Commit' at sort_order 6 (idempotent)
INSERT INTO pipeline_stages (stage_name, pipeline, sort_order, color)
VALUES ('Verbal Commit', 'sales', 6, '#a855f7')
ON CONFLICT DO NOTHING;
