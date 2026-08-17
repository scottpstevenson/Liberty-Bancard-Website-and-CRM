---
name: GHL test-contact cleanup lessons
description: What broke and what to know when purging test contact families and re-verifying GHL sync
---

- `sdr_lead_events` has TWO FKs (`lead_state_id` AND `merchant_id`) — delete by both before `sdr_lead_state`/`sdr_merchants`, or the transaction rolls back.
- BullMQ `queue.pause()` persists in Redis across restarts; always resume explicitly and record timestamps.
- Dev and prod share the same Redis, so both dev and prod workers can consume the same `ghl-sync` repeatable job; heartbeats/audits land in whichever process's DB served the tick. Verify evidence in the specific DB whose data you changed.
- The half-open circuit probe always picks the LOWEST-id unsynced contact; if that contact is a permanent identity-conflict skip, the circuit is starved and stays half-open forever. (Contact #32 in dev.)
- Test families beyond the three known prefixes exist: `venroll-test-*@libertybancard.test`, `go-live-check-*@libertybancard-test.internal`, fake `…555…` phones. GHL dedupes by phone, so these cause identity conflicts on unrelated contacts.
- `ghl_sync_completed` is never emitted anywhere — only read-side queries reference it. Real success action is `ghl_sync_success`.
- The pre-deploy suite (32 suites) leaves orphan test contacts when GHL rate limits interrupt teardown; always run `cleanup-smoke-contacts.ts --dry-run` after the suite and clean up again if needed.
- Backgrounded shell processes (`nohup`/`setsid`) are reaped between ShellExec calls; use a configured workflow for long-running scripts instead.

**Why:** cleanup for RV-GHL-01 (Aug 17 2026) hit every one of these.
**How to apply:** any future test-data purge or GHL sync verification.
