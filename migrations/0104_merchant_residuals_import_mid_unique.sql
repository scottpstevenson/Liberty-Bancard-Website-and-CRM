-- Migration 0104: Unique constraint on (import_id, merchant_mid) for residuals belonging
-- to a specific import. Ensures concurrent confirmations cannot insert duplicate rows
-- for the same import+MID combination. Uses a partial index (WHERE import_id IS NOT NULL)
-- so legacy rows with no import linkage are not affected.
CREATE UNIQUE INDEX IF NOT EXISTS merchant_residuals_import_mid_unique
  ON merchant_residuals (import_id, merchant_mid)
  WHERE import_id IS NOT NULL;
