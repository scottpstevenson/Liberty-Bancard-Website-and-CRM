-- Fix the census_recon_one_active partial unique index so it enforces
-- at most ONE active run (pending OR running) across all instances,
-- not one-of-each status.
--
-- The original index was: UNIQUE (status) WHERE status IN ('pending','running')
-- which allows one row with status='pending' AND one with status='running'
-- simultaneously (since they are different index key values).
--
-- The corrected index uses a constant expression ((1)) as the key so all rows
-- in the filtered set compete for the same slot — mirroring the census runner.

DROP INDEX IF EXISTS census_recon_one_active;

CREATE UNIQUE INDEX census_recon_one_active
  ON contact_reconciliation_runs ((1))
  WHERE status IN ('pending', 'running');

-- Unique constraint on normalization proposals to prevent duplicates on resume.
-- A (run, contact, proposal_type, field_name) tuple is the natural identity —
-- the runner only proposes one change per field per contact per run.
CREATE UNIQUE INDEX IF NOT EXISTS contact_normalization_proposals_run_contact_field_unique
  ON contact_normalization_proposals (run_id, contact_id, proposal_type, field_name);
