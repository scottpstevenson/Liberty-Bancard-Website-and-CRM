-- BT-10 queue worker: a frozen queue item may create at most one queue-owned
-- outbound row, including across a crash/recovery cycle.
CREATE UNIQUE INDEX IF NOT EXISTS outbound_messages_campaign_queue_fence_uidx
  ON outbound_messages(campaign_id, contact_id, step_id)
  WHERE metadata ? 'queueRunId';