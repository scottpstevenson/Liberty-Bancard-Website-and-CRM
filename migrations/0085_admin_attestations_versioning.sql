-- Migration 0085: outbound_admin_attestations — versioning support
--
-- Adds two columns to support versioned attestation records.
--
-- gate_version (INTEGER, default 1):
--   Incremented by an admin when compliance requirements for a gate change
--   (e.g. A2P campaign re-registered under a new brand, domain moved to new
--   provider). Attestations whose gate_version is lower than the current
--   requirement version are considered stale and must be re-attested.
--
-- attestation_type (TEXT, default 'manual_admin'):
--   Classification of how the attestation was obtained:
--     'manual_admin'         — human admin verified and recorded manually
--     'api_verified'         — automated live-API probe confirmed the fact
--     'third_party_verified' — external vendor confirmation (e.g. TCR portal)
--
-- This migration is additive only — all existing attestation rows are
-- preserved with gate_version=1 and attestation_type='manual_admin'.
--
-- NOTE: Adding these columns does NOT claim any approval or configure any
-- phone number. A2P 10DLC brand/campaign approval must be obtained through
-- The Campaign Registry (TCR) before SMS sends can be enabled.

ALTER TABLE outbound_admin_attestations
  ADD COLUMN IF NOT EXISTS gate_version     INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS attestation_type TEXT    NOT NULL DEFAULT 'manual_admin';

-- Composite index: "latest non-superseded attestation for gate X at version V"
-- Supports the getLatestAttestation() query pattern used by ghl-channel-probes.ts.
CREATE INDEX IF NOT EXISTS outbound_attestations_gate_version_idx
  ON outbound_admin_attestations (gate_key, gate_version, attested_at DESC)
  WHERE superseded = FALSE;
