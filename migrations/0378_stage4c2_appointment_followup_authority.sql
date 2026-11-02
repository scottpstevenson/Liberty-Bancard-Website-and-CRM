-- Stage 4C2 appointment and follow-up authority. Additive only; 0374-0377 are applied and are not edited.
-- 1) A provider no-show is its own terminal appointment status, and the open-appointment pool the current meeting is
--    derived from needs an index on (contact, start time).
ALTER TABLE ghl_appointment_state DROP CONSTRAINT IF EXISTS ghl_appointment_state_status_chk;
--> statement-breakpoint
ALTER TABLE ghl_appointment_state ADD CONSTRAINT ghl_appointment_state_status_chk
  CHECK (status IN ('booked', 'rescheduled', 'updated', 'showed', 'canceled', 'no_show'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ghl_appointment_state_open_idx ON ghl_appointment_state (ghl_contact_id, start_time)
  WHERE status NOT IN ('showed', 'canceled', 'no_show');
--> statement-breakpoint
-- 2) Workflow runs: one run per (workflow, occurrence), a definition pin for resume, and a lease for due-run ownership.
--    The 455 legacy rows keep NULLs (historical only; never replayed or rewritten).
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS occurrence_key text;
--> statement-breakpoint
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS input_pin text;
--> statement-breakpoint
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS lease_token text;
--> statement-breakpoint
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_occurrence_uidx ON workflow_runs (workflow_id, occurrence_key)
  WHERE occurrence_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workflow_runs_due_idx ON workflow_runs (next_run_at) WHERE status = 'waiting';
--> statement-breakpoint
-- 3) Durable per-channel send receipts for workflow steps, statement requests/reminders and application reminders.
--    Written as 'started' BEFORE the provider call; a later attempt never re-sends over 'accepted' or 'unknown'.
CREATE TABLE IF NOT EXISTS followup_effect_receipts (
  effect_key text PRIMARY KEY,
  owner_kind text NOT NULL,
  owner_id text NOT NULL,
  channel text NOT NULL,
  state text NOT NULL DEFAULT 'started',
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CONSTRAINT followup_effect_receipts_state_chk CHECK (state IN ('started', 'accepted', 'refused', 'unknown'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS followup_effect_receipts_owner_idx ON followup_effect_receipts (owner_kind, owner_id);
