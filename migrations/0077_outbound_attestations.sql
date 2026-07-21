-- Migration 0077: outbound_admin_attestations
-- Dated administrator attestations for facts that cannot be automatically
-- verified from GHL API (e.g. A2P 10DLC brand/campaign approved, sending
-- domain SPF/DKIM verified in GHL dashboard).
--
-- Each gate_key identifies one specific assertion.
-- An attestation is considered valid until expires_at (if set) or indefinitely.
-- Superseded by a newer row with the same gate_key (latest by attested_at wins).

CREATE TABLE IF NOT EXISTS outbound_admin_attestations (
  id              SERIAL PRIMARY KEY,
  gate_key        TEXT        NOT NULL,              -- e.g. 'ghl_sms_a2p_approved'
  attested_by     TEXT        NOT NULL,              -- admin email or user ID who attested
  attested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attestation_note TEXT       NOT NULL,              -- human-readable confirmation statement
  evidence_json   JSONB,                             -- optional structured evidence
  expires_at      TIMESTAMPTZ,                       -- NULL = never expires
  superseded      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS outbound_attestations_gate_key_idx
  ON outbound_admin_attestations (gate_key, attested_at DESC);

-- Seed known gate keys as comments for documentation
-- gate_key values in use:
--   'ghl_cold_email_domain'   — mail.libertybancard.com verified as GHL sending domain
--   'ghl_cold_email_sender'   — Scott@mail.libertybancard.com configured as GHL sender
--   'ghl_sms_a2p_approved'    — A2P 10DLC brand AND campaign approved by TCR
--   'ghl_sms_sending_number'  — Liberty sending number identified and SMS-capable
--   'gmail_aliases_accepted'  — all required Send-As aliases accepted in Google
--   'webhook_sig_verified'    — GHL webhook HMAC-SHA256 signature spot-checked manually
