-- Partner program repair: staff decisions on introductions, append-only review history, and durable introduction
-- completion checkpoints. Additive: one new table, new nullable/defaulted columns on partner_introductions, two NOT VALID
-- check constraints and one bounded checkpoint backfill for introductions the previous code already linked to a contact.
-- Nothing is sent and nothing is enabled. A code rollback may leave all of it in place.
--
-- partner_review_events: one row per staff transition on a partner application or introduction. The row is written in
-- the same transaction as the transition (decision, needs-information, reopen), so the actor, time, note and the
-- before/after status and revision can never be missing from a committed transition. The service only INSERTs and
-- SELECTs this table; no code path updates or deletes a row.
CREATE TABLE IF NOT EXISTS partner_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  event_type text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  from_revision integer,
  to_revision integer,
  actor_id text NOT NULL,
  note text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_review_events_subject_chk CHECK (subject_type IN ('application', 'introduction'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_review_events_subject_idx ON partner_review_events (subject_type, subject_id, created_at, id);
--> statement-breakpoint
-- partner_introductions: a compare-and-set revision for staff decisions, the decision evidence, and one durable
-- checkpoint per local completion step (contact, referral, review notification, referral count). A step is complete only
-- when its checkpoint is set; the recovery sweep resumes any introduction whose completion_state is not 'complete'.
ALTER TABLE partner_introductions ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE partner_introductions ADD COLUMN IF NOT EXISTS decided_by text;
--> statement-breakpoint
ALTER TABLE partner_introductions ADD COLUMN IF NOT EXISTS decided_at timestamptz;
--> statement-breakpoint
ALTER TABLE partner_introductions ADD COLUMN IF NOT EXISTS decision_note text;
--> statement-breakpoint
ALTER TABLE partner_introductions ADD COLUMN IF NOT EXISTS completion_state text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE partner_introductions ADD COLUMN IF NOT EXISTS contact_checkpoint_at timestamptz;
--> statement-breakpoint
ALTER TABLE partner_introductions ADD COLUMN IF NOT EXISTS referral_checkpoint_at timestamptz;
--> statement-breakpoint
ALTER TABLE partner_introductions ADD COLUMN IF NOT EXISTS notification_checkpoint_at timestamptz;
--> statement-breakpoint
ALTER TABLE partner_introductions ADD COLUMN IF NOT EXISTS count_checkpoint_at timestamptz;
--> statement-breakpoint
ALTER TABLE partner_introductions ADD COLUMN IF NOT EXISTS completion_attempts integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE partner_introductions ADD COLUMN IF NOT EXISTS completion_last_attempt_at timestamptz;
--> statement-breakpoint
ALTER TABLE partner_introductions ADD COLUMN IF NOT EXISTS completion_error_code text;
--> statement-breakpoint
-- Introductions the previous code had already linked to a contact: that code created the contact, the referral and the
-- partner's total in order (the total increment was best-effort), so those three steps are recorded as done and a
-- recovery pass never increments a total twice. The review notification is recorded as done only where it actually
-- exists; where it is missing the row stays pending and the recovery sweep creates it. Rows without a contact stay
-- pending and resume from the first step. Bounded by the (small) table; idempotent.
UPDATE partner_introductions pi SET
  contact_checkpoint_at = COALESCE(pi.contact_checkpoint_at, pi.updated_at),
  referral_checkpoint_at = COALESCE(pi.referral_checkpoint_at, pi.updated_at),
  count_checkpoint_at = COALESCE(pi.count_checkpoint_at, pi.updated_at),
  notification_checkpoint_at = COALESCE(pi.notification_checkpoint_at, (
    SELECT n.created_at FROM notifications n WHERE n.command_key = 'partner-introduction:' || pi.id::text || ':review' LIMIT 1
  ))
WHERE pi.contact_id IS NOT NULL AND pi.completion_state = 'pending' AND pi.contact_checkpoint_at IS NULL;
--> statement-breakpoint
UPDATE partner_introductions SET completion_state = 'complete'
WHERE completion_state = 'pending' AND contact_checkpoint_at IS NOT NULL AND referral_checkpoint_at IS NOT NULL
  AND count_checkpoint_at IS NOT NULL AND notification_checkpoint_at IS NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_introductions_completion_chk') THEN
    ALTER TABLE partner_introductions ADD CONSTRAINT partner_introductions_completion_chk
      CHECK (completion_state IN ('pending', 'held', 'complete')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_introductions_decision_chk') THEN
    ALTER TABLE partner_introductions ADD CONSTRAINT partner_introductions_decision_chk
      CHECK (review_state NOT IN ('accepted', 'declined') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_introductions_completion_idx ON partner_introductions (completion_last_attempt_at NULLS FIRST, created_at) WHERE completion_state <> 'complete';
