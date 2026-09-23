-- 0283: SFP round-2 correction — close remaining immutability gaps.
--
-- Round-2 pre-publish audit finding: sfp_funnel_snapshots had NO
-- database-level immutability trigger at all (only sfp_cohort_members,
-- sfp_cohort_decisions, and sfp_cohort_runs did), and the run-row trigger
-- did not protect request_payload/release_sha/actor_id, so a frozen run's
-- funnel snapshot or these run fields could be silently rewritten by any
-- direct SQL without raising. Also extends the member/decision triggers to
-- fire on INSERT (not just UPDATE/DELETE), since a legitimate insert only
-- ever happens while the owning run is still 'freezing' — by the time a run
-- reaches 'frozen', no further member/decision/snapshot row for it should
-- ever be created.
--
-- south-florida-prospecting.ts's freezeCohortTx is reordered in the same
-- change to INSERT the funnel snapshot BEFORE flipping the run's
-- cohort_state to 'frozen' (previously it inserted the snapshot AFTER),
-- so this trigger's INSERT guard does not break that legitimate write path.

-- ── sfp_cohort_members / sfp_cohort_decisions: also guard INSERT ───────────

-- Task #1998 round-3 correction (item 2): the previous version of this
-- function used `COALESCE(NEW.cohort_run_id, OLD.cohort_run_id)` — on an
-- UPDATE that changes cohort_run_id, COALESCE always picks NEW first, so it
-- checked ONLY the new (destination) owner's lifecycle state. A row could be
-- moved OUT of a frozen/voided/superseded run (its OLD owner) as long as the
-- NEW owner happened to still be 'freezing' — the exact bypass this
-- correction closes. Both the OLD owner (is this row being moved OUT of a
-- terminal run?) and the NEW owner (is it being moved INTO one?) must be
-- independently checked on every UPDATE; INSERT only has NEW, DELETE only
-- has OLD.
CREATE OR REPLACE FUNCTION sfp_reject_frozen_member_mutation() RETURNS TRIGGER AS $$
DECLARE
  old_owner_state TEXT;
  new_owner_state TEXT;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT cohort_state INTO old_owner_state FROM sfp_cohort_runs WHERE id = OLD.cohort_run_id;
    IF old_owner_state IN ('frozen', 'voided', 'superseded') THEN
      RAISE EXCEPTION 'SFP_FROZEN_IMMUTABLE: cannot % row in % out of a run that is frozen/voided/superseded', TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT cohort_state INTO new_owner_state FROM sfp_cohort_runs WHERE id = NEW.cohort_run_id;
    IF new_owner_state IN ('frozen', 'voided', 'superseded') THEN
      RAISE EXCEPTION 'SFP_FROZEN_IMMUTABLE: cannot % row in % for a run that is frozen/voided/superseded', TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sfp_cohort_members_immutable ON sfp_cohort_members;
CREATE TRIGGER trg_sfp_cohort_members_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON sfp_cohort_members
  FOR EACH ROW EXECUTE FUNCTION sfp_reject_frozen_member_mutation();

DROP TRIGGER IF EXISTS trg_sfp_cohort_decisions_immutable ON sfp_cohort_decisions;
CREATE TRIGGER trg_sfp_cohort_decisions_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON sfp_cohort_decisions
  FOR EACH ROW EXECUTE FUNCTION sfp_reject_frozen_member_mutation();

-- ── sfp_funnel_snapshots: new immutability trigger (previously had none) ───
-- Same OLD/NEW independent-validation fix applies here (a snapshot row has
-- a unique cohort_run_id, so an UPDATE moving it between runs is not a
-- realistic write path today, but the guard must not depend on that).

CREATE OR REPLACE FUNCTION sfp_reject_frozen_snapshot_mutation() RETURNS TRIGGER AS $$
DECLARE
  old_owner_state TEXT;
  new_owner_state TEXT;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT cohort_state INTO old_owner_state FROM sfp_cohort_runs WHERE id = OLD.cohort_run_id;
    IF old_owner_state IN ('frozen', 'voided', 'superseded') THEN
      RAISE EXCEPTION 'SFP_FROZEN_IMMUTABLE: cannot % row in % out of a run that is frozen/voided/superseded', TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT cohort_state INTO new_owner_state FROM sfp_cohort_runs WHERE id = NEW.cohort_run_id;
    IF new_owner_state IN ('frozen', 'voided', 'superseded') THEN
      RAISE EXCEPTION 'SFP_FROZEN_IMMUTABLE: cannot % row in % for a run that is frozen/voided/superseded', TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sfp_funnel_snapshots_immutable ON sfp_funnel_snapshots;
CREATE TRIGGER trg_sfp_funnel_snapshots_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON sfp_funnel_snapshots
  FOR EACH ROW EXECUTE FUNCTION sfp_reject_frozen_snapshot_mutation();

-- ── sfp_cohort_runs: extend manifest guard to request_payload/release_sha/actor_id ──

CREATE OR REPLACE FUNCTION sfp_reject_frozen_run_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.voided_at IS NOT NULL AND (
       NEW.voided_at IS DISTINCT FROM OLD.voided_at
    OR NEW.voided_by IS DISTINCT FROM OLD.voided_by
    OR NEW.void_reason IS DISTINCT FROM OLD.void_reason
  ) THEN
    RAISE EXCEPTION 'SFP_FROZEN_IMMUTABLE: void evidence is append-only and cannot be changed once set'
      USING ERRCODE = 'raise_exception';
  END IF;

  IF OLD.superseded_at IS NOT NULL AND (
       NEW.superseded_at IS DISTINCT FROM OLD.superseded_at
    OR NEW.superseded_by_run_id IS DISTINCT FROM OLD.superseded_by_run_id
    OR NEW.superseded_by_actor IS DISTINCT FROM OLD.superseded_by_actor
  ) THEN
    RAISE EXCEPTION 'SFP_FROZEN_IMMUTABLE: supersede evidence is append-only and cannot be changed once set'
      USING ERRCODE = 'raise_exception';
  END IF;

  IF OLD.cohort_state = 'frozen' AND NEW.cohort_state = 'voided' THEN
    IF NEW.voided_at IS NULL OR NEW.voided_by IS NULL OR NEW.void_reason IS NULL THEN
      RAISE EXCEPTION 'SFP_VOID_EVIDENCE_INCOMPLETE: voiding a cohort run must atomically set voided_at, voided_by, and void_reason'
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;

  IF OLD.cohort_state = 'frozen' AND NEW.cohort_state = 'superseded' THEN
    IF NEW.superseded_at IS NULL OR NEW.superseded_by_run_id IS NULL OR NEW.superseded_by_actor IS NULL THEN
      RAISE EXCEPTION 'SFP_SUPERSEDE_EVIDENCE_INCOMPLETE: superseding a cohort run must atomically set superseded_at, superseded_by_run_id, and superseded_by_actor'
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;

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
       OR NEW.source_snapshot_captured_at IS DISTINCT FROM OLD.source_snapshot_captured_at
       OR NEW.request_payload IS DISTINCT FROM OLD.request_payload
       OR NEW.release_sha IS DISTINCT FROM OLD.release_sha
       OR NEW.actor_id IS DISTINCT FROM OLD.actor_id THEN
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
