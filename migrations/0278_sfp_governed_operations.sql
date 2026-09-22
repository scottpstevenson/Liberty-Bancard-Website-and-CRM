-- 0278: Complete the South Florida Prospecting execution boundary.
--
-- Adds durable, independently-authorized SFP stage runs/items, campaign
-- staging intents, and the missing row-level evidence/decision fields.  These
-- tables do not authorize provider I/O by themselves; provider_controls,
-- provider_operations, the typed aggregate-budget authorization, and the
-- provider manifest remain authoritative.

ALTER TABLE sfp_programs
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_by TEXT,
  ADD COLUMN IF NOT EXISTS recurring_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS schedule_config JSONB NOT NULL DEFAULT '{"freeBatch":25,"paidBatch":10,"validationBatch":25}'::jsonb;

CREATE TABLE IF NOT EXISTS sfp_stage_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_run_id UUID NOT NULL REFERENCES sfp_cohort_runs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('free_discovery','paid_waterfall','validation','campaign_staging','readiness_refresh')),
  idempotency_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','authorized','running','completed','partial','failed','cancelled','stalled')),
  max_items INTEGER NOT NULL CHECK (max_items BETWEEN 1 AND 500),
  provider_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  estimated_cost_micros BIGINT NOT NULL DEFAULT 0 CHECK (estimated_cost_micros >= 0),
  reserved_cost_micros BIGINT NOT NULL DEFAULT 0 CHECK (reserved_cost_micros >= 0),
  settled_cost_micros BIGINT NOT NULL DEFAULT 0 CHECK (settled_cost_micros >= 0),
  selected_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  succeeded_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  terminal_reason TEXT,
  authorization JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stage, idempotency_key)
);

CREATE INDEX IF NOT EXISTS sfp_stage_runs_cohort_stage_idx
  ON sfp_stage_runs (cohort_run_id, stage, created_at DESC);
CREATE INDEX IF NOT EXISTS sfp_stage_runs_claim_idx
  ON sfp_stage_runs (state, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS sfp_stage_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_run_id UUID NOT NULL REFERENCES sfp_stage_runs(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  provider TEXT,
  candidate_id UUID REFERENCES free_discovery_candidates(id) ON DELETE SET NULL,
  provider_operation_id UUID REFERENCES provider_operations(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','claimed','completed','no_result','skipped','retry','failed','review_required','dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  outcome_code TEXT,
  redacted_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stage_run_id, business_id, provider)
);

CREATE INDEX IF NOT EXISTS sfp_stage_items_claim_idx
  ON sfp_stage_items (stage_run_id, state, next_attempt_at, lease_expires_at);
CREATE INDEX IF NOT EXISTS sfp_stage_items_business_idx
  ON sfp_stage_items (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sfp_campaign_staging_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_run_id UUID NOT NULL REFERENCES sfp_cohort_runs(id) ON DELETE RESTRICT,
  eligibility_id UUID NOT NULL REFERENCES sfp_outreach_eligibility(id) ON DELETE RESTRICT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  candidate_id UUID NOT NULL REFERENCES free_discovery_candidates(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'staged'
    CHECK (state IN ('staged','promoted','rejected','cancelled')),
  policy_version INTEGER NOT NULL,
  validation_snapshot JSONB NOT NULL,
  lineage JSONB NOT NULL,
  master_lead_id UUID REFERENCES master_leads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cohort_run_id, business_id, candidate_id),
  UNIQUE (idempotency_key, business_id)
);

CREATE INDEX IF NOT EXISTS sfp_campaign_staging_intents_state_idx
  ON sfp_campaign_staging_intents (state, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS master_leads_sfp_business_email_uidx
  ON master_leads (canonical_business_id, email_token_hash)
  WHERE pipeline_origin = 'sfp_pipeline' AND canonical_business_id IS NOT NULL AND email_token_hash IS NOT NULL;

ALTER TABLE sfp_outreach_eligibility
  ADD COLUMN IF NOT EXISTS evidence_confidence INTEGER,
  ADD COLUMN IF NOT EXISTS suppression_status TEXT NOT NULL DEFAULT 'unchecked',
  ADD COLUMN IF NOT EXISTS outreach_policy_version INTEGER,
  ADD COLUMN IF NOT EXISTS outreach_policy_reason TEXT,
  ADD COLUMN IF NOT EXISTS validation_operation_id UUID REFERENCES provider_operations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS staging_intent_id UUID REFERENCES sfp_campaign_staging_intents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sfp_outreach_candidate_idx
  ON sfp_outreach_eligibility (candidate_id);
