---
name: Serper control mirror staleness
description: serper_control is authoritative for Serper's circuit/budget; provider_controls is only a best-effort mirror that can go stale.
---

`server/services/serper-gateway.ts`'s `serper_control` row (state, local_budget, window_calls, consecutive_failures) is the real circuit breaker and budget authority. `provider_controls.serper` is a secondary mirror kept in sync by `_mirrorCircuitState` on transitions, but it can lag — e.g. it showed a tiny stale `local_budget_units` (67, ~65 consumed) implying near-exhaustion/trip while the authoritative `serper_control.local_budget` was actually 50,000 with a healthy `closed` circuit and ample headroom.

**Why:** anything that reads readiness from `provider_controls` alone (e.g. SFP continuous-discovery readiness checks) can misdiagnose a healthy Serper as budget-exhausted or open, when only the mirror is out of date.

**How to apply:** before concluding Serper's circuit is open or its budget is low, check `serper_control` directly (state, consecutive_failures, local_budget, window_calls), not just `provider_controls`. To fix a stale mirror without resetting anything, use the existing admin route `POST /api/admin/serper/resync-budget-mirror` — it copies `serper_control.local_budget` into `provider_controls.local_budget_units` via GREATEST (never lowers, never touches consumed/reserved/circuit_state). Diagnosing "is the circuit really open" also requires checking `serper_control.state`/`consecutive_failures`/`last_success_at` directly — don't assume the mirror's `circuit_state` reflects the live state at query time.
