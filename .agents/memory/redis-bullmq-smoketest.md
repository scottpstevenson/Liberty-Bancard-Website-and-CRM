---
name: Redis BullMQ smoke-test pattern
description: Why a ping probe is required before handing a ConnectionOptions to BullMQ when WRONGPASS is possible.
---

## The Rule
Before returning a `ConnectionOptions` object to BullMQ, always open a temporary `ioredis` client, call `connect()` then `ping()`, and close it. If the ping throws (WRONGPASS, ECONNREFUSED, etc.), **throw** the error so callers can handle fallback logic.

## Why
BullMQ accepts the `ConnectionOptions` object without testing it. When credentials are wrong, every queue worker emits a `WRONGPASS` error on each operation — forever. The server's `getQueueManager().catch(...)` fallback in `server/index.ts` only runs if `getQueueManager()` itself throws, which it won't unless something upstream throws first. Without the smoke test, the setInterval fallback never fires and 7 workers spam the error log continuously.

## How to Apply
See `server/services/queue-connection.ts`. The probe uses `lazyConnect: true`, `connectTimeout: 5000`, `maxRetriesPerRequest: 1`, and `enableReadyCheck: false`. Disconnect in both `catch` and `finally` blocks to avoid dangling connections.

## Confirmed Working
After restart with bad REDIS_URL credentials, the log shows exactly one error line:
`[Queue] Failed to initialize BullMQ — falling back to setInterval workers: Redis connection smoke-test failed (WRONGPASS...)` followed immediately by `SLA Worker started`.
