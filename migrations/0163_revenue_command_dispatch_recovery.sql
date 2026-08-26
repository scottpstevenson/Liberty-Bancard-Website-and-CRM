-- BT-12 follow-up: execution leases and retry scheduling for the durable
-- reconciliation ledgers introduced in 0162.
ALTER TABLE deal_stage_effect_intents
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamp NOT NULL DEFAULT now();
ALTER TABLE chargeback_submission_commands
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS reconcile_required_at timestamp;
-- Preserve the legacy REAL configuration for read-only history. New imports and
-- settings use this exact-decimal threshold; no historical correction is made.
ALTER TABLE residual_imports
  ADD COLUMN IF NOT EXISTS variance_threshold_amt_decimal numeric(14,2);

CREATE INDEX IF NOT EXISTS deal_stage_effect_intents_ready_idx
  ON deal_stage_effect_intents (state, next_attempt_at, lease_expires_at);
CREATE INDEX IF NOT EXISTS chargeback_submission_commands_ready_idx
  ON chargeback_submission_commands (state, next_attempt_at, lease_expires_at);