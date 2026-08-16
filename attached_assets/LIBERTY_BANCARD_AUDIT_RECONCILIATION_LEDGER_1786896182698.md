# Liberty Bancard Audit Reconciliation Ledger

**Authoritative active finding tracker**  
**Reconciled:** 2026-08-16 (America/New_York)  
**Repository:** `scottpstevenson/Liberty-Bancard-Website-and-CRM`  
**Inspected ref:** `origin/main`  
**Shipped SHA:** `68eae86cbb938c6448de7ae792c24381177263f7`  
**Prior baseline:** `4819cefac1478ae700c9996427174e822d97c5a5`  
**Review mode:** Read-only repository and audit-file reconciliation. No repository, database, Redis, provider, or production mutations were performed.

This file replaces the eight original audit documents **operationally**, not historically. The originals remain immutable baseline evidence. New work must be opened from this ledger or its master index, not from stale counts or prose in the originals.

## Status contract

- `CLOSED_STATIC` — the shipped implementation and its automated/static test coverage were verified in source at the inspected SHA. It does not assert a production deployment or live outcome.
- `CLOSED_RUNTIME` — implementation and timestamped production/runtime evidence were both verified.
- `PARTIALLY_CLOSED` — material acceptance criteria shipped, but a named defect, missing gate, missing test execution, or residual scope remains.
- `OPEN` — the finding remains actionable.
- `RUNTIME_VERIFICATION_REQUIRED` — static inspection cannot establish the current truth.
- `SUPERSEDED` — a corrected finding or architectural decision replaced the original formulation.
- `INVALIDATED` — repository inspection disproved the original claim.

No row is `CLOSED_RUNTIME` in this reconciliation because no authenticated production database, Redis, worker, deployment, provider, or GitHub Actions result was available to this read-only pass. `node_modules` is absent, so the new test programs could be inspected but not executed locally without changing the environment.

## Original document disposition

| Original document | Disposition after #1548 | Active authority |
|---|---|---|
| `CODEX_CRM_EXECUTION_ROADMAP` | Immutable original execution plan | This ledger and reconciled master index |
| `CODEX_CRM_UI_TAB_AUDIT` | Immutable UI/navigation baseline | UI rows below plus current delta audit |
| `CODEX_CRM_AUDIT_MASTER_INDEX` | Immutable original index | `LIBERTY_BANCARD_RECONCILED_MASTER_INDEX.md` |
| `CODEX_ENRICHMENT_CRAWLER_RUNTIME_AUDIT` | Immutable mixed static/runtime baseline | Static rows below; runtime claims in the runtime register |
| `LIBERTY_BANCARD_MASTER_AUDIT_ROADMAP` | Immutable roadmap baseline | Canonical rows below |
| `CODEX_CRM_DATA_AND_CANONICAL_SOURCE_AUDIT` | Immutable architecture reference | Data-ownership rows below |
| `CODEX_CURRENT_STATE_AUDIT` | Immutable snapshot at `4819cef` | Current delta audit plus this ledger |
| `LIBERTY_BANCARD_KNOWLEDGE_BRIEF` | Immutable orientation baseline | `LIBERTY_BANCARD_KNOWLEDGE_BRIEF_CURRENT.md` |

## Reconciliation ledger

### A. Security, privacy, release, and migration truth

| Finding ID | Original source | Current status | Closing task | Static evidence at `68eae86c` | Runtime evidence | Residual scope | Reopen condition |
|---|---|---|---|---|---|---|---|
| SEC-01 | Current State §§1, 6, risk 1; Execution P0-01 | OPEN | — | `origin/main` still tracks 7 objects under `backups/` and hundreds under `attached_assets/`; history cleanup is not evidenced. | Repository visibility and exposure response unverified. | Make private if not already; forensic inventory; rotate affected credentials; history rewrite; data/secret scanning. | Any tracked backup/export or public/history exposure. |
| SEC-02 | Current State executive summary, §6, risk 2; Execution P0-03 | OPEN | — | `shared/schema.ts` still defines `owner_ssn`, `bank_routing_number`, and `bank_account_number` as text; `server/routes/merchants.ts` still accepts these fields; no field encryption call is present in the application write path. | Production populated-value count and access audit unverified. | Encrypt/tokenize, redact, restrict access, define retention and processor handoff. | Any sensitive value persisted or logged in plaintext. |
| SEC-03 | Current State risk 5 and §11 release gates | RUNTIME_VERIFICATION_REQUIRED | — | `.github/workflows/wave12-ci.yml` exists but covers a limited suite and does not run #1548B/#1548C. | Branch protection and exact-SHA Actions result unavailable. | Require protected branch and exact-release checks. | Direct push/deploy without required checks. |
| SEC-04 | Current State §1 migration anomaly, risk 6; Knowledge Brief §36 | OPEN | #1548C/#1548D added 0138/0139 | Root migrations and journal now include 0133–0139; journal timestamps remain future-dated relative to audit date. Custom migration behavior remains nonstandard. | Production ledger/head for 0138/0139 unverified. | Normalize journal chronology, remove runtime DDL repair ambiguity, prove reproducible clean migration. | Head mismatch, future timestamp, runtime repair, or skipped migration. |
| SEC-05 | Master Roadmap risk R-P2-05; Knowledge Brief B-12 | OPEN | — | No post-baseline task targets the raw client `fetch()`/CSRF inventory. | Browser/API exploit test unverified. | Inventory all state-changing raw fetch calls and enforce shared CSRF-aware client. | New mutation bypasses shared API client. |
| SEC-06 | Master Roadmap P2-2; Current State public-form findings | PARTIALLY_CLOSED | Prior form work | Major public routes use structured validation, but merchant application finalize still accepts and directly writes high-risk allowed fields. | Hostile payload tests not run. | `.strict()` inventory plus sensitive-field ownership/encryption. | Extra/unowned field reaches persistence. |
| SEC-07 | Current State §§35, 44 | CLOSED_STATIC | Prior auth/RBAC work | Auth/session middleware, role guards, CSRF and partner restrictions remain present. | Production session/role behavior remains RV-SEC-03. | Runtime smoke and branch/CI enforcement. | Guard removed, route exposed, or hostile role smoke fails. |

### B. Outbound authority, consent, validation, and messaging

| Finding ID | Original source | Current status | Closing task | Static evidence at `68eae86c` | Runtime evidence | Residual scope | Reopen condition |
|---|---|---|---|---|---|---|---|
| OUT-01 | Current State risk 3/19; Execution P0-04; Master P0-2/P0-4 | CLOSED_STATIC | #1531 | `outbound-pause-authority.ts` is fail-closed; control mutation is epoch-based; startup awaits canonical state before worker init. | Cross-process pause propagation/drain not observed live. | See OUT-05/OUT-10 and RV-OUT-01–04. | Any provider action succeeds with paused, malformed, missing, stale, or DB-error state. |
| OUT-02 | Current State risk 19; #1531 startup race | CLOSED_STATIC | #1531 | `server/index.ts:381–460` awaits `initializePauseControl()` and blocks all workers when source is `safe_default`. | Slow/unavailable production DB restart not exercised. | Runtime failure-mode startup proof. | Worker starts before authoritative state is known. |
| OUT-03 | Current State raw-send bypass; Master P4-1 | CLOSED_STATIC | #1531 | GHL email/SMS, SMTP, Gmail and workflow/provider adapters obtain authority, register in-flight work, and recheck epochs at the transport boundary. The 57 upstream call matches now transit through gated adapters. | No real provider call was made; production process coverage not observed. | Voice/RVM/LinkedIn boundaries must stay scanner-covered. | Raw network sink lacks authority + final epoch recheck. |
| OUT-04 | #1531 `skipGlobalPauseCheck`; Current State QA risk | CLOSED_STATIC | #1531 | Caller boolean is absent; exception registry is empty/versioned; scanner rejects production `skipGlobalPauseCheck`. | Scanner result at shipped SHA not independently executed here. | Enforce scanner in required CI. | Caller-controlled bypass or unregistered exception appears. |
| OUT-05 | Data Audit contactability/consent; Current State risks 11–12; Master P0-4 | OPEN | #1531 explicitly did not close BT-10 | Raw transports enforce global pause, but they do not universally invoke the complete contactability decision. `sendGhlSms()` checks `consentSms` but not the entire composite policy; raw email adapters do not themselves establish DNC/consent/purpose eligibility. | Live consent/suppression conflicts unverified. | Make purpose-aware contactability unavoidable at every automated send boundary; reconcile consent representations. | A send reaches a provider without contactability/purpose evidence. |
| OUT-06 | Master P0-3/P3-3/P3-4; Knowledge B-01/B-04; Current State risk 11 | PARTIALLY_CLOSED | #1533, #1540A–C/#1541 | Default is `unvalidated`; canonical predicate includes NULL/active/unvalidated; durable campaign/run/attempt tables, BullMQ worker, UI, cancel/poll endpoints and fake-provider tests exist. | Campaign migration, worker health, processed counts, credits and remaining population unverified. | Automatic validation on create remains separate; campaign must run to completion for target cohorts. | `unvalidated` excluded, job lost on restart, provider failure consumes/claims incorrectly, or target cohort is sent unvalidated. |
| OUT-07 | Master P0-5; Current State compliance risks; Knowledge kill line 2 | RUNTIME_VERIFICATION_REQUIRED | — | Source has feature/contactability gates. | A2P/10DLC registration, number ownership and provider configuration not proved. | Keep SMS paused until verified. | SMS enabled without A2P/PEWC/quiet-hour proof. |
| OUT-08 | Master P4-5/P7-1/P7-2; Knowledge B-11/template risk | OPEN | — | Templates and merge-field blanking exist; no complete volume-ranked content audit or A/B framework was verified. | Real rendering, deliverability and conversion results absent. | Audit claims, variables, CTA, unsubscribe and vertical specificity. | Raw token, unsupported claim, broken CTA, or unsafe sender identity. |
| OUT-09 | Master P0-4/P4-1 “migrate 16 direct GHL files” | SUPERSEDED | #1531 | Original file-count claim remains historically accurate, but pause safety is now enforced at the adapter boundary rather than requiring every caller to use ChannelOrchestrator. | — | OUT-05 still requires full purpose/contactability enforcement. | A caller reaches a raw network sink outside an approved adapter. |
| OUT-10 | #1531 kill line on logs; Current State privacy | OPEN | — | Current blocked-send and send logs include subjects, recipient email addresses and contact IDs in `ghl.ts`, `smtp-email.ts`, and `gmail-oauth.ts`. | Production log retention/access unverified. | Redact recipient identifiers and message metadata at safety boundaries. | PII/body/token appears in operational logs. |
| OUT-11 | Master P0-1; Knowledge B-02 | CLOSED_STATIC | #1510/#1511-era campaign repair | Vertical campaign preview/run uses canonical eligibility rather than direct `createSequenceEnrollment()`. | No live bulk run was performed. | Maintain preview/run parity. | Vertical bulk path calls direct enrollment or reports misleading eligible counts. |
| OUT-12 | Master P0-2; Knowledge B-03 | CLOSED_STATIC | Prior SDR repair | SDR orchestrator reloads the global pause during sweeps; transport boundary adds final protection. | Live restart/change behavior unverified. | Runtime heartbeat/pause flip proof. | SDR send continues after committed pause. |

### C. Queue control, scheduling, recovery, and #1548A–D

| Finding ID | Original source | Current status | Closing task | Static evidence at `68eae86c` | Runtime evidence | Residual scope | Reopen condition |
|---|---|---|---|---|---|---|---|
| QUE-01 | Current State risk 4; Master P4-3/R-P0-05; Enrichment runtime risks | PARTIALLY_CLOSED | #1523A | Redis capacity model/topology telemetry and lower enrichment concurrency shipped. | Provider plan, connection count, timeouts and 24-hour health not verified. | Capacity/plan and sustained worker evidence. | ETIMEDOUT, provider connection rejection, stalled jobs, or connection count over limit. |
| QUE-02 | Master P4-4; Current State §39 | CLOSED_STATIC | Prior heartbeat work | Worker heartbeats, job registry and consecutive-failure alerts exist. | Alert delivery and current heartbeat freshness unverified. | Exercise alert path and define SLO. | Heartbeat stale >10 min without actionable alert. |
| QUE-03 | #1532 and original queue-control audit claims | PARTIALLY_CLOSED | #1532, #1548A | Reason-scoped ledger, manifest, coordinator, bigint DTOs, degraded status and release-key validation exist. | Migrations, desired/observed convergence and multi-process behavior not observed. | Runtime migration and reconciliation packet. | Physical queue differs from desired epoch or degraded state is reported as healthy. |
| QUE-04 | #1548 requirement 2: isolated pause-cycle testing | PARTIALLY_CLOSED | #1548B | `test-pause-cycle-unit.ts` has DB identity, clean-state, opt-in, provider-isolation and cleanup guards; sequence hold deferral marker is extracted. | Suite is opt-in, excluded from ordinary CI, and no passing run at this SHA was supplied. | Run on approved isolated DB/Redis and attach full output. | Shared DB touched, cleanup incomplete, provider call possible, or state-machine assertion fails. |
| QUE-05 | #1548 requirement 3: transactional intent production/recovery | PARTIALLY_CLOSED | #1548C | Deal marker + intent are transactional; intent stores sequence/policy; lease claim, retries, local idempotent enrollment and named recovery dispatch exist. | 0138/0139, schedule, claims and orphan counts unverified. | Critical residuals: immediate path commits `status='processing'` with no lease; a crash before execution is unrecoverable because startup guard returns and recovery only reclaims expired non-null leases. Enrollment command also bypasses canonical promotional eligibility/contactability and checks only a subset. | Any processing intent has no recoverable lease; test or runtime shows stranded intent; suppressed/ineligible contact is enrolled. |
| QUE-06 | #1548C recovery-test acceptance | OPEN | #1548C | Test file exists, but TC-4's first awaited claimant has no `LIMIT`, so it deterministically claims both selected rows and makes “worker 2 claimed at least 1” fail. TC-8 also accepts a blocked/processing state instead of proving max-attempt failure. Suite is not in CI. | No pass result. | Repair tests; add exact production functions and CI job with isolated services. | Test passes without exercising concurrent production claim/execute paths. |
| QUE-07 | #1548 requirement 4: domain backlog preview | CLOSED_STATIC | #1548D | Bounded SQL aggregates, statement timeouts, per-source envelopes, `partial`, `nonAdditive`, admin route and Queue Holds UI exist; mock-source test is in predeploy. | Live route/source results unavailable. | RV-1548-05. `missingEndpoint` uses status fields and does not directly test null email/phone; label should be corrected or query expanded. | Unbounded read, additive total, hidden partial source, lazy worker initialization, or wrong due-step mapping. |
| QUE-08 | #1548 runtime requirement 5 | RUNTIME_VERIFICATION_REQUIRED | #1548A–D | Static wiring exists. | Need production migration head, schedule presence, queue-manager readiness, intent counts/leases/orphans, backlog envelopes and exact release SHA. | All items in runtime register. | Any required runtime assertion is absent or stale. |
| QUE-09 | Master P8-2; Current State risk 20 | OPEN | — | Legacy interval fallbacks still start when BullMQ initialization fails. Final pause prevents provider bypass but duplicate-work ownership remains a correctness risk. | Current active owners unverified. | One owner per logical job, or explicit fencing. | Legacy and BullMQ execute same logical job concurrently. |
| QUE-10 | Master P4-2; Knowledge B-13 | PARTIALLY_CLOSED | Prior locking work | Several jobs use durable DB locks; weekly digest was previously repaired. Full scheduler inventory is not proven. | Restart/duplicate run evidence absent. | Inventory every repeat/interval path. | Duplicate logical execution after restart/replica overlap. |
| QUE-11 | Current State QA risk; Knowledge §45 | PARTIALLY_CLOSED | #1531/#1532/#1548D | Scanner and predeploy checks improved, but Wave 12 CI runs only a subset and omits typecheck, #1548B and #1548C. | Exact SHA CI result unavailable. | Make critical tests required and publish artifacts. | Green CI omits a safety-critical acceptance suite. |
| QUE-12 | New delta from #1548C scheduler model | OPEN | — | `updateQueueRepeatInterval()` removes all repeatable jobs on a queue. If applied to `post-enrichment`, it can remove the named recovery schedule and install the base event job as repeatable. | Admin interval usage unverified. | Restrict live interval updates to supported base schedules or preserve named schedules. | PE recovery repeatable disappears after an interval update. |

### D. Canonical data, identity, provenance, and intake

| Finding ID | Original source | Current status | Closing task | Static evidence at `68eae86c` | Runtime evidence | Residual scope | Reopen condition |
|---|---|---|---|---|---|---|---|
| DAT-01 | Execution P0-02; Data Audit commercial truth; Current State risk 16 | OPEN | — | No universal `record_class`/production-test-demo discriminator was found in the shipped delta. | Classification of existing deals/apps/contacts unverified. | Add field, enforce writers, quarantine historical synthetic records, backfill with evidence. | Executive metrics include unclassified rows. |
| DAT-02 | Execution P1-01; Data Audit identity; Current State risks 7–8 | OPEN | — | No post-baseline normalized-email/phone identity migration or universal write-time normalization shipped. | Duplicate counts need refresh. | Define person vs business endpoint semantics; functional uniqueness where safe. | Case/whitespace email duplicate or unsafe phone identity match. |
| DAT-03 | Execution P1-02; Current State merge-FK risk 17 | OPEN | — | No complete contact-FK inventory or reversible merge ledger shipped. | Existing merge outcomes unverified. | Inventory every FK, plan reversible merges, preserve audit lineage. | Archived duplicate retains live relationships or consent is merged incorrectly. |
| DAT-04 | Execution P1-03/P2-1; Data Audit writer ownership; Master P2-1 | OPEN | — | `writeContact()` remains strong but imports, merchant applications and other direct writers remain. | Writer-frequency/runtime path use unverified. | Route all creation through batch-capable canonical command/outbox. | New contact path bypasses canonical normalization/provenance hooks. |
| DAT-05 | Execution P1-04; Data Audit provenance; Master P1-4 | OPEN | — | No historical `import_executions`/`contact_source_events` backfill shipped after baseline. | Current coverage counts unverified. | Backfill batch lineage and primary source pointers; make future writes atomic/durable. | Contact lacks auditable source/batch. |
| DAT-06 | Execution P1-05; Data Audit consent; Current State risk 12 | OPEN | — | Multiple consent/DNC/status representations remain; no reconciliation migration in 0133–0139. | Conflict counts require fresh aggregate query. | Canonical decision/mutation contract, evidence review and reconciliation. | Conflicting fields produce different channel decisions. |
| DAT-07 | Execution P1-06; Data Audit scheduled-job ownership | PARTIALLY_CLOSED | #1532/#1548C | Logical manifest/holds and named PE recovery improve ownership visibility. | Actual process ownership still unverified. | Finish legacy/BullMQ unification and multi-replica fencing. | Two owners process one logical job. |
| DAT-08 | Master P1-1; Current State GHL coverage | RUNTIME_VERIFICATION_REQUIRED | — | GHL sync/conflict guards exist. | Current missing-ID count, circuit status and high-priority reconciliation unverified. | Selective identity-clean sync, not indiscriminate export. | Qualified contact cannot be linked or identity conflict overwrites data. |
| DAT-09 | Master P1-2; Current State readiness coverage | RUNTIME_VERIFICATION_REQUIRED | — | Readiness service and queue hook exist. | Coverage/backfill/grade distribution unverified. | Backfill identity-clean cohorts and monitor model version. | Target cohort has null/stale readiness. |
| DAT-10 | Master P1-3/P8-1; Knowledge test/demo data | OPEN | — | Demo seeding is feature-gated, but tracked artifacts and explicit production/test lineage are unresolved. | Live test-contact count unverified. | Dry-run cleanup plus discriminator; never delete on pattern alone. | Test/demo row enters campaign or executive metric. |
| DAT-11 | Master P1-5; Current State phone duplicates | RUNTIME_VERIFICATION_REQUIRED | — | No uniqueness constraint/backfill shipped. | Duplicate groups require fresh query. | Classify shared business numbers before constraint or merge. | Phone used as unique person/consent identity. |
| DAT-12 | Master P2-3; Knowledge prospect lifecycle | OPEN | — | Prospect subsystem exists; mandatory funnel decision not recorded. | Production use proportions unverified. | Decide prospect-first vs direct canonical contact and remove ambiguity. | Same source has divergent intake semantics. |
| DAT-13 | Master P3-1; Data Audit vertical authority | PARTIALLY_CLOSED | Prior canonical vertical resolver | Resolver exists, but readiness, scoring, imports and campaigns do not share one enforced vocabulary. | Stored distribution/mapping coverage unverified. | One versioned taxonomy and backfill. | Consumer interprets same source vertical differently. |
| DAT-14 | Master P3-4/Knowledge B-01 | CLOSED_STATIC | #1533 | Schema default and status semantics now distinguish `unvalidated`; candidate filters/UI use canonical predicate. | Historical row migration/distribution unverified. | OUT-06 campaign and creation-time validation. | `active` is again treated as provider-valid or new rows omit `unvalidated`. |
| DAT-15 | Knowledge B-14 CSV row accounting | OPEN | — | No post-baseline task directly repairs silent `onConflictDoNothing()` accounting. | Import reconciliation unverified. | Count inserted/updated/skipped/conflicted deterministically. | Import claims success without row-level disposition. |

### E. Enrichment, discovery, scoring, and provider runtime

| Finding ID | Original source | Current status | Closing task | Static evidence at `68eae86c` | Runtime evidence | Residual scope | Reopen condition |
|---|---|---|---|---|---|---|---|
| ENR-01 | Enrichment Runtime Audit scheduler/provider matrix | CLOSED_STATIC | Existing pipeline plus #1548C | Discovery/enrichment adapters, queue handlers, post-enrichment worker, readiness and lead-scoring hooks exist. | Existence does not prove execution. | RV-ENR-01–09. | Route/job/provider wiring removed or manifest loses handler. |
| ENR-02 | Enrichment Runtime Audit: “not runtime verified” | RUNTIME_VERIFICATION_REQUIRED | — | Static schedules are declared. | No current heartbeats, last-run timestamps, queue depth, success/error counts or coverage were queried. | Capture exact-SHA runtime packet. | Heartbeat stale, last run outside cadence, or queue grows. |
| ENR-03 | Master P3-2; prior Serper discussion | RUNTIME_VERIFICATION_REQUIRED | Secret reportedly added outside repo | Serper adapter gates on `SERPER_API_KEY`; no source change proves the deployed secret or calls. | Last successful Serper call, failure rate, quota and discovery yield unverified. | Restart/deploy proof and provider call telemetry. | `isSerperConfigured=false`, stale last call, or high provider-failure streak. |
| ENR-04 | Enrichment audit provider failures/credits | RUNTIME_VERIFICATION_REQUIRED | — | Serper/Outscraper/Apify/fallback code exists. | Provider credentials, budgets, rate limits, latency and yields unverified. | Per-provider SLO/budget/circuit evidence. | Provider failure silently degrades to near-zero contact data. |
| ENR-05 | Current State readiness/lead-score gaps; Execution P2-06 | RUNTIME_VERIFICATION_REQUIRED | Durable lead-scoring generation work exists | Queue manager handles readiness and durable lead-scoring jobs. | Population coverage and backlog unverified. | Run/reconcile backfills after identity and enrichment. | >5% target cohort unscored or stale. |
| ENR-06 | Enrichment audit post-enrichment side effects | PARTIALLY_CLOSED | #1548C | Durable intent and recovery architecture shipped. | See QUE-05/06/08. | Fix immediate crash window and canonical eligibility before runtime closure. | Stranded/duplicate/unsafe intent outcome. |
| ENR-07 | Enrichment audit run-state observability | PARTIALLY_CLOSED | #1548D | Queue Holds preview exposes PE intents and several outbound backlog stores. | Live completeness and accuracy unverified. | Add provider/run-level last-success and failure-streak views if absent. | Operators cannot distinguish idle, blocked, failing and complete. |

### F. UI, navigation, operator experience, and analytics

| Finding ID | Original source | Current status | Closing task | Static evidence at `68eae86c` | Runtime evidence | Residual scope | Reopen condition |
|---|---|---|---|---|---|---|---|
| UI-01 | UI Audit target six-domain architecture | OPEN | — | #1548D adds Queue Holds but does not implement the full proposed six-domain navigation. | Usability/route telemetry absent. | Adopt or explicitly reject target IA and publish current ownership map. | Duplicate route families continue without a canonical entry point. |
| UI-02 | UI Audit 43 protected routes vs layout map | OPEN | — | No broad route/layout-map reconciliation task shipped after baseline. | Direct-route rendering unverified. | Ensure every protected route has correct shell, breadcrumbs and permissions. | Protected route renders outside intended layout or role context. |
| UI-03 | UI Audit development-mode presentation | OPEN | — | No targeted production/development presentation cleanup identified. | Production bundle behavior unverified. | Remove misleading dev-only affordances or label them. | Operator sees environment-inappropriate UI. |
| UI-04 | UI Audit ambiguous workflows and nested hubs | OPEN | — | New Queue Holds page is explicit, but broader duplicate settings/automation/CRM hub ambiguity remains. | Navigation task completion unverified. | Consolidate canonical hubs and redirect aliases. | Same operation has competing UI owners. |
| UI-05 | UI Audit virtual-terminal decommission | RUNTIME_VERIFICATION_REQUIRED | Prior decommission work | Audit says decommissioned; no #1548 change targets it. | Route visibility/traffic unverified. | Confirm no active links or operational dependency. | Deprecated terminal route becomes reachable/used. |
| UI-06 | #1548D Queue Holds surface | CLOSED_STATIC | #1548D | Admin route, lazy page, Operator Dashboard link, per-source status/partial handling and error boundary exist. | Authenticated render and live source data unverified. | Browser smoke with admin and non-admin. | Route 404, unauthorized access, bigint serialization error, or partial data displayed as zero. |
| UI-07 | Master P5-2 pipeline pagination | OPEN | — | No post-baseline pagination task identified. | Large-board performance unverified. | Server pagination/filtering and preserved workflow semantics. | Large pipeline loads unbounded. |
| UI-08 | Master P6-1 inbox refresh | RUNTIME_VERIFICATION_REQUIRED | — | No post-baseline targeted change identified. | Auto-refresh/websocket behavior unverified. | Verify and implement if absent. | New reply not visible within agreed SLO. |
| UI-09 | Master P6-2 briefing cache | RUNTIME_VERIFICATION_REQUIRED | — | No post-baseline targeted change identified. | Cache hit/cost behavior unverified. | Verify TTL/keying and add if absent. | Repeated load triggers redundant model call. |
| UI-10 | Master P6-3 Ready-for-Outreach enhancements | PARTIALLY_CLOSED | #1493 before baseline | Queue exists; follow-up contact actions/skip cleanup/role checks were not reverified here. | UI behavior unverified. | Focused runtime/UI audit. | Queue action bypasses role/contactability or stale skip persists. |
| UI-11 | Master P6-4 ZeroBounce history | RUNTIME_VERIFICATION_REQUIRED | Earlier work may exist | Routes/history references exist in prior CI smoke description. | Contact-detail rendering unverified. | Confirm full history and reason visibility. | Rep cannot explain block. |
| UI-12 | Master P6-5 proposal engagement alerts | OPEN | — | No post-baseline task identified. | Event rendering unverified. | Surface open/click evidence with source timestamp. | Engagement exists but pipeline cannot display it. |
| UI-13 | Master P7-3 funnel analytics | OPEN | — | Analytics infrastructure exists, but commercial truth and canonical stages are prerequisites. | Real funnel data absent. | Complete DAT-01/REV-01 first. | Synthetic rows presented as conversion/revenue. |

### G. Revenue workflow and business truth

| Finding ID | Original source | Current status | Closing task | Static evidence at `68eae86c` | Runtime evidence | Residual scope | Reopen condition |
|---|---|---|---|---|---|---|---|
| REV-01 | Current State confirmed baseline/risk 16; Execution P0-02 | OPEN | — | No commercial/test/demo discriminator or historical quarantine shipped. | Owner baseline was zero actual deals/revenue; current outcome not reverified. | Establish auditable commercial truth before executive reporting. | Unclassified deal/application affects business metrics. |
| REV-02 | Current State risk 15; Data Audit deal-stage authority | OPEN | — | `advanceDealStage()` exists, but direct deal writers identified in baseline were not comprehensively migrated by #1548. | Writer use unverified. | One transition owner and backfill stale stages. | Direct stage write bypasses lifecycle/GHL/analytics/onboarding. |
| REV-03 | Current State application-status ownership | OPEN | — | Multiple application routes/workflows remain; no single transition service shipped. | Real application state unverified. | Canonical status state machine plus encrypted fields. | Status domains diverge or side effects are skipped. |
| REV-04 | Master P5-1 statement edge cases | RUNTIME_VERIFICATION_REQUIRED | — | Statement acquisition/chase workers exist. | Mid-chase upload/archive/external-stage scenarios not observed. | Run edge-case integration suite. | Reminder fires after completion/archive or misses required follow-up. |
| REV-05 | Master P5-3 merchant application funnel | RUNTIME_VERIFICATION_REQUIRED | — | Portal/application/underwriting/boarding code exists. | No real end-to-end merchant completion evidence. | Test one synthetic isolated funnel, then first real funnel with audit trail. | Funnel cannot progress or sensitive data handling is unsafe. |
| REV-06 | Master P5-4 chargeback program | RUNTIME_VERIFICATION_REQUIRED | — | Related service/schema references exist but were not the focus of #1548. | Table/import/report accuracy unverified. | Focused schema and import audit. | Chargeback/residual counts cannot reconcile to source. |
| REV-07 | Master P7-1/P7-2 optimization | OPEN | — | Sequence library exists; trustworthy audience/funnel prerequisites are incomplete. | No reliable conversion sample. | Defer experiments until validated cohorts and commercial truth exist. | Experiment runs on unvalidated or synthetic population. |

### H. Documentation and baseline accuracy

| Finding ID | Original source | Current status | Closing task | Static evidence at `68eae86c` | Runtime evidence | Residual scope | Reopen condition |
|---|---|---|---|---|---|---|---|
| DOC-01 | Knowledge Brief metadata/current counts | SUPERSEDED | This reconciliation | Old SHA/counts are historical; current static brief is supplied separately. | Current runtime counts remain in register. | Never edit the old brief to look current. | Old brief is used as release evidence. |
| DOC-02 | Audit Master Index | SUPERSEDED | This reconciliation | New master index names current active work and dependencies. | — | Preserve original index unchanged. | Original index is treated as current backlog. |
| DOC-03 | Current State Audit | SUPERSEDED | Current delta audit | Baseline remains valid as of `4819cef`; delta covers 23 later commits through `68eae86c`. | Runtime claims need fresh evidence. | Preserve original snapshot. | Old live count is cited as current. |
| DOC-04 | Master P8-4 documentation drift | PARTIALLY_CLOSED | This document set | Active tracker/index/brief/runtime register now separate static fact from runtime claim. | Operational maintenance process unverified. | Quarterly reconciliation and exact-SHA discipline. | Duplicate active trackers or unversioned live claims appear. |

## #1548A–D verdict matrix

| Part | Required verification | Verdict | Evidence | Blocking residual |
|---|---|---|---|---|
| #1548A | Baseline route/compliance repairs | `CLOSED_STATIC` | Bigint DTO conversion, degraded envelopes, manifest source, release Zod enum and block-aware VFC-22 scanner are present. | Exact-SHA test execution/CI result is runtime/CI evidence, not static closure. |
| #1548B | Isolated pause-cycle testing | `PARTIALLY_CLOSED` | Strong isolation and cleanup guards exist. | Opt-in only; no passing run supplied; omitted from ordinary CI. |
| #1548C | Transactional intent production and recovery | `PARTIALLY_CLOSED` | Transactional marker+intent, policy snapshot, claims, leases, retry and local convergence exist. | Immediate `processing` intent has no lease and can strand after crash; canonical eligibility is incomplete; test TC-4 is structurally unsound; suite not in CI. |
| #1548D | Domain backlog preview | `CLOSED_STATIC` | Bounded source queries, independent envelopes, partial/non-additive contract, admin API/UI and predeploy test exist. | Live correctness unavailable; endpoint indicator semantics need correction/rename. |
| #1548 runtime | Migration, scheduler, queue and orphan-intent evidence | `RUNTIME_VERIFICATION_REQUIRED` | Static hooks only. | Complete RV-1548-01 through RV-1548-08 before operational closure. |

## Coverage proof for the eight originals

- Execution roadmap: every P0–P3 workstream maps to SEC, OUT, DAT, ENR, REV or UI rows above.
- UI tab audit: primary navigation, protected-route/layout, dev presentation, hub ambiguity, cleanup candidates and runtime checks map to UI-01–13 and RV-UI entries.
- Original master index: superseded by DOC-02 and the new reconciled master index.
- Enrichment runtime audit: scheduler/provider/worker/backlog/heartbeat assertions map to ENR-01–07, QUE-01/02/05/07/08 and the runtime register.
- Master audit roadmap: P0-1 through P8-4 map to OUT-11/12/06/09/07; DAT-08–15; ENR-02–07; QUE-01/02/09–11; UI-07–13; REV-04–07; DOC-04.
- Data and canonical-source audit: commercial truth, identity, merge, provenance, contactability, writer ownership and scheduler ownership map to DAT-01–07, OUT-05 and REV-01–03.
- Current state audit: all top-20 risks and five recommended tasks map to SEC-01–06, OUT-01/05/06, QUE-01/09/11, DAT-01–06/08/09/13 and REV-01–03.
- Knowledge brief: all 53 section-level accuracy determinations remain historical; corrected current facts live in the current brief, while bugs B-01–B-14 and kill lines map to OUT-06/11/12, QUE-01/10, DAT-05/08/09/13/15, SEC-05 and runtime items.

## Rules of use

1. Do not copy old numeric counts into tickets without a new timestamped query.
2. A PR/task label is never closing evidence by itself.
3. Every closure must name an exact SHA, static acceptance evidence, runtime evidence when applicable, residual scope and a reopen condition.
4. Global outbound, channel pauses, DNC, consent, validation, PEWC, automation holds and provider readiness are independent gates; clearing one never clears the others.
5. No runtime verification may send to a real prospect or lift a real pause.
