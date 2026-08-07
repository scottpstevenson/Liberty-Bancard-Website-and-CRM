---
name: CREATE INDEX CONCURRENTLY in Drizzle migrations
description: CONCURRENTLY is banned inside Drizzle's transaction-wrapped migrate(); causes production startup crash.
---

# CREATE INDEX CONCURRENTLY in Drizzle migrations

## The rule
Never use `CREATE INDEX CONCURRENTLY` inside a Drizzle-managed migration file. Drizzle's `migrate()` wraps every migration in a transaction, and Postgres rejects `CONCURRENTLY` inside a transaction with error code 25001 (`CREATE INDEX CONCURRENTLY cannot run inside a transaction block`).

**Why:** The production container runs `drizzle.migrate()` on startup. Any migration with CONCURRENTLY will throw an unhandled promise rejection and leave the server in a health-check failure loop until the blocking lock is terminated manually.

**How to apply:** Write `CREATE INDEX IF NOT EXISTS` (without CONCURRENTLY) in migration SQL files. The index still gets created; the only trade-off is a brief ShareLock on the table during the build — acceptable for a one-time startup migration.

If a truly online (zero-downtime) index build is ever needed, run `CREATE INDEX CONCURRENTLY` manually via psql outside the Drizzle migration flow, then add a no-op migration that documents the manual step.
