-- Add missing ghl_opportunity_id column to deals (schema drift: defined in schema.ts but never migrated)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS ghl_opportunity_id text;

-- Performance index: GHL opportunity ID lookup on deals
CREATE INDEX IF NOT EXISTS deals_ghl_opportunity_id_idx ON deals(ghl_opportunity_id);

-- Performance index: composite lookup on audit_logs for SLA throttle queries
CREATE INDEX IF NOT EXISTS audit_logs_entity_type_entity_id_action_idx ON audit_logs(entity_type, entity_id, action);
