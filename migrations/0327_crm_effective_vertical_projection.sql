ALTER TABLE businesses ADD COLUMN IF NOT EXISTS effective_vertical_id text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS effective_vertical_status text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS effective_vertical_id text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS effective_vertical_status text;
CREATE INDEX IF NOT EXISTS businesses_effective_vertical_idx ON businesses(effective_vertical_id);
CREATE INDEX IF NOT EXISTS contacts_effective_vertical_idx ON contacts(effective_vertical_id) WHERE archived_at IS NULL;