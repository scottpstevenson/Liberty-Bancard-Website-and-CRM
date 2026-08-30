-- CRO-05A: durable inbound request occurrences, held effects, assignment
-- evidence, CR-05 work links, and encrypted shared protected objects.
CREATE TABLE IF NOT EXISTS protected_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_ref UUID NOT NULL DEFAULT gen_random_uuid(),
  encrypted_bytes BYTEA NOT NULL,
  checksum_sha256 TEXT NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  mime_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  tenant_scope TEXT NOT NULL DEFAULT 'default',
  environment_scope TEXT NOT NULL,
  validation_state TEXT NOT NULL DEFAULT 'validated'
    CHECK (validation_state IN ('pending', 'validated', 'rejected')),
  retention_state TEXT NOT NULL DEFAULT 'active'
    CHECK (retention_state IN ('active', 'expired', 'deleted')),
  legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
  upload_complete_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (object_ref)
);
CREATE INDEX IF NOT EXISTS protected_objects_retention_idx
  ON protected_objects (retention_state, legal_hold);

CREATE TABLE IF NOT EXISTS inbound_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  occurrence_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  source_category TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_class TEXT NOT NULL,
  caller_scope TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  source_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  contact_id INTEGER REFERENCES contacts(id),
  deal_id INTEGER REFERENCES deals(id),
  ticket_id INTEGER REFERENCES tickets(id),
  -- The opaque reference is the only protected-object identity allowed to
  -- leave the object authority; never persist its internal row UUID here.
  protected_object_ref UUID REFERENCES protected_objects(object_ref),
  consent_evidence_refs JSONB,
  attribution_refs JSONB,
  manifest_version TEXT NOT NULL,
  manifest_hash TEXT NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  lifecycle_state TEXT NOT NULL DEFAULT 'claimed'
    CHECK (lifecycle_state IN ('claimed', 'processing', 'accepted', 'completed', 'failed', 'cancelled', 'review_required')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  terminal_reason TEXT,
  reconciliation_state TEXT NOT NULL DEFAULT 'not_required'
    CHECK (reconciliation_state IN ('not_required', 'pending', 'reconciled', 'orphaned')),
  assignment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (assignment_status IN ('pending', 'assigned', 'unassigned_policy_missing', 'review_required', 'preserved')),
  assigned_to TEXT,
  sla_due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_category, source_type, occurrence_key)
);
CREATE INDEX IF NOT EXISTS inbound_requests_operator_idx
  ON inbound_requests (source_class, lifecycle_state, created_at);
CREATE INDEX IF NOT EXISTS inbound_requests_contact_idx
  ON inbound_requests (contact_id, created_at);

CREATE TABLE IF NOT EXISTS inbound_request_effects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES inbound_requests(id) ON DELETE CASCADE,
  effect_key TEXT NOT NULL,
  effect_type TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'held'
    CHECK (state IN ('held', 'ready', 'attempting', 'sent', 'failed', 'suppressed')),
  required BOOLEAN NOT NULL DEFAULT FALSE,
  external_side_effect BOOLEAN NOT NULL DEFAULT FALSE,
  prerequisites JSONB,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  provider_receipt TEXT,
  terminal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id, effect_key)
);
CREATE INDEX IF NOT EXISTS inbound_request_effects_state_idx
  ON inbound_request_effects (state, next_attempt_at);

CREATE TABLE IF NOT EXISTS inbound_assignment_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES inbound_requests(id) ON DELETE CASCADE,
  decision_ordinal INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  assigned_to TEXT,
  reason_code TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  policy_hash TEXT NOT NULL CHECK (policy_hash ~ '^[0-9a-f]{64}$'),
  territory TEXT,
  capacity_snapshot JSONB,
  service_hours_snapshot JSONB,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  prior_assignee TEXT,
  fence INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id, decision_ordinal)
);
CREATE INDEX IF NOT EXISTS inbound_assignment_decisions_request_idx
  ON inbound_assignment_decisions (request_id, created_at);

CREATE TABLE IF NOT EXISTS inbound_request_work_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES inbound_requests(id) ON DELETE CASCADE,
  work_type TEXT NOT NULL CHECK (work_type IN ('task', 'ticket')),
  task_id INTEGER REFERENCES tasks(id),
  ticket_id INTEGER REFERENCES tickets(id),
  command_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id, work_type),
  CHECK ((work_type = 'task' AND task_id IS NOT NULL AND ticket_id IS NULL)
      OR (work_type = 'ticket' AND ticket_id IS NOT NULL AND task_id IS NULL))
);
