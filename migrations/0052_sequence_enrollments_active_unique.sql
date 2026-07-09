CREATE UNIQUE INDEX IF NOT EXISTS idx_sequence_enrollments_active_unique
ON sequence_enrollments(contact_id, sequence_id)
WHERE status IN ('active', 'paused');
