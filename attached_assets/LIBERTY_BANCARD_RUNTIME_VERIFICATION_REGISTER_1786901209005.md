# Liberty Bancard Runtime Verification Register

**Static SHA:** `68eae86cbb938c6448de7ae792c24381177263f7`  
**Created:** 2026-08-16  
**Current register state:** All rows pending unless evidence is appended with environment, timestamp, release SHA and operator.

This register contains claims that repository inspection cannot prove. Run checks read-only whenever possible. Any test that needs mutations must use an isolated test database/Redis namespace and fake transports. Never lift real pauses or send to a real recipient.

## Evidence format

For every completed row record:

- UTC timestamp and environment name;
- exact deployed SHA and process/release identity;
- command/query/dashboard endpoint used;
- redacted result and counts;
- operator/reviewer;
- pass/fail and linked incident/build task;
- expiry/recheck cadence.

## P0 — #1548 and outbound safety

| RV ID | Runtime claim | Safe verification | Pass criteria | Failure action |
|---|---|---|---|---|
| RV-1548-01 | Exact release deployed | Read deployment metadata and health/build endpoint. | Every outbound-capable process reports full SHA `68eae86c…`; no mixed old process. | Stop; redeploy/reconcile before any other claim. |
| RV-1548-02 | Migrations 0133–0139 applied | Read migration ledger and `information_schema`; do not run migrations during evidence capture. | Ledger/head match; pause, in-flight, ZB, hold, intent fields/FKs/indexes exist; no future/duplicate anomaly unexplained. | Keep paused; repair migration truth. |
| RV-1548-03 | Isolated pause cycle works | Run #1548B only with distinct approved test DB, unique Redis prefix, fake providers and opt-in. | All assertions pass; cleanup proves no shared state touched; artifact attached to SHA. | Fix state machine/test; never run against shared DB. |
| RV-1548-04 | Coordinator convergence | Read `/api/admin/queue-holds` and DB reconciliation state across processes. | Desired/observed states and epochs agree or explicitly report degraded; no hidden bigint/500 error. | Keep logical/send gates closed; repair Redis/reconciliation. |
| RV-1548-05 | Backlog preview accuracy | Call admin preview, then compare each envelope to bounded direct read-only aggregates in same observation window. | Correct counts; partial source shown as partial, never zero; latency within timeout; `nonAdditive=true`. | Fix query/label/source adapter; do not use preview for release sizing. |
| RV-1548-06 | PE recovery schedule exists | Enumerate repeatable jobs without changing them. | Exactly one `post-enrichment-intent-recovery` schedule on `post-enrichment`; expected cadence; no accidental base event schedule. | Restore schedule and fix interval-update preservation. |
| RV-1548-07 | PE intent health | Read status/lease/attempt aggregates and oldest age. | Zero `processing` rows with null/expired unrecoverable lease; zero pending/processing null `sequence_id`; bounded age; failed reasons classified. | Stop release of PE enrollment; fix QUE-05 and reconcile rows. |
| RV-1548-08 | PE recovery convergence | On isolated DB/fake transport, inject crash-before-effect, crash-after-enrollment and pause-mid-batch scenarios. | One local enrollment, completed intent link, no stranded marker/intent, row-level authority check and no provider send. | Fix producer/claim/fencing/eligibility. |
| RV-OUT-01 | Global pause is unavoidable | With real production pauses true and fake/no-op transport probe only, exercise every adapter boundary. | Every adapter returns blocked; no network/provider request; consistent epoch/reason. | Incident: disable worker/process and repair bypass. |
| RV-OUT-02 | Cross-process epoch propagation | Observe two+ processes while committing a pause in an isolated environment. | New auth denied, stale decisions fail final recheck, in-flight registry drains/aborts, epochs converge. | Keep production paused; repair barrier/cache/registry. |
| RV-OUT-03 | Startup fail-closed | Start isolated process with missing row, malformed state, slow/unavailable DB. | No outbound-capable worker/fallback starts; health reports blocked/degraded. | Fix startup gate. |
| RV-OUT-04 | Independent holds survive unpause | Isolated pause/unpause with channel, DNC, consent, validation, kill-switch and manual holds present. | Only global hold transitions; every independent hold remains effective. | Stop; repair reason-scoped mutation. |
| RV-OUT-05 | A2P/SMS readiness | Read provider/TCR status, configured number ownership and app readiness without sending. | Approved active registration, correct number/location, PEWC/quiet-hours gates and SMS pause explicitly controlled. | Keep SMS paused. |

## P0/P1 — queue, Redis, CI, and release controls

| RV ID | Runtime claim | Safe verification | Pass criteria | Failure action |
|---|---|---|---|---|
| RV-QUE-01 | Redis capacity/plan | Read provider plan, max clients and connection telemetry. | Capacity exceeds modeled worst case with headroom; no over-limit rejections. | Upgrade/consolidate before worker release. |
| RV-QUE-02 | Worker health | Capture 24-hour heartbeat/failure/queue-depth series. | No critical ETIMEDOUT/auth/stall; heartbeats within cadence; backlog stable/draining. | Incident/task by classified failure. |
| RV-QUE-03 | One owner per logical job | Compare process topology, repeatables and legacy scheduler flags. | Exactly one active owner/fenced execution for each logical key. | Disable duplicate owner; add fencing. |
| RV-QUE-04 | Alerts work | In isolated environment, inject stale heartbeat and threshold failures. | Actionable alert/review item produced once with redacted details. | Repair alert channel/cooldown. |
| RV-CI-01 | Exact-SHA required checks | Read branch protection and Actions/check-run results. | Protected `main`; exact SHA green; typecheck/build/compliance/#1548 critical suites required. | Do not promote release. |

## P1 — ZeroBounce, identity, provenance, and commercial truth

| RV ID | Runtime claim | Safe verification | Pass criteria | Failure action |
|---|---|---|---|---|
| RV-ZB-01 | ZB schema/worker deployed | Read migration ledger, queue topology and latest campaign/run heartbeat. | 0135/0136 present; one worker; no stale running run. | Keep target cohort blocked; repair worker/migration. |
| RV-ZB-02 | Campaign progress | Read campaign/run/attempt aggregates and remaining canonical predicate count. | Counters reconcile; no duplicate claims; ETA uses server daily limit; pending attempts gate completion. | Reconcile campaign tables before resuming. |
| RV-ZB-03 | Provider/budget behavior | Use fake provider in isolated test; production read-only provider usage/credits. | Missing key claims zero; retryable outage stops safely; daily limit atomic; no credit drift. | Stop campaign, fix limiter/provider handling. |
| RV-DAT-01 | Commercial baseline | Owner-approved read-only classification report. | Every deal/application/contact used in KPIs has production/test/demo/import lineage; actual deal/revenue totals separately attested. | Quarantine unclassified rows and suppress executive metrics. |
| RV-DAT-02 | Duplicate identity | Aggregate normalized email and phone groups, segmented by person/business endpoint. | Counts reviewed; no automated unsafe merges; campaign cohort collision-free. | Block ambiguous cohort; execute dry-run merge plan. |
| RV-DAT-03 | Provenance | Aggregate source events, primary pointers and import executions by cohort. | 100% target cohort traceable; future canonical writes reconcile atomically. | Exclude unknown-source cohort. |
| RV-DAT-04 | Sensitive fields | Aggregate null/non-null only plus storage/log access audit; never print values. | No legacy plaintext values, encryption/version metadata present, access restricted. | Security incident/controlled migration. |

## P1/P2 — enrichment, Serper, readiness, scoring, and GHL

| RV ID | Runtime claim | Safe verification | Pass criteria | Failure action |
|---|---|---|---|---|
| RV-ENR-01 | Enrichment worker running | Read worker heartbeat, last job, queue depths and run table. | Heartbeat current; recent success within cadence; queue not stuck; failures classified. | Repair worker/queue before backfill. |
| RV-ENR-02 | Serper configured and calling | Read boolean config probe plus usage timestamps/counters; no key value. | Configured true; recent successful call after current deployment; acceptable failure rate and quota. | Restart/redeploy/repair provider integration. |
| RV-ENR-03 | Serper enrichment yield | Compare bounded recent batches before/after provider restoration. | Search-assisted email/phone/site yield improves and errors remain below SLO. | Investigate queries, rate limit, provider response mapping. |
| RV-ENR-04 | Other provider health | Read per-provider recent calls, success/errors, cost/credit. | Configured intended providers succeed inside budget and circuit limits. | Disable failing paid provider or repair adapter. |
| RV-ENR-05 | Sunbiz/discovery progress | Read source run/heartbeat, status buckets and oldest backlog age. | Current heartbeat; monotonic progress; no stuck processing rows. | Repair claim/recovery/cadence. |
| RV-ENR-06 | Readiness coverage | Aggregate null/grade/model version for approved inventory. | <5% null in target population; no stale model version. | Backfill after data prerequisites. |
| RV-ENR-07 | Lead-score coverage | Aggregate zero/null/nonzero/model timestamps by source cohort. | Approved inventory scored with current version; backlog draining. | Repair enqueue/recovery and backfill. |
| RV-GHL-01 | GHL identity/circuit health | Read missing-ID/conflict/success/failure/circuit aggregates. | Qualified cohort linked; conflicts explicit; circuit stable. | Stop bulk sync; repair credentials/rate limits/identity. |
| RV-GHL-02 | Workflow registry | Use existing read-only live validation. | Every required workflow key resolves to an active workflow; no secret printed. | Disable dependent automation until fixed. |

## P2 — UI and workflow runtime

| RV ID | Runtime claim | Safe verification | Pass criteria | Failure action |
|---|---|---|---|---|
| RV-UI-01 | Queue Holds page | Authenticated browser smoke as admin and non-admin. | Admin renders every envelope/degraded state; non-admin blocked; no 404/500; no additive total. | Fix route/guard/serialization/UI. |
| RV-UI-02 | Protected route/layout map | Crawl authenticated routes by role in test environment. | Correct shell, breadcrumbs, access and no dead route. | Reconcile route ownership. |
| RV-UI-03 | Inbox refresh | Send synthetic isolated inbound event. | Visible within SLO without manual reload. | Implement/repair polling or subscription. |
| RV-REV-01 | Statement/application funnel | Isolated synthetic merchant end-to-end, fake providers and encrypted test data. | Canonical stages/status, audit lineage and cleanup; no real send. | Repair state owner and sensitive-data boundary. |
| RV-REV-02 | Chargeback/residual reconciliation | Read-only source-vs-import-vs-report totals. | Counts/amounts reconcile by batch and merchant classification. | Block financial reporting and repair importer. |

## Closure procedure

1. Attach evidence; do not replace the register row with prose saying “done.”
2. Update the reconciliation ledger status and closing SHA.
3. For recurring operational claims, set an expiry (for example, queue health after 24 hours expires on the next release or provider/config change).
4. If evidence fails, open a build task using the ledger finding ID and preserve the failed evidence.
5. Only after all required P0 items pass may an operator separately decide whether to alter any real pause. This register never authorizes unpause.
