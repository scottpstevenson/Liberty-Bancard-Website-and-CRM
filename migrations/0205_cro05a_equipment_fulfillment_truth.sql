-- CRO-05A equipment fulfillment: bind every internal artifact to its claimed
-- request and provide durable replay fences and SLA evidence.
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS inbound_request_id UUID REFERENCES inbound_requests(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS deals_inbound_request_uidx
  ON deals (inbound_request_id)
  WHERE inbound_request_id IS NOT NULL;

ALTER TABLE equipment_orders
  ADD COLUMN IF NOT EXISTS inbound_request_id UUID REFERENCES inbound_requests(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS command_key TEXT,
  ADD COLUMN IF NOT EXISTS fulfillment_due_at TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS equipment_orders_command_key_uidx
  ON equipment_orders (command_key)
  WHERE command_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS equipment_orders_inbound_request_idx
  ON equipment_orders (inbound_request_id);

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS inbound_request_id UUID REFERENCES inbound_requests(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS command_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_command_key_uidx
  ON notifications (command_key)
  WHERE command_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_inbound_request_idx
  ON notifications (inbound_request_id);

-- Historical equipment occurrences retain their immutable v1 manifest
-- identity, but receive the newly required held intent. They cannot complete
-- until an operator establishes request-owned artifact evidence.
INSERT INTO inbound_request_effects (
  request_id,
  effect_key,
  effect_type,
  state,
  required,
  external_side_effect,
  prerequisites,
  terminal_reason
)
SELECT
  id,
  'internal_notification',
  'internal_notification',
  'held',
  TRUE,
  FALSE,
  '["fulfillment"]'::jsonb,
  'FULFILLMENT_DURABLE_EVIDENCE_MISSING'
FROM inbound_requests
WHERE source_category = 'website_form'
  AND source_type = 'equipment_order'
ON CONFLICT (request_id, effect_key) DO NOTHING;