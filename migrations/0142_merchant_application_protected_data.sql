-- Migration 0142: Merchant Application protected-data envelope + outbox
--
-- Additive only. Adds AES-256-GCM protected-data envelope metadata to
-- merchant_applications (fingerprints, masks, scheme version, expiry,
-- idempotency), a durable protected-data outbox table, and a SAFE partial
-- fingerprint index scoped to eligible finalized states.
--
-- Also adds draft lifecycle columns, state_version, finalize idempotency,
-- eSign capability fields, and outbox locked_at.
--
-- Legacy rows have ein_fingerprint NULL and are EXCLUDED from the index so
-- they can never participate in equality/dedup collisions. No backfill: we do
-- not fabricate fingerprints for pre-existing plaintext (that requires the
-- merchant key and an explicit re-encryption pass, done separately).

-- ── merchant_applications: protected-data envelope metadata ────────────────
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS ein_fingerprint text;
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS ssn_fingerprint text;
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS bank_account_fingerprint text;
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS ein_mask text;
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS ssn_mask text;
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS bank_account_mask text;
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS bank_routing_mask text;
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS protected_data_version integer;
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS protected_data_metadata jsonb;
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS protected_data_expires_at timestamp;
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS protected_data_idempotency_key text;

-- ── Draft lifecycle columns ─────────────────────────────────────────────────
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS draft_token_expires_at timestamp;
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS draft_token_revoked_at timestamp;

-- ── Optimistic-concurrency state version ────────────────────────────────────
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS state_version integer NOT NULL DEFAULT 0;

-- ── Finalize idempotency ────────────────────────────────────────────────────
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS finalize_idempotency_key text;
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS finalize_ack jsonb;

-- ── eSign capability ────────────────────────────────────────────────────────
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS esign_capability_hash text;
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS esign_capability_expires_at timestamp;
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS esign_capability_revoked_at timestamp;
ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS esign_send_state text NOT NULL DEFAULT 'idle';

-- Safe partial fingerprint index: eligible finalized states only; legacy NULL excluded.
CREATE INDEX IF NOT EXISTS merchant_applications_ein_fingerprint_idx
  ON merchant_applications (ein_fingerprint)
  WHERE ein_fingerprint IS NOT NULL
    AND status IN ('submitted', 'under_review', 'approved', 'declined', 'withdrawn');

-- eSign document ID index for fast external lookups.
CREATE INDEX IF NOT EXISTS merchant_applications_esign_document_id_idx
  ON merchant_applications (esign_document_id)
  WHERE esign_document_id IS NOT NULL;

-- Per-application idempotency index (not a global unique — two different
-- applications may legitimately share the same key string format).
-- The old global unique index is dropped if it exists and replaced with a
-- per-application composite index.
DROP INDEX IF EXISTS merchant_applications_protected_idempotency_uidx;
CREATE INDEX IF NOT EXISTS merchant_applications_protected_idempotency_idx
  ON merchant_applications (id, protected_data_idempotency_key)
  WHERE protected_data_idempotency_key IS NOT NULL;

-- ── Protected-data outbox (envelope metadata only; never plaintext) ────────
CREATE TABLE IF NOT EXISTS merchant_application_protected_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id integer NOT NULL REFERENCES merchant_applications(id),
  event_type text NOT NULL,
  protected_data_version integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  available_at timestamp DEFAULT now(),
  locked_at timestamp,
  processed_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_app_protected_outbox_idempotency_uidx
  ON merchant_application_protected_outbox (idempotency_key);

CREATE INDEX IF NOT EXISTS merchant_app_protected_outbox_dispatch_idx
  ON merchant_application_protected_outbox (status, available_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS merchant_app_protected_outbox_application_idx
  ON merchant_application_protected_outbox (application_id);
