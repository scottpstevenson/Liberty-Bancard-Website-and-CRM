-- 0277: South Florida Prospecting program tables
-- Independent of MI-09 pilot runs; works when master_leads = 0.

-- Program definition (idempotent convergence target)
CREATE TABLE IF NOT EXISTS sfp_programs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,                       -- e.g. 'south-florida-v1'
  county_fips     TEXT[] NOT NULL,                     -- ['12011','12086','12099']
  vertical_ids    TEXT[] NOT NULL,                     -- five configured verticals
  max_cohort_size INTEGER NOT NULL DEFAULT 100,
  policy_version  INTEGER NOT NULL DEFAULT 1,
  is_active       BOOLEAN NOT NULL DEFAULT false,       -- operator must explicitly activate
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      TEXT NOT NULL,
  UNIQUE (name)
);

-- Cohort runs (one per operator-initiated freeze)
CREATE TABLE IF NOT EXISTS sfp_cohort_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id          UUID NOT NULL REFERENCES sfp_programs(id),
  idempotency_key     TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','freezing','frozen','enriching','validating','staged','error')),
  cohort_size         INTEGER NOT NULL DEFAULT 0,
  cohort_hash         TEXT,
  frozen_at           TIMESTAMPTZ,
  release_sha         TEXT NOT NULL DEFAULT '',
  actor_id            TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  error_detail        TEXT,
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_sfp_cohort_runs_program
  ON sfp_cohort_runs (program_id, created_at DESC);

-- Cohort members (businesses selected for a run)
CREATE TABLE IF NOT EXISTS sfp_cohort_members (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_run_id         UUID NOT NULL REFERENCES sfp_cohort_runs(id) ON DELETE CASCADE,
  business_id           INTEGER NOT NULL,
  roi_score             INTEGER NOT NULL DEFAULT 0,
  geography_class       TEXT NOT NULL DEFAULT 'unknown',   -- verified|zip_inferred|city_inferred|unknown
  geography_source      TEXT NOT NULL DEFAULT 'none',      -- county_fips|zip|city|none
  county_fips           TEXT,
  vertical              TEXT,
  exclusion_reason      TEXT,                              -- null = selected
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cohort_run_id, business_id)
);

CREATE INDEX IF NOT EXISTS idx_sfp_cohort_members_run
  ON sfp_cohort_members (cohort_run_id, roi_score DESC);

-- Funnel snapshots (truthful per-run funnel)
CREATE TABLE IF NOT EXISTS sfp_funnel_snapshots (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_run_id           UUID NOT NULL REFERENCES sfp_cohort_runs(id) ON DELETE CASCADE,
  captured_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_businesses        INTEGER NOT NULL DEFAULT 0,
  south_florida           INTEGER NOT NULL DEFAULT 0,
  outside_geography       INTEGER NOT NULL DEFAULT 0,
  geography_unresolved    INTEGER NOT NULL DEFAULT 0,
  in_target_vertical      INTEGER NOT NULL DEFAULT 0,
  vertical_unresolved     INTEGER NOT NULL DEFAULT 0,
  dbpr_excluded           INTEGER NOT NULL DEFAULT 0,
  suppressed              INTEGER NOT NULL DEFAULT 0,
  bounced_invalid_only    INTEGER NOT NULL DEFAULT 0,
  existing_customer       INTEGER NOT NULL DEFAULT 0,
  test_demo_internal      INTEGER NOT NULL DEFAULT 0,
  inactive_entity         INTEGER NOT NULL DEFAULT 0,
  duplicate_conflict      INTEGER NOT NULL DEFAULT 0,
  already_enriched        INTEGER NOT NULL DEFAULT 0,
  requires_free_discovery INTEGER NOT NULL DEFAULT 0,
  requires_paid_discovery INTEGER NOT NULL DEFAULT 0,
  ready_for_validation    INTEGER NOT NULL DEFAULT 0,
  provider_valid          INTEGER NOT NULL DEFAULT 0,
  outreach_eligible       INTEGER NOT NULL DEFAULT 0,
  review_required         INTEGER NOT NULL DEFAULT 0,
  selected_frozen         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (cohort_run_id)
);

-- Outreach eligibility decisions (versioned, per-candidate)
CREATE TABLE IF NOT EXISTS sfp_outreach_eligibility (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_run_id       UUID NOT NULL REFERENCES sfp_cohort_runs(id),
  business_id         INTEGER NOT NULL,
  candidate_id        UUID,                            -- free_discovery_candidates.id
  policy_version      INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL                    -- see OutreachEligibilityStatus enum
                      CHECK (status IN (
                        'validated_outreach_eligible',
                        'validated_review_required',
                        'validated_suppressed',
                        'validated_existing_relationship',
                        'validated_policy_ineligible',
                        'validation_pending',
                        'catch_all_review',
                        'invalid',
                        'discovery_required'
                      )),
  decision_reason     TEXT NOT NULL DEFAULT '',
  zb_outcome          TEXT,
  validation_at       TIMESTAMPTZ,
  validation_age_days INTEGER,
  named_contact       BOOLEAN NOT NULL DEFAULT false,
  role_inbox          BOOLEAN NOT NULL DEFAULT false,
  masked_email        TEXT,
  discovery_source    TEXT,
  campaign_staged_at  TIMESTAMPTZ,
  campaign_staged_by  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cohort_run_id, business_id, policy_version)
);

CREATE INDEX IF NOT EXISTS idx_sfp_outreach_eligibility_run
  ON sfp_outreach_eligibility (cohort_run_id, status);

CREATE INDEX IF NOT EXISTS idx_sfp_outreach_eligibility_status
  ON sfp_outreach_eligibility (status, created_at DESC);
