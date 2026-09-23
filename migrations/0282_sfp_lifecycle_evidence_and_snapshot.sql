-- 0282: SFP reopened-Task-#1998 final correction pass.
--
-- Correction 4 — make void/supersede lifecycle evidence append-only and
--   reject direct deletion of frozen/voided/superseded run history at the
--   database boundary.
-- Correction 7 — persist an explicit frozen source-snapshot / high-water
--   identity, captured inside the authoritative freeze transaction and
--   separate from the logical request hash used for idempotent replay.

-- ── Correction 7: source snapshot columns ───────────────────────────────────
-- Deliberately NOT part of request_hash (which drives idempotent replay
-- matching) — the source snapshot changes on every insert to `businesses`,
-- but the same logical freeze request must still replay identically.

ALTER TABLE sfp_cohort_runs
  ADD COLUMN IF NOT EXISTS source_snapshot_hash TEXT,
  ADD COLUMN IF NOT EXISTS source_high_water_business_id INTEGER,
  ADD COLUMN IF NOT EXISTS source_business_count INTEGER,
  ADD COLUMN IF NOT EXISTS source_txid BIGINT,
  ADD COLUMN IF NOT EXISTS source_snapshot_captured_at TIMESTAMPTZ;

-- ── Correction 4: void/supersede evidence is append-only ────────────────────
-- Extends sfp_reject_frozen_run_mutation() (0279/0281) with two additional,
-- narrowly-scoped guards that the prior versions did not have:
--   1. Once voided_at/superseded_at is non-null, none of the corresponding
--      evidence columns may ever change again — independent of whether
--      cohort_state itself changes on the same UPDATE.
--   2. The one legitimate frozen->voided / frozen->superseded transition
--      must atomically carry its full evidence triple; a transition that
--      leaves any required evidence column null is rejected outright.
-- The existing frozen-manifest-field guard and terminal-state guard from
-- 0281 are preserved unchanged below.

CREATE OR REPLACE FUNCTION sfp_reject_frozen_run_mutation() RETURNS TRIGGER AS $$
BEGIN
  -- Void evidence, once set, is immutable regardless of any other field
  -- changing on the same UPDATE.
  IF OLD.voided_at IS NOT NULL AND (
       NEW.voided_at IS DISTINCT FROM OLD.voided_at
    OR NEW.voided_by IS DISTINCT FROM OLD.voided_by
    OR NEW.void_reason IS DISTINCT FROM OLD.void_reason
  ) THEN
    RAISE EXCEPTION 'SFP_FROZEN_IMMUTABLE: void evidence is append-only and cannot be changed once set'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- Supersede evidence, once set, is immutable regardless of any other
  -- field changing on the same UPDATE.
  IF OLD.superseded_at IS NOT NULL AND (
       NEW.superseded_at IS DISTINCT FROM OLD.superseded_at
    OR NEW.superseded_by_run_id IS DISTINCT FROM OLD.superseded_by_run_id
    OR NEW.superseded_by_actor IS DISTINCT FROM OLD.superseded_by_actor
  ) THEN
    RAISE EXCEPTION 'SFP_FROZEN_IMMUTABLE: supersede evidence is append-only and cannot be changed once set'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- The frozen -> voided transition must atomically carry its full
  -- evidence triple; a partial transition (e.g. cohort_state flipped to
  -- 'voided' with void_reason left null) is rejected outright.
  IF OLD.cohort_state = 'frozen' AND NEW.cohort_state = 'voided' THEN
    IF NEW.voided_at IS NULL OR NEW.voided_by IS NULL OR NEW.void_reason IS NULL THEN
      RAISE EXCEPTION 'SFP_VOID_EVIDENCE_INCOMPLETE: voiding a cohort run must atomically set voided_at, voided_by, and void_reason'
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;

  -- Same atomicity requirement for the frozen -> superseded transition.
  IF OLD.cohort_state = 'frozen' AND NEW.cohort_state = 'superseded' THEN
    IF NEW.superseded_at IS NULL OR NEW.superseded_by_run_id IS NULL OR NEW.superseded_by_actor IS NULL THEN
      RAISE EXCEPTION 'SFP_SUPERSEDE_EVIDENCE_INCOMPLETE: superseding a cohort run must atomically set superseded_at, superseded_by_run_id, and superseded_by_actor'
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;

  -- Preserved from 0281: frozen manifest identity fields are immutable in
  -- all three terminal states.
  IF OLD.cohort_state IN ('frozen', 'voided', 'superseded') THEN
    IF NEW.cohort_hash IS DISTINCT FROM OLD.cohort_hash
       OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
       OR NEW.config_hash IS DISTINCT FROM OLD.config_hash
       OR NEW.policy_versions IS DISTINCT FROM OLD.policy_versions
       OR NEW.cohort_size IS DISTINCT FROM OLD.cohort_size
       OR NEW.frozen_at IS DISTINCT FROM OLD.frozen_at
       OR NEW.program_id IS DISTINCT FROM OLD.program_id
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.source_snapshot_hash IS DISTINCT FROM OLD.source_snapshot_hash
       OR NEW.source_high_water_business_id IS DISTINCT FROM OLD.source_high_water_business_id
       OR NEW.source_business_count IS DISTINCT FROM OLD.source_business_count
       OR NEW.source_txid IS DISTINCT FROM OLD.source_txid
       OR NEW.source_snapshot_captured_at IS DISTINCT FROM OLD.source_snapshot_captured_at THEN
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

-- Trigger already references this function by name (0279/0281); CREATE OR
-- REPLACE above updates its behavior in place.

-- ── Correction 4: reject direct deletion of terminal run history ───────────
-- The child-row RESTRICT FKs (0281) only stop deletion incidentally, when
-- child rows exist. This trigger makes the guarantee explicit and
-- unconditional: a frozen/voided/superseded run row itself can never be
-- deleted, regardless of whether it happens to have members/decisions/a
-- snapshot at the time of the delete attempt.

CREATE OR REPLACE FUNCTION sfp_reject_terminal_run_deletion() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.cohort_state IN ('frozen', 'voided', 'superseded') THEN
    RAISE EXCEPTION 'SFP_FROZEN_IMMUTABLE: cannot delete a frozen/voided/superseded cohort run'
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sfp_cohort_runs_reject_terminal_deletion ON sfp_cohort_runs;
CREATE TRIGGER trg_sfp_cohort_runs_reject_terminal_deletion
  BEFORE DELETE ON sfp_cohort_runs
  FOR EACH ROW EXECUTE FUNCTION sfp_reject_terminal_run_deletion();
