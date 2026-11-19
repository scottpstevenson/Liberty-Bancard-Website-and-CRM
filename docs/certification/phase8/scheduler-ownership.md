# Phase 8 scheduler ownership and rollback

Source baseline: d67d24c61acc462931c418e8068624c86144c7ae. Candidate branch: codex/phase8-cleanup-hardening. No scheduler or profile was activated by this work.

| Logical work | Entry/caller and startup | Shared authority / disposition |
|---|---|---|
| GHL sync | ghl-sync.startAutoSyncLoop compatibility export | Already disabled, retained refusal; no fallback revived |
| Daily outreach | queue-manager daily-outreach handler; explicit manual/background command | Existing heartbeat DB lease; promotional phases require pause authority/coordinator; frozen campaign-run authority owns actual dispatch. Uncalled startDailyOutreachWorker now refuses rather than starting duplicate enrichment intervals |
| SLA | queue-manager normal owner; startSlaWorker has no production caller | Retain distinct legacy compatibility body because it also contains workflow/stage work, not proven equivalent to one queue; no automatic fallback. Existing runSlaCheck registry/task command and unique stalling-task authority retained |
| SDR sweep | queue handler and explicit admin start/manual sweep | Existing sdr-orchestrator DB lease, pause/coordinator and canonical channel authority. Local interval retained for explicit supported admin path; generation + tracked initial timeout now cancel queued work on Stop, and pause hydration must succeed before initial work |
| Re-enrichment | re-enrichment.startReEnrichmentWorker | Already disabled; existing explicit refusal retained |
| Nightly discovery | lead-finder.startNightlyDiscovery | Existing refusal retained, unreachable interval body removed; scheduled-discovery is the governed paid-search owner |
| Funnel aggregation | explicit admin aggregate route; uncalled startNightlyAggregation compatibility timer | Manual refresh and automatic projection share serializable period advisory lock; automatic completion receipt commits with DB-only effects. Explicit manual refresh intentionally recomputes changed facts. No new startup caller |
| Inbox maintenance | server/index, permitted non-BullMQ profile only; explicit admin maintenance route | Registry token row locked inside serializable DB-only effect transaction + atomic Eastern-date receipt; generation-owned one-shot IANA timer, idempotent Start/Stop |
| Partner intake / staff alerts | existing queue/profile and durable intake/alert recovery | Preserved existing event-key uniqueness, lease/uncertain dispatch handling and staff-only pause exception; no test mail sent |
| Recurring paid discovery | scheduled-discovery queue, selected profile, definition controls | Existing logical governance and CRM-wide budget reservations/settlement unchanged; $50 cap not altered |

Timers for heartbeats, polling, debounce and bounded retries are not alternate work dispatchers. No new physical queue was added.

## Period and fault policy

Receipt keys are `(job_key, period_key)` with a real calendar date in America/New_York. Completion and local DB changes commit atomically; failed transactions leave neither receipt nor partial effect. PostgreSQL serialization/deadlock retries are bounded to three attempts and contain **no provider I/O**. Existing sender consumption on upgrade is assigned today's Eastern date and preserved. Reservations lock the identity and lazily roll only an older date. Repeated maintenance never clears today's allowance. Known-unsent rollback is scoped to the returned reservation date; old-day failure cannot release today's capacity.

The midnight timer computes the next IANA boundary rather than adding 24 hours. Start is idempotent. Stop invalidates callbacks even if already queued, and an in-flight callback cannot rearm. On process restart it waits for the next boundary; it does not blindly replay every missed maintenance day. Reservations roll allowance lazily. Warmup/health maintenance can be explicitly requested through the existing admin command; failed scheduled execution is recorded as failed and waits for next boundary/manual retry. Historical funnel periods are refreshed explicitly; no invented retroactive provider work is scheduled.

Lease failure remains held/unavailable; no Redis outage starts an interval fallback. The native inbox effect transaction locks the current registry token row, preventing a takeover from committing until the DB effect transaction ends; a mismatched token cannot write. Process termination releases DB locks and rolls uncommitted effects back. Existing follow-up receipts now wrap SDR email attempts, statement email and terminal notifications. Stable effect keys claim before the inbox reservation and provider callback; accepted/unknown replay never repeats either. An ambiguous result or thrown delivery retains allowance; explicit known refusal releases its reserved day. These are distinct from the local DB-only period receipts. Existing provider/channel pause and commercial authority still apply.

## Rolling release and rollback

Keep outbound paused and existing paid-provider controls intact. Publish owns the additive 0394 migration; old readers tolerate the added column/table. Stop/drain the old application process before activating the new periodic owner: the old version does not understand receipts and must not coexist as an independently active maintenance dispatcher. Roll back code through the existing artifact owner only after stopping the new timer/process; preserve counter_date, receipts, leases and all evidence. Never delete receipts, clear Redis, reset allowance/spend or replay an unknown provider dispatch. No index is dropped by this candidate, so no index recreation is required for its rollback.
