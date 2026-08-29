-- CR-04 channel-qualified Ready and immutable cohort authority.
-- Additive only. This migration creates no cohort, performs no backfill, and
-- enables no campaign, sequence, provider, or transport.

CREATE TABLE IF NOT EXISTS cr04_qualification_policies (
  version INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  decision_ttl_seconds INTEGER NOT NULL,
  taxonomy_version TEXT NOT NULL,
  document JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cr04_policy_status_chk CHECK (status IN ('active','retired')),
  CONSTRAINT cr04_policy_ttl_chk CHECK (decision_ttl_seconds BETWEEN 60 AND 86400)
);

INSERT INTO cr04_qualification_policies(version,status,decision_ttl_seconds,taxonomy_version,document)
VALUES (1,'active',900,'cr04-reasons-v1',
  '{"channels":["email","manual_call","sms"],"purpose":"marketing_outreach","failClosed":true}'::jsonb)
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS cr04_channel_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'marketing_outreach',
  policy_version INTEGER NOT NULL REFERENCES cr04_qualification_policies(version) ON DELETE RESTRICT,
  taxonomy_version TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason_codes TEXT[] NOT NULL,
  dependency_fingerprint TEXT NOT NULL,
  input_snapshot JSONB NOT NULL,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  commercial_resolution_snapshot_id UUID REFERENCES commercial_resolution_snapshots(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cr04_decision_channel_chk CHECK (channel IN ('email','manual_call','sms')),
  CONSTRAINT cr04_decision_value_chk CHECK (decision IN ('qualified','blocked','unavailable')),
  CONSTRAINT cr04_decision_fingerprint_chk CHECK (dependency_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cr04_decision_expiry_chk CHECK (expires_at > decided_at),
  CONSTRAINT cr04_decision_unique UNIQUE
    (contact_id,channel,purpose,policy_version,dependency_fingerprint)
);
CREATE INDEX IF NOT EXISTS cr04_channel_decisions_current_idx
  ON cr04_channel_decisions(contact_id,channel,purpose,expires_at DESC);

CREATE OR REPLACE FUNCTION cr04_forbid_decision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CR04_DECISION_IMMUTABLE';
END $$;
DROP TRIGGER IF EXISTS cr04_decision_update_guard ON cr04_channel_decisions;
CREATE TRIGGER cr04_decision_update_guard BEFORE UPDATE ON cr04_channel_decisions
FOR EACH ROW EXECUTE FUNCTION cr04_forbid_decision_mutation();
DROP TRIGGER IF EXISTS cr04_decision_delete_guard ON cr04_channel_decisions;
CREATE TRIGGER cr04_decision_delete_guard BEFORE DELETE ON cr04_channel_decisions
FOR EACH ROW EXECUTE FUNCTION cr04_forbid_decision_mutation();

CREATE TABLE IF NOT EXISTS cr04_cohort_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose TEXT NOT NULL,
  channel TEXT NOT NULL,
  policy_version INTEGER NOT NULL REFERENCES cr04_qualification_policies(version) ON DELETE RESTRICT,
  scope JSONB NOT NULL,
  filters JSONB NOT NULL,
  definition_fingerprint TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cr04_cohort_definition_channel_chk CHECK (channel IN ('email','manual_call','sms')),
  CONSTRAINT cr04_cohort_definition_fingerprint_chk CHECK (definition_fingerprint ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS cr04_cohort_definitions_fingerprint_uidx
  ON cr04_cohort_definitions(definition_fingerprint);

CREATE TABLE IF NOT EXISTS cr04_cohort_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id UUID NOT NULL REFERENCES cr04_cohort_definitions(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'frozen',
  as_of TIMESTAMPTZ NOT NULL,
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  member_count INTEGER NOT NULL DEFAULT 0,
  membership_fingerprint TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cr04_cohort_run_status_chk CHECK (status IN ('frozen','consumed','cancelled','expired')),
  CONSTRAINT cr04_cohort_run_fingerprint_chk CHECK (membership_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cr04_cohort_run_unique UNIQUE (definition_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS cr04_cohort_members (
  run_id UUID NOT NULL REFERENCES cr04_cohort_runs(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  decision_id UUID NOT NULL REFERENCES cr04_channel_decisions(id) ON DELETE RESTRICT,
  dependency_fingerprint TEXT NOT NULL,
  included_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  removal_reason_code TEXT,
  PRIMARY KEY (run_id,ordinal),
  CONSTRAINT cr04_cohort_member_contact_unique UNIQUE (run_id,contact_id),
  CONSTRAINT cr04_cohort_member_fingerprint_chk CHECK (dependency_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cr04_cohort_member_removal_chk CHECK (
    (removed_at IS NULL AND removal_reason_code IS NULL) OR
    (removed_at IS NOT NULL AND removal_reason_code IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS cr04_cohort_members_ordered_idx
  ON cr04_cohort_members(run_id,ordinal);

CREATE OR REPLACE FUNCTION cr04_guard_frozen_member()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.run_id <> NEW.run_id OR OLD.ordinal <> NEW.ordinal OR
     OLD.contact_id <> NEW.contact_id OR OLD.decision_id <> NEW.decision_id OR
     OLD.dependency_fingerprint <> NEW.dependency_fingerprint OR
     OLD.included_at <> NEW.included_at THEN
    RAISE EXCEPTION 'CR04_FROZEN_MEMBER_IMMUTABLE';
  END IF;
  IF OLD.removed_at IS NOT NULL AND
     (NEW.removed_at IS DISTINCT FROM OLD.removed_at OR
      NEW.removal_reason_code IS DISTINCT FROM OLD.removal_reason_code) THEN
    RAISE EXCEPTION 'CR04_REMOVAL_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cr04_frozen_member_guard ON cr04_cohort_members;
CREATE TRIGGER cr04_frozen_member_guard
BEFORE UPDATE ON cr04_cohort_members
FOR EACH ROW EXECUTE FUNCTION cr04_guard_frozen_member();

CREATE OR REPLACE FUNCTION cr04_forbid_member_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CR04_FROZEN_MEMBER_DELETE_FORBIDDEN';
END $$;

DROP TRIGGER IF EXISTS cr04_frozen_member_delete_guard ON cr04_cohort_members;
CREATE TRIGGER cr04_frozen_member_delete_guard
BEFORE DELETE ON cr04_cohort_members
FOR EACH ROW EXECUTE FUNCTION cr04_forbid_member_delete();

CREATE TABLE IF NOT EXISTS cr04_enrollment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  sequence_id INTEGER NOT NULL REFERENCES follow_up_sequences(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL,
  source TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  decision_id UUID NOT NULL REFERENCES cr04_channel_decisions(id) ON DELETE RESTRICT,
  cohort_run_id UUID REFERENCES cr04_cohort_runs(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'approved',
  reason_code TEXT,
  enrollment_id INTEGER REFERENCES sequence_enrollments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT cr04_enrollment_intent_channel_chk CHECK (channel IN ('email','manual_call','sms')),
  CONSTRAINT cr04_enrollment_intent_status_chk CHECK (status IN ('approved','enrolled','blocked','failed'))
);

ALTER TABLE campaign_previews
  ADD COLUMN IF NOT EXISTS cr04_cohort_run_id UUID REFERENCES cr04_cohort_runs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS cr04_policy_version INTEGER,
  ADD COLUMN IF NOT EXISTS cr04_dependency_fingerprint TEXT;

ALTER TABLE campaign_preview_members
  ADD COLUMN IF NOT EXISTS cr04_decision_id UUID REFERENCES cr04_channel_decisions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS cr04_cohort_ordinal INTEGER;