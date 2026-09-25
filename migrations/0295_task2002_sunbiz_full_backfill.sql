-- Task #2002 (completion): durable run/high-water tracking + retry/dead-letter
-- support for the resumable Sunbiz full-backlog microbatch processor.
--
-- sunbiz_bootstrap_claims already provides per-filing idempotency and lease
-- fencing (Task #1956/#2002). This migration adds:
--   1. retry_count on the claim row, so repeated transient failures can be
--      distinguished from a fresh 'claimed' lease and eventually routed to a
--      terminal 'dead_letter' status instead of retrying forever.
--   2. sunbiz_bootstrap_runs: a single-row (id='default') durable run
--      coordinator holding the corpus-level high-water mark (highest
--      sunbiz_entities.id examined so far), run status (idle/running/paused/
--      completed/failed), and a fenced lease (owner + expiry) so only one
--      worker instance advances the cursor at a time even under concurrent
--      ticks (e.g. a manual admin trigger racing the recurring worker).

ALTER TABLE sunbiz_bootstrap_claims
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS sunbiz_bootstrap_runs (
  id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'idle',
  high_water_entity_id integer NOT NULL DEFAULT 0,
  total_entities bigint,
  processed_count bigint NOT NULL DEFAULT 0,
  dead_letter_count bigint NOT NULL DEFAULT 0,
  current_run_id text,
  lease_owner text,
  lease_expires_at timestamp with time zone,
  last_batch_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

INSERT INTO sunbiz_bootstrap_runs (id, status)
VALUES ('default', 'idle')
ON CONFLICT (id) DO NOTHING;
