ALTER TABLE follow_up_sequences ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE follow_up_sequences ADD COLUMN IF NOT EXISTS retired_at timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS sequence_command_receipts (
  actor_id varchar NOT NULL REFERENCES users(id),
  command_id uuid NOT NULL,
  sequence_id integer NOT NULL REFERENCES follow_up_sequences(id),
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,command_id)
);
