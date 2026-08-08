---
name: WizardFlags pool saturation
description: How wizard-flag-overrides.ts DB reads caused a log storm under enrichment load, and the fix applied.
---

## Problem
`startFlagCacheRefresh()` scheduled `hydrateAllFlags()` every 30 seconds.  Under heavy enrichment (200 contacts/run, each spawning several DB queries), the pool hit `connectionTimeoutMillis` (10 s default).  Each of the 7 concurrent flag reads logged a full `[WizardFlags] Failed to read override for X: Error: timeout exceeded` line — 7 errors every 30 s, flooding Sentry/logs.

## Fix (wizard-flag-overrides.ts)
1. **`CACHE_TTL_MS` raised to 5 minutes** — flags rarely change; polling every 30 s was wasteful.
2. **Per-read 2-second race timeout** — `Promise.race([dbPromise, timeoutPromise])` fails fast when the pool is saturated, releasing the connection slot immediately instead of waiting 10 s.
3. **Deduped warning counter (`_flagTimeoutCount`)** — logs only on first timeout, then every 20th, avoiding log spam while still being observable.

## Why
Timeout errors are expected during heavy enrichment and should fail-safe (callers fall back to hard-coded defaults).  Only the first occurrence (and occasional reminders) need to be logged.

## How to apply
If similar DB poll loops appear (health checks, feature-flag reads, cache warmers), apply the same pattern: long TTL + per-call race timeout + deduplicated error logging.
