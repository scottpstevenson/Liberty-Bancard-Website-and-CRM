-- Migration 0226: Census ownership, frozen watermark, terminal exception tracking (#1817 corrections)
--
-- Adds:
--   max_contact_id_at_start   — ending watermark for frozen membership (contacts with id > this never enter the run)
--   terminal_snapshot_exceptions — contacts in watermark range that were archived mid-run and thus not classified
--   lease_owner               — "hostname:pid" of the process that currently owns this run
--   lease_expires_at          — must be refreshed every N batches; stale = crashed owner
--
-- Unique partial index:
--   census_runs_one_active    — at most one row may have status IN ('pending','running') at any time.
--                               Two concurrent inserts or status→running upgrades both get a unique_violation (23505).
--                               This is the sole DB enforcement mechanism for single-run ownership.
--
-- NOTE: CREATE INDEX without CONCURRENTLY is required here because migrate() runs inside a transaction.

ALTER TABLE contact_census_runs
  ADD COLUMN IF NOT EXISTS max_contact_id_at_start    integer,
  ADD COLUMN IF NOT EXISTS terminal_snapshot_exceptions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lease_owner                text,
  ADD COLUMN IF NOT EXISTS lease_expires_at           timestamptz;

-- Enforce single active run at the database level.
-- The expression (true) is a constant; together with the partial filter it means:
-- "among all rows where status is active, the constant value true must be unique" — i.e. at most one such row.
CREATE UNIQUE INDEX IF NOT EXISTS census_runs_one_active
  ON contact_census_runs ((true))
  WHERE status IN ('pending', 'running');
