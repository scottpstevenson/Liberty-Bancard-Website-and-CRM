# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD. Verify the UI audit against the current route tree, shells, APIs and role enforcement; correct outdated assumptions and implement the smallest coherent operator experience in the same run. Stop only for a false finding, wrong owner, missing backend prerequisite, required product decision with materially different architecture, unavailable runtime evidence, necessary split or kill line.

Do not redesign the whole product, delete routes without consumer proof, replace server authorization with UI hiding, invent temporary API shapes, remove redirects prematurely, clean unrelated components, use `db push` or weaken tests.

Required sequence: baseline → VFC → route/API searches → root cause → ownership → blast radius → data/auth/concurrency/external checks → verdict → corrected plan → kill lines → build → tests/gates → post-build searches → diff → final VFC → merge verdict.

## 1. REPOSITORY BASELINE

Capture branch, HEAD SHA, working tree, migration head if relevant, and frontend build/test configuration. Preserve unrelated modifications.

## 2. VERIFIED FROM CODE — PREFLIGHT

Create:

| ID | Task Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | ... | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |

Inventory all mounted routes, sidebar/nav entries, layout/domain policies, `ProtectedRoute` declarations, role guards, aliases/redirects, lazy imports, unmounted pages, dashboard hubs, API owners, query/pagination behavior, feature flags and UI states. Trace route → page → API → service for every changed surface and locate all deep-link consumers/tests.

## 3. REQUIRED SEARCH / GREP CHECKS

Search and inspect:

- route declarations, sidebar/menu/domain registries and redirects;
- `ProtectedRoute`, `allowedRoles`, `isAuthenticated`, `isDashboardUser`, `requireRole`;
- CRM, Lead Ops, Outreach, Imports, automation, settings and operator hubs;
- Contact Detail, Ready for Outreach, Pipeline, Inbox, briefing, ZeroBounce history, proposal events;
- Queue Holds, Serper control, GHL invalid contacts and operational panels;
- virtual terminal pages and server endpoints;
- pagination/filter query parameters and response consumers;
- loading/empty/forbidden/error/degraded states;
- dev/demo/test presentation flags;
- route/unit/E2E/accessibility tests.

Inspect implementations and server permissions; mounted or hidden is not equivalent to authorized.

## 4. VERIFIED ROOT CAUSE

Compare original route/tab counts and page findings with current code. State which pages remain duplicated, hidden, misnamed, unmounted or already corrected; which backend endpoints still exist; and which runtime claims remain unproven. Use the correction table.

## 5. SOURCE-OF-TRUTH CHECK

Identify canonical route registry, navigation/domain map, server RBAC owner, API/data owner for each panel, feature-flag owner and UI audit/test owner. BT-06 owns classification, BT-10 readiness/provider status, BT-09 queue operations, BT-04 contactability and BT-12 revenue states. UI must render those truths, not recreate them.

## 6. BLAST RADIUS

### In scope

- one route/domain/role ownership map;
- consolidation of overlapping hubs with intentional aliases/redirects;
- dev-only labeling/removal from production navigation;
- virtual-terminal decommission completion or verified restoration;
- true server pagination/filtering for large pipeline/list paths;
- inbox refresh and briefing cache/TTL correction;
- lifecycle-focused Contact Detail and Ready-for-Outreach explanations;
- operational panel roles and state handling;
- proposal engagement evidence;
- route/access/state tests.

### Out of scope

- changing backend classification/readiness/contactability semantics;
- provider or queue architecture redesign;
- revenue state-machine implementation;
- deletion of legacy endpoints/pages without verified zero consumers;
- visual rebranding or unrelated design-system work.

List exact expected/untouched files.

## 7. DATA / SCHEMA CHECK

Verify API response shapes, pagination contracts, event timestamps, block-reason fields and classification/readiness/status values consumed by the UI. Migration required only if a verified missing persistent field is truly owned here; otherwise state `Migration required: NO`. Do not add UI-only duplicate status persistence.

## 8. AUTHORIZATION CHECK

Produce a complete role matrix for each changed route/action across public, agent, manager and admin. Verify server endpoints independently of UI visibility. Deep links, aliases and redirects must not bypass server or route authorization. Dev mode is presentation only, never authorization.

## 9. CONCURRENCY / IDEMPOTENCY CHECK

For mutations or bulk actions, check simultaneous requests, stable idempotency, stale data, retries, partial failures and preview/run parity. For polling/refresh/cache, prevent overlapping requests, stale overwrites and unbounded timers. Navigation changes must preserve browser history and deep-link behavior.

## 10. EXTERNAL SIDE-EFFECT CHECK

Operational panels may trigger Serper, GHL, queue or other effects. Trace UI action → authorized API → canonical service → durable state → provider. Never call providers directly from UI, bypass confirmation/reason/audit, or interpret a button response as atomic provider completion.

## 11. PREFLIGHT VERDICT

Choose BUILD-READY, BUILD-READY WITH CORRECTIONS, PREFLIGHT REQUIRED, NOT BUILD-READY, NOT NEW TASK or WATCH. Continue immediately for build-ready work. If backend data required by a panel is genuinely absent, do not fabricate it; complete independent navigation/state work and identify the specific dependency.

## 12. CORRECTED BUILD PLAN

State corrected root cause, exact information architecture, redirects, role map, API work, state behavior and tests with file-specific steps. Separate removal, consolidation, feature-gating and deferred dependency work.

## 13. KILL LINES

- KILL LINE: If a user can reach or execute a protected action outside the verified role policy—whether through navigation, deep link, alias or direct API—the task has FAILED.
- STOP if a legacy route/endpoint is deleted without consumer/E2E proof or an intentional redirect.
- STOP if UI filtering is substituted for production-only server filtering.
- STOP if large-list pagination still fetches/unbounds the full dataset.
- STOP if backend truth is duplicated into a competing frontend status system.
- STOP if operational controls hide errors or treat request acceptance as provider completion.
- STOP if browser history/deep links break for retained workflows.

## 14. IMPLEMENTATION RULES

Use existing components, route patterns, query client and design system. Keep the diff focused; no broad visual rewrite, unrelated component cleanup, dependency/lockfile change or production configuration mutation. Preserve redirects until tests prove safe removal.

## 15. TEST REQUIREMENTS

Cover role allow/deny for routes and APIs, direct deep links, redirects/history, loading/empty/forbidden/error/degraded states, production-only data, pipeline pagination/filter boundaries, refresh/cache timing, block-reason rendering, operational control success/failure, proposal timestamps and regression of canonical workflows. Test server authorization separately from UI.

## 16. SMOKE / INTEGRATION TEST

Extend the route/operator E2E suite or add `scripts/test-bt11-crm-operator-surface.ts` plus existing frontend tests. Prove:

1. every visible route maps to one domain and allowed role;
2. denied roles fail at route and API layers;
3. aliases redirect intentionally and preserve deep-link/history behavior;
4. lists paginate/filter server-side;
5. all key panels render loading/empty/error/degraded states;
6. block reasons and timestamps come from canonical APIs;
7. operational actions use authorized canonical services;
8. non-production commercial rows remain excluded.

## 17. POST-BUILD GREP CHECKS

Prove no duplicate route/role policy remains active, stale aliases are intentional, removed pages/endpoints have no consumers, raw mutation calls use the shared client, pagination consumers use the current contract, and no dev-only surface is presented as production functionality.

## 18. REQUIRED GATES

Run targeted frontend/route/RBAC/E2E tests, API contracts, typecheck, production build, relevant backend subsystem tests, accessibility/lint if existing, pre-deploy/invariants and `git diff --check`. Report actual commands/results; reserve production SLO observations for VG-04.

## 19. DIFF REVIEW

Run `git status`, `git diff --stat` and `git diff`. Confirm intended files only, no secrets, screenshots/data dumps, debug code, unrelated formatting, lockfile or production config changes, and no accidental route removal.

## 20. FINAL VFC TABLE

Produce:

| ID | Requirement | Evidence | Test / Gate | Status |
|---|---|---|---|---|
| VFC-F01 | ... | `file:line` | test | PASS |

Represent each material requirement and kill line.

## 21. FINAL RESPONSE FORMAT

Return: VERDICT (COMPLETE / VERIFIED, PARTIALLY COMPLETE or DO NOT MERGE); Repository State (starting SHA, ending SHA/working tree, migration head); Verified Root Cause; Preflight Corrections; Implementation (`file:line`); Tests/Gates; Grep Verification; Kill-Line Verification; Runtime Verification; Remaining Risks; and Final Status (SAFE TO MERGE, SAFE TO MERGE — RUNTIME VERIFICATION PENDING or DO NOT MERGE). Separate local route tests from authenticated production role/state/SLO verification.

## LIBERTY-SPECIFIC SAFETY RULES

- UI must consume classification, readiness, contactability, queue and provider truth from canonical backend owners.
- Server authorization is mandatory; hiding a tab is insufficient.
- Operational actions must use durable canonical services.
- Production commercial surfaces exclude non-production data by default.
- Do not use `db push`.

## PRACTICAL REVIEW STANDARD

Block unauthorized access, misleading production data, broken operator workflows, unbounded list behavior, destructive route removal or direct provider mutations. Do not expand into a full design-system rewrite merely because navigation is being consolidated.

# TASK TO PREFLIGHT + BUILD

## BT-11 — CRM Navigation & Operator Experience

**Primary findings:** `UI-01`, `UI-02`, `UI-03`, `UI-04`, `UI-05`, `UI-06`, `UI-07`, `UI-08`, `UI-09`, `UI-10`, `UI-11`, `UI-12`

**Dependencies:** BT-06 classification and BT-10 data readiness/API shapes. Preflight may begin earlier; final wiring must consume stable canonical contracts.

### What & Why

The CRM has overlapping hubs, hidden/addressable routes, duplicated role/navigation policy, development-only ambiguity, incomplete large-list behavior and operational panels that need consistent explainable states. Operators cannot reliably know where work belongs or why a record/job is blocked.

### Done Looks Like

- One authoritative route-to-domain-to-role map exists.
- CRM, Lead Ops, Outbound, Imports, automation, settings and operator hubs are consolidated without losing proven workflows.
- Aliases/redirects are intentional and tested.
- Dev-only surfaces are removed from production presentation or clearly gated.
- Virtual terminal is fully decommissioned including server endpoints or formally restored with controls.
- Pipeline/large lists use real server pagination/filtering.
- Inbox refresh and briefing cache/TTL meet verified behavior.
- Contact Detail and Ready for Outreach center lifecycle and explainable blockers.
- Queue Holds, Serper, GHL invalid-contact and ZeroBounce surfaces enforce roles and all states.
- Proposal engagement shows source timestamps.

### Out of Scope

- Backend truth redesign, provider/queue architecture, revenue state machines and unrelated visual rebranding.

### Proposed Implementation Steps

1. Inventory routes, roles, domains, aliases and consumers.
2. Publish the canonical map and corrected consolidation plan.
3. Consolidate navigation/pages while preserving tested redirects.
4. Enforce route and server role parity.
5. Complete pagination, refresh/cache and lifecycle/blocker behavior.
6. Reconcile operational panel states and proposal events.
7. Add route/API/state/E2E coverage.

### Relevant Files and Areas to Verify

- app/router/sidebar/layout/domain registries
- dashboard pages and shared navigation/components
- auth guards and admin/CRM APIs
- pipeline/list endpoints and query consumers
- Contact Detail, Ready for Outreach, Inbox and briefing
- Queue Holds, Serper, GHL invalid-contact and ZeroBounce panels
- virtual-terminal client/server code
- frontend, RBAC, contract and E2E tests

### Existing Kill Line

KILL LINE: Navigation consolidation must not create unauthorized access, hide a required workflow, break a deep link or present non-production/computed fiction as commercial truth.

## FINAL DIRECTIVE

Verify the live route/API graph first, then implement the smallest coherent operator model in this run. Preserve proven workflows and redirects, consume canonical backend truth and reserve only authenticated production-state/SLO observations for VG-04.
