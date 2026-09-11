-- Migration 0251: Add unique constraint on processor_signals for deduplication.
--
-- Without this, ON CONFLICT DO NOTHING has no target and does not deduplicate.
-- Repeated or manual enrichment runs would append identical signal rows,
-- inflating displayed/evidence counts.
--
-- First, deduplicate any existing rows (keep the lowest id per group).
-- This is safe: any duplicate rows carry the same content and confidence score.
DELETE FROM processor_signals
WHERE id NOT IN (
  SELECT MIN(id)
  FROM processor_signals
  GROUP BY business_id, vendor_name, detection_method
);

-- Then create the unique index on (business_id, vendor_name, detection_method).
CREATE UNIQUE INDEX IF NOT EXISTS processor_signals_business_vendor_method_uniq
  ON processor_signals (business_id, vendor_name, detection_method);
