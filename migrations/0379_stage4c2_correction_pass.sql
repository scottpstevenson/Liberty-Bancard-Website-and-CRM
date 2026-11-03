-- Stage 4C2 correction pass. Additive only; 0374-0378 are applied and are not edited.
-- Workflow runs keep the minimum authoritative inputs they started with, so a resume never re-derives them from the entity id.
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS input_context jsonb;
--> statement-breakpoint
-- A command receipt is bound to the reviewed request it was created for; the same key with a different request is refused before I/O.
ALTER TABLE followup_effect_receipts ADD COLUMN IF NOT EXISTS request_fingerprint text;
--> statement-breakpoint
ALTER TABLE followup_effect_receipts ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 1;
