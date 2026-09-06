---
name: pool.connect() wrapper danger
description: Why wrapping pool.connect() to intercept client.release() is unsafe in pg-pool, and what to do instead.
---

# pool.connect() wrapper — why it breaks and what to do instead

## The rule
**Never wrap `pool.connect()` to intercept `client.release()`.** Only wrap `pool.query()` for observability.

## Why
pg-pool recycles physical `PoolClient` objects. On every checkout, pg-pool sets `client.release` to a **fresh, checkout-scoped function** that knows the exact state of that checkout (idleListener, etc.).

If you do `const _origRelease = client.release.bind(client); client.release = observedRelease` and the same physical client is returned to the pool and re-checked out, then on the next checkout `client.release` is still your old `observedRelease` wrapper. `_origRelease` from that checkout captures `observedRelease` (not the fresh pg-pool release), creating a chain that eventually calls the real pool release multiple times (double-release) — or calls the stale release from a prior checkout, which pg-pool detects and throws `"Release called on client which has already been released to the pool."`.

## What happened in practice
Task agent #1809 added a `pool.connect()` wrapper that set up per-checkout `client.release` and `client.query` wrappers. On recycled connections (the second or third checkout of the same physical client), the double-release caused a permanent connection leak. The connection was counted as checked-out by the pool but was actually idle, so subsequent `pool.connect()` calls would wait forever for a free slot, hanging the server startup indefinitely.

**How:** `db:long_transaction` warnings fired at startup (Phase 3 check, then seedKnowledgeBase), server never opened port 5000.

## The fix
- Removed the `pool.connect()` wrapper entirely from `server/db.ts`.
- Kept the `pool.query()` wrapper (safe — doesn't mutate client internals).
- Added 60-second deadline in `scripts/migrate.ts` and `server/index.ts` around `runDrizzleMigrations()` as defense against future post-migration helpers that hang.

## How to apply
Any time someone proposes a `pool.connect()` wrapper that touches `client.release` or `client.query`, refuse it. The `pool.query()` wrapper is the safe alternative; it covers the vast majority of Drizzle ORM calls.
