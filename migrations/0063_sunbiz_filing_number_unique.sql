-- Sunbiz filing_number uniqueness migration.
--
-- DESIGN: filing_number is unique within a source (COREVT FL records), not
-- globally. The constraint is scoped to (source, filing_number) WHERE both
-- are NOT NULL. Rows from different sources can share a filing_number without
-- conflict; rows with NULL filing_number are always inserted as new rows.
--
-- PRODUCTION SAFETY — AUDIT GATE:
-- Step 1 emits a NOTICE with the count of corevt duplicate groups to be
-- removed.  If dup_rows > 0 and the deploy has not been reviewed, stop here.
-- Step 2 raises an EXCEPTION if duplicates from OTHER sources would block the
-- constraint, so the deploy fails fast with a clear message.

-- Step 1: Audit corevt duplicates.
DO $$
DECLARE dup_groups bigint;
        dup_rows   bigint;
BEGIN
  SELECT COUNT(*) INTO dup_groups
  FROM (
    SELECT filing_number
    FROM sunbiz_entities
    WHERE source = 'corevt' AND filing_number IS NOT NULL
    GROUP BY filing_number
    HAVING COUNT(*) > 1
  ) g;

  SELECT COALESCE(SUM(cnt - 1), 0) INTO dup_rows
  FROM (
    SELECT COUNT(*) AS cnt
    FROM sunbiz_entities
    WHERE source = 'corevt' AND filing_number IS NOT NULL
    GROUP BY filing_number
    HAVING COUNT(*) > 1
  ) g;

  RAISE NOTICE '[migration 0063 audit] COREVT duplicate (source, filing_number) groups: %, excess rows to remove: %',
               dup_groups, dup_rows;
END $$;

-- Step 2: Guard — fail fast if non-corevt rows would block the constraint.
DO $$
DECLARE other_dups bigint;
BEGIN
  SELECT COUNT(*) INTO other_dups
  FROM (
    SELECT source, filing_number
    FROM sunbiz_entities
    WHERE source IS NOT NULL AND source != 'corevt' AND filing_number IS NOT NULL
    GROUP BY source, filing_number
    HAVING COUNT(*) > 1
  ) g;
  IF other_dups > 0 THEN
    RAISE EXCEPTION '[migration 0063] % non-corevt (source, filing_number) duplicate groups detected. '
                    'Deduplicate these rows before running this migration.', other_dups;
  END IF;
END $$;

-- Step 3: Deduplicate COREVT rows — keep highest id (most-recent import).
DELETE FROM sunbiz_entities
WHERE source = 'corevt'
  AND id IN (
    SELECT id FROM (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY filing_number
               ORDER BY id DESC
             ) AS rn
      FROM sunbiz_entities
      WHERE source = 'corevt' AND filing_number IS NOT NULL
    ) ranked
    WHERE rn > 1
  );

-- Step 4: Drop any prior global filing_number indexes/constraints.
DROP INDEX IF EXISTS sunbiz_entities_filing_number_idx;
ALTER TABLE sunbiz_entities DROP CONSTRAINT IF EXISTS sunbiz_entities_filing_number_unique;
DROP INDEX IF EXISTS sunbiz_entities_filing_number_unique;

-- Step 5: Add partial composite unique constraint —
-- (source, filing_number) uniqueness, NULL rows excluded.
CREATE UNIQUE INDEX IF NOT EXISTS sunbiz_entities_source_fn_unique
  ON sunbiz_entities (source, filing_number)
  WHERE source IS NOT NULL AND filing_number IS NOT NULL;
