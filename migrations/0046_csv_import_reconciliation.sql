-- 0046_csv_import_reconciliation.sql
-- Task #752 — Fix import & enrichment pipeline bugs.
-- Adds the missing invalid/skipped row breakdown to csv_imports so every
-- uploaded row can be reconciled: total_rows = new_records +
-- duplicates_skipped + invalid_rows + skipped_rows + errors_count.
-- Idempotent: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE csv_imports ADD COLUMN IF NOT EXISTS invalid_rows integer DEFAULT 0;
ALTER TABLE csv_imports ADD COLUMN IF NOT EXISTS skipped_rows integer DEFAULT 0;
