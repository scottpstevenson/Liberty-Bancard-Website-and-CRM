# Task #1532 Repository Audit — Reason-Scoped Logical Holds and Queue Backpressure

**Audit target:** `origin/main` at `d9bf0b783a1fd8a154c5e19a48167365087cb53b`  
**Submitted specification:** `Pasted markdown(7).md`  
**Audit mode:** Read-only repository and audit-document inspection  
**Verdict:** **NEEDS MATERIAL REVISION BEFORE BUILD**

## Executive verdict

The architectural direction is correct: BullMQ pausing must remain a secondary scheduling/backpressure optimization, while Task #1531 remains the unavoidable send-time safety authority. Reason-scoped logical holds are preferable to blindly pausing and resuming physical queues.

The submitted task is not build-ready, however. It contains four blocking design defects:

1. **The proposed startup ordering cannot be implemented through the current QueueManager API.** `getQueueManager()` calls `initialize()`, which creates queues, creates and starts every Worker, installs repeatable schedules, enqueues startup jobs, and only then returns. Reconciliation cannot occur “before workers become runnable” without splitting that lifecycle.
2. **Staged release is bypassable after global unpause.** The task upgrades selected handlers to check only `OutboundPauseAuthority`. Once global state becomes `unpaused`, mixed handlers will run even if a logical hold remains pending backlog preview. Every outbound-effect handler must enforce both the canonical send authority and its effective logical hold.
3. **The hold table cannot safely represent independent owners or concurrent incidents.** A primary key of `(logical_job_key, reason)` collapses two manual, maintenance, or incident holds using the same reason. A delayed clear or stale process can release another owner’s hold.
4. **The queue/effect inventory is incomplete and contains false classifications.** `ENRICHMENT` is not a non-outbound physical queue; it includes `inbound-confirmation-followup` sends and promotional-enrollment jobs. `SLA_CHECKS`, `DIGESTS`, `ONBOARDING_REMINDER`, `ABANDONED_STATEMENT`, `PROPOSAL_FOLLOWUP`, `PARTNER_MONTHLY_DIGEST`, `PIPELINE_SILENCE_CHECK`, and recovery paths also send, enroll, or mutate outbound scheduling state.

Task #1532 should be split into inventory/lifecycle, durable holds, handler deferral, physical actuation, and staged-release phases. Physical pause/resume must remain disabled until the first four phases pass their gates.

## Corrected VFC table

| ID | Submitted claim | Verdict | Verified repository reality |
|---|---|---|---|
| VFC-01 | #1531 is merged and its tables are live | **Static merge confirmed; runtime “live” unverified** | Migrations 0133 and 0134, schema definitions, pause authority, and control service exist on `origin/main`. Whether production applied both migrations is a runtime check. |
| VFC-02 | `logical_job_control_holds` is absent | **Confirmed** | No schema or migration definition exists. |
| VFC-03 | `OutboundPauseAuthority` blocks `activating` and fails closed | **Confirmed** | `authorize()` denies `paused`, `activating`, safe-default, and errors. |
| VFC-04 | Proposed type names are outdated | **Confirmed** | Exports are `PauseState`, `OutboundPauseStateResult`, and `AuthorizedSendDecision`. |
| VFC-05 | PATCH response contains `queueBackpressure.status = not_configured` | **Confirmed** | Both global-control and channel-only response paths contain the stub. |
| VFC-06 | QueueManager pause/resume lacks reason ownership | **Confirmed** | `pauseQueue(name)` and `resumeQueue(name)` directly call BullMQ without a durable reason model. |
| VFC-07 | Routes call raw BullMQ `Queue.pause()`/`resume()` | **False, as the submitted task says** | Routes call QueueManager wrappers, not BullMQ directly. |
| VFC-08 | Three workers read the legacy setting | **True but materially incomplete** | POST_ENRICHMENT, SEQUENCES, and WINBACK do. PROPOSAL_FOLLOWUP and campaign-engine paths also read it; SEQUENCES has another raw read in its SMTP path. More service and route reads remain. |
| VFC-09 | ENRICHMENT is non-outbound and safe to run as one unit | **False** | The physical queue multiplexes statement analysis, scoring/readiness, generic enrichment, `promotional-enrollment-eval`, and `inbound-confirmation-followup`; the latter sends email and the former can create sequence enrollments. Classification must be queue + job type. |
| VFC-10 | ENROLLMENT_RECOVERY is pure bookkeeping | **False / incomplete** | It reserves `outbound_send_counters` capacity and reactivates paused enrollments. It does not directly send, but it materially changes outbound scheduling and capacity. |
| VFC-11 | MERCHANT_SUCCESS creates enrollments during pause | **Confirmed** | No global-authority or logical-hold check exists. This is not the only enrollment-creation gap. |
| VFC-12 | DISCOVERY mixes safe and outbound work | **Confirmed, but understated** | In addition to queueing/sending campaign messages, promotion triggers promotional enrollment, workflow execution, and GHL sync. Gating only `processSendQueue()` is insufficient. |
| VFC-13 | GHL recovery’s SMTP alert may remain ungated as an exception | **Contradicted by #1531 implementation** | The exception registry is empty, `authorize()` never bypasses a pause, and `sendSmtpEmail()` calls `authorize({})`. “Register and keep ungated” is not currently possible and would contradict the unavoidable boundary. |
| VFC-14 | No BT-12 code artifact exists | **Confirmed** | No named BT-12 implementation artifact exists. Redis/worker runtime health is still a required enablement gate for physical actuation. |
| VFC-15 | Coordinator does not exist | **Confirmed** | No matching service exists. |
| VFC-16 | Next migration should be 0136 | **Conclusion confirmed; evidence partly false** | 0134 is not a gap—it is `outbound_inflight_sends`. With 0135 present, 0136 is the next filename. The next journal index should follow the actual journal, not be inferred from the filename alone. |
| VFC-17 | Control service returns committed state/epoch | **Confirmed** | `PauseControlResult` includes committed control state, epoch string, send enforcement, and the backpressure stub. |
| VFC-18 | Startup reconciliation can call the current QueueManager before workers | **False — blocking** | `QueueManager.initialize()` executes `setupQueues()`, `setupWorkers()`, `setupRepeatableJobs()`, then cleanup. Worker constructors are active before the method returns. |
| VFC-19 | Preventing lazy init in the settings mutation handler is sufficient | **False — blocking** | Many metrics, health, admin, notification, route, and producer paths call lazy `getQueueManager()`. Any one can initialize the worker fleet after startup deliberately skipped it. |
| VFC-20 | BullMQ counts are a complete backlog preview | **False** | SEQUENCES is one recurring BullMQ tick over a database enrollment backlog; campaign messages, deferred GHL enrollments, and promotional enrollment work also live in database tables. Queue counts do not measure those units. |
| VFC-21 | Physical resume can provide bounded staged release by itself | **False** | Resuming SEQUENCES releases a handler that fetches and loops over all due active enrollments. Bounded release requires handler-level limits, rate controls, and durable cursors/claims. |

## Verified queue/effect inventory

The repository defines 23 physical QueueManager configurations, but the logical-job count is greater than 23 because several physical queues dispatch multiple job names or multi-phase handlers.

| Physical queue | Verified effect | Audit disposition |
|---|---|---|
| `ghl-sync` | External CRM synchronization, not customer messaging | Normally runnable during customer-outbound pause; classify as external data sync. |
| `sla-checks` | **Mixed:** internal tasks/alerts, customer follow-up emails, NPS/retention work, and legacy campaign sending | Must be split or sub-handler gated; never physically pause as a single outbound-only queue. |
| `sequences` | Email/SMS sequence execution over DB-backed enrollment backlog | Candidate for physical pause after logical gating and bounded handler batches exist. |
| `enrichment` | **Mixed by job name:** analysis, scoring, enrichment, promotional enrollment, and inbound confirmation follow-up email | Manifest key must include job name/payload discriminator. Do not pause the whole queue for global outbound. |
| `discovery` | **Mixed:** enrichment, promotion, enrollment/workflow triggers, campaign queueing, and sends | Split phases and gate every outbound-effect phase. |
| `digests` | Internal operational email via GHL/SMTP | Needs reviewed internal-notification policy; currently the transport boundary blocks it while globally paused. |
| `mid-ingestion` | Processor-data ingestion | No customer send; normally runnable. |
| `onboarding-reminder` | Lifecycle email plus sequence enrollment paths | Outbound-effect logical job; must honor logical holds before work creation and send. |
| `activation-monitor` | Internal notification generation | Review whether preference-aware notification can produce external email; classify explicitly. |
| `merchant-success` | Creates milestone sequence enrollments | Promotional/lifecycle enrollment effect. |
| `winback-outreach` | Promotional SMTP email | Dedicated outbound candidate for first physical-pause pilot. |
| `abandoned-statement` | Creates rep task and sequence enrollment | Mixed; keep task creation running while deferring enrollment durably. |
| `executive-snapshot` | DB snapshot plus external AI calls | No customer communication; external-compute classification. |
| `system-audit` | System checks and internal alerting | Internal-notification effects require explicit policy; do not assume “none.” |
| `db-backup` | Infrastructure backup work | Normally runnable; verify any remote upload side effect separately. |
| `enrollment-recovery` | Reserves send capacity and reactivates enrollments | Outbound scheduling effect; not pure bookkeeping. |
| `ghl-enrollment-recovery` | Retries GHL workflow enrollment and sends permanent-failure admin SMTP alert | Mixed customer enrollment + internal notification. Pause deferral must not consume retry attempts. |
| `health-monitor` | Health probes and possible internal alerting | Internal-notification classification; normally keep probes running. |
| `pipeline-silence-check` | In-app review item plus admin SMTP email | Mixed internal DB + external notification. |
| `proposal-followup` | Customer proposal-follow-up email | Dedicated outbound effect; also uses a raw legacy pause read today. |
| `partner-monthly-digest` | External partner email | Transactional/relationship communication; explicitly classify and hold according to policy. |
| `voicemail-sync` | Inbound voicemail polling/synchronization | Normally runnable during outbound pause. |
| `post-enrichment` | Deal stage updates plus GHL sync/enrollment preparation | Mixed. Requires a durable phase state/outbox so safe stage work can complete while enrollment remains deferred. |

### Non-BullMQ recurring ownership that must also be in the manifest

- Legacy `startSlaWorker()` fallback, which also runs sequences, campaign sends, enrichment, digests, reminders, NPS, and other checks.
- Legacy `startDailyOutreachWorker()` fallback.
- Legacy GHL sync interval.
- Content scheduler/LinkedIn auto-publish.
- Inbox-rotation maintenance scheduler.
- SDR orchestrator and other independently started intervals where enabled.
- Startup-delayed and recovery jobs created through producer calls.

A BullMQ-only coordinator cannot enforce logical holds on these paths.

## Findings by priority

### P0 — QueueManager lifecycle makes the startup gate impossible

**Files:** `server/services/queue-manager.ts`, `server/index.ts`, all lazy `getQueueManager()` call sites.

`getQueueManager()` is both an accessor and an initializer. `initialize()` creates active Workers before reconciliation can inspect or apply desired queue state, then installs repeatable jobs and startup jobs. Health and metrics endpoints can also invoke this initializer later, bypassing the intentional startup skip.

**Required correction:**

1. Split initialization into explicit phases: connect/create producer queues; build desired reconciliation plan; apply/observe physical pause state; construct Workers with `autorun: false` or equivalent; install schedules; then start workers.
2. Replace lazy `getQueueManager()` with a non-initializing `getExistingQueueManager()`/`requireQueueManagerReady()` accessor.
3. Provide a separate producer-only queue client for enqueue operations so adding one enrichment job cannot start all workers.
4. Make the bootstrap owner in `server/index.ts` the only code allowed to create/start the worker manager.
5. Health/readiness endpoints must report `not_initialized`, not initialize the system as a side effect.

### P0 — global unpause can bypass staged release

The proposed workers check `OutboundPauseAuthority` only. Once the control row is `unpaused`, that authority allows work. A remaining logical hold or pending preview has no effect on a mixed queue that stays physically active.

**Required correction:** Every outbound-effect phase must call a logical execution gate such as `LogicalJobCoordinator.canExecute(logicalJobKey, context)` before creating outbound work or consuming a backlog. Send boundaries still obtain and recheck #1531 authorization separately.

On unpause, do not simply delete `global_outbound` and hope the queue remains physically paused. Atomically transition to a `release_pending` hold (or retain the global hold until release approval) so mixed handlers remain blocked. Only an approved staged-release mutation may clear that release hold.

### P0 — submitted hold identity and epoch model is unsafe

`PRIMARY KEY (logical_job_key, reason)` permits only one hold per reason. Two incidents, two maintenance windows, or two operators can overwrite each other. Clearing one clears the shared row. The specification also proposes a separate epoch without defining a total order with the source global-pause epoch; delayed pause/unpause reconciliation can apply stale physical changes.

**Required schema model:**

- Stable `hold_id UUID PRIMARY KEY`.
- `logical_job_key`, constrained `reason_code`, `source_type`, and stable `source_key`/owner identity.
- `source_epoch` for global/channel/automation mutations and a separate monotonic `ledger_epoch` for coordinator ordering.
- `activated_at`, `released_at`, optional bounded `expires_at`, actor, correlation ID, and non-PII metadata.
- Partial unique constraint for one active hold per `(logical_job_key, reason_code, source_key)`, not per reason alone.
- Immutable hold-event/audit table written atomically with every mutation.
- Per-physical-queue reconciliation table containing desired state/epoch, observed state/epoch, attempt/error, and timestamps.
- Durable backlog-release run/stage table if staged release is in this task.

Global-pause-derived holds should be written in the same database transaction as the control mutation or through a transactional outbox. A stale event must never clear or supersede a newer source epoch.

### P0 — physical queue classification is too coarse

The manifest cannot be keyed only by the 23 queue names. `enrichment` alone dispatches materially different effects by `_job.name`; other handlers contain multiple phases. The proposed comment-based CI annotation is not proof of coverage.

**Required correction:** Define typed executable manifest entries by logical key with physical queue, job-name matcher/payload discriminator, handler, owner, effect, pause policy, backlog source, and release controller. Runtime processor dispatch and enqueue helpers must resolve through this manifest. CI must compare executable registrations and known enqueue call sites to the manifest; comments are supplementary only.

### P1 — selected worker upgrades are incomplete

In addition to the three named files:

- `proposal-followup-worker.ts` uses the raw legacy pause setting.
- `campaign-engine.ts` uses raw checks in both prospect and contact send paths.
- `sequence-worker.ts` has another raw SMTP pause check.
- `ghl-workflows.ts`, `nba-service.ts`, the SDR orchestrator, and other automation paths read the legacy flag.

This task does not need to rewrite read-only dashboards, but every execution decision must use the canonical authority plus logical hold gate. A static scan should distinguish display/readiness reads from enforcement reads.

### P1 — mixed-handler deferral semantics are wrong or unspecified

**POST_ENRICHMENT:** The current pause check happens before the processing stamp and stage advancement. Replacing only the source preserves that early return, contradicting the task’s promise that safe stage work continues. Moving the check later without a durable phase marker can permanently suppress the deferred enrollment. Use explicit phases or an outbox: safe stage advancement committed; enrollment intent remains pending; later worker completes it idempotently.

**DISCOVERY:** Gating only send-queue processing misses promotional enrollment, workflow triggering, and other outbound-effect work during promotion. Split discovery/enrichment, promotion, enrollment/workflow, message queueing, and sending into separately gated logical phases. The daily-send-cap early return must not prevent safe enrichment work.

**MERCHANT_SUCCESS and ABANDONED_STATEMENT:** “Skip while paused” can miss a narrow milestone/window or lose the intended enrollment. Persist a deferred intent with idempotency and retry eligibility; keep safe task creation separate.

**GHL_ENROLLMENT_RECOVERY:** A pause denial must defer without incrementing `retry_count`, consuming the retry budget, or moving a row toward permanent failure.

**SEQUENCES:** The current legacy global-pause path changes domain enrollments from `active` to `paused`, and no matching global-unpause restoration path was found. Queue/logical holds should normally defer execution without mutating the business status, or enrollment holds must themselves be reason-scoped and recoverable.

### P1 — reason producers are not wired

The done criteria name `channel_pause` and `automation_kill_switch`, but the steps wire only global pause and manual queue routes.

- Channel pause writes occur in `activation.ts` and automatically in SDR anomaly detection; neither is connected to the proposed ledger.
- Automation toggles occur in `admin.ts`; the current check is cached and fails open on database errors.
- Maintenance and incident creation/clear APIs, ownership, expiration, and reconciliation triggers are unspecified.

All producers must call the same hold service or write a transactional outbox event. Clearing global state must never affect these holds.

### P1 — “registered internal exception” conflicts with #1531

The current exception registry is empty and advisory. `authorize()` blocks all callers when paused; `sendSmtpEmail()` always invokes `authorize({})`. The GHL recovery email therefore cannot be kept ungated merely by documenting it.

Choose one explicit policy:

1. Keep global pause absolute and use in-app/observability alerts while paused; or
2. Amend #1531 through separate compliance review to support a narrowly versioned operational exception at the transport boundary.

#1532 must not silently create that bypass.

### P1 — staged backlog preview needs domain backlogs

BullMQ waiting/delayed/active/failed counts describe scheduler ticks, not the actual send units for several queues. The preview must include, as applicable:

- Due `sequence_enrollments` by channel/sequence/age/contactability.
- Queued/sending `outbound_messages`.
- Deferred GHL workflow enrollments and retry states.
- Pending promotional-enrollment job rows.
- Pending post-enrichment enrollment intents.
- BullMQ jobs by queue and job-name discriminator.

Staged release requires handler-level `limit`, concurrency/rate bounds, durable claims/cursors, and abort checks between chunks. `queue.resume()` alone is not a staged release mechanism.

### P2 — reconciliation persistence and multi-process fencing are underspecified

BullMQ pause/resume is a Redis side effect outside the Postgres transaction. The coordinator needs a recoverable state machine:

1. Commit desired state and epoch.
2. A single fenced reconciler claims the operation.
3. Apply the Redis action.
4. Read back `queue.isPaused()`.
5. Persist observed state only if the desired epoch is still current.
6. Retry with bounded backoff and periodic drift scans.

Multiple application replicas must not allow a stale reconciler to resume a queue after a newer hold. Expired holds also require periodic reconciliation; an `expires_at` column alone does not change Redis state.

## Corrected implementation sequence

### 1532A — executable manifest and lifecycle refactor

1. Inventory all 23 physical queues, every job name/payload variant, legacy interval, startup timer, recovery process, and producer enqueue path.
2. Create a typed executable logical-job manifest with validation against QueueManager configs and processor dispatch.
3. Refactor QueueManager into producer/queue creation, reconciliation, worker creation, schedule installation, and worker-start phases.
4. Remove lazy worker initialization from all routes, probes, and producers.
5. Add read-only coordinator planning and status; physical actions remain disabled.

### 1532B — durable holds and reconciliation state

1. Add migration 0136 with unique hold identities, immutable events, reconciliation state, and—if included—release-run persistence.
2. Add transaction/advisory-lock or outbox sequencing for global, channel, automation, manual, maintenance, and incident sources.
3. Implement multi-process fencing, source epochs, periodic reconciliation, expiration processing, and observed-state verification.
4. Return `pending`, `degraded`, or `unknown` unless Redis state has been observed at the current desired epoch.

### 1532C — logical gates and durable mixed-handler deferral

1. Gate every outbound-effect phase with the logical coordinator.
2. Replace execution-path legacy pause reads with canonical authority calls.
3. Split POST_ENRICHMENT, DISCOVERY, SLA_CHECKS, abandoned-statement, recovery, and other mixed handlers into safe and deferred phases.
4. Ensure pause deferral never consumes retries, send capacity, milestone windows, or idempotency markers.
5. Cover legacy fallback intervals and non-BullMQ schedulers.

### 1532D — physical pause pilot

1. Enable physical actuation only for one proven dedicated outbound queue, preferably `winback-outreach`.
2. Verify desired/observed state, multi-process behavior, Redis faults, active-job behavior, and recovery.
3. Expand only to queues whose every logical job is held. Do not describe a “send portion” as a physically pausable queue.

### 1532E — domain-aware staged release

1. Build previews from BullMQ and domain tables.
2. Create a durable release run with explicit scope, limits, actor, expiry, and abort state.
3. Process bounded chunks with fresh contactability, channel, logical-hold, and #1531 authorization checks.
4. Require admin approval for each production release stage; never automatically resume all work on global unpause.

## Required gate checks and tests

| Gate | Required proof |
|---|---|
| G-01 Manifest completeness | Every QueueManager config, processor branch, enqueue job name, legacy interval, startup timer, and recovery handler resolves to exactly one reviewed logical manifest entry. |
| G-02 No side-effect initialization | Metrics, health, launch-readiness, notification health, probes, and producer enqueue calls cannot create/start the worker fleet. |
| G-03 Startup barrier | No Worker can fetch a job before pause initialization, desired-state read, reconciliation attempt, and explicit worker start. |
| G-04 Independent holds | Two same-reason holds with different source keys coexist; clearing either leaves the other active. |
| G-05 Stale epoch protection | Delayed pause/unpause/clear operations from one replica cannot supersede a newer source or ledger epoch. |
| G-06 Global clear isolation | Clearing global pause leaves manual, channel, automation, maintenance, incident, and release-pending holds untouched. |
| G-07 Mixed handler safety | Safe phases run while held; outbound phases create durable deferred intents and do not send/enroll. |
| G-08 POST_ENRICHMENT recovery | Stage advancement may commit while held, and the enrollment phase later resumes exactly once. |
| G-09 DISCOVERY phase coverage | Promotion enrollment, workflow triggers, campaign queueing, and sending are all held; safe enrichment continues. |
| G-10 Recovery budget | Pause/hold deferral does not increment GHL retry count, consume send counters, or permanently fail recovery work. |
| G-11 Channel and automation wiring | Direct admin writes and automated anomaly pauses produce/clear only their own ledger holds. |
| G-12 Physical observation | `applied` is returned only after `queue.isPaused()` matches the desired state at the current epoch. |
| G-13 Redis failure recovery | Fault between DB commit and Redis effect yields `pending/degraded`, survives restart, and reconciles without stale resume. |
| G-14 Multi-process | Two reconcilers under opposing operations converge to the newest committed desired state. |
| G-15 Domain backlog accuracy | Preview counts reconcile to BullMQ plus sequence, campaign-message, deferred-workflow, and enrollment-intent tables. |
| G-16 Bounded release | A stage cannot process more than its configured unit/rate/concurrency limit and is abortable between chunks. |
| G-17 Active-job defense | A job active before pause cannot cross a provider boundary after the pause epoch changes. |
| G-18 Exception policy | No internal-notification bypass exists unless separately approved and enforced through #1531’s versioned transport policy. |
| G-19 No live external action | Tests use fake Redis/provider transports and cannot send email, SMS, workflow enrollment, voice/RVM, or LinkedIn content. |

## Kill lines

- **STOP** if QueueManager creates an active Worker before coordinator reconciliation completes.
- **STOP** if any route, health probe, or producer can lazily initialize the worker fleet.
- **STOP** if the manifest is keyed only by physical queue and cannot distinguish `enrichment` job types.
- **STOP** if an outbound-effect handler checks only global authority and ignores an effective logical/release hold.
- **STOP** if global unpause makes mixed handlers runnable before staged-release approval.
- **STOP** if `(logical_job_key, reason)` remains the hold identity.
- **STOP** if a stale source epoch can clear or apply over a newer hold.
- **STOP** if desired and observed Redis state are stored without epoch fencing and readback.
- **STOP** if an expired hold can remain physically applied indefinitely without reconciliation.
- **STOP** if channel-pause, automation-kill-switch, maintenance, or incident producers bypass the ledger.
- **STOP** if POST_ENRICHMENT marks the whole job complete while its held enrollment phase is lost.
- **STOP** if DISCOVERY gates only `processSendQueue()` while promotion/enrollment/workflow phases continue.
- **STOP** if pause deferral consumes GHL retry budget, send-counter capacity, or a merchant milestone window.
- **STOP** if BullMQ job counts are presented as the complete send backlog.
- **STOP** if `queue.resume()` is presented as a bounded staged release without handler-level work limits.
- **STOP** if an internal SMTP exception bypasses #1531 without separate compliance approval and transport-boundary enforcement.
- **STOP** if any response reports `applied` based on a best-effort Redis command rather than observed current state.
- **STOP** if any test or rollout action contacts a real recipient or enrolls a real contact.

## Runtime verification — separate from static findings

The repository cannot prove the following. Verify them read-only in the deployed environment before enabling physical actuation:

1. Deployed SHA and applied migration state for 0133–0135.
2. Number of application replicas/process identities and which process owns Worker startup.
3. Redis plan/client limit, observed connected clients, timeout/error rate, and BullMQ connectivity.
4. Actual QueueManager topology and whether legacy fallbacks are active in any process.
5. Current physical pause state, repeatable jobs, waiting/delayed/active/failed counts by queue and job name.
6. Domain backlog counts and ages for due sequence enrollments, queued/sending messages, deferred GHL enrollments, promotional enrollment jobs, and pending post-enrichment work.
7. Current global, channel, automation, manual, and incident controls and their actors/reasons.
8. Whether current paused sequence enrollments contain `_globalPauseBlock*` metadata with no restoration owner.
9. Actual handler throughput and safe bounded release sizes.
10. Staging proof of Redis failure, restart, multi-process convergence, and active-job epoch denial using fake external transports.

Prior audit documents report historical Redis/BullMQ timeouts and possible connection-capacity pressure. Those reports do not prove the current runtime condition, but physical actuation must remain disabled until fresh RV evidence shows stable capacity and reconciliation behavior.

## Final recommendation

Do **not** implement Task #1532 exactly as pasted. Preserve its central principle—#1531 remains the send boundary—but revise it into 1532A through 1532E above. The first safe deliverable is an executable manifest plus QueueManager lifecycle refactor and read-only reconciliation plan. Durable logical holds come next. Mixed-handler deferral must be proven before any physical pausing. Staged production release comes last.

No repository source was modified during this audit.
