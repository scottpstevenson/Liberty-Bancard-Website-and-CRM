---
name: BullMQ commandTimeout removal + shared IORedis singleton
description: commandTimeout must be ABSENT from BullMQ IORedis configs; singleton shared connection keeps count under Upstash free tier
---

# Rule
Never set `commandTimeout` on the IORedis instance passed to BullMQ. Use a single shared
`IORedis` singleton — do NOT pass `ConnectionOptions` directly to Queue/Worker constructors.

**Why:** With 11 queues × 3 ConnectionOptions (Queue + Worker + QueueEvents per queue) = 33
connections. Upstash free tier cap is 20. When the cap is exceeded, ioredis queues commands
in its offline queue. `commandTimeout: 10_000` then fires on every queued command, producing
a "Command timed out" storm in both dev and prod — every BullMQ tick fails.

**Why commandTimeout specifically causes this:** commandTimeout fires per-command whether the
connection is over-capacity or simply retrying. BullMQ uses `maxRetriesPerRequest: null` which
means ioredis retries indefinitely — commandTimeout and maxRetriesPerRequest:null are
incompatible. The correct pattern is to let BullMQ's own job-level backoff handle failures.

# How to apply
- `getRedisConnection()` in `server/services/queue-connection.ts` creates ONE singleton
  `IORedis` instance (not `ConnectionOptions`).
- Pass it to `new Queue(name, { connection })` and `new Worker(name, fn, { connection })`.
- BullMQ internally calls `.duplicate()` on the shared client for blocking operations —
  this is the correct shared pattern per BullMQ docs.
- Connection count formula: **1 shared + 1 per Worker** = 1 + 11 = 12 for production.
  (QueueEvents are not used; Queue clients re-use the shared connection.)
- Upstash free tier: 20 connections max. 12 is safely under the limit.
- Old formula (ConnectionOptions per construct): 11 × 3 = 33 → exceeds limit → storm.

# Required IORedis options for BullMQ
```ts
maxRetriesPerRequest: null,  // required by BullMQ
enableReadyCheck: false,      // required by BullMQ
// commandTimeout intentionally OMITTED — see above
```

# Test coverage
- `scripts/test-redis-reconnect.ts` — 26 checks; asserts commandTimeout ABSENT and
  validates 1+N formula, documents old formula exceeds Upstash limit.
- `scripts/test-bullmq-resilience.ts` — `testConnectionCount()` suite (46 total checks).
