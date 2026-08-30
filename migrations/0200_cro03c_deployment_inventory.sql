-- Authoritative, externally signed CRO-03C deployment inventory.
CREATE TABLE cro03c_deployment_inventories (
  id UUID PRIMARY KEY,
  issuer_id TEXT NOT NULL,
  deployment_identity TEXT NOT NULL,
  environment_identity TEXT NOT NULL,
  release_sha TEXT NOT NULL CHECK (release_sha ~ '^[0-9a-f]{40}$'),
  queue_topology_hash TEXT NOT NULL CHECK (queue_topology_hash ~ '^[0-9a-f]{64}$'),
  identity_kind TEXT NOT NULL CHECK (identity_kind IN ('worker','ordinal')),
  worker_identities JSONB NOT NULL CHECK (jsonb_typeof(worker_identities) = 'array'),
  expected_count INTEGER NOT NULL CHECK (expected_count BETWEEN 1 AND 1000),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > issued_at),
  payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL UNIQUE CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  signature TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE cro03c_deployment_inventory_revocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID NOT NULL UNIQUE REFERENCES cro03c_deployment_inventories(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  revoked_by TEXT NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER cro03c_deployment_inventory_immutable BEFORE UPDATE OR DELETE ON cro03c_deployment_inventories
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
CREATE TRIGGER cro03c_deployment_inventory_revocation_immutable BEFORE UPDATE OR DELETE ON cro03c_deployment_inventory_revocations
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();
ALTER TABLE cro03c_runtime_attestations
  ADD COLUMN inventory_id UUID REFERENCES cro03c_deployment_inventories(id) ON DELETE RESTRICT,
  ADD COLUMN worker_identities JSONB NOT NULL DEFAULT '[]'::jsonb;