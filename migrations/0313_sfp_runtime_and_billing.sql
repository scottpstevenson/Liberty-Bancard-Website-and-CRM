-- Routine SFP uses durable deployment/job ownership and exact provider usage.
-- CRO03C runtime attestations remain untouched and continue to govern CRO03C.

CREATE TABLE sfp_runtime_owner_authority (
  authority_key text PRIMARY KEY DEFAULT 'routine_sfp',
  deployment_identity text NOT NULL,
  environment_identity text NOT NULL,
  artifact_sha text NOT NULL,
  queue_topology_hash text NOT NULL,
  owner_epoch bigint NOT NULL,
  owner_token uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sfp_runtime_owner_authority_singleton_chk CHECK (authority_key = 'routine_sfp'),
  CONSTRAINT sfp_runtime_owner_authority_epoch_chk CHECK (owner_epoch > 0)
);

CREATE TABLE sfp_runtime_job_leases (
  operation_id uuid PRIMARY KEY REFERENCES provider_operations(id) ON DELETE RESTRICT,
  deployment_identity text NOT NULL,
  environment_identity text NOT NULL,
  artifact_sha text NOT NULL,
  process_identity text NOT NULL,
  owner_epoch bigint NOT NULL,
  owner_token uuid NOT NULL,
  operation_claim_token uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sfp_runtime_job_leases_epoch_chk CHECK (owner_epoch > 0)
);
CREATE INDEX sfp_runtime_job_leases_owner_idx
  ON sfp_runtime_job_leases(deployment_identity, owner_epoch, lease_expires_at);

ALTER TABLE provider_operations
  ADD COLUMN settled_units integer NOT NULL DEFAULT 0,
  ADD COLUMN unit_price_unit text,
  ADD COLUMN runtime_owner_epoch bigint,
  ADD COLUMN runtime_owner_token uuid,
  ADD COLUMN provider_request_id text,
  ADD COLUMN provider_usage_quantity numeric(30,12),
  ADD COLUMN provider_usage_unit text,
  ADD COLUMN provider_usage_status text,
  ADD COLUMN provider_usage_reconciled_at timestamptz,
  ADD CONSTRAINT provider_operations_settled_units_nonnegative_chk CHECK (settled_units >= 0),
  ADD CONSTRAINT provider_operations_usage_contract_chk CHECK (
    provider_usage_status IS NULL OR provider_usage_status IN ('known','unknown','conflict','not_applicable')
  ),
  ADD CONSTRAINT provider_operations_known_usage_complete_chk CHECK (
    provider_usage_status IS DISTINCT FROM 'known'
    OR (provider_usage_quantity IS NOT NULL AND provider_usage_quantity >= 0 AND provider_usage_unit IS NOT NULL)
  );
CREATE UNIQUE INDEX provider_operations_provider_request_uidx
  ON provider_operations(provider, provider_request_id) WHERE provider_request_id IS NOT NULL;

ALTER TABLE provider_attempts
  ADD COLUMN dispatch_marked_at timestamptz;

ALTER TABLE sfp_stage_runs
  ADD COLUMN billing_unknown_count integer NOT NULL DEFAULT 0;
ALTER TABLE sfp_classification_runs
  ADD COLUMN billing_unknown_count integer NOT NULL DEFAULT 0;

CREATE TABLE sfp_provider_usage_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL REFERENCES provider_controls(provider),
  provider_request_id text NOT NULL,
  operation_id uuid NOT NULL REFERENCES provider_operations(id) ON DELETE RESTRICT,
  usage_quantity numeric(30,12),
  usage_unit text,
  usage_status text NOT NULL DEFAULT 'unknown',
  reconciliation_source text,
  result_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sfp_provider_usage_status_chk CHECK (usage_status IN ('known','unknown','conflict')),
  CONSTRAINT sfp_provider_usage_known_contract_chk CHECK (
    usage_status <> 'known' OR (usage_quantity IS NOT NULL AND usage_quantity >= 0 AND usage_unit IS NOT NULL)
  ),
  CONSTRAINT sfp_provider_usage_operation_request_uidx UNIQUE(provider, provider_request_id)
);
CREATE INDEX sfp_provider_usage_operation_idx ON sfp_provider_usage_reconciliations(operation_id);