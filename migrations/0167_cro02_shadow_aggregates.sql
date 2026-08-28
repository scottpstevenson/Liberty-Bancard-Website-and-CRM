-- CRO-02 reporting is aggregate-only: no subject identifiers or customer data
-- are retained in this table.
ALTER TABLE campaign_preview_members
  ADD COLUMN IF NOT EXISTS commercial_resolution_snapshot_id uuid
  REFERENCES commercial_resolution_snapshots(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS commercial_shadow_aggregates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL,
  coverage_high_water bigint NOT NULL,
  policy_version integer NOT NULL,
  schema_version integer NOT NULL,
  scope text NOT NULL,
  bucket_type text NOT NULL,
  bucket_key text NOT NULL,
  subject_count integer NOT NULL CHECK(subject_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(purpose, coverage_high_water, policy_version, schema_version, scope, bucket_type, bucket_key)
);
CREATE INDEX IF NOT EXISTS commercial_shadow_aggregates_report_idx
  ON commercial_shadow_aggregates(purpose, coverage_high_water, policy_version, schema_version, scope);