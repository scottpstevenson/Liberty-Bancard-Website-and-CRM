-- CRO-03A qualification command outbox: add claimed_at for stale-processing recovery.
-- A command transitions to 'processing' when the outbox processor claims it. If the
-- process crashes before marking it 'completed' or 'failed', the row stays in
-- 'processing' forever. claimed_at lets the processor reclaim rows that have been
-- in 'processing' for more than 30 minutes (configurable threshold).

ALTER TABLE cro03a_qualification_commands
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- Partial index for efficient stale-processing recovery scan.
CREATE INDEX IF NOT EXISTS cro03a_qualification_commands_stale_processing_idx
  ON cro03a_qualification_commands (claimed_at)
  WHERE state = 'processing';
