-- campaign_previews: durable, DB-backed record of every audience preview run.
-- The queue endpoint requires a completed, unexpired, unconsumed preview whose
-- targeting hash matches the current campaign settings before it will proceed.

CREATE TABLE IF NOT EXISTS campaign_previews (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',       -- running | done | failed | interrupted
  eligible_count INTEGER,
  total_in_verticals INTEGER,
  blocked_count INTEGER,
  block_reasons JSONB NOT NULL DEFAULT '{}',
  sample_contacts JSONB NOT NULL DEFAULT '[]',
  target_verticals TEXT[] NOT NULL DEFAULT '{}',
  targeting_hash TEXT NOT NULL,                 -- sha256 of {verticals(sorted), targetListId, stepCount}
  requested_by TEXT,                            -- user email / id of the operator who started it
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,                       -- set to completedAt + 1 hour when done
  consumed_at TIMESTAMPTZ                       -- set when successfully used for queuing
);

CREATE INDEX IF NOT EXISTS idx_campaign_previews_campaign_id
  ON campaign_previews(campaign_id);

-- Restart-safety: if the server was killed mid-preview, any rows left in
-- 'running' status must be marked interrupted so they are never used for queuing.
UPDATE campaign_previews SET status = 'interrupted' WHERE status = 'running';
