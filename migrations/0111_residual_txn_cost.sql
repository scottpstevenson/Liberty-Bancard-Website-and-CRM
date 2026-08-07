-- Add transactions and processing_cost columns to residual_import_rows
-- so the import step can store parsed values from the uploaded file.
ALTER TABLE residual_import_rows ADD COLUMN IF NOT EXISTS transactions INTEGER;
ALTER TABLE residual_import_rows ADD COLUMN IF NOT EXISTS processing_cost TEXT;

-- Make merchant_residuals.transactions and .cost nullable (drop hardcoded defaults).
-- NULL now means "not provided by the processor file" — distinguishable from a
-- genuine zero-transaction / zero-cost month.
ALTER TABLE merchant_residuals ALTER COLUMN transactions DROP DEFAULT;
ALTER TABLE merchant_residuals ALTER COLUMN cost DROP DEFAULT;

-- Flag every existing merchant_residual row that has the old hardcoded zeros.
-- These are historical records whose actual transaction counts and processing
-- costs are unknown; the data_quality flag lets reports exclude or highlight them.
UPDATE merchant_residuals
SET flags = COALESCE(flags, ARRAY[]::TEXT[]) || ARRAY['data_quality:hardcoded_zeros']
WHERE transactions = 0
  AND (cost = '0' OR cost IS NULL OR cost = '')
  AND NOT (ARRAY['data_quality:hardcoded_zeros'] <@ COALESCE(flags, ARRAY[]::TEXT[]));
