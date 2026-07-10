-- Phase 1: Add stable machine-identity columns to tasks table.
-- source: identifies the system that created the task (e.g. 'sla')
-- automation_key: identifies the specific automation rule (e.g. 'stalling-deal-follow-up')
-- Both are nullable; existing rows default to NULL.
-- These columns are intentionally excluded from insertTaskSchema / PublicTaskCreateInput
-- to prevent client-facing code from setting them directly.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS automation_key text;
