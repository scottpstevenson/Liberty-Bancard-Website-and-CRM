---
name: executeSql DDL timeout + migration lock contention
description: executeSql tool times out on DDL against large tables; crashed startup migrations leave exclusive locks that block subsequent attempts.
---

## The Rule
`executeSql` has a short per-call timeout that fires before DDL (CREATE INDEX, large DELETE) completes on tables with millions of rows. If the app startup migration runner also hangs on the same DDL, it leaves an exclusive lock on the table that blocks any subsequent attempt — even from executeSql.

## Why
- `sunbiz_entities` has ~1.9M rows with no index on `prospect_id`. Any migration that DELETEs from `prospects` must check that FK for every row — O(N) sequential scan × rows deleted = timeout.
- When the app's `db-migrate.ts` hangs mid-migration, it exits without committing, but the PostgreSQL session may linger with unreleased row/table locks (state=`disabled` in pg_stat_activity, wait_event=`Lock`).
- Subsequent `executeSql` CREATE INDEX calls wait indefinitely for the lock and also time out.

## How to Apply
1. **Check for locks first**: `SELECT pid, state, wait_event_type FROM pg_stat_activity WHERE state != 'idle'`
2. **Terminate blockers**: `SELECT pg_terminate_backend(<pid>)` for each stuck pid.
3. **Retry DDL via executeSql** after terminating — it should succeed immediately if no other lock holders remain.
4. **Prevent the root cause**: If a migration involves a large FK-checking DELETE, first add an index on the FK column in the same migration (`CREATE INDEX IF NOT EXISTS` before `DELETE`).
5. **Alternative**: If the DDL is still too slow for executeSql timeout, apply it manually, insert the migration hash into `drizzle.__drizzle_migrations`, then re-add the journal entry — the app's auto-migrate will skip it on next startup.

## Recovery Pattern
```
-- 1. Find blockers
SELECT pid, state, wait_event_type FROM pg_stat_activity WHERE state != 'idle';

-- 2. Kill them
SELECT pg_terminate_backend(<pid>);

-- 3. Verify no more locks, then retry DDL
SELECT pg_terminate_backend(<pid>) FROM pg_stat_activity WHERE state != 'idle' AND pid != pg_backend_pid();
```
