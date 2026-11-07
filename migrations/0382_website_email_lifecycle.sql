-- Website email lifecycle (default-closed warm lane). Forward-only and additive: new tables plus one nullable
-- marker column. Nothing here enables a lane, enrolls a recipient, releases a pause or sends mail. An application
-- rollback leaves every row in place; rows written by this lane stay held and are not claimed by older code
-- because older code has no reader for the marker column and filters nothing by it.
CREATE TABLE IF NOT EXISTS website_lifecycle_config_revisions (
  id serial PRIMARY KEY,
  revision integer NOT NULL,
  status text NOT NULL DEFAULT 'closed',
  source_program_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  sender_category text NOT NULL DEFAULT 'accounts',
  sender_account text,
  eligibility_starts_at timestamptz,
  daily_limit integer NOT NULL DEFAULT 0,
  config_hash text NOT NULL,
  created_by text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_lifecycle_config_revisions_status_chk CHECK (status IN ('closed', 'open', 'revoked')),
  CONSTRAINT website_lifecycle_config_revisions_hash_chk CHECK (config_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS website_lifecycle_config_revisions_revision_uidx ON website_lifecycle_config_revisions (revision);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS website_warm_revisions (
  id serial PRIMARY KEY,
  program text NOT NULL,
  source_sequence_id integer REFERENCES follow_up_sequences(id),
  communication_purpose text NOT NULL,
  snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL,
  unsupported_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  state text NOT NULL DEFAULT 'inactive',
  created_by text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_warm_revisions_program_chk CHECK (program IN ('requested_followup', 'nurture')),
  CONSTRAINT website_warm_revisions_state_chk CHECK (state IN ('inactive', 'approved', 'retired')),
  CONSTRAINT website_warm_revisions_purpose_chk CHECK (communication_purpose IN ('human_response', 'transactional', 'promotional')),
  CONSTRAINT website_warm_revisions_hash_chk CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT website_warm_revisions_approved_chk CHECK (state <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS website_warm_revisions_program_hash_uidx ON website_warm_revisions (program, snapshot_hash);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS website_lifecycle_intents (
  id serial PRIMARY KEY,
  occurrence_key text NOT NULL,
  program text NOT NULL,
  source_category text NOT NULL,
  source_type text NOT NULL,
  contact_id integer REFERENCES contacts(id),
  state text NOT NULL DEFAULT 'held',
  reason text,
  consent_basis text,
  consent_event_key text,
  email_token_hash text,
  email_generation integer,
  manifest_version text NOT NULL,
  manifest_hash text NOT NULL,
  config_revision_id integer REFERENCES website_lifecycle_config_revisions(id),
  warm_revision_id integer REFERENCES website_warm_revisions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_lifecycle_intents_program_chk CHECK (program IN ('requested_followup', 'nurture')),
  CONSTRAINT website_lifecycle_intents_state_chk CHECK (state IN ('held', 'admitted', 'refused', 'cancelled', 'completed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS website_lifecycle_intents_occurrence_program_uidx ON website_lifecycle_intents (occurrence_key, program);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS website_lifecycle_intents_state_idx ON website_lifecycle_intents (state, id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS website_lifecycle_admissions (
  id serial PRIMARY KEY,
  intent_id integer NOT NULL REFERENCES website_lifecycle_intents(id),
  enrollment_id integer,
  contact_id integer NOT NULL REFERENCES contacts(id),
  program text NOT NULL,
  request_id text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  warm_revision_id integer NOT NULL REFERENCES website_warm_revisions(id),
  warm_revision_hash text NOT NULL,
  config_revision_id integer NOT NULL REFERENCES website_lifecycle_config_revisions(id),
  email_token_hash text NOT NULL,
  email_generation integer NOT NULL,
  consent_basis text NOT NULL,
  consent_event_key text,
  entry_event_id integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'active',
  revoked_reason text,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_lifecycle_admissions_channel_chk CHECK (channel = 'email'),
  CONSTRAINT website_lifecycle_admissions_state_chk CHECK (state IN ('active', 'revoked', 'completed')),
  CONSTRAINT website_lifecycle_admissions_hash_chk CHECK (warm_revision_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS website_lifecycle_admissions_intent_uidx ON website_lifecycle_admissions (intent_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS website_lifecycle_admissions_enrollment_uidx ON website_lifecycle_admissions (enrollment_id) WHERE enrollment_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS website_lifecycle_admissions_journey_uidx ON website_lifecycle_admissions (contact_id, program) WHERE state IN ('active', 'completed');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS website_lifecycle_admissions_state_idx ON website_lifecycle_admissions (state, contact_id);
--> statement-breakpoint
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS website_admission_id integer;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sequence_enrollments_website_admission_id_fk') THEN
    ALTER TABLE sequence_enrollments ADD CONSTRAINT sequence_enrollments_website_admission_id_fk
      FOREIGN KEY (website_admission_id) REFERENCES website_lifecycle_admissions(id);
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sequence_enrollments_website_admission_idx ON sequence_enrollments (website_admission_id) WHERE website_admission_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS website_email_send_receipts (
  id serial PRIMARY KEY,
  idempotency_key text NOT NULL,
  admission_id integer REFERENCES website_lifecycle_admissions(id),
  step_order integer NOT NULL DEFAULT 0,
  contact_id integer REFERENCES contacts(id),
  rfc_message_id text NOT NULL,
  provider_account text,
  provider_message_id text,
  provider_thread_id text,
  from_address text NOT NULL,
  reply_to text,
  purpose text NOT NULL,
  recipient_token_hash text NOT NULL,
  recipient_generation integer,
  outcome text NOT NULL DEFAULT 'pending',
  unsent_attempts integer NOT NULL DEFAULT 0,
  capacity_day text,
  capacity_scope text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_email_send_receipts_outcome_chk CHECK (outcome IN ('pending', 'accepted', 'unsent', 'uncertain'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS website_email_send_receipts_key_uidx ON website_email_send_receipts (idempotency_key);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS website_email_send_receipts_rfc_uidx ON website_email_send_receipts (rfc_message_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS website_email_send_receipts_thread_idx ON website_email_send_receipts (provider_account, provider_thread_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS gmail_mailbox_reader_state (
  account_email text PRIMARY KEY,
  state text NOT NULL DEFAULT 'closed',
  history_cursor text,
  account_fingerprint text,
  lease_token text,
  lease_expires_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gmail_mailbox_reader_state_state_chk CHECK (state IN ('closed', 'active', 'needs_resync', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS website_inbound_evidence (
  id serial PRIMARY KEY,
  account_email text NOT NULL,
  provider_message_id text NOT NULL,
  thread_id text,
  rfc_message_id text,
  kind text NOT NULL,
  state text NOT NULL,
  reason text,
  send_receipt_id integer REFERENCES website_email_send_receipts(id),
  contact_id integer REFERENCES contacts(id),
  evidence_hash text NOT NULL,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_inbound_evidence_kind_chk CHECK (kind IN ('reply', 'bounce', 'auto_reply', 'other')),
  CONSTRAINT website_inbound_evidence_state_chk CHECK (state IN ('applied', 'unapplied'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS website_inbound_evidence_message_uidx ON website_inbound_evidence (account_email, provider_message_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS website_inbound_evidence_state_idx ON website_inbound_evidence (state, id);
--> statement-breakpoint
-- The canonical communication ledger must be able to name Gmail truthfully: warm sends and mailbox-observed replies are
-- Gmail events, and the original CHECK (migration 0119) only listed ghl/smtp/twilio/internal/manual. This only WIDENS the
-- allowed set (every previously legal value stays legal; unlisted values are still rejected). The swap is one statement
-- so no row is ever admitted without a constraint, and it is added NOT VALID so no table scan runs under the lock.
DO $$ BEGIN
  PERFORM set_config('lock_timeout', '10s', true);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communication_events_provider_gmail_chk' AND conrelid = 'communication_events'::regclass) THEN
    ALTER TABLE communication_events DROP CONSTRAINT IF EXISTS communication_events_provider_check;
    ALTER TABLE communication_events ADD CONSTRAINT communication_events_provider_gmail_chk
      CHECK (provider IS NULL OR provider IN ('ghl', 'smtp', 'gmail', 'twilio', 'internal', 'manual')) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
-- Validation takes only SHARE UPDATE EXCLUSIVE (reads and writes continue).
ALTER TABLE communication_events VALIDATE CONSTRAINT communication_events_provider_gmail_chk;
