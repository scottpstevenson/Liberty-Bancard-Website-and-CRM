-- BT-12 durable consumer receipts. One receipt is the immutable logical
-- operation boundary for a stage-effect intent; it is never an in-memory flag.
CREATE TABLE IF NOT EXISTS deal_stage_effect_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effect_intent_id uuid NOT NULL REFERENCES deal_stage_effect_intents(id) ON DELETE CASCADE,
  target_key text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  provider_idempotency_key text NOT NULL,
  provider_reference text,
  result jsonb,
  error text,
  created_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp,
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT deal_stage_effect_receipts_unique UNIQUE (effect_intent_id, target_key)
);

-- Existing imports get a one-time explicit two-decimal policy conversion.
-- There is no runtime fallback to the legacy REAL field after this migration.
UPDATE residual_imports
SET variance_threshold_amt_decimal = round(variance_threshold_amt::numeric, 2)
WHERE variance_threshold_amt_decimal IS NULL;

ALTER TABLE residual_imports
  ALTER COLUMN variance_threshold_amt_decimal SET DEFAULT 50.00,
  ALTER COLUMN variance_threshold_amt_decimal SET NOT NULL;