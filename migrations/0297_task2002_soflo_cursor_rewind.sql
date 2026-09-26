-- Task #2002 corrective patch: fix the South Florida cursor overflow bug.
--
-- selectSunbizBootstrapCandidateWindow()'s South Florida branch previously
-- reported maxIdExamined as the highest id in the WHOLE scanned window,
-- regardless of how many eligible rows fit into the microbatch limit. When a
-- scan window contained more eligible rows than the batch could process
-- (e.g. 35 eligible rows against a 25-row limit), the cursor advanced past
-- the unprocessed 10 -- and because those rows were never claimed or
-- attempted, they are not "retryable failures" and the existing
-- computeNextHighWaterEntityId() guard could not protect them. They would
-- have been silently and permanently skipped by the south_florida phase.
--
-- This migration rewinds the soflo lane cursor once so the initial range is
-- re-scanned under the fixed selector. Already-completed work is not
-- repeated: sunbiz_bootstrap_claims' NOT EXISTS predicate (status not in
-- 'failed'-below-retry-threshold or stale-'claimed') permanently excludes
-- every terminal claim (created/matched_existing/dead_letter/etc.) by
-- filing_number, independent of cursor position. Retryable failures remain
-- reachable either way. high_water_entity_id (the cross-phase running total
-- surfaced to the admin UI) is reset to the remaining-lane's cursor so it
-- never reports progress higher than what is actually confirmed complete.
--
-- Scoped to id='default' AND status='paused' AND phase='south_florida' AND
-- soflo_high_water_entity_id > 0 so this is a no-op everywhere except the
-- exact affected run state; verified against production before applying
-- that the run was paused in this phase with a nonzero cursor.
UPDATE sunbiz_bootstrap_runs
SET soflo_high_water_entity_id = 0,
    high_water_entity_id = GREATEST(remaining_high_water_entity_id, 0),
    updated_at = now()
WHERE id = 'default'
  AND status = 'paused'
  AND phase = 'south_florida'
  AND soflo_high_water_entity_id > 0;
