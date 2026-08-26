-- BT-12: durable recovery facts for canonical stage transitions, immutable
-- sequence experiment facts, and chargeback submission commands.

CREATE TABLE IF NOT EXISTS deal_stage_effect_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id integer NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  transition_key text NOT NULL,
  effect_type text NOT NULL,
  idempotency_key text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_expires_at timestamp,
  last_error text,
  result jsonb,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT deal_stage_effect_intents_unique UNIQUE (deal_id, transition_key, effect_type),
  CONSTRAINT deal_stage_effect_intents_idempotency_unique UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS deal_stage_effect_intents_dispatch_idx
  ON deal_stage_effect_intents (state, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS sequence_step_ab_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id integer NOT NULL REFERENCES sequence_enrollments(id) ON DELETE CASCADE,
  sequence_step_id integer NOT NULL REFERENCES sequence_steps(id) ON DELETE CASCADE,
  config_hash text NOT NULL,
  variant text NOT NULL CHECK (variant IN ('A', 'B')),
  eligibility_snapshot jsonb NOT NULL,
  delivery_log_id integer,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT sequence_step_ab_assignments_one_variant UNIQUE (enrollment_id, sequence_step_id)
);
CREATE INDEX IF NOT EXISTS sequence_step_ab_assignments_step_idx
  ON sequence_step_ab_assignments (sequence_step_id, config_hash);

CREATE TABLE IF NOT EXISTS sequence_ab_evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'accepted',
  lease_token uuid,
  lease_expires_at timestamp,
  started_at timestamp,
  completed_at timestamp,
  error text,
  snapshot jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sequence_ab_winner_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_step_id integer NOT NULL REFERENCES sequence_steps(id) ON DELETE CASCADE,
  config_hash text NOT NULL,
  winner text NOT NULL CHECK (winner IN ('A', 'B')),
  evaluation_snapshot jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT sequence_ab_winner_decisions_unique UNIQUE (sequence_step_id, config_hash)
);

ALTER TABLE chargebacks
  ADD COLUMN IF NOT EXISTS amount_decimal numeric(14,2);
CREATE TABLE IF NOT EXISTS chargeback_submission_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chargeback_id integer NOT NULL REFERENCES chargebacks(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  request_fingerprint text NOT NULL,
  evidence_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_expires_at timestamp,
  provider_case_id text,
  provider_result jsonb,
  last_error text,
  submitted_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chargeback_submission_commands_idempotency_unique UNIQUE (chargeback_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS chargeback_submission_commands_dispatch_idx
  ON chargeback_submission_commands (state, lease_expires_at, created_at);