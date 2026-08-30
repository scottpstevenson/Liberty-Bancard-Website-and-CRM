# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD — EXTERNAL MERCHANT COMMUNICATIONS REMAIN HELD UNLESS SEPARATELY ENABLED

Task: **REV-06A — Active Merchant Success, Support & Revenue Truth**

Verify this task against current main and the final REV-05A canonical MID/activation-handoff contract. If valid after corrections, continue directly into implementation. Do not stop after another plan unless the prerequisite contract or external processor/revenue authority genuinely blocks the affected portion.

Finding a P0 revenue-truth defect is not permission to stop auditing. Continue through every MID consumer, transaction/daily-stat/residual/chargeback/support/health/payout/commission/merchant-success writer and report, plus every recurring job and UI surface.

The latest verified drafting reference is `origin/main` at `773c50d13584578045026c5923b59ff5c7994a22`, migration head `0194`. The audit found substantial existing post-MID functionality but inconsistent authority: daily ingestion reads deal MIDs, simulation can create fake daily data, activation/success read `merchant_mids`, and reporting must separate estimates from processor-confirmed activity and reconciled residual revenue. Re-verify all claims. The final REV-05A canonical MID and activation-handoff contract is a hard prerequisite.

## 1. REPOSITORY BASELINE

Capture:

- branch/HEAD/origin and working-tree state;
- migration head/journal and suite-manifest owners/count;
- REV-05A merge SHA and canonical MID/activation handoff version;
- current processor activation/readiness/environment booleans without secrets;
- current MID ingestion, activation monitor, merchant-success, attrition, health, residual, payout, chargeback, support, RFI, NPS/review, and retention job owners;
- release SHA and read-only worker/queue heartbeats where available;
- current production/test/demo/unknown commercial classification authority.

Never print merchant identifiers, MIDs/TIDs, transaction details, chargeback documents, residual statements, bank/payout data, credentials, or message bodies.

## 2. PREREQUISITE AND NON-DUPLICATION GATE

Verify:

| Domain | Required owner | REV-06A treatment |
|---|---|---|
| Application/processor approval/canonical MID | REV-05A and merchant MID authority | Consume exact activation handoff; do not read deal-only MID as authority. |
| Provider activation and adapter truth | REV-05A processor activation record | Require current real adapter readiness; no simulation. |
| Tasks/tickets/RFIs | CR-05 and current ticket/RFI authorities | Use for support, anomaly, chargeback, retention work. |
| Consent/contactability/channel release | CRO-02/CR-04/CRO-07 | Enforce; hold communications when channel unavailable. |
| Deal/application stages | Existing authorities | Observe; do not mutate as a reporting shortcut. |
| Commercial record classification | Existing revenue-read/commercial-resolution authority | Enforce production-only reporting. |

If REV-05A is not merged, do not build against a guessed MID contract.

## 3. VERIFIED FROM CODE — PREFLIGHT

Produce:

| ID | Claim | Verdict | Verified reality | Evidence |
|---|---|---|---|---|
| VFC-01 | Every post-live consumer keys from canonical `merchant_mids` | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |
| VFC-02 | First processor transaction activates the canonical MID exactly once | ... | ... | ... |
| VFC-03 | Daily data ingestion cannot simulate production truth | ... | ... | ... |
| VFC-04 | Merchant health/anomalies are versioned and evidence-backed | ... | ... | ... |
| VFC-05 | Support/RFI/chargeback work is durable and SLA-bound | ... | ... | ... |
| VFC-06 | 30/60/90/NPS/review/retention work is idempotent and contactability-gated | ... | ... | ... |
| VFC-07 | Residual import/reconciliation is exact and replay-safe | ... | ... | ... |
| VFC-08 | Partner/agent payout attribution is immutable and evidence-backed | ... | ... | ... |
| VFC-09 | Reports separate estimated, processor-confirmed, and reconciled revenue | ... | ... | ... |
| VFC-10 | One durable owner exists per recurring job | ... | ... | ... |

## 4. COMPLETE MID CONSUMER AND WRITER CENSUS

Inventory every path reading or writing:

- `merchant_mids`, `deals.mid`, TIDs, processor/application linkage;
- MID assigned/active/suspended/closed state;
- activation timestamps and first transaction;
- daily processing stats/transactions/funding/effective rate;
- merchant profiles/portfolio/health/churn/attrition;
- chargebacks/disputes/RFIs/support tickets;
- merchant-success sequence/tasks/journeys;
- NPS/review requests and retention/rate reviews;
- residual imports/rows/matches/reports/payouts/commissions;
- partner/agent/referral attribution;
- executive, financial, portfolio, leaderboard, agent, and partner reports.

Produce:

| Consumer/writer | Current MID source | Data class | Authority | Schedule/trigger | REV-06A disposition |
|---|---|---|---|---|---|
| ... | deal / merchant_mids / imported text | estimate / provider / reconciled | ... | ... | migrate / preserve / fence / retire |

## 5. COMPLETE RECURRING JOB CENSUS

Inventory all recurring or manual jobs for:

- MID/daily-stat ingestion;
- activation monitoring;
- merchant-success 30/60/90 enrollment/tasking;
- merchant health/churn/attrition analysis;
- chargeback deadline/RFI checks;
- support SLA/escalation;
- NPS/review/retention/winback/rate-review;
- residual import/reconciliation/payout generation;
- portfolio/executive aggregation.

Record logical job identity, trigger owners, queue, lock/lease, cadence/time zone, input population, checkpoint, replay behavior, external side effects, and duplicate-owner disposition.

## 6. VERIFIED ROOT CAUSE

Explain whether:

- deal-only MID fields remain a parallel operational source;
- ingestion loops over approved deals instead of canonical MID rows;
- adapter simulation can populate daily data;
- activation and success jobs use different eligibility definitions;
- support/health/residual systems lack one activation generation;
- reporting mixes synthetic/unclassified records, pipeline estimates, processing activity, and residual revenue;
- scheduled jobs have overlapping/memory-only owners.

Use assumption/reality/correction evidence.

## 7. SOURCE-OF-TRUTH AND POST-MID LIFECYCLE

Freeze:

```text
REV-05A canonical MID activation handoff
→ assigned MID awaiting first processing
→ processor-confirmed first transaction
→ active MID generation
→ daily data/funding/health/support lifecycle
→ residual statement import and exact MID match
→ reconciled merchant revenue
→ governed commissions/payouts
→ retention/expansion feedback
```

`merchant_mids` is the operational identity. Provider event/statement receipts are the activity/revenue evidence. A deal-stage label, estimate, manual note, or simulated row is never processing or revenue truth.

## 8. CANONICAL MID PROJECTION AND COMPATIBILITY POLICY

All post-live services must consume the canonical MID ID/generation. Where existing APIs expose `deals.mid`, treat it only as a derived compatibility projection with drift detection.

Requirements:

- no independent manual assignment outside merchant MID authority;
- exact processor/account/application/contact/deal linkage;
- TID/location relationships versioned and conflict-reviewed;
- canonical status transitions with compare-and-set;
- suspension/closure/reopen rules and evidence;
- drift reconciliation that never overwrites conflicts silently;
- historical deal-only rows reviewed, not bulk-promoted by text match.

## 9. FIRST-TRANSACTION ACTIVATION AUTHORITY

Activation requires a qualifying processor-confirmed transaction/daily-stat event for the exact MID generation, not merely approval.

Implement:

- authenticated/provider-authorized ingestion receipt;
- dedupe by provider/account/MID/transaction or day-generation identity;
- qualifying versus test/reversal/decline/pending classification;
- compare-and-set MID `assigned → active` through merchant MID service;
- immutable activation receipt and source evidence;
- activation handoff to success/support/reporting jobs exactly once;
- review state for unknown MID, conflict, or impossible event ordering.

## 10. DAILY PROCESSOR-DATA INGESTION

Use only current REV-05A-activated real adapters/environments. No mock/simulation data may enter production-class tables.

Requirements:

- one durable schedule and occurrence/cursor per processor/account;
- input population from canonical eligible MIDs;
- provider attempt before I/O and reconciliation of unknown outcomes;
- immutable raw receipt reference with redacted normalized facts;
- idempotent upsert/versioning by exact MID/date/provider generation;
- late corrections/reversals represented as new revisions, not silent overwrite;
- funding, volume, transaction count, refunds, chargebacks, average ticket, and effective rate semantics frozen;
- gap detection/backfill and operator review;
- cost/rate/circuit controls;
- no simulated fallback on provider error.

## 11. MERCHANT HEALTH, ANOMALY, CHURN, AND ATTRITION AUTHORITY

Health and risk scores must be deterministic/versioned and evidence-backed. Freeze:

- model/rule version and input window;
- minimum data completeness;
- baseline/comparison period;
- seasonality and new-merchant treatment;
- volume/funding/refund/chargeback/effective-rate/support/NPS signals;
- confidence and missing-data reason codes;
- threshold/alert cooldown;
- human review/override with reason.

Missing processor data must be `unknown`/data-gap, not zero volume or churn. AI may summarize evidence but not invent causal explanations or change merchant state.

## 12. SUPPORT, RFI, CHARGEBACK, AND SLA LIFECYCLE

Use canonical ticket/RFI/chargeback authorities and CR-05 work. Implement/reconcile:

- merchant/contact/MID-linked ticket identity;
- severity/category/routing/owner/SLA/calendar;
- durable comments/evidence and attachment access;
- chargeback case/deadline/status/evidence/submission command;
- provider attempt and reconciliation before/after chargeback I/O;
- RFI request/response/decision state;
- escalation and breach receipts;
- duplicate/reopen/merge behavior;
- role-scoped merchant, agent, manager, admin access.

No provider chargeback submission may be simulated as accepted in production.

## 13. MERCHANT SUCCESS 30/60/90, NPS, REVIEW, RETENTION, AND RATE REVIEW

Build success journeys as versioned durable task/intent plans keyed to canonical activation generation.

Requirements:

- exactly-once 30/60/90 occurrences with business-calendar semantics;
- task ownership/capacity/escalation through CR-05;
- current MID/contactability/merchant-status checks at claim time;
- NPS/review request eligibility, cooldown, prior response, and suppression;
- no review gating, incentive misrepresentation, or autonomous public posting;
- retention/rate review based on reconciled evidence and approved pricing policy;
- closed/suspended/disputed/opted-out merchants stop incompatible communications;
- all external message intents remain held unless CRO-07/channel authority explicitly permits them.

## 14. RESIDUAL IMPORT AND RECONCILIATION AUTHORITY

For every processor residual statement/import:

- identify processor/account/period/file/source receipt and content hash;
- store protected source bytes outside ordinary logs/tables;
- parse through a versioned schema;
- dedupe exact file/row occurrences;
- match only to canonical MID/TID through strong identifiers;
- preserve unmatched/ambiguous/conflicting rows for review;
- distinguish gross processing revenue, fees, net residual, adjustments, reserves, chargebacks, commissions, and payout values;
- support corrected statements/reversals as revisions;
- reconcile exact row totals to file/control totals;
- produce immutable commit and rollback/compensating receipts;
- never use name similarity alone to assign revenue.

Dry run must write no production reconciliation effects unless the existing governed preview authority explicitly owns them.

## 15. PARTNER/AGENT ATTRIBUTION, COMMISSIONS, AND PAYOUTS

Freeze immutable commercial attribution from approved deal/application/MID linkage and contracts. Requirements:

- versioned commission/partner rules and effective dates;
- one attribution per canonical MID generation with conflict review;
- reconciled residual basis only;
- exact calculations/rounding/currency;
- negative adjustments/clawbacks as ledger events;
- approval and payout separation of duties;
- idempotent payout generation/export;
- no payout from test/demo/sandbox/unknown or unreconciled data;
- complete audit and bounded role-scoped reporting.

## 16. REVENUE TRUTH AND REPORTING CONTRACT

Every financial/portfolio/executive report must explicitly classify:

| Class | Meaning | May be called actual revenue? |
|---|---|---:|
| Estimate | Proposal/pipeline/savings forecast | No |
| Processor-confirmed activity | Transactions/volume/fees from active adapter | No, unless defined metric is processing volume/activity |
| Imported residual | Parsed but not fully reconciled | No |
| Reconciled residual revenue | Matched, balanced, production-class statement evidence | Yes |
| Payout/commission | Approved ledger event derived from reconciled residual | Yes, as expense/payable—not revenue |

Production reports must exclude test/demo/synthetic/sandbox/unknown records through the existing commercial/revenue-read authority. Never infer historical revenue from Closed Won, approved, MID-present, or simulated daily data.

## 17. DATA / SCHEMA / MIGRATION CHECK

Prefer existing MID daily stats, merchant health, chargeback, RFI, ticket, onboarding, residual, payout, and audit structures. Add only minimum generation/event/reconciliation/job authorities required for canonical behavior.

Require additive migrations, SQL/schema parity, legal transitions, unique event/file/row/match/payout fences, exact decimal/currency constraints, terminal evidence immutability, performance indexes, fresh/apply-twice/upgrade/recovery tests, and no destructive heuristic backfill.

## 18. AUTHORIZATION, IDOR, CSRF, AND PRIVACY

Certify merchant, agent/partner, manager, admin, finance, support, service-principal, provider-webhook, and unauthorized access for processing stats, health, tickets/RFIs, chargebacks, residual files/rows, commissions, payouts, overrides, exports, and job controls.

Use least privilege, 404-style IDOR, CSRF, webhook authentication/replay denial, bounded pagination, protected downloads, export auditing, and redaction. Aggregate views must not leak cross-agent/partner merchant data. Single-tenant internal CRM semantics remain; role scope is not tenant isolation.

## 19. CONCURRENCY, IDEMPOTENCY, AND RECOVERY

Prove races/replays for first transaction, daily stats revision, duplicate provider pages, poll/webhook overlap, MID suspension during ingest, health calculation, alert cooldown, ticket/RFI/chargeback creation, 30/60/90 scheduling, NPS/review eligibility, duplicate residual file, concurrent reconciliation, corrected statement, commission generation, and payout export.

Workers require leases/fencing, heartbeats, dead letters, restart recovery, and exactly one logical schedule owner.

## 20. EXTERNAL SIDE-EFFECT ORDERING

Required order:

```text
canonical active/eligible MID
→ provider operation/attempt
→ processing/residual/support event receipt
→ canonical normalized/reconciled state
→ CR-05 work and internal alerts
→ held external communication intent
→ authorized financial payout/export where applicable
```

No provider call, chargeback submission, message, review request, retention outreach, payout, or external export may occur before its durable command, authorization, exact evidence, and idempotency identity.

## 21. OPERATOR AND MERCHANT UI

Use existing Portfolio, Merchant Risk, Support Hub, Residual Revenue, Applications/Onboarding, Contact Detail, Agent/Partner, and executive reporting surfaces. Lifecycle-gate merchant-only panels until canonical MID/activation exists.

Show truthful source/evidence class, processing data freshness, health confidence/gaps, open support/RFI/chargeback SLA, success milestones, residual reconciliation status, unmatched rows, commission/payout state, and redacted job failures. Hide/label pre-revenue or no-data states rather than displaying zero as proven performance.

## 22. PREFLIGHT VERDICT, CORRECTED PLAN, AND PHASES

Use exactly one: BUILD-READY, BUILD-READY WITH CORRECTIONS, PREFLIGHT REQUIRED, NOT BUILD-READY, NOT NEW TASK, or WATCH.

State verified What & Why, Done Looks Like, current owners/files, migrations, rollout/rollback, blocking corrections, hardening, and external runtime blockers.

Phases:

1. Freeze MID consumer/writer/job/report census.
2. Bind all post-live work to REV-05A canonical MID generation.
3. Implement first-transaction activation and daily data authority.
4. Implement deterministic health/anomaly and gap handling.
5. Reconcile support/RFI/chargeback/SLA authorities.
6. Implement idempotent success/NPS/review/retention task/intent plans.
7. Harden residual import/reconciliation and attribution ledger.
8. Make revenue-read/reporting truth explicit across UI/API.
9. Consolidate recurring job ownership and recovery.
10. Register disposable end-to-end certification and leave external messages held.

## 23. KILL LINES

- KILL LINE: If any post-live service treats `deals.mid` or imported text as canonical MID authority, the task has FAILED.
- KILL LINE: If mock/simulated processor data can enter production-class activity, health, revenue, chargeback, or payout tables, the task has FAILED.
- KILL LINE: If missing data is represented as zero volume/revenue/health, the task has FAILED.
- KILL LINE: If unreconciled imports, estimates, stages, or sandbox rows appear as actual revenue, the task has FAILED.
- KILL LINE: If residual rows are matched by weak name similarity without review, the task has FAILED.
- KILL LINE: If commissions/payouts can generate from nonproduction or unreconciled evidence, the task has FAILED.
- KILL LINE: If any recurring job has multiple owners or restart duplicates work, the task has FAILED.
- KILL LINE: If external messages/provider submissions/payouts occur during denied certification, the task has FAILED.

## 24. IMPLEMENTATION AND TEST RULES

Use current authorities and minimal coherent changes. No broad UI redesign, production data cleanup, fabricated merchant fixtures in production, dependency churn, or destructive residual rewrite.

Tests cover canonical MID enforcement, first-transaction activation, provider correction/reversal, simulation denial, missing data, ingestion gaps/restart, health versioning, alert cooldown, support/RFI/chargeback SLA, success-task replay, contactability stop, residual exact totals/matching/conflicts/corrections, commission/payout math, production classification, authorization/IDOR/CSRF/redaction, and report truth.

## 25. DISPOSABLE END-TO-END CERTIFICATION

Use fresh disposable PostgreSQL/Redis with network denied and deterministic fake processor/residual transports injected through real contracts.

Certify:

```text
REV-05A canonical MID handoff
→ processor-confirmed first transaction
→ active MID
→ daily stats and health/anomaly
→ support/RFI/chargeback work
→ 30/60/90 success tasks and held communications
→ exact residual import/reconciliation
→ partner/agent attribution
→ approved payout ledger
→ truthful portfolio/revenue reports
```

Include crash/restart and concurrent duplicate events at every boundary, migration fresh/apply-twice/upgrade, role/privacy tests, exact decimal totals, and assertions of zero external network/messages/payout exports.

## 26. POST-BUILD CENSUS, GATES, FINAL VFC, AND RESPONSE

Re-run all MID consumer/writer/job/report searches. Prove all operational reads use canonical MID generation, simulation cannot contaminate production, revenue classes are explicit, scheduled ownership is singular, and messages remain held.

Run migration integrity, processor/MID/portfolio/activation/health/chargeback/residual/payout/revenue-read/authorization/CSRF/API tests, typecheck/build, manifest/pre-deploy registration, and `git diff --check`. Review the full diff.

Return verdict, starting/ending SHA/migration head, full census, authority/lifecycle map, changed files, migrations, disposable totals, zero-side-effect proof, authorization matrix, production-data classification behavior, reporting before/after definitions, and exact remaining OPS-09A/live-provider evidence. Map every requirement and kill line in the final VFC.

Do not call fake processor or imported fixture results production revenue verification.

---

# TASK TO PREFLIGHT + BUILD

## REV-06A — Active Merchant Success, Support & Revenue Truth

### What & Why

Liberty already has MID, processing-stat, health, chargeback, support, merchant-success, residual, payout, partner, and reporting capabilities, but they are not yet proven to share one canonical activation generation or one revenue-evidence hierarchy. REV-06A creates a governed post-MID lifecycle from first transaction through success/support/retention and reconciled revenue without allowing simulated, deal-only, estimated, sandbox, or unclassified records to become business truth.

### Done Looks Like

- Every post-live path keys from canonical `merchant_mids` generation.
- First processor-confirmed transaction activates a MID exactly once.
- Daily stats are durable, correction-aware, and never simulated in production.
- Health/anomaly states are versioned, evidence-backed, and distinguish missing data.
- Support/RFI/chargeback work is canonical, SLA-bound, and provider-reconciled.
- 30/60/90, NPS/review, retention, and rate-review work is idempotent and contactability-gated.
- Residual imports match strongly, balance exactly, preserve corrections, and expose conflicts.
- Commissions/payouts derive only from reconciled production evidence.
- Reports distinguish estimates, processor activity, imported residuals, reconciled revenue, and payouts.
- One durable owner exists per recurring job; external messages remain held.

### Out of Scope

- application/underwriting/boarding/MID creation—REV-05A owns it;
- cold campaign release—CRO-07/OPS-09A own it;
- creating processor/residual contracts, credentials, SLAs, commission terms, or pricing policy;
- automatic merchant communication or payout without separate authorization.

### Relevant Files and Areas to Verify

- merchant MID service/routes/table, activation monitor, processor registry/API
- MID daily stats/transactions and ingestion workers
- merchant health/churn/attrition services and UI
- tickets/RFIs/chargebacks/submission service and support surfaces
- merchant-success sequences, NPS/review, retention/winback/rate-review services
- residual routes/storage/import rows/reconciliation/reports/payout services
- revenue-read/commercial-resolution/executive/portfolio/partner/agent reporting
- queue manager/job registry/startup reconcile
- `shared/schema.ts`, migrations, pre-deploy and CI manifests

### Existing Kill Line

KILL LINE: Actual merchant and revenue truth may derive only from canonical MID identity plus processor-confirmed and fully reconciled evidence; no simulation, stage label, estimate, weak match, or unclassified record may substitute.

## FINAL DIRECTIVE

Verify and build the complete post-MID authority in place. Close every consumer, scheduler, reconciliation, payout, and reporting path; keep external communications held; certify the full lifecycle on disposable infrastructure; and do not claim production revenue readiness from fixtures, simulations, or unreconciled imports.
