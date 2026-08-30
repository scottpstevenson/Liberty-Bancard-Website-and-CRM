ALTER TABLE cro03a_census_cursors
  ADD COLUMN IF NOT EXISTS snapshot_high_water_text TEXT,
  ADD COLUMN IF NOT EXISTS cursor_value_text TEXT;

ALTER TABLE cro03a_census_cursors
  DROP CONSTRAINT IF EXISTS cro03a_census_cursor_bounds_chk,
  ADD CONSTRAINT cro03a_census_cursor_bounds_chk CHECK (
    (snapshot_high_water_text IS NULL AND cursor_value_text IS NULL
      AND snapshot_high_water >= 0 AND cursor_value >= 0 AND cursor_value <= snapshot_high_water)
    OR
    (snapshot_high_water_text IS NOT NULL AND cursor_value_text IS NOT NULL)
  );