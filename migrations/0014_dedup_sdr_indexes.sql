-- Add composite indexes for contact deduplication queries
-- contacts(email, archived_at) — supports GROUP BY dedup on normalized email with archived_at IS NULL filter
CREATE INDEX IF NOT EXISTS "contacts_email_archived_at_idx" ON "contacts" ("email","archived_at");

-- contacts(phone, archived_at) — supports GROUP BY dedup on normalized phone with archived_at IS NULL filter
CREATE INDEX IF NOT EXISTS "contacts_phone_archived_at_idx" ON "contacts" ("phone","archived_at");

-- Add composite indexes for SDR dashboard aggregation queries
-- sdr_lead_state(stage, updated_at) — supports CASE/SUM aggregation filtering by stage + updatedAt >= today
CREATE INDEX IF NOT EXISTS "sdr_lead_state_stage_updated_at_idx" ON "sdr_lead_state" ("stage","updated_at");

-- sdr_lead_state(current_stage, updated_at) — same dashboard query uses currentStage column too
CREATE INDEX IF NOT EXISTS "sdr_lead_state_current_stage_updated_at_idx" ON "sdr_lead_state" ("current_stage","updated_at");

-- Add indexes on sdr_lead_events (previously had none)
-- sdr_lead_events(event_type, created_at) — supports eq(eventType) + gte(createdAt) filter queries
CREATE INDEX IF NOT EXISTS "sdr_lead_events_event_type_created_at_idx" ON "sdr_lead_events" ("event_type","created_at");

-- sdr_lead_events(created_at) — supports the broad GROUP BY event_type WHERE created_at >= today aggregation
CREATE INDEX IF NOT EXISTS "sdr_lead_events_created_at_idx" ON "sdr_lead_events" ("created_at");
