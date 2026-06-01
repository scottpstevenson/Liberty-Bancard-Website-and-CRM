ALTER TABLE ai_audit_logs ADD COLUMN IF NOT EXISTS prompt_hash text;
ALTER TABLE ai_audit_logs ADD COLUMN IF NOT EXISTS confidence_score real DEFAULT 0;
ALTER TABLE ai_audit_logs ADD COLUMN IF NOT EXISTS flagged boolean DEFAULT false;
ALTER TABLE ai_audit_logs ADD COLUMN IF NOT EXISTS raw_prompt text;
ALTER TABLE ai_audit_logs ADD COLUMN IF NOT EXISTS raw_response text;

CREATE INDEX IF NOT EXISTS ai_audit_logs_flagged_idx ON ai_audit_logs (flagged);
