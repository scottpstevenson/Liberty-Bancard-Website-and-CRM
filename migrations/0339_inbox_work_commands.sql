ALTER TABLE inbox_items ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS inbox_action_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id integer NOT NULL REFERENCES inbox_items(id),
  actor_id varchar NOT NULL REFERENCES users(id),
  command_id uuid NOT NULL,
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS inbox_action_receipts_actor_command_uidx
  ON inbox_action_receipts(actor_id,command_id);
