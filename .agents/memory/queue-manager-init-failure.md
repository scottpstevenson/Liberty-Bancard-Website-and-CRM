---
name: QueueManager partial-init leak
description: getQueueManager() must not cache a QueueManager instance whose initialize() threw partway through
---

If `QueueManager.initialize()` throws partway through `setupQueues`/`setupWorkers`/`setupRepeatableJobs`,
some queues/workers (e.g. GHL_SYNC) can already be live and consuming repeatable jobs even though
initialization overall failed.

**Why:** `getQueueManager()` used to assign the module-level singleton before/regardless of initialize()
succeeding. A later caller reusing the singleton would get a half-initialized manager with orphaned live
workers, while the caller's own `.catch()` fallback (e.g. starting a legacy `setInterval` sync loop) could
run at the same time — risking two sync mechanisms (BullMQ + legacy) active in the same process
simultaneously.

**How to apply:** On `initialize()` failure, call `qm.shutdown()` to tear down any partially-created
queues/workers, and do NOT assign the broken instance to the singleton (leave it null so the next call
retries cleanly). Any dual-mode background system (BullMQ queue vs. interval/cron fallback) should log
which mode is active at startup so drift is observable in logs, not just inferred from behavior.

**Follow-up pattern:** to make sync-mode drift visible beyond logs, reuse `recordWorkerSuccess`/
`recordWorkerFailure` (`server/services/job-registry.ts`) with a pseudo job name (e.g. `ghl-sync-mode`)
added to `JOB_NAMES` — it then shows up for free in `getJobStatuses()` / `/api/operator/job-status` and
the existing Job Queue health table (`OperatorDashboard.tsx`), no new endpoint or UI needed. Same trick
works for surfacing isolated sub-call failures inside an outer tick that itself always "succeeds"
(give the sub-call its own pseudo job name distinct from the tick's own job name).

**Two more gaps found by code review after the initial fix, both needed for true "only one mechanism
ever active" guarantee (not just at first startup):**
1. *Concurrent-init race*: assigning the singleton only after `initialize()` resolves means two
   concurrent first-time callers (e.g. startup's `getQueueManager()` racing a request-triggered
   enqueue call) can both see `null` and each construct/initialize their own `QueueManager` — duplicate
   queues/workers. Fix: cache the in-flight *promise itself* (a module-level `_initPromise`), not just
   the resolved instance, so concurrent callers await the same initialize() call.
2. *No process-level mode gate*: even with the partial-init fix, nothing stopped BullMQ from later
   creating the GHL_SYNC queue/worker if some unrelated lazy `getQueueManager()` call (e.g. an
   enrichment-job enqueue) succeeded after the legacy `setInterval` fallback had already claimed GHL
   sync duty (e.g. Redis recovers mid-process). Fix: an explicit module-level flag set once by the
   fallback branch (`claimLegacyGhlSync()`), checked by `QueueManager` every time it builds its list of
   queues/workers/repeatable-jobs to manage — permanently excluding the GHL-sync entry from that list
   for the rest of the process, regardless of how many times BullMQ gets initialized afterward for
   *other* queues.
