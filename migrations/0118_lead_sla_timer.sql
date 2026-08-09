-- Migration 0118: Lead freshness SLA timer column
-- Adds next_sla_due_at to contacts so the SLA worker can detect high-value
-- leads that have not received a human touch within the configured window.
-- Set by processNewLead() for leads whose score meets the threshold.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS next_sla_due_at timestamp;
CREATE INDEX IF NOT EXISTS contacts_next_sla_due_at_idx ON contacts (next_sla_due_at);
