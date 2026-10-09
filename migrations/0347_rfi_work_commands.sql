ALTER TABLE rfis ADD COLUMN IF NOT EXISTS authority_fence integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS rfi_command_receipts (
  actor_id varchar NOT NULL REFERENCES users(id),
  command_id uuid NOT NULL,
  rfi_id integer NOT NULL REFERENCES rfis(id),
  operation text NOT NULL CHECK (operation IN ('create','edit')),
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, command_id)
);
