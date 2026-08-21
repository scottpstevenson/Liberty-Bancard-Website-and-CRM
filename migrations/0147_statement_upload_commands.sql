-- Migration 0147: Durable idempotency foundation for statement-upload operations
--
-- Creates statement_upload_commands — one row per unique (operation_scope,
-- request_id) pair.  Provides:
--   • Atomic INSERT-or-detect for same-key replay vs fingerprint conflict.
--   • Owner-scope isolation (callers only see their own scope's row).
--   • Lifecycle columns: in_progress → succeeded | recoverable_failed.
--   • JSON checkpoint / context / result columns for crash-recovery.
--
-- Additive only; no existing tables are altered.

CREATE TABLE IF NOT EXISTS statement_upload_commands (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          text        NOT NULL,
  request_fingerprint text        NOT NULL,
  operation_scope     text        NOT NULL,
  source              text,
  contact_id          integer     REFERENCES contacts(id),
  deal_id             integer     REFERENCES deals(id),
  document_id         integer     REFERENCES documents(id),
  status              text        NOT NULL DEFAULT 'in_progress'
                                  CHECK (status IN ('in_progress','succeeded','recoverable_failed')),
  checkpoint          jsonb,
  context             jsonb,
  result              jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);

-- Primary idempotency constraint: one row per (scope, request_id) pair.
CREATE UNIQUE INDEX IF NOT EXISTS suc_scope_request_id_uidx
  ON statement_upload_commands (operation_scope, request_id);

-- Fast lookup by request_id alone (cross-scope conflict detection).
CREATE INDEX IF NOT EXISTS suc_request_id_idx
  ON statement_upload_commands (request_id);

-- Fast lookup by contact for dashboard queries.
CREATE INDEX IF NOT EXISTS suc_contact_id_idx
  ON statement_upload_commands (contact_id)
  WHERE contact_id IS NOT NULL;

-- Fast lookup by deal.
CREATE INDEX IF NOT EXISTS suc_deal_id_idx
  ON statement_upload_commands (deal_id)
  WHERE deal_id IS NOT NULL;
