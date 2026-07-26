-- Migration 0087: Suppression Compliance Fields + Deal Attribution
-- Adds full compliance/suppression metadata and Google Ads attribution fields
-- to contacts and deals tables.

-- ── Contacts: lead consent & readiness ────────────────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_consent_level      text DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS email_readiness         text DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS sms_consent_status      text DEFAULT 'not_collected';

-- ── Contacts: opt-out tracking ────────────────────────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS opt_out_status          text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS opt_out_date            timestamptz,
  ADD COLUMN IF NOT EXISTS opt_out_channel         text;

-- ── Contacts: unsubscribe tracking ────────────────────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS unsubscribe_status      text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS unsubscribe_date        timestamptz;

-- ── Contacts: bounce tracking ──────────────────────────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS bounce_status           text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS bounce_date             timestamptz,
  ADD COLUMN IF NOT EXISTS bounce_reason           text;

-- ── Contacts: complaint tracking ──────────────────────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS complaint_status        text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS complaint_date          timestamptz;

-- ── Contacts: DNC extended fields ─────────────────────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS dnc_date               timestamptz,
  ADD COLUMN IF NOT EXISTS dnc_source             text;

-- ── Contacts: merchant relationship ───────────────────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS existing_merchant_customer  boolean DEFAULT false;

-- ── Contacts: suppression summary ─────────────────────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS suppression_reason      text,
  ADD COLUMN IF NOT EXISTS suppression_history     jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS next_allowed_contact_date timestamptz,
  ADD COLUMN IF NOT EXISTS consent_audit_trail     jsonb DEFAULT '[]'::jsonb;

-- ── Contacts: attribution extras ──────────────────────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS referrer_url            text,
  ADD COLUMN IF NOT EXISTS source_path             text,
  ADD COLUMN IF NOT EXISTS import_batch_id         text,
  ADD COLUMN IF NOT EXISTS row_provenance          jsonb;

-- ── Deals: Google Ads attribution ─────────────────────────────────────────────
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS attribution_gclid       text,
  ADD COLUMN IF NOT EXISTS attribution_source      text,
  ADD COLUMN IF NOT EXISTS attribution_medium      text,
  ADD COLUMN IF NOT EXISTS attribution_campaign    text,
  ADD COLUMN IF NOT EXISTS booking_attributed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS conversion_attributed_at timestamptz;

-- ── Indexes for suppression enforcement queries ───────────────────────────────
CREATE INDEX IF NOT EXISTS contacts_opt_out_status_idx
  ON contacts (opt_out_status) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS contacts_bounce_status_idx
  ON contacts (bounce_status) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS contacts_complaint_status_idx
  ON contacts (complaint_status) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS contacts_sms_consent_status_idx
  ON contacts (sms_consent_status) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS deals_attribution_gclid_idx
  ON deals (attribution_gclid) WHERE attribution_gclid IS NOT NULL;
