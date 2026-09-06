-- Migration 0224: Durable bulk-delete snapshots and operation records (#1784)
-- bulk_delete_snapshots: frozen selection snapshots for the governed hard-delete workflow
-- bulk_delete_operations: durable idempotency records with DB-enforced uniqueness

CREATE TABLE IF NOT EXISTS bulk_delete_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id text NOT NULL,
  contact_ids integer[] NOT NULL,
  filter_params jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE TABLE IF NOT EXISTS bulk_delete_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key uuid NOT NULL,
  actor_user_id text NOT NULL,
  snapshot_id uuid REFERENCES bulk_delete_snapshots(id),
  preview_id text,
  status text NOT NULL DEFAULT 'pending',
  eligible_count integer,
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bulk_delete_operations_idempotency_unique UNIQUE (idempotency_key, actor_user_id)
);

CREATE INDEX IF NOT EXISTS bulk_delete_snapshots_actor_idx ON bulk_delete_snapshots (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bulk_delete_operations_actor_idx ON bulk_delete_operations (actor_user_id, created_at DESC);
