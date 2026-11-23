-- The canonical 0109 snapshot baselines 0077 and 0085 without including this relation.
-- Provision the original table and indexes on affected databases without changing existing attestations.
CREATE TABLE IF NOT EXISTS public.outbound_admin_attestations (
  id serial PRIMARY KEY,
  gate_key text NOT NULL,
  attested_by text NOT NULL,
  attested_at timestamptz NOT NULL DEFAULT now(),
  attestation_note text NOT NULL,
  evidence_json jsonb,
  expires_at timestamptz,
  superseded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.outbound_admin_attestations
  ADD COLUMN IF NOT EXISTS gate_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS attestation_type text NOT NULL DEFAULT 'manual_admin';

CREATE INDEX IF NOT EXISTS outbound_attestations_gate_key_idx
  ON public.outbound_admin_attestations (gate_key, attested_at DESC);

CREATE INDEX IF NOT EXISTS outbound_attestations_gate_version_idx
  ON public.outbound_admin_attestations (gate_key, gate_version, attested_at DESC)
  WHERE superseded = false;
