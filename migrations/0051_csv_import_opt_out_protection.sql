ALTER TABLE csv_imports
  ADD COLUMN IF NOT EXISTS updated_records integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opt_out_preserved integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opt_out_applied integer DEFAULT 0;
