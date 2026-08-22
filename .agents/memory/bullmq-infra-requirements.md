---
name: BullMQ infrastructure requirements
description: Critical Redis connection and Worker settings without which BullMQ jobs silently stall or lock-fail at scale.
---

## Required Redis connection options (ioredis)

```ts
maxRetriesPerRequest: null   // CRITICAL — BullMQ will never retry commands without this; jobs stall
enableReadyCheck: false       // Prevents startup delay on Upstash/TLS connections
keepAlive: 30000              // Prevents stale idle sockets from causing hangs
reconnectOnError: (err) => …  // Reconnect on ECONNRESET / ETIMEDOUT
retryStrategy: (times) => …   // Cap at 30 s
```

## Required Worker options

```ts
lockDuration: 120000         // Must be > longest job runtime (enrichment can take 60-90 s)
stalledInterval: 30000       // How often BullMQ checks for stalled jobs
maxStalledCount: 2           // Allow 2 stall recoveries before marking failed
```

**Why:** Without `maxRetriesPerRequest: null` BullMQ's internal ioredis calls throw on the first Redis hiccup and the worker dies. Without adequate `lockDuration`, a GHL fetch hang exhausts the lock before the job finishes, causing "could not renew lock" errors on every tick.

**How to apply:** Every new Queue and Worker created in `queue-manager.ts` must pass these options. Use `getQueueRedisConnection()` (which sets the ioredis options) for all BullMQ Queue/Worker constructors — never pass raw ioredis options inline.

## Disposable CI/test Redis isolation

Use BullMQ's `prefix` option on both Queue and Worker constructors for a test
namespace; never use ioredis `keyPrefix`, which breaks BullMQ's script-managed
keys. The pre-import test guard must verify the namespace with a prefixed
round-trip key before application imports.

**Why:** A nonempty `TEST_REDIS_PREFIX` environment variable alone does not
isolate queues. Also, the dev command explicitly runs with `NODE_ENV=development`
in CI, so test-only queue safety cannot rely on `NODE_ENV` alone.

**How to apply:** Treat either `NODE_ENV=test` or `CI=true` as an isolated
process and require a clearly test/CI-named prefix. Pass that prefix to every
BullMQ Queue and Worker. Keep normal development and production in the default
namespace unless explicitly configured otherwise.
