---
name: GHL circuit breaker state machine
description: Cross-tick circuit design in ghl-sync.ts — state enum, half-open probes, rolling window, classification dispatch
---

The GHL sync circuit is a persisted state machine (`closed` | `open` | `half-open`) in `ghl-sync.ts`, stored under system_settings key `ghl_circuit_state` with `consecutiveFailures`, `halfOpenProbeSuccesses`, `lastFullSuccessTickAt`.

**Rules:**
- Never reset circuit state unconditionally at tick start — open → half-open (1 probe contact only), and 3 consecutive probe successes are required to close. A single success must not close an open circuit.
- All failure counting flows through `classifyGhlSyncError()` ("auth" | "rate-limit" | "skip" | "retryable"). Auth (401) opens the circuit immediately; local-miss strings ("* not found", "GHL not configured", "No GHL contact linked*", identity conflict, OPPORTUNITY_STAGE_ID_INVALID, GHL 400 not-found) are skips and never counted.
- Rolling window: if no tick has synced ≥1 entity in 60 min, a closed circuit still enters half-open probe mode.
- `getGhlCircuitStatus().circuitOpen` derives from the state enum (open OR half-open), never from the counter (which is 0 between ticks). `resetGhlCircuit()` must reset all four fields.
- Recovery alert has its own cooldown key `ghl_circuit_recovery_alert_at`.

**Why:** The old design reset the counter/flag every tick, making the breaker a within-tick abort only — a sustained 401/5xx flood ran unchecked for hours while the admin UI showed healthy.

**How to apply:** Any change to the sync tick or new sync phases must route error handling through `classifyGhlSyncError()` and the trip helpers (`tripCircuitAuth`/`tripCircuitThreshold`); test via `scripts/test-ghl-circuit-classification.ts` using `__ghlCircuitTestHooks`.
