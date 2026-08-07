---
name: Sequence worker runtime characteristics
description: processSequenceEnrollments() takes ~8 minutes against 155K contacts — longer than the dev 5-min and prod 30-sec repeat intervals. Jobs pile up.
---

# Sequence Worker Runtime

## Key Facts
- `processSequenceEnrollments()` takes **~8 minutes** with the current contact volume (~155K contacts, ~72 deals)
- Dev repeat interval: **5 minutes** → mild overlap (one job running when next starts)
- Prod repeat interval: **30 seconds** → severe pile-up immediately on startup
- The health check threshold for `sequenceWorker` is **15 minutes** — barely holds in dev, would hold in prod only because the 8-min run writes the heartbeat continuously

## Why This Matters
With concurrency=2 and an 8-min runtime, two startup jobs plus the repeat schedule create runaway queue depth in production. Follow-up task #1323 tracks the fix.

## The Heartbeat Pattern
`runSequencesTick()` has a `finally` block that writes `sequence_runner_last_tick` to `system_settings`. This always runs even on error. But `.catch(() => {})` silently swallows write failures — follow-up task #1324 tracks fixing this.

## Diagnosis Signals
- BullMQ `completed_jobs` list showing `processedOn` timestamps confirms jobs ARE running even when the heartbeat looks stale
- `active: N` count > 0 with elapsed > 60s means `processSequenceEnrollments()` is in-progress (not stalled)
- The startup health monitor logs `critical=4/4` because it runs AFTER the startup jobs complete and finds a fresh heartbeat
