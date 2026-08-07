-- Partial indexes on archived_at IS NULL for contacts and deals.
-- COUNT(*) WHERE archived_at IS NULL was doing a full-table sequential scan
-- (existing composite indexes on (email, archived_at) etc. are not used for bare COUNT).
-- These partial indexes allow PostgreSQL to use an index-only scan for any query
-- that filters on archived_at IS NULL, including the health-monitor kpiQuery check.
--
-- NOTE: CONCURRENTLY removed — Drizzle runs migrations inside a transaction block,
-- and CREATE INDEX CONCURRENTLY is not allowed inside a transaction.
-- The indexes are still created correctly; the only difference is a brief table
-- lock during index build (acceptable for a one-time startup migration).

CREATE INDEX IF NOT EXISTS contacts_active_idx
  ON contacts (id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS deals_active_idx
  ON deals (id)
  WHERE archived_at IS NULL;
