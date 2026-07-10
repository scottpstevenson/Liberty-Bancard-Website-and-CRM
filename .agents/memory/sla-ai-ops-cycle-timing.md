---
name: SLA AI Ops Cycle Timing
description: BullMQ cadence for runScheduledAiOps() and how to verify post-deploy clean cycles
---

## The cycle mechanics

`runFullSlaLoop()` is the BullMQ handler for the `sla-checks` queue.

- Dev BullMQ interval: **15 minutes** (`IS_DEV ? 15 * 60 * 1000 : 5 * 60 * 1000`)
- `FULL_LOOP_AI_OPS_EVERY_N = 2` — `runScheduledAiOps()` only fires when `fullLoopCycleCount % 2 === 0`
- `fullLoopCycleCount` starts at 0, increments at end of each loop, check happens AFTER increment
- So AI ops fires on counts 2, 4, 6... — i.e., every **2nd** BullMQ SLA tick = every ~30 min in dev

After a fresh app restart, timeline is:
- T+15 min: 1st tick → count=1 → no AI ops
- T+30 min: 2nd tick → count=2 → **first** `scheduled_ai_ops` audit entry
- T+45 min: 3rd tick → no AI ops
- T+60 min: 4th tick → **second** `scheduled_ai_ops` audit entry

## How to verify post-deploy clean cycles

```sql
SELECT action, details->>'tasksGenerated' as tasks, created_at
FROM audit_logs
WHERE action = 'scheduled_ai_ops' AND created_at >= '<deploy_time>'
ORDER BY created_at ASC;
```

Requires **2 rows** with `tasks = '0'` (or low count) to prove no runaway duplicates.

**Why:** Before the always-on audit log fix, a zero-task cycle wrote NO entry — making it impossible to prove cycles ran. The fix: always write the audit entry even for 0-task runs.

## startSlaWorker() vs BullMQ

`startSlaWorker()` (setInterval) is only used as a Redis fallback. When BullMQ is active (Redis connected), the setInterval path is NOT started. The BullMQ path calls `runFullSlaLoop()` → `runScheduledAiOps()` on even cycles only.

The 30-second startup burst in `startSlaWorker()` (line ~978) only calls `runSlaCheck()`, NOT AI ops.

## Re-entrancy guard

`_aiOpsRunning` (module-level boolean in sla-worker.ts) prevents concurrent `runScheduledAiOps()` calls within the same process. Not needed across processes (single-process deployment). Guard releases in `finally {}`.
