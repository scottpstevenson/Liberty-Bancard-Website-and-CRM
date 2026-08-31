-- CRO-07: Controlled Delivery, Reply, Growth & Conversion Feedback.
-- Additive only. Never touches cr06_* tables; references cr06_delivery_intents
-- by id only. The CR-06 release endpoint contract stays unchanged.

CREATE TABLE IF NOT EXISTS cro07_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cr06_delivery_intent_id UUID NOT NULL REFERENCES cr06_delivery_intents(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'draft',
  reviewed_sha TEXT NOT NULL,
  migration_head TEXT NOT NULL,
  cr06_gate_id UUID REFERENCES cr06_campaign_gates(id) ON DELETE RESTRICT,
  cr06_program_artifact_id UUID REFERENCES cr06_artifacts(id) ON DELETE RESTRICT,
  cr06_cohort_run_id UUID REFERENCES cr04_cohort_runs(id) ON DELETE RESTRICT,
  sender_route TEXT NOT NULL,
  adapter_key TEXT NOT NULL DEFAULT 'denied_fake',
  environment TEXT NOT NULL DEFAULT 'disabled',
  readiness_snapshot JSONB NOT NULL,
  suppression_generation TEXT NOT NULL,
  pause_epoch TEXT NOT NULL,
  caps JSONB NOT NULL,
  canary_size INTEGER NOT NULL DEFAULT 0,
  stop_thresholds JSONB NOT NULL,
  dependency_snapshot JSONB NOT NULL,
  dependency_fingerprint TEXT NOT NULL,
  approver_id TEXT,
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revision_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- Kill line: at most one draft/approved/active CRO-07 release chain per CR-06 intent.
CREATE UNIQUE INDEX IF NOT EXISTS cro07_release_active_chain_per_intent_uidx
  ON cro07_releases (cr06_delivery_intent_id)
  WHERE state IN ('draft','approved','active');

CREATE INDEX IF NOT EXISTS cro07_release_intent_idx ON cro07_releases (cr06_delivery_intent_id);

CREATE TABLE IF NOT EXISTS cro07_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL REFERENCES cro07_releases(id) ON DELETE RESTRICT,
  capacity_key TEXT NOT NULL,
  reserved_cap INTEGER NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS cro07_reservation_release_key_uidx
  ON cro07_reservations (release_id, capacity_key);

CREATE TABLE IF NOT EXISTS cro07_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL REFERENCES cro07_releases(id) ON DELETE RESTRICT,
  cr06_delivery_intent_id UUID NOT NULL REFERENCES cr06_delivery_intents(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  lease_token UUID NOT NULL DEFAULT gen_random_uuid(),
  fence_epoch TEXT NOT NULL,
  provider TEXT NOT NULL,
  adapter_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'reserved',
  provider_attempt_id TEXT,
  redacted_error TEXT,
  attempted_at TIMESTAMPTZ,
  terminal_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cro07_attempt_intent_idx ON cro07_attempts (cr06_delivery_intent_id);
CREATE INDEX IF NOT EXISTS cro07_attempt_release_state_idx ON cro07_attempts (release_id, state);

CREATE TABLE IF NOT EXISTS cro07_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES cro07_attempts(id) ON DELETE RESTRICT,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cro07_feedback_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  provider_account_id TEXT,
  provider_event_id TEXT NOT NULL,
  signature_valid BOOLEAN NOT NULL,
  attempt_id UUID REFERENCES cro07_attempts(id) ON DELETE RESTRICT,
  release_id UUID REFERENCES cro07_releases(id) ON DELETE RESTRICT,
  cr06_delivery_intent_id UUID REFERENCES cr06_delivery_intents(id) ON DELETE RESTRICT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE RESTRICT,
  contact_generation INTEGER,
  event_type TEXT NOT NULL,
  canonical_effect TEXT NOT NULL,
  provider_occurred_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS cro07_feedback_source_event_uidx
  ON cro07_feedback_receipts (source, provider_event_id);
CREATE INDEX IF NOT EXISTS cro07_feedback_intent_idx ON cro07_feedback_receipts (cr06_delivery_intent_id);

CREATE TABLE IF NOT EXISTS cro07_reply_work (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_receipt_id UUID NOT NULL UNIQUE REFERENCES cro07_feedback_receipts(id) ON DELETE RESTRICT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  occurrence_key TEXT NOT NULL UNIQUE,
  cr05_task_id INTEGER REFERENCES tasks(id) ON DELETE RESTRICT,
  owner_resolution TEXT NOT NULL DEFAULT 'review_required',
  stopped_intent_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cro07_event_taxonomy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL,
  canonical_event TEXT NOT NULL,
  subject TEXT NOT NULL,
  required_identity JSONB NOT NULL DEFAULT '[]'::jsonb,
  producer_authority TEXT NOT NULL,
  occurrence_rule TEXT NOT NULL DEFAULT 'at_most_once',
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  deprecated BOOLEAN NOT NULL DEFAULT false,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS cro07_taxonomy_canonical_version_uidx
  ON cro07_event_taxonomy (canonical_event, version);

CREATE TABLE IF NOT EXISTS cro07_attribution_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edge_type TEXT NOT NULL,
  from_type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  revenue_status TEXT NOT NULL DEFAULT 'unknown',
  revenue_amount_cents BIGINT,
  is_synthetic BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS cro07_attribution_edge_uidx
  ON cro07_attribution_edges (edge_type, from_type, from_id, to_type, to_id);
CREATE INDEX IF NOT EXISTS cro07_attribution_from_idx ON cro07_attribution_edges (from_type, from_id);
CREATE INDEX IF NOT EXISTS cro07_attribution_to_idx ON cro07_attribution_edges (to_type, to_id);

-- revenue_status must never claim confirmed revenue without an amount, and
-- synthetic fixtures must be flagged so production reports can exclude them.
ALTER TABLE cro07_attribution_edges
  ADD CONSTRAINT cro07_attribution_revenue_status_chk
  CHECK (
    (revenue_status = 'unknown' AND revenue_amount_cents IS NULL)
    OR (revenue_status IN ('synthetic_fixture','processor_confirmed') AND revenue_amount_cents IS NOT NULL)
  );

CREATE TABLE IF NOT EXISTS cro07_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  hypothesis TEXT NOT NULL,
  metric TEXT NOT NULL,
  population_definition JSONB NOT NULL,
  allocation JSONB NOT NULL,
  versions JSONB NOT NULL,
  min_sample_size INTEGER NOT NULL,
  min_duration_days INTEGER NOT NULL,
  confidence_rule JSONB NOT NULL,
  guardrails JSONB NOT NULL,
  contamination_exclusions JSONB NOT NULL DEFAULT '[]'::jsonb,
  state TEXT NOT NULL DEFAULT 'frozen_design',
  frozen_by TEXT NOT NULL,
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  decision TEXT,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  new_version_handoff_key TEXT,
  design_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cro07_experiment_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES cro07_experiments(id) ON DELETE RESTRICT,
  arm TEXT NOT NULL,
  exposure_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  guardrail_breach_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS cro07_experiment_sample_arm_uidx
  ON cro07_experiment_samples (experiment_id, arm);
