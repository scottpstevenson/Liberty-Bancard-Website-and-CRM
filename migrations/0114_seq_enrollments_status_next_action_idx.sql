-- Migration: add composite partial index on sequence_enrollments for due-work query
-- Supports: WHERE status = 'active' AND next_action_at IS NOT NULL AND next_action_at <= now
CREATE INDEX IF NOT EXISTS seq_enrollments_status_next_action_idx
  ON sequence_enrollments (status, next_action_at)
  WHERE status = 'active';
