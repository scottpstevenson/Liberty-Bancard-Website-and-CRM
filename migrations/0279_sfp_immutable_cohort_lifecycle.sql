-- 0279: SFP immutable cohort lifecycle, terminal decision ledger, canary
-- designation, and database-enforced freeze immutability.
--
-- Separates the cohort's own freeze/void/supersede lifecycle from the
-- downstream stage-progress status (sfp_stage_runs.state). Downstream
-- consumers must key off cohort_state, never status, going forward.
-- status is preserved for backward compatibility with existing UI/report
-- reads but is no longer authoritative for admission decisions.

ALTER TABLE sfp_cohort_runs
  ADD COLUMN IF NOT EXISTS cohort_state TEXT NOT NULL DEFAULT 'freezing',
  ADD COLUMN IF NOT EXISTS request_hash TEXT,
  ADD COLUMN IF NOT EXISTS config_hash TEXT,
  ADD COLUMN IF NOT EXISTS request_payload JSONB,
  ADD COLUMN IF NOT EXISTS policy_versions JSONB,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by TEXT,
  ADD COLUMN IF NOT EXISTS void_reason TEXT,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by_run_id UUID REFERENCES sfp_cohort_runs(id),
  ADD COLUMN IF NOT EXISTS superseded_by_actor TEXT;

-- Backfill cohort_state from the legacy status column for existing rows.
UPDATE sfp_cohort_runs SET cohort_state = CASE
  WHEN status = 'frozen' THEN 'frozen'
  WHEN status = 'error' THEN 'failed'
  ELSE 'freezing'
END WHERE cohort_state = 'freezing';

ALTER TABLE sfp_cohort_runs
  DROP CONSTRAINT IF EXISTS sfp_cohort_runs_cohort_state_check;

ALTER TABLE sfp_cohort_runs
  ADD CONSTRAINT sfp_cohort_runs_cohort_state_check
  CHECK (cohort_state IN ('freezing','frozen','failed','voided','superseded'));

CREATE INDEX IF NOT EXISTS idx_sfp_cohort_runs_cohort_state
  ON sfp_cohort_runs (cohort_state, created_at DESC);

-- Selection rank + canary designation on cohort members. Canary is a
-- distinct, hard-capped-at-25 subset of the ranked membership, independent
-- of the program's 1-100 cohort cap.
ALTER TABLE sfp_cohort_members
  ADD COLUMN IF NOT EXISTS selection_rank INTEGER,
  ADD COLUMN IF NOT EXISTS is_canary BOOLEAN NOT NULL DEFAULT FALSE;

-- Terminal decision ledger: exactly one row per (cohort_run_id, business_id)
-- scanned during a freeze attempt, covering the full ordered disposition
-- taxonomy so sum(all terminal dispositions) = total scanned canonical
-- businesses on every run.
CREATE TABLE IF NOT EXISTS sfp_cohort_decisions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_run_id         UUID NOT NULL REFERENCES sfp_cohort_runs(id) ON DELETE CASCADE,
  business_id           INTEGER NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  disposition           TEXT NOT NULL,
  disposition_detail    TEXT,
  suppression_scope     TEXT,        -- 'business' | 'subject' | NULL
  suppression_subject_hash TEXT,     -- hash of the specific suppressed contact/email, when scope='subject'
  geography_class       TEXT,
  geography_source      TEXT,
  vertical              TEXT,
  roi_score             INTEGER,
  selected              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cohort_run_id, business_id)
);

CREATE INDEX IF NOT EXISTS idx_sfp_cohort_decisions_run_disposition
  ON sfp_cohort_decisions (cohort_run_id, disposition);

-- ── Database-enforced immutability for frozen runs ──────────────────────────
--
-- Once a cohort run's cohort_state = 'frozen', its member rows, decision
-- ledger rows, and the run's own identity/manifest columns must never be
-- rewritten or deleted. Voiding/superseding appends new lifecycle evidence
-- (voided_at/superseded_at/superseded_by_run_id) on the run row only; it
-- never touches member/decision rows or the frozen manifest fields.

CREATE OR REPLACE FUNCTION sfp_reject_frozen_member_mutation() RETURNS TRIGGER AS $$
DECLARE
  run_state TEXT;
BEGIN
  SELECT cohort_state INTO run_state FROM sfp_cohort_runs
    WHERE id = COALESCE(OLD.cohort_run_id, NEW.cohort_run_id);
  IF run_state = 'frozen' THEN
    RAISE EXCEPTION 'SFP_FROZEN_IMMUTABLE: cannot % row in % for a frozen cohort run', TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'raise_exception';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sfp_cohort_members_immutable ON sfp_cohort_members;
CREATE TRIGGER trg_sfp_cohort_members_immutable
  BEFORE UPDATE OR DELETE ON sfp_cohort_members
  FOR EACH ROW EXECUTE FUNCTION sfp_reject_frozen_member_mutation();

DROP TRIGGER IF EXISTS trg_sfp_cohort_decisions_immutable ON sfp_cohort_decisions;
CREATE TRIGGER trg_sfp_cohort_decisions_immutable
  BEFORE UPDATE OR DELETE ON sfp_cohort_decisions
  FOR EACH ROW EXECUTE FUNCTION sfp_reject_frozen_member_mutation();

-- The run row itself: once frozen, the identity/manifest columns are
-- immutable. Only the append-only lifecycle transition to voided/superseded
-- (and the accompanying voided_*/superseded_* columns) is permitted.
CREATE OR REPLACE FUNCTION sfp_reject_frozen_run_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.cohort_state = 'frozen' THEN
    IF NEW.cohort_hash IS DISTINCT FROM OLD.cohort_hash
       OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
       OR NEW.config_hash IS DISTINCT FROM OLD.config_hash
       OR NEW.policy_versions IS DISTINCT FROM OLD.policy_versions
       OR NEW.cohort_size IS DISTINCT FROM OLD.cohort_size
       OR NEW.frozen_at IS DISTINCT FROM OLD.frozen_at
       OR NEW.program_id IS DISTINCT FROM OLD.program_id
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
      RAISE EXCEPTION 'SFP_FROZEN_IMMUTABLE: cannot mutate frozen cohort run manifest fields'
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NEW.cohort_state NOT IN ('frozen','voided','superseded') THEN
      RAISE EXCEPTION 'SFP_FROZEN_IMMUTABLE: a frozen cohort_state may only transition to voided or superseded'
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sfp_cohort_runs_immutable ON sfp_cohort_runs;
CREATE TRIGGER trg_sfp_cohort_runs_immutable
  BEFORE UPDATE ON sfp_cohort_runs
  FOR EACH ROW EXECUTE FUNCTION sfp_reject_frozen_run_mutation();

-- ── SFP-owned config audit receipt (legacy-key one-time initializer) ───────
CREATE TABLE IF NOT EXISTS sfp_config_init_receipts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id        UUID NOT NULL REFERENCES sfp_programs(id),
  source            TEXT NOT NULL,
  source_hash       TEXT NOT NULL,
  resulting_config  JSONB NOT NULL,
  actor_id          TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
