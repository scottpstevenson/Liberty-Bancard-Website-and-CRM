---
name: SLA task idempotency design
description: Architecture for preventing duplicate SLA stalling-deal tasks via stable identity columns, a partial unique index, and a conflict-safe insert.
---

## Rule
The `tasks` table has `source text` and `automation_key text` columns. A partial unique index `tasks_sla_stalling_active_unique` on `(deal_id, automation_key) WHERE deleted_at IS NULL AND completed_at IS NULL AND deal_id IS NOT NULL AND source = 'sla' AND automation_key = 'stalling-deal-follow-up'` enforces one active+incomplete SLA stalling task per deal.

## Key invariants
- `source` and `automationKey` are excluded from `insertTaskSchema` (cannot reach DB via public API)
- `InternalTaskInsert = InsertTask & { source?, automationKey? }` — server-internal only
- `updateTask()` uses an explicit whitelist; provenance fields cannot be mutated through `updateTask`
- All task status/completedAt changes go through `normalizeTaskCompletionState()` in `server/services/task-normalization.ts`
- The SLA worker uses a single bulk query per cycle (not N+1) to build the set of blocked deal IDs

## Transitional legacy branch (Phase 1–2)
The pre-check dual-matches: canonical `source='sla' AND automation_key='stalling-deal-follow-up'` OR legacy exact title `Follow up on stalling Deal #<dealId>` with `source IS NULL`. Remove the legacy branch ONLY after running `scripts/backfill-sla-task-identity.ts` in production and verifying:
```sql
SELECT COUNT(*) FROM tasks
WHERE title ~ '^Follow up on stalling Deal #[0-9]+$'
  AND source IS NULL AND deleted_at IS NULL AND completed_at IS NULL;
-- must return 0 before migration 0054 (index) is applied in production
```

## Deployment order
1. Migration 0053 (source/automation_key columns) + all Phase 1 code — deploy
2. Run `scripts/backfill-sla-task-identity.ts` in production — verify COUNT = 0
3. Migration 0054 (partial unique index) — apply manually / via next deploy
4. Phase 4 code (`createStallingDealFollowUpTask` with ON CONFLICT) — already deployed; becomes effective after step 3

## Relevant files
- `server/services/task-normalization.ts` — normalization utility
- `server/storage/tasks.ts` — createTask, updateTask, createStallingDealFollowUpTask
- `server/services/sla-worker.ts` — bulk pre-check, uses createStallingDealFollowUpTask
- `scripts/backfill-sla-task-identity.ts` — Phase 2 backfill script
- `scripts/test-task-invariants.ts` — 8 invariant tests (run before Phase 3)
- `scripts/test-sla-task-idempotency.ts` — 5 Phase 4 concurrency tests

**Why:** Pure title-based dedup fails when tasks are completed/reopened. Stable identity columns + a partial unique index on `completed_at IS NULL` give a DB-level guarantee that only one active stalling task exists per deal.
