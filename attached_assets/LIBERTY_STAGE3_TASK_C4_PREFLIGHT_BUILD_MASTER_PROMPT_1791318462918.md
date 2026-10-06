# LIBERTY BANCARD — STAGE 3 TASK C4
# MASTER REPLIT PREFLIGHT + BUILD PROMPT

## Task C4 — Merchant Operations, lifecycle context and Reports

Deliver the Merchant Operations workspace and four-area Reports experience using current entity/read/metric authorities. Repair financial alias selection and unify observed-vs-modeled labels; integrate actual lifecycle/support/document actions already owned by B. Keep processor/MID/native monetary execution and separate portals in their authorized later-stage boundaries.

### A. Verified from current code — seeded preflight table

| ID / original scope | Exact current source anchor | Verdict / evidence | Repair / acceptance |
| --- | --- | --- | --- |
| C4-V01 / CRM3-10 | `client/src/App.tsx:771` | SOURCE CONFIRMED:alias redirects financial-hub?tab=forecasting while FinancialHub reads financialTab. | Use reporting tab=financial&financialTab=forecasting via C1 adapter; ROI/revenue aliases too. |
| C4-V02 / Reports | `client/src/pages/dashboard/FinancialHub.tsx:12` | VERIFIED SOURCE:three financial child keys and nested outer reporting tab contract. | Keep three exact selections and normalize all old financial aliases. |
| C4-V03 / Reports | `client/src/pages/dashboard/ReportingHub.tsx:10` | VERIFIED SOURCE:6 report selectors; nested financial; good partial query preservation. | Four primary areas with exact existing children and same-scope metric authority. |
| C4-V04 / portfolio | `client/src/pages/dashboard/MerchantPortfolio.tsx:31` | VERIFIED SOURCE:contact ID, dealId/editableDealId, owner/risk/next follow-up/task/ticket fields distinct. | Preserve exact identifiers and edit authority; no contact/deal/business namespace substitution. |
| C4-V05 / Support | `client/src/pages/dashboard/SupportHub.tsx:20` | VERIFIED SOURCE:tickets/rfis/review-queue hub owns existing child views. | Functional retained child actions/layout/state; B safe lifecycle, C4 UI. |
| C4-V06 / Risk | `client/src/pages/dashboard/MerchantRiskHub.tsx:19` | VERIFIED SOURCE:chargebacks/health selectors. | Model vs actual status and scoped read; mobile table/detail and no-access/error states. |
| C4-V07 / Success | `client/src/pages/dashboard/MerchantSuccessHub.tsx:21` | VERIFIED SOURCE:reviews/testimonials/nps/retention selectors. | One local Success destination with four working children; no sending while paused. |
| C4-V08 / lifecycle load | `client/src/pages/dashboard/Onboarding.tsx:166` | SOURCE:Onboarding reads broad contact batch alongside actual deal pipeline. This is a bounded-loading improvement candidate, not universal runtime failure proof. | Reuse scoped/paged lookup/entity joins from A/B; no arbitrary current-page aggregate truth. |

### B. Relevant files and blast radius

Inspect current existing files: `client/src/App.tsx`; `client/src/pages/dashboard/MerchantPortfolio.tsx`; `client/src/pages/dashboard/MerchantApplicationsList.tsx`; `client/src/pages/dashboard/StatementReview.tsx`; `client/src/pages/dashboard/DocumentVault.tsx`; `client/src/pages/dashboard/Underwriting.tsx`; `client/src/pages/dashboard/BoardingTracker.tsx`; `client/src/pages/dashboard/Onboarding.tsx`; `client/src/pages/dashboard/OnboardingHub.tsx`; `client/src/pages/dashboard/OnboardingBoard.tsx`; `client/src/pages/dashboard/MerchantRiskHub.tsx`; `client/src/pages/dashboard/MerchantSuccessHub.tsx`; `client/src/pages/dashboard/SupportHub.tsx`; `client/src/pages/dashboard/ReportingHub.tsx`; `client/src/pages/dashboard/Reporting.tsx`; `client/src/pages/dashboard/FinancialHub.tsx`; `client/src/pages/dashboard/ResidualRevenue.tsx`; `client/src/pages/dashboard/Forecasting.tsx`; `client/src/pages/dashboard/TerminalROI.tsx`; `client/src/pages/dashboard/OperationsReport.tsx`; `client/src/pages/dashboard/OutreachAnalytics.tsx`; `client/src/pages/dashboard/Executive.tsx`; `client/src/pages/dashboard/MyEarnings.tsx`; `client/src/pages/dashboard/Leaderboard.tsx`; `client/src/pages/dashboard/contact-detail-tabs/DocumentsTab.tsx`; `server/routes/merchant-mids.ts`; `server/routes/underwriting.ts`; `server/routes/underwriting-conditions.ts`; `server/routes/documents.ts`; `server/routes/partners.ts`; `server/routes/partner-orgs.ts`; `server/services/revenue-read-authority.ts`; `server/routes/terminal-economics.ts`.

Proposed shared destinations: `client/src/lib/crm-destinations.ts`, `client/src/lib/crm-navigation-state.ts`, `client/src/components/crm/*`, `client/src/styles/crm-theme.css`, and task evidence under `docs/certification/stage3-c4/`. These are suggested new files, not existing code. Update already shipped C1 owners instead of creating duplicates. Verify each imported child/action/suite in the actual current repo. Narrow changes to the owned UI/adapter/diagnostic scope; preserve A/B contracts and concurrent changes.

### C. Implementation sequence

1. Confirm exact registered page/component names, portal guard and actual local lifecycle handlers. Some inspection candidate names below may differ; resolve actual App imports instead of creating duplicate pages. Build slot mapping with C2 ContactDetail so C4 changes only Lifecycle/Service internals, never independent record shell/URL.
2. Merchant Operations default Portfolio; provide compact local nav grouped Portfolio/Acquisition (Applications, Statements, Documents)/Delivery (Underwriting, Boarding, Onboarding)/Service (Risk, Success, Support)/Partners. These are local groups, not new primary sidebar entries or flattened10-tab header. At desktop local rail200px when useful within available width; on narrow screens labelled section select/drawer with breadcrumb and current section.
3. Apply shared worklist contract to Portfolio and every lifecycle queue: identity, current state, owner, age/due, next step, actual related application/deal/contact/MID IDs where available; contextual primary action and overflow. Avoid summary-card duplication above every child. Link only verified/current actual relationship; missing/unknown/conflicted link gets reason and existing permitted remediation.
4. Applications, statements, documents, underwriting: actual existing Save/Edit/Upload/Preview/Download/Assign/RFI/checklist actions through B/current handlers with fixture records/files; cancel/validation/version/permissions/refresh proof. Secure preview/download retains authorization; no attachments publicly exposed by redesign. Page opening cannot initiate parsing/provider/processor work. Empty vs denied vs loading/error distinct.
5. Boarding/Onboarding: preserve stage transitions, actual submission receipts, pending/rejected/error response and owner follow-up. Refresh All no-submissions expected-control remains disabled with useful reason; eligible sandbox fixture proves handler only when later-stage sandbox authorized. Show processor/MID “not linked/unavailable” if no verified source; do not invent a successful lifecycle for screenshot completeness.
6. Risk/Success/Support exact child selectors from table preserved, lazy/paged and URL bound. B ticket/RFI create/update/assign/resolve/reopen/restore fixture actions read back correctly, customer outreach stays paused. NPS sample/timezone, chargeback outcome/source/period and churn-model version clear. C2 Conversation timeline remains single owner, service context links back there.
7. Reports4 primary areas and exact six legacy/three financial secondary selectors. C1 builder translates financial aliases; C4 changes actual App wrappers and FinancialHub consumption. Direct /forecasting,/terminal-roi,/residual-revenue,/financial-hub?tab=... must select correct report after click/reload/back; malformed/conflicting query shows explicit fallback and no duplicate tab.
8. Inventory KPI contracts and bind to A shared metric IDs/DTOs. Same period/actor/class/archive/snapshot across Reports/Today/Pipeline/Work/Portfolio. Financial observed receipts/ledger vs scenario assumptions separated by labels/surface; no deployed/paid-off/commission value inferred from terminal recommendation or local forecast. Unknown actual remains unavailable, zero only for actual empty proved population.
9. Outreach Results shares C4 OutreachAnalytics component and A sequence aggregate contract used from C3; display source coverage/partial snapshots. Agent Reports entry uses existing Earnings/Leaderboard wrappers with permitted local links; privileged report/executive/financial hub stays gated. Merchant/Partner portals are separate identity shells; do not count them toward employee11.
10. Style all retained financial charts/tables/forms and lifecycle service panels, numeric tabular font, readable currency/units/timezone, accessible legends/table alternative, no truncated essential values. Test large numbers/negative/net/gross/unknown, empty periods and API failure/stale snapshot; export matches scope and available read contract.
11. Complete C4 route/action/alias/metric/view matrix with protected fixtures, narrow/accessibility/degraded checks, no unauthorized native execution and stock CI. Handoff ready destinations to C5 and actual processor/financial ingestion gaps to Stages5/6/D with exact IDs/evidence. Canonical report/ledger updates.

### D. Required C4 rg checks — before and after

```bash
rg -n 'financial-hub|forecasting|terminal-roi|residual-revenue|merchant-portal|partner' client/src/App.tsx
rg -n 'VALID_TABS|financialTab|navigate|TabsTrigger' client/src/pages/dashboard/FinancialHub.tsx client/src/pages/dashboard/ReportingHub.tsx
rg -n 'id:|dealId|editableDealId|ownerEmail|queryKey|sort|risk' client/src/pages/dashboard/MerchantPortfolio.tsx
rg -n 'TabsTrigger|TabsContent|navigate|tab=' client/src/pages/dashboard/SupportHub.tsx client/src/pages/dashboard/MerchantRiskHub.tsx client/src/pages/dashboard/MerchantSuccessHub.tsx
rg -n 'limit=5000|queryKey|mutationFn|onSuccess|isError|contactId|dealId' client/src/pages/dashboard/Onboarding.tsx client/src/pages/dashboard/BoardingTracker.tsx
rg -n 'model|forecast|actual|observed|deployed|paid.off|unknown|asOf|scope|source' client/src/pages/dashboard/TerminalROI.tsx client/src/pages/dashboard/Forecasting.tsx client/src/pages/dashboard/ResidualRevenue.tsx server/routes/terminal-economics.ts
rg -n 'requireRole|authorize|contactId|dealId|merchantId|mid|processor' server/routes/merchant-mids.ts server/routes/underwriting.ts server/routes/documents.ts
rg -n 'tab|due|total|count|asOf|date|timezone' client/src/pages/dashboard/OperationsReport.tsx client/src/pages/dashboard/OutreachAnalytics.tsx
git diff --check
```

These grep commands are discovery checks, not functional certification. New component/registry zero matches are expected at initial C1 baseline. Review actual changed symbols and requests.

### E. Task C4 gate matrix

| Gate | Exact pass condition |
| --- | --- |
| Merchant workspace | All38 assigned route patterns, retained Support3/Risk2/Success4 and lifecycle/context selectors present, correctly guarded, styled and behavior-tested. |
| Financial aliases | All direct/legacy/canonical selectors choose exact report; query conflict, reload/back and preserved filters. |
| Observed/model truth | Actual money/status vs assumptions/source periods/asOf/unknown, no forecast labeled receipt; scope parity across C2–C4. |
| Safe local actions | B lifecycle/ticket/docs/checklist fixture save/cancel/retry/restore durable; unauthorized IDs0 effects; no real processor/submission/contact send. |
| Portals | Separate merchant/partner session contracts retained; agent Earnings/Leaderboard scoped wrapper no privilege expansion. |
| Rendering | Wide/narrow tables, chart accessible alternatives, mobile portals/overlays, loading/stale/no-access/empty/error; no permanent spinner with missing data. |
| Remaining native boundary | Exact Stage 5/6 processor/MID/residual/commission obligations preserved; no screenshot-only lifecycle completion or blanket financial certification. |

### F. Task C4 completion contract

Deliver functioning owned surfaces, actual route/action/role/state receipts and supported build/CI, exact visual/computed-style evidence and rollback. No global/sidebar/native/live closure beyond this task. Include remaining individual A/B/C/D/Stage 4–9 obligations and original IDs; no composite all 95 closure from a screenshot or merge. Final output must distinguish code-complete from unverified live.

### G. Authenticated live reconciliation — October 4, 2026

This authenticated addendum supersedes the expired-login/source-only limitation in the earlier authoring receipt. Reviewed main remains **d99ecff73aff8b1cb92e90132c9cbe6cdecc4077**; serving remains **42309395870515b0a575e85f6c753a65da408c2a**. Source and serving are not equivalent. All 27 normal admin sidebar destinations were opened, with additional direct routes and primary tabs; 151 recorded observations cover 33 distinct URL pathnames. This is one real admin desktop session at 1363×936 in light mode. Every tab selection, skeleton and modal-open result is qualified separately from a durable action.

Evidence: `LIBERTY_STAGE3_C1_C5_LIVE_RECONCILIATION_2026-10-04.md`, `liberty-stage3-live-ui-evidence-2026-10-04.json`, `c-live-source-anchor-receipt.json`, and `liberty-stage3-queue-holds-live.jpg`. CL IDs are receipt rows inside the existing parent/repair register; do not add them to the 95 source claims as new disjoint issues. Existing 14 groups/eight tasks and all original IDs remain. Outbound remains PAUSED; incoming GHL remains ENABLED. No production save/apply/send/enroll/provider execution or settings toggle was submitted in this walkthrough.

- CL01 is reproduced: legacy Forecasting uses `tab=forecasting` and falls into Revenue Dashboard; proper Financial child uses `financialTab=forecasting`. Consume C1 normalization and test every financial entrance, reload/back, filters and role wrappers.
- CL07 is reproduced: Portfolio0 but Healthy Merchants100, from literal `100-alerts.length`. Coordinate A actual same-scope merchant/assessment authority; remove fabricated denominator and score. Empty/no alerts, unassessed, stale, unavailable and actual healthy populations must differ visibly.
- CL08 is reproduced: OnboardingTotal0/Board0 versus AtRisk2/PendingDocs2. A unifies record class/actor/pipeline/archive/stage populations; B supplies actionable task predicate. C4 binds all views/cards to that authority and exposes completeness. Existing AI query truncates at500 and omits class: no global total from this sample.
- CL06/CL09 metric parity means the same metric with the same scope/snapshot agrees across views; all-class inventory and production sales counts are legitimately different. Pipeline and ReportsOverview each show2; no final source/class validity or revenue model closure follows from their numerical agreement.
- Two same-name Liberty QA display rows are classification/lineage review inputs, not permission to merge, purge or declare valid production merchants. Stage5/6 processor/onboarding/financial execution obligations remain.

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
| CRM3-10 / R05 | Actual financial alias source defect; C1 adapter and C4 consumption/readback, no URL removal. |
| CRM3-11, CRM3-12, CRM3-15; REF-006, REF-024, REF-046, REF-059, REF-060, REF-061, REF-069 / R06 | Scoped report/list/context labels and actual/scenario UI; A definitions, Stage 6 actual ingestion. |
| CRM3-21, CRM3-24, CRM3-26; REF-031, REF-034, REF-043, REF-044, REF-048, REF-053 / R08/R14 | Merchant lifecycle/record interiors; old loading not reproduced and disabled no-submission expected controls retain qualifications. |
| CRM3-22 / R13 | Each lifecycle/report list/panel lazy/paged performance, not only Portfolio. |
| REF-049 / R04 | Contextual task/ticket/notification links with B resolution, no historical-native cleanup inference. |
| REF-058 / R05 | C4 route/action/metric slice of full-completeness claim; every action remains evidence-backed. |


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

| Local view / group | Existing destination | Exact retained sections / UI behavior |
| --- | --- | --- |
| Portfolio | /dashboard/portfolio | Default overview/worklist; risk/owner/last touch/next follow-up/open tasks/tickets; scopes and flags explicit. |
| Applications | /dashboard/merchant-applications | Protected local application record/status, completeness, owner and next action; never submit processor call from open. |
| Statement Reviews | /dashboard/statement-review | Existing review/upload/report owner, class/document identity, actual parsing state; no fake financial result. |
| Documents | /dashboard/document-vault | Existing authorized list, secure preview/download, upload/metadata/version/lifecycle; fixture files only for writes. |
| Underwriting | /dashboard/underwriting | Queue, conditions/RFIs, decision history; reviewed ID relationships. |
| Boarding | /dashboard/boarding | BoardingTracker status keys all,submitted,under_review,more_info_needed,approved,declined remain filter controls with URL-bound status, not new workspace tabs. Actual submissions and processor states. Refresh disabled with reason when no eligible submissions; sandbox only when later authorized. |
| Onboarding | /dashboard/onboarding?tab=overview\|board | OnboardingHub exact overview/board selectors retained; old /onboarding-board maps board. One owner with board/list presentation and contextual /dashboard/onboarding-kickoff. Existing lifecycle stages/checklists preserved; schema-owned transitions only. |
| Risk | /dashboard/merchant-risk?tab=health or chargebacks | Exact old health/chargebacks selectors; scope/period, model versus actual distinction. |
| Success | /dashboard/merchant-success?tab=reviews\|testimonials\|nps\|retention | Four retained selectors, actual sample/response counts; outreach remains paused. |
| Support | /dashboard/support-hub?tab=tickets\|rfis\|review-queue | Three retained selectors; B task/ticket/recovery actions, field/context/owner/due/error readback. |
| Partners (local subgroup) | /dashboard/referral-program; /dashboard/partner-referral-pipeline; /dashboard/partner-portal; /dashboard/partner-orgs; /dashboard/co-branded-proposals | Current per-route admin/manager guards preserved. Employee partner administration and actual /dashboard/partner portal remain separate sessions. |
| Contact Lifecycle and Service child panels | Contact area/section URLs from C2 table | Use existing contact-detail-tabs components; C4 owns interior layout/loading/data truth, C2 owns record shell and URL translation. |
| Merchant/Partner portals | /dashboard/merchant-portal; /dashboard/partner | Keep scoped identity/workspace. Grouping employee pages does not embed a portal in employee shell or expose all workspaces. |
| Processor / MID context | Existing registered merchant MID/processor read contracts | Expose verified link/state/ID only where API and route exist. Missing UI capability remains honest unavailable and Stage 5 owner; never invent /dashboard/processors or /dashboard/mids route. |

| Four primary areas | Existing canonical selectors | Required labeling / special access |
| --- | --- | --- |
| Sales & Growth | /dashboard/reporting?tab=overview\|growth\|win-loss | Overview/Growth/Win-Loss secondary views; /dashboard/executive retained separate role-scoped contextual report; labeled consistent periods/scopes. |
| Operations | /dashboard/reporting?tab=operations | Actual task/SLA/assignment/quality metrics from A; “open”, “overdue”, “unassigned” predicates match Work/Today. |
| Outreach | /dashboard/reporting?tab=outreach-analytics | C3 Results links to this owner; delivery receipts separate from configured sequences/audience. SequenceReport contextual subview uses A aggregates. |
| Financial | /dashboard/reporting?tab=financial&financialTab=revenue\|forecasting\|terminal-roi | Three retained financial children; observed money vs model/forecast, source/period/asOf/unknown. |
| Legacy /dashboard/financial-hub | Normalize to reporting tab=financial and financialTab=… | Accept legacy tab=revenue\|forecasting\|terminal-roi on this route; conflicting canonical financialTab wins only if valid; never duplicate tab query. |
| /dashboard/residual-revenue | /dashboard/reporting?tab=financial&financialTab=revenue | Compatible exact revenue report. |
| /dashboard/forecasting | /dashboard/reporting?tab=financial&financialTab=forecasting | Current alias passes wrong outer tab; C4 actual selection regression required. |
| /dashboard/terminal-roi | /dashboard/reporting?tab=financial&financialTab=terminal-roi | Exact ROI selection, A modeled/verified/deployed/unknown distinction. |
| Agent Earnings / Leaderboard | /dashboard/my-earnings; /dashboard/leaderboard | Agent Reports entry uses permitted existing page plus local links; do not widen privileged ReportingHub route merely for consistent sidebar labels. |

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
| client/src/pages/dashboard/ReportingHub.tsx | 43 | overview, growth, win-loss, outreach-analytics, operations, financial | Hub composes current child owners; see child APIs |
| client/src/pages/dashboard/FinancialHub.tsx | 34 | revenue, forecasting, terminal-roi | Hub composes current child owners; see child APIs |
| client/src/pages/dashboard/MerchantRiskHub.tsx | 26 | chargebacks, health | Hub composes current child owners; see child APIs |
| client/src/pages/dashboard/MerchantSuccessHub.tsx | 32 | reviews, testimonials, nps, retention | Hub composes current child owners; see child APIs |
| client/src/pages/dashboard/SupportHub.tsx | 29 | tickets, rfis, review-queue | Hub composes current child owners; see child APIs |
| client/src/pages/dashboard/Onboarding.tsx | 863 | No literal TabsTrigger keys in static census; inspect dynamic view/control definitions | /api/deals/, /api/deals, /api/deals?pipeline=onboarding, /api/ai/onboarding-status, /api/contacts, /api/contacts?limit=5000 |
| client/src/pages/dashboard/OnboardingHub.tsx | 26 | overview, board | Hub composes current child owners; see child APIs |
| client/src/pages/dashboard/OnboardingBoard.tsx | 531 | No literal TabsTrigger keys in static census; inspect dynamic view/control definitions | /api/deals/, /api/onboarding-board, /api/tasks, /api/tasks?dealId=, /api/merchant-documents/upload, /api/operator/onboarding-kpis |
| client/src/pages/dashboard/BoardingTracker.tsx | 450 | No literal TabsTrigger keys in static census; inspect dynamic view/control definitions | /api/boarding/submissions, /api/boarding/submissions?status=, /api/boarding/refresh-all |
| client/src/pages/dashboard/Executive.tsx | 659 | No literal TabsTrigger keys in static census; inspect dynamic view/control definitions | /api/executive/goals, /api/executive/snapshot, /api/executive/snapshots, /api/executive/refresh |

### Exact assigned route register — 38 current dashboard patterns

Current-source entry/role data and proposed disposition are separate columns. The original R IDs retain historical identities; R-147 is the newly discovered canonical route. C1 owns registry/adapters for all 147; each surface has exactly one C2–C5 delivery owner. Dedicated /mobile and public routes are additional boundary/regression tests, not counted in147.

| ID | Current pattern | Current source entry | Surface owner / group | Required canonical target or retained entry | Disposition / guard contract |
| --- | --- | --- | --- | --- | --- |
| R-001 | /dashboard/partner | App.tsx:484; PartnerPortal | C4 / Merchant Operations / portal boundary | /dashboard/partner | KEEP separate identity/access boundary; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-013 | /dashboard/onboarding | App.tsx:574; OnboardingHub | C4 / Merchant Operations | /dashboard/onboarding | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-014 | /dashboard/tickets | App.tsx:577; alias/wrapper | C4 / Merchant Operations | /dashboard/support-hub?tab=tickets | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-019 | /dashboard/review-requests | App.tsx:592; alias/wrapper | C4 / Merchant Operations | /dashboard/merchant-success?tab=reviews | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-020 | /dashboard/testimonial-submissions | App.tsx:595; alias/wrapper | C4 / Merchant Operations | /dashboard/merchant-success?tab=testimonials | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-021 | /dashboard/onboarding-kickoff | App.tsx:598; OnboardingKickoff | C4 / Merchant Operations | /dashboard/onboarding-kickoff | CONTEXTUAL action; keep standalone safe fallback; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-023 | /dashboard/rfis | App.tsx:604; alias/wrapper | C4 / Merchant Operations | /dashboard/support-hub?tab=rfis | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-024 | /dashboard/review-queue | App.tsx:607; alias/wrapper | C4 / Merchant Operations | /dashboard/support-hub?tab=review-queue | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-037 | /dashboard/outreach-analytics | App.tsx:651; alias/wrapper | C4 / Reports | /dashboard/reporting?tab=outreach-analytics | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-038 | /dashboard/reporting | App.tsx:654; ReportingHub | C4 / Reports | /dashboard/reporting | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-040 | /dashboard/win-loss | App.tsx:660; alias/wrapper | C4 / Reports | /dashboard/reporting?tab=win-loss | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-045 | /dashboard/statement-review | App.tsx:675; StatementReview | C4 / Merchant Operations | /dashboard/statement-review | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-051 | /dashboard/merchant-applications | App.tsx:696; MerchantApplicationsList | C4 / Merchant Operations | /dashboard/merchant-applications | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-052 | /dashboard/boarding | App.tsx:699; BoardingTracker | C4 / Merchant Operations | /dashboard/boarding | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-053 | /dashboard/onboarding-board | App.tsx:702; alias/wrapper | C4 / Merchant Operations | /dashboard/onboarding?tab=board | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-054 | /dashboard/merchant-portal | App.tsx:705; MerchantPortal | C4 / Merchant Operations / portal boundary | /dashboard/merchant-portal | KEEP separate identity/access boundary; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-055 | /dashboard/merchant-health | App.tsx:708; alias/wrapper | C4 / Merchant Operations | /dashboard/merchant-risk?tab=health | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-056 | /dashboard/chargebacks | App.tsx:711; alias/wrapper | C4 / Merchant Operations | /dashboard/merchant-risk?tab=chargebacks | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-057 | /dashboard/nps | App.tsx:714; alias/wrapper | C4 / Merchant Operations | /dashboard/merchant-success?tab=nps | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-058 | /dashboard/retention-campaigns | App.tsx:717; alias/wrapper | C4 / Merchant Operations | /dashboard/merchant-success?tab=retention | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-060 | /dashboard/my-earnings | App.tsx:723; MyEarnings | C4 / Reports | /dashboard/my-earnings | KEEP owner; grouped/local navigation; ["agent"] |
| R-061 | /dashboard/residual-revenue | App.tsx:726; alias/wrapper | C4 / Reports | /dashboard/reporting?tab=financial&financialTab=revenue | MERGE presentation; preserve compatibility / scope; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-062 | /dashboard/referral-program | App.tsx:729; ReferralProgram | C4 / Merchant Operations | /dashboard/referral-program | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-063 | /dashboard/partner-referral-pipeline | App.tsx:732; PartnerReferralPipeline | C4 / Merchant Operations / partner administration | /dashboard/partner-referral-pipeline | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-064 | /dashboard/partner-portal | App.tsx:735; PartnerPortalAdmin | C4 / Merchant Operations / partner administration | /dashboard/partner-portal | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-065 | /dashboard/partner-orgs | App.tsx:738; PartnerOrgs | C4 / Merchant Operations / partner administration | /dashboard/partner-orgs | KEEP owner; grouped/local navigation; ["admin"] |
| R-066 | /dashboard/co-branded-proposals | App.tsx:741; CoBrandedProposals | C4 / Merchant Operations | /dashboard/co-branded-proposals | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-076 | /dashboard/forecasting | App.tsx:771; alias/wrapper | C4 / Reports | /dashboard/reporting?tab=financial&financialTab=forecasting | REPAIR query contract; compatibility retained; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-095 | /dashboard/leaderboard | App.tsx:828; Leaderboard | C4 / Reports | /dashboard/leaderboard | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-096 | /dashboard/terminal-roi | App.tsx:831; alias/wrapper | C4 / Reports | /dashboard/reporting?tab=financial&financialTab=terminal-roi | REPAIR query contract; compatibility retained; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-099 | /dashboard/document-vault | App.tsx:840; DocumentVault | C4 / Merchant Operations | /dashboard/document-vault | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-104 | /dashboard/growth-kpi | App.tsx:855; alias/wrapper | C4 / Reports | /dashboard/reporting?tab=growth | LEGACY redirect; remove duplicate menu; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-113 | /dashboard/merchant-success | App.tsx:890; MerchantSuccessHub | C4 / Merchant Operations | /dashboard/merchant-success | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-114 | /dashboard/portfolio | App.tsx:893; MerchantPortfolio | C4 / Merchant Operations | /dashboard/portfolio | KEEP owner; grouped/local navigation; Current Protected/Agent/Partner wrapper + server object authority (inspect, do not infer global permission) |
| R-115 | /dashboard/support-hub | App.tsx:896; SupportHub | C4 / Merchant Operations | /dashboard/support-hub | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-119 | /dashboard/financial-hub | App.tsx:908; FinancialHub | C4 / Reports | /dashboard/reporting?tab=financial&financialTab=<validated legacy selection> | REPAIR query contract; compatibility retained; ["admin", "manager"] |
| R-124 | /dashboard/merchant-risk | App.tsx:923; MerchantRiskHub | C4 / Merchant Operations | /dashboard/merchant-risk | KEEP owner; grouped/local navigation; ["admin", "manager"] |
| R-141 | /dashboard/executive | App.tsx:974; ExecutiveDashboard | C4 / Reports | /dashboard/executive | KEEP owner; grouped/local navigation; ["admin", "manager"] |

### Original audit panel reconciliation — 67 reference entries

These are the original309 observation rows assigned to a delivery owner, not a fresh unique panel/action count. Historical example IDs (including159443) are references, not permission to mutate production. Substitute owned disposable fixtures with recorded lineage for behavior tests. Current source changes/additions (notably canonical5 views) must be appended and tested separately; none of these reference rows is automatically verified from prior observation.

| Original ID | Historical URL | Retained control/panel | Required workspace placement | Implementation owner / evidence limit |
| --- | --- | --- | --- | --- |
| T-051 | /dashboard/reporting | Overview / hub-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-052 | /dashboard/reporting?tab=growth | Growth Metrics / hub-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-053 | /dashboard/reporting?tab=win-loss | Win/Loss / hub-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-054 | /dashboard/reporting?tab=outreach-analytics | Outreach Analytics / hub-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-055 | /dashboard/reporting?tab=operations | Operations Report / hub-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-056 | /dashboard/reporting?tab=financial | Financial / hub-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
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
| T-079 | /dashboard/financial-hub | Revenue Dashboard / hub-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-080 | /dashboard/reporting?tab=financial&financialTab=forecasting | Forecasting / hub-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-081 | /dashboard/reporting?tab=financial&financialTab=terminal-roi | Terminal ROI / tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
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
| T-195 | /dashboard/leaderboard | Deals / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-196 | /dashboard/leaderboard | Revenue / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-197 | /dashboard/leaderboard | Proposals / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-198 | /dashboard/leaderboard | Calls / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-199 | /dashboard/leaderboard | Close Rate / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-200 | /dashboard/leaderboard | Contacts Added / nested-tab | Reports → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
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
| T-242 | /dashboard/merchant-success?tab=reviews | Review Requests / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-243 | /dashboard/merchant-success?tab=testimonials | Testimonials / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-244 | /dashboard/merchant-success?tab=nps | NPS / CSAT / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-245 | /dashboard/merchant-success?tab=retention | Retention Campaigns / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-246 | /dashboard/support-hub?tab=tickets | Tickets / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-247 | /dashboard/support-hub?tab=rfis | RFIs / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-248 | /dashboard/support-hub?tab=review-queue | Review Queue / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-252 | /dashboard/merchant-success?tab=testimonials | Pending / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-253 | /dashboard/merchant-success?tab=testimonials | Approved / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-254 | /dashboard/merchant-success?tab=testimonials | Rejected / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-255 | /dashboard/merchant-success?tab=testimonials | All / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-256 | /dashboard/support-hub?tab=review-queue | Pending / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-257 | /dashboard/support-hub?tab=review-queue | Approved / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |
| T-258 | /dashboard/support-hub?tab=review-queue | All / nested-tab | Merchant Operations → retained nested section | C4; historical observation, actions UNVERIFIED unless new receipt |

### Every-action acceptance record — required artifact

Create `docs/certification/stage3-c4/actions.csv` with columns: sourceClaimIds,repairGroup,routePattern,currentUrl,area,section,controlId,label,role,fixtureId,fixtureClass,handler,prestate,expectedRequest,expectedResult,actualResult,readbackReceipt,refreshResult,retryResult,cancelEffects,unauthorizedEffects,providerEffects,queueEffects,auditReceipt,viewport,theme,keyboardResult,sourceSha,servingBuildId,verdict,remainingOwner. Include every toolbar/row/overflow/drawer/tab/select/control, including expected disabled controls with current reason. Count total/pass/defect/blocked/untested; required actions may not silently disappear or be marked pass from opening a modal.

## Final directive

Audit actual current source, implement this bounded task completely, verify the real rendered styles and actions, preserve Liberty branding and all relevant data/role/safety authorities, update the same canonical report and ledger, and return a reviewable evidence-backed result. Do not end at a proposal, untested polished screenshot, nonfunctional menu or blanket “100%” claim. No production outbound/provider/native/deployment activity is authorized by this prompt.
