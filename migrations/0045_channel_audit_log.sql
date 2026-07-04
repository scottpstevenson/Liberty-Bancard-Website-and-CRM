-- 0045_channel_audit_log.sql
-- Task #695 — Voice/SMS/Ringless Go-Live Audit (Approval Gate, not activation).
-- Append-only audit trail for channel approval-gate actions (checklist_viewed,
-- enable_approved, disabled_recorded, test_batch_preview). This table is never
-- written to by any process that enables/disables SMS_ENABLED, VOICE_AI_ENABLED,
-- or RINGLESS_VM_ENABLED — those remain Replit Secrets requiring manual
-- operator action + restart.
-- Idempotent: uses CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS channel_audit_log (
  id serial PRIMARY KEY,
  channel text NOT NULL,
  action text NOT NULL,
  checklist_snapshot jsonb,
  actor_user_id text,
  actor_email text,
  notes text,
  created_at timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS channel_audit_log_channel_idx ON channel_audit_log(channel);
CREATE INDEX IF NOT EXISTS channel_audit_log_created_at_idx ON channel_audit_log(created_at);
