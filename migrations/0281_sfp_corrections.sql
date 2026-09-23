-- 0281: South Florida Prospecting corrections (reopened Task #1998 completion)
--
-- 1. Persist the real classifier (server/services/cro03/sfp-vertical-classifier.ts)
--    and geography resolver (server/services/cro03/sfp-geography-resolver.ts)
--    outputs on every terminal decision and cohort member row, so the
--    version, outcome, confidence, and winning-location evidence used to
--    admit or exclude each business is durably auditable — not just
--    recomputable from current code.
-- 2. Extend frozen-history immutability to cover voided/superseded cohort
--    runs, not just 'frozen' — a run that has ever been frozen must never
--    have its member/decision rows mutated again, regardless of later
--    lifecycle transitions.
-- 3. Replace ON DELETE CASCADE with ON DELETE RESTRICT on the FKs from
--    sfp_cohort_members / sfp_funnel_snapshots / sfp_cohort_decisions to
--    sfp_cohort_runs, so deleting a cohort run row can never silently take
--    its historical evidence with it.

-- ── Classifier + geography resolver persistence ─────────────────────────────

ALTER TABLE sfp_cohort_members
  ADD COLUMN IF NOT EXISTS classifier_version INTEGER,
  ADD COLUMN IF NOT EXISTS classifier_outcome TEXT,
  ADD COLUMN IF NOT EXISTS classifier_confidence NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS classifier_matched_target TEXT,
  ADD COLUMN IF NOT EXISTS classifier_reasons JSONB,
  ADD COLUMN IF NOT EXISTS classifier_evidence_hash TEXT,
  ADD COLUMN IF NOT EXISTS geography_resolver_version INTEGER,
  ADD COLUMN IF NOT EXISTS geography_outcome TEXT,
  ADD COLUMN IF NOT EXISTS geography_location_id INTEGER,
  ADD COLUMN IF NOT EXISTS geography_reasons JSONB;

ALTER TABLE sfp_cohort_decisions
  ADD COLUMN IF NOT EXISTS classifier_version INTEGER,
  ADD COLUMN IF NOT EXISTS classifier_outcome TEXT,
  ADD COLUMN IF NOT EXISTS classifier_confidence NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS classifier_matched_target TEXT,
  ADD COLUMN IF NOT EXISTS classifier_reasons JSONB,
  ADD COLUMN IF NOT EXISTS classifier_evidence_hash TEXT,
  ADD COLUMN IF NOT EXISTS geography_resolver_version INTEGER,
  ADD COLUMN IF NOT EXISTS geography_outcome TEXT,
  ADD COLUMN IF NOT EXISTS geography_location_id INTEGER,
  ADD COLUMN IF NOT EXISTS geography_reasons JSONB;

-- ── Foreign-key retention: RESTRICT instead of CASCADE ──────────────────────
-- Idempotent (DROP IF EXISTS before ADD) so re-running this migration, or
-- running it after a partial prior apply, never errors.

ALTER TABLE sfp_cohort_members
  DROP CONSTRAINT IF EXISTS sfp_cohort_members_cohort_run_id_fkey;
ALTER TABLE sfp_cohort_members
  ADD CONSTRAINT sfp_cohort_members_cohort_run_id_fkey
  FOREIGN KEY (cohort_run_id) REFERENCES sfp_cohort_runs(id) ON DELETE RESTRICT;

ALTER TABLE sfp_funnel_snapshots
  DROP CONSTRAINT IF EXISTS sfp_funnel_snapshots_cohort_run_id_fkey;
ALTER TABLE sfp_funnel_snapshots
  ADD CONSTRAINT sfp_funnel_snapshots_cohort_run_id_fkey
  FOREIGN KEY (cohort_run_id) REFERENCES sfp_cohort_runs(id) ON DELETE RESTRICT;

ALTER TABLE sfp_cohort_decisions
  DROP CONSTRAINT IF EXISTS sfp_cohort_decisions_cohort_run_id_fkey;
ALTER TABLE sfp_cohort_decisions
  ADD CONSTRAINT sfp_cohort_decisions_cohort_run_id_fkey
  FOREIGN KEY (cohort_run_id) REFERENCES sfp_cohort_runs(id) ON DELETE RESTRICT;

-- ── Immutability triggers: cover voided/superseded, not just frozen ────────
-- A run that has EVER been frozen carries permanent history; voiding or
-- superseding it is an append-only lifecycle event on the run row alone and
-- must never reopen its member/decision rows to mutation.

CREATE OR REPLACE FUNCTION sfp_reject_frozen_member_mutation() RETURNS TRIGGER AS $$
DECLARE
  run_state TEXT;
BEGIN
  SELECT cohort_state INTO run_state FROM sfp_cohort_runs
    WHERE id = COALESCE(OLD.cohort_run_id, NEW.cohort_run_id);
  IF run_state IN ('frozen', 'voided', 'superseded') THEN
    RAISE EXCEPTION 'SFP_FROZEN_IMMUTABLE: cannot % row in % for a run that is frozen/voided/superseded', TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'raise_exception';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers already reference this function by name (0279); CREATE OR REPLACE
-- above updates their behavior in place, no DROP/CREATE TRIGGER needed.

CREATE OR REPLACE FUNCTION sfp_reject_frozen_run_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.cohort_state IN ('frozen', 'voided', 'superseded') THEN
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
    IF OLD.cohort_state = 'frozen' AND NEW.cohort_state NOT IN ('frozen','voided','superseded') THEN
      RAISE EXCEPTION 'SFP_FROZEN_IMMUTABLE: a frozen cohort_state may only transition to voided or superseded'
        USING ERRCODE = 'raise_exception';
    END IF;
    IF OLD.cohort_state IN ('voided','superseded') AND NEW.cohort_state IS DISTINCT FROM OLD.cohort_state THEN
      RAISE EXCEPTION 'SFP_FROZEN_IMMUTABLE: a voided/superseded cohort_state is terminal and cannot transition further'
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
