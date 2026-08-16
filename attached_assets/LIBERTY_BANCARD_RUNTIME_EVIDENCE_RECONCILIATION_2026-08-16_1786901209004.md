# Liberty Bancard Runtime Evidence Reconciliation

**Evidence source:** `LIBERTY_BANCARD_RUNTIME_EVIDENCE_PACKET_68EAE86.md`  
**Evidence window:** 2026-08-16T16:05:00Z–16:12:00Z  
**Evidence environment:** Replit development workspace, shared development PostgreSQL, shared Upstash Redis  
**Audited static SHA:** `68eae86cbb938c6448de7ae792c24381177263f7`  
**Observed workspace SHA:** `cf055e0c7217b272b28b4f2774b1cd43091667f7`  
**Review mode:** Read-only evidence adjudication. No code, database, Redis, provider, configuration, secret, queue, pause, or production mutation was performed.

## Executive verdict

The packet is valuable but does not close any ledger finding at runtime. It confirmed two actionable failures, supplied partial evidence for 20 checks, and left 17 checks requiring a corrected query, authenticated/provider access, GitHub evidence, or an isolated environment.

The packet's stated seven `PASS` results are not seven ledger closures:

- `RV-1548-07` is vacuous because the new intent table is empty.
- `RV-ZB-01` proves schema presence but cites the general post-enrichment heartbeat rather than a dedicated ZeroBounce job owner/execution.
- `RV-DAT-04` proves no populated sensitive values in a two-application development sample, not encryption/access controls.
- `RV-ENR-01` proves fresh heartbeats and an active counter, not completion, queue depth or failure classification.
- `RV-ENR-02` proves key presence and attempts, not successful calls; the packet queried the wrong stored property names.
- `RV-ENR-07` proves non-null values only; `lead_score` defaults to zero, and contact `updated_at` is not scoring freshness.
- `RV-1548-02` is useful shared-development migration evidence, but the exact published production process/DB was not identified and the journal anomalies remain.

Accordingly, `CLOSED_RUNTIME` remains zero.

## Evidence adjudication

| Reviewer disposition | Count | RV IDs |
|---|---:|---|
| `CONFIRMED_FAIL` | 2 | `RV-1548-01`, `RV-GHL-01` |
| `PARTIAL_EVIDENCE` | 20 | `RV-1548-02`, `RV-1548-04–07`, `RV-OUT-01`, `RV-OUT-04`, `RV-QUE-01–02`, `RV-ZB-01–02`, `RV-DAT-01–02`, `RV-DAT-04`, `RV-ENR-01–02`, `RV-ENR-05`, `RV-ENR-07`, `RV-UI-01`, `RV-REV-01` |
| `RERUN_OR_ACCESS_REQUIRED` | 17 | `RV-1548-03`, `RV-1548-08`, `RV-OUT-02–03`, `RV-OUT-05`, `RV-QUE-03–04`, `RV-CI-01`, `RV-ZB-03`, `RV-DAT-03`, `RV-ENR-03–04`, `RV-ENR-06`, `RV-GHL-02`, `RV-UI-02–03`, `RV-REV-02` |

`RV-1548-04–07` in the partial row expands to `RV-1548-04`, `RV-1548-05`, `RV-1548-06`, and `RV-1548-07`.

## Ledger status changes

| Finding | Before | After | Reason |
|---|---|---|---|
| `SEC-03` | `RUNTIME_VERIFICATION_REQUIRED` | `OPEN` | Running workspace did not match the audited SHA and no deployed SHA is exposed; required GitHub checks remain unverified. |
| `QUE-02` | `CLOSED_STATIC` | `PARTIALLY_CLOSED` | Three heartbeats were stale relative to the packet's observation time, and GHL errors did not produce a current circuit alert. |
| `QUE-08` | `RUNTIME_VERIFICATION_REQUIRED` | `PARTIALLY_CLOSED` | Migrations and empty control tables were observed, but exact release, named schedule, QueueManager readiness, preview envelopes and recovery convergence remain unproved. |
| `DAT-08` | `RUNTIME_VERIFICATION_REQUIRED` | `OPEN` | GHL sync/circuit check failed with a large error/conflict volume, no completion event, and a closed/reset circuit state. |
| `ENR-02` | `RUNTIME_VERIFICATION_REQUIRED` | `PARTIALLY_CLOSED` | Enrichment/post-enrichment heartbeats and active progress were observed; queue/completion/error evidence is missing. |
| `ENR-03` | `RUNTIME_VERIFICATION_REQUIRED` | `PARTIALLY_CLOSED` | Serper key and current attempt activity were observed; success/failure/quota/yield were not correctly read. |
| `ENR-05` | `RUNTIME_VERIFICATION_REQUIRED` | `PARTIALLY_CLOSED` | Some runtime signals exist, but readiness and meaningful lead-score coverage were queried incorrectly. |

All other statuses remain unchanged. The resulting ledger distribution is 11 `CLOSED_STATIC`, 0 `CLOSED_RUNTIME`, 19 `PARTIALLY_CLOSED`, 32 `OPEN`, 11 `RUNTIME_VERIFICATION_REQUIRED`, and 4 `SUPERSEDED`.

## Confirmed failure 1 — release identity is not provable

### Finding

The public health endpoint returns only `{status}`. The inspected workspace reported `cf055e0c`, while the audited source and `origin/main` were `68eae86c`. The packet could not identify the published deployment's commit or prove that every outbound-capable process runs the same release.

This is a release-control failure, not proof that production is necessarily on the wrong code. The precise failure is that production identity cannot be established.

### VFC table

| ID | Claim | Verdict | Evidence |
|---|---|---|---|
| VFC-RI-01 | The inspected Replit workspace equals audited SHA `68eae86c` | `FALSE` | Workspace reported `cf055e0c`, one commit later. |
| VFC-RI-02 | `origin/main` equals audited SHA | `TRUE` | Packet reported `68eae86c`. |
| VFC-RI-03 | The published deployment SHA is known | `FALSE` | `/api/health` returned only `{"status":"ok"}` and no build metadata environment variable was found. |
| VFC-RI-04 | Every outbound-capable process is on one approved SHA | `UNVERIFIED` | No per-process build identity was available. |
| VFC-RI-05 | Protected `main` requires all safety suites | `UNVERIFIED` | GitHub branch protection and exact-SHA check runs were inaccessible. |

### Corrective build task CBT-RV-01 — immutable build identity and exact-SHA release gate

**Priority:** P0 release safety  
**Findings:** `SEC-03`, `QUE-08`, `QUE-11`  
**Evidence:** `RV-1548-01`, `RV-CI-01`

#### Required implementation

1. Inject an immutable full commit SHA and build/deployment identifier during build or deployment. Do not derive identity from the mutable workspace at request time.
2. Extend `GET /api/health` in `server/routes/sdr.ts` or add a minimal public `GET /api/build` response containing non-secret `sha`, `buildId`, `builtAt`, and environment label.
3. Include the same SHA in authenticated worker/queue health output so mixed processes are detectable.
4. Fail release verification when SHA is missing, shortened ambiguously, mixed across processes, or differs from the approved release.
5. Require protected-branch checks for typecheck, build, compliance scan, #1548B isolated suite and corrected #1548C suite. Preserve exact-SHA artifacts.

#### Gate checks

- Public build endpoint returns the full approved SHA without exposing secrets or infrastructure credentials.
- Every worker process reports the same SHA.
- Published application SHA equals the approved commit.
- GitHub required checks are green for that same commit.
- A deployment missing build metadata is degraded/not releasable, not silently healthy.

#### Tests

- Unit test response schema and redaction.
- Startup test with missing build SHA returns degraded/release-blocked status.
- Integration test compares API/process/worker SHAs.
- CI test rejects a release artifact whose embedded SHA differs from the checked commit.

#### Kill lines

- STOP if the SHA comes from a mutable checkout after build.
- STOP if only the workspace SHA is reported while the published process remains unidentified.
- STOP if the endpoint exposes secrets, repository credentials, hostnames, or connection strings.
- STOP if a mixed-SHA deployment is reported healthy.
- STOP if a green subset can bypass omitted #1548 safety suites.

## Confirmed failure 2 — GHL synchronization and circuit health

### Finding

The packet observed, in the preceding 24 hours, 4,106 `ghl_sync_error` events, 3,244 identity-conflict events, no `ghl_sync_completed` event, and recent 400/404/422 errors. At the observation time the persisted circuit state was closed with zero consecutive failures, and the circuit-alert timestamp was six days old.

Static inspection shows the GHL circuit is reset at the start of every sync tick, and any intervening success resets the consecutive-failure counter. Some identity, not-found, stage-map and dependency errors are intentionally excluded. Therefore the evidence proves unhealthy sync outcomes and ineffective operational protection for the observed pattern, but it does not yet prove one single root cause. The repair must classify failures before changing thresholds.

### VFC table

| ID | Claim | Verdict | Evidence |
|---|---|---|---|
| VFC-GHL-01 | GHL sync completed successfully in the observed 24 hours | `FALSE` | Packet found zero `ghl_sync_completed` events. |
| VFC-GHL-02 | Errors are rare/bounded | `FALSE` | 4,106 error events plus 3,244 conflicts. |
| VFC-GHL-03 | Circuit opened for the observed failure pattern | `FALSE` | Persisted state reported closed with zero consecutive failures. |
| VFC-GHL-04 | Circuit alerting was current | `FALSE` | Last alert timestamp was six days old. |
| VFC-GHL-05 | All 400/404/422 events are transient provider failures | `UNVERIFIED` | They may include identity, stale-ID, validation or configuration errors; classification is required. |
| VFC-GHL-06 | The GHL credential is invalid | `UNVERIFIED` | No 401 distribution or safe credential validation result was supplied. |

### Corrective build task CBT-RV-02 — classify GHL failures and make protection effective

**Priority:** P1 operational integrity; complete before any large reconciliation  
**Findings:** `DAT-08`, `QUE-02`  
**Evidence:** `RV-GHL-01`, `RV-QUE-02`, `RV-QUE-04`

#### Required implementation

1. Pause or bound the bulk GHL sync path operationally while the error flood is diagnosed; do not lift outbound messaging pauses.
2. Produce a sanitized error matrix by operation, HTTP status, normalized error code, entity type, retryability, and count. Separate identity conflicts/data skips from provider/auth/rate-limit/server failures.
3. Confirm credential validity using the existing read-only health/validation path without printing the token.
4. Align audit action names and health aggregation so expected data skips do not masquerade as provider failures and real provider failures cannot be excluded silently.
5. Define circuit policy for both consecutive failures and sustained failure ratio/error budget. A single intermittent success must not hide a 24-hour failure flood.
6. Persist circuit state across ticks for a bounded cooldown or explicit half-open probe; do not unconditionally reset an unhealthy circuit every 45-second tick.
7. Make alerting fire on state transition and on sustained unhealthy error budget, with cooldown and redacted details.
8. After repair, run a bounded identity-clean cohort and reconcile source/result counts without overwriting conflicts.

#### Gate checks

- Every observed error class has an owner and retry/skip/terminal decision.
- Provider/auth failures increment the appropriate failure metric.
- Identity conflicts remain visible but do not corrupt data.
- Circuit opens or throttles within the defined SLO under sustained unhealthy results.
- Half-open recovery requires bounded successful probes; it does not reset merely because a timer fired.
- Alerts arrive once per transition/cooldown with no PII or credentials.
- A bounded clean cohort produces successful completions and reconciled counts before broader sync.

#### Tests

- Table-driven 400/401/404/422/429/5xx/network error classification.
- Consecutive-failure and rolling error-budget circuit tests.
- Persistence/restart and half-open probe tests.
- Interleaved success/failure test proving one success cannot hide an unhealthy rolling window.
- Identity-conflict no-overwrite test.
- Alert transition/cooldown/redaction test.
- Bounded integration test with fake GHL transport.

#### Kill lines

- STOP if 401/auth errors do not block and alert within one sync cycle.
- STOP if expected data skips are counted as successful completions.
- STOP if real API failures are logged but excluded from every protective metric.
- STOP if the circuit resets unconditionally on the next timer tick.
- STOP if repair performs an indiscriminate bulk export of 154,295 unlinked contacts.
- STOP if any conflict overwrites canonical Liberty identity or consent data.
- STOP if logs/alerts expose tokens, recipient data, message content, or sensitive merchant data.

## Investigation item — stale worker heartbeats

At the observation time, `enrollment-recovery` was about 2h48m old and `winback-outreach`/`db-backup` about 4h54m old. This is not yet a confirmed build defect because expected cadence and intentional-dormancy semantics were not established.

Before opening CBT-RV-03, determine for each worker:

- configured cadence and most recent expected window;
- enabled/disabled/paused/dormant state;
- last start, success, failure and completion;
- queue/repeat registration and active owner;
- whether global pause should affect the worker;
- alert threshold relative to cadence.

Open a corrective task only if age exceeds 2× expected cadence without an explicit intentional state, or if an overdue worker does not alert.

## Corrections required in the next runtime pass

| RV ID | Correction |
|---|---|
| `RV-1548-01` | Rerun after immutable build identity is deployed; compare published API and every worker SHA. |
| `RV-1548-06` | Enumerate BullMQ repeatables through the application/BullMQ API so the job name and repeat options are visible; do not infer identity from a hash. |
| `RV-ZB-01` | Identify the actual ZeroBounce queue/job handler and its heartbeat/ownership; do not substitute the general post-enrichment heartbeat. |
| `RV-ZB-02/03` | Confirm `ZEROBOUNCE_API_KEY` presence only, daily limit/credits read-only, then run fake-provider behavior in isolation before a campaign. |
| `RV-DAT-03` | Query `contact_source_events`, primary source pointers and `import_executions`; this was omitted, not blocked. |
| `RV-DAT-11` | Query normalized phone groups segmented by phone type/business sharing; packet queried email only. |
| `RV-ENR-02/03` | Read `successfulCalls`, `failedCalls`, `websitesFound`, `emailsFound`, `phonesFound`, `lastCallAt`, `monthlyQuota`, and `remainingCalls`; correlate bounded batch yield. |
| `RV-ENR-06` | Query `data_readiness_score`, `data_readiness_grade`, `readiness_updated_at`, and `readiness_model_version`. |
| `RV-ENR-07` | Query null/zero/nonzero and score ranges by approved cohort; identify scoring/model timestamps rather than using contact `updated_at`. |
| `RV-REV-02` | Execute the safe read-only source/import/report reconciliation that was omitted. |

Authenticated UI, GitHub, Upstash plan, A2P/provider-console, and isolated failure-mode checks remain required exactly as stated in the runtime register.

## Safety disposition

- Keep all real global and channel pauses in their existing state.
- Do not send to a real provider or recipient during verification.
- Do not start the ZeroBounce campaign until key/budget/fake-provider behavior and target cohort are approved.
- Do not run #1548B/#1548C crash or pause-cycle tests against the shared development database/Redis.
- Do not treat this evidence packet as authorization to deploy, restart, migrate, backfill, reconcile, or unpause.
