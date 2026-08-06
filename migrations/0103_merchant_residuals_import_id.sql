-- Migration 0103: Link merchant_residuals rows to the residual_imports record that produced them.
-- Nullable so existing rows (imported before this migration) are not broken.
-- ON DELETE SET NULL: deleting an import record doesn't cascade-delete posted residuals.
ALTER TABLE merchant_residuals
  ADD COLUMN IF NOT EXISTS import_id INTEGER REFERENCES residual_imports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS merchant_residuals_import_id_idx ON merchant_residuals (import_id);
CREATE INDEX IF NOT EXISTS merchant_residuals_month_import_idx ON merchant_residuals (month, import_id);
