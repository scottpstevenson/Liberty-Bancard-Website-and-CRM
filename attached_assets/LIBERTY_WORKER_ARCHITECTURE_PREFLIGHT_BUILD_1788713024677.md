# Liberty Bancard — PREFLIGHT + BUILD
## Permanent worker architecture, selective execution, and truthful CRO-03D verification

Use this entire prompt for one implementation task. Determine the task number from Replit; do not invent one. Complete the preflight, resolve the findings below, and proceed into build within this scope. Do not stop after proposing another plan or finding the first blocker. Keep genuinely external runtime prerequisites explicit without leaving independently buildable work unfinished.

### 1. Objective and operating sequence

Make Liberty's CRM usable independently of background automation, replace unconditional per-task worker startup with a bounded, explicitly selected worker topology, and make runtime verification accurately describe what is running.

The owner wants the working system proven manually before recurring automation. The sequence is:

1. Complete this architecture and verification task.
2. Prove a bounded enrichment cohort, including persisted results and CRM visibility.
3. Run a separate governed contact-to-Lead reconciliation task.
4. Certify sequences using a small held cohort.
5. Activate approved capabilities incrementally, with recurring schedules and sending enabled only when explicitly selected.

`BACKGROUND_JOB_PROFILE=full` is not an acceptable shortcut for passing a ceremony. This task must make selective execution possible without enabling all legacy jobs.

### 2. Audited baseline and evidence limits

Repository: `scottpstevenson/Liberty-Bancard-Website-and-CRM`.

Remote `main` fetched and source audited on September 6, 2026 at:

`8270733fe14cc381d9fd01d525df57f795e98653`

The owner reports #1783, #1784, #1785, #1792 and follow-ups merged/published, and reports the contacts-query performance issue resolved. Preserve those improvements. Do not recreate those tasks or claim their production results were independently measured in this audit.

This is a current GitHub source audit, not a live production database, Redis, provider, or browser certification. The heartbeat defect below was reproduced against the actual pure function using an in-memory Redis substitute. No production jobs, approvals, provider calls, or contact mutations were executed.

Before editing, record current HEAD, origin/main, branch, working-tree changes, lockfile versions, and migration head. Compare newer commits against this baseline and mark findings resolved when the code proves it. Preserve unrelated local changes. Use current source as authority; attached older audits provide history, not a fresh runtime verdict.

### 3. Findings that this build must close

| ID | Source-grounded finding | Required correction |
|---|---|---|
| W01 | `background-profile.ts` supports off/core/full, but `CORE_QUEUE_ALLOWLIST` is an empty source-code array. | Implement validated runtime selection with an empty default and explicit logical capability boundaries. |
| W02 | `queue-manager.ts` constructs a Worker per active queue configuration; 29 configurations exist, plus named schedules and additional named handlers. | Separate logical jobs from physical queues, worker instances, schedules, and producer interfaces. |
| W03 | Numerous queues use the generic job name `run`; enrichment itself handles several unrelated job types. | Preserve logical identity in routing and migrated jobs. Never dispatch solely on an ambiguous old name. |
| W04 | Startup seed/hydration routines and standalone schedulers use broad profile checks; post-initialization statement recovery is outside individual queue selection. | Inventory every reachable startup path and apply explicit capability/schedule gates. |
| W05 | Producer access and the shared Redis getter are coupled to QueueManager initialization. | Support bounded producer/diagnostic connectivity without starting consumers. |
| W06 | `runtime-identity` calls a strict fleet validator with `expectedProcessIdentities: []`; a nonempty valid fleet throws size mismatch and is hidden by the route catch. | Separate discovery completeness from expected-fleet verification. |
| W07 | The ceremony script builds its expected signed worker inventory from the workers it happens to observe. | Obtain expected deployment membership independently; compare observations against it. |
| W08 | Topology hashing describes the full static configuration; heartbeat publication is at manager initialization and does not prove individual consumers are ready. | Hash effective configuration and report actual ready worker coverage. |
| W09 | Heartbeats lack explicit environment/deployment fields, default process identity uses PID, and dev/production BullMQ prefixes are not isolated by the existing test-prefix helper. | Define stable environment namespaces, deployment membership and collision-resistant instance identity. Migrate existing Redis state explicitly. |
| W10 | Processor-level disabled/failed kill-switch checks can return normally, completing a job without running its business work. | Preserve authoritative work in a durable held/deferred state with a reason. |
| W11 | Hold-ledger/coordinator logic addresses logical jobs but includes physical-queue pause behavior, including the winback pilot. | Preserve logical holds when several logical jobs share one physical queue. |
| W12 | GHL sync defaults to frequent scheduling with concurrency 3 although the handler acquires a singleton lease. It combines projection work and legacy scans. | Use one bounded integration consumer, durable projections and separately selected reconciliation. |
| W13 | `server/index.ts` calls startup ceremony artifact creation before HTTP listen. The helper can sign/import approvals using an operator key; subsequent startup code can create attestation/policy. | Remove implicit ceremony authorization from ordinary application boot. |
| W14 | Both ceremony helpers contain embedded pricing assumptions; repeatable installation, queue interval updates, DLQ tools and recovery producers depend on old queue identities. | Preserve approved economic inputs and update every operational caller with the topology change. |

Do not assert that 29 Workers means 29 permanently checked-out PostgreSQL clients. `job-registry.ts` implements leases through bounded `pool.query` operations; a long job or lease is not proof of a connection held for that duration. Redis connection count, PostgreSQL checkout duration, query time, job duration and internal fan-out are different measurements.

### 4. Required preflight closure

Create one evidence table covering each reachable logical job: stable key, producer sites, current queue/name, handler, schedules, effects, retry/backoff, deduplication, domain authority, lease, recovery path, hold behavior and proposed destination.

Include all 29 configurations, all named schedules, every switch branch, route enqueue, startup recovery, admin retry, outbox, webhook handoff, direct scheduler and fallback. Search for `new Worker`, Queue creation, `.add`, `.addBulk`, repeatable/scheduler APIs, `getQueue`, manager initialization, timers and direct handler calls. Distinguish reachable execution from unused definitions.

Specifically trace mixed enrichment jobs: validation intents, campaign queue runs, statement blueprints, free contact enrichment, inbound confirmation follow-up, readiness recalculation, contact scoring, promotional enrollment and their recovery loops. Trace post-enrichment's data/stage work separately from enrollment effects.

Keep provider transport, promotional sends, transactional sends, internal notifications, projections, scoring and infrastructure as distinct capabilities even when their handlers share a physical queue. A job called enrichment or operations is not automatically free of external effects.

Resolve all affected scope, including old producers and admin tools. Do not stop at the worker constructor refactor.

### 5. Preserve existing authorities

Reuse `logical-job-manifest.ts`, `outbound-queue-coordinator.ts`, the hold ledger, fencing/lease tokens, existing outboxes, provider attempts/receipts, CRO-03 approvals, CR-04 qualification, CR-06 campaign governance and later delivery controls.

Keep the existing default-off behavior, fail-closed global pause, sender/channel eligibility, consent and suppression rules. Configuration permits execution only when the domain controls also permit it. It cannot grant provider spending or sending authority by itself.

Preserve #1784 hard bulk delete and #1785 enrichment/vertical fixes. Their jobs, retries and stale callbacks must respect deletion and must not recreate a deleted contact. Do not replace hard deletion with archival or add a new bulk-delete workflow here.

Keep query-performance improvements and API error visibility. Do not represent a failed data request as zero contacts/deals or an empty healthy result.

### 6. Physical topology to implement

Use this as the starting mapping, then resolve handler effects and fairness during preflight. Seven normal groups plus an isolated heavy-work group are a design target, not a claim that a particular count proves capacity.

| Physical queue / Worker group | Existing logical work to route |
|---|---|
| `critical-commands` | deal-stage-effects, chargeback-commands, statement-upload |
| `ghl-integration` | GHL projections, bounded reconciliation, ghl-enrollment-recovery, voicemail-sync; GHL-specific handoffs remain independently gated |
| `enrichment` | cro03a-qualification, discovery, evidence preparation/enrichment, readiness/scoring and post-enrichment data work; paid/live execution routes to its authorized executor |
| `provider-live` | cro03c-live dispatch/recovery and authorized live provider operations; provider permits and budgets remain individual |
| `email-validation` | zerobounce-batch and its recovery/auto-run intent, with independent budget/rate gates |
| `outreach` | sequences, enrollment-recovery, winback-outreach, abandoned-statement, proposal-followup; promotional post-enrichment enrollment routes here or remains separately fenced |
| `operations` | sla-checks, digests, mid-ingestion, onboarding-reminder, activation-monitor, merchant-success, executive-snapshot, health-monitor, pipeline-silence-check, partner-monthly-digest |
| `heavy-maintenance` | db-backup and system-audit; a separate scheduled process is acceptable if it preserves ownership, status and controls |

Preserve operation-specific gates for email/Slack and other side effects inside operations. Avoid starving health checks behind long reports; split long work into bounded resumable units or justify an isolated executor. Do not force dissimilar latency or rate-limit workloads together merely to hit seven.

BullMQ's installed lockfile version is 5.77.0. Use APIs compatible with it. A normal Worker consumes one queue; consolidation means named logical jobs routed through shared queues, not passing an array of queue names to Worker.

### 7. Configuration contract

Keep `BACKGROUND_JOB_PROFILE=off` as the default and initial deployment mode. Implement an explicit selected mode using the existing `core` name if suitable. Do not silently reinterpret existing `full` as selected or enable it during migration.

Provide separately validated configuration for permitted logical jobs/capabilities and permitted recurring schedules. Document exact names and values after implementation. Unknown names, malformed values or impossible dependencies must leave the worker subsystem disabled with a clear diagnostic while the CRM/API remains available where its normal infrastructure permits.

Consumer enablement, recurring scheduling and provider/send permission must be independent. Starting a consumer for a manual canary must not install its normal daily/hourly jobs or run every recovery loop. Dependencies must be explicit; never auto-enable sequences because post-enrichment needs an enrollment handler.

Log the resolved profile, enabled logical keys, physical groups, concurrency and schedules without secrets. Configuration is an upper bound; existing DB holds, kill switches and approvals can further restrict it.

### 8. Central routing and compatibility

Introduce one typed routing authority mapping stable logical keys to versioned physical queues and handlers. Retain existing logical keys where domain records reference them. Translate old `(queueName, jobName)` tuples explicitly.

Use a versioned envelope with logical key, payload version and durable domain/intent identity. Preserve attempts, delay, priority, backoff, correlation and deduplication semantics per job. Namespace migrated BullMQ IDs to prevent collisions across former queues, using characters supported by the installed version.

Update all producers, admin retries, recovery jobs and interval controls. Avoid compatibility wrappers that return a shared raw Queue and allow old callers to enqueue an ambiguous `run`. Unknown types must produce an actionable disposition without invoking a default paid or legacy handler.

Adapt static manifests, queue-compliance checks and observability to understand both logical and physical identity. Do not delete assertions simply because they expose callers that still use the old topology.

### 9. Redis and process lifecycle

Separate bounded producer/diagnostic Redis access from consumer startup. Use managed connections with single-flight initialization, error cleanup and shutdown; do not create one Redis client per HTTP request or initialize all workers from a status route.

Use connection behavior appropriate to each role: HTTP/diagnostic requests must fail within a bounded deadline; long-lived worker connections must meet BullMQ requirements. Keep test isolation. Define production/dev namespace separation using BullMQ's prefix mechanism, not ioredis `keyPrefix`.

A stable environment queue namespace must survive process restarts. Do not put a random boot ID into durable queue names. Environment separation and versioned topology require an explicit old-state migration, not silently abandoning the existing `bull` keys.

Construct and validate the intended topology before consumption begins. On partial initialization failure, close all newly created resources and leave no partially running fleet. Retain singleton initialization protection. Shutdown stops fetching, handles active work within a bounded grace period, closes resources and withdraws readiness/heartbeat evidence.

### 10. Capacity and database protection

Choose initial group concurrency conservatively and enforce internal fan-out limits. Bound DB batches, provider work and recovery scans; release transactions/clients before waiting on remote HTTP or long sleeps. Preserve ownership fences across resumptions.

Document the PostgreSQL and Redis connection budget across maximum web/worker replicas and every pool/client, including deployment overlap. Account for Worker blocking connections and actual constructor behavior. A per-process limit is not a fleet-wide budget.

Keep API headroom and expose pool total/idle/waiting, checkout wait/hold durations where available, logical job duration/outcome, backlog age and provider attempts. Rate-limit repetitive errors and defer work with backoff rather than producing retry storms.

Do not prescribe a larger pool without evidence of the provider's connection limit. Do not claim sustained saturation solely from Worker count. Validate long queries, locks and internal fan-out independently.

### 11. Logical holds and execution outcomes

Shared physical queues must retain per-logical-job hold behavior. A hold on winback must not pause unrelated outreach recovery, and an allowed scoring job must not release enrollment work beside it.

Resolve hold-ledger epochs/source keys and global pause at execution and at the existing irreversible-effect boundary. Physical pause is permitted only when its effect matches the complete intended group state.

A skipped authoritative command must remain recoverable with a reason. A disposable periodic wakeup may finish only when the durable underlying work remains unconsumed and that distinction is explicit. Do not report business success merely because the BullMQ callback returned.

DB-exhaustion deferral must preserve attempts/accounting and distinguish work before transport from uncertain work after transport. Reconcile uncertain provider effects using existing receipts/idempotency rather than blindly replaying them. Never make up a job lock token to move a job.

### 12. Startup, schedulers and direct-call coverage

Audit `server/index.ts`, merchant/boarding route initialization, `triggerOutboxTick`, QueueManager post-init recovery, maintenance/content schedulers, legacy GHL/SLA/MID paths, SDR orchestration and other reachable timer-driven loops.

Off mode starts no business consumers, recurring business jobs, startup recovery drains, GHL workflow hydration or approval ceremony. Keep necessary infrastructure such as HTTP serving, authentication, lease renewal for already authorized work, and non-invasive pool telemetry correctly scoped. Do not indiscriminately remove timers.

Do not weaken required schema/policy convergence checks. Separate their legitimate startup role from optional business seeding and approval generation.

Schedule identity is per logical job, not merely per physical queue. Updating one cadence must preserve sibling schedules. Make installation idempotent across replicas/restarts with deterministic IDs. Disable old repeat definitions only as part of the reconciled migration; removing a schedule does not necessarily remove its already-created delayed job.

### 13. Pending-job migration and rollback

Implement a dry-run inventory plus an explicit, resumable migration mechanism before switching production routing. Inventory waiting, delayed, active, paused, waiting-children/dependency, failed/DLQ and repeatable/scheduler state; distinguish completed history and durable database intents.

For every old logical job define whether it is drained in place, transferred, regenerated from a durable intent, retained held, or requires reconciliation. Preserve exclusions, holds, attempts, due dates, deduplication and dependency relationships. Do not copy an active job into a new queue while the old consumer can still execute it.

Use a durable migration ledger and version/ownership fence. Prove crash recovery between enqueueing a replacement and retiring the old delivery. Preserve domain-level idempotency because BullMQ delivery alone does not guarantee exactly-once external effects.

Cutover must fence old producers/consumers during rolling deployment, direct new intent delivery consistently, and avoid losing jobs written during the transition. Unknown or uncertain records remain visible and held with a reason. Never use blanket queue obliteration, draining or deletion as migration.

Rollback stops the new route, reconciles migrated and executed records, and resumes only the correct remaining authority. It must not replay effects already completed by the new worker. Provide counts and identifiers sufficient to reconcile every migration disposition without exporting contact payloads.

### 14. GHL integration correction

Use concurrency 1 initially for the physical GHL integration consumer. Separate durable `contact_provider_projections` processing from legacy broad contact/opportunity synchronization. Preserve projection ownership, leases, retry timing and terminal dispositions; the legacy scan cannot bypass them.

Use authenticated webhooks as the primary inbound event path where supported by the existing integration. Keep bounded, cursor-based reconciliation for missed events, initially disabled; a documented 15–60 minute cadence can be selected later after volume/latency evidence. Projection event processing must not wait for the reconciliation cadence.

Avoid fetching every projection-owned contact ID for each small projection batch. Use bounded/indexed membership checks appropriate to the actual schema.

Project only contacts passing existing production classification, identity, approval and eligibility rules. Do not sync the entire legacy/unknown population, resurrect deleted test contacts or overwrite Replit-owned consent fields from GHL.

GHL enrollment recovery and voicemail synchronization retain individual controls. Moving them into one physical queue must not enable them automatically. Preserve the existing circuit breaker and approved outbound boundary; no new raw GHL-send bypasses.

### 15. Runtime discovery and fleet attestation

Separate these concepts in code and API output:

- Connectivity: Redis can be reached within a deadline.
- Discovery: the bounded scan completed and returned observations.
- Expected topology: independently configured/approved deployment membership and required consumer capabilities.
- Verification: observations exactly satisfy that expectation for the intended release and environment.

The current reproduction is decisive: with one valid fake heartbeat, the route's empty expected list produces `CRO03C_WORKER_FLEET_SIZE_MISMATCH`; supplying the matching identity succeeds. Add a regression test for the route contract, not only the low-level validator.

Off mode may correctly report zero workers and a healthy HTTP role. It must not certify readiness for a provider-worker ceremony. Discovery completeness alone must never authorize activation.

Heartbeat evidence must bind release SHA, environment, deployment, stable instance/ordinal identity, boot identity, effective topology digest and actual ready logical/physical coverage. Distinguish process count from Worker-instance count; one process can host several groups. Do not use PID alone as deployment membership.

Handle stale, foreign, duplicate, missing and unexpected workers explicitly. Apply a bounded deadline to both scanning and payload reads. A rolling deployment needs an explicit expected membership policy; it cannot hide extra consumers by redefining expectation to whatever was observed.

Hash effective routing/configuration and relevant schedule/concurrency settings deterministically, excluding timestamps and secrets. Invalid or changed evidence must invalidate the applicable attestation through existing mechanisms.

### 16. Ceremony and startup authorization

Remove automatic signing/import of approvals and activation-policy creation from ordinary application startup. The presence of an operator private key and `RELEASE_SHA` is not a request to authorize provider execution on every boot.

Refactor `cro03d-run-ceremony.ts` into a read-only preflight by default and an explicit governed apply path. Before any approval import or policy write, verify target URL, exact deployed SHA, environment/deployment, required migrations/policies, selected worker coverage, approved pricing/budgets, global pause and external prerequisites.

Expected deployment inventory must come from independently established deployment configuration or the existing trusted operator workflow. Observed heartbeats may be displayed for comparison; they cannot define expectedCount and thereby certify their own completeness.

Preserve Ed25519 trust verification and existing approval dimensions. Use explicit approved pricing input; embedded plausible prices are not economic authorization. Do not fabricate signatures, receipts, successful canaries or production evidence to make the ceremony pass.

Correct retry/idempotency behavior across reboots and expired attestations. An expired artifact replay must not be reported as a fresh valid ceremony. Retain immutable history and distinct authorized renewal identity where required.

The architecture build tests this with isolated fixtures. Real provider canaries and activation remain a separately reviewed execution step. The script must check and report actual outbound pause state rather than merely printing that outreach remains paused.

### 17. Manual proof before recurring enrichment

Provide an operational path to select only the dependencies needed for a bounded manual cohort while all recurring schedules remain disabled. Starting that path must not run the legacy enrichment sweep, sequence dispatcher, GHL sync or all recovery loops.

Show each provider's state separately: disabled, awaiting authorization, queued, held, running, no-result, rejected match, failed, persisted. OpenAI classification is not proof of a verified email/phone or completed provider chain.

Retain CRO-03 staging/provenance and approved mutation projections. Confirm company, contact name, email, phone and vertical values are written/read through their canonical fields and visible after refresh. Preserve existing manual overrides and uncertainty; do not invent identities to fill empty fields.

The later 500-entity Serper test from #1768 remains a measured yield requirement if that task's acceptance is still outstanding. Do not claim it passed from mocked tests or spend production credits during this architecture build.

### 18. Contact-to-Lead and sequence handoff

This task delivers the execution architecture needed for these stages; it does not silently promote the 150K+ population or enroll it.

The next governed reconciliation should report actual counts for production/test/unknown identity, completeness, contactability, vertical/readiness/scoring, duplicate/suppression exclusions, existing Lead links and proposed new links. Preview and approve a frozen eligible cohort and use idempotent canonical linkage. Do not create a deal for every contact.

Then certify a small held sequence cohort: qualification, preparation, content/sender selection, stop-on-reply, unsubscribe/suppression, deduplication, recovery, attribution and visibility. Keep real sending off until the approved sequence activation step.

Final activation order is bounded enrichment, validation/readiness, post-enrichment data work, then approved enrollment/sequences. GHL activates only for the capabilities actually required. Recurring schedules are a separate choice at each stage.

### 19. Admin and CRM behavior

Update existing operations surfaces instead of adding a new navigation tree. Show physical group, logical job, selected/disabled/held state, actual readiness, schedule status, last outcome and actionable failure reason.

Update queue metrics, DLQ retry/discard, interval controls and old queue links. Legacy and migrated work must remain traceable without double counting. Actions operate on the intended logical job and preserve authorization; a missing consumer should produce an explicit unavailable/held result, not an unhandled 500.

Keep sensitive configuration and approval controls admin-only. Employees should see useful processing state without needing to interpret Redis topology. Contacts, Leads, pipeline, login and dashboard must work with business workers off.

### 20. Verification required before code-complete

Use the repo-supported Node/toolchain and BullMQ 5.77.0. Run meaningful behavior tests in isolated PostgreSQL/Redis namespaces; no fixtures in production and no real provider sends.

Required coverage:

1. Missing/invalid/off configuration starts zero business consumers/schedules; HTTP diagnostics do not start them.
2. Selected configuration creates exactly the intended physical groups and logical permissions; no sibling capability is implicitly enabled.
3. Producer-only and diagnostic connectivity are bounded; concurrent initialization and partial failure leak no clients/workers.
4. Every old producer tuple routes correctly, including collisions between generic `run` jobs and all mixed enrichment branches.
5. Per-logical retries, budgets, holds and pause/resume semantics survive consolidation; DB failure cannot mark an unexecuted command successful.
6. Schedule updates and restart installation preserve sibling jobs and avoid duplicate schedules.
7. Migration conserves all nonterminal work; crash/retry, active-job overlap, delayed jobs, dependencies, DLQ, old-producer races and rollback are exercised.
8. Provider-effect uncertainty uses existing idempotency/receipt reconciliation; no duplicate simulated effect during cutover or rollback.
9. Runtime discovery empty/nonempty, explicit expected inventory, foreign/stale/duplicate identities, missing group coverage, digest drift and Redis timeouts yield correct verdicts.
10. Web startup cannot create approval artifacts/policies; ceremony preflight performs no writes; expired or wrong-release evidence fails apply.
11. Existing contact hard-delete, canonical data, consent, sender-policy, CRO-03 and campaign controls still pass affected regressions.
12. Repeated login/contacts/Leads/pipeline/dashboard requests remain responsive during a representative bounded worker workload. Report latency, pool waiters, errors, connections and backlog drain rather than a single idle snapshot.

Run relevant existing background-profile, Redis-topology, queue-compliance, CRO-03C/03D and outbound-boundary suites, plus `npm run check` and build. Report exact commands, outcomes and any established baseline failures separately. Never weaken tests or use broad suppressions to produce green output.

### 21. Deployment and acceptance

Deliver reviewed code and a concrete runbook before requesting any deployment decision. Retain the user's existing deployment permissions; do not add redundant approval loops. This prompt alone does not authorize production queue migration, contact writes, provider spend or outreach.

The deployment runbook must specify the exact commit, configuration, namespace transition, migration preview/results, expected consumers, rollback and evidence collection. Initial web deployment stays off. A later explicitly selected worker validation can enable only its required capabilities with schedules/sending held.

Acceptance requires measured behavior: no recurring connection timeout storm, bounded backlog processing, preserved jobs/holds, accurate fleet verdicts, stable CRM/API under representative load, and a manual execution path that does not activate unrelated automation. Establish numerical latency/headroom thresholds from the actual deployment capacity before the load run; report the measured results against them.

Code-complete, deployed, runtime-verified, provider-verified and outreach-enabled are distinct statuses. State exactly which were achieved. Do not claim “100% ready” because tests passed or workers heartbeat.

### 22. Final handback

Return one concise completion packet containing:

- Baseline and final SHA, files/migrations changed, and W01–W14 disposition with evidence.
- Complete logical-to-physical map, exact supported configuration and a manual-only example.
- Resource budget, schedule ownership, hold/retry behavior and migration/rollback instructions.
- Test results and unresolved external runtime prerequisites.
- Deployment verification commands and expected readouts, with no secret values.
- The concrete next step: bounded enrichment proof, followed by contact-to-Lead reconciliation and held sequence certification.

Do not create a proliferation of follow-up tasks for defects required to finish this architecture. Complete the dependency chain in this task and distinguish the intentionally later business-activation stages.

### 23. Source anchors for this prompt

These links are pinned to the audited commit; inspect updated equivalents at build time.

- [Background profile](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/blob/8270733fe14cc381d9fd01d525df57f795e98653/server/services/background-profile.ts)
- [Queue configuration, dispatch, schedules, recovery and topology](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/blob/8270733fe14cc381d9fd01d525df57f795e98653/server/services/queue-manager.ts)
- [Logical manifest](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/blob/8270733fe14cc381d9fd01d525df57f795e98653/server/services/logical-job-manifest.ts)
- [Hold coordinator](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/blob/8270733fe14cc381d9fd01d525df57f795e98653/server/services/outbound-queue-coordinator.ts)
- [Redis connections](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/blob/8270733fe14cc381d9fd01d525df57f795e98653/server/services/queue-connection.ts)
- [Job leases](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/blob/8270733fe14cc381d9fd01d525df57f795e98653/server/services/job-registry.ts)
- [Application startup](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/blob/8270733fe14cc381d9fd01d525df57f795e98653/server/index.ts)
- [GHL sync and durable projections](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/blob/8270733fe14cc381d9fd01d525df57f795e98653/server/services/ghl-sync.ts)
- [Runtime identity route](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/blob/8270733fe14cc381d9fd01d525df57f795e98653/server/routes/cro03.ts)
- [Heartbeat validator](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/blob/8270733fe14cc381d9fd01d525df57f795e98653/server/services/cro03/runtime-heartbeat.ts)
- [Signed deployment inventory](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/blob/8270733fe14cc381d9fd01d525df57f795e98653/server/services/cro03/deployment-inventory.ts)
- [Startup ceremony](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/blob/8270733fe14cc381d9fd01d525df57f795e98653/server/services/cro03-startup-ceremony.ts)
- [Operator ceremony script](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/blob/8270733fe14cc381d9fd01d525df57f795e98653/scripts/cro03d-run-ceremony.ts)

BullMQ's official documentation distinguishes shared Redis connections from the blocking connections needed by workers; this informs the resource budget, not a PostgreSQL root-cause claim: [Connections](https://docs.bullmq.io/guide/connections). Concurrency must also account for multiple running workers/processes: [Concurrency](https://docs.bullmq.io/guide/workers/concurrency). Confirm API details against the installed version before implementation.
