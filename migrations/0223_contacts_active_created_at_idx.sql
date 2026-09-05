-- Partial index covering the default People list sort (created_at DESC, id DESC)
-- filtered to active (non-archived) contacts.
--
-- Without this index the planner falls back to a full parallel seq scan of the
-- 161K-row contacts table (388 MB heap) followed by a top-N heapsort, taking
-- ~9 seconds in dev and 230+ seconds in production when combined with a wide
-- column projection.  With this index the planner uses an index scan returning
-- rows already in sort order and fetches only the 100 heap pages actually
-- needed, reducing the default People list to < 50 ms.
--
-- CREATE INDEX IF NOT EXISTS is safe to replay; CONCURRENTLY is intentionally
-- omitted because migrate() runs inside a transaction (see
-- concurrent-index-migration-fix in .agents/memory/).
CREATE INDEX IF NOT EXISTS contacts_active_created_at_idx
  ON contacts (created_at DESC NULLS LAST, id DESC)
  WHERE archived_at IS NULL;
