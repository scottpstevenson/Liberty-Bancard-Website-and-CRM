-- Migration 0255: MI-06 Winner-Only Email Discovery & Validation.
--
-- Step 2: Add business_id and candidate_metadata to cro03c_candidate_evidence.
-- Step 2: Add email discovery columns to businesses.
-- Step 2: Create cro03c_email_winner_selections (immutable winner record).
-- Step 2: Create business_validation_intents.
-- Step 2: Create cro03c_business_validation_authorizations.
--
-- Kill lines enforced by schema:
--  - No ON DELETE CASCADE on winner_selections or intents FKs.
--  - No raw email stored: businesses.mainEmail only written after provider_valid.
--  - No cro03_provider_ledger dependency.

-- ── Extend cro03c_candidate_evidence ─────────────────────────────────────────

ALTER TABLE cro03c_candidate_evidence
  ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES businesses(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS candidate_metadata JSONB;

-- ── Add email discovery columns to businesses ─────────────────────────────────
-- Note: validated email value is NOT stored as plaintext until provider_valid.
-- businesses.mainEmail is only written after a provider_valid ZeroBounce result.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS email_discovery_status TEXT
    CHECK (email_discovery_status IN (
      'disposable',
      'absent','discovered','syntax_invalid','placeholder','no_mx','dns_indeterminate',
      'no_valid_candidate','provider_valid','provider_invalid','provider_catch_all',
      'provider_unknown','provider_spamtrap','stale','bounced','suppressed'
    )),
  ADD COLUMN IF NOT EXISTS email_validation_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_selected_candidate_hash TEXT,
  ADD COLUMN IF NOT EXISTS email_outreach_catch_all_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_outreach_approved_by TEXT,
  -- MI-06: approved_candidate_hash binds catch-all approval to the specific winning candidate.
  -- Must equal email_selected_candidate_hash at approval time and remain equal for
  -- outreach eligibility. Cleared when selectEmailWinner() sets a new candidate hash.
  ADD COLUMN IF NOT EXISTS email_outreach_approved_candidate_hash TEXT;

-- free_enrichment_* columns are already in DB via migration 0250.
-- No DDL needed; Drizzle schema is updated separately (Step 2 schema-only addition).

-- ── cro03c_email_winner_selections ────────────────────────────────────────────
-- Immutable: one row per (business_id, generation_id).
-- Superseded by a newer generation's selection — state updated to 'superseded'.
-- Never deleted; audit history preserved via ON DELETE RESTRICT on all FKs.

CREATE TABLE IF NOT EXISTS cro03c_email_winner_selections (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           INTEGER     NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  generation_id         UUID        NOT NULL REFERENCES cro03c_generations(id) ON DELETE RESTRICT,
  candidate_evidence_id UUID        NOT NULL REFERENCES cro03c_candidate_evidence(id) ON DELETE RESTRICT,
  policy_version        INTEGER     NOT NULL DEFAULT 1,
  source                TEXT        NOT NULL,      -- stage_key of the winning candidate
  subject_type          TEXT        NOT NULL,      -- 'business' | 'person'
  confidence            INTEGER     NOT NULL,
  normalized_value_hash TEXT        NOT NULL,
  state                 TEXT        NOT NULL DEFAULT 'selected'
                                    CHECK (state IN ('selected','superseded','revoked')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active selection per (business_id, generation_id).
CREATE UNIQUE INDEX IF NOT EXISTS cro03c_email_winner_sel_business_gen_uniq
  ON cro03c_email_winner_selections (business_id, generation_id);

CREATE INDEX IF NOT EXISTS cro03c_email_winner_sel_business_idx
  ON cro03c_email_winner_selections (business_id);

-- ── business_validation_intents ───────────────────────────────────────────────
-- Tracks ZeroBounce validation requests for business email candidates.
-- approval_required=TRUE means medium-confidence: operator must approve before claim.

CREATE TABLE IF NOT EXISTS business_validation_intents (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id               INTEGER     NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  winner_selection_id       UUID        NOT NULL REFERENCES cro03c_email_winner_selections(id) ON DELETE RESTRICT,
  candidate_evidence_id     UUID        NOT NULL REFERENCES cro03c_candidate_evidence(id) ON DELETE RESTRICT,
  normalized_email_token_hash TEXT      NOT NULL,
  purpose                   TEXT        NOT NULL DEFAULT 'cro03c_business_email'
                                        CHECK (purpose IN ('cro03c_business_email')),
  state                     TEXT        NOT NULL DEFAULT 'pending'
                                        CHECK (state IN ('pending','claimed','completed','failed','superseded','revoked')),
  -- approval_required=TRUE: medium-confidence intent; operator must approve before claim.
  approval_required         BOOLEAN     NOT NULL DEFAULT FALSE,
  -- disposition populated on completion, maps to email_discovery_status enum.
  disposition               TEXT,
  apollo_match_confidence   TEXT        CHECK (apollo_match_confidence IN ('high','medium','low','none')),
  claim_token               UUID,
  lease_expires_at          TIMESTAMPTZ,
  attempt_count             INTEGER     NOT NULL DEFAULT 0,
  next_attempt_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  terminal_code             TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at              TIMESTAMPTZ
);

-- Idempotency: one active intent per (business_id, email_hash, purpose).
-- Excludes all terminal states so the same email hash can be re-selected
-- and re-validated in a new generation (e.g. stale revalidation after 90 days).
CREATE UNIQUE INDEX IF NOT EXISTS business_validation_intents_idempotency_uniq
  ON business_validation_intents (business_id, normalized_email_token_hash, purpose)
  WHERE state NOT IN ('superseded','revoked','completed','failed');

CREATE INDEX IF NOT EXISTS business_validation_intents_business_idx
  ON business_validation_intents (business_id);

CREATE INDEX IF NOT EXISTS business_validation_intents_state_idx
  ON business_validation_intents (state)
  WHERE state = 'pending';

-- ── cro03c_business_validation_authorizations ─────────────────────────────────
-- Idempotency/audit for the business validation authorization path.
-- Parallel to cro03c_validation_authorizations (contact path).

CREATE TABLE IF NOT EXISTS cro03c_business_validation_authorizations (
  id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_validation_intent_id   UUID        NOT NULL REFERENCES business_validation_intents(id) ON DELETE RESTRICT,
  -- Full FK chain mirrors cro03c_validation_authorizations (contact path).
  command_id                      UUID        NOT NULL REFERENCES cro03c_commands(id) ON DELETE RESTRICT,
  run_id                          UUID        NOT NULL REFERENCES cro03c_runs(id) ON DELETE RESTRICT,
  generation_id                   UUID        NOT NULL REFERENCES cro03c_generations(id) ON DELETE RESTRICT,
  winner_selection_id             UUID        NOT NULL REFERENCES cro03c_email_winner_selections(id) ON DELETE RESTRICT,
  activation_revision             INTEGER     NOT NULL,
  business_id                     INTEGER     NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  normalized_email_hash           TEXT        NOT NULL,
  runtime_attestation_id          UUID        NOT NULL REFERENCES cro03c_runtime_attestations(id) ON DELETE RESTRICT,
  expected_provider_control_revision INTEGER  NOT NULL,
  unit_cap                        INTEGER     NOT NULL,
  cost_cap_micros                 BIGINT      NOT NULL,
  authorized_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency: one authorization per full binding of all authority dimensions.
CREATE UNIQUE INDEX IF NOT EXISTS cro03c_biz_val_auth_idempotency_uniq
  ON cro03c_business_validation_authorizations
    (business_validation_intent_id, command_id, run_id, generation_id, activation_revision,
     business_id, normalized_email_hash, runtime_attestation_id,
     expected_provider_control_revision, unit_cap, cost_cap_micros);

-- Append-only guard: business validation authorizations are evidence records.
-- Parallel to cro03c_validation_authorization_immutable on the contact path.
DROP TRIGGER IF EXISTS cro03c_biz_val_auth_immutable ON cro03c_business_validation_authorizations;
CREATE TRIGGER cro03c_biz_val_auth_immutable
  BEFORE UPDATE OR DELETE ON cro03c_business_validation_authorizations
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();

-- For existing dev installations that had the table without FKs, add them now.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_name = 'cro03c_biz_val_auth_cmd_fk'
                    AND table_name = 'cro03c_business_validation_authorizations') THEN
    ALTER TABLE cro03c_business_validation_authorizations
      ADD CONSTRAINT cro03c_biz_val_auth_cmd_fk FOREIGN KEY (command_id) REFERENCES cro03c_commands(id) ON DELETE RESTRICT,
      ADD CONSTRAINT cro03c_biz_val_auth_run_fk FOREIGN KEY (run_id) REFERENCES cro03c_runs(id) ON DELETE RESTRICT,
      ADD CONSTRAINT cro03c_biz_val_auth_gen_fk FOREIGN KEY (generation_id) REFERENCES cro03c_generations(id) ON DELETE RESTRICT,
      ADD CONSTRAINT cro03c_biz_val_auth_ws_fk FOREIGN KEY (winner_selection_id) REFERENCES cro03c_email_winner_selections(id) ON DELETE RESTRICT,
      ADD CONSTRAINT cro03c_biz_val_auth_biz_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE RESTRICT,
      ADD CONSTRAINT cro03c_biz_val_auth_rat_fk FOREIGN KEY (runtime_attestation_id) REFERENCES cro03c_runtime_attestations(id) ON DELETE RESTRICT;
  END IF;
END $$;
