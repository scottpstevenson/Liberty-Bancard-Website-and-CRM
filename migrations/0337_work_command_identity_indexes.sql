CREATE INDEX IF NOT EXISTS ticket_authority_events_command_idx ON ticket_authority_events(command_key) WHERE command_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS task_authority_events_command_idx ON task_authority_events(command_key) WHERE command_key IS NOT NULL;
