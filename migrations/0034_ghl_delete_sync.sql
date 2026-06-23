-- GHL Bidirectional Delete Propagation
-- Add soft-delete column and GHL task ID tracking to tasks table

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ghl_task_id text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at timestamp;

CREATE INDEX IF NOT EXISTS tasks_ghl_task_id_idx ON tasks(ghl_task_id);
CREATE INDEX IF NOT EXISTS tasks_deleted_at_idx ON tasks(deleted_at);
