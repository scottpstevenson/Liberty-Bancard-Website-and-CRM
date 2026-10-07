# LIBERTY BANCARD — STAGE 3 TASK C1
# MASTER REPLIT PREFLIGHT + BUILD PROMPT

## Task C1 — Route ownership and shared Liberty UI foundation

Establish the typed route/destination/query registry and scoped shared UI system for all current CRM surfaces. Preserve current visible navigation until each owning workspace is functional. Build and verify an actual representative worklist/record template against existing read contracts; deliver real components and adapters, not only tokens or a spreadsheet.

### A. Verified from current code — seeded preflight table

| ID / original scope | Exact current source anchor | Verdict / evidence | Repair / acceptance |
| --- | --- | --- | --- |
| C1-V01 / R05 | `client/src/App.tsx:346` | SOURCE: legacy redirect concatenates raw query after tab=monitor; route set now includes147 dashboard patterns. | Typed route inventory/normalizer; no duplicate tab, role-aware alias and entity namespace tests. |
| C1-V02 / R08 | `client/src/pages/DashboardLayout.tsx:134` | SOURCE: parallel daily/ops/outbound/reports/resources/dev arrays; duplicate resource/technical links and hidden Dev Mode discovery. | Registry owns menu/group/role metadata; C5 cutover, no C1 premature11-entry menu. |
| C1-V03 / R13 | `client/src/index.css:19` | VERIFIED EXISTING: Plex Sans/Mono, navy/blue/red, theme/shadow/sidebar/mobile variables. | Reuse existing palette; scoped CRM density typography and portal inheritance. |
| C1-V04 / design integration | `tailwind.config.ts:91` | SOURCE CONTRACT GAP: font-sans/font-serif use aliases not established by retained operational variables. | Explicit alias resolution; actual computed font tests in supported Tailwind4 build, not a new runtime defect count. |
| C1-V05 / shared primitives | `client/src/components/ui/button.tsx:29` | VERIFIED EXISTING: buttons min36/32/40px, icons36px; global primitive shared with public. | Scoped44px targets/focus; no global marketing resize; production compiled styles checked. |
| C1-V06 / accessibility | `client/index.html:5` | SOURCE CONFIRMED: viewport restricts maximum scale. | Remove max scale restriction, verify CRM and public zoom/reflow. |
| C1-V07 / current build | `vite.config.ts:5` | VERIFIED CURRENT: Tailwind4 integration is already merged; legacy theme/preflight compatibility retained. | Preserve migration and supported utility outputs; no Tailwind3 rollback. |
| C1-V08 / R13 | `client/src/components/DashboardErrorState.tsx:11` | VERIFIED EXISTING: reusable error/retry exists; full empty/no-match/access/stale abstraction proposed. | Extend/compose existing rather than second error system; distinct typed states and meaningful behavior tests. |

### B. Relevant files and blast radius

Inspect current existing files: `client/src/App.tsx`; `client/src/pages/DashboardLayout.tsx`; `client/src/index.css`; `client/index.html`; `tailwind.config.ts`; `tailwind-legacy-theme.json`; `client/src/styles/tailwind-legacy-preflight.css`; `vite.config.ts`; `client/src/components/ui/button.tsx`; `client/src/components/ui/input.tsx`; `client/src/components/ui/tabs.tsx`; `client/src/components/ui/sidebar.tsx`; `client/src/components/ui/dialog.tsx`; `client/src/components/ui/sheet.tsx`; `client/src/components/ui/table.tsx`; `client/src/components/DashboardErrorState.tsx`; `client/src/components/ErrorBoundary.tsx`; `client/src/lib/queryClient.ts`; `client/src/hooks/use-auth.ts`; `scripts/ci-suite-manifest.ts`.

Proposed shared destinations: `client/src/lib/crm-destinations.ts`, `client/src/lib/crm-navigation-state.ts`, `client/src/components/crm/*`, `client/src/styles/crm-theme.css`, and task evidence under `docs/certification/stage3-c1/`. These are suggested new files, not existing code. Update already shipped C1 owners instead of creating duplicates. Verify each imported child/action/suite in the actual current repo. Narrow changes to the owned UI/adapter/diagnostic scope; preserve A/B contracts and concurrent changes.

### C. Implementation sequence

1. Refresh current route census and all source/dynamic tabs, context links, menus, notifications, keyboard shortcuts, mobile URLs and role wrappers. Import historical R-001…146/T-001…309 as evidence references and add R-147 canonical enrichment; additions receive stable new IDs, never renumber old evidence. Attach actual component/read/action owners, guard and intended route/state to every entry.
2. Create proposed `client/src/lib/crm-destinations.ts` and `client/src/lib/crm-navigation-state.ts` (or equivalent existing owner). Each registry entry contains stable id, match pattern, workspace, primaryArea, section, render owner, capability/role requirements, record namespace, query validator/default, legacy alias/translation, contextual/full-page behavior, menu visibility and safe retirement condition. Distinguish UI route registry from the server API permission registry C5 repairs.
3. Implement pure URL building/parsing from URLSearchParams. Preserve compatible ID, source, search, owner, pagination, dates, safe filters; strip secret/session inputs. Normalize duplicate/conflicting tab keys deterministically, unknown tab with visible reason, query namespace per child. User tab changes push history; search/filter debounced replace; canonical alias redirects replace. Browser back/reload restores selected area/section/filter without writes.
4. Provide Contact old25-tab translation into five primary areas plus drawer; leave C2 rendering adoption there. Financial adapter accepts old tab=forecasting/revenue/terminal-roi and emits reporting tab=financial&financialTab=...; C4 route adoption. Operator adapter retains tab=monitor&view=... under SystemHealth; C5 fixes setView consumer. LeadOps valid Provider Results existing repair preserved; C3 derives five-area UI without dropping secondary URLs.
5. Implement scoped .crm-theme variables and shared components from the embedded contract. Overlays portaled to document.body must receive CRM class/variables through an explicit styled portal wrapper or container; tests cover dropdown/dialog/sheet/select/toast and dark mode. Preserve existing sidebar/global public/portal variables; no broad root styles.
6. Build real list/record representative templates using current Contacts/Tasks-compatible fake read fixtures, loading/retry/empty/no-match/denied/stale modes and role/capability wrappers. Components accept rows/contracts; never own their own SQL or derive authoritative totals from a current page. Use server page/cursor50 default only if supported; expose unavailable total when endpoint lacks it.
7. Add available named Mine/Team/Unassigned preset views with URL persistence and approved role scope; do not advertise cross-device saved custom views without existing persistence authority. Reuse existing global search/AI/help rather than add duplicated fetchers. Inactive panel unmount/disabled query and request cancellation are shared primitives.
8. Wire representative production CRM template and compatibility adapter under current existing route ownership without final menu cutover. Verify actual rendering/access/URL contract and snapshot screenshots of current source and proposed result; do not replace real data with permanent mock data.
9. Run token/computed font/contrast/target/focus/zoom/responsive/portal/public route regression and pure route alias role tests. Handoff registry/primitives/props/query ownership and exact adopted components to C2–C5; update canonical documents. Leave current workspace surface functional and legacy links safe.

### D. Required C1 rg checks — before and after

```bash
rg -n 'Legacy|Redirect|path=|allowedRoles|role ===' client/src/App.tsx
rg -n 'font-sans|font-serif|font-body|--font-sans|--font-serif|--font-body|--font-display' client/src/index.css tailwind.config.ts client/src/components
rg -n 'maximum-scale|IBM.Plex|fonts.googleapis' client/index.html
rg -n 'h-14|--sidebar-width|h-8|max-w-7xl|p-3' client/src/pages/DashboardLayout.tsx
rg -n 'financialTab|tab|view|stagingTab|VALID_TABS|activeTab' client/src/pages/dashboard/FinancialHub.tsx client/src/pages/dashboard/ContactDetail.tsx client/src/pages/dashboard/LeadOpsCenter.tsx client/src/pages/dashboard/OperatorDashboard.tsx
rg -n 'crm-theme|CrmPageHeader|ScopedMetricStrip|WorklistToolbar|CrmDataState|crm-destinations' client/src
rg -n 'useQuery|refetchInterval|enabled|forceMount|limit=5000' client/src/pages/dashboard
git diff --check
```

These grep commands are discovery checks, not functional certification. New component/registry zero matches are expected at initial C1 baseline. Review actual changed symbols and requests.

### E. Task C1 gate matrix

| Gate | Exact pass condition |
| --- | --- |
| Registry completeness | 147 current dashboard patterns + all discovered dynamic/state/mobile entries receive explicit owner; historical 309 referenced, additions retained. No unresolved route deletion. |
| Adapters | Every alias has actual target + role/ID/query tests; financial/operator/contact translations and invalid/duplicate tabs; query input never causes write. |
| Visual foundation | Exact computed tokens/fonts/spacing/radii/shadows/44px/focus/portal behavior in supported production build; light/dark/screens/zoom and Stage 2 isolation. |
| Functional template | Actual mounted worklist states, selection/search/paging/retry/record link; intended handler contracts; no mock persistence claimed. |
| Performance | Inactive panels do not mount/poll, stale requests cannot overwrite current view; measured baseline/after budget. |
| Handoff | C2–C5 inherit same components/registry, no premature sidebar cutover; stock CI/evidence/canonical updates. |

### F. Task C1 completion contract

Deliver functioning owned surfaces, actual route/action/role/state receipts and supported build/CI, exact visual/computed-style evidence and rollback. No global/sidebar/native/live closure beyond this task. Include remaining individual A/B/C/D/Stage 4–9 obligations and original IDs; no composite all 95 closure from a screenshot or merge. Final output must distinguish code-complete from unverified live.

### G. Authenticated live reconciliation — October 4, 2026

This authenticated addendum supersedes the expired-login/source-only limitation in the earlier authoring receipt. Reviewed main remains **d99ecff73aff8b1cb92e90132c9cbe6cdecc4077**; serving remains **42309395870515b0a575e85f6c753a65da408c2a**. Source and serving are not equivalent. All 27 normal admin sidebar destinations were opened, with additional direct routes and primary tabs; 151 recorded observations cover 33 distinct URL pathnames. This is one real admin desktop session at 1363×936 in light mode. Every tab selection, skeleton and modal-open result is qualified separately from a durable action.

Evidence: `LIBERTY_STAGE3_C1_C5_LIVE_RECONCILIATION_2026-10-04.md`, `liberty-stage3-live-ui-evidence-2026-10-04.json`, `c-live-source-anchor-receipt.json`, and `liberty-stage3-queue-holds-live.jpg`. CL IDs are receipt rows inside the existing parent/repair register; do not add them to the 95 source claims as new disjoint issues. Existing 14 groups/eight tasks and all original IDs remain. Outbound remains PAUSED; incoming GHL remains ENABLED. No production save/apply/send/enroll/provider execution or settings toggle was submitted in this walkthrough.

- CL01 and CL02 are now reproduced live. The registry must translate Financial aliases to the correct child selector and retain Operator parent `tab=monitor`; use real current parent/child components in compatibility tests. Do not claim normalization works from string-only assertions.
- CL11 is reproduced in live metadata. Remove `maximum-scale=1`; verify actual zoom/reflow at build.
- CL20 confirms compiled Liberty/Plex branding. Measured light baseline: `--background:40 33% 98%`, `--foreground/--primary:222 47% 11%`, `--accent:221 78% 48%`, `--brand-red:0 72% 47%`, `--border:214.3 31.8% 91.4%`, radius `.5rem`. Actual heading 18/28 weight600, main16/24 weight400, tab14/20 weight500 height32. Empty root `--font-sans` and root `--sidebar-width` are not proof of broken computed font/local sidebar values.
- Build targets remain title24/32, section18/24, body14/20, label12/16, metric28/32, spacing4/8/12/16/24/32, 44px interactive targets, card16 and section24. These are new scoped CRM requirements. Keep existing public marketing styles, portaled controls and dark-token contracts.
- C1 delivers usable shared components and representative existing-record/worklist screens, but leaves global menu cutover to C5 after C2–C4 are functional. Refresh route inventories at build; do not freeze this audit SHA.

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
| CRM3-09; CRM3-10 / R05 | Shared URL contracts only; C5 operator and C4 report actual surfaces own final repair. |
| CRM3-21, CRM3-24, CRM3-26 / R08 | Common navigation/record/data-state primitives; C2–C5 owned slices retain final functional proof. |
| CRM3-22 / R13 | Shared lazy/paging/error/performance contract; page consumers each measured separately. |
| REF-004 / R05 | Front-end route inventory support; C5 API permission diagnostic implementation. |
| REF-058 / R05 | Blanket functional claim disproved historically; registry/template tests do not certify every action. |
| REF-031, REF-043, REF-044, REF-048, REF-053, REF-056 / R08 | Route/discovery/shared-layout slice only; contextual/merchant/workflow consumers separately owned. |


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

### Exact assigned route register — 147 current dashboard patterns

Current-source entry/role data and proposed disposition are separate columns. The original R IDs retain historical identities; R-147 is the newly discovered canonical route. C1 owns registry/adapters for all 147; each surface has exactly one C2–C5 delivery owner. Dedicated /mobile and public routes are additional boundary/regression tests, not counted in147.

| ID | Current pattern | Current source entry | Surface owner / group | Required canonical target or retained entry | Disposition / guard contract |
| --- | --- | --- | --- | --- | --- |
| R-001 | /dashboard/partner | App.tsx:484; PartnerPortal | C4 / Merchant Operations / portal boundary | /dashboard/partner | KEEP separate identity/access boundary; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
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
| R-013 | /dashboard/onboarding | App.tsx:574; OnboardingHub | C4 / Merchant Operations | /dashboard/onboarding | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-014 | /dashboard/tickets | App.tsx:577; alias/wrapper | C4 / Merchant Operations | /dashboard/support-hub?tab=tickets | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-015 | /dashboard/tasks | App.tsx:580; alias/wrapper | C2 / Work / header notifications | /dashboard/tasks-appointments?tab=tasks | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-016 | /dashboard/notifications | App.tsx:583; Notifications | C2 / Work / header notifications | /dashboard/notifications | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-017 | /dashboard/call-outcome | App.tsx:586; CallOutcome | C2 / Record contextual tool | /dashboard/call-outcome | CONTEXTUAL action; keep standalone safe fallback; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-018 | /dashboard/review-complete | App.tsx:589; ReviewComplete | C2 / Record contextual tool | /dashboard/review-complete | CONTEXTUAL action; keep standalone safe fallback; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-019 | /dashboard/review-requests | App.tsx:592; alias/wrapper | C4 / Merchant Operations | /dashboard/merchant-success?tab=reviews | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-020 | /dashboard/testimonial-submissions | App.tsx:595; alias/wrapper | C4 / Merchant Operations | /dashboard/merchant-success?tab=testimonials | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-021 | /dashboard/onboarding-kickoff | App.tsx:598; OnboardingKickoff | C4 / Merchant Operations | /dashboard/onboarding-kickoff | CONTEXTUAL action; keep standalone safe fallback; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-022 | /dashboard/workflows | App.tsx:601; Workflows | C5 / Administration / operational controls | /dashboard/workflows | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-023 | /dashboard/rfis | App.tsx:604; alias/wrapper | C4 / Merchant Operations | /dashboard/support-hub?tab=rfis | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-024 | /dashboard/review-queue | App.tsx:607; alias/wrapper | C4 / Merchant Operations | /dashboard/support-hub?tab=review-queue | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-025 | /dashboard/case-study-intake | App.tsx:610; CaseStudyIntake | C5 / Resources / privileged acquisition tools | /dashboard/case-study-intake | CONTEXTUAL action; keep standalone safe fallback; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-026 | /dashboard/ghl-settings | App.tsx:613; alias/wrapper | C5 / Administration / operational controls | /dashboard/ghl-integration?tab=settings | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-027 | /dashboard/ghl-workflows | App.tsx:616; alias/wrapper | C5 / Administration / operational controls | /dashboard/ghl-integration?tab=workflow-ids | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-028 | /dashboard/automation | App.tsx:619; Automation | C5 / Administration / operational controls | /dashboard/automation | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-029 | /dashboard/contacts-leads | App.tsx:623; ContactsAndLeads | C2 / Records | /dashboard/contacts-leads | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-030 | /dashboard/tasks-appointments | App.tsx:626; TasksAppointments | C2 / Work / header notifications | /dashboard/tasks-appointments | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-031 | /dashboard/outbound-center | App.tsx:629; OutboundCenter | C3 / Campaigns | /dashboard/outbound-center | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-147 | /dashboard/canonical-enrichment | App.tsx:632; CanonicalEnrichment | C3 / Prospecting | /dashboard/lead-ops?tab=canonical&canonicalView=pipeline | KEEP owner; group within Prospecting; preserve independent read DTO; ["admin", "manager"] |
| R-032 | /dashboard/prospects | App.tsx:636; LegacyProspectsRedirect | C3 / Prospecting | /dashboard/lead-ops?tab=prospects | LEGACY role-aware wrapper / redirect; ["admin", "manager"] |
| R-033 | /dashboard/prospects/import | App.tsx:639; ProspectImport | C3 / Prospecting | /dashboard/lead-ops?tab=imports; keep thin import wizard wrapper until parity verified | MERGE presentation; preserve compatibility / scope; ["admin", "manager"] |
| R-034 | /dashboard/lead-imports | App.tsx:642; LegacyLeadImportsRedirect | C3 / Prospecting | /dashboard/lead-ops?tab=imports | LEGACY role-aware wrapper / redirect; ["admin", "manager"] |
| R-035 | /dashboard/master-lead-database | App.tsx:645; LegacyMasterLeadDatabaseRedirect | C3 / Prospecting | /dashboard/lead-ops?tab=staging&stagingTab=master-leads | LEGACY role-aware wrapper / redirect; ["admin"] |
| R-036 | /dashboard/campaigns | App.tsx:648; alias/wrapper | C3 / Campaigns | /dashboard/outbound-center?tab=campaigns | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-037 | /dashboard/outreach-analytics | App.tsx:651; alias/wrapper | C4 / Reports | /dashboard/reporting?tab=outreach-analytics | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-038 | /dashboard/reporting | App.tsx:654; ReportingHub | C4 / Reports | /dashboard/reporting | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-039 | /dashboard/acquisition-hub | App.tsx:657; alias/wrapper | C5 / Resources / privileged acquisition tools | /dashboard/outbound-center?tab=analytics | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-040 | /dashboard/win-loss | App.tsx:660; alias/wrapper | C4 / Reports | /dashboard/reporting?tab=win-loss | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-041 | /dashboard/stage-rules | App.tsx:663; StageRules | C2 / Pipeline | /dashboard/stage-rules | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-042 | /dashboard/sequences | App.tsx:666; alias/wrapper | C3 / Campaigns | /dashboard/outbound-center?tab=sequences | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-043 | /dashboard/lead-gen | App.tsx:669; LeadGenCleaner | C3 / Prospecting | /dashboard/lead-gen | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-044 | /dashboard/lead-intelligence | App.tsx:672; LegacyLeadIntelligenceRedirect | C3 / Prospecting | /dashboard/lead-ops?tab=intelligence (admin/manager); retain scoped legacy component for other roles | LEGACY role-aware wrapper / redirect; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-045 | /dashboard/statement-review | App.tsx:675; StatementReview | C4 / Merchant Operations | /dashboard/statement-review | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-046 | /dashboard/outreach | App.tsx:678; alias/wrapper | C5 / Administration / operational controls | /dashboard/outbound-center?tab=command | MERGE presentation; preserve compatibility / scope; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-047 | /dashboard/outreach-command | App.tsx:681; alias/wrapper | C3 / Campaigns | /dashboard/outbound-center?tab=command | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-048 | /dashboard/lead-engine | App.tsx:684; LegacyLeadIntelligenceRedirect | C3 / Prospecting | /dashboard/lead-ops?tab=intelligence (admin/manager); retain scoped legacy component for other roles | LEGACY role-aware wrapper / redirect; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-049 | /dashboard/lead-command-center | App.tsx:690; LegacyLeadCommandCenterRedirect | C3 / Prospecting | /dashboard/lead-ops (admin/manager); retain scoped legacy component for other roles | LEGACY role-aware wrapper / redirect; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-050 | /dashboard/blaze | App.tsx:693; alias/wrapper | C5 / Resources / privileged acquisition tools | /dashboard/content-hub?tab=blaze | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-051 | /dashboard/merchant-applications | App.tsx:696; MerchantApplicationsList | C4 / Merchant Operations | /dashboard/merchant-applications | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-052 | /dashboard/boarding | App.tsx:699; BoardingTracker | C4 / Merchant Operations | /dashboard/boarding | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-053 | /dashboard/onboarding-board | App.tsx:702; alias/wrapper | C4 / Merchant Operations | /dashboard/onboarding?tab=board | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-054 | /dashboard/merchant-portal | App.tsx:705; MerchantPortal | C4 / Merchant Operations / portal boundary | /dashboard/merchant-portal | KEEP separate identity/access boundary; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-055 | /dashboard/merchant-health | App.tsx:708; alias/wrapper | C4 / Merchant Operations | /dashboard/merchant-risk?tab=health | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-056 | /dashboard/chargebacks | App.tsx:711; alias/wrapper | C4 / Merchant Operations | /dashboard/merchant-risk?tab=chargebacks | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-057 | /dashboard/nps | App.tsx:714; alias/wrapper | C4 / Merchant Operations | /dashboard/merchant-success?tab=nps | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-058 | /dashboard/retention-campaigns | App.tsx:717; alias/wrapper | C4 / Merchant Operations | /dashboard/merchant-success?tab=retention | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-059 | /dashboard/agent-management | App.tsx:720; AgentManagement | C5 / Administration / operational controls | /dashboard/agent-management | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-060 | /dashboard/my-earnings | App.tsx:723; MyEarnings | C4 / Reports | /dashboard/my-earnings | KEEP owner; grouped/local navigation; ["agent"] |
| R-061 | /dashboard/residual-revenue | App.tsx:726; alias/wrapper | C4 / Reports | /dashboard/reporting?tab=financial&financialTab=revenue | MERGE presentation; preserve compatibility / scope; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-062 | /dashboard/referral-program | App.tsx:729; ReferralProgram | C4 / Merchant Operations | /dashboard/referral-program | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-063 | /dashboard/partner-referral-pipeline | App.tsx:732; PartnerReferralPipeline | C4 / Merchant Operations / partner administration | /dashboard/partner-referral-pipeline | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-064 | /dashboard/partner-portal | App.tsx:735; PartnerPortalAdmin | C4 / Merchant Operations / partner administration | /dashboard/partner-portal | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-065 | /dashboard/partner-orgs | App.tsx:738; PartnerOrgs | C4 / Merchant Operations / partner administration | /dashboard/partner-orgs | KEEP owner; grouped/local navigation; ["admin"] |
| R-066 | /dashboard/co-branded-proposals | App.tsx:741; CoBrandedProposals | C4 / Merchant Operations | /dashboard/co-branded-proposals | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-067 | /dashboard/knowledge-base | App.tsx:744; KnowledgeBase | C5 / Resources | /dashboard/knowledge-base | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-068 | /dashboard/knowledge-admin | App.tsx:747; KnowledgeAdmin | C5 / Resources | /dashboard/knowledge-admin | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-069 | /dashboard/consent-audit | App.tsx:750; alias/wrapper | C5 / Administration / operational controls | /dashboard/admin-hub?tab=consent | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-070 | /dashboard/calendar | App.tsx:753; alias/wrapper | C2 / Work / header notifications | /dashboard/tasks-appointments?tab=calendar | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-071 | /dashboard/user-management | App.tsx:756; alias/wrapper | C5 / Administration / operational controls | /dashboard/admin-hub?tab=users | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-072 | /dashboard/permissions | App.tsx:759; alias/wrapper | C5 / Administration / operational controls | /dashboard/admin-hub?tab=permissions | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-073 | /dashboard/security | App.tsx:762; SecuritySettings | C5 / Administration / operational controls | /dashboard/security | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-074 | /dashboard/settings/integrations | App.tsx:765; SettingsIntegrations | C5 / Administration / operational controls | /dashboard/settings/integrations | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-075 | /dashboard/settings/arbitration | App.tsx:768; ArbitrationLog | C5 / Administration / operational controls | /dashboard/settings/arbitration | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-076 | /dashboard/forecasting | App.tsx:771; alias/wrapper | C4 / Reports | /dashboard/reporting?tab=financial&financialTab=forecasting | REPAIR query contract; compatibility retained; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-077 | /dashboard/pci-assessment | App.tsx:774; alias/wrapper | C5 / Administration / operational controls | /dashboard/admin-hub?tab=pci | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-078 | /dashboard/data-requests | App.tsx:777; DataRequests | C5 / Administration / operational controls | /dashboard/data-requests | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-079 | /dashboard/audit-logs | App.tsx:780; alias/wrapper | C5 / Administration / operational controls | /dashboard/admin-hub?tab=audit-log | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-080 | /dashboard/blog-generator | App.tsx:783; alias/wrapper | C5 / Resources / privileged acquisition tools | /dashboard/content-hub?tab=blog | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-081 | /dashboard/content | App.tsx:786; alias/wrapper | C5 / Resources / privileged acquisition tools | /dashboard/content-hub?tab=content | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-082 | /dashboard/social | App.tsx:789; alias/wrapper | C5 / Resources / privileged acquisition tools | /dashboard/content-hub?tab=linkedin | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-083 | /dashboard/sdr | App.tsx:792; alias/wrapper | C5 / Administration / operational controls | /dashboard/sdr-hub?tab=sdr | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-084 | /dashboard/sms-inbox | App.tsx:795; alias/wrapper | C2 / Inbox | /dashboard/comms-hub?tab=messages | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-085 | /dashboard/bin-lookup | App.tsx:798; BinLookup | C2 / Record contextual tool | /dashboard/bin-lookup | CONTEXTUAL action; keep standalone safe fallback; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-086 | /dashboard/round-robin | App.tsx:801; RoundRobinAdmin | C5 / Administration / operational controls | /dashboard/round-robin | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-087 | /dashboard/inbox-health | App.tsx:804; alias/wrapper | C5 / Administration / operational controls | /dashboard/deliverability-hub?tab=inbox-health | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-088 | /dashboard/email-health | App.tsx:807; alias/wrapper | C5 / Administration / operational controls | /dashboard/deliverability-hub?tab=email-health | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-089 | /dashboard/activation | App.tsx:810; ActivationPanel | C5 / Administration / operational controls | /dashboard/activation | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-090 | /dashboard/setup-wizard | App.tsx:813; SetupWizard | C5 / Administration / operational controls | /dashboard/setup-wizard | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-091 | /dashboard/operator | App.tsx:816; alias/wrapper | C5 / Administration / operational controls | /dashboard/system-health?tab=monitor; preserve view and compatible filters | REPAIR query contract; compatibility retained; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-092 | /dashboard/seo-health | App.tsx:819; alias/wrapper | C5 / Administration / operational controls | /dashboard/system-health?tab=seo | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-093 | /dashboard/system-readiness | App.tsx:822; alias/wrapper | C5 / Administration / operational controls | /dashboard/system-health?tab=readiness | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-094 | /dashboard/training | App.tsx:825; Training | C5 / Resources | /dashboard/training | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-095 | /dashboard/leaderboard | App.tsx:828; Leaderboard | C4 / Reports | /dashboard/leaderboard | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-096 | /dashboard/terminal-roi | App.tsx:831; alias/wrapper | C4 / Reports | /dashboard/reporting?tab=financial&financialTab=terminal-roi | REPAIR query contract; compatibility retained; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-097 | /dashboard/my-day | App.tsx:834; SalesRepHome | C2 / Today / contextual AI | /dashboard/my-day | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-098 | /dashboard/live-chat | App.tsx:837; alias/wrapper | C2 / Inbox | /dashboard/comms-hub?tab=live-chat | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-099 | /dashboard/document-vault | App.tsx:840; DocumentVault | C4 / Merchant Operations | /dashboard/document-vault | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-100 | /dashboard/virtual-terminal | App.tsx:843; alias/wrapper | C5 / Administration / operational controls | /dashboard with explicit retired/unavailable notice; no operational payment UI | MERGE presentation; preserve compatibility / scope; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-101 | /dashboard/ghl-sequence-guide | App.tsx:846; alias/wrapper | C5 / Administration / operational controls | /dashboard/ghl-integration?tab=sequence-guide | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-102 | /dashboard/marketing-playbook | App.tsx:849; alias/wrapper | C5 / Resources | /dashboard/playbooks?tab=marketing | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-103 | /dashboard/growth-playbook | App.tsx:852; alias/wrapper | C5 / Resources | /dashboard/playbooks?tab=growth | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-104 | /dashboard/growth-kpi | App.tsx:855; alias/wrapper | C4 / Reports | /dashboard/reporting?tab=growth | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-105 | /dashboard/widget-generator | App.tsx:858; WidgetGenerator | C5 / Resources / privileged acquisition tools | /dashboard/widget-generator | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-106 | /dashboard/cold-leads | App.tsx:864; alias/wrapper | C3 / Campaigns | /dashboard/outbound-center?tab=prospects | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-107 | /dashboard/underwriting | App.tsx:868; UnderwritingPage | C5 / Administration / operational controls | /dashboard/underwriting | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-108 | /dashboard/conversation-ai | App.tsx:872; alias/wrapper | C5 / Administration / operational controls | /dashboard/sdr-hub?tab=chatbot | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-109 | /dashboard/outreach-hub | App.tsx:878; alias/wrapper | C5 / Administration / operational controls | /dashboard/outbound-center | MERGE presentation; preserve compatibility / scope; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-110 | /dashboard/ghl-integration | App.tsx:881; GhlIntegrationHub | C5 / Administration / operational controls | /dashboard/ghl-integration | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-111 | /dashboard/playbooks | App.tsx:884; PlaybooksHub | C5 / Resources | /dashboard/playbooks | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-112 | /dashboard/content-hub | App.tsx:887; ContentHub | C5 / Resources / privileged acquisition tools | /dashboard/content-hub | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-113 | /dashboard/merchant-success | App.tsx:890; MerchantSuccessHub | C4 / Merchant Operations | /dashboard/merchant-success | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-114 | /dashboard/portfolio | App.tsx:893; MerchantPortfolio | C4 / Merchant Operations | /dashboard/portfolio | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-115 | /dashboard/support-hub | App.tsx:896; SupportHub | C4 / Merchant Operations | /dashboard/support-hub | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-116 | /dashboard/comms-hub | App.tsx:899; CommsHub | C2 / Inbox | /dashboard/comms-hub | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-117 | /dashboard/sdr-hub | App.tsx:902; SDRHub | C5 / Administration / operational controls | /dashboard/sdr-hub | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-118 | /dashboard/deliverability-hub | App.tsx:905; DeliverabilityHub | C5 / Administration / operational controls | /dashboard/deliverability-hub | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-119 | /dashboard/financial-hub | App.tsx:908; FinancialHub | C4 / Reports | /dashboard/reporting?tab=financial&financialTab=<validated legacy selection> | REPAIR query contract; compatibility retained; ["admin", "manager"] |
| R-120 | /dashboard/system-health | App.tsx:911; SystemHealthHub | C5 / Administration / operational controls | /dashboard/system-health | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-121 | /dashboard/admin-hub | App.tsx:914; AdminHub | C5 / Administration / operational controls | /dashboard/admin-hub | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-122 | /dashboard/automation-registry | App.tsx:917; AutomationRegistry | C5 / Administration / operational controls | /dashboard/automation-registry | KEEP owner; grouped/local navigation; ["admin"] |
| R-123 | /dashboard/nba | App.tsx:920; NbaPriorityPage | C2 / Today / contextual AI | /dashboard/nba | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-124 | /dashboard/merchant-risk | App.tsx:923; MerchantRiskHub | C4 / Merchant Operations | /dashboard/merchant-risk | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-125 | /dashboard/launch-readiness | App.tsx:926; LaunchReadiness | C5 / Administration / operational controls | /dashboard/launch-readiness | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-126 | /dashboard/outbound-readiness | App.tsx:929; OutboundReadiness | C5 / Administration / operational controls | /dashboard/outbound-readiness | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-127 | /dashboard/outbound-preflight | App.tsx:932; OutboundPreflight | C5 / Administration / operational controls | /dashboard/outbound-preflight | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-128 | /dashboard/data-health | App.tsx:935; DataHealth | C5 / Administration / operational controls | /dashboard/data-health | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-129 | /dashboard/data-quality | App.tsx:938; LegacyDataQualityRedirect | C3 / Prospecting | /dashboard/lead-ops?tab=quality | LEGACY role-aware wrapper / redirect; ["admin", "manager"] |
| R-130 | /dashboard/blocked-contacts | App.tsx:941; BlockedContacts | C5 / Administration / operational controls | /dashboard/blocked-contacts | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-131 | /dashboard/deliverability-settings | App.tsx:944; DeliverabilitySettings | C5 / Administration / operational controls | /dashboard/deliverability-settings | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-132 | /dashboard/ghl-conflicts | App.tsx:947; GhlConflicts | C5 / Administration / operational controls | /dashboard/ghl-conflicts | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-133 | /dashboard/information-flow | App.tsx:950; alias/wrapper | C5 / Administration / operational controls | /dashboard/admin-hub?tab=info-flow | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-134 | /dashboard/contact-census | App.tsx:953; ContactCensus | C3 / Prospecting | /dashboard/contact-census | KEEP owner; grouped/local navigation; ["admin"] |
| R-135 | /dashboard/system-audit | App.tsx:956; SystemAudit | C5 / Administration / operational controls | /dashboard/system-audit | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-136 | /dashboard/queue-holds | App.tsx:959; QueueHoldsPage | C5 / Administration / operational controls | /dashboard/queue-holds | KEEP owner; grouped/local navigation; ["admin"] |
| R-137 | /dashboard/lead-ops/business/:id | App.tsx:962; BusinessDetailPage | C3 / Prospecting | /dashboard/lead-ops/business/:id | KEEP entity namespace + verified contextual links; ["admin", "manager"] |
| R-138 | /dashboard/lead-ops | App.tsx:965; LeadOpsCenter | C3 / Prospecting | /dashboard/lead-ops | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-139 | /dashboard/identity-crosswalk | App.tsx:968; IdentityCrosswalk | C3 / Prospecting | /dashboard/identity-crosswalk | KEEP owner; grouped/local navigation; ["admin"] |
| R-140 | /dashboard/outreach-queue | App.tsx:971; OutreachQueue | C3 / Prospecting | /dashboard/outreach-queue | KEEP owner; grouped/local navigation; ["admin", "manager", "agent"] |
| R-141 | /dashboard/executive | App.tsx:974; ExecutiveDashboard | C4 / Reports | /dashboard/executive | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-142 | /dashboard/sequence-report | App.tsx:977; SequenceReport | C3 / Campaigns | /dashboard/sequence-report (Reports / Outreach contextual entry) | MERGE presentation; preserve compatibility / scope; ["admin", "manager"] |
| R-143 | /dashboard/ghl-workflow-ids | App.tsx:981; alias/wrapper | C5 / Administration / operational controls | /dashboard/ghl-integration?tab=workflow-ids | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-144 | /dashboard/social-composer | App.tsx:984; alias/wrapper | C5 / Resources / privileged acquisition tools | /dashboard/content-hub?tab=linkedin | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-145 | /dashboard/blaze-integration | App.tsx:987; alias/wrapper | C5 / Resources / privileged acquisition tools | /dashboard/content-hub?tab=blaze | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-146 | /dashboard/forbidden | App.tsx:991; alias/wrapper | C5 / Scoped mobile / access boundary | /dashboard/forbidden | KEEP separate identity/access boundary; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |

### Original audit panel reconciliation — 309 reference entries

These are the original309 observation rows assigned to a delivery owner, not a fresh unique panel/action count. Historical example IDs (including159443) are references, not permission to mutate production. Substitute owned disposable fixtures with recorded lineage for behavior tests. Current source changes/additions (notably canonical5 views) must be appended and tested separately; none of these reference rows is automatically verified from prior observation.

| Original ID | Historical URL | Retained control/panel | Required workspace placement | Implementation owner / evidence limit |
| --- | --- | --- | --- | --- |
| T-001 | /dashboard/outbound-center?tab=campaigns | Campaigns / tab | Campaigns → Manage | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-002 | /dashboard/outbound-center?tab=sequences | Sequences / tab | Campaigns → Manage | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-003 | /dashboard/outbound-center?tab=governance | Governance / tab | Campaigns → Delivery | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-004 | /dashboard/outbound-center?tab=prospects | Re-engagement / tab | Campaigns → Audience | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-005 | /dashboard/outbound-center?tab=analytics | Analytics / tab | Campaigns → Results | C3; historical observation, actions UNVERIFIED unless new receipt |
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
| T-027 | /dashboard/lead-ops | Businesses / hub-tab | Prospecting → Inventory | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-028 | /dashboard/lead-ops?tab=prospects | Source Prospects / hub-tab | Prospecting → Sources & Imports | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-029 | /dashboard/lead-ops?tab=imports | Imports / hub-tab | Prospecting → Sources & Imports | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-030 | /dashboard/lead-ops?tab=staging | Staging & Promotion / hub-tab | Prospecting → Qualification & Staging | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-031 | /dashboard/lead-ops?tab=sources | Sources / hub-tab | Prospecting → Sources & Imports | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-032 | /dashboard/lead-ops?tab=census | Census / hub-tab | Prospecting → Sources & Imports | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-033 | /dashboard/lead-ops?tab=intelligence | Intelligence / hub-tab | Prospecting → Enrichment | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-034 | /dashboard/lead-ops?tab=quality | Data Quality / hub-tab | Prospecting → Qualification & Staging | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-035 | /dashboard/lead-ops?tab=pipeline | Inbound Operations / hub-tab | Prospecting → Qualification & Staging | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-036 | /dashboard/lead-ops?tab=sfp | South Florida Prospecting / hub-tab | Prospecting → Qualification & Staging | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-037 | /dashboard/lead-ops?tab=provider-results | Provider Results / hub-tab | Prospecting → Enrichment | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-038 | /dashboard/lead-ops?tab=pilot | 🧪 Paid Pilot (Legacy) / hub-tab | Prospecting → Program Health / Legacy | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-039 | /dashboard/lead-ops?tab=health | Enrichment Program Health / hub-tab | Prospecting → Program Health | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-040 | /dashboard/admin-hub | User Management / hub-tab | Administration → Users & Access | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-041 | /dashboard/admin-hub?tab=permissions | Permissions / hub-tab | Administration → Users & Access | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-042 | /dashboard/admin-hub?tab=audit-log | Audit Log / hub-tab | Administration → Data & Audit | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-043 | /dashboard/admin-hub?tab=consent | Consent Audit / hub-tab | Administration → Data & Audit | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-044 | /dashboard/admin-hub?tab=pci | PCI Assessment / hub-tab | Administration → Release Readiness | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-045 | /dashboard/admin-hub?tab=agents | Agent Management / hub-tab | Administration → Users & Access | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-046 | /dashboard/admin-hub?tab=integrations | Integrations / hub-tab | Administration → Integrations | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-047 | /dashboard/admin-hub?tab=ghl | GHL Integration / hub-tab | Administration → Integrations | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-048 | /dashboard/admin-hub?tab=info-flow | Information Flow / hub-tab | Administration → Integrations | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-049 | /dashboard/admin-hub?tab=gate-result | Deploy Gate / hub-tab | Administration → Release Readiness | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-050 | /dashboard/admin-hub?tab=automations | Automations / hub-tab | Administration → Operational Controls | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-051 | /dashboard/reporting | Overview / hub-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-052 | /dashboard/reporting?tab=growth | Growth Metrics / hub-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-053 | /dashboard/reporting?tab=win-loss | Win/Loss / hub-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-054 | /dashboard/reporting?tab=outreach-analytics | Outreach Analytics / hub-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-055 | /dashboard/reporting?tab=operations | Operations Report / hub-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-056 | /dashboard/reporting?tab=financial | Financial / hub-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-057 | /dashboard/system-health?tab=monitor | System Monitor / hub-tab | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-058 | /dashboard/system-health?tab=readiness | System Readiness / hub-tab | Administration → Release & Incidents | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-059 | /dashboard/system-health?tab=seo | SEO Health / hub-tab | Administration → Release & Incidents | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-060 | /dashboard/system-health?tab=incidents | Incidents & DLQ / hub-tab | Administration → Release & Incidents | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-061 | /dashboard/contacts-leads | People / hub-tab | Records → retained nested section | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-062 | /dashboard/contacts-leads?tab=leads | Leads / hub-tab | Records → retained nested section | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-063 | /dashboard/tasks-appointments | Tasks / hub-tab | Work / header notifications → retained nested section | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-064 | /dashboard/tasks-appointments?tab=calendar | Appointments / hub-tab | Work / header notifications → retained nested section | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-065 | /dashboard/onboarding | Onboarding / hub-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-066 | /dashboard/onboarding?tab=board | Board / hub-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-067 | /dashboard/merchant-risk | Chargebacks / hub-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-068 | /dashboard/merchant-risk?tab=health | Merchant Health / hub-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-069 | /dashboard/support-hub | Tickets / hub-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-070 | /dashboard/support-hub?tab=rfis | RFIs / hub-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-071 | /dashboard/support-hub?tab=review-queue | Review Queue / hub-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-072 | /dashboard/merchant-success | Review Requests / hub-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-073 | /dashboard/merchant-success?tab=testimonials | Testimonials / hub-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-074 | /dashboard/merchant-success?tab=nps | NPS / CSAT / hub-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-075 | /dashboard/merchant-success?tab=retention | Retention Campaigns / hub-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-076 | /dashboard/ghl-integration | Settings / hub-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-077 | /dashboard/ghl-integration?tab=workflow-ids | Workflow IDs / hub-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-078 | /dashboard/ghl-integration?tab=sequence-guide | Sequence Guide / hub-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-079 | /dashboard/financial-hub | Revenue Dashboard / hub-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-080 | /dashboard/reporting?tab=financial&financialTab=forecasting | Forecasting / hub-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-081 | /dashboard/reporting?tab=financial&financialTab=terminal-roi | Terminal ROI / tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-082 | /dashboard/deliverability-hub | Email Health / hub-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-083 | /dashboard/deliverability-hub?tab=inbox-health | Inbox Health / hub-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-084 | /dashboard/content-hub | Content Engine / hub-tab | Resources / privileged acquisition tools → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-085 | /dashboard/content-hub?tab=blog | Blog Generator / hub-tab | Resources / privileged acquisition tools → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-086 | /dashboard/content-hub?tab=linkedin | LinkedIn / hub-tab | Resources / privileged acquisition tools → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-087 | /dashboard/content-hub?tab=blaze | Blaze.ai / hub-tab | Resources / privileged acquisition tools → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-088 | /dashboard/sdr-hub | AI SDR / hub-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-089 | /dashboard/sdr-hub?tab=chatbot | Chat Bot Settings / hub-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-090 | /dashboard/settings/integrations | GHL Workflow IDs / hub-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-091 | /dashboard/settings/integrations | Sending Identities / hub-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-092 | /dashboard/settings/integrations | Processor Adapters / hub-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-093 | /dashboard/settings/integrations | LinkedIn Enrichment / hub-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-094 | /dashboard/settings/integrations | ZeroBounce / hub-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-095 | /dashboard/agent-management | Team Members / hub-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-096 | /dashboard/agent-management | Rep Metrics / hub-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-097 | /dashboard/agent-management | Residual Calculator / hub-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-098 | /dashboard/agent-management | Comp Model / hub-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-099 | /dashboard/ghl-integration?tab=workflow-ids | Workflow ID Manager / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-100 | /dashboard/ghl-integration?tab=workflow-ids | AI Workflow Prompts / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-101 | /dashboard/ghl-integration?tab=workflow-ids | Cadence Blueprints / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-102 | /dashboard/ghl-integration?tab=workflow-ids | Cadence Timeline / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-103 | /dashboard/ghl-integration?tab=sequence-guide | WF1 — Inbound / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-104 | /dashboard/ghl-integration?tab=sequence-guide | WF2 — Cold Outbound / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-105 | /dashboard/ghl-integration?tab=sequence-guide | WF3 — Reply Engaged / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-106 | /dashboard/ghl-integration?tab=sequence-guide | WF4 — Statement Chase / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-107 | /dashboard/ghl-integration?tab=sequence-guide | WF5 — Proposal / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-108 | /dashboard/ghl-integration?tab=sequence-guide | WF6 — Onboarding / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-109 | /dashboard/ghl-integration?tab=sequence-guide | WF7 — Go-Live / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-110 | /dashboard/ghl-integration?tab=sequence-guide | WF8 — Retention / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-111 | /dashboard/ghl-integration?tab=sequence-guide | WF9 — Win-Back / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-112 | /dashboard/ghl-integration?tab=sequence-guide | Re-engagement / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-113 | /dashboard/ghl-integration?tab=sequence-guide | Tag Reference / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-114 | /dashboard/ghl-integration?tab=sequence-guide | Global Setup / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-115 | /dashboard/ghl-integration?tab=sequence-guide | GHL Admin Setup / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-116 | /dashboard/ghl-integration?tab=sequence-guide | 📧 Email Library / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-117 | /dashboard/ghl-integration?tab=sequence-guide | 📋 Manual Sequences / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-118 | /dashboard/ghl-integration?tab=sequence-guide | 🔁 Multi-Touch Map / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-119 | /dashboard/ghl-integration?tab=sequence-guide | 🤖 AI Employee / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-120 | /dashboard/ghl-integration?tab=sequence-guide | ✍️ Signatures / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-121 | /dashboard/ghl-integration?tab=sequence-guide | 🛡️ Workflow Guard / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-122 | /dashboard/reporting?tab=financial | Revenue Dashboard / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-123 | /dashboard/reporting?tab=financial&financialTab=forecasting | Forecasting / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-124 | /dashboard/reporting?tab=financial&financialTab=terminal-roi | Terminal ROI / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-125 | /dashboard/reporting?tab=financial&financialTab=revenue | Dashboard / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-126 | /dashboard/reporting?tab=financial&financialTab=revenue | By Partner / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-127 | /dashboard/reporting?tab=financial&financialTab=revenue | Import & Reconcile / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-128 | /dashboard/reporting?tab=financial&financialTab=revenue | History / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-129 | /dashboard/reporting?tab=financial&financialTab=revenue | Payouts / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-130 | /dashboard/reporting?tab=outreach-analytics | Campaigns / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-131 | /dashboard/reporting?tab=outreach-analytics | A/B Testing / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-132 | /dashboard/reporting?tab=outreach-analytics | Recent Messages / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-133 | /dashboard/merchant-risk?tab=health | Health Alerts / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-134 | /dashboard/merchant-risk?tab=health | Churn Risk / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-135 | /dashboard/merchant-risk?tab=health | NPS / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-136 | /dashboard/merchant-risk?tab=health | Signal Settings / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-137 | /dashboard/deliverability-hub?tab=inbox-health | Inboxes / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-138 | /dashboard/deliverability-hub?tab=inbox-health | Warmup & Cap / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-139 | /dashboard/deliverability-hub?tab=inbox-health | Domains / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-140 | /dashboard/sdr-hub | Summary / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-141 | /dashboard/sdr-hub | Discovery / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-142 | /dashboard/sdr-hub | Funnel / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-143 | /dashboard/sdr-hub | Stuck Leads / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-144 | /dashboard/sdr-hub | Channel Health / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-145 | /dashboard/sdr-hub | Anomaly Alerts / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-146 | /dashboard/sdr-hub | SMS / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-147 | /dashboard/sdr-hub | Enrichment / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-148 | /dashboard/sdr-hub | Voice AI / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-149 | /dashboard/sdr-hub | Discovery Controls / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-150 | /dashboard/sdr-hub | Chat AI / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-151 | /dashboard/sdr-hub | Processor Intel / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-152 | /dashboard/sdr-hub | Source Quality / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-153 | /dashboard/sdr-hub | Inbox Health / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-154 | /dashboard/sdr-hub | Market Expansion / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-155 | /dashboard/sdr-hub | Weekly KPI / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-156 | /dashboard/sdr-hub | Lead Contacts / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-157 | /dashboard/sdr-hub?tab=sdr | AI SDR / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-158 | /dashboard/sdr-hub?tab=chatbot | Chat Bot Settings / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-159 | /dashboard/content-hub?tab=content | Content Engine / nested-tab | Resources / privileged acquisition tools → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-160 | /dashboard/content-hub?tab=blog | Blog Generator / nested-tab | Resources / privileged acquisition tools → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-161 | /dashboard/content-hub?tab=linkedin | LinkedIn / nested-tab | Resources / privileged acquisition tools → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-162 | /dashboard/content-hub?tab=blaze | Blaze.ai / nested-tab | Resources / privileged acquisition tools → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-163 | /dashboard/sdr-hub?tab=chatbot | Bot Contexts / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-164 | /dashboard/sdr-hub?tab=chatbot | Handoff Rules / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-165 | /dashboard/sdr-hub?tab=chatbot | Live Conversations / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-166 | /dashboard/sdr-hub?tab=chatbot | Webhooks / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-167 | /dashboard/content-hub?tab=content | Editorial Queue / nested-tab | Resources / privileged acquisition tools → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-168 | /dashboard/content-hub?tab=content | AI-Assist Draft / nested-tab | Resources / privileged acquisition tools → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-169 | /dashboard/content-hub?tab=linkedin | Queue / nested-tab | Resources / privileged acquisition tools → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-170 | /dashboard/content-hub?tab=linkedin | Compose / nested-tab | Resources / privileged acquisition tools → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-171 | /dashboard/content-hub?tab=linkedin | AI Generate / nested-tab | Resources / privileged acquisition tools → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-172 | /dashboard/playbooks?tab=marketing | GHL Workflows / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-173 | /dashboard/playbooks?tab=marketing | Content Library / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-174 | /dashboard/playbooks?tab=marketing | Social Ads / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-175 | /dashboard/playbooks?tab=marketing | Call Script / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-176 | /dashboard/playbooks?tab=marketing | Objection Handling / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-177 | /dashboard/playbooks?tab=growth | CRO / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-178 | /dashboard/playbooks?tab=growth | Phase 1 / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-179 | /dashboard/playbooks?tab=growth | Phase 2 / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-180 | /dashboard/playbooks?tab=growth | PR & Earned Media / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-181 | /dashboard/playbooks?tab=growth | Podcast/Video / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-182 | /dashboard/playbooks?tab=growth | Partnerships / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-183 | /dashboard/playbooks?tab=growth | Community / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-184 | /dashboard/playbooks?tab=growth | Reviews / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-185 | /dashboard/playbooks?tab=growth | Builds / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-186 | /dashboard/playbooks?tab=growth | Weekly / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-187 | /dashboard/playbooks?tab=growth | Tools / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-188 | /dashboard/playbooks?tab=growth | Partner Pipeline / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-189 | /dashboard/playbooks?tab=growth | Content Repurposing / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-190 | /dashboard/playbooks?tab=growth | Weekly Review / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-191 | /dashboard/playbooks?tab=growth | Scorecard / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-192 | /dashboard/training | Training Guides / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-193 | /dashboard/training | AI Practice / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-194 | /dashboard/training | Team Coaching / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-195 | /dashboard/leaderboard | Deals / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-196 | /dashboard/leaderboard | Revenue / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-197 | /dashboard/leaderboard | Proposals / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-198 | /dashboard/leaderboard | Calls / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-199 | /dashboard/leaderboard | Close Rate / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-200 | /dashboard/leaderboard | Contacts Added / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-201 | /dashboard/activation | Day-1 Runbook / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-202 | /dashboard/activation | Identity Wizard / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-203 | /dashboard/activation | System Status / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-204 | /dashboard/activation | Readiness / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-205 | /dashboard/activation | Bridge / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-206 | /dashboard/activation | Orchestrator / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-207 | /dashboard/activation | Activity / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-208 | /dashboard/activation | Stuck Leads / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-209 | /dashboard/activation | Deal Backfill / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-210 | /dashboard/activation | Compliance / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-211 | /dashboard/activation | Kill Switch / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-212 | /dashboard/activation | Enrichment / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-213 | /dashboard/notifications | All / nested-tab | Work / header notifications → retained nested section | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-214 | /dashboard/notifications | Leads / nested-tab | Work / header notifications → retained nested section | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-215 | /dashboard/notifications | Deals / nested-tab | Work / header notifications → retained nested section | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-216 | /dashboard/notifications | SLA / nested-tab | Work / header notifications → retained nested section | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-217 | /dashboard/notifications | System / nested-tab | Work / header notifications → retained nested section | C2; historical observation, actions UNVERIFIED unless new receipt |
| T-218 | /dashboard/underwriting | Needs Review / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-219 | /dashboard/underwriting | Auto-Approved Today / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-220 | /dashboard/underwriting | Rules Config / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-221 | /dashboard/merchant-applications | All / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-222 | /dashboard/merchant-applications | Submitted / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-223 | /dashboard/merchant-applications | Under Review / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-224 | /dashboard/merchant-applications | Approved / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-225 | /dashboard/merchant-applications | Declined / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-226 | /dashboard/merchant-applications | Draft / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-227 | /dashboard/boarding | All / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-228 | /dashboard/boarding | Submitted / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-229 | /dashboard/boarding | Under Review / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-230 | /dashboard/boarding | More Info Needed / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-231 | /dashboard/boarding | Approved / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-232 | /dashboard/boarding | Declined / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-233 | /dashboard/knowledge-admin | Sources (0) / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-234 | /dashboard/knowledge-admin | Unanswered 2 / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-235 | /dashboard/knowledge-admin | Feedback / nested-tab | Resources → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-236 | /dashboard/workflows | Workflows (17) / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-237 | /dashboard/workflows | Run History (455) / nested-tab | Administration / operational controls → retained nested section | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-238 | /dashboard/outbound-center?tab=campaigns | Campaigns / nested-tab | Campaigns → Manage | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-239 | /dashboard/outbound-center?tab=campaigns | Readiness Intelligence / nested-tab | Campaigns → retained nested section | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-240 | /dashboard/contact-census | Census / nested-tab | Prospecting → retained nested section | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-241 | /dashboard/contact-census | Reconciliation / nested-tab | Prospecting → retained nested section | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-242 | /dashboard/merchant-success?tab=reviews | Review Requests / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-243 | /dashboard/merchant-success?tab=testimonials | Testimonials / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-244 | /dashboard/merchant-success?tab=nps | NPS / CSAT / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-245 | /dashboard/merchant-success?tab=retention | Retention Campaigns / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-246 | /dashboard/support-hub?tab=tickets | Tickets / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-247 | /dashboard/support-hub?tab=rfis | RFIs / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-248 | /dashboard/support-hub?tab=review-queue | Review Queue / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-249 | /dashboard/lead-ops?tab=provider-results | Provider Results / tab | Prospecting → Enrichment | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-250 | /dashboard/lead-ops?tab=staging | Master Leads / nested-tab | Prospecting → retained nested section | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-251 | /dashboard/lead-ops?tab=staging&stagingTab=promotion-review | Promotion Review / nested-tab | Prospecting → retained nested section | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-252 | /dashboard/merchant-success?tab=testimonials | Pending / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-253 | /dashboard/merchant-success?tab=testimonials | Approved / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-254 | /dashboard/merchant-success?tab=testimonials | Rejected / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-255 | /dashboard/merchant-success?tab=testimonials | All / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-256 | /dashboard/support-hub?tab=review-queue | Pending / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-257 | /dashboard/support-hub?tab=review-queue | Approved / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-258 | /dashboard/support-hub?tab=review-queue | All / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-259 | /dashboard/outbound-center?tab=command | Pipeline / nested-tab | Campaigns → retained nested section | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-260 | /dashboard/outbound-center?tab=command | Outreach Sources / nested-tab | Campaigns → retained nested section | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-261 | /dashboard/outbound-center?tab=command | Signatures / nested-tab | Campaigns → retained nested section | C3; historical observation, actions UNVERIFIED unless new receipt |
| T-262 | /dashboard/system-health?view=command-center | Command Center / operator-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-263 | /dashboard/system-health?view=command-center | Command Center / operator-navigation-defect | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-264 | /dashboard/system-health?tab=monitor&view=command-center | Command Center / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-265 | /dashboard/system-health?tab=monitor&view=lifecycle | Lifecycle / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-266 | /dashboard/system-health?tab=monitor&view=conversion | Conversion / operator-direct-panel | Administration → Data Diagnostics | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-267 | /dashboard/system-health?tab=monitor&view=stuck-leads | Stuck Leads / operator-direct-panel | Administration → Data Diagnostics | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-268 | /dashboard/system-health?tab=monitor&view=lead-queue-health | Speed to Lead / operator-direct-panel | Administration → Data Diagnostics | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-269 | /dashboard/system-health?tab=monitor&view=stage-health | Stage Health / operator-direct-panel | Administration → Data Diagnostics | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-270 | /dashboard/system-health?tab=monitor&view=vertical-coverage | Vertical Coverage / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-271 | /dashboard/system-health?tab=monitor&view=statement-upload | Statement Upload / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-272 | /dashboard/system-health?tab=monitor&view=a-lead-queue | A-Lead Review Queue / operator-direct-panel | Administration → Data Diagnostics | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-273 | /dashboard/system-health?tab=monitor&view=sdr | SDR / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-274 | /dashboard/system-health?tab=monitor&view=recent-sends | Recent Sends / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-275 | /dashboard/system-health?tab=monitor&view=send-monitoring | Send Monitoring / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-276 | /dashboard/system-health?tab=monitor&view=silent-sequences | Sequences Not Firing / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-277 | /dashboard/system-health?tab=monitor&view=pipeline-silence-thresholds | Silence Thresholds / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-278 | /dashboard/system-health?tab=monitor&view=bounce-failure | Bounce & Failure / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-279 | /dashboard/system-health?tab=monitor&view=comm-health | Email Health / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-280 | /dashboard/system-health?tab=monitor&view=ai-health | AI Health / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-281 | /dashboard/system-health?tab=monitor&view=ai-activity | AI Activity / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-282 | /dashboard/system-health?tab=monitor&view=ai-learning-center | AI Learning Center / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-283 | /dashboard/system-health?tab=monitor&view=low-confidence | Low Confidence / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-284 | /dashboard/system-health?tab=monitor&view=subject-audit | Subject Sync / operator-direct-panel | Administration → Integrations | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-285 | /dashboard/system-health?tab=monitor&view=content-organic | Content & Organic / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-286 | /dashboard/system-health?tab=monitor&view=ghl-connection | GHL Status / operator-direct-panel | Administration → Integrations | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-287 | /dashboard/system-health?tab=monitor&view=sync-conflicts | Sync Conflicts / operator-direct-panel | Administration → Integrations | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-288 | /dashboard/system-health?tab=monitor&view=ghl-invalid-contacts | Invalid Contacts / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-289 | /dashboard/system-health?tab=monitor&view=serper-control | Serper Control / operator-direct-panel | Administration → Integrations | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-290 | /dashboard/system-health?tab=monitor&view=webhook-events | Webhook Events / operator-direct-panel | Administration → Integrations | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-291 | /dashboard/system-health?tab=monitor&view=registry-import | Registry Import / operator-direct-panel | Administration → Data Diagnostics | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-292 | /dashboard/system-health?tab=monitor&view=ghl-deferred-queue | Deferred Enrollments / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-293 | /dashboard/system-health?tab=monitor&view=save-cases | Save Cases / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-294 | /dashboard/system-health?tab=monitor&view=score-all | Score All Contacts / operator-direct-panel | Administration → Data Diagnostics | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-295 | /dashboard/system-health?tab=monitor&view=new-lead-enroll | New Lead Enrollment / operator-direct-panel | Administration → Data Diagnostics | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-296 | /dashboard/system-health?tab=monitor&view=kpis | KPIs / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-297 | /dashboard/system-health?tab=monitor&view=readiness | Readiness / operator-direct-panel | Administration → Release & Incidents | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-298 | /dashboard/system-health?tab=monitor&view=job-health | Job Health / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-299 | /dashboard/system-health?tab=monitor&view=queue-metrics | Job Queue / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-300 | /dashboard/system-health?tab=monitor&view=worker-intervals | Worker Intervals / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-301 | /dashboard/system-health?tab=monitor&view=worker-heartbeats | Worker Heartbeats / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-302 | /dashboard/system-health?tab=monitor&view=deleted-records | Deleted Records / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-303 | /dashboard/system-health?tab=monitor&view=outbound-preflight | Outbound Preflight / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-304 | /dashboard/system-health?tab=monitor&view=queue-holds | Queue Holds / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-305 | /dashboard/system-health?tab=monitor&view=data-health | Data Health / operator-direct-panel | Administration → Data Diagnostics | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-306 | /dashboard/system-health?tab=monitor&view=system-audit | System Audit / operator-direct-panel | Administration → Release & Incidents | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-307 | /dashboard/system-health?tab=monitor&view=launch-readiness | Launch Readiness / operator-direct-panel | Administration → Release & Incidents | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-308 | /dashboard/system-health?tab=monitor&view=data-quality | Data Quality / operator-direct-panel | Administration → Data Diagnostics | C5; historical observation, actions UNVERIFIED unless new receipt |
| T-309 | /dashboard/system-health?tab=monitor&view=deliverability-settings | Deliverability Settings / operator-direct-panel | Administration → Runtime & Queues | C5; historical observation, actions UNVERIFIED unless new receipt |

### Every-action acceptance record — required artifact

Create `docs/certification/stage3-c1/actions.csv` with columns: sourceClaimIds,repairGroup,routePattern,currentUrl,area,section,controlId,label,role,fixtureId,fixtureClass,handler,prestate,expectedRequest,expectedResult,actualResult,readbackReceipt,refreshResult,retryResult,cancelEffects,unauthorizedEffects,providerEffects,queueEffects,auditReceipt,viewport,theme,keyboardResult,sourceSha,servingBuildId,verdict,remainingOwner. Include every toolbar/row/overflow/drawer/tab/select/control, including expected disabled controls with current reason. Count total/pass/defect/blocked/untested; required actions may not silently disappear or be marked pass from opening a modal.

## Final directive

Audit actual current source, implement this bounded task completely, verify the real rendered styles and actions, preserve Liberty branding and all relevant data/role/safety authorities, update the same canonical report and ledger, and return a reviewable evidence-backed result. Do not end at a proposal, untested polished screenshot, nonfunctional menu or blanket “100%” claim. No production outbound/provider/native/deployment activity is authorized by this prompt.
