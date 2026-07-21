-- Phase 3: Partial unique index enforcing one active, incomplete SLA stalling-deal
-- follow-up task per deal.
--
-- DEPLOYMENT ORDER REQUIREMENT:
--   This migration MUST only be applied after the Phase 2 backfill script
--   (scripts/backfill-sla-task-identity.ts) has been run and verified:
--     SELECT COUNT(*) FROM tasks
--     WHERE title ~ '^Follow up on stalling Deal #[0-9]+$'
--       AND source IS NULL
--       AND deleted_at IS NULL
--       AND completed_at IS NULL;
--   must return 0 before applying this migration.
--
-- No IF NOT EXISTS per spec — pg_indexes must be verified post-migration.

CREATE UNIQUE INDEX tasks_sla_stalling_active_unique
ON tasks (deal_id, automation_key)
WHERE deleted_at IS NULL
  AND completed_at IS NULL
  AND deal_id IS NOT NULL
  AND source = 'sla'
  AND automation_key = 'stalling-deal-follow-up';
