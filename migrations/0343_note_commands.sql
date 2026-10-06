ALTER TABLE notes ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_at timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS note_command_receipts (
  actor_id varchar NOT NULL REFERENCES users(id),
  command_id uuid NOT NULL,
  note_id integer NOT NULL REFERENCES notes(id),
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,command_id)
);
