---
name: NBA test hold isolation fix
description: How test-nba.ts was fixed to not accumulate coordinator holds or advance the pause epoch across pre-deploy runs.
---

# NBA Test Hold Isolation Fix

## The Bug
`scripts/test-nba.ts` called `applyPauseMutation({ outboundGlobalPaused: false })` at setup
and `applyPauseMutation({ outboundGlobalPaused: true })` in teardown. Each call goes through
the full coordinator machinery, which:
1. Advances the `outbound_pause_control.epoch`
2. Creates `logical_job_control_holds` rows (17 per call, one per logical job key)
3. Does NOT release those holds in `finally`

Each pre-deploy run accumulated 34 orphaned holds (17 `release_pending` + 17 `global_outbound`).

## The Fix
Replace `applyPauseMutation` calls in the test script with a direct DB write helper
that bypasses the coordinator entirely:

```ts
import { pool } from "../server/db";
import { invalidatePauseStateCache } from "../server/services/outbound-pause-authority";

async function setTestPauseState(paused: boolean): Promise<void> {
  const state = paused ? "paused" : "unpaused";
  await pool.query(`UPDATE outbound_pause_control SET state = $1`, [state]);
  invalidatePauseStateCache(); // CRITICAL: authority has a 5-second in-process TTL cache
}
```

**Why:** Direct DB update sets `outbound_pause_control.state` exactly like `applyPauseMutation`
does for the authority check (NBA service reads `authorize()` → `readFromDb()`), but without:
- Creating coordinator holds
- Advancing the epoch
- Triggering the coordinator's hold lifecycle machinery

**Why `invalidatePauseStateCache` is required:** `OutboundPauseAuthority` caches the pause state
with a 5-second TTL (`_cache`). If you update the DB and immediately call `computeNBA`,
the cache still returns the old state. `applyPauseMutation` calls `invalidatePauseStateCache`
after committing — the direct update must too, or Case 6 (global pause → BLOCKED) fails silently.

## Snapshot + Assertion Pattern
```ts
// Before try block — snapshot pre-test state
const preState = await pool.query(`SELECT state, epoch::text FROM outbound_pause_control ORDER BY id LIMIT 1`);
const preHolds = await pool.query(`SELECT hold_id FROM logical_job_control_holds WHERE active = true`);
const preHoldIds = new Set(preHolds.rows.map(r => r.hold_id));
const preEpoch = preState.rows[0]?.epoch ?? "0";
const preWasPaused = preState.rows[0]?.state !== "unpaused";

// In finally — after teardown, assert isolation:
const postState = await pool.query(`SELECT state, epoch::text FROM outbound_pause_control ORDER BY id LIMIT 1`);
const postHolds = await pool.query(`SELECT hold_id FROM logical_job_control_holds WHERE active = true`);
const newHolds = postHolds.rows.filter(r => !preHoldIds.has(r.hold_id));

ok("[isolation] pause state restored", postState.rows[0]?.state === preState.rows[0]?.state);
ok("[isolation] epoch not advanced", postState.rows[0]?.epoch === preEpoch);
ok("[isolation] no new active coordinator holds", newHolds.length === 0);
```

## Why the 34 Orphaned Holds Were Caught Here
The `NBAService.computeNBA` checks BOTH:
1. `OutboundPauseAuthority.authorize()` — reads `outbound_pause_control.state`
2. `canExecute("nba-service")` from the coordinator — if ANY `global_outbound` hold is active
   for ANY logical job key, this returns false and the NBA returns BLOCKED

Active coordinator holds from the old test-nba.ts teardown caused ALL contacts to compute
as BLOCKED, hiding their lifecycle-based reasonCodes. Cleaning the 34 holds restored
Cases 10 (priority queue) and 11 (appointment_pending reason code) which had been silently
failing for this reason.

## Coordinator Operational Holds
After cleanup, the coordinator re-initializes with 17 `global_outbound` holds at a new epoch
when it detects state=paused with no active holds. These are LEGITIMATE holds — they represent
the coordinator's pause enforcement state and are stable across runs (not accumulative).
Do not confuse these with the test-created orphaned holds.
