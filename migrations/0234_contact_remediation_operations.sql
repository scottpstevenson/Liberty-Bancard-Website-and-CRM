-- Migration: 0234_contact_remediation_operations
-- Task #1835: Bulk contactability remediation operations
--
-- Adds a durable operation-tracking table for bulk remediation actions
-- (email validation trigger, fake-phone suppression) against a quality-v1 run.
-- A partial unique index prevents duplicate in-flight operations.

CREATE TABLE IF NOT EXISTS contact_remediation_operations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       UUID NOT NULL REFERENCES contact_reconciliation_runs(id) ON DELETE CASCADE,
  signal_code  TEXT NOT NULL,
  operation_type TEXT NOT NULL,   -- 'validate_emails' | 'suppress_fake_phones'
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','running','completed','failed')),
  initiated_by TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  result_summary JSONB
);

-- Prevent duplicate in-flight operations for the same run + signal + operation type.
CREATE UNIQUE INDEX IF NOT EXISTS cro_no_duplicate_inflight
  ON contact_remediation_operations (run_id, signal_code, operation_type)
  WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS cro_run_id_idx ON contact_remediation_operations (run_id);
