-- BT-04A: canonical consent subject identity, immutable facts, and derived
-- channel/purpose projections. All additions are legacy-safe: existing audit
-- rows remain legacy_trace and no affirmative consent is fabricated.

CREATE TABLE IF NOT EXISTS consent_subjects (
  id serial PRIMARY KEY,
  subject_type text NOT NULL,
  subject_record_id integer NOT NULL,
  canonical_key text NOT NULL,
  normalized_email text,
  normalized_phone text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT consent_subjects_type_check CHECK (
    subject_type IN ('contact', 'prospect', 'sdr_lead_state', 'sdr_merchant_contact')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS consent_subjects_type_record_uidx
  ON consent_subjects (subject_type, subject_record_id);
CREATE INDEX IF NOT EXISTS consent_subjects_email_idx ON consent_subjects (normalized_email);
CREATE INDEX IF NOT EXISTS consent_subjects_phone_idx ON consent_subjects (normalized_phone);

ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS subject_id integer REFERENCES consent_subjects(id);
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS record_kind text NOT NULL DEFAULT 'legacy_trace';
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1;
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS event_namespace text;
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS event_key text;
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS purpose text;
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS receipt_at timestamp;
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS effective_at timestamp;
ALTER TABLE consent_audit_logs ADD COLUMN IF NOT EXISTS evidence jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS consent_audit_canonical_event_uidx
  ON consent_audit_logs (event_namespace, event_key)
  WHERE record_kind = 'canonical_fact'
    AND event_namespace IS NOT NULL
    AND event_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS consent_audit_reachability_event_uidx
  ON consent_audit_logs (event_namespace, event_key)
  WHERE record_kind = 'reachability_fact'
    AND event_namespace IS NOT NULL
    AND event_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS consent_audit_subject_idx
  ON consent_audit_logs (subject_id, created_at);

CREATE TABLE IF NOT EXISTS consent_subject_channel_states (
  id serial PRIMARY KEY,
  subject_id integer NOT NULL REFERENCES consent_subjects(id) ON DELETE CASCADE,
  channel text NOT NULL,
  purpose text NOT NULL,
  permission_state text NOT NULL DEFAULT 'unknown',
  restriction_reason text,
  source_event_id integer REFERENCES consent_audit_logs(id),
  effective_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  evidence jsonb,
  CONSTRAINT consent_subject_channel_state_check CHECK (
    permission_state IN ('unknown', 'permitted', 'withdrawn', 'suppressed')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS consent_subject_channel_purpose_uidx
  ON consent_subject_channel_states (subject_id, channel, purpose);
CREATE INDEX IF NOT EXISTS consent_subject_channel_state_subject_idx
  ON consent_subject_channel_states (subject_id);

CREATE TABLE IF NOT EXISTS consent_subject_global_suppressions (
  subject_id integer PRIMARY KEY REFERENCES consent_subjects(id) ON DELETE CASCADE,
  is_suppressed boolean NOT NULL DEFAULT false,
  restriction_reason text,
  source_event_id integer REFERENCES consent_audit_logs(id),
  effective_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consent_subject_reachability (
  id serial PRIMARY KEY,
  subject_id integer NOT NULL REFERENCES consent_subjects(id) ON DELETE CASCADE,
  channel text NOT NULL,
  reachability_state text NOT NULL,
  source_event_id integer REFERENCES consent_audit_logs(id),
  observed_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  details jsonb,
  CONSTRAINT consent_subject_reachability_state_check CHECK (
    reachability_state IN ('unknown', 'reachable', 'bounced', 'invalid', 'undeliverable')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS consent_subject_reachability_uidx
  ON consent_subject_reachability (subject_id, channel);

-- SDR legacy compatibility default becomes fail-closed. Existing rows are not
-- rewritten; they require a canonical event before becoming eligible.
ALTER TABLE sdr_lead_state ALTER COLUMN consent_email SET DEFAULT false;