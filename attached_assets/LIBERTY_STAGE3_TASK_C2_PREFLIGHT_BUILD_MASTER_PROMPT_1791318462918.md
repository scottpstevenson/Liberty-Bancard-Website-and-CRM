# LIBERTY BANCARD — STAGE 3 TASK C2
# MASTER REPLIT PREFLIGHT + BUILD PROMPT

## Task C2 — Today, Records, Pipeline, Inbox and Work

Apply C1 to the five daily sales destinations and the complete five-area Contact record experience. Wire actual A read/metric/permission contracts and B durable actions. Deliver rep workflow continuity from Today → contact/deal → task/note/draft → refresh/readback, including agent-specific wrappers and dedicated mobile counterparts.

### A. Verified from current code — seeded preflight table

| ID / original scope | Exact current source anchor | Verdict / evidence | Repair / acceptance |
| --- | --- | --- | --- |
| C2-V01 / CRM3-21, CRM3-26 | `client/src/pages/dashboard/ContactDetail.tsx:1263` | SOURCE:25 literal tabs; active tab initialized overview in local state; primary actions select local tabs. | Five areas + URL-bound25 translations + Activity/History drawer, correct record context. |
| C2-V02 / Records access | `client/src/pages/dashboard/ContactsAndLeads.tsx:28` | VERIFIED EXISTING: People/Leads consolidation and staging redirect; compatible access still role-sensitive. | Preserve staging handoff and agent scoped /contacts,/my-leads wrappers; contextual Company detail remains separate ID namespace. |
| C2-V03 / Inbox | `client/src/pages/dashboard/CommsHub.tsx:32` | VERIFIED SOURCE:6 channel selectors including All;3 smart filters; item/thread composition. | One inbox/list/thread; preserve source completeness/cursor and B drafts/read/assignment; Send visibly paused. |
| C2-V04 / Work | `client/src/pages/dashboard/TasksAppointments.tsx:20` | VERIFIED SOURCE:Tasks/Calendar selectors; handler replaces query and local state. | Tasks/Appointments primary labels, existing calendar URL; shared URL builder restores filter/back context. |
| C2-V05 / Today metrics | `client/src/pages/dashboard/Overview.tsx:49` | VERIFIED SOURCE:Home consumes briefing and multiple KPI APIs; factual parity must consume A/B contracts. | Actionable <=5 summary metrics, shared same-scope drilldowns; degraded briefing factual unknown, no reassurance from missing data. |
| C2-V06 / agent work | `client/src/pages/dashboard/SalesRepHome.tsx:447` | VERIFIED SOURCE:agent MyDay owner; independent actual read/actions. | Preserve role-specific semantics and empty/assignment/next-task workflow; no privileged hub redirect. |
| C2-V07 / Pipeline | `client/src/pages/dashboard/Pipeline.tsx:1547` | VERIFIED SOURCE:Pipeline reads sales deals and summary; board mutations exist. | Board/List shared scoped data; actual stage move with error rollback/readback and keyboard equivalent. |
| C2-V08 / B dependency | `client/src/pages/dashboard/Tasks.tsx:203` | VERIFIED SOURCE:task list/create/bulk actions exist; exact supported behavior needs actual fixture proof. | Use existing task authority/actions; no duplicated task predicate; select/assign/complete/archive/retry tests. |

### B. Relevant files and blast radius

Inspect current existing files: `client/src/pages/dashboard/Overview.tsx`; `client/src/pages/dashboard/SalesRepHome.tsx`; `client/src/pages/dashboard/ContactsAndLeads.tsx`; `client/src/pages/dashboard/Contacts.tsx`; `client/src/pages/dashboard/Leads.tsx`; `client/src/pages/dashboard/ContactDetail.tsx`; `client/src/pages/dashboard/CompanyDetail.tsx`; `client/src/pages/dashboard/contact-detail-tabs/RelationshipsTab.tsx`; `client/src/pages/dashboard/contact-detail-tabs/TasksTab.tsx`; `client/src/pages/dashboard/Pipeline.tsx`; `client/src/pages/dashboard/CommsHub.tsx`; `client/src/pages/dashboard/TasksAppointments.tsx`; `client/src/pages/dashboard/Tasks.tsx`; `client/src/pages/dashboard/Calendar.tsx`; `client/src/pages/dashboard/Notifications.tsx`; `server/routes/tickets-tasks.ts`; `server/routes/crm-operations.ts`; `server/routes/inbox.ts`; `server/routes/inbox-ownership.ts`; `server/services/task-authority.ts`; `server/services/revenue-read-authority.ts`; `server/services/crm-object-access.ts`; `server/services/inbox-item-resolution.ts`; `client/src/pages/mobile/MobileContacts.tsx`; `client/src/pages/mobile/MobileContactDetail.tsx`; `client/src/pages/mobile/MobilePipeline.tsx`; `client/src/pages/mobile/MobileInbox.tsx`; `client/src/pages/mobile/MobileTasks.tsx`; `client/src/pages/mobile/MobileHome.tsx`.

Proposed shared destinations: `client/src/lib/crm-destinations.ts`, `client/src/lib/crm-navigation-state.ts`, `client/src/components/crm/*`, `client/src/styles/crm-theme.css`, and task evidence under `docs/certification/stage3-c2/`. These are suggested new files, not existing code. Update already shipped C1 owners instead of creating duplicates. Verify each imported child/action/suite in the actual current repo. Narrow changes to the owned UI/adapter/diagnostic scope; preserve A/B contracts and concurrent changes.

### C. Implementation sequence

1. Verify A/B shared contracts and exact registered handlers at current HEAD; list dependencies by symbol and actual fixture. Preserve newer Task2061 work and current contact creation/sequence runtime changes. Repair C2 consumer mismatch locally; any missing A/B durable authority gets exact bounded handoff rather than an alternate backend implementation.
2. Apply PageHeader/MetricStrip/Toolbar/Worklist to Today, Records, Pipeline, Inbox, Work. Today order due/overdue/SLA/priority based on authoritative fields; allowed Mine/Team/Unassigned presets; one primary next action, task/record deep links, quick note/task/log-call. Do not display every admin metric on a rep homepage. AI contextual drawer uses B factual state and only user action for paid generation.
3. Records: People/Leads primary selectors; desktop fields identity, company relation, owner, lifecycle/stage, next task/last touch, contactability status; page50 default with same-scope totals. Preserve canonical/test/demo/unknown filters and archive views when authorized. Contextual Company link only for actual Company ID; business link only for verified/current source association, with separate namespace. B create/edit/assign/archive/restore usable; no name-based join or UI hidden hard-delete shortcut.
4. Implement exactly five Contact areas and legacy25 mapping below. C2 owns outer RecordHeader, area/section URL and drawer. Identity/owner/lifecycle/consent/next action above fold, no22/25 primary-tab wrap. Header primary action when permitted; Add Note, New Task and Log Call in <=2 secondary plus overflow. Selected note/task jumps to correct section/form with correct contact ID. Link company/business/deal/document/task/application by actual authorized IDs.
5. Conversation timeline consolidates messages/calls/notes/comments visually with filter chips; distinguish delivery log and immutable audit History rather than delete a source stream. Reuse B write handlers and retrieval scope, author/time/context. Inactive area queries disabled/unmounted; eager contact header only, no full2500-line side panel forest loaded to get counters.
6. Pipeline: Board and List are view-mode choices not extra sidebar routes. Shared same-scope server rows/metrics; stage counts independent of pagination. Stage move by pointer + keyboard/Move action, preview invalid transition, pending/rollback/stale conflict, durable readback after reload. Existing stage rules config stays privileged and contextual. Never force pipeline to all-class census totals.
7. Inbox: 320px thread list +minmax(0,1fr) conversation at wide desktop, stacked/mobile list→detail with Back preserving filter/scroll; below1024 use existing width-appropriate stacked mode if columns cannot fit. Source identity/contact link/owner/channel/time/unread clear; pagination/partial-source marker truthful. B assign/read/draft/retry controls wired; Send disabled with exact paused reason independent of incoming GHL. No reply provider call during audit.
8. Work: Tasks/Appointments selectors; tasks columns title+record, owner, due/timezone, priority, status, actions; saved presets Due/Overdue/Mine/Team as supported authority. Create/edit/complete/cancel/assign/archive/restore through B actual endpoints. Appointment form validation/timezone/conflict, no automatic invites. Calendar controls actual previous/next/today and event→record links work. Notifications remain header action/standalone fallback, entity resolution from B preserves deleted/no-access distinction.
9. Mobile/dedicated/mobile pages keep existing route and safe-area contracts; reuse shared tokens/data/action semantics without replacing role guard or doubling dock offsets. Verify actions do not sit behind keyboard/dock; sticky footer remains reachable, no duplicate headers. Company detail uses same RecordHeader and linked readback for B relationship actions.
10. Run every route/tab/action fixture, scope parity across Today/Work/record/Pipeline/notifications, exact C2 acceptance matrix, no-send/no-echo, production-style visual tests and CI. Handoff lifecycle/service interior slots to C4 and full sidebar readiness receipt to C5; update canonical IDs/ledger.

### D. Required C2 rg checks — before and after

```bash
rg -n 'TabsTrigger|activeTab|setActiveTab|contactId|companyId|businessId' client/src/pages/dashboard/ContactDetail.tsx client/src/pages/dashboard/CompanyDetail.tsx
rg -n 'queryKey|isError|refetch|error|limit=|total|assignedToMe|recordClass' client/src/pages/dashboard/Contacts.tsx client/src/pages/dashboard/Tasks.tsx client/src/pages/dashboard/Overview.tsx client/src/pages/dashboard/SalesRepHome.tsx
rg -n 'apiRequest|mutationFn|onSuccess|invalidateQueries|draft|reply|channel|cursor|partial' client/src/pages/dashboard/CommsHub.tsx
rg -n 'pipeline=sales|analytics/pipeline|stage|onDrag|mutation|rollback' client/src/pages/dashboard/Pipeline.tsx
rg -n 'tab|calendar|navigate|replace' client/src/pages/dashboard/TasksAppointments.tsx
rg -n 'TASK_AUTHORITY_STATES|query|deletedAt|due_date|status' server/services/task-authority.ts server/storage/tasks.ts
rg -n 'contactId|entityId|resolve|not.found|deleted' client/src/pages/dashboard/Notifications.tsx server/services/inbox-item-resolution.ts
rg -n 'safe-area|mobile-header-height|mobile-dock-height|onClick|mutation|queryKey' client/src/pages/mobile
git diff --check
```

These grep commands are discovery checks, not functional certification. New component/registry zero matches are expected at initial C1 baseline. Review actual changed symbols and requests.

### E. Task C2 gate matrix

| Gate | Exact pass condition |
| --- | --- |
| Five daily destinations | Each primary/secondary/list/detail view uses C1 and real data/actions; correct role-specific entry. |
| Contact25→5 | Every legacy tab maps correctly on direct URL/click/reload/back; activity/history drawers functional; role-denied section shows explanation without request. |
| Durable workflow | Today→contact/deal→note/task/log→refresh→Work projection, B readback/audit, zero wrong-record changes. |
| Pipeline | Board/List consistent scope/count; stage move keyboard/pointer, invalid/stale rollback and refresh durability. |
| Inbox/Work | Draft/read/assign/task/calendar state durable, cursor/partial-source truth; paused sends zero effects; notifications target correct objects. |
| Data parity | Same-scope task/contact/deal metrics match Home/Work/list/record; altered class/owner/timezone/archive fixture correctly changes all consumers. |
| Visual/mobile | All changed desktop/phone/dedicated mobile states, portals, zoom, keyboard/error/focus and performance; no untouched sibling silently claimed complete. |

### F. Task C2 completion contract

Deliver functioning owned surfaces, actual route/action/role/state receipts and supported build/CI, exact visual/computed-style evidence and rollback. No global/sidebar/native/live closure beyond this task. Include remaining individual A/B/C/D/Stage 4–9 obligations and original IDs; no composite all 95 closure from a screenshot or merge. Final output must distinguish code-complete from unverified live.

### G. Authenticated live reconciliation — October 4, 2026

This authenticated addendum supersedes the expired-login/source-only limitation in the earlier authoring receipt. Reviewed main remains **d99ecff73aff8b1cb92e90132c9cbe6cdecc4077**; serving remains **42309395870515b0a575e85f6c753a65da408c2a**. Source and serving are not equivalent. All 27 normal admin sidebar destinations were opened, with additional direct routes and primary tabs; 151 recorded observations cover 33 distinct URL pathnames. This is one real admin desktop session at 1363×936 in light mode. Every tab selection, skeleton and modal-open result is qualified separately from a durable action.

Evidence: `LIBERTY_STAGE3_C1_C5_LIVE_RECONCILIATION_2026-10-04.md`, `liberty-stage3-live-ui-evidence-2026-10-04.json`, `c-live-source-anchor-receipt.json`, and `liberty-stage3-queue-holds-live.jpg`. CL IDs are receipt rows inside the existing parent/repair register; do not add them to the 95 source claims as new disjoint issues. Existing 14 groups/eight tasks and all original IDs remain. Outbound remains PAUSED; incoming GHL remains ENABLED. No production save/apply/send/enroll/provider execution or settings toggle was submitted in this walkthrough.

- CL10: the live admin record exposes 22 tabs; source contains 25 conditional declarations. Group all into the specified five areas and retain role/record-conditional destinations. Notes URL/reload resets to Overview today: repair stable area/section state and back/forward/reload. Do not delete three conditionals because this record did not expose them.
- CL09: list154,011, Production chip154,012, global email health154,414, Test402. A owns class/actor/filter/archive/as-of authority. C2 consumes that contract and displays scope; it must not relabel all-class total as filtered production or subtract test totals client-side. The one-record chip/list delta remains a snapshot/cache lineage check, not a confirmed loss.
- CL16: empty-note Add Note is correctly disabled; unsaved text enables it. Preserve validation, pending, retry/conflict and drafts. B owns actual notes/task API durability; prove save/readback once on protected disposable fixtures.
- CL17: both Work and contact task forms open/cancel; durable create, assignment, task closure and SLA transitions are still required B/C2 build proofs.
- CL18: preserve Inbox incomplete-source explanations and partial counts. Never convert integration errors or skipped channels to a green empty result.
- All 22 visible contact sections selected at least once; final Chargebacks settled with a no-chargebacks state. This is selection/read evidence, not proof that all section actions work or role/object permissions pass. New layout must still cover mobile/dark/keyboard and actual mutations on fixtures.

## Mode and delivery rules

Use **PREFLIGHT → BUILD → VERIFY → HANDOFF** in one task. Audit actual current HEAD first, then implement the safe owned scope without stopping at a plan. A preflight-only completion is not done. Preserve existing repairs and concurrent work. This document is the complete task prompt; attach the canonical specification/ledger if available, but their absence is not permission to invent source facts. Recover exact claim IDs from the embedded register and current repo. No new navigation mega-task or extra provider governance lane.

## 1. Current baseline and serving-source preflight

Authoring audit: October 4, 2026, repo `scottpstevenson/Liberty-Bancard-Website-and-CRM`, fetched main **d99ecff73aff8b1cb92e90132c9cbe6cdecc4077**. No application changes made by this audit; existing unrelated modified merchant-explainer video preserved. Public serving health: **42309395870515b0a575e85f6c753a65da408c2a**, built `2026-10-03T18:30:59.888Z`, publishBuildId `67e0374c-e93f-45f5-8bb3-20d8d0cb981b`. Both commits are accessible but trees differ: the new Canonical Enrichment page/route/menu, LeadImports changes and dependency changes exist on reviewed main after serving source. Never claim current GitHub main is deployed from health alone. Recheck at execution; this is not a Stage 9 freeze.

Source census: 245 literal App route declarations, **147 /dashboard patterns** (historical 146 plus `/dashboard/canonical-enrichment`). Those are patterns, not sidebar entries or distinct pages. Historical309 observed panel entries remain a reference coverage register, not a fresh count or functional certification. Refresh dynamically rendered tabs, views, row actions, overlays and dedicated `/mobile/*` surfaces during preflight. No supplied Replit completion claim automatically closes a current source defect.

Supported toolchain remains Node 22.22.0/npm 10.9.4. Authoring environment is Node 24.19.0/npm 11.9.0. Source/route/token inventory and authenticated admin desktop read-only walkthrough completed; no supported stock CI, canonical migration, durable browser mutations or full live certification claimed. The earlier expired cloud session was recovered; Section G records current live evidence. Alternate-role/mobile/dark/native-action closure remains assigned build/D evidence, not a login blocker.

## 2. Required verified-from-code table

Recheck the seeded table at actual HEAD. Add original ID/subclaim, repair group, exact symbol/file/line, source evidence, serving-source relationship, expected behavior, fixture/counterexample, repair or no-change rationale, final changed file, code/test/browser outcome and remaining owner. Label source-confirmed, existing repaired, proposed UX improvement, not reproduced and runtime unverified separately. A component rendering or source string match is not action/role/durable verification. Parent findings with several subclaims require separate outcomes.

## 3. Safety preflight and non-negotiable kill lines

K01 — Outbound email/SMS/sequences remain PAUSED, proposal auto-send Hold for Review. Stop real sends, enrollment/activation/resume, dial/AI/provider calls, worker/schedule changes and production native-trigger writes in these UI tasks. Tests use denied/fake transport. Do not introduce a new provider-paid approval or spend-limit gate: the user removed them. Fixture denial is test isolation, not a restored product approval policy.

K02 — Incoming GHL contact sync stays independently ENABLED with existing no-echo behavior. Preserve current incoming parser/checkpoints/fields. Do not disable GHL sync to make outbound paused, confuse optional GHL writes with incoming, or make green Connected imply successful import.

K03 — Any mutation test needs proved disposable PostgreSQL, DATABASE_URL=TEST_DATABASE_URL, NODE_ENV=test, isolated Redis namespace, certification startup guards and denied provider/public transport before database-bound imports. No default Replit DB tests, production copies, shared Redis flush, db:push, startup classification/backfill side effects or live test invitations. Browser mutations run only in that fixture preview. Safe read-only production inspection does not authorize production writes.

K04 — No production purge, mass archive, cascade delete, contact/company/business merge by name, FK removal, erased consent/audit history, restored fake opportunity or uncontrolled customer record creation. Fixture teardown only on proved disposable infrastructure.

K05 — Preserve backend role/actor/entity/tenant/class/archive authority, session/CSRF and merchant/partner boundaries before all reads/counts/caches/mutations/jobs. Moving a menu does not grant permission. Unauthorized hidden panels must not mount or request data. No broader manager/operator access inferred from admin screenshots.

K06 — No dead placeholders, decorative clickable metrics, error→zero/empty masking, duplicate metric SQL/DTO definitions or fake action success. If the backend capability is unavailable, show accurate reason and safe available alternative; mark that action blocked and assign the owning A/B/later-stage gap. Do not certify the workspace fully functional while required action proof is pending.

K07 — No destructive route removal. Preserve bookmarks, notifications, external links, typed entity namespace, compatible filters and scoped wrappers. Disallowed/invalid child tabs show explicit reason plus safe fallback; no misleading silent switch to a different metric/page. Do not force every role to all 11 destinations.

K08 — Stop affected cutover on unsafe side effects, permission leakage, mixed entity IDs, broken deep links, wrong tab, stale mutation/replay, inaccessible keyboard flow or data scope mismatch. Continue independent safe fixes. No waiver of required CI/security tests and no suppression of failures under UI scope.

K09 — C1 establishes registry/primitives, C2–C4 implement workspaces, C5 performs final11-entry cutover only after readiness gates. Stages4–9 retain provider/native, processor, financial ingestion, training and release execution. D verifies final integrated live build. No deployment or final GO verdict is authorized by these authoring/build prompts.

## 4. Required repository and infrastructure searches

Run from repository root; record command/SHA/exit/result. Inspect every relevant match and no-match. rg exit1 is not an automatic pass/failure. Do not print secret values or customer payloads.

```bash
git rev-parse HEAD
git status --short
git log -5 --oneline
rg --files -g AGENTS.md
node --version
npm --version
rg -n 'engines|packageManager|tailwind|test:|check|build' package.json
rg -n 'node-version|npm ci|run-ci-suites|run-guarded-canonical-migration' .github/workflows/ci.yml
rg -n 'RUNNABLE_CAPABILITIES|assertDisposableTestInfrastructure|spawnCertificationTsx' scripts/run-ci-suites.ts
rg -n 'DATABASE_URL|TEST_DATABASE_URL|NODE_ENV|TEST_REDIS_PREFIX' scripts/test-infrastructure-guard.ts scripts/certification-child-process.ts
rg -n 'path=|ProtectedRoute|AgentRoute|Legacy|Redirect' client/src/App.tsx
rg -n 'dailyWorkItems|merchantOpsItems|outboundItems|resourcesItems|DEV_MODE_KEY|roles|href:' client/src/pages/DashboardLayout.tsx
rg -n 'font-|--accent|--brand-red|--sidebar|--shadow|--mobile|marketing-theme' client/src/index.css tailwind.config.ts
rg -n 'tailwindcss|tailwind-legacy|@config' vite.config.ts client/src/index.css
```

## 5. Source-of-truth and overlap contract

| Scope | Single implementation owner | Consumer / remaining boundary |
| --- | --- | --- |
| Read/metric/access authority, incoming GHL | A; preserve newer merged symbols | All C surfaces consume same actor/scope/DTO; report A gap rather than parallel SQL. |
| Durable task/note/draft/assignment/record/user lifecycle actions | B; preserve functioning registered handlers | C owning workspace wires presentation and performs end-to-end acceptance; missing B action stays explicitly owned and must be resolved before dependent workspace closure. |
| Registry, URL adapters, scoped token/component definitions | C1 | C2–C5 register exact owned destinations; update shared registry once. |
| Daily employee sales and entire Contact record outer composition | C2 | C4 owns lifecycle/service internals, C3 enrichment links, C5 privileged links; no duplicate ContactDetail shell. |
| Prospecting + Campaigns UI including new Canonical Enrichment | C3 | Reports/Outreach shares C4 report component/read authority; no duplicated analytics owner. |
| Merchant lifecycle/financial/report UI | C4 | Stage 5/6 actual native processor/MID/residual/commission execution remains separate. |
| Admin diagnostic contract fixes, Resources, final shell cutover | C5 | A/B control authorities preserved; no admin-access enlargement. |
| Final serving build and cross-workspace proof | D | Do not close live/native/historical subclaims from local component tests. |

For each named KPI/list/badge/export document metric ID, numerator/denominator, source, actor/team/tenant, class/archive/delete/status filters, date range and timezone, snapshot/asOf, paging vs total, availability and cache key. A single identical scope must return identical totals across pages. Different populations (Sunbiz source rows, canonical businesses, production contacts, eligible audience, unique contacts, enrollment memberships, historical jobs) get different explicit labels, never forced equal. Query keys include relevant actor/scope/filters; clear protected cached data on account/role changes. Missing data is not0. “All selected” means visible page unless explicitly backed by a server snapshot of filtered IDs.

## 6. Data, schema, authorization and concurrency review

Use existing schema/DTOs/authority. Prefer no schema migration for layout. Persisted saved views only if an existing mechanism can be reused or a narrowly owned additive user-scoped migration is justified; otherwise deliver URL-backed named preset views without promising cross-device persistence. Audit all readers/writers before a DTO change; adapters are versioned/typed, not any-casts.

Real-session role cases: anonymous, admin, manager, owner agent/nonowner agent, permitted unassigned scope, merchant, partner and any affiliate role actually registered. Test direct path, nested URL, forged body/path IDs, list/count leakage, CSRF, ownership changes and zero unwanted effects. Existing manager read subset is not permission for operator monitor/control. Save/assign/archive/restore/draft must handle double click, stale version, concurrent requests, timeout-after-commit and retry through existing B contracts. Permission denial occurs before any queue/provider effect.

## 7. Preflight verdict and build behavior

Produce short internal verdict READY TO BUILD / BUILD WITH SPECIFIC EXTERNAL LIMIT / BLOCKED UNSAFE OPERATION, then build owned safe scope. Confirmed source defects get exact repairs; existing fixes get regression preservation. Historical/partial claims retain evidence requirements; do not recreate already corrected provider-results or sequence-copy defects. Missing external sessions/native receipts do not prevent implementation; they do prevent claims that require those receipts. Deliver functioning surfaces in this task, not cards linking to broken pages.

## 8. Required CI and test gate procedure

Treat current `.github/workflows/ci.yml` and `scripts/ci-suite-manifest.ts` as execution authority; re-read them because tasks ship sequentially. Use Node 22.22.0/npm 10.9.4 and checked-in lockfile:

```bash
npm ci --include=dev --ignore-scripts --no-audit --no-fund
npx tsx scripts/test-dependency-policy-evidence.ts
npx tsx scripts/test-inventory-artifact-dependencies.ts
npx tsx scripts/ci-suite-manifest.ts --check
npm run check
npx tsx scripts/run-ci-suites.ts --capability deterministic-static
npx tsx scripts/run-ci-suites.ts --capability external-security
npx tsx scripts/run-ci-suites.ts --capability writable-build
```

Configure CI's isolated PostgreSQL/Redis and unique TEST_REDIS_PREFIX through `scripts/generate-certification-redis-prefix.ts`; retain startup/provider denial environment before importing services. Follow actual CI env, not credentials in this prompt. Run:

```bash
npx tsx scripts/test-certification-process-env.ts
npx tsx scripts/test-certification-provider-deny.ts
npx tsx scripts/test-certification-server-readiness.ts
npx tsx scripts/test-certification-redis-reservation.ts
npx tsx scripts/run-guarded-canonical-migration.ts
npx tsx scripts/run-guarded-canonical-migration.ts
npx tsx scripts/run-ci-suites.ts --capability deterministic-integration
```

Start only the owned disposable server via `scripts/run-denied-certification-server.ts`, complete readiness/seed guards, run `run-ci-suites.ts --capability server-required`, then stop only your owned process. Do not directly run `test-crm-operator-experience.ts` against default DB: despite its provider-free header it imports DB and creates/updates runtime fixtures. Use the canonical guarded runner. Add necessary route, mounted component, session/action and browser tests to the manifest with real capability metadata. Prefer user-behavior assertions, not snapshots or source assertions mirroring implementation. Render a production build as well as dev to catch missing Tailwind4 classes/portal styles/lazy chunks. No test-policy/baseline bypass to pass unrelated gates; record exact pre-existing versus introduced failure and keep release readiness honest.

## 9. Browser and action gates

Required sizes: desktop1440 and1280, tablet768, phones390 and320; light/dark, keyboard and200% zoom. Use read-only cloud production sessions for serving reconciliation where available; actual mutations in protected disposable preview only. Browser checks must click the actual control and verify request/handler, intended entity and durable readback after refresh. Open modal alone is not Save/Assign/Create pass.

For every owned page, primary tab, secondary view, row/toolbar/overflow action, drawer and alias collect: source ID; URL; role; protected fixture ID/class; prestate; action; expected request/result; registered handler and authorization; loading; cancel/no write; validation/focus; pending; successful durable readback; retry/double click; injected failure; empty/no-match/forbidden/stale state; next-step/notification/queue/audit receipts; unwanted-effect count; source SHA/build identity; restore/cleanup. Every retained local section in the embedded panel register needs a verdict. Long labels, large numbers, missing names/emails, no linked records and blocked/degraded providers must render usefully.

No fake pass for absent role/session/processor/source receipt. Mark exact missing browser/native obligation and owner. Local fixtures still prove component/action behavior. A required workspace action that is blocked is not premium/functional completion; remedy the owned UI bug or explicitly return NOT READY with its A/B/later owner. Provider execution is not a condition for truthful UI unknown states.

## 10. Post-build search, diff and completion gates

Repeat task rg checks and route/control inventory. Diff-review unauthorized role expansion, secret/PII logs, accidental provider calls on mount, duplicate authorities, public CSS effects, hardcoded status/zeros, unbounded lists/polling, broken aliases, invented chart values and hidden disabled controls. Verify all source IDs have one primary owner; cross-references are dependencies, not duplicate repairs. `git diff --check`; supported stock build/CI; actual handler/DB/session receipts; complete owned route/action/state matrix; measured visual/responsive/a11y gates; outbound/no-echo checks; canonical report+ledger updates. Commit candidate cleanly before repository clean/diff-isolation certification; do not remove the isolation assertion because a candidate is uncommitted. No merge/deploy outside the existing authorized workflow.

## 11. Final verified-from-code and handoff format

One final table: original ID + subclaim; repair group; preflight evidence; exact final symbol/files/lines; implementation; source/test/DB/browser receipts; post-build verdict; final commit; serving build if verified; remaining owner. Separate source-fixed, tested, merged, deployed, runtime-verified. Report visual contract adoption with measured token/spacing/contrast/screenshots and actual route/action coverage denominator, not “100% premium” without evidence. State READY FOR REVIEW or NOT READY with concrete outstanding gates.

Update `LIBERTY_BANCARD_STAGE_3_CONSOLIDATED_IMPLEMENTATION_SPEC.md` and `LIBERTY_BANCARD_GO_LIVE_AUDIT_LEDGER_CURRENT(2).md` after task/audit, preserving all 95 source entries,14 repair groups and historical evidence. If available files are outside repo, write reconciled copies/patches under an agreed docs/certification path and return them for the canonical record; do not silently lose the update. Link exact new evidence/suite files. Full Stage 3, Stage 9 and native certification remains D/later lanes.

## 12. Complete assigned source-entry/subclaim register

| Source ID(s) / repair group | Exact owned subclaim / remaining owner |
| --- | --- |
| CRM3-05; REF-005, REF-010, REF-045, REF-049, REF-050, REF-055, REF-067 / R04 | Daily task/AI/assignment/SLA/notification presentation and same-scope consumer verification; A definitions/B durable authority. |
| CRM3-11; REF-006, REF-046, REF-059, REF-060, REF-061, REF-069 / R06 | Contacts/Pipeline labels, data provenance and scope; historical cleanup and native/count extrapolation not inferred. |
| CRM3-13; REF-007, REF-047, REF-051, REF-062 / R12 | Inbox/contactability/readiness reasons and list/record actions; B permission/send authority; do not turn ZB into new visibility gate. |
| CRM3-21, CRM3-24, CRM3-26; REF-031, REF-048, REF-053, REF-056 / R08 | Daily layout, Contact grouping and relationships; C4 lifecycle interior and C5 admin workflows retain ownership. |
| CRM3-22 / R13 | Every owned query/list/secondary panel lazy/paged/performance proof. |
| REF-003 / R03 | B local-create/replay UI feedback consumes A request recovery, no duplicate create after accepted/degraded result. |
| REF-058 / R05 | C2 route/action slice of blanket “all sections work” disproved claim; per-action verdict required. |


The embedded destination and panel tables below retain explicit original evidence IDs. Source-derived contracts are not runtime passes. Every assigned parent/subclaim receives a final verdict; disproved/superseded/expected-control allegations are preserved with a reason, not rebuilt as new defects. No count of these rows represents unique verified defects.

### Exact destination and view contracts

These required target groupings preserve existing URL compatibility and roles; menu group is not permission. Where an outer hub stays restricted, use the existing permitted standalone wrapper for other roles.

| Sidebar label / owner | Canonical employee entry | Exact local structure / access |
| --- | --- | --- |
| Today / C2 | /dashboard (admin/manager); /dashboard/my-day (agent) | Due work, appointments, inbound handoffs, permitted team/unassigned queues. Contextual AI action; no extra sidebar AI destination. |
| Records / C2 | /dashboard/contacts-leads?tab=people | People and Leads; contextual Company detail. Agent uses existing /dashboard/contacts and /dashboard/my-leads wrappers. Do not gate agents behind a newly privileged hub. |
| Pipeline / C2 | /dashboard/pipeline | Board and List; same query scope. Stage configuration is a privileged contextual link. |
| Inbox / C2 | /dashboard/comms-hub | One source-aware feed; All, Email, SMS, GHL Chat, Voicemail, Site channel filters; All, Unread, Needs Reply work views. |
| Work / C2 | /dashboard/tasks-appointments?tab=tasks | Tasks and Appointments (existing URL value calendar). Notifications in header and retained standalone fallback. |
| Merchant Operations / C4 | /dashboard/portfolio | Portfolio, Applications, Statement Reviews, Documents, Underwriting, Boarding, Onboarding, Risk, Success, Support; Partners local group. Retain separate merchant/partner portals. |
| Prospecting / C3 | /dashboard/lead-ops?tab=businesses | Five areas: Inventory, Sources & Imports, Enrichment, Qualification & Staging, Program Health. Canonical Enrichment is nested context, not a twelfth sidebar destination. Scoped agent outreach/intelligence entry uses existing authorized wrapper. |
| Campaigns / C3 | /dashboard/outbound-center?tab=campaigns | Four primary areas: Manage, Audience, Delivery, Results. Campaigns and Sequences nested in Manage. Local/native states explicit; no sending/enrollment activation. |
| Reports / C4 | /dashboard/reporting?tab=overview | Four areas: Sales & Growth, Operations, Outreach, Financial. Scoped agent Earnings/Leaderboard wrapper, preserving manager/admin hub restrictions. |
| Administration / C5 | /dashboard/admin-hub?tab=users (admin); ?tab=agents (manager) | Five areas: Users & Access, Integrations, Operational Controls, Data & Audit, Release Readiness; individual child guards retained. |
| Resources / C5 | /dashboard/knowledge-base | Knowledge, Playbooks, Training, Collateral; privileged Acquisition Content subgroup. Security self-service in account menu and compatible standalone page. |

| Legacy Contact tab | Primary area / new URL state | Presentation / owner |
| --- | --- | --- |
| overview | Overview / area=overview&section=overview | Identity/lifecycle/next step; C2 |
| relationships | Overview / area=overview&section=relationships | Verified Contact↔Company↔Business links; C2 consumes B |
| locations | Overview / area=overview&section=locations | Addresses/locations; C2 |
| company-intelligence | Overview / area=overview&section=company-intelligence | Existing evidence, role gated; C2 with C3 context |
| deals | Sales Work / area=sales-work&section=deals | Linked deals, create/open; C2 |
| tasks | Sales Work / area=sales-work&section=tasks | Actual B task actions/due state; C2 |
| call-logs | Sales Work / area=sales-work&section=call-logs | Structured log and follow-up; C2 |
| call-assist | Sales Work / area=sales-work&section=call-assist | Existing permitted guidance; no automatic AI/dial call; C2 |
| offer-intelligence | Sales Work / area=sales-work&section=offer-intelligence | Existing permitted offer guidance; C2 |
| sales-prep | Sales Work / area=sales-work&section=sales-prep | Existing prep; C2 |
| comm-timeline | Conversations / area=conversations&section=comm-timeline | Unified filtered messages/calls/notes/comments timeline; C2 |
| comm-health | Conversations / area=conversations&section=comm-health | Independent contactability/delivery state; C2 |
| delivery-log | Conversations / area=conversations&section=delivery-log | Actual source receipts; C2 |
| notes | Conversations / area=conversations&section=notes | Add/edit note drawer + durable timeline; C2/B |
| comments | Conversations / area=conversations&section=comments | Retain author/time/scope; C2/B |
| documents | Lifecycle / area=lifecycle&section=documents | C2 composition; C4 existing document internals |
| onboarding-stages | Lifecycle / area=lifecycle&section=onboarding-stages | C2 composition; C4 internals |
| rfis | Lifecycle / area=lifecycle&section=rfis | C2 composition; C4 internals |
| tickets | Service & Performance / area=service-performance&section=tickets | C2 composition; C4 support internals/B actions |
| live-processing | Service & Performance / area=service-performance&section=live-processing | C4 source/period truth |
| chargebacks | Service & Performance / area=service-performance&section=chargebacks | C4 source/permission truth |
| churn-risk | Service & Performance / area=service-performance&section=churn-risk | C4 model/version vs observed behavior |
| nps | Service & Performance / area=service-performance&section=nps | C4 survey/sample status |
| activity | Activity & History drawer / drawer=activity | Preserve related record filters and thread; C2 |
| history | Activity & History drawer / drawer=history | Separate retained audit history; C2 |

### Exact shared Liberty UI contract — included in every C prompt

The values labelled Existing are verified in current `client/src/index.css`, `tailwind.config.ts`, `client/index.html`, `DashboardLayout.tsx`, and `components/ui/*`. The `--crm-*` names and dimensions below are proposed implementation contracts, not claims that those variables/components already exist. C1 implements them; C2–C5 consume the same implementation. This is the retained Liberty direction, not a recovered copy of the missing original interactive preview.

| Existing token(s) | Light value | Dark value | Use / required treatment |
| --- | --- | --- | --- |
| --font-body / --font-display | 'IBM Plex Sans', system-ui, sans-serif | Same | Operational text/headings. No marketing serif in CRM. |
| --font-mono | 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace | Same | IDs/code/diagnostics only; amounts use Plex Sans with tabular numerals. |
| --font-marketing-display | 'Source Serif 4', Georgia, 'Times New Roman', serif | Marketing isolated | Retain public route theme; never apply to CRM. |
| --background / --foreground | 40 33% 98% / 222 47% 11% | 222 47% 11% / 210 40% 98% | Warm canvas / text. |
| --card / --card-foreground | 0 0% 100% / 222 47% 11% | 222 47% 10% / 210 40% 98% | Work surfaces. |
| --popover / --popover-foreground | 0 0% 100% / 222 47% 11% | 222 47% 10% / 210 40% 98% | Menus/dialog surfaces. |
| --primary / --primary-foreground | 222 47% 11% / 210 40% 98% | 210 40% 98% / 222 47% 11% | Navy primary in light; theme-correct inverse in dark. |
| --secondary / --secondary-foreground | 210 40% 96.1% / 222 47% 11% | 217.2 32.6% 17.5% / 210 40% 98% | Quiet controls. |
| --muted / --muted-foreground | 210 40% 96.1% / 215 16% 47% | 217.2 32.6% 17.5% / 215 20.2% 65.1% | Secondary surfaces/text; measure contrast. |
| --accent / --accent-foreground | 221 78% 48% / 210 40% 98% | 217.2 32.6% 17.5% / 210 40% 98% | Trust Blue accents; selected light fill with white text only if measured pass. Dark uses actual theme. |
| --destructive / --destructive-foreground | 0 84.2% 60.2% / 210 40% 98% | 0 62.8% 30.6% / 210 40% 98% | Destructive controls; base pairs must be contrast-tested and CRM-scoped foreground corrected if needed. |
| --border / --input | 214.3 31.8% 91.4% | 217.2 32.6% 17.5% | 1px borders. Interactive boundaries must pass independently; do not assume muted decorative border passes 3:1. |
| --ring | 222 47% 11% | 212.7 26.8% 83.9% | 2px visible focus plus 2px offset. |
| --brand-red | 0 72% 47% | 0 70% 55% | Liberty identity accent; sparing usage, not generic warning. |
| --stat-positive / --stat-negative | 152 52% 36% / 0 66% 48% | 152 45% 50% / 0 72% 62% | Status text/icon; never color-only information. |
| --sidebar / --sidebar-foreground | 0 0% 100% / 222 47% 11% | 222 47% 10% / 210 40% 98% | Retain readable sidebar and existing blue logo. |
| --sidebar-border / --sidebar-ring | 214.3 31.8% 91.4% / 222 47% 11% | 217.2 32.6% 17.5% / 212.7 26.8% 83.9% | Sidebar edges/focus. |
| --sidebar-primary / --sidebar-primary-foreground | 222 47% 11% / 210 40% 98% | 210 40% 98% / 222 47% 11% | Active emphasis. |
| --sidebar-accent / --sidebar-accent-foreground | 210 40% 96.1% / 222 47% 11% | 217.2 32.6% 17.5% / 210 40% 98% | Quiet selected/hover surface. |
| --radius | 0.5rem | Same | lg 8px; md 6px; sm 3px in current Tailwind config. |
| --shadow-card | 0 1px 2px -1px hsl(222 47% 11% / .08), 0 2px 6px -1px hsl(222 47% 11% / .06) | 0 1px 2px -1px hsl(0 0% 0% / .4), 0 2px 6px -1px hsl(0 0% 0% / .3) | Cards sparingly; tables mostly border-defined. |
| --shadow-elevated | 0 12px 32px -12px hsl(222 47% 11% / .28), 0 4px 10px -4px hsl(222 47% 11% / .12) | 0 12px 32px -12px hsl(0 0% 0% / .55), 0 4px 10px -4px hsl(0 0% 0% / .4) | Overlays only. |
| --mobile-header-height / --mobile-dock-height | 76px / 72px | Same | Existing dedicated mobile surfaces; preserve env(safe-area-inset-*) and avoid applying these offsets a second time to desktop shell. |

| Element / proposed CRM token | Exact design contract | Application / behavior |
| --- | --- | --- |
| .crm-theme scope | Authenticated employee shell only; inherited into CRM portal overlays explicitly | No global :root rewrite or accidental public/merchant/partner theme mutation. C1 owns scoped styles and portal wrapper. |
| --crm-space-1…6 | 4px, 8px, 12px, 16px, 24px, 32px | Page/card/toolbar/form gaps use this scale; no arbitrary 7/13/19px variants. |
| --crm-title-size / line / weight | 24px / 32px / 600 | One H1 per page; no duplicate nested hub headline. |
| --crm-section-size / line / weight | 18px / 24px / 600 | H2/card heading. |
| --crm-body-size / line / weight | 14px / 20px / 400 | Body/table; action labels 500. |
| --crm-label-size / line / weight | 12px / 16px / 500 | Field/table headers/status metadata. Never essential 10px labels. |
| --crm-metric-size / line / weight | 28px / 32px / 600 | Plex Sans + font-variant-numeric:tabular-nums; <=5 summary metrics. |
| --crm-target-height | 44px minimum | Buttons, icons, inputs, selects, nav and tabs; textarea min96px, line20px, padding12px. 16px input font on touch screens below768px to avoid focus zoom. |
| --crm-control-radius / surface-radius | 6px / 8px | Controls/surfaces; no inconsistent oversized rounding. |
| Sidebar / header / content | 256px expanded, 48px collapsed; header 56px; max content1280px | Retain source geometry; full-width content inside shell. Mobile drawer min(288px,viewport−32px). Logo32px high with intrinsic aspect ratio. |
| Main / card / section | 12px main padding <640px; 24px >=640px; card16px; section gap24px | One owner applies page padding; nested panels do not reapply main gutters. |
| PageHeader | Title/description left; one primary + <=2 secondary actions right; gap16px | Stacks below768px; overflow menu labelled More actions. Header action count limit excludes per-row actions. |
| AreaTabs / local navigation | 44px minimum height, 16px horizontal padding, gap8px | Five contact/prospecting/admin or four campaign/report primary areas; controlled URL; secondary sections via select/rail/anchor, not another 25-tab row. |
| WorklistToolbar | Search min240px on wide screens, field44px; controls gap8px | Search debounce250ms; cancel stale results; filter change resets page/cursor; mobile search full width, filters in accessible drawer. |
| Table | Header40px; data row min44px; checkbox/action targets44px; cells x12px/y10px | Min row rises as content wraps. Sticky header in max-height:min(640px,70dvh) list; correct scroll ownership. Default page50; sizes25/50/100 only when API supports. |
| Wide list column budgets | Selection44px, identity min220px flexible, owner140px, stage/status140px, next date140px, actions44px | Optional column visibility responds to actual available container width; never force full desktop table into sidebar-reduced tablet viewport. |
| Cards for narrow lists | Below768px: identity, stage/status, owner, next action, selection, overflow; padding16px gap12px | Same rows/scope/actions as desktop. Record name is a real link, not only a click handler on <tr>. |
| Detail layout | >=1280: minmax(0,1fr) +320px context rail gap24px; 768–1279 stacked; <768 cards | Important identity/owner/next-step remains first. One record surface owner with optional child embedding. |
| Side panel / modal | 480px drawer on desktop; width100% <768px; form dialog max560px | Viewport max-height calc(100dvh−32px); scrollable body; sticky footer; accessible title/close; safe area included once. |
| MetricStrip | 2 columns small, up to5 wide; gap12px; padding16px | Numeric loading skeleton, unavailable dash+explanation, stale timestamp. Click only when corresponding same-predicate list exists. |
| Charts | >=240px plot height; responsive width; legend + accessible table | No fabricated series/zero missing data. C1 implements exact proposed chart palette below and maps existing consumers; distinguish series with labels/dashes/markers. |
| Focus / borders / motion | 2px ring +2px offset; >=4.5:1 normal text, >=3:1 large text/control/focus; motion<=150ms | Remove maximum-scale=1; test200% zoom/reflow, keyboard and reduced motion. Border token alone is not a contrast pass. |
| States | Loading, empty, no matches, no access, unavailable, degraded/stale, pending, conflict, success | Four distinct zero/error/access outcomes. aria-live polite status; alert for actionable failure; preserve last known data on refresh error. |
| Performance target | First useful worklist<=2.5s on recorded fixture/network; local input/selection response<=200ms excluding server | Record baseline/after fixture size, throttling and p95 API/route timing. Lazy-mount inactive panels; stop hidden polling; no startup provider/classification work. |
| Proposed --crm-chart-1…5 | Light HSL: 221 78% 48%; 152 52% 36%; 0 72% 47%; 222 47% 11%; 215 16% 47% | Dark HSL: 217 91% 60%; 152 45% 50%; 0 70% 55%; 210 40% 98%; 215 20.2% 65.1%. Chart marks only, not text semantic roles; accessible labels and measured contrast. |
| Proposed control/danger aliases | --crm-control-border:215 16% 47% light /215 20.2% 65.1% dark; --crm-danger-surface:var(--brand-red) light /var(--destructive) dark | --crm-danger-foreground:0 0% 100% both themes. Measure combinations; CRM-scoped correction if needed, never blind global change. |

Current build is Tailwind **4.3.3** via `@tailwindcss/vite`, `@config`, `tailwind-legacy-theme.json` and `styles/tailwind-legacy-preflight.css`. Preserve that migration and compatibility assets. Do not revert to Tailwind3 or delete compatibility CSS during UI cleanup. Render current compiled utilities before choosing classes: verify spacing, borders, ring, shadows, hover, table and disabled behavior from actual computed style. Existing `font-sans`/`font-serif` config references `--font-sans`/`--font-serif`; operational CSS defines body/display. C1 must deliberately resolve aliases or use `font-body`; no silent fallback. Reuse existing Radix/shadcn primitives and Lucide icons, no competing component library. Do not alter public Source Serif typography.

Reusable components (proposed paths `client/src/components/crm/`): `CrmPageHeader` (title, description, context breadcrumbs, primary/secondary/overflow); `CrmAreaNav` (registry-derived entries, URL state, role-filtered targets); `ScopedMetricStrip` (value, availability, scopeId, asOf, sourceLabel, same-predicate link); `WorklistToolbar` (search, view/filter state, reset, primary action); `CrmDataTable` (server rows/page, columns, ID selection, sort, mobile renderer, cursor/total availability); `RecordHeader`; `CrmActionMenu` (capability/reason, pending/confirmation); `CrmDataState` (distinct states, retry, lastKnown); `IntegrationStatus` (configured, enabled, execution state, lastSuccess, freshness, reason); `CrmDetailDrawer` (form/focus/unsaved-change behavior). Names are an interface contract; combine wrappers if existing reusable components already satisfy it. One owner and one definition per behavior.

Do not place infrastructure jargon (leases, attestation epochs, release hashes, event IDs) in everyday rep flows. Diagnostics retain technical detail in expandable privileged sections. Fix confusing interactions using already authoritative source evidence and selection/context; never fabricate evidence or loosen an identity/permission rule solely to remove a form field. Current removed provider approval/spend-limit policy must not be restored. ZB validation is a separate status, not a newly introduced prerequisite to UI visibility or general admission.

### Current source tab and API anchors

Literal source inventory is a preflight seed. Dynamic keys, conditional role tabs, nested children, forms/actions and overlays require actual runtime inventory; these extracted API anchors include base/prefix strings and are not proof of endpoint semantics.

| Current source | Lines at reviewed SHA | Source-derived literal tab keys | Read/action API discovery anchors (not full action census) |
| --- | --- | --- | --- |
| client/src/pages/dashboard/ContactsAndLeads.tsx | 73 | people, leads | Hub composes current child owners; see child APIs |
| client/src/pages/dashboard/ContactDetail.tsx | 2896 | overview, deals, tickets, tasks, notes, documents, live-processing, chargebacks, activity, call-logs, call-assist, relationships, locations, history, comments, churn-risk, delivery-log, comm-timeline, comm-health, offer-intelligence, company-intelligence, sales-prep, onboarding-stages, rfis, nps | /api/contacts, /api/contacts/, /api/churn-scores/contact, /api/churn-scores/contact/, /api/churn-score-weights, /api/agents, /api/proxycurl/status, /api/notes, /api/notes?entityType=contact, /api/rate-reviews/contact, /api/rate-reviews/contact/, /api/rate-reviews/ |
| client/src/pages/dashboard/CommsHub.tsx | 910 | No literal TabsTrigger keys in static census; inspect dynamic view/control definitions | /api/inbox/contacts, /api/inbox/contacts/, /api/sms-inbox/thread, /api/sms-inbox/thread/, /api/live-chat/sessions, /api/live-chat/sessions/, /api/sms-inbox/reply, /api/inbox/reply, /api/inbox/items, /api/live-chat/contacts/search, /api/live-chat/contacts/search?q=, /api/inbox/items? |
| client/src/pages/dashboard/TasksAppointments.tsx | 57 | tasks, calendar | Hub composes current child owners; see child APIs |
| client/src/pages/dashboard/Pipeline.tsx | 3744 | No literal TabsTrigger keys in static census; inspect dynamic view/control definitions | /api/deals/, /api/contacts/, /api/deals, /api/contacts, /api/deal-competitors/deal, /api/deal-competitors/deal/, /api/deal-competitors, /api/audit-logs/entity, /api/audit-logs/entity/deal/, /api/deals?pipeline=sales, /api/analytics/pipeline, /api/mid-stats/pipeline-summary |
| client/src/pages/dashboard/Contacts.tsx | 2408 | No literal TabsTrigger keys in static census; inspect dynamic view/control definitions | /api/activity, /api/activity?entityType=, /api/contacts/merge-operations/preview, /api/contact-merge-operations/:operationId/approve, /api/contact-merge-operations/:operationId/execute, /api/contact-merge-operations/:operationId/undo, /api/contacts/, /api/contacts, /api/agents, /api/contacts/class-counts, /api/admin/contacts/bulk-delete-snapshot, /api/admin/contacts/bulk-hard-delete/preview |
| client/src/pages/dashboard/Leads.tsx | 96 | No literal TabsTrigger keys in static census; inspect dynamic view/control definitions | /api/revenue/leads, /api/revenue/leads?limit= |
| client/src/pages/dashboard/Tasks.tsx | 889 | No literal TabsTrigger keys in static census; inspect dynamic view/control definitions | /api/tasks, /api/tasks?, /api/tasks/, /api/ai/generate-tasks, /api/tasks/bulk-assign, /api/tasks/bulk-delete |
| client/src/pages/dashboard/SalesRepHome.tsx | 1561 | No literal TabsTrigger keys in static census; inspect dynamic view/control definitions | /api/appointments, /api/leaderboard, /api/leaderboard?period=month, /api/my-day/log-activity, /api/my-day, /api/my-day/deals/, /api/analytics/deals-closing-this-month, /api/save-cases/my |
| client/src/pages/dashboard/Overview.tsx | 1314 | No literal TabsTrigger keys in static census; inspect dynamic view/control definitions | /api/overview/daily-briefing, /api/overview/daily-briefing/refresh, /api/system/outbound-settings, /api/ai/insights, /api/kpi/summary, /api/contacts, /api/deals, /api/kpi/pipeline-stats, /api/kpi/comparative, /api/analytics/lead-sources, /api/admin/rep-activity/today, /api/admin/rep-activity/inactive |

### Exact assigned route register — 25 current dashboard patterns

Current-source entry/role data and proposed disposition are separate columns. The original R IDs retain historical identities; R-147 is the newly discovered canonical route. C1 owns registry/adapters for all 147; each surface has exactly one C2–C5 delivery owner. Dedicated /mobile and public routes are additional boundary/regression tests, not counted in147.

| ID | Current pattern | Current source entry | Surface owner / group | Required canonical target or retained entry | Disposition / guard contract |
| --- | --- | --- | --- | --- | --- |
| R-002 | /dashboard/mobile/contacts/:id | App.tsx:506; alias/wrapper | C2 / Scoped mobile / access boundary | /mobile/contacts/:id | KEEP entity namespace + verified contextual links; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-003 | /dashboard/mobile/pipeline | App.tsx:509; alias/wrapper | C2 / Scoped mobile / access boundary | /mobile/pipeline | KEEP mobile compatibility redirect; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-004 | /dashboard/mobile/tasks | App.tsx:512; alias/wrapper | C2 / Scoped mobile / access boundary | /mobile/tasks | KEEP mobile compatibility redirect; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-005 | /dashboard/mobile | App.tsx:515; alias/wrapper | C2 / Scoped mobile / access boundary | /mobile | KEEP mobile compatibility redirect; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-006 | /dashboard | App.tsx:553; Overview | C2 / Today / contextual AI | /dashboard | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-007 | /dashboard/companies/:id | App.tsx:556; CompanyDetail | C2 / Records | /dashboard/companies/:id | KEEP entity namespace + verified contextual links; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-008 | /dashboard/contacts/:id | App.tsx:559; ContactDetail | C2 / Records | /dashboard/contacts/:id | KEEP entity namespace + verified contextual links; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-009 | /dashboard/contacts | App.tsx:562; Contacts | C2 / Records | /dashboard/contacts-leads?tab=people (admin/manager); retain scoped agent entry | MERGE presentation; preserve compatibility / scope; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-010 | /dashboard/my-leads | App.tsx:565; Leads | C2 / Records | /dashboard/contacts-leads?tab=leads (admin/manager); retain scoped agent entry | MERGE presentation; preserve compatibility / scope; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-011 | /dashboard/chat | App.tsx:568; Chat | C2 / Today / contextual AI | /dashboard/chat | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-012 | /dashboard/pipeline | App.tsx:571; Pipeline | C2 / Pipeline | /dashboard/pipeline | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-015 | /dashboard/tasks | App.tsx:580; alias/wrapper | C2 / Work / header notifications | /dashboard/tasks-appointments?tab=tasks | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-016 | /dashboard/notifications | App.tsx:583; Notifications | C2 / Work / header notifications | /dashboard/notifications | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-017 | /dashboard/call-outcome | App.tsx:586; CallOutcome | C2 / Record contextual tool | /dashboard/call-outcome | CONTEXTUAL action; keep standalone safe fallback; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-018 | /dashboard/review-complete | App.tsx:589; ReviewComplete | C2 / Record contextual tool | /dashboard/review-complete | CONTEXTUAL action; keep standalone safe fallback; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-029 | /dashboard/contacts-leads | App.tsx:623; ContactsAndLeads | C2 / Records | /dashboard/contacts-leads | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-030 | /dashboard/tasks-appointments | App.tsx:626; TasksAppointments | C2 / Work / header notifications | /dashboard/tasks-appointments | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-041 | /dashboard/stage-rules | App.tsx:663; StageRules | C2 / Pipeline | /dashboard/stage-rules | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-070 | /dashboard/calendar | App.tsx:753; alias/wrapper | C2 / Work / header notifications | /dashboard/tasks-appointments?tab=calendar | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-084 | /dashboard/sms-inbox | App.tsx:795; alias/wrapper | C2 / Inbox | /dashboard/comms-hub?tab=messages | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-085 | /dashboard/bin-lookup | App.tsx:798; BinLookup | C2 / Record contextual tool | /dashboard/bin-lookup | CONTEXTUAL action; keep standalone safe fallback; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-097 | /dashboard/my-day | App.tsx:834; SalesRepHome | C2 / Today / contextual AI | /dashboard/my-day | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-098 | /dashboard/live-chat | App.tsx:837; alias/wrapper | C2 / Inbox | /dashboard/comms-hub?tab=live-chat | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-116 | /dashboard/comms-hub | App.tsx:899; CommsHub | C2 / Inbox | /dashboard/comms-hub | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-123 | /dashboard/nba | App.tsx:920; NbaPriorityPage | C2 / Today / contextual AI | /dashboard/nba | KEEP owner; grouped/local navigation; ["admin", "manager"] |

### Original audit panel reconciliation — 30 reference entries

These are the original309 observation rows assigned to a delivery owner, not a fresh unique panel/action count. Historical example IDs (including159443) are references, not permission to mutate production. Substitute owned disposable fixtures with recorded lineage for behavior tests. Current source changes/additions (notably canonical5 views) must be appended and tested separately; none of these reference rows is automatically verified from prior observation.

| Original ID | Historical URL | Retained control/panel | Required workspace placement | Implementation owner / evidence limit |
| --- | --- | --- | --- | --- |
| T-006 | /dashboard/contacts/159443 | Deals (1) / tab | Records → Sales Work | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-007 | /dashboard/contacts/159443 | Tickets (0) / tab | Records → Service & Performance | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-008 | /dashboard/contacts/159443 | Tasks (1) / tab | Records → Sales Work | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-009 | /dashboard/contacts/159443 | Notes (0) / tab | Records → Conversations | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-010 | /dashboard/contacts/159443 | Documents  / tab | Records → Lifecycle | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-011 | /dashboard/contacts/159443 | Live Processing / tab | Records → Service & Performance | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-012 | /dashboard/contacts/159443 | Chargebacks / tab | Records → Service & Performance | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-013 | /dashboard/contacts/159443 | Activity / tab | Records → Activity & History drawer | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-014 | /dashboard/contacts/159443 | Calls & VMs / tab | Records → Sales Work | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-015 | /dashboard/contacts/159443 | Call Assist / tab | Records → Sales Work | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-016 | /dashboard/contacts/159443 | Relationships / tab | Records → Overview | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-017 | /dashboard/contacts/159443 | Locations  / tab | Records → Overview | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-018 | /dashboard/contacts/159443 | History / tab | Records → Activity & History drawer | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-019 | /dashboard/contacts/159443 | Comments / tab | Records → Conversations | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-020 | /dashboard/contacts/159443 | Churn Risk / tab | Records → Service & Performance | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-021 | /dashboard/contacts/159443 | Delivery Log / tab | Records → Conversations | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-022 | /dashboard/contacts/159443 | Comm. Timeline / tab | Records → Conversations | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-023 | /dashboard/contacts/159443 | Comm. Health / tab | Records → Conversations | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-024 | /dashboard/contacts/159443 | Offer Intelligence / tab | Records → Sales Work | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-025 | /dashboard/contacts/159443 | RFIs / tab | Records → Lifecycle | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-026 | /dashboard/contacts/159443 | NPS / tab | Records → Service & Performance | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-061 | /dashboard/contacts-leads | People / hub-tab | Records → retained nested section | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-062 | /dashboard/contacts-leads?tab=leads | Leads / hub-tab | Records → retained nested section | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-063 | /dashboard/tasks-appointments | Tasks / hub-tab | Work / header notifications → retained nested section | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-064 | /dashboard/tasks-appointments?tab=calendar | Appointments / hub-tab | Work / header notifications → retained nested section | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-213 | /dashboard/notifications | All / nested-tab | Work / header notifications → retained nested section | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-214 | /dashboard/notifications | Leads / nested-tab | Work / header notifications → retained nested section | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-215 | /dashboard/notifications | Deals / nested-tab | Work / header notifications → retained nested section | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-216 | /dashboard/notifications | SLA / nested-tab | Work / header notifications → retained nested section | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-217 | /dashboard/notifications | System / nested-tab | Work / header notifications → retained nested section | C2; historical observation, actions UNVERIFIED unless new receipt |

### Every-action acceptance record — required artifact

Create `docs/certification/stage3-c2/actions.csv` with columns: sourceClaimIds,repairGroup,routePattern,currentUrl,area,section,controlId,label,role,fixtureId,fixtureClass,handler,prestate,expectedRequest,expectedResult,actualResult,readbackReceipt,refreshResult,retryResult,cancelEffects,unauthorizedEffects,providerEffects,queueEffects,auditReceipt,viewport,theme,keyboardResult,sourceSha,servingBuildId,verdict,remainingOwner. Include every toolbar/row/overflow/drawer/tab/select/control, including expected disabled controls with current reason. Count total/pass/defect/blocked/untested; required actions may not silently disappear or be marked pass from opening a modal.

## Final directive

Audit actual current source, implement this bounded task completely, verify the real rendered styles and actions, preserve Liberty branding and all relevant data/role/safety authorities, update the same canonical report and ledger, and return a reviewable evidence-backed result. Do not end at a proposal, untested polished screenshot, nonfunctional menu or blanket “100%” claim. No production outbound/provider/native/deployment activity is authorized by this prompt.
