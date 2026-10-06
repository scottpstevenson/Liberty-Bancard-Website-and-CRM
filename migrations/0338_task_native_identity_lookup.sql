CREATE INDEX IF NOT EXISTS tasks_native_contact_identity_idx ON tasks(contact_id,ghl_task_id) WHERE ghl_task_id IS NOT NULL;
