-- Explicitly activated, provider-free SFP classification cursor. The
-- high-water mark is bounded at activation; a new pass needs a new start.
CREATE TABLE IF NOT EXISTS sfp_free_classification_continuations (
  program_id uuid PRIMARY KEY REFERENCES sfp_programs(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'idle'
    CONSTRAINT sfp_free_classification_continuations_state_chk
    CHECK (state IN ('idle','running','paused','completed')),
  high_water_business_id integer NOT NULL DEFAULT 0,
  stop_business_id integer NOT NULL DEFAULT 0,
  policy_version integer NOT NULL,
  taxonomy_version integer NOT NULL,
  classifier_version integer NOT NULL,
  scanned_count bigint NOT NULL DEFAULT 0,
  processed_count bigint NOT NULL DEFAULT 0,
  target_count bigint NOT NULL DEFAULT 0,
  rejected_count bigint NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  last_tick_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
