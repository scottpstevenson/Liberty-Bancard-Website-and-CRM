-- CR-05 additive task/ticket authority. Legacy rows remain readable through
-- status compatibility; defaults apply only to new authoritative commands.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS producer text,
  ADD COLUMN IF NOT EXISTS issue_key text,
  ADD COLUMN IF NOT EXISTS subject_type text,
  ADD COLUMN IF NOT EXISTS subject_id integer,
  ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS canonical_assignee text,
  ADD COLUMN IF NOT EXISTS command_key text,
  ADD COLUMN IF NOT EXISTS authority_fence integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS terminal_reason text,
  ADD COLUMN IF NOT EXISTS authority_state text NOT NULL DEFAULT 'open';

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_authority_state_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_authority_state_check
  CHECK (authority_state IN ('open', 'in_progress', 'completed', 'cancelled'));

CREATE UNIQUE INDEX IF NOT EXISTS tasks_command_key_uidx
  ON tasks(command_key) WHERE command_key IS NOT NULL;
DROP INDEX IF EXISTS tasks_active_authority_issue_uidx;
CREATE UNIQUE INDEX tasks_active_authority_issue_uidx
  ON tasks(producer, issue_key, subject_type, subject_id)
  WHERE producer IS NOT NULL
    AND issue_key IS NOT NULL
    AND authority_state IN ('open', 'in_progress');
CREATE INDEX IF NOT EXISTS tasks_subject_identity_idx
  ON tasks(subject_type, subject_id, generation);

CREATE TABLE IF NOT EXISTS task_authority_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  event_type text NOT NULL,
  producer text NOT NULL,
  command_key text,
  fence integer NOT NULL,
  from_state text,
  to_state text,
  terminal_reason text,
  payload jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS task_authority_events_task_key_uidx
  ON task_authority_events(task_id, event_key);
CREATE INDEX IF NOT EXISTS task_authority_events_task_created_idx
  ON task_authority_events(task_id, created_at);

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS producer text,
  ADD COLUMN IF NOT EXISTS issue_key text,
  ADD COLUMN IF NOT EXISTS subject_type text,
  ADD COLUMN IF NOT EXISTS subject_id integer,
  ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS canonical_assignee text,
  ADD COLUMN IF NOT EXISTS command_key text,
  ADD COLUMN IF NOT EXISTS authority_fence integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS terminal_reason text,
  ADD COLUMN IF NOT EXISTS authority_state text NOT NULL DEFAULT 'open';

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_authority_state_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_authority_state_check
  CHECK (authority_state IN ('open', 'in_progress', 'completed', 'cancelled'));

CREATE UNIQUE INDEX IF NOT EXISTS tickets_command_key_uidx
  ON tickets(command_key) WHERE command_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS tickets_subject_identity_idx
  ON tickets(subject_type, subject_id, generation);
DROP INDEX IF EXISTS tickets_active_authority_subject_uidx;
CREATE UNIQUE INDEX tickets_active_authority_subject_uidx
  ON tickets(producer, issue_key, subject_type, subject_id)
  WHERE producer IS NOT NULL
    AND issue_key IS NOT NULL
    AND authority_state IN ('open', 'in_progress');

CREATE TABLE IF NOT EXISTS ticket_authority_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id integer NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  event_type text NOT NULL,
  producer text NOT NULL,
  command_key text,
  fence integer NOT NULL,
  from_state text,
  to_state text,
  terminal_reason text,
  payload jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ticket_authority_events_ticket_key_uidx
  ON ticket_authority_events(ticket_id, event_key);
CREATE INDEX IF NOT EXISTS ticket_authority_events_ticket_created_idx
  ON ticket_authority_events(ticket_id, created_at);