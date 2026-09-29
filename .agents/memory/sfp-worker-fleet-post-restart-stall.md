---
name: SFP/background worker fleet going dark after production restart
description: NO_ATTESTATION and zero SFP throughput in production traced to recurring workers not actually executing after a restart, while queue-metrics falsely reports them healthy.
---

`sfp-attestation-refresh.ts` and the other SFP recurring ticks are logically correct — the
`NO_ATTESTATION` Program Health symptom is NOT a bug in that refresh logic itself.

**Ground truth for "did a recurring job actually run" is `system_settings.worker_heartbeat_<queue>`
(written once per real execution) and `audit_logs`, not `/api/admin/queue-metrics`.** In a live
production incident (2026-09-29), `queue-metrics` reported every SFP queue `probeStatus: "ok"`
with `lastCompletedAt` timestamps hours *after* the real last execution — heartbeats and audit
rows across the entire fleet (not just attestation) stopped exactly at the process's own boot
timestamp and never resumed, while `queue-metrics` kept claiming fresh completions the whole time.

**Why:** `queue-metrics`'s completion timestamps come from a source (BullMQ/Redis job metadata)
that can be stale or cross-contaminated and must not be trusted as the sole freshness signal for
an operator-facing health panel — it produced a false "healthy" reading that hid a real ~3.5-hour
full worker-fleet stall.

**How to apply:** when a program-health/attestation/throughput panel looks wrong despite
"healthy" SHA/heartbeat/queue-probe checks, cross-check `system_settings.worker_heartbeat_<queue>`
and `audit_logs` (recent rows for the specific action, e.g. `sfp_attestation_refresh_tick`) against
current time before trusting any BullMQ-sourced "lastCompletedAt". Root cause of *why* jobs stop
executing after a restart (vs. just reporting badly) was not yet found — check `server/index.ts`'s
`getQueueManager()` boot sequence and `server/services/queue-manager.ts`'s dispatch loop next.
