-- Partner program upgrade: durable application record, partner-submitted business introductions and the approval
-- record for public referral compensation wording. All three tables are new and empty; no existing table or row is
-- changed, nothing is backfilled, nothing is enabled and nothing is sent. A code rollback may leave them in place.
--
-- partner_applications: one row per accepted application occurrence. It binds the occurrence (inbound_requests) to the
-- exact pending partner row, so no later step has to guess an account from a matching email. Submitted answers are
-- stored as received (bounded, validated, no password, no document). Consent evidence is the wording version, the
-- SHA-256 of the exact text shown, the server receive time and the purpose. review_status is the single lifecycle owner;
-- `revision` is the compare-and-set counter for staff decisions. Only one open (pending_review / needs_info)
-- application can exist per mailbox, so concurrent submissions from two tabs or two keys resolve in the database.
CREATE TABLE IF NOT EXISTS partner_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_request_id uuid NOT NULL REFERENCES inbound_requests(id),
  partner_id integer NOT NULL REFERENCES partners(id),
  mailbox text NOT NULL,
  path text NOT NULL,
  profession text,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent_version text NOT NULL,
  consent_text_sha256 text NOT NULL,
  consent_purpose text NOT NULL,
  consent_accepted_at timestamptz NOT NULL DEFAULT now(),
  marketing_opt_in boolean NOT NULL DEFAULT false,
  marketing_disclosure_id text,
  source_page text,
  acquisition jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_version integer NOT NULL,
  review_status text NOT NULL DEFAULT 'pending_review',
  revision integer NOT NULL DEFAULT 1,
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  schedule_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_applications_path_chk CHECK (path IN ('referral', 'sales_agent')),
  CONSTRAINT partner_applications_status_chk CHECK (review_status IN ('pending_review', 'needs_info', 'accepted', 'declined', 'withdrawn', 'superseded')),
  CONSTRAINT partner_applications_mailbox_chk CHECK (mailbox = lower(mailbox)),
  CONSTRAINT partner_applications_marketing_chk CHECK (marketing_opt_in = (marketing_disclosure_id IS NOT NULL)),
  CONSTRAINT partner_applications_decision_chk CHECK (
    review_status IN ('pending_review', 'needs_info') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS partner_applications_inbound_request_uidx ON partner_applications (inbound_request_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS partner_applications_partner_uidx ON partner_applications (partner_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS partner_applications_open_mailbox_uidx ON partner_applications (mailbox) WHERE review_status IN ('pending_review', 'needs_info');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_applications_review_idx ON partner_applications (review_status, created_at DESC, id);
--> statement-breakpoint
-- partner_introductions: a business introduced by an approved partner, with the introducer's permission confirmation.
-- (partner_id, idempotency_key) is the occurrence identity: a retry with the same key returns the same row. The
-- confirmation is introducer evidence only; it is never the merchant's own email or SMS consent. review_state records an
-- explicit review outcome for a duplicate contact or a competing referrer; no attribution is moved or merged.
CREATE TABLE IF NOT EXISTS partner_introductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id integer NOT NULL REFERENCES partners(id),
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  business_name text NOT NULL,
  contact_name text NOT NULL,
  contact_email text,
  contact_phone text,
  website text,
  context text,
  contact_id integer REFERENCES contacts(id),
  referral_id integer REFERENCES referrals(id),
  permission_version text NOT NULL,
  permission_text_sha256 text NOT NULL,
  permission_confirmed_at timestamptz NOT NULL DEFAULT now(),
  submitted_by_user_id text,
  review_state text NOT NULL DEFAULT 'pending_review',
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_introductions_state_chk CHECK (review_state IN ('pending_review', 'duplicate_review', 'competing_referrer', 'accepted', 'declined')),
  CONSTRAINT partner_introductions_reach_chk CHECK (contact_email IS NOT NULL OR contact_phone IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS partner_introductions_partner_key_uidx ON partner_introductions (partner_id, idempotency_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_introductions_partner_idx ON partner_introductions (partner_id, created_at DESC, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_introductions_review_idx ON partner_introductions (review_state, created_at DESC) WHERE review_state <> 'pending_review';
--> statement-breakpoint
-- partner_public_policy_versions: the approval record for public referral compensation wording. A numeric public
-- share exists only while one row for the policy is 'approved' (an administrator recorded who approved it and which
-- schedule/copy version it came from). With no approved row the public pages say compensation is confirmed in the
-- written agreement. The table is deliberately not seeded.
CREATE TABLE IF NOT EXISTS partner_public_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text NOT NULL,
  version integer NOT NULL,
  share_percent integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  schedule_reference text NOT NULL,
  copy_version text NOT NULL,
  created_by text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  revoked_by text,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_public_policy_key_chk CHECK (policy_key IN ('standard_referral')),
  CONSTRAINT partner_public_policy_share_chk CHECK (share_percent BETWEEN 1 AND 100),
  CONSTRAINT partner_public_policy_status_chk CHECK (status IN ('draft', 'approved', 'revoked')),
  CONSTRAINT partner_public_policy_approval_chk CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT partner_public_policy_revocation_chk CHECK (status <> 'revoked' OR (revoked_by IS NOT NULL AND revoked_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS partner_public_policy_version_uidx ON partner_public_policy_versions (policy_key, version);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS partner_public_policy_one_approved_uidx ON partner_public_policy_versions (policy_key) WHERE status = 'approved';
