# Task #1522B — Reason-Scoped Logical Holds and Queue Backpressure

**Priority:** P1 operational hardening; it is not the P0 send-safety boundary  
**Status:** Build-ready only after Task #1522A and the BT-12 logical-job manifest exist  
**Primary overlap:** BT-12  
**Supporting overlap:** BT-04, BT-05, BT-06  
**Runtime verification:** RV-05, RV-08, RV-15

## Objective

Reduce dequeue churn, retry noise, and avoidable backlog growth while outbound messaging is paused, without treating BullMQ queue state as the authority that permits or denies a send.

The permanent safety boundary remains Task #1522A: every outbound effect must pass an authoritative send-time decision immediately before transport invocation. This task adds a secondary scheduling and backpressure layer. A queue hold may prevent work from starting; it may never authorize a send.

## Attached findings

| Finding | Verified condition | Required disposition |
|---|---|---|
| Q-01 | The proposed six-queue list is incomplete. Outbound-adjacent behavior also exists in discovery, enrollment recovery, GHL enrollment recovery, merchant-success, and mixed enrichment work. | Derive controls from the logical-job manifest, not a hard-coded queue list. |
| Q-02 | A physical queue can contain outbound and non-outbound effects. `ENRICHMENT`, for example, includes promotional-enrollment evaluation alongside enrichment/scoring work. | Control logical job types first. Pause a physical queue only when every runnable logical job on it is held. |
| Q-03 | Post-enrichment work combines non-send state changes with enrollment behavior. | Do not pause the whole physical queue merely because one downstream effect is outbound; split or gate the outbound effect. |
| Q-04 | `Queue.pause()` does not stop an already-active job. | Retain the Task #1522A send-time decision and epoch recheck. |
| Q-05 | The existing pause/resume methods have no ownership or reason model. | Persist holds by logical job and reason. Clear only the caller-owned reason. |
| Q-06 | Automatically resuming all queues when global pause becomes false can clear a manual, maintenance, incident, or automation-specific pause. | Global clear removes only the `global_outbound` hold. Other active reasons continue to block work. |
| Q-07 | `getQueueManager()` is a lazy initializer with worker, repeat-schedule, and startup side effects. | The settings route must not initialize runtime infrastructure. Reconciliation belongs to startup/runtime control services. |
| Q-08 | Queue startup can occur before pause-setting initialization/reconciliation. | Reconcile authoritative controls before workers, repeat schedules, or startup jobs become runnable. |
| Q-09 | Concurrent opposing PATCH operations can interleave database and Redis actions. | Serialize state changes and reconcile by monotonic control epoch. |
| Q-10 | Best-effort pause calls cannot support a response claiming every queue is paused. | Report authoritative desired state separately from applied optimization state, including degraded or unknown results. |
| Q-11 | Releasing a held backlog can create a stale-message burst. | Preview, cap, stage, and revalidate backlog release; never resume blindly. |
| Q-12 | Direct operator pause/resume endpoints can bypass ownership rules. | Route every logical hold and physical pause through one coordinator; require a reason and actor. |
| Q-13 | The original smoke test checks only `isPaused()`. | Add safety, ownership, mixed-queue, startup, concurrency, failure, multi-process, and backlog-release tests. |

## VFC table

| VFC dimension | Required behavior | Evidence required |
|---|---|---|
| Value | Paused outbound work does not churn while non-outbound work continues where safe. | Queue/job telemetry shows reduced dequeue activity without suppressed enrichment, scoring, audit, or state-transition work. |
| Function | Holds are attached to logical job keys and reasons; physical queues are paused only when all mapped work is held. | Manifest-based unit tests and mixed-queue integration tests. |
| Controls | Clearing one reason cannot clear another; the control epoch orders competing updates. | Reason-independence and concurrent-mutation tests. |
| Failure safety | Database, Redis, or reconciliation failure cannot make the optimizer authorize a send. | Fault-injection tests demonstrate Task #1522A remains authoritative and reconciliation is retryable. |
| Observability | Desired state, applied state, drift, hold reasons, backlog size/age, and release progress are visible separately. | Metrics, structured events, and admin read-model assertions. |
| Compatibility | Dedicated queues work now; pooled or mixed queues remain safe later. | Logical-to-physical mapping tests including multiple job types per physical queue. |
| Reversibility | The optimizer can be disabled while the P0 authority remains enabled. | Feature flag/runbook and rollback test. |

## Dependencies and entry gates

Do not begin implementation until all gates pass:

1. Task #1522A is merged and its authoritative send-time checks are proven.
2. BT-12 provides a canonical manifest for every recurring, queued, recovery, and startup job.
3. Each manifest entry has a stable logical job key, physical queue mapping, effect classification, owner, schedule/producer, handler, retry policy, and enablement controls.
4. RV-05 has exercised the global pause against real worker topology with transport calls stubbed.
5. The exact implementation commit SHA is recorded.
6. Tests prohibit real external sends.

## Required logical-job contract

Extend the BT-12 manifest with fields equivalent to:

```ts
type OutboundEffect =
  | "none"
  | "promotional_send"
  | "promotional_enrollment"
  | "lifecycle_send"
  | "transactional_external"
  | "internal_notification";

interface LogicalJobManifestEntry {
  logicalJobKey: string;
  physicalQueue: string;
  jobNames: string[];
  outboundEffects: OutboundEffect[];
  canRunWhileGlobalOutboundPaused: boolean;
  handler: string;
  producers: string[];
  owner: string;
}
```

`canRunWhileGlobalOutboundPaused` must be derived from reviewed effect semantics, not inferred from the physical queue name. An entry containing both `none` and an outbound effect must either split the effects into separate logical jobs or gate the outbound portion inside the handler.

## Persistent hold model

Add an additive, durable hold ledger. A representative schema is:

```text
logical_job_control_holds
  logical_job_key       text not null
  reason                text not null
  active                boolean not null
  control_epoch         bigint not null
  source                text not null
  actor_id               text null
  activated_at          timestamptz null
  released_at           timestamptz null
  expires_at             timestamptz null
  metadata               jsonb not null default '{}'
  updated_at             timestamptz not null
  primary key (logical_job_key, reason)
```

Supported reasons must be explicit and extensible. The initial set should include:

- `global_outbound`
- `manual_operator`
- `maintenance`
- `incident`
- `automation_kill_switch`
- `channel_pause`

The schema must not encode reason ownership as a single boolean. More than one reason may be active for the same logical job.

## Control semantics

### Applying global pause

1. Task #1522A atomically changes the authoritative global state and increments its control epoch.
2. The optimizer records or refreshes `global_outbound` holds for manifest entries whose reviewed effects are blocked by the global switch.
3. It computes whether each physical queue is fully held.
4. It may pause a physical queue only when all logical job types that can execute there are held and no control/cleanup work on that queue must continue.
5. It records desired and applied state independently.

### Clearing global pause

1. Remove only the `global_outbound` reason at the applicable epoch.
2. Recompute effective logical holds. A job remains held while any other reason is active.
3. Recompute physical-queue eligibility. A queue remains paused if any required reason still owns the pause or if safe release has not completed.
4. Build a backlog preview before release.
5. Release work in bounded stages with rate limits and current eligibility/contactability rechecks.

### Effective hold

```text
logical job is held = any active, unexpired reason exists for its logical job key
```

Physical pause is an optimization derived from effective logical holds; it is not canonical business state.

## Coordinator design

Create one control coordinator with these responsibilities:

- Read the durable hold ledger and job manifest.
- Serialize mutations using the same monotonic control epoch model as Task #1522A.
- Calculate logical effective holds.
- Calculate whether a physical queue is safe to pause or eligible for staged release.
- Apply BullMQ pause/resume operations idempotently.
- Persist the last applied epoch and reconciliation result.
- Detect and expose drift between desired and applied state.
- Retry reconciliation after transient Redis failures.

Provide a side-effect-free `ifReady`/status accessor for routes and health checks. Do not call the lazy QueueManager initializer from an HTTP settings mutation.

All existing direct pause/resume routes must be migrated to the coordinator. Mutations require the logical target or physical target, reason, actor, source, and optional expiry. Raw `Queue.resume()` must not be callable from route modules.

## State reporting

Use separate states rather than one misleading `paused` boolean:

| Field | Meaning |
|---|---|
| `authoritativeGlobalState` | The Task #1522A database-backed send authority. |
| `desiredLogicalHolds` | Durable holds that should apply, grouped by logical job and reason. |
| `desiredPhysicalState` | Derived optimization state for the physical queue. |
| `appliedPhysicalState` | BullMQ state last observed/applied. |
| `reconciliationState` | `applied`, `pending`, `degraded`, or `unknown`. |
| `controlEpoch` | Monotonic version used to reject stale application. |
| `backlogReleaseState` | `not_applicable`, `preview_required`, `approved`, `releasing`, `held`, `complete`, or `failed`. |

The global settings PATCH may succeed when the database authority succeeds even if queue optimization is degraded, because Task #1522A makes the pause safe. Its response must disclose the degraded optimizer state and enqueue/retry reconciliation; it must not claim all queues are paused.

## Mixed-queue rules

1. Never hard-code a claim that exactly six queues represent outbound behavior.
2. Never pause `ENRICHMENT` wholesale while it contains non-outbound enrichment/scoring and promotional-enrollment evaluation.
3. Never pause post-enrichment state transitions merely to suppress an enrollment/send effect.
4. Discovery, enrollment-recovery, GHL-enrollment-recovery, merchant-success, and future job types must be classified in the manifest.
5. If a mixed handler cannot safely separate its outbound effect, keep the physical queue running and let the handler defer only the blocked effect.
6. A future shared Redis connection or pooled queue topology must not change the logical hold semantics.

## Backlog release safety

Before releasing a held logical job or physical queue, produce a preview containing:

- waiting, delayed, active, failed, and repeat counts;
- oldest and percentile job ages;
- logical job/effect mix;
- tenant/account distribution;
- estimated provider/channel throughput;
- number of jobs now stale, ineligible, suppressed, or no longer contactable;
- proposed batch size, concurrency, and rate limits.

Every released job must re-evaluate current enablement, suppression, consent/contactability, channel state, automation state, and Task #1522A authority at execution time. Stale or invalid jobs must be cancelled, completed as no-op, or moved to an explicit review/dead-letter disposition. They must not be sent merely because they were queued before the pause.

No automatic full-speed resume is permitted. Release must be staged, observable, and abortable.

## Primary files and surfaces

Exact paths must be reconfirmed at implementation SHA, but the audited surfaces include:

- `server/services/queue-manager.ts`
- `server/routes/activation.ts`
- `server/index.ts`
- operator/admin queue-control routes
- QueueManager worker registrations and job-name dispatchers
- discovery and daily-outreach producers/handlers
- enrichment and promotional-enrollment handlers
- post-enrichment handler
- enrollment-recovery and GHL-enrollment-recovery handlers
- merchant-success handler
- BT-12 logical-job manifest and its validation tests
- metrics/health/admin read models
- database schema and migrations for the hold ledger

## Build sequence

1. Freeze the logical-job inventory at the exact SHA and classify every effect.
2. Add manifest validation: unique logical keys, known physical queues, nonempty owners/producers/handlers, and reviewed effect classification.
3. Add the durable reason-scoped hold ledger and control-epoch fields.
4. Implement the coordinator as a pure planner plus a narrow BullMQ adapter.
5. Add startup reconciliation before workers, repeat schedules, and startup jobs become runnable.
6. Refactor global-pause integration to add/remove only `global_outbound` holds.
7. Refactor manual/operator endpoints to require reason ownership and use the coordinator.
8. Add logical deferral for mixed queues; split handlers where required.
9. Add desired/applied/drift metrics and structured reconciliation events.
10. Add backlog preview and bounded release control.
11. Add CI rules preventing route-level raw pause/resume and unregistered logical jobs.
12. Complete static and runtime gates below.

## Gate checks

### Entry gates

- [ ] Task #1522A authority is merged and verified.
- [ ] BT-12 manifest covers every worker, producer, schedule, and startup registration.
- [ ] Every mixed queue and mixed handler is identified.
- [ ] No test can reach a real provider.
- [ ] Implementation SHA is recorded.

### Exit gates

- [ ] Global pause adds the correct `global_outbound` logical holds.
- [ ] Global clear removes only `global_outbound` holds.
- [ ] Manual, maintenance, incident, automation, and channel reasons survive an unrelated clear.
- [ ] A mixed physical queue continues permitted non-outbound work.
- [ ] A fully held physical queue is paused idempotently.
- [ ] An active job remains unable to send because Task #1522A rechecks at transport time.
- [ ] Startup cannot make workers runnable before control reconciliation.
- [ ] Concurrent opposing changes converge on the highest committed epoch.
- [ ] Redis failure produces `degraded` or `unknown`, not a false applied claim.
- [ ] Database failure does not mutate queue state from an uncommitted intent.
- [ ] Backlog release requires preview and bounded staging.
- [ ] Every released job revalidates current policy.
- [ ] Direct route-level `Queue.pause()`/`Queue.resume()` calls are absent.
- [ ] Runtime verification passes across all deployed worker processes.

## Required tests

### Unit tests

1. Multiple reasons can hold the same logical job.
2. Clearing one reason leaves every other active reason intact.
3. Expiry affects only the expired reason.
4. Lower/stale epochs cannot overwrite higher applied epochs.
5. A physical queue is pausable only when all mapped logical jobs are held.
6. A mixed queue remains runnable when any permitted job type must continue.
7. Desired/applied/reconciliation states serialize correctly.
8. Manifest validation rejects an unclassified or duplicate logical job.

### Integration tests

1. Global pause creates the expected logical holds and pauses only fully held queues.
2. Global clear preserves a pre-existing manual or incident hold.
3. Manual clear preserves a global hold.
4. Redis unavailable during apply yields durable desired state plus degraded reconciliation.
5. Database transaction failure causes no queue-state action.
6. Concurrent true/false changes converge at the winning epoch.
7. Restart reconciles controls before jobs are consumed.
8. An already-active job reaches Task #1522A and is denied before transport.
9. Enrichment/scoring continues while its promotional enrollment effect is deferred.
10. Post-enrichment can complete safe state work without starting a blocked enrollment.
11. Every deployed worker process observes the same logical controls.

### Backlog tests

1. Preview counts and age distributions match seeded jobs.
2. Stale/ineligible jobs are no-op or quarantined, never sent.
3. Release respects configured batch, concurrency, and provider rate limits.
4. Release can be aborted without losing hold ownership.
5. A newly asserted incident hold stops further release without clearing other state.
6. No release burst occurs after process restart.

### Static and CI tests

1. Every QueueManager registration maps to a manifest entry.
2. Every manifest queue and job name maps to an actual registration/dispatcher.
3. Route modules contain no direct raw `Queue.pause()` or `Queue.resume()` calls.
4. No hard-coded six-queue global-pause list is introduced.
5. Mixed-effect handlers require an explicit split/defer review.
6. Tests fail on any real transport configuration.

### Runtime verification

Use a production-shaped staging topology with provider transports stubbed and evidence retained:

- RV-05: toggle global pause across all web and worker processes; verify desired/applied state, active-job denial, and no transport attempts.
- RV-08: inspect queue connection/pooling topology and verify a physical pause cannot stall unrelated logical work.
- RV-15: capture waiting/delayed/active counts, job ages, throughput, and staged-release behavior under a seeded backlog.
- Restart web and worker processes while paused and verify reconciliation precedes consumption.
- Inject database and Redis failures independently.
- Exercise concurrent operator and global controls.

## Kill lines

Stop the build or block release if any condition is true:

1. Queue pause is being treated as the final authorization boundary for sending.
2. Clearing global pause resumes a queue still owned by another reason.
3. The implementation relies on a hard-coded list asserted to contain all outbound queues.
4. A mixed physical queue is paused without proving all of its logical jobs may stop.
5. The settings route initializes QueueManager or starts workers/schedules as a side effect.
6. A response claims queues are paused after a best-effort or unverified Redis operation.
7. Startup allows consumption before reconciliation.
8. Backlog release is automatic, unbounded, or skips current policy revalidation.
9. A direct operator endpoint can call raw pause/resume without reason ownership.
10. Any smoke or integration test can send a real email, SMS, workflow enrollment, or other external message.
11. The exact deployed SHA or multi-process topology is unknown.

## Migration and rollout

This task requires an additive migration for the durable hold ledger unless an equivalent reason-scoped table already exists at implementation time. Do not overload a single global boolean with per-reason state.

Roll out in stages:

1. Ship manifest validation and read-only reconciliation planning.
2. Ship the hold ledger and dual-write desired state while physical actions remain disabled.
3. Compare planned state with observed queue behavior.
4. Enable physical pausing for one proven dedicated queue.
5. Expand only after mixed-queue and ownership tests pass.
6. Enable staged backlog release last.

## Rollback

Disable the optimizer and stop physical queue mutations. Keep Task #1522A enabled and keep the durable hold ledger intact for forensic review. Reconcile physical queues through an explicit operator runbook that previews backlog and respects outstanding non-global reasons. Do not bulk-resume queues as part of rollback.

The additive table may remain unused; dropping it is not required for operational rollback.

## Out of scope

- Replacing the Task #1522A send-time authority.
- Completing the broader consent, DNC, suppression, or channel-eligibility work in BT-10.
- Completing the entire job reliability program in BT-12.
- Redis connection pooling changes unless RV-08 proves they are required.
- Sending or enrolling real contacts during verification.
- Automatically releasing a production backlog.

## Done looks like

Every queued or recurring behavior has a reviewed logical identity and effect classification. Holds are durable, reason-scoped, and ordered by control epoch. Clearing the global switch cannot clear another operator's or subsystem's hold. Mixed queues continue safe work, fully held queues can be paused as an optimization, and backlog release is staged and revalidated. Most importantly, a mistake or outage in this layer still cannot authorize a send because Task #1522A remains the unavoidable final authority.
