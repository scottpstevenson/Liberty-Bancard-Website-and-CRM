---
name: DB connection pool saturation from background worker count
description: Why the dev app can show system-wide 500s/timeouts on unrelated endpoints even when Postgres itself is healthy, and how to tell the difference from a real regression.
---

## Symptom
Every request (including completely unrelated endpoints, and both authenticated and anonymous ones) starts failing with Drizzle/pg errors like "timeout exceeded when trying to connect" or "Connection terminated due to connection timeout", while background BullMQ workers simultaneously log the same errors for unrelated queues (ghl-sync, sunbiz-cron, enrichment, chargeback-commands, etc). This can persist for many minutes and survive a full workflow restart.

## Root cause
`server/db.ts` caps the pool at `DB_POOL_MAX` (default 20), but this app runs ~29 BullMQ workers plus the web server sharing that single pool. At rest, background workers alone can already hold ~20+ connections, leaving little or no headroom for real request traffic — so any burst of additional load (a smoke-test script, a traffic spike) tips it into pool exhaustion. Restarting the workflow does not fix this: it re-triggers a thundering herd of ~29 workers reconnecting at once, which can make the contention window worse, not better.

**Why:** the DB backend itself is not degraded — a short-lived, isolated `pg.Pool` connection to the same `DATABASE_URL` typically responds in 20-30ms even while the app's own pool is timing out. That gap is the tell.

**How to apply:** before concluding a session's request failures are a real code regression, open a one-off `pg.Pool` (or `psql`) connection outside the app process and time a trivial query. If that's fast while the app is timing out, and the failures span endpoints/workers unrelated to your change, treat it as pool contention, not a logic bug — don't keep restarting the workflow to chase it, since each restart can re-trigger the herd. Consider it a candidate for raising `DB_POOL_MAX` or reducing concurrent worker count as separate infra work, not something a feature-scoped code change should try to fix.
