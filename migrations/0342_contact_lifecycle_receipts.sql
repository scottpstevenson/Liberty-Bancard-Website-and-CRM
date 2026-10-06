CREATE TABLE IF NOT EXISTS contact_lifecycle_receipts (
  actor_id varchar NOT NULL REFERENCES users(id),
  command_id uuid NOT NULL,
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,command_id)
);
