-- Migration: add composite partial index on sequence_enrollments for due-work query
-- Supports: WHERE status = 'active' AND next_action_at IS NOT NULL AND next_action_at <= now
--
-- WHY PARTIAL (WHERE status = 'active'):
--   • Keeps the index narrow — only due/pending rows are indexed, not completed/paused.
--   • Avoids rebuilding a full-table index at migration time on a 155 K+ row table.
--   • The query planner uses this index for the exact predicate pattern the worker uses.
--
-- NOTE: CREATE INDEX CONCURRENTLY is intentionally NOT used here.
--   Drizzle's migrate() wraps each SQL file in an implicit transaction, and Postgres
--   forbids CONCURRENTLY inside a transaction block. IF NOT EXISTS is the safe
--   idempotent alternative — it skips creation if the index already exists.
CREATE INDEX IF NOT EXISTS seq_enrollments_status_next_action_idx
  ON sequence_enrollments (status, next_action_at)
  WHERE status = 'active';
