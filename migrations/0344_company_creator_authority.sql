ALTER TABLE companies ADD COLUMN IF NOT EXISTS created_by_user_id varchar REFERENCES users(id);
