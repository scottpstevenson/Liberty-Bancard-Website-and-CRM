-- Live Health Monitor (and other admin dashboards) filter audit_logs by
-- `action IN (...)` and order by created_at DESC LIMIT 1. audit_logs is a
-- large, append-only, ever-growing table with no index on `action`, so these
-- lookups degenerate into full sequential scans and hit the pool's 30s
-- statement_timeout under load (observed in /api/admin/live-health and
-- /api/admin/enrichment/activation-status). Add a composite index to make
-- these point lookups fast regardless of table size.
CREATE INDEX IF NOT EXISTS audit_logs_action_created_at_idx
  ON audit_logs (action, created_at DESC);
