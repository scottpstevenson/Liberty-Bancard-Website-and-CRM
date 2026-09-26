-- Bounded frozen-snapshot execution for SFP Phase A classification.
-- See shared/schema.ts sfpClassificationSnapshots for design rationale.
CREATE TABLE IF NOT EXISTS sfp_classification_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES sfp_programs(id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  taxonomy_version integer NOT NULL,
  policy_version integer NOT NULL,
  target_ids jsonb NOT NULL DEFAULT '[]',
  allowed_provider text NOT NULL,
  max_units integer NOT NULL,
  business_ids jsonb NOT NULL DEFAULT '[]',
  per_business_facts jsonb NOT NULL DEFAULT '{}',
  snapshot_hash text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  claim_token uuid,
  claimed_at timestamptz,
  expires_at timestamptz NOT NULL,
  run_id uuid REFERENCES sfp_classification_runs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sfp_classification_snapshots_state_chk CHECK (state IN ('pending','claimed','completed','expired'))
);

CREATE INDEX IF NOT EXISTS sfp_classification_snapshots_program_idx
  ON sfp_classification_snapshots (program_id, created_at);
