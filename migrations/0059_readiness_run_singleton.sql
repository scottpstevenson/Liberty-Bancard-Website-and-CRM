-- Enforce at-most-one running readiness backfill at a time via a partial
-- unique index on the constant expression (true).  Any INSERT with
-- status='running' will raise unique_violation (23505) when a running row
-- already exists, making the singleton guarantee DB-level and atomic.
CREATE UNIQUE INDEX IF NOT EXISTS contact_readiness_runs_singleton_active
  ON contact_readiness_runs ((true))
  WHERE status = 'running';
