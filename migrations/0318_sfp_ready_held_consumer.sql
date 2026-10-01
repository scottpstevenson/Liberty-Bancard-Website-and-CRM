-- Durable bounded progress for the SFP ready_held -> paused bridge consumer.
-- This ledger is orchestration only; the bridge remains the authority for
-- current eligibility, canonical contact identity and paused enrollment.
CREATE TABLE IF NOT EXISTS sfp_ready_held_consumer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staging_intent_id UUID NOT NULL
    REFERENCES sfp_campaign_staging_intents(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','claimed','retry','held','completed','dead_letter')),
  actor_id TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  runtime_owner_epoch BIGINT,
  runtime_owner_token UUID,
  runtime_deployment_identity TEXT,
  runtime_environment_identity TEXT,
  runtime_artifact_sha TEXT,
  runtime_process_identity TEXT,
  runtime_queue_topology_hash TEXT,
  outcome_code TEXT,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (staging_intent_id),
  CONSTRAINT sfp_ready_held_consumer_owner_binding_chk CHECK (
    (runtime_owner_epoch IS NULL AND runtime_owner_token IS NULL
      AND runtime_deployment_identity IS NULL AND runtime_environment_identity IS NULL
      AND runtime_artifact_sha IS NULL AND runtime_process_identity IS NULL
      AND runtime_queue_topology_hash IS NULL)
    OR
    (runtime_owner_epoch > 0 AND runtime_owner_token IS NOT NULL
      AND runtime_deployment_identity IS NOT NULL AND runtime_environment_identity IS NOT NULL
      AND runtime_artifact_sha IS NOT NULL AND runtime_process_identity IS NOT NULL
      AND runtime_queue_topology_hash IS NOT NULL)
  ),
  CONSTRAINT sfp_ready_held_consumer_claim_binding_chk CHECK (
    (state='claimed' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL
      AND runtime_owner_epoch IS NOT NULL AND runtime_owner_token IS NOT NULL)
    OR state<>'claimed'
  )
);

CREATE INDEX IF NOT EXISTS sfp_ready_held_consumer_claim_idx
  ON sfp_ready_held_consumer_items (state, next_attempt_at, lease_expires_at, created_at);