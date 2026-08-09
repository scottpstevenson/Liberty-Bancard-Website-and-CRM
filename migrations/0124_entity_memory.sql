-- #1408 — AI Memory Architecture: entity_memory table
-- Accumulated facts about contacts and deals. Each (entity_type, entity_id, fact_key)
-- is upserted so the table holds the current best-known value per key.

CREATE TABLE IF NOT EXISTS entity_memory (
  id              SERIAL PRIMARY KEY,
  entity_type     TEXT    NOT NULL,    -- contact | deal | merchant
  entity_id       INTEGER NOT NULL,
  fact_key        TEXT    NOT NULL,    -- e.g. "preferred_contact_time", "objection_price"
  fact_value      JSONB   NOT NULL,    -- scalar or structured value
  source          TEXT    NOT NULL DEFAULT 'system', -- ai | human | system
  confidence      REAL,               -- 0.0–1.0 when source=ai
  source_event_id INTEGER,            -- FK to communication_events.id if derived from comms
  version         INTEGER NOT NULL DEFAULT 1,
  last_updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_memory_upsert
  ON entity_memory(entity_type, entity_id, fact_key);

CREATE INDEX IF NOT EXISTS idx_entity_memory_entity
  ON entity_memory(entity_type, entity_id);
