-- Task #2002 corrective patch: prioritize South Florida (Miami-Dade, Broward,
-- Palm Beach) source businesses in the Sunbiz full-backlog backfill, using
-- the existing CRO-03A versioned geography reference
-- (server/services/cro03a/geography.ts, evaluateSouthFloridaGeography()).
--
-- The single-row run coordinator (sunbiz_bootstrap_runs) gains a two-phase
-- cursor: 'south_florida' runs first over the entire id range, filtered to
-- geography-eligible rows only; once that phase exhausts its eligible rows,
-- 'remaining' runs a second full id-range pass with no geography filter
-- (already-processed South Florida rows are skipped via the existing
-- sunbiz_bootstrap_claims NOT EXISTS predicate, not by cursor position, so
-- no row is ever silently skipped). high_water_entity_id/processed_count/
-- dead_letter_count are retained unchanged as running totals across both
-- phases so existing consumers (admin UI, prior tests) keep working; the
-- new soflo_*/remaining_* columns hold the per-phase breakdown the operator
-- needs to see progress on each lane separately.

ALTER TABLE sunbiz_bootstrap_runs
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'south_florida',
  ADD COLUMN IF NOT EXISTS soflo_high_water_entity_id integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_high_water_entity_id integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS soflo_processed_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS soflo_dead_letter_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_processed_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_dead_letter_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS geography_reference_version text;
