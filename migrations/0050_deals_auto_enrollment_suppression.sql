ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS auto_enrollment_suppressed_at timestamp,
  ADD COLUMN IF NOT EXISTS auto_enrollment_suppressed_reason text;
