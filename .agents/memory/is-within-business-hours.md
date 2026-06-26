---
name: isWithinBusinessHours currentTime threading
description: voice-orchestrator.ts isWithinBusinessHours() ignored ContactabilityInput.currentTime — caused flaky manual_call test failures at night/weekends.
---

## The Rule
Any test that asserts `manual_call` is **allowed** must pass a forced business-hours `currentTime` to `evaluateContactability()`. Use `new Date("2025-06-24T14:00:00.000Z")` (Tuesday 10 AM ET, EDT = UTC-4).

**Why:** `isWithinBusinessHours(timezone)` in `server/services/sdr/voice-orchestrator.ts` hardcoded `new Date()` internally and never accepted a time override. `evaluateContactability` captured `input.currentTime` at the top but passed nothing to `isWithinBusinessHours`, so quiet-hours TCPA checks always used wall-clock time — causing `manual_call` "allowed" assertions to pass during the day and fail at night or on weekends.

**Fix applied:** Added optional `now: Date = new Date()` parameter to `isWithinBusinessHours` and threaded `currentTime` through the quiet-hours check in `contactability.ts` (line ~721: `isWithinBusinessHours(tz, currentTime)`).

## How to Apply
- Every `evaluateContactability({ channel: "manual_call", ... })` call that **expects `allowed: true`** must include `currentTime: new Date("2025-06-24T14:00:00.000Z")`.
- Calls that expect `allowed: false` (DNC, doNotContact, consent blocks) do **not** need forced time — those blocks fire before the quiet-hours check.
- Files patched: `scripts/test-contactability.ts` (4 sites), `scripts/test-sequence-compliance.ts` (1 site).
- Any new test asserting manual_call is allowed should follow the same pattern.
