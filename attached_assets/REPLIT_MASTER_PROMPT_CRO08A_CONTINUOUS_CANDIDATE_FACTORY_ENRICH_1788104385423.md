# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD — CONTINUOUS PRODUCTION SCHEDULES REMAIN PAUSED UNTIL AUTHORIZED

Task: **CRO-08A — Continuous Candidate Factory & Enrichment Operations**

Verify the task against current main and the final CRO-03A/B/C contracts. If valid after corrections, continue directly into implementation. Do not stop after a plan unless a genuine prerequisite prevents safe work.

One severe finding is not permission to stop the census. Audit every discovery/enrichment scheduler, source cursor, worker, queue, provider budget, refresh/backfill path, restart fallback, dead letter, feature flag, and operator control before finalizing the build.

The latest verified drafting reference is `origin/main` at `773c50d13584578045026c5923b59ff5c7994a22`, migration head `0194`, with CRO-03A and CRO-03B merged. CRO-03C Task #1731 is the remaining provider-activation prerequisite. At execution time, verify CRO-03C's exact merged contracts and live-canary disposition rather than assuming them.

Required sequence:

Baseline → prerequisite gate → VFC → scheduler/source/provider census → authority and state-machine verification → capacity/economics/privacy checks → preflight verdict → corrected plan → implementation default-paused → disposable restart/backfill certification → read-only runtime packet → post-build census → final VFC.

## 1. REPOSITORY BASELINE

Capture:

- branch/HEAD/origin and dirty state;
- migration head/journal;
- CRO-03A/B/C authoritative SHAs and schema/service contracts;
- queue-manager/job-registry/scheduler-registry current owners;
- Redis queue mode/topology and health using safe metadata only;
- provider activation/readiness state and budget configuration names, never values/secrets;
- current discovery/Sunbiz/enrichment/re-enrichment/backfill feature flags;
- latest scheduler/job heartbeats and run receipts if runtime access is available;
- CI/pre-deploy suite registrations.

Do not activate a provider or production schedule merely to inspect it.

## 2. PREREQUISITE AND NON-DUPLICATION GATE

Verify:

| Required contract | Owner | CRO-08A use |
|---|---|---|
| Qualified candidate/selection identity | CRO-03A | Schedule source observations and qualification runs; do not fork policy. |
| Recipe/gap/evidence/arbitration/projection | CRO-03B | Invoke exact versioned plans; do not invent a second pipeline. |
| Provider readiness, activation, budgets, canary receipts | CRO-03C | Consume explicit activation records; never infer from key presence. |
| Canonical contact/business writer | CRO-02/CRO-03B | Use only through 03B. |
| Consent/contactability/readiness | Existing authorities | Recalculate through owners; do not mutate flags directly. |
| CR-04/CR-06 | Campaign authorities | No membership, preparation, release, or sending side effects. |

If CRO-03C is not merged, CRO-08A is not integration-ready. Replit may complete a corrected read-only census/design or isolated scheduler primitives only if explicitly authorized, but must not build against invented activation, canary, budget, or provider-operation interfaces. Do not reopen or replace merged CRO-03B contracts.

## 3. VERIFIED FROM CODE — PREFLIGHT

Produce:

| ID | Claim | Verdict | Verified reality | Evidence |
|---|---|---|---|---|
| VFC-01 | One registry owns every recurring discovery/enrichment schedule | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |
| VFC-02 | “discovery” has one unambiguous job identity | ... | ... | ... |
| VFC-03 | Restart installs each intended schedule exactly once | ... | ... | ... |
| VFC-04 | Source cursors/checkpoints are durable | ... | ... | ... |
| VFC-05 | Refresh/backfill is gap- and freshness-driven | ... | ... | ... |
| VFC-06 | Provider daily/monthly budgets are atomically enforced | ... | ... | ... |
| VFC-07 | No-result differs from execution failure | ... | ... | ... |
| VFC-08 | Queue/worker leases survive restarts safely | ... | ... | ... |
| VFC-09 | Dead letters and reconciliation are operator-visible | ... | ... | ... |
| VFC-10 | Candidate operations have zero campaign/send side effects | ... | ... | ... |

## 4. COMPLETE SCHEDULER, TIMER, AND WORKER CENSUS

Inventory all:

- BullMQ repeatable jobs/job schedulers;
- automation/job registry entries;
- `setInterval`/`setTimeout`/cron/node-schedule paths;
- startup reconciliation and degraded fallbacks;
- queue workers and multiplexed queue sub-jobs;
- manual/admin run endpoints;
- one-off backfill scripts;
- provider-specific recurring loops;
- post-enrichment/scoring/readiness hooks;
- pause/resume and live interval controls.

Produce:

| Logical job | Current identities | Trigger owners | Queue/worker | Lock/lease | Checkpoint | Side effects | CRO-08A disposition |
|---|---|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | ... | ... | preserve / migrate / fence / retire |

No schedule may remain merely because it is “legacy but harmless.” Classify it.

## 5. COMPLETE SOURCE AND CURSOR CENSUS

At minimum cover:

- Sunbiz/registry incremental discovery;
- qualified local source stores from CRO-03A;
- public web freshness checks;
- Serper, Outscraper, Apollo, AI, and ZeroBounce work through CRO-03B/C;
- CSV/provider-row consumption where authorized;
- stale canonical records requiring evidence refresh;
- failed/retry-wait/no-result/review-required subjects;
- selective historical backfills.

For each source freeze cursor semantics, ordering key, overlap window, checkpoint transaction, replay behavior, source deletion/update handling, observed-at semantics, expected yield, and legal/terms/rate constraints.

## 6. VERIFIED ROOT CAUSE

Explain whether current issues arise from:

- overlapping in-process and BullMQ schedules;
- ambiguous logical names such as `discovery`;
- in-memory cursors/flags;
- queue multiplexing and Redis pressure;
- provider-specific workers bypassing the CRO-03 plan/economics contract;
- missing denominator/yield semantics;
- conflation of provider success with facts found;
- backfills without exact budgets or frozen populations.

Provide assumption/reality/correction evidence.

## 7. SOURCE-OF-TRUTH AND JOB OWNERSHIP MAP

The required pipeline is:

```text
versioned schedule definition
→ durable logical occurrence
→ source cursor window
→ CRO-03A qualification request
→ CRO-03B gap/recipe plan
→ CRO-03C-authorized provider operations
→ arbitration/projection/validation
→ reconciliation and quality/economics receipt
```

CRO-08A owns schedules, occurrences, cursors, refresh/backfill selection, budgets at operational scale, leases, recovery, and operator controls. It does not own provider-specific enrichment logic or canonical projection.

## 8. VERSIONED SCHEDULE DEFINITION

Each recurring job needs an immutable definition containing:

- logical job key and purpose;
- source/recipe/policy versions;
- cadence/time zone/window;
- max batch and concurrency;
- cursor/overlap semantics;
- provider/budget/cap constraints;
- timeout/lease/heartbeat/retry/dead-letter policy;
- activation state, epoch, actor, reason, and expiry where applicable;
- expected downstream authority;
- safe pause/cancel behavior;
- definition hash.

Use one compare-and-set active pointer per logical schedule. Startup reconciliation must install exactly the active definition and remove only exact obsolete identities.

## 9. DURABLE OCCURRENCE, CURSOR, AND CHECKPOINT CONTRACT

Persist one logical occurrence per scheduled time window. Requirements:

- uniqueness on logical job/definition/window;
- occurrence created before work claim;
- source snapshot/window and `asOf` frozen;
- cursor advances only after the corresponding durable selection/receipts commit;
- overlap windows deduplicate by source-event identity;
- crash before checkpoint replays safely;
- partial pages/batches remain resumable;
- source out-of-order events are handled deterministically;
- cancellation preserves completed evidence and stops unclaimed work;
- manual rerun references the original occurrence or creates a reasoned new revision.

## 10. REFRESH, STALENESS, AND SELECTIVE BACKFILL POLICY

Build versioned policies for:

- source observation TTL;
- identity/vertical/domain/contact/email freshness;
- provider-specific TTL and cost;
- material change invalidation;
- no-result cooldown;
- retryable/terminal failure cooldown;
- review-required re-entry;
- contact/email generation changes;
- existing customer/opportunity/suppression exclusions.

Do not call every provider for every record. The CRO-03B gap planner must select the cheapest justified recipe. A changed evidence generation may invalidate future readiness, but must not mutate frozen CR-04 cohorts or CR-06 preparations.

Backfills require a frozen population, dry-run counts, estimated calls/cost, exclusion reasons, max batch, approval revision, and resumable receipt.

## 11. PROVIDER ECONOMICS AND BUDGET AUTHORITY

Use CRO-03C provider activation/readiness and accounting. At operational scale enforce atomically:

- per-provider minute/hour/day/month requests;
- monetary daily/monthly caps;
- per-source and per-recipe caps;
- per-record/provider TTL/cooldown;
- concurrent in-flight limits;
- circuit-breaker and rate-limit state;
- budget reservation before provider attempt;
- terminal cost reconciliation and reservation release.

Key presence is not authorization. Missing/stale readiness, unknown pricing, exhausted budget, open circuit, or unmatched environment must produce a durable blocked receipt.

## 12. QUEUE TOPOLOGY, CAPACITY, LEASES, AND RECOVERY

Preflight must decide whether current queue multiplexing can meet isolation requirements. Do not create gratuitous queues, but revenue-critical candidate work must not be starved by unrelated statement, scoring, or promotional jobs.

Require:

- one worker owner per queue/job type;
- stable job IDs and deduplication;
- database lease plus fencing token for material operations;
- heartbeat and stale-lease recovery;
- bounded concurrency/backpressure;
- retry classes with jitter and maximum attempts;
- dead-letter terminalization with CR-05/operator escalation;
- startup reconciliation and graceful shutdown;
- no in-process fallback that duplicates an active BullMQ schedule;
- explicit degraded state when Redis is unavailable.

## 13. OUTCOME SEMANTICS AND DENOMINATORS

Standardize immutable outcomes:

```text
eligible
selected
attempt_reserved
attempted
provider_success_no_result
provider_success_facts_found
retry_wait
review_required
blocked_budget
blocked_readiness
failed_terminal
projected
validated
```

Reports must expose denominators for source rows, unique subjects, selected, attempted, provider success, facts found, verified fields, canonical projections, qualified contacts, and cost. Never call `NO_RESULT` a provider failure or call an attempted row enriched.

## 14. DATA / SCHEMA / MIGRATION CHECK

Prefer the existing provider operation/run/attempt/observation and CRO-03 tables. Add only minimum operational authorities for schedule definitions, active pointers, logical occurrences, cursor checkpoints, backfill approvals, and aggregate reconciliation if not already present.

Require additive migrations after current head, SQL/schema parity, unique constraints, claim indexes, immutable terminal evidence, fresh/apply-twice/upgrade/recovery tests, and no destructive production backfill. Frozen CRO-03A/B/C evidence must remain immutable.

## 15. AUTHORIZATION, PRIVACY, AND SOURCE COMPLIANCE

Certify:

- admin-only policy activation, provider budget change, backfill approval, and destructive cancellation;
- manager read/run permissions only where current capability policy allows;
- agent/public denial;
- service-principal identity for workers;
- 404-style IDOR and CSRF;
- bounded/redacted operator queries;
- no raw emails, phones, addresses, website content, provider payloads, prompts, or secrets in logs/audit metadata;
- SSRF/robots/terms/rate policies remain enforced through CRO-03B/C;
- source purpose/retention and deletion events are preserved.

## 16. EXTERNAL SIDE-EFFECT ORDERING

Required provider-call order:

```text
active schedule + occurrence
→ frozen source window
→ CRO-03A/B plan
→ readiness and budget reservation
→ provider operation + attempt persisted
→ transport call
→ observation/receipt/accounting terminalized
→ arbitration/projection through CRO-03B
→ cursor/checkpoint reconciliation
```

No provider call may occur from a scheduler merely because a key exists. Production recurring schedules and paid calls remain paused unless the task contains separate explicit activation authority. Campaign enrollment, CR-06 preparation/release, and outbound sending are forbidden.

## 17. OPERATOR UI AND OBSERVABILITY

Extend the existing Lead Ops/Data Quality/automation surfaces rather than adding redundant top-level navigation.

Show:

- active schedule definitions and next/last occurrence;
- cursor/checkpoint lag;
- eligible/selected/attempted/found/projected denominators;
- provider readiness, circuit, rate, budget, spend, and yield using redacted aggregate data;
- queue wait/active/retry/dead-letter/heartbeat state;
- blocked reason distributions;
- refresh/backfill dry run and approval;
- pause/resume/cancel/retry controls gated by capability;
- exact release SHA and policy/recipe versions.

## 18. PREFLIGHT VERDICT

Use exactly one: BUILD-READY, BUILD-READY WITH CORRECTIONS, PREFLIGHT REQUIRED, NOT BUILD-READY, NOT NEW TASK, or WATCH.

If CRO-03B/C contracts are absent, do not integrate against guesses. If runtime credentials/budgets are absent, complete default-paused code and disposable certification, then report production activation pending.

## 19. CORRECTED BUILD PLAN

State verified What & Why, Done Looks Like, exact current owners/files, migrations, rollout, rollback, legacy paths to retire, blocking corrections, and follow-up hardening. Do not propose new tasks for task-owned scheduler/cursor/budget/recovery corrections.

## 20. IMPLEMENTATION PHASES

1. Freeze scheduler/source/provider census.
2. Reconcile CRO-03A/B/C interfaces and version identities.
3. Add schedule/occurrence/cursor/backfill operational schema.
4. Implement pure due-window, refresh, and backfill evaluators.
5. Implement occurrence claims, checkpoints, leases, and startup reconcile.
6. Bind CRO-03 provider reservations/attempts and exact outcome semantics.
7. Migrate/retire duplicate timers and manual loops.
8. Add dead-letter/reconciliation and operator UI.
9. Add disposable restart/concurrency/budget certification.
10. Leave production recurring activation paused and emit readiness packet.

## 21. KILL LINES

- KILL LINE: If restart can install or run two owners for one logical schedule, the task has FAILED.
- KILL LINE: If a cursor can advance before durable selection/receipts commit, the task has FAILED.
- KILL LINE: If paid provider I/O can occur without CRO-03C readiness, atomic budget reservation, operation, and attempt records, the task has FAILED.
- KILL LINE: If a backfill population/cost/cap is not frozen and approved before execution, the task has FAILED.
- KILL LINE: If all providers are called indiscriminately or no-result is reported as failure/enriched, the task has FAILED.
- KILL LINE: If the task creates a second enrichment/projection pipeline, the task has FAILED.
- KILL LINE: If any campaign, CR-06, or external messaging side effect occurs, the task has FAILED.
- STOP if certification logs raw PII, provider payloads, credentials, or crawled content.

## 22. IMPLEMENTATION RULES

Use existing CRO-03 and queue/job authorities. No `db push`, broad queue rewrite without evidence, dependency churn, production configuration mutation, historical evidence deletion, or automatic live backfill. Stable identifiers, canonical hashes, UTC window semantics, explicit time zones, and epoch/version rules are mandatory.

## 23. TEST REQUIREMENTS

Cover:

- due-window/time-zone/DST boundaries;
- startup/restart/concurrent scheduler registration;
- exact obsolete schedule removal;
- empty/full/partial/out-of-order source pages;
- cursor crash before/after commit;
- duplicate occurrence and manual rerun;
- stale/fresh/no-result/retry/terminal policies;
- material evidence change;
- provider readiness drift and key-only denial;
- budget/cap concurrency and reservation recovery;
- Redis outage, lease expiry, worker crash, dead letter, and resume;
- backfill dry-run/apply/replay/cancel;
- authorization/IDOR/CSRF/redaction;
- zero CR-04/CR-06/campaign/send mutations.

## 24. DISPOSABLE CERTIFICATION

Use fresh disposable PostgreSQL and isolated Redis. Network must be denied; injected fake providers model success/facts, success/no-result, rate limit, retryable error, terminal error, timeout, and circuit open.

Prove:

- migration fresh/apply-twice/upgrade;
- exactly one logical occurrence under multiple processes and restarts;
- no skipped/duplicated source event across cursor recovery;
- budgets never oversubscribe;
- provider outcomes and costs reconcile;
- selective gap plan avoids unnecessary calls;
- dead letters are visible/retryable with immutable history;
- backfill cap holds under concurrency;
- production activation remains paused;
- external network/provider/message count is zero;
- CR-04 cohorts and CR-06 rows remain unchanged.

## 25. READ-ONLY RUNTIME VERIFICATION, POST-BUILD SEARCHES, AND GATES

Where access exists, produce a timestamped read-only packet: schedule/occurrence/cursor state, queue metrics and heartbeats, provider readiness booleans, budget availability, last successful attempt, denominator funnel, redacted failure reasons, and release SHA. Do not infer activity from UI/config alone.

Re-run timer/scheduler/manual-run/provider-call censuses. Prove no duplicate owner or legacy bypass remains.

Run migration integrity, targeted suites, queue topology/restart tests, provider readiness/accounting tests, authorization/CSRF/API scans, typecheck/build, suite-manifest/pre-deploy registration, and `git diff --check`. Review the full diff for unrelated or unsafe changes.

## 26. FINAL VFC AND RESPONSE

Map every requirement and kill line to evidence and a gate. Return verdict, starting/ending SHA, migration head, full owner census, changed files, migrations, test totals, disposable receipts, zero-side-effect proof, authorization matrix, default-paused evidence, runtime readiness packet, and remaining owner inputs/bound OPS-09A activation.

Distinguish:

- code complete;
- production connected/provider-canary proven by CRO-03C;
- continuous schedules enabled;
- external outreach enabled.

Do not call fake providers production verification.

---

# TASK TO PREFLIGHT + BUILD

## CRO-08A — Continuous Candidate Factory & Enrichment Operations

### What & Why

CRO-03A/B/C establish qualified source identity, enrichment recipes, evidence/arbitration/projection, and governed provider activation. CRO-08A turns those contracts into one continuous, observable, budgeted operating factory with durable schedules, cursors, selective refresh/backfill, exactly-once logical occurrences, restart recovery, dead letters, and truthful economics—without inventing a second pipeline or triggering outreach.

### Done Looks Like

- One versioned registry owns every recurring candidate/enrichment schedule.
- Each logical schedule occurrence runs at most once and survives restarts.
- Source cursors/checkpoints are durable and replay-safe.
- Refresh/backfill is freshness-, gap-, and economics-driven.
- Provider readiness/budgets/caps are atomically enforced through CRO-03C.
- Outcomes distinguish eligibility, attempt, no result, facts found, failure, projection, and validation.
- Operators can pause, inspect, reconcile, and retry safely.
- Production schedules remain paused until authorized; certification performs no external I/O.
- No campaign, CR-04, CR-06, or send side effect occurs.

### Out of Scope

- redefining CRO-03A qualification, CRO-03B recipes/arbitration/projection, or CRO-03C provider activation;
- final outbound delivery;
- merchant onboarding/processor boarding;
- broad production backfill or spend without an explicit approved population/budget;
- rewriting frozen historical evidence.

### Relevant Files and Areas to Verify

- CRO-03A/B/C services, routes, schema, tests, provider operation/attempt/evidence tables
- `server/services/queue-manager.ts`, `server/services/job-registry.ts`, startup reconciliation and `server/index.ts`
- lead-discovery, Sunbiz, enrichment, post-enrichment, scoring/readiness, ZeroBounce workers
- provider controls/readiness/accounting/budget services
- admin/Lead Ops/Data Quality/queue/dead-letter UI and routes
- `shared/schema.ts`, migrations, pre-deploy and CI suite manifests

### Existing Kill Line

KILL LINE: No recurring or backfill operation may call a provider without an exact CRO-03 plan, current CRO-03C activation/readiness, atomic budget reservation, and durable operation/attempt evidence; no such operation may create outreach side effects.

## FINAL DIRECTIVE

Do not merely add another cron. Verify and consolidate the entire logical ownership surface, build the complete default-paused operating authority, certify restart/concurrency/economics/recovery on disposable infrastructure, and finish with no task-owned blocker and no external provider/message side effect.
