---
name: BullMQ startup job deduplication
description: Static jobId on startup jobs causes BullMQ to silently skip re-adding them when a stale failed/completed job with the same ID exists in Redis.
---

# BullMQ Startup Job Deduplication

## The Rule
Never use a static `jobId` on one-off startup jobs added via `queue.add()`. BullMQ deduplicates by jobId — if a job with that ID exists in Redis (completed, failed, or delayed), the new `queue.add()` call is silently ignored.

**Why:** In `setupRepeatableJobs()`, each queue added a startup job with `jobId: \`${config.name}-startup\``. A `sequences-startup` job that failed months ago was retained in Redis (`removeOnFail: { count: 200 }`). Every subsequent server restart silently skipped adding the sequences startup job, so the sequence worker never ran immediately on startup.

**How to apply:** For one-off startup jobs that need to fire on every restart, omit the `jobId` entirely — BullMQ assigns a unique random ID and never deduplicates. Only use static `jobId` when deduplication IS desired (e.g., preventing the same job from being queued twice by concurrent API calls).

## Fix Applied
`server/services/queue-manager.ts` `setupRepeatableJobs()` — removed `jobId: \`${config.name}-startup\`` from the one-off startup job addition.
