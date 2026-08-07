---
name: Live health check dual implementation
description: The /api/admin/live-health route has its own INLINE health checks in admin.ts — completely separate from the functions in health-monitor.ts. Fixes to one do not affect the other.
---

# Live Health Check — Two Separate Implementations

## The Rule
When fixing a health check (e.g., `checkSequenceWorker`), you must fix BOTH locations:

1. **`server/services/health-monitor.ts`** — used by the BullMQ `HEALTH_MONITOR` queue worker and the startup health check (called via `runHealthChecks()`)
2. **`server/routes/admin.ts` around line 3380** — the `GET /api/admin/live-health` route handler has its OWN inline checks (db, sequenceWorker, slaWorker, ghlSync, redis, ai, dbBackup, kpiQuery, outboundPause) that are completely separate from `health-monitor.ts`

**Why:** The route was built independently from the background health monitor service. They diverged and now duplicate logic. The test script (`scripts/test-live-health.ts`) hits the API route — not the BullMQ health monitor — so admin.ts is the one that matters for the pre-deploy gate.

**How to apply:** Any change to health check thresholds, logic, or feature-flag gating must be applied to BOTH files. Search for the check name in both `server/services/health-monitor.ts` AND `server/routes/admin.ts`.

## Feature-flag gating pattern
When a worker is gated behind a feature flag (e.g., `LEGACY_OUTREACH_ENABLED`), the health check must return `ok` when the flag is off — otherwise the gate always fails in default/off configurations. Pattern:
```typescript
const { featureFlags } = await import("../services/feature-flags");
if (!featureFlags.LEGACY_OUTREACH_ENABLED) {
  seqStatus = "ok";
  seqDetail = "LEGACY_OUTREACH_ENABLED is off — worker intentionally idle";
} else {
  // check heartbeat timestamp
}
```
