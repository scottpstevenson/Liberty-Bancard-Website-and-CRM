-- Durable, source-scoped Inbox identity and draft-only statement review state.
-- No provider, messaging, or delivery behavior is enabled by this migration.

ALTER TABLE inbox_items
  ADD COLUMN IF NOT EXISTS source_namespace TEXT,
  ADD COLUMN IF NOT EXISTS provider_conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS source_body TEXT,
  ADD COLUMN IF NOT EXISTS source_received_at TIMESTAMPTZ;

ALTER TABLE inbox_items
  ALTER COLUMN source_namespace SET DEFAULT 'legacy';

DROP INDEX IF EXISTS inbox_items_source_item_id_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS inbox_items_source_identity_uidx
  ON inbox_items(COALESCE(source_namespace, 'legacy'), source_item_id);

ALTER TABLE statement_reviews
  ADD COLUMN IF NOT EXISTS savings_evidence JSONB,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS create_command_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS statement_reviews_document_identity_uidx
  ON statement_reviews(document_id) WHERE document_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS statement_reviews_create_command_key_uidx
  ON statement_reviews(create_command_key) WHERE create_command_key IS NOT NULL;