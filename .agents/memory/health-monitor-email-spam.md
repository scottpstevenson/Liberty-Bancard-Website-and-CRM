---
name: HealthMonitor email spam fixes
description: Three bugs that caused repeated critical-failure emails from the health monitor; all fixed.
---

# HealthMonitor email spam — root causes and fixes

## The bugs

### 1. Critical alert had zero cooldown
`health-monitor.ts` lines 474–505 (original): the "critical check newly failed" email had no rate-limit.  
Any time a critical check (db, sequenceWorker, redis, kpiQuery) transitioned from ok/stale/unknown → any bad status, an email fired unconditionally.  
If the check oscillated (ok→error→ok→error), one email per oscillation, flooding the inbox.

**Fix:** Added 1-hour cooldown via system_settings key `health_monitor_critical_alert_at` (same pattern as the existing low-ok alert).

### 2. `checkDb()` used `COUNT(*)` — vulnerable to statement_timeout
`checkDb()` ran `SELECT COUNT(*) FROM contacts / deals / follow_up_sequences` against the pool, which has `statement_timeout=30000` on every connection.  
Under production load, this timed out → `db` status = `error` (db is a critical check!) → transition email fired.

**Fix:** Replaced `COUNT(*)` with `pg_class.reltuples` approximate counts (same approach as `checkKpiQuery`). Now `checkDb` can never time out due to a slow scan.

### 3. `buildDumpUrl` encoded spaces as `+`, breaking pg_dump
`URLSearchParams.set("options", "-c statement_timeout=0")` encodes the space as `+`.  
PostgreSQL/libpq does not decode `+` as space in the connection-string `options` parameter — it treated it as a literal `+` sign, producing `"+statement_timeout"` → `FATAL: unrecognized configuration parameter "+statement_timeout"`.  
This broke DB backups for 231+ hours.

**Fix:** Manually build the options query param using `.replace(/ /g, "%20")` instead of letting URLSearchParams encode it.

## Key rule
Any time `URLSearchParams` is used to set a value that PostgreSQL will parse (e.g. `options=` in a libpq connection string), use manual `%20` encoding for spaces — `URLSearchParams` always uses `+` which libpq rejects.

## Files changed
- `server/services/health-monitor.ts` — checkDb() rewrite + critical-alert cooldown
- `server/services/db-backup.ts` — buildDumpUrl() %20 fix
