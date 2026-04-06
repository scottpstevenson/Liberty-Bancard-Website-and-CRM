-- Performance indexes for high-volume tables
-- Safe: CREATE INDEX IF NOT EXISTS prevents duplicates

-- contacts (152K rows): email, phone, status, ghl_contact_id are common filters
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_contacts_ghl_id ON contacts(ghl_contact_id);
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_lead_score ON contacts(lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_business_id ON contacts(business_id);

-- deals (502 rows): pipeline, stage, contact_id are core CRM filters
CREATE INDEX IF NOT EXISTS idx_deals_pipeline ON deals(pipeline);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
CREATE INDEX IF NOT EXISTS idx_deals_contact_id ON deals(contact_id);
CREATE INDEX IF NOT EXISTS idx_deals_pipeline_stage ON deals(pipeline, stage);
CREATE INDEX IF NOT EXISTS idx_deals_created_at ON deals(created_at DESC);

-- tickets: status, priority, contact_id for dashboard filtering
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_contact_id ON tickets(contact_id);

-- tasks: status, assigned_to for task management
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_deal_id ON tasks(deal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_contact_id ON tasks(contact_id);

-- prospects: status, list_id, score for enrichment pipeline  
CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
CREATE INDEX IF NOT EXISTS idx_prospects_list_id ON prospects(list_id);
CREATE INDEX IF NOT EXISTS idx_prospects_score ON prospects(qualification_score);
CREATE INDEX IF NOT EXISTS idx_prospects_email ON prospects(email);

-- sunbiz_entities (1.9M rows): filing_number, enrichment_status, list_id are critical
CREATE INDEX IF NOT EXISTS idx_sunbiz_filing_number ON sunbiz_entities(filing_number);
CREATE INDEX IF NOT EXISTS idx_sunbiz_enrichment_status ON sunbiz_entities(enrichment_status);
CREATE INDEX IF NOT EXISTS idx_sunbiz_list_id ON sunbiz_entities(list_id);
CREATE INDEX IF NOT EXISTS idx_sunbiz_email ON sunbiz_entities(email);
CREATE INDEX IF NOT EXISTS idx_sunbiz_created_at ON sunbiz_entities(created_at DESC);

-- audit_logs: created_at for recent log queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- documents: contact_id, deal_id for document lookup
CREATE INDEX IF NOT EXISTS idx_documents_contact_id ON documents(contact_id);
CREATE INDEX IF NOT EXISTS idx_documents_deal_id ON documents(deal_id);

-- notifications: read status for unread count
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
