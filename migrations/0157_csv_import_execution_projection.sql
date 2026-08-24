-- Durable, one-to-one UI projection for replay-safe CSV import executions.
ALTER TABLE csv_imports
  ADD COLUMN IF NOT EXISTS execution_id uuid REFERENCES import_executions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS csv_imports_execution_id_uidx
  ON csv_imports (execution_id)
  WHERE execution_id IS NOT NULL;