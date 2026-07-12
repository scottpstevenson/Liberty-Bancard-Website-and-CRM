-- Add import provenance columns to prospects for partial-failure retries.
ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS import_execution_id integer REFERENCES prospect_lists(id),
  ADD COLUMN IF NOT EXISTS source_row_index integer;

-- Unique index prevents duplicate rows on partial-failure retry runs.
CREATE UNIQUE INDEX IF NOT EXISTS prospects_execution_row_uidx
  ON prospects (import_execution_id, source_row_index)
  WHERE import_execution_id IS NOT NULL AND source_row_index IS NOT NULL;
