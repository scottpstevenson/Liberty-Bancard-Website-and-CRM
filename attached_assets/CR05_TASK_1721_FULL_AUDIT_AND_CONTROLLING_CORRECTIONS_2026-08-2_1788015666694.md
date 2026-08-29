# Liberty Bancard — Task #1721 CR-05 Full Audit and Controlling Corrections

**Audit date:** 2026-08-29  
**Audited repository:** clean detached worktree of current `origin/main`  
**Audited SHA:** `a76149b2f3e6b8cb7c44cc55d8ab43c7b0001d82`  
**Migration head:** `0178_cr04_channel_cohort_authority`  
**CI manifest:** 83 suites  
**Audit disposition:** **DO NOT BUILD FROM THE ATTACHED PLAN ALONE. BUILD-READY AFTER THE CONTROLLING ADDENDUM IN SECTION 34 IS APPENDED VERBATIM.**

## 1. Controlling instruction

This report audits the attached Task #1721 plan against the live post-CR-04 repository. It does not authorize implementation, deployment, production mutation, provider traffic, GHL mutation, message sending, campaign activation, sequence activation, cleanup, classification, or backfill.

The attached plan is directionally strong and already captures several real defects. It is not rejected wholesale. Its remaining gaps are consolidated into **12 material corrections** so the executor receives one stable contract rather than another collection of micro-findings.

If the attached task conflicts with this report, **Section 34 controls**.

## 2. Executive verdict

**VERDICT: BUILD-READY WITH 12 CONTROLLING CORRECTIONS.**

CR-04 is merged and the old prerequisite blocker is gone. The CR-05 objective is valid: the repository still lacks a coherent, authorized, truthful operator chain across Reporting, Tasks/Tickets, Inbox, Statement Review, and Merchant continuation.

The plan cannot safely be executed unchanged because it does not yet:

1. inventory the complete Reporting Hub and financial/outreach consumer surface;
2. freeze exact metric, cohort, revenue, and role semantics;
3. specify a complete task **and ticket** authority and producer cutover;
4. replace process-local Inbox identity and invalid composite pagination;
5. bind Statement Review transitions and savings claims to immutable evidence and receipts;
6. define a crash-safe, bounded CR-04 projection build;
7. fence all task-owned external effects;
8. define transactional snapshot and independent-source time semantics;
9. align Portfolio compatibility reads and mutation schemas;
10. require truthful UI, URL, export, and error behavior across every nested Reporting tab;
11. make exact-SHA disposable CI a merge gate rather than an optional runtime note; and
12. correct stale coordination and baseline assertions without importing unrelated work.

## 3. Correction count and severity

| Priority | Count | Meaning |
|---|---:|---|
| P0 | 7 | Must be resolved in the implementation contract and code before merge |
| P1 | 4 | Required for complete acceptance and truthful operator behavior |
| P2 | 1 | Required baseline/documentation hygiene, but not a new authority |
| **Total** | **12** | Grouped material corrections, not line-item inflation |

## 4. Repository state recapture

| Item | Verified state |
|---|---|
| `origin/main` | `a76149b2f3e6b8cb7c44cc55d8ab43c7b0001d82` |
| HEAD / merge-base | Equal to `origin/main` in the isolated audit worktree |
| Worktree | Clean |
| CR-04 prerequisite | Present in current HEAD |
| Migration head | `0178_cr04_channel_cohort_authority` |
| Journal entries | 183 |
| Latest journal timestamp | `1796200000000` |
| CI manifest | 83 suites: 34 static, 29 integration, 14 server-required, 6 server-optional |

The attached task's SHA, migration head, and manifest count are current. Its statement that Git status was blocked by an index-lock restriction is not an environmental truth for this audit. The isolated worktree was writable and clean.

## 5. Independent baseline gates

| Gate | Result | Audit interpretation |
|---|---|---|
| `npx tsx scripts/ci-suite-manifest.ts --check` | PASS — 83 suites | Manifest baseline verified |
| `npx tsx scripts/check-migration-integrity.ts` | PASS — 403 checks, two historical timestamp warnings | Migration chain verified through 0178 |
| `npx tsx scripts/test-cr04-authority-static.ts` | PASS | CR-04 prerequisite contract present |
| `npx tsx scripts/compliance-scan.ts` | PASS — 105/105 | Baseline compliance scan verified |
| Commercial-classification static suite | PASS — 24 checks | CRO-02 authority baseline verified |
| `npx tsx scripts/scan-csrf-fetch.ts` | FAIL — three inherited client call sites | Existing baseline blocker; CR-05 may not add another bypass or claim a fully green exact-SHA gate |
| `git diff --check` | PASS | Clean baseline |
| Typecheck/build | Not independently rerun in this isolated worktree | The task's reported results are prior evidence, not this audit's proof |
| Disposable integration/server-required | Not run locally because disposable URLs were unset | GitHub CI already provisions PostgreSQL 16 and Redis 7, so this is not a merge waiver |

The inherited CSRF findings are at `client/src/pages/PartnerOrgDashboard.tsx:95,105` and `client/src/pages/VerifyEmail.tsx:23`. They are not permission to broaden CR-05. If they remain on the final exact SHA and the required capability fails, the final status is `DO NOT MERGE`; CR-05 does not get to relabel a failing required gate as success.

## 6. Verified root cause

The remaining defect is not one missing page or one bad total. It is **authority fragmentation**:

- canonical revenue and Merchant predicates exist, but secondary reporting endpoints still aggregate capped or differently scoped records;
- Tasks are produced and mutated by many routes/workers without one identity, generation, ownership, and history contract;
- Tickets and their support metrics remain broadly visible to dashboard users;
- Inbox combines independently bounded sources with a process-local resolution cache and a cursor that cannot reliably advance every source;
- Statement Review allows client-directed workflow state and unsupported savings claims without immutable evidence or delivery receipts;
- CR-04 computes qualification truth correctly but can build the population synchronously and unboundedly;
- the UI often converts missing, failed, or truncated data into convincing zeros.

CR-05 must repair those task-owned read, command, and operator contracts while preserving CRO-01 through CR-04 and every existing canonical writer.

## 7. Preserved authorities

CR-05 must extend or adapt, never replace:

- CRO-01 production/archive/revenue object predicates and canonical deal population;
- CRO-02 class, identity, business-link, redirect, quarantine, provenance, and legacy-effective decisions;
- CRO-03 immutable source observations, candidates, lineage, arbitration, and provider-denied lifecycle;
- CR-04 channel qualification, Ready projection semantics, immutable cohorts, and blocked enrollment-intent fence;
- `writeContact`, existing canonical deal authority, `DealStageService`, application/onboarding writers, and activated-MID Merchant membership;
- current consent, contactability, suppression, pause, and privacy-safe object-access policies;
- existing provider, GHL, SMTP, Gmail, SMS, campaign, and sequence denial boundaries.

## 8. Verified From Code table

| ID | Claim | Verdict | Verified reality and evidence |
|---|---|---|---|
| VFC-01 | CR-04 is present | CONFIRMED | Current main ends at migration 0178; CR-04 static authority passes. |
| VFC-02 | CR-04 projection is bounded | FALSE | `server/services/cr04-cohort-ready-authority.ts:411-512` loads the candidate population, evaluates qualification per contact, slices after evaluation, and freeze can request `Number.MAX_SAFE_INTEGER`. |
| VFC-03 | Reporting Hub is represented by Reporting and Operations only | FALSE | `client/src/pages/dashboard/ReportingHub.tsx:3-35` also mounts Growth KPI, Win/Loss, Outreach Analytics, and Financial Hub; Financial Hub mounts Residual Revenue, Forecasting, and Terminal ROI. |
| VFC-04 | Reporting access already matches endpoint access | FALSE | `/dashboard/reporting` is manager/admin-only at `client/src/App.tsx:584`, while multiple `/api/analytics/*` endpoints use broad `isDashboardUser`. |
| VFC-05 | Pipeline response carries canonical snapshot metadata | PARTIAL | `/api/analytics/pipeline` uses the canonical reader but returns only `data`, discarding the authority's `metadata.scope` and `asOf`. |
| VFC-06 | Support/task analytics are exact and scoped | FALSE | `server/routes/analytics.ts` loads capped/global support and task populations and calculates values from loaded arrays. |
| VFC-07 | Operations Report uses canonical funnel facts | FALSE | `server/routes/acquisition.ts:979-1193` equates Closed Won with signed merchants and sequence `converted` with replies, uses lifecycle labels for funnel stages, and caps/scopes several inputs inconsistently. |
| VFC-08 | One task authority exists | FALSE | `server/storage/tasks.ts:106-226` exposes generic list/create/update/bulk primitives; raw `createTask` remains distributed across routes and workers. |
| VFC-09 | Ticket access is object-scoped | FALSE | `server/routes/tickets-tasks.ts` exposes list/detail/update/comment behavior broadly and does not consistently authorize the linked contact/deal or canonical assignee. |
| VFC-10 | Inbox continuation is authoritative | FALSE | `server/routes/inbox.ts:468-520` remembers resolutions in process memory, reports `knownFilteredTotal` from the fetched window, and derives `hasMoreKnown` from the final slice. |
| VFC-11 | Inbox ownership is indirect-object safe | FALSE | `server/routes/inbox-ownership.ts` accepts owner/deal linkage without complete linked-object authorization and returns defaults for unresolved IDs. |
| VFC-12 | Statement Review transitions are evidence-bound | FALSE | `server/routes/statement-review.ts:156-208` accepts client-supplied status/analyst/savings changes and stamps `followUpSentAt` from a status change rather than a delivery receipt. |
| VFC-13 | Portfolio Merchant membership is canonical | CONFIRMED | `server/routes/portfolio.ts:60,158-160,214` requires an active MID with `activated_at IS NOT NULL`. |
| VFC-14 | Portfolio task compatibility and suppression input are complete | FALSE | Open tasks use only `pending/open`; suppression PATCH destructures an unvalidated body at `server/routes/portfolio.ts:271-330`. |
| VFC-15 | CI cannot provide disposable infrastructure | FALSE | `.github/workflows/ci.yml:58-85,126-145,184-197` provisions PostgreSQL and Redis, runs migrations twice, and runs integration/server-required capabilities. |

## 9. Canonical operator object contract

Freeze these meanings before editing:

| Object/fact | Canonical meaning |
|---|---|
| Person | Production, non-archived canonical contact; may also be a Lead or Merchant state |
| Prospect Staging | Pre-contact staging record; never fabricated from a contact |
| Lead | Distinct production contact with at least one qualifying local sales deal under CRO-01 |
| Deal | Canonical local sales deal; stage changes only through the existing stage authority |
| Reply | Durable inbound communication event linked to a canonical contact; never sequence `converted`, a task completion, or a generated draft |
| Statement event | Accepted canonical document/review event linked to the same authorized subject/business |
| Proposal generated | Versioned local proposal artifact; not proof of delivery |
| Proposal sent | Immutable successful delivery receipt linked to proposal generation |
| Application | Canonical application state transition from the existing writer |
| Closed Won | Canonical deal-stage event; not Merchant status |
| Merchant | Distinct production contact with active MID and non-null activation time |
| Task | Durable work command with producer, issue, subject, generation, canonical assignee, authorization, and history |
| Ticket | Durable support object scoped through its linked contact/deal and canonical assignee |
| Inbox item | Source-qualified immutable message identity plus source completeness/continuation metadata |

People is a superset. Lead, Merchant, and other states may overlap for the same contact; they are not mutually exclusive tables.

## 10. P0-01 — Freeze the complete Reporting Hub consumer and role contract

### Finding

The plan's relevant-file list and build steps understate the real reporting surface. Reporting Hub directly mounts:

- `Reporting.tsx`;
- `GrowthKPI.tsx`;
- `WinLoss.tsx`;
- `OutreachAnalytics.tsx`;
- `OperationsReport.tsx`; and
- `FinancialHub.tsx`, which mounts `ResidualRevenue.tsx`, `Forecasting.tsx`, and `TerminalROI.tsx`.

Additional consumers include Pipeline, Overview, and Operator Dashboard. Endpoints include `/api/analytics/*`, `/api/kpi/*`, `/api/reporting/operations`, `/api/deal-competitors`, `/api/forecasting/summary`, residual/MID/import/payout reads, `/api/admin/terminal-roi-report`, campaigns, outbound messages, and sequence A/B outcomes.

The page is manager/admin-only while several analytics endpoints are agent-accessible. The plan's role matrix saying agents receive generic “Owned” reporting would either open the manager hub or preserve API/UI disagreement.

### Mandatory correction

Before implementation, produce a checked-in or test-owned endpoint/consumer matrix with one disposition per page/query:

1. **canonicalize in CR-05**;
2. **adapt to an existing canonical authority**;
3. **show a truthful partial/unavailable/deferred state**; or
4. **retain as a separately governed mutation outside CR-05**.

Freeze access as follows:

- Reporting Hub and its financial/outreach management tabs remain manager/admin-only.
- Agents receive only explicitly named owned operational cards/routes, never a hidden global endpoint.
- Public and merchant users have no internal reporting API access.
- Read-only outreach outcome metrics may be reconciled in CR-05; A/B triggers, campaign operations, sender controls, and sequence mutations remain CR-06.
- Financial read truth displayed inside Reporting Hub is in scope, but residual imports, equipment/config mutations, and provider/payment operations stay with their current authorities.

No Reporting Hub tab may be omitted from the final VFC merely because its endpoint is not listed in the original prompt.

## 11. P0-02 — Freeze exact metric, cohort, and revenue semantics

### Finding

Current analytics mix capped inventories, lifecycle labels, estimated economics, event counts, and direct table counts. Examples include:

- capped ticket and contact/deal reads;
- global task/support metrics;
- top-N source/vertical groups later treated as totals;
- conversion events filtered after the query limit;
- forecast values labeled close to actual revenue;
- sequence enrollment `converted` treated as a reply;
- Closed Won treated as a signed Merchant;
- no-event or failed-query cases rendered as zero.

### Mandatory correction

For every displayed number, define:

- numerator and denominator;
- entity cardinality (`DISTINCT contact`, deal, task, ticket, review/document, MID, event, or receipt);
- production/archive/classification predicate;
- owner/team/admin scope;
- cohort entry event and time window;
- stage/event tie-break for multi-deal contacts;
- source and completeness;
- `asOf` or source `capturedAt`;
- whether the value is actual, forecast, partial, or unavailable.

Use these minimum funnel semantics:

1. Lead = distinct production contact with a qualifying deal.
2. Reply = durable inbound communication event.
3. Statement = accepted document/review event.
4. Proposal generated and proposal delivered are separate facts.
5. Application submitted/approved comes from canonical application transitions.
6. Closed Won is a deal event.
7. Merchant is active MID plus activation evidence.
8. Actual revenue requires reconciled processor/residual evidence; estimated deal economics are explicitly forecast.

Separate current inventory from cohort conversion. A conversion report must retain one denominator, one event-time policy, and one cohort window. Missing instrumentation returns `null`/`unavailable`, not zero.

## 12. P0-03 — Build one task and ticket authority, then cut over every producer

### Finding

The task schema carries relationships, free-text assignee/status, title, source, and automation key, but lacks a complete durable producer/issue/subject/generation identity, canonical assignee user ID, version fence, and append-only state history. Raw task creation remains distributed across many route and worker families. Status values include `pending`, `open`, `in_progress`, `completed`, `done`, `resolved`, and `cancelled`.

Ticket routes and support analytics have the same ownership problem: linked-contact authorization and canonical assignment are not uniformly applied.

### Mandatory correction

Add one additive authority for new authoritative rows while preserving legacy history without backfill:

- `authorityVersion`;
- registry-backed `producerKey`;
- stable `issueKey`;
- `subjectType` plus stable `subjectKey` and verified existing FKs;
- monotonically increasing `generation`;
- canonical assignee user ID, with display/email only as projections;
- command/idempotency key;
- lock/version fence and terminal reason;
- append-only task events with unique event keys.

Canonical statuses for new rows are `open`, `in_progress`, `completed`, and `cancelled`. Read adapters may map legacy `pending → open` and `done/resolved → completed`; unknown states must remain an explicit mismatch bucket. Do not rewrite legacy rows.

Use a partial active uniqueness constraint for authoritative `(producer, issue, subject)` work and a complete uniqueness constraint including generation. A completed automated task is not silently reopened; a new occurrence creates the next generation. Manual reopening must be explicitly allowed and evented.

Every automatic producer discovered by the live census must call the authority. Add a structural scanner that fails on raw automatic `createTask` outside the authority, tests, and migrations. Manual callers may not supply protected producer/generation metadata.

Harden task and ticket list/count/detail/create/update/comment/bulk behavior through direct and indirect object authorization. Bulk commands must validate every item and scope before mutation, with an atomic contract or an exact privacy-safe per-item disposition contract.

Retire or disable the production task-cleanup endpoint. CR-05 may return aggregate dry-run buckets only.

## 13. P0-04 — Replace Inbox's process-local identity and invalid composite pagination

### Finding

Inbox fetches multiple independently capped sources, merges them, applies a final page, and reports a known total from the fetched window. Its continuation does not retain a valid cursor/high-water for every source. Source-to-object resolutions are held in an in-process TTL map, which does not survive restart or multiple replicas.

Inbox ownership accepts link and assignee fields without complete indirect-object authorization. Classify can operate on client-supplied message text instead of immutable server-resolved content. Comms Hub also uses `/api/sms-inbox/*` and `/api/live-chat/*`, but those route families are absent from the plan's stated scope.

### Mandatory correction

Create a versioned composite cursor containing:

- per-source continuation/high-water;
- filter and sort fingerprint;
- actor-scope fingerprint;
- stable tie-break (`timestamp`, source, immutable source ID);
- result schema version.

Use stable dedupe identity `(source, account/location, providerItemId)`. Local sources use keyset pagination; provider sources use their native continuation or explicitly report that continuation is unavailable. `knownTotal` is `null` unless exact. `hasMore` is unknown when any relevant source is incomplete.

Replace the process-local item-resolution map with durable, reconstructable, or cryptographically bound server-side resolution. Classify only immutable content resolved by the server. Authorize every linked contact, deal, conversation, ownership record, and live-chat session with privacy-safe not-found behavior.

The contract must cover `inbox.ts`, `inbox-ownership.ts`, `toolkit.ts` SMS Inbox routes, `live-chat.ts`, and all Comms Hub callers. CR-05 tests may create local reply/task intents only; no reply transport may run.

## 14. P0-05 — Bind Statement Review to immutable evidence, valid transitions, and delivery receipts

### Finding

Statement Review list/detail/update/create paths do not consistently authorize the linked document, contact, and deal as one canonical subject. The update endpoint accepts client-supplied analyst identity, arbitrary status, savings override, and draft fields. Setting `follow_up_sent` records a timestamp without a successful delivery receipt. Draft generation can use unverified summaries and generic savings claims.

The client also exposes proposal generation/sending, email sharing, and GHL sync actions, which cannot become CR-05 completion evidence under the local-only safety boundary.

### Mandatory correction

- Keep internal `/api/statement-reviews*` dashboard-only. Merchant/public access remains through existing separate portal/token authorities; do not grant merchant access to the internal route family.
- Verify that document, contact, deal, review, and business link resolve to the same authorized canonical subject.
- Enforce a state graph such as `received → in_review → ai_analyzed → reviewed → complete`; retain `draft_ready` separately if needed.
- Derive analyst identity from the authenticated canonical user, never a client name/ID.
- Add immutable evidence/analysis version and optimistic concurrency/ETag behavior.
- Savings claims require versioned evidence with units, currency, and period. If unavailable, mark the draft review-required/unavailable and omit the numeric claim.
- `follow_up_sent` or equivalent delivery state may only be projected from an immutable successful receipt. An attempted/denied/failed send is not sent and is not a reply.
- Preserve existing proposal/application/underwriting/onboarding writers; retries reuse canonical records.

## 15. P0-06 — Make CR-04 projection builds bounded, resumable, and truthfully frozen

### Finding

The CR-04 projection authority correctly owns qualification, but current execution can evaluate the whole population synchronously and perform per-contact qualification before slicing. Freeze requests can select `Number.MAX_SAFE_INTEGER`. This can time out, exhaust memory/connection capacity, or leave an ambiguous partial build.

### Mandatory correction

Add a durable projection-run state machine with:

- `building`, `frozen`, `failed`, and superseded/cancelled states;
- keyset batch cursor and high-water;
- bounded batch size and bounded worker concurrency;
- lease/fence/heartbeat and retry-safe checkpoints;
- exact final population count and fingerprint;
- immutable run inputs: policy version, filters, actor scope, and source snapshot references.

No HTTP request may attempt an unbounded synchronous freeze. Return `202 projection_pending` or a stable overflow/unavailable contract while work is incomplete. A run becomes `frozen` only after every batch is reconciled and the final exact count/fingerprint is committed. A crash/restart must resume without duplicates or omitted subjects.

CR-05 may improve execution and read reconciliation; it may not redefine CR-04 qualification or enrollment eligibility.

## 16. P0-07 — Fence every task-owned external side effect

### Finding

In-scope routes currently include paths that can:

- propagate task deletion to GHL;
- enroll a support workflow when creating a ticket;
- send Inbox/live-chat/SMS/email replies;
- send/share proposals or sync Statement Review data;
- trigger outreach A/B evaluation.

### Mandatory correction

CR-05 certification remains local-only:

1. authorize actor and every linked object;
2. validate a strict command;
3. commit local state/event/intent transactionally;
4. record privacy-safe audit;
5. return canonical IDs and disposition.

All transports must be injected and fail closed in tests. A denied external effect must not mark a task completed, a proposal sent, a reply received, a stage advanced, or a funnel event successful. Existing external operations not owned by CR-05 remain disabled or represented as truthful local intents. Campaign/sender/sequence mutation remains CR-06.

## 17. P1-01 — Define snapshot, source-envelope, cardinality, and error semantics

### Finding

The plan requests one `asOf` across mixed database and provider data. That is not achievable as one atomic timestamp. It also includes `forbidden` as a source substatus even though authorization failure should normally fail the request, not return a partially populated 200 response.

### Mandatory correction

- Local database metrics use one read-only repeatable-read transaction and expose database transaction `asOf`, report/snapshot ID, filters, scope, and cardinality.
- Each independent source exposes its own `capturedAt`, cursor/high-water, fetched count, completeness, and stable error code.
- Top-level authorization failure returns the privacy-safe 401/403/404 contract; it is not a `forbidden` child source inside a successful report.
- `partial`, `unavailable`, and `schema_missing` remain distinct. Unknown metrics are `null`, never zero/empty.
- Exports bind report/snapshot fingerprint, filters, actor scope, schema version, source metadata, and generation time.
- Multi-deal, multi-MID, and multi-event tie-break/cardinality rules are documented and tested.

## 18. P1-02 — Align Portfolio compatibility without changing Merchant truth

### Finding

Portfolio membership correctly requires active MID plus activation. Direct compatibility details still diverge: open tasks use `pending/open`, an editability path lacks the production classification guard, owner lists can include non-production records, and suppression PATCH lacks a strict schema.

### Mandatory correction

- Preserve the existing Merchant predicate exactly.
- Route open-task counts through the new task read adapter and canonical active states.
- Require the canonical production deal/contact predicate for editability and owner lists.
- Add a strict suppression body schema, reason bounds, CSRF, ownership, and linked-deal authorization.
- Do not expand VAS enrollment, sender behavior, or campaign activation.

## 19. P1-03 — Make every operator UI, URL, and export truthful

### Finding

Several reporting components default missing data to zero or omit explicit errors. Outreach analytics calculates values from fetched arrays. Nested Financial Hub tabs reuse generic `tab` state and can navigate away from Reporting Hub instead of preserving the parent tab. Task/Inbox/Statement deep links are not comprehensively protected against substituted IDs and refresh/back-forward behavior.

### Mandatory correction

For every in-scope page, prove distinct loading, empty, partial, unavailable, forbidden, and error states. Never render a failed or absent metric as `0`. Show source freshness/completeness where it affects interpretation.

Use stable namespaced URL state, for example `tab=financial&financialTab=forecasting`, or a clearly documented equivalent. Preserve filters, selected object, and pagination through refresh/back/forward while reauthorizing the server object. Keyboard and responsive behavior are acceptance requirements.

Exports/copy actions must include the same filters, scope, snapshot/source metadata, and truth labels as the screen.

## 20. P1-04 — Require exact-SHA disposable CI and non-empty end-to-end proof

### Finding

The plan treats missing local disposable URLs as an environment limitation. The repository's GitHub workflow already provisions PostgreSQL and Redis, performs two migration passes, and runs deterministic integration and server-required capabilities.

### Mandatory correction

CR-05 is not complete until the exact reviewed SHA passes:

- focused static contract and structural scans;
- disposable migration bootstrap and second-run idempotency through the new head;
- deterministic integration on non-empty fixtures;
- provider-denied server-required HTTP role/IDOR/CSRF tests;
- CR-04 projection scale/crash/resume tests;
- task producer replay/concurrency/generation/bulk tests;
- ticket linked-object authorization tests;
- Inbox multi-source progression, restart/replica, dedupe, and outage tests;
- Statement Review transition, evidence, linkage, and receipt tests;
- Reporting exact-count/scope/metadata tests;
- full synthetic Lead-to-Merchant reconciliation;
- `npm run check`, `npm run build`, migration integrity, manifest, route/API scans, and `git diff --check`.

Fixture setup must fail if empty or skipped. Any network/GHL/provider/SMTP/Gmail/SMS call fails the suite. Local inability to run the stateful gates is not `SAFE TO MERGE — RUNTIME VERIFICATION PENDING` when CI can run them.

## 21. P2-01 — Correct baseline and coordination language

The final prompt must:

- remove claims that this environment lacks write permission or cannot run Git status;
- treat task numbers `#1708`, `#1723`, and `#1724` as coordination notes unless their exact commits and current status are recaptured;
- never use another task as a waiver for a CR-05-owned failure;
- recapture current SHA, migration head, manifest, workflow, and ownership immediately before implementation;
- expand the relevant-file list to the full live consumer/producer census;
- report any inherited exact-SHA blocker honestly without folding unrelated code into CR-05 merely to make a number green.

## 22. Corrected authorization matrix

| Surface/action | Public | Merchant | Agent | Manager | Admin/service |
|---|---|---|---|---|---|
| Internal Reporting Hub | No | No | No | Authorized scope | Authorized scope |
| Explicit owned operational metrics | No | No | Owned only | Authorized scope | Authorized scope |
| Task/ticket read and commands | No | No | Owned/linked only | Authorized scope | Authorized scope |
| Automated producer metadata | No | No | No | No | Registered service authority only |
| Internal Statement Review routes | No | No | Owned/linked if policy allows | Authorized scope | Authorized scope |
| Merchant statement portal/token routes | No generic access | Own token/portal contract only | N/A | N/A | Existing authority |
| Inbox/Comms read and local intent | No | No | Owned/linked only | Authorized scope | Authorized scope |
| Dry-run reconciliation | No | No | No | Aggregate authorized scope | Aggregate authorized scope |
| External send/provider/GHL/campaign action | No | No | No CR-05 activation | No CR-05 activation | Existing authority, compile/runtime denied in certification |

Every mutation requires session authentication, CSRF, a strict body schema, direct and indirect object authorization, and privacy-safe not-found behavior. Counts, owner lists, source envelopes, mismatch buckets, and exports must not leak cross-agent existence.

## 23. Canonical task state and generation rules

1. Register producer and validate eligibility.
2. Resolve and authorize the canonical subject.
3. Derive canonical assignee user ID; never trust a client display name.
4. Acquire/reuse the current `(producer, issue, subject, generation)` command.
5. Insert/reuse one active task under the partial uniqueness fence.
6. Append an idempotent creation/state event.
7. Return canonical task ID, generation, disposition, and reason code.
8. On completion/cancellation, append the terminal event and close the active identity.
9. A new real occurrence increments generation; replay does not.

Legacy rows remain readable through explicit compatibility mapping. Reconciliation reports unknown producers/statuses/orphans/duplicates as aggregate buckets only.

## 24. Reporting and source response contract

Every authoritative response must include or explicitly document:

- `schemaVersion`;
- `reportId`/snapshot fingerprint;
- actor `scope` without exposing unrelated users;
- normalized `filters` and timezone;
- `asOf` for local transactional data;
- per-source `capturedAt` for independent sources;
- cardinality/entity unit;
- exact total or `null`;
- `resultScope` (`complete`, `page`, `fetched_window`, or equivalent);
- `completeness` and continuation/high-water;
- stable privacy-safe error code and correlation ID.

Removing CRO-01 metadata from a route adapter is a defect. The Pipeline and Reporting consumers must receive the same population and interpret the same metadata.

## 25. Corrected build plan

1. **Recapture baseline** — clean main, exact SHA, migration head, suite manifest, workflows, CR-04 contract, and overlapping merged commits.
2. **Create full census** — every Reporting/Financial/Outreach consumer and endpoint; every task/ticket producer; every Inbox/Comms route; every Statement/Portfolio command.
3. **Freeze contracts** — canonical objects, metrics, cohort/cardinality, role matrix, snapshots, source envelopes, task generations, Inbox cursors, Statement transitions, and side-effect fence.
4. **Build focused schema** — additive task/event/projection/continuation/evidence structures only; no history rewrite or backfill.
5. **Build read authorities** — exact scoped aggregates and adapters for Reporting, support, tasks/tickets, Inbox, Statement, and Portfolio.
6. **Build task/ticket commands** — one authority, strict producers, object authorization, idempotency, active uniqueness, generation, history, and atomic bulk behavior.
7. **Cut over all producers and routes** — prove structurally that automatic task creation cannot bypass the authority; harden tickets and retire cleanup execution.
8. **Repair Inbox continuation** — durable resolution, per-source cursors/high-water, stable dedupe, complete route-family authorization, truthful unknown totals.
9. **Harden Statement Review** — linkage, state graph, evidence versions, concurrency, receipt-derived delivery, and unsupported-claim prevention.
10. **Scale CR-04 projection** — durable batched build with leases/checkpoints and exact frozen count/fingerprint.
11. **Align Portfolio and UI** — preserve Merchant truth, adapt tasks, validate suppression, implement truthful states/URL/export behavior across the complete hub.
12. **Certify exact SHA** — isolated non-empty tests, all required capabilities, full diff/grep/VFC, and zero external/production side effects.

## 26. Done looks like

- Every Reporting Hub tab and directly consumed endpoint has a tested disposition.
- Pipeline and Reporting use the same canonical deal/Lead population and retain scope/snapshot metadata.
- Every displayed total is exact for its declared scope or explicitly unknown/partial.
- Actual, forecast, cohort conversion, and current inventory are never conflated.
- Reply, proposal delivery, Closed Won, and Merchant are supported by their distinct durable events/evidence.
- New automated tasks have one producer/issue/subject/generation identity and one active row.
- Every automatic producer uses the task authority; legacy history is preserved.
- Task and ticket list/detail/count/create/update/comment/bulk paths enforce direct and indirect scope.
- Inbox can resume each source independently and survive restart/replica changes without losing identity.
- Statement Review state and savings claims are evidence-bound; sent state requires a receipt.
- CR-04 projections are bounded, resumable, and never partially frozen.
- Portfolio retains active-MID Merchant truth and uses canonical task compatibility.
- UI and exports preserve URL state, scope, freshness, partial/unavailable truth, and authorization.
- Exact-SHA CI proves the non-empty Lead-to-Merchant chain with no network or production mutation.

## 27. Kill lines

Return `DO NOT MERGE` if:

- any Reporting Hub tab or directly consumed endpoint is omitted from disposition/VFC;
- a cap, page, top-N group, loaded array, or provider window is labeled a global total;
- missing/unavailable data becomes zero or an authoritative empty result;
- agents can call global analytics hidden by the manager-only UI;
- lifecycle labels or scores substitute for Lead, reply, application, Closed Won, or Merchant evidence;
- estimated economics are labeled actual revenue;
- any automatic task producer bypasses the authority;
- duplicate active automated tasks or ambiguous generations remain possible;
- task/ticket/Inbox/Statement counts or IDs leak cross-agent existence;
- Inbox continuation cannot resume all sources or relies on process-local identity;
- client-supplied Inbox content, owner IDs, deal IDs, analyst IDs, or status jumps become authoritative;
- Statement Review marks delivery without an immutable successful receipt;
- CR-04 performs an unbounded synchronous freeze or labels a partial projection frozen;
- Portfolio admits a record without active MID and activation evidence;
- a GHL/provider/SMTP/Gmail/SMS/campaign/sequence/deploy path runs in certification;
- cleanup/backfill/classification mutates production or fabricates history;
- a migration edits history, uses `db push`, or invalidates legacy rows;
- any CR-05-owned disposable/stateful gate is skipped or empty;
- the final exact SHA has a failing required capability and is nevertheless labeled safe.

## 28. Migration rules

If the implementation needs persistence, use the next valid additive migration after 0178 with a timestamp greater than `1796200000000`. Update schema, SQL migration, journal, and snapshot metadata consistently.

Migration requirements:

- no `db push`;
- no edited historical migration;
- no production execution in this task;
- no backfill or row rewrite;
- scoped constraints that permit legacy rows;
- two-pass disposable bootstrap/idempotency;
- rollback/recovery behavior documented where the repository convention supports it;
- full migration-integrity proof.

## 29. Focused test requirements

Add non-empty tests for:

- totals greater than all page/source limits;
- agent A/agent B/manager/admin/public/merchant matrices;
- multi-deal contacts, multi-MID contacts, and tie-break/cardinality;
- every metric definition and source envelope state;
- all registered task producers, replay, concurrency, completion, new generation, cancellation, and partial failure;
- manual metadata spoofing and unknown producer/status buckets;
- ticket linked-contact/deal authorization and comment/update transitions;
- Inbox multi-source page progression, equal timestamps, dedupe, restart/replica, source outage, and substituted IDs;
- Statement Review linkage, state graph, analyst derivation, evidence version, optimistic concurrency, unsupported savings, and delivery receipt;
- CR-04 batch scale, crash after checkpoint, lease theft/stale fence, resume, exact final count, and immutable fingerprint;
- Portfolio negative/positive Merchant fixtures and task-count compatibility;
- loading/empty/partial/unavailable/error/forbidden and URL/deep-link/back-forward behavior;
- a full synthetic Lead → reply → statement → proposal/application → Closed Won → active MID/Merchant chain;
- a fail-on-any-network/provider/GHL/send hook.

## 30. Required gates

Report exact command, exit code, duration, and result for:

- focused CR-05 static, integration, HTTP, jsdom, and structural scans;
- `npx tsx scripts/ci-suite-manifest.ts --check`;
- `npx tsx scripts/run-ci-suites.ts --capability deterministic-static`;
- disposable migration bootstrap twice;
- `npx tsx scripts/run-ci-suites.ts --capability deterministic-integration`;
- provider-denied server startup and `npx tsx scripts/run-ci-suites.ts --capability server-required`;
- route guards, API coverage, CSRF, privacy/compliance, and CRM/revenue/CRO-02/CRO-03/CR-04 regressions;
- `npx tsx scripts/check-migration-integrity.ts`;
- `npm run check`;
- `npm run build`;
- `git diff --check`.

Required exact-SHA CI artifacts must identify the commit, migration head, suite manifest, disposable database identity, isolated Redis prefix, and provider-denial configuration without exposing secrets.

## 31. Post-build search verification

Search and prove:

- no changed metric derives authoritative totals from `.length`, `reduce`, fixed limits, top-N results, or client pages;
- all Reporting Hub consumers are in the disposition matrix;
- all Lead/deal/Merchant/funnel reads use canonical predicates/events;
- every automatic task producer uses the new authority;
- no route calls generic task storage to bypass authorization/generation;
- no task/ticket/Inbox/Statement parent is read before scope verification;
- no Inbox truth depends on the process-local resolution map;
- no unavailable/partial/error branch defaults to zero;
- no client-supplied analyst/owner/deal/message identity becomes authoritative;
- no Statement state claims delivery without a receipt;
- no unbounded CR-04 freeze remains;
- no direct contact/deal/stage/Merchant writer was added;
- no CR-06 sender/campaign mutation or CR-07 activation leaked in;
- no provider/GHL/send/deployment code path can execute in certification.

## 32. Diff review

Before the final verdict, run status, stat, name-only diff, full diff, and whitespace check. Confirm:

- only CR-05-owned code/schema/test files changed;
- every new migration/journal/schema entry agrees;
- every new endpoint has a real consumer or documented operator contract;
- every removed/retired endpoint has no client caller;
- no secrets, PII, provider payloads, database dumps, imports/exports, PDFs, pasted prompts, debug logging, generated output, dependency drift, or unrelated formatting entered the diff;
- CR-04 and prior authorities were preserved;
- no production or external state was touched.

## 33. Final VFC table required from the executor

| ID | Requirement | Evidence | Test/gate | Status |
|---|---|---|---|---|
| VFC-F01 | Complete Reporting Hub endpoint/consumer disposition | matrix + routes/pages | static consumer scan | PASS/FAIL |
| VFC-F02 | Canonical metric/cohort/revenue definitions | contracts/queries | exact fixture tests | PASS/FAIL |
| VFC-F03 | Snapshot/source envelope truth | response contracts | outage/partial tests | PASS/FAIL |
| VFC-F04 | Task identity, generation, uniqueness, and history | schema/service | replay/concurrency tests | PASS/FAIL |
| VFC-F05 | All automatic producers cut over | producer registry/scan | structural + integration tests | PASS/FAIL |
| VFC-F06 | Ticket direct/indirect scope | routes/service | role/IDOR tests | PASS/FAIL |
| VFC-F07 | Inbox durable identity and per-source continuation | service/cursor | restart/page/outage tests | PASS/FAIL |
| VFC-F08 | Statement evidence, transition, and receipt authority | route/service/schema | state/linkage tests | PASS/FAIL |
| VFC-F09 | CR-04 projection bounded/resumable/exact | run service/schema | scale/crash/resume tests | PASS/FAIL |
| VFC-F10 | Portfolio Merchant truth preserved | predicate/adapter | positive/negative fixtures | PASS/FAIL |
| VFC-F11 | UI/URL/export truth | pages/contracts | jsdom/navigation tests | PASS/FAIL |
| VFC-F12 | Role, privacy, CSRF, and object scope | middleware/queries | full HTTP matrix | PASS/FAIL |
| VFC-F13 | No external/production mutation | diff/search/hooks | provider-denied certification | PASS/FAIL |
| VFC-F14 | Migrations and exact-SHA CI complete | SHA/journal/artifacts | required gates | PASS/FAIL |

Expand this table until every Done and Kill condition has direct file:line evidence and a named test. A prose architectural review marked `CLEAR` is not a substitute for failed or unrun stateful proof.

## 34. Controlling addendum — append to Task #1721 verbatim

> ### CR-05 CONTROLLING ADDENDUM — LIVE-REPOSITORY AUDIT 2026-08-29
>
> This addendum supersedes conflicting or incomplete portions of Task #1721. Implement CR-05 from current clean `main`, recapturing the SHA, migration head, manifest, workflows, and merged overlap immediately before editing. The audited baseline was `a76149b2f3e6b8cb7c44cc55d8ab43c7b0001d82`, migration head `0178_cr04_channel_cohort_authority`, and 83 manifest suites.
>
> **1. Complete Reporting Hub census and role contract.** Inventory every mounted Reporting Hub tab and every direct API consumer, including Reporting, Growth KPI, Win/Loss, Outreach Analytics, Operations, Financial Hub, Residual Revenue, Forecasting, Terminal ROI, Pipeline, Overview, and Operator Dashboard. Give every endpoint one tested disposition: canonicalize, adapt, truthfully defer/unavailable, or retain as separately governed mutation. Reporting Hub remains manager/admin-only. Agents receive only explicitly named owned operational metrics. Public and merchant users have no internal reporting access. Read-only outreach outcomes may be reconciled here; A/B triggers, campaign/sequence/sender mutations remain CR-06.
>
> **2. Exact metric semantics.** Define numerator, denominator, cardinality, population, role scope, cohort entry, time window, tie-break, source, completeness, and time metadata for every metric. Lead requires a qualifying canonical deal; reply requires a durable inbound event; statement requires an accepted document/review event; proposal generated and delivered are separate; application uses canonical transitions; Closed Won is a deal event; Merchant requires active MID plus activation; actual revenue requires reconciled processor/residual evidence. Lifecycle labels, sequence `converted`, task completion, and generated drafts cannot substitute for these facts. Missing instrumentation is unavailable/null, never zero.
>
> **3. Task and ticket authority.** Add one additive authority for new rows with registry-backed producer, issue, subject, generation, canonical assignee user ID, command key, version/fence, terminal reason, and append-only events. Canonical new statuses are open/in_progress/completed/cancelled; legacy statuses are read-adapted and never rewritten. Enforce one active authoritative producer+issue+subject and unique generations. Completed automated work is not silently reopened. Cut every automatic producer from the live census to the authority and add a structural bypass scanner. Manual callers cannot spoof protected metadata. Harden task and ticket list/count/detail/create/update/comment/bulk behavior through direct and indirect object authorization. Retire task cleanup execution; reconciliation is aggregate dry-run only.
>
> **4. Inbox and Comms.** Replace process-local item resolution with durable/reconstructable server authority. Use a versioned composite cursor with per-source continuation/high-water, filter/scope fingerprint, and stable tie-break. Deduplicate by source+account/location+providerItemId. Exact totals are null unless proven; incomplete sources make hasMore/total truth explicit. Classify immutable server-resolved message content only. Authorize every linked contact, deal, ownership record, SMS conversation, and live-chat session. Scope includes Inbox, Inbox Ownership, SMS Inbox/toolkit, Live Chat, and Comms Hub. Tests create local intents only and deny every transport.
>
> **5. Statement Review.** Internal statement-review APIs remain dashboard-only; merchant/public use only existing separate portal/token contracts. Require document/contact/deal/review/business identity consistency and indirect-object authorization. Enforce an explicit transition graph, authenticated analyst identity, immutable evidence/analysis version, and optimistic concurrency. Numeric savings claims require versioned evidence with units/currency/period. Delivery/sent state requires an immutable successful receipt; attempted, denied, or failed sends do not count. Preserve proposal/application/underwriting/onboarding writers and reuse canonical records.
>
> **6. CR-04 projection scale.** Preserve CR-04 qualification semantics but replace unbounded synchronous projection/freeze with a durable building/frozen/failed run, keyset batches, bounded concurrency, lease/fence/heartbeat, retry-safe checkpoints, exact final count, and immutable fingerprint. Return 202 projection_pending/explicit overflow while incomplete. Never label a partial run frozen.
>
> **7. External-effect fence.** CR-05 performs local authorization, validation, transactional command/event/intent writes, privacy-safe audit, and canonical response only. No GHL/provider/SMTP/Gmail/SMS/message/campaign/sequence/deploy action may run. A denied effect cannot complete a task, mark delivery/reply, advance a stage, or create a funnel success. CR-06 owns sender/campaign mutation.
>
> **8. Snapshot and source truth.** Local metrics use one read-only repeatable-read transaction and return database asOf, report ID/fingerprint, normalized filters, actor scope, and cardinality. Independent sources carry their own capturedAt/cursor/high-water/completeness. Top-level authorization failure is a privacy-safe 401/403/404, not a forbidden child source in a 200. Partial/unavailable/schema_missing remain distinct and unknown metrics are null. Exports bind the same snapshot, filters, scope, schema, and source metadata.
>
> **9. Portfolio compatibility.** Preserve active-MID-plus-activation Merchant membership. Adapt open-task counts to the task authority, require production predicates for editable deals/owner lists, and add strict schema/CSRF/object scope to suppression commands. Do not activate VAS or sender behavior.
>
> **10. UI truth.** Every mounted tab must distinguish loading, empty, partial, unavailable, forbidden, and error states; never default missing data to zero. Replace client-array aggregates with server truth. Use stable namespaced URL state for nested Reporting/Financial tabs and preserve refresh/back/forward/deep-link behavior with server reauthorization. Exports/copy retain truth metadata.
>
> **11. Exact-SHA certification.** GitHub CI already provisions disposable PostgreSQL and Redis. Completion requires non-empty focused tests, migration bootstrap twice, all deterministic-static/integration/server-required capabilities, provider-denied HTTP role/IDOR/CSRF proof, scale/race/restart tests, full synthetic Lead-to-Merchant reconciliation, typecheck, build, migration integrity, manifest, route/API/privacy scans, and diff check on the exact reviewed SHA. Local missing TEST_DATABASE_URL is not a merge waiver. A failing required capability means DO NOT MERGE.
>
> **12. Boundaries and final proof.** Treat external task numbers as coordination notes only after exact commit/status recapture; they never waive CR-05-owned failures. Do not backfill, clean, classify, merge, archive, assign, or rewrite production history. Do not use db push or edit migrations. Expand final VFC until every mounted consumer, producer, Done row, and kill line has file:line plus named test evidence. Final architectural review prose does not replace an unrun gate.
>
> **Required final status:** `SAFE TO MERGE` only if every CR-05-owned exact-SHA gate passes and all kill lines are cleared. Otherwise return `DO NOT MERGE`. Do not use `SAFE TO MERGE — RUNTIME VERIFICATION PENDING` for disposable tests that repository CI can execute.

## 35. Final response format required from Replit

Return:

- **VERDICT:** COMPLETE / VERIFIED, PARTIALLY COMPLETE, or DO NOT MERGE.
- **Repository State:** starting/ending SHA, branch, clean/dirty state, merge-base, migration head, manifest count.
- **Prerequisite State:** exact CR-04 commit/equivalence proof.
- **Verified Root Cause and Corrections.**
- **Canonical Object, Metric, Task, Inbox, Statement, Snapshot, and Role Contracts.**
- **Implementation:** exact file and line evidence.
- **Consumer/Endpoint and Producer Disposition Matrices.**
- **Before/After Reconciliation:** aggregate counts and reason buckets only, no PII.
- **Tests/Gates:** exact command, exit code, duration, and result.
- **Post-Build Search and Kill-Line Verification.**
- **Runtime/Operations:** isolated proof separated from production truth.
- **Remaining Risks:** only genuinely external or successor-owned risks, never task-owned omissions.
- **Final Status:** SAFE TO MERGE or DO NOT MERGE.
- **Branch/PR URL:** never merge or deploy without explicit authorization.

## 36. Final audit conclusion

Task #1721 is not a failed plan and does not need another wholesale rewrite. Its foundation is sound. The issue is that several phrases—“Reporting Hub,” “task authority,” “Inbox continuation,” “statement hardening,” and “one snapshot”—are broader or more ambiguous than the live code permits.

Appending Section 34 converts those ambiguities into one executable contract. After that addendum, the task is **BUILD-READY**. Until then, the correct status is **DO NOT BUILD FROM THE ATTACHED PLAN ALONE**.

No repository code, production data, provider, GHL, outreach, campaign, sequence, deployment, or runtime configuration was changed by this audit.
