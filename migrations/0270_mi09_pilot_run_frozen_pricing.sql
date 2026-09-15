-- Corrective item 4: frozen pricing authority at run creation.
--
-- executePilotCohortPhase() previously re-read mi09_pricing_artifacts LIVE on
-- every batch (most-recent-within-7-days wins). A multi-batch pilot run could
-- therefore price different batches of the SAME run against different
-- artifacts if an operator submitted new pricing partway through — no frozen
-- authority tied the run to the pricing that was reviewed when it started.
--
-- frozen_pricing_artifacts captures, at createPilotRun() time, the exact
-- mi09_pricing_artifacts row (id/amount_micros/captured_at) selected for every
-- paid provider the run's definition allows. NULL/'{}' for Level 1 (no paid
-- providers). Once set, this column is never updated — the run's own
-- APPEND_ONLY-style contract is enforced in application code (createPilotRun
-- is the only writer of this column; no UPDATE statement exists anywhere for
-- it), not a DB trigger, matching the lighter-weight convention already used
-- for cohort_frozen_hash on this same table.
ALTER TABLE mi09_pilot_runs
  ADD COLUMN frozen_pricing_artifacts JSONB NOT NULL DEFAULT '{}'::jsonb;
