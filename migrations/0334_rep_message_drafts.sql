CREATE TABLE IF NOT EXISTS rep_message_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id varchar NOT NULL REFERENCES users(id),
  context_type text NOT NULL CHECK (context_type IN ('global', 'contact', 'prospect', 'inbox')),
  context_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'ghl_chat', 'voicemail', 'site')),
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  saved_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT rep_message_drafts_context_key UNIQUE (actor_id, context_type, context_id, channel)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS rep_message_draft_commands (
  actor_id varchar NOT NULL REFERENCES users(id),
  command_id uuid NOT NULL,
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, command_id)
);
