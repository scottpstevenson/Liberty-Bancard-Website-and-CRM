-- Add sending_at timestamp to outbound_messages to support the in-flight
-- "sending" status guard that prevents duplicate sends on worker crash/restart.
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS sending_at TIMESTAMP;
