# MASTER REPLIT TASK — CR-05 CRM OPERATOR JOURNEY & RECONCILED REPORTING

**Task type:** mandatory preflight + implementation + isolated verification  
**Planning baseline inspected:** `bd36d65dfa635b0efd20e8c3f702754bdf66f71e`  
**Planning migration head:** `0177_cro03_source_staging_evidence`  
**Planning CI manifest:** 82 classified suites  
**Execution order:** after CR-04 merges or equivalent behavior is proven  
**Preflight verdict at the inspected baseline:** **NOT BUILD-READY UNTIL CR-04; THEN BUILD-READY WITH CONTROLLING CORRECTIONS**

## 1. Controlling instruction

Implement CR-05 as one complete operator/reconciliation task. Start from clean current `main` after CR-04. Recapture all live paths, SHAs, migrations, tests, roles, populations, and overlapping work before editing.

Do not turn task-owned defects into follow-up tickets. Pipeline/reporting parity, task ownership/deduplication, statement-review object scope, truthful partial/error states, navigation continuity, and isolated end-to-end operator proof are acceptance requirements here.

Do not redesign campaigns/sequences/sender readiness (CR-06) or run a controlled pilot (CR-07). Do not mutate production data, providers, GHL, campaigns, or outreach.

## 2. Objective

Give agents, managers, and admins one coherent, authorized, truthful path through:

`qualified lead → next action/reply → statement review → meeting/proposal → application/underwriting → won deal → verified merchant/portfolio`

Every surface must use canonical CRO-01 revenue objects, CRO-02 classification/identity, CRO-03 evidence lineage, and CR-04 channel/cohort decisions where relevant. Lists and totals must agree. Missing values and failed sources must never crash a page or masquerade as zero.

## 3. Immutable safety boundary

This task may change application code, additive schema, and disposable fixtures. It must not:

- classify, delete, archive, merge, assign, or clean production rows;
- execute a production task-cleanup plan;
- change provider activation/budgets or call live providers;
- mutate GHL, send email/SMS/voice, activate a campaign/sequence, or lift pauses;
- fabricate statements, applications, contacts, deals, merchants, provenance, or funnel history;
- replace CRO-01/02/03/04 authorities with UI-derived logic;
- alter campaign content/lifecycle/sender policy owned by CR-06.

## 4. Required baseline recapture

Record before editing:

1. branch, full HEAD, `origin/main`, merge-base, worktree status, recent merges;
2. exact evidence that CR-04 is merged/equivalent and its final VFC passed;
3. migration journal head and integrity result;
4. CI manifest count/capabilities and current workflow services;
5. current routes/components for Pipeline, Reporting, Tasks, Inbox, Contacts/Leads, Portfolio, Statement Reviews, Applications, Underwriting, Onboarding, and Rep/Manager dashboards;
6. every automatic task producer and writer;
7. current canonical read/writer/authorization services and direct SQL exceptions;
8. current source status/error envelopes and client handling;
9. overlapping unmerged work.

Stop if CR-04 is missing or if its Ready/cohort contracts have competing definitions.

## 5. Prerequisites and preserved authorities

Preserve:

- CRO-01 People/Prospect Staging/Lead/Deal/Merchant definitions and `revenue-read-authority.ts`;
- CRO-02 production/test/unknown/quarantine, identity, business-link, and provenance decisions;
- CRO-03 provider/source evidence and canonical projection lineage;
- CR-04 channel decisions/cohort/explain/enrollment fence;
- `DealStageService`, canonical contact/deal writers, merchant MID evidence, and current role/object helpers;
- Inbox partial-source truth, contact/deal/live-chat authorization, and outbound pause protections already present.

CR-05 adds operator/read-model/task coherence; it does not create new CRM object definitions.

## 6. Verified current-state findings

| ID | Finding at `bd36d65…` | Evidence | Required disposition |
|---|---|---|---|
| VFC-P01 | Pipeline server totals use the CRO-01 authority. | `server/routes/deals.ts`; `server/services/revenue-read-authority.ts` | Preserve. |
| VFC-P02 | Pipeline board fetches up to 2,000 deals and conditionally derives revenue/aging widgets from the loaded array. | `client/src/pages/dashboard/Pipeline.tsx:1544-1563,2593-2669` | Move task-owned aggregates to server authority or paginate completely. |
| VFC-P03 | `/api/analytics/pipeline` uses the shared revenue authority. | `server/routes/analytics.ts:399-405` | Preserve and align all other reporting consumers. |
| VFC-P04 | Reporting has loading states but uses zero fallbacks without a complete source/error envelope. | `client/src/pages/dashboard/Reporting.tsx` | Add explicit ok/partial/unavailable/error semantics. |
| VFC-P05 | Support analytics loads only 500 tickets and calculates “totals” in memory. | `server/routes/analytics.ts:408-440` | Replace with scoped server aggregates. |
| VFC-P06 | Task analytics and list/counts use broad `storage.getTasks()` populations. | `server/routes/analytics.ts:442-465`; `server/routes/tickets-tasks.ts:127-190` | One scoped task read authority. |
| VFC-P07 | Task read/create/update routes use dashboard auth but do not consistently authorize the related contact/deal/ticket or assignment. | `server/routes/tickets-tasks.ts:140-190` | Enforce direct and indirect object scope. |
| VFC-P08 | Operations reporting uses raw contacts/lifecycle labels, global overdue tasks, and sequence `converted` as a reply proxy. | `server/routes/acquisition.ts:979-1192` | Rebuild on canonical populations/outcomes. |
| VFC-P09 | Statement-review list/detail enrich related objects with broad reads and swallowed failures. | `server/routes/statement-review.ts:78-190` | Authorize parent objects and return truthful partial states. |
| VFC-P10 | Inbox now exposes partial/degraded source status and ownership controls. | `server/routes/inbox.ts`; `client/src/pages/dashboard/CommsHub.tsx:688-881` | Preserve and extend parity/badge reconciliation. |
| VFC-P11 | Portfolio uses activated-MID membership and server aggregates. | `server/routes/portfolio.ts` | Preserve verified merchant truth and scope. |
| VFC-P12 | Existing operator tests cover important ownership paths but not the complete lead-to-merchant journey or all reporting parity. | `scripts/test-crm-operator-experience.ts` | Extend with isolated full-chain proof. |
| VFC-P13 | Automatic task producers and status/source vocabularies remain distributed. | task writer/call-site census | Add canonical producer identity, eligibility, and active uniqueness. |
| VFC-P14 | Production counts/crash reports are not current proof. | runtime boundary | Use synthetic fixtures and safe aggregate runtime verification later. |

## 7. Mandatory preflight searches

Inventory and classify:

- every `/api/deals`, `/api/analytics/*`, `/api/reporting/*`, Pipeline/Reporting/Overview/Executive consumer;
- every fixed `limit`, `.length` total, array `reduce` aggregate, zero fallback, swallowed catch, and `return []`/`return null` on failed fetch;
- every task insert/create/upsert/update/delete producer and `source`/`automationKey` convention;
- every task status, completion, soft-delete, duplicate-active constraint, contact/deal/ticket link, and owner field;
- Inbox list/count/unread/thread/classify/action/reply and all source-status projections;
- statement-review list/detail/update/create and linked document/contact/deal reads;
- applications, underwriting, onboarding, statements, proposals, meetings, and merchant/portfolio transitions;
- all route/UI redirects, tabs, deep links, detail IDs, query parameters, badges, breadcrumbs, loading/error/empty/forbidden states;
- every client label formatter that can receive null/unknown enum values;
- role guards and indirect-object authorization for every route in scope.

Deliver a live consumer/producer matrix before the build.

## 8. Verified root causes

1. Canonical revenue definitions were centralized in CRO-01, but several secondary reports and UI aggregates still use legacy populations or loaded arrays.
2. Tasks evolved as a shared table with many producers but without one read/write eligibility and active-issue identity contract.
3. Operator pages handle failures independently; some distinguish degraded sources, while others render zero or generic empty states.
4. Parent-object authorization is strong in several CRM routes but inconsistent in tasks and statement review.
5. Navigation and detail state span many older pages, making end-to-end continuity accidental rather than certified.

## 9. Canonical operator object contract

Use these definitions everywhere:

| Object | Definition |
|---|---|
| Person | canonical non-archived contact within actor scope; may be production/test/unknown, visibly classified |
| Prospect Staging | staging prospect, not a contact or Lead |
| Lead | distinct canonical contact with a qualifying open local sales deal under CRO-01 |
| Deal | canonical local sales deal; stage changes only through `DealStageService` |
| Statement Review | authorized statement/document review linked to canonical contact/deal where present |
| Application/Underwriting | existing canonical application/deal transition authorities |
| Merchant | distinct canonical contact with active MID and non-null activation evidence |
| Task | durable authorized work item with stable source + producer/entity identity, current eligibility, ownership, and completion history |
| Inbox item | source-scoped inbound item with truthful source status and authorized related object |

Do not redefine Lead from score/lifecycle, Merchant from a generic deal/profile, or funnel outcomes from labels alone.

## 10. Shared read-model and reporting contract

Extend the current revenue read authority or a focused adapter so Pipeline, Reporting, operations reporting, relevant dashboards, and exports share:

- identical production/archive/classification and role scope;
- distinct-contact/deal cardinality rules;
- canonical sales stage population;
- activated-MID merchant predicate;
- exact server totals independent of page size;
- monetary/volume aggregates computed over the authoritative population;
- documented filters, `asOf`, scope, and source status;
- stable mismatch/reconciliation buckets without PII.

Support and task analytics need their own scoped server aggregates, not 500-row/in-memory pseudo-totals.

## 11. Truthful source envelope

Every multi-source dashboard/report response must distinguish:

- `ok`: authoritative data loaded;
- `partial`: some named sources unavailable/truncated, with known results retained;
- `unavailable`: source failed and data is `null`;
- `schema_missing`: optional not-yet-deployed source is absent;
- `forbidden`: actor lacks scope;
- `error`: stable internal failure envelope.

`unavailable`, `partial`, and `schema_missing` must never become `0`, empty array, or “No activity.” Include stable `errorCode`, `capturedAt`/`asOf`, result scope, truncation metadata, and privacy-safe correlation ID.

## 12. Pipeline contract

- Board/list/detail use canonical sales deals and the same actor scope.
- Totals, stage counts, volume/value, wins, aging, no-follow-up, and forecast widgets are server-derived or proven complete across pagination.
- Deep links use one documented parameter and survive refresh/back/forward.
- Null/unknown stage, label, channel, source, owner, volume, date, proposal, MID, or contact values render readable fallbacks.
- API 400/401/403-or-404/409/500/network/invalid-envelope failures produce a stable error panel with status/code/correlation and functional retry.
- Subresource failures do not silently become authoritative zero when the distinction matters.
- Stage mutation, archival, assignment, proposal, and follow-up actions preserve existing writer/authorization owners.

## 13. Reporting contract

Align these views through canonical adapters:

- pipeline distribution, active/won/lost, conversion, aging, and volume/value;
- support totals and SLA breaches;
- task active/completed/overdue/source/owner totals;
- Lead → reply/meeting → statement → proposal → application → won → activated MID funnel;
- ICP/source/campaign/rep breakdowns only when attributable durable events exist;
- incident/queue/GHL facts with truthful unavailable state;
- sequence/campaign outcomes from durable communication/receipt events, not `converted` as an undocumented reply proxy.

Do not infer ad-spend economics from proportional allocation unless the UI explicitly labels it as an estimate and stores the entered assumptions separately from authoritative outcomes.

## 14. Canonical task authority

Inventory every automatic producer. Add or extend one service that owns:

- strict creation/update schemas;
- `producer`, `issueKey`, related entity type/ID/generation, purpose, source, owner, requested action, and due policy;
- canonical eligibility checks for missing/archived/closed/test/quarantined/unauthorized subjects;
- one active work item per stable producer + issue + entity + generation, enforced atomically;
- idempotent replay/concurrency behavior;
- source-visible contextual titles that use merchant/contact context, never only internal IDs;
- status normalization for active, completed, cancelled/soft-archived history;
- object authorization for list/count/detail/create/update/bulk operations;
- audit history and reason codes.

Manual tasks remain possible but cannot spoof protected automation fields. Completed legitimate history is never hard-deleted.

## 15. Task cleanup boundary

Build a counts-only, aggregate dry-run reconciliation for:

- duplicate active automated issues;
- missing/archived/closed/test/quarantined related objects;
- orphaned relations;
- unknown producers/statuses;
- legitimate active/manual/completed history.

It may generate an approval artifact or local command plan. It must not execute cleanup against production in this task. Any later approved cleanup must soft-archive only invalid/duplicate pending automation, be idempotent, preserve audit/completed/manual history, and be separately authorized.

## 16. Inbox and communications contract

Preserve the existing partial/degraded source model and strengthen:

- list, unread badge, filters, next cursor, known total, and source-status parity;
- authorized contact/thread/live-chat linking and substituted-ID denial;
- reply/action pause, contactability, consent/suppression, and object guards;
- same-business-day task/escalation creation through the canonical task authority;
- error/empty/degraded distinction;
- no message bodies, email, phone, provider payloads, or customer content in logs/aggregate evidence.

Do not enable outbound replies during isolated tests; use denied transports and verify local intent/audit behavior only.

## 17. Statement, application, underwriting, onboarding, and portfolio contract

- Statement lists/details authorize linked contact/deal/document before enrichment and return privacy-safe 404 when denied.
- A related-source failure is explicit partial/unavailable, not swallowed into blank names.
- Statement totals and deal-with-statement reconciliation use canonical IDs.
- Proposal/application/underwriting/onboarding transitions retain their current writers and stage services.
- Portfolio remains activated-MID-only with server totals and actor scope.
- Links among statement, contact, deal, application, proposal, tasks, and merchant survive refresh and unauthorized substitutions.
- No task creates fake statements, deals, or merchants to fill a UI gap.

## 18. UI and navigation contract

Certify desktop and mobile layouts for supported roles at 375, 390, 430, 768, 1024, 1280, and 1440 CSS pixels using the current repository approach. Do not hide layout defects with broad `overflow-hidden`.

Required states:

- loading, empty, partial, unavailable, error, forbidden, stale, and retry;
- breadcrumb and authorized related-record navigation;
- URL-backed tabs/filters/sort/pagination/details;
- deep link, refresh, back/forward, and role change;
- readable null/unknown labels;
- keyboard focus and accessible action labels;
- no unauthorized data flash before redirect/error.

Keep the current consolidated Contacts & Leads, Tasks & Appointments, Reporting Hub, Outbound Center, and redirects unless live preflight proves a task-owned contradiction.

## 19. Authorization and role matrix

Test anonymous, merchant, Agent A, Agent B, manager, and admin across:

- Pipeline list/count/detail/subresources/mutations;
- tasks list/count/detail/create/update/bulk operations and related objects;
- Inbox list/thread/action/link/reply intent;
- statement review list/detail/update;
- Leads, applications, proposals, onboarding, and Portfolio;
- Reporting and aggregate/reconciliation endpoints.

An agent must never infer another agent’s data through count differences, assignee lists, overdue totals, report buckets, task IDs, statement IDs, or indirect relations. Every mutation requires CSRF and a strict allowlist.

## 20. Concurrency and recovery

Prove:

- concurrent automatic task producers create one active issue;
- completion followed by a genuinely new entity generation may create one new task;
- replay, worker restart, and partial failure do not duplicate tasks or transitions;
- bulk task operations authorize every item atomically or return an explicit per-item safe disposition—never silently mutate unauthorized rows;
- report snapshots use a consistent `asOf` or explicitly disclose non-atomic source times;
- navigation/cache invalidation cannot show stale unauthorized data after scope change;
- statement/application/deal transition retries reuse canonical records.

## 21. Scope and file-ownership fence

Expected task-owned areas:

- `revenue-read-authority.ts` and focused reporting adapters;
- Pipeline, Reporting, Operations Report, Tasks, Inbox, Statement Review, Portfolio compatibility surfaces;
- task storage/service/routes and additive constraints;
- operator navigation/components only where required;
- isolated tests and CI registration.

Do not modify CR-06 campaign lifecycle/rendering/content/sender-policy owners except for narrow read-only adapters. Do not implement CR-07 activation/pilot behavior.

## 22. Priority register

### P0 — must close

1. CR-04 prerequisite proof.
2. Pipeline list/aggregate truth independent of 2,000-row cap.
3. Reporting/operations population alignment and truthful source envelopes.
4. Scoped task read/write authority and related-object authorization.
5. Atomic automatic-task identity/deduplication/eligibility.
6. Statement-review indirect-object authorization and non-swallowed partial states.
7. Role/aggregate/IDOR/CSRF matrix.
8. Full isolated lead-to-merchant operator chain.
9. No production cleanup or external mutation.

### P1 — required for complete acceptance

1. Inbox/badge/source reconciliation.
2. Task contextual titles/actions/source labels and completed history.
3. Dry-run cleanup buckets.
4. Null-safe/error/retry/deep-link UI across core screens.
5. Support/task server aggregates.
6. Portfolio/statement/application/onboarding compatibility proof.

### P2 — bounded hardening

1. Query-plan/index improvements justified by measured isolated fixtures.
2. Responsive/accessibility polish.
3. Aggregate export metadata and operator help text.

## 23. Preflight verdict

At the planning baseline, CR-05 is **NOT BUILD-READY UNTIL CR-04 MERGES**. After CR-04 is proven on current `main`, the task is **BUILD-READY WITH CONTROLLING CORRECTIONS**. Do not start from an older branch or treat CR-04 as an optional integration.

## 24. Corrected build plan

1. Recapture current post-CR-04 main, authorities, routes, consumers, producers, and failures.
2. Freeze canonical object/report/task/source-status contracts.
3. Build shared scoped aggregates and reconciliation adapters.
4. Correct Pipeline and Reporting consumers and failure envelopes.
5. Implement canonical task authority, constraints, and producer cutovers.
6. Harden task/statement/inbox indirect-object authorization.
7. Align Portfolio, statements, applications, underwriting, and onboarding adapters.
8. Build the coherent URL-backed operator UI states and navigation.
9. Add counts-only cleanup/reconciliation preview.
10. Add isolated DB/Redis, HTTP role, concurrency, source-failure, and jsdom tests.
11. Run full gates/searches/diff review and return final VFC.

## 25. Done looks like

- Pipeline and every Reporting view use canonical, scoped, server-derived populations.
- No page-size cap or loaded array masquerades as a total or aggregate.
- Unavailable/partial/schema-missing sources never render as zero or confirmed empty.
- Automatic tasks are eligible, contextual, unique per active issue, source-labeled, navigable, and history-preserving.
- Agents cannot read or mutate another agent’s task, statement, conversation, deal, contact, or aggregates.
- Inbox list/badge/thread/source states reconcile.
- Statement → deal → proposal/application → won → activated MID links are canonical.
- Portfolio remains verified merchants only.
- Core screens survive missing/unknown fields and safe API failures with retry.
- One isolated role-aware operator journey passes from qualified Lead to Merchant.
- No production cleanup, provider, GHL, campaign, sequence, or outreach mutation occurs.

## 26. Kill lines

Return `DO NOT MERGE` if:

- CR-04 is absent or competing Ready definitions remain;
- any global total/aggregate derives from a cap or client array;
- Pipeline and Reporting use different sales populations;
- unavailable/partial data becomes zero/empty;
- task routes or statement reviews allow cross-agent/indirect-object access;
- duplicate active automatic tasks remain possible;
- cleanup hard-deletes or mutates production data;
- Lead/Merchant/funnel definitions regress to score/lifecycle/generic-deal shortcuts;
- a second contact/deal/stage/merchant writer is introduced;
- provider/GHL/send/campaign/sequence/deployment/outreach mutation occurs;
- migration history is edited, `db push` is used, or an unapproved backfill is required;
- any task-owned gate is skipped for lack of disposable infrastructure.

## 27. Implementation rules

- Reuse current role/object helpers and privacy-safe not-found convention.
- Use parameterized SQL and shared scoped predicates.
- Counts carry filters, scope, source status, and `asOf`.
- API errors omit SQL, table, constraint, provider, PII, and message content.
- Add migration only at the live head and only for additive constraints/read models required by this task.
- Preserve stage mutation in `DealStageService` and canonical writers.
- Preserve CRO-02/03/04 dependency fingerprints and evidence lineage.
- Keep UI state in URLs where it affects navigation/review.

## 28. Test requirements

Use non-empty disposable fixtures covering:

- totals beyond page size and monetary/volume aggregates;
- archived/test/unknown/quarantined/production populations and reason buckets;
- multi-deal contacts and canonical primary/tie-break behavior;
- Pipeline/Reporting/operations reconciliation at one `asOf`;
- source ok/partial/unavailable/schema-missing/error/forbidden envelopes;
- null/unknown stage/source/channel/owner/date/value/subresource;
- every task producer, replay, concurrency, entity-generation change, completed history, invalid related object, manual task, bulk operation;
- statement linked/unlinked contact/deal/document and partial-source failures;
- Inbox partial sources, unread/count parity, link/thread/action/reply intent;
- application/underwriting/onboarding/merchant transition compatibility;
- anonymous, merchant, Agent A, Agent B, manager, admin, CSRF, substituted IDs;
- deep-link, refresh, back/forward, pagination, tabs, responsive widths, loading/empty/error/retry.

Tests fail if fixtures are empty/skipped or production/shared infrastructure is detected.

## 29. Smoke and integration plan

On disposable PostgreSQL and isolated Redis, with every external transport denied, prove:

`resolved production contact → qualifying sales deal/Lead → authorized task/reply intent → statement review → proposal/application transition → Closed Won → active MID/Merchant → Portfolio and Reporting reconciliation`

Use synthetic IDs/content. Do not send or mutate GHL. Use current `tsx`/jsdom/HTTP patterns and the repository CI services.

## 30. Required gates

Report command, exit code, and result for:

- focused CR-05 static/operator UI suites;
- disposable DB/Redis reporting/task/operator integration;
- provider-denied HTTP role/CSRF suite;
- source-failure envelope and jsdom navigation suite;
- `npx tsx scripts/ci-suite-manifest.ts --check`;
- deterministic-static, deterministic-integration, and provider-denied server-required capabilities;
- route-guard, API coverage, CRM operator, revenue-contract, classification/CRO-03/CR-04 authority, task-invariant, portfolio, and statement suites;
- migration bootstrap/rerun and integrity;
- `npm run check`, `npm run build`, `git diff --check`.

Current CI provisions PostgreSQL 16 and Redis 7. Missing local `TEST_DATABASE_URL` is not a valid COMPLETE disposition; use CI or provision a disposable local equivalent.

## 31. Post-build search verification

Prove:

- no changed global metric uses `.length`, a fixed limit, or a fetched window as total;
- all sales reports use the shared CRO-01 population;
- no unavailable source defaults to zero/empty;
- all automatic task producers call the shared authority;
- no task or statement route performs unscoped parent-object reads/mutations;
- no new direct stage/contact/deal/merchant writer exists;
- no campaign lifecycle/content/sender work or CR-07 activation leaked in;
- no production cleanup, provider, GHL, send, unpause, deployment, or outreach code was added.

## 32. Diff review

Run status, stat, and full diff. Confirm only task-owned files changed; migration/schema/tests agree; no secrets, PII, dumps, provider payloads, generated artifacts, attached text, lockfile drift, debug output, or unrelated formatting entered the diff; and all tests are correctly classified.

## 33. Final VFC table

| ID | Requirement | Evidence | Test/gate | Status |
|---|---|---|---|---|
| VFC-F01 | Canonical object definitions preserved | authority map | contract tests | PASS/FAIL |
| VFC-F02 | Pipeline/Reporting population and totals agree | query service | reconciliation | PASS/FAIL |
| VFC-F03 | No capped/client-derived aggregates | searches/queries | multi-page | PASS/FAIL |
| VFC-F04 | Truthful source envelopes | API/UI | failure matrix | PASS/FAIL |
| VFC-F05 | Canonical task authority and uniqueness | schema/service | replay/concurrency | PASS/FAIL |
| VFC-F06 | Task/statement/inbox object scope | routes | role/CSRF/IDOR | PASS/FAIL |
| VFC-F07 | Statement-to-Merchant lineage | adapters | full-chain integration | PASS/FAIL |
| VFC-F08 | Null-safe, navigable operator UI | components | jsdom/responsive | PASS/FAIL |
| VFC-F09 | Dry-run-only cleanup | report/diff | mutation denial | PASS/FAIL |
| VFC-F10 | No external/production mutation | diff/search/log | denial gates | PASS/FAIL |

## 34. Final response format

Return:

- **VERDICT:** COMPLETE / VERIFIED, PARTIALLY COMPLETE, or DO NOT MERGE;
- starting/ending SHA, branch, worktree, migration head, manifest count;
- exact CR-04 prerequisite proof;
- verified root causes/preflight corrections;
- canonical object, report, task, and source-status contracts;
- file/line implementation evidence;
- isolated before/after reconciliation and task reason buckets only;
- every test/gate command, exit code, result;
- post-build/kill-line verification;
- isolated proof versus production/runtime truth;
- remaining CR-06/CR-07/external operational risks only;
- **FINAL STATUS:** SAFE TO MERGE, SAFE TO MERGE — RUNTIME VERIFICATION PENDING, or DO NOT MERGE;
- branch/PR URL without merge/deploy unless explicitly authorized.

## 35. Liberty safety and practical merge standard

Block for realistic risk of false metrics, cross-agent exposure, duplicate/ineligible tasks, swallowed outages, broken statement/deal lineage, merchant contamination, competing writers, destructive cleanup, or external execution. Do not block a correct isolated operator/read-model fix merely because CR-06 sender/campaign certification or CR-07 pilot execution remains pending.

## 36. Relevant live files

- `client/src/pages/dashboard/Pipeline.tsx`
- `client/src/pages/dashboard/ReportingHub.tsx`
- `client/src/pages/dashboard/Reporting.tsx`
- `client/src/pages/dashboard/OperationsReport.tsx`
- `client/src/pages/dashboard/Tasks.tsx`
- `client/src/pages/dashboard/TasksAppointments.tsx`
- `client/src/pages/dashboard/CommsHub.tsx`
- `client/src/pages/dashboard/StatementReview.tsx`
- `client/src/pages/dashboard/MerchantPortfolio.tsx`
- `client/src/pages/dashboard/ContactsAndLeads.tsx`
- `client/src/pages/DashboardLayout.tsx`
- `client/src/App.tsx`
- `server/services/revenue-read-authority.ts`
- `server/services/crm-object-access.ts`
- `server/routes/deals.ts`
- `server/routes/analytics.ts`
- `server/routes/acquisition.ts`
- `server/routes/tickets-tasks.ts`
- `server/routes/crm-operations.ts`
- `server/routes/inbox.ts`
- `server/routes/inbox-ownership.ts`
- `server/routes/statement-review.ts`
- `server/routes/portfolio.ts`
- `server/services/deal-stage-service.ts`
- `server/storage/tasks.ts`
- `shared/schema.ts`
- `scripts/test-crm-operator-experience.ts`
- `scripts/test-cro01-revenue-contract-static.ts`
- `scripts/test-cro01-revenue-contract-integration.ts`
- `scripts/test-task-invariants.ts`
- `scripts/smoke-portfolio.ts`
- `scripts/ci-suite-manifest.ts`
- `.github/workflows/ci.yml`
- `migrations/meta/_journal.json`

