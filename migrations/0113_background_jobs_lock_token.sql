-- Add fencing token column to background_jobs.
-- Populated by acquireJobLock on every acquisition; releaseJobLock validates it
-- so a slow/crashed old owner cannot overwrite the new owner's lock state.
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS lock_token TEXT;
