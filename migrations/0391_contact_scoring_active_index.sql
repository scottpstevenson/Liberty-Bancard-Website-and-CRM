-- Restore the 0067 writer contract omitted by the 0109 bootstrap snapshot
-- and declarative schema. Existing duplicate active jobs must be investigated;
-- never delete or terminalize them just to install the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS contact_lead_scoring_jobs_active_unique_idx
ON contact_lead_scoring_jobs (contact_id)
WHERE status NOT IN ('completed', 'contact_not_found', 'failed_terminal');
