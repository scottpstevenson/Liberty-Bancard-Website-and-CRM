# Liberty Bancard — authenticated Stage 3 / C1–C5 reconciliation

**Audit date: October 4, 2026. Stage 3 OPEN; implementation and release certification remain separate.**

The cloud session was used after sign-in. The live results below now replace the earlier expired-session limitation and refine the existing implementation plan. This audit produced document/prompt updates, not application patches, merges or deployments.

This authenticated addendum supersedes the expired-login/source-only limitation in the earlier authoring receipt. Reviewed main remains **d99ecff73aff8b1cb92e90132c9cbe6cdecc4077**; serving remains **42309395870515b0a575e85f6c753a65da408c2a**. Source and serving are not equivalent. All 27 normal admin sidebar destinations were opened, with additional direct routes and primary tabs; 151 recorded observations cover 33 distinct URL pathnames. This is one real admin desktop session at 1363×936 in light mode. Every tab selection, skeleton and modal-open result is qualified separately from a durable action.

Evidence: `LIBERTY_STAGE3_C1_C5_LIVE_RECONCILIATION_2026-10-04.md`, `liberty-stage3-live-ui-evidence-2026-10-04.json`, `c-live-source-anchor-receipt.json`, and `liberty-stage3-queue-holds-live.jpg`. CL IDs are receipt rows inside the existing parent/repair register; do not add them to the 95 source claims as new disjoint issues. Existing 14 groups/eight tasks and all original IDs remain. Outbound remains PAUSED; incoming GHL remains ENABLED. No production save/apply/send/enroll/provider execution or settings toggle was submitted in this walkthrough.

## Current source and release evidence

| Evidence | Value and limit |
| --- | --- |
| Reviewed GitHub main | `d99ecff73aff8b1cb92e90132c9cbe6cdecc4077` — refetched; accessible current source. |
| Serving build | `42309395870515b0a575e85f6c753a65da408c2a`; built `2026-10-03T18:30:59.888Z`; publishBuildId `67e0374c-e93f-45f5-8bb3-20d8d0cb981b`; public health `ok`, GHL transport fail-fast false. Health is not all-system certification. |
| Equivalence | Both source commits are accessible; trees differ. Canonical Enrichment, later LeadImports readers and dependency changes on main are not all serving. Audit SHA is provenance, not a feature/release freeze. |
| Relevant source | Most reviewed defect files are byte-identical between main/serving; contacts/imports files differ, but reviewed health/outreach handler blocks are unchanged. Source-anchor receipt records file-level comparison, so a false whole-file equality does not invalidate an independently checked unchanged block. |
| Checkout | Existing unrelated modification `attached_assets/videos/merchant-explainer.mp4` preserved. No application changes made by this audit. |
| Test execution | No supported clean stock CI, build, schema migration, isolated mutation suite, role/IDOR suite or native-provider delivery run completed here. These remain explicit task gates. |

## Confirmed repairs and upgrades, attached to existing findings

These CL rows are dated evidence/repair instances; their multiple observations and subclaims must not be counted as new independent issues on top of the original 95.

| Receipt | Verdict | Existing finding/group | Owner | Live reproduction | Exact code trace | Required repair |
| --- | --- | --- | --- | --- | --- | --- |
| CL01 | CONFIRMED DEFECT | CRM3-10 / R05 | C1 adapter; C4 view | Legacy Forecasting lands at `/dashboard/financial-hub?tab=forecasting` with Revenue Dashboard selected; normal Reports click uses `financialTab=forecasting` and selects Forecasting. | `client/src/App.tsx:771–772`; `client/src/pages/dashboard/FinancialHub.tsx:12` | Normalize the legacy selector to the canonical financial child key. Preserve parent, remaining filters and query precedence; test direct link, click, reload and back/forward. |
| CL02 | CONFIRMED DEFECT | CRM3-09 / R05 | C1 state contract; C5 consumer | Operator Queue Holds click changes `/dashboard/system-health?tab=monitor` to `?view=queue-holds`; System Readiness becomes selected. | `client/src/pages/dashboard/OperatorDashboard.tsx:4055` | Retain the parent `tab=monitor` while changing the child `view`; use C1 destination builder. Exercise every Operator child and every entrance. |
| CL03 | CONFIRMED DEFECT | CRM3-07 / R05 | C5 | Standalone Queue Holds renders the error boundary. Runtime log: `(t.desiredLogicalHolds ?? []).map is not a function`. | `client/src/pages/queue-holds.tsx:106,115,526`; `server/services/outbound-queue-coordinator.ts:105–129`; `server/routes/admin.ts:3613–3614` | Consume the real keyed logical-hold record and physical reconciliation-result array. Show queue/job identity, desired/observed state, outcome, epoch and degraded/error details. Do not hide malformed data as an empty array or unpause queues. |
| CL04 | CONFIRMED DEFECT | CRM3-06; REF-004 / R05 | C5 | Permissions Audit settles at No routes found / 0 of 0 registered API routes despite functioning authenticated API-backed screens. | `server/routes/permissions-audit.ts:35–52` | Replace unsupported `_router` extraction with a supported verified registration inventory. Include nested routes/methods and explicit guard provenance; missing metadata is unknown, never automatically public. Test actual registered application handlers. |
| CL05 | CONFIRMED DIAGNOSTIC DEFECTS | CRM3-19; REF-013 / R11 | C5; D and later lanes retain certification | Readiness shows 3 fail, 8 warn, 15 pass. Staff probe queries `users.deleted_at`; document probe queries `documents.document_type`; GHL transport warning queries unsupported activity columns. | `server/services/launch-readiness-full.ts:32,381,541–542` | Repair probes against actual migrated columns and eligible scopes; keep schema/query failure distinct from a service failing. Derive summary/title counts from registry: observed 26 results contradict fixed 25 label. Retain real Sales Rep Ops knowledge/certification failures for Stage 8. |
| CL06 | CONFIRMED METRIC DEFECT | CRM3-11 / R06 | A authority; C3 and C4 consumers | Outreach Command labels 1,575 Active Deals; production Pipeline and Reports Overview each show 2. Outreach value is the all-unarchived aggregate total. | `client/src/pages/dashboard/OutreachCommand.tsx:127`; `server/routes/imports.ts:155`; `server/storage/sunbiz.ts:572` | Use the agreed scoped active-deal aggregate or rename this all-class inventory total with its real scope. Include record class, pipeline, active/closed predicate and as-of/source. Do not make differing populations equal by cosmetic subtraction. |
| CL07 | CONFIRMED METRIC DEFECT | CRM3-11 / R06 | A authority; C4 consumer | Portfolio shows 0 merchants while Merchant Health shows 100 Healthy Merchants. Source computes `100 - alerts.length` and an assumed health score. | `client/src/pages/dashboard/MerchantHealth.tsx:263–266` | Count distinct eligible merchants from the actual same-scope population and actual assessment/alert status. Unassessed is unknown. Derive scores from assessed records or remove unsupported score; never infer 100 merchants from zero alerts. |
| CL08 | CONFIRMED SCOPE DEFECT | CRM3-11 / R06; related CRM3-18 / R04 | A authority; C4 consumer; B task predicates | Onboarding shows Total 0 / Board 0 but At Risk 2 and Pending Docs 2. Main board requests production onboarding deals; AI status requests an unclassified limited 500-deal sample. | `client/src/pages/dashboard/Onboarding.tsx:145,155,298`; `server/routes/ai.ts:1179–1185`; `server/storage/deals.ts:200–204` | Adopt identical actor/class/pipeline/archive/stage predicates and completeness across board/status/KPIs. Aggregate server-side without silently truncating at 500; use B canonical actionable-task predicates. Label partial/stale status rather than invent zero. |
| CL09 | CONFIRMED SCOPE/DISPLAY DEFECT | CRM3-11; REF-006, REF-018, REF-069 / R06 | A authority; C2 consumers; C5 integration labels | People list 154,011; Production chip 154,012; global health cards 154,414; Test 402. Dashboard 154,011; all-class Outreach/GHL 154,414. Health endpoint ignores class/actor/list filters. | `client/src/pages/dashboard/Contacts.tsx:419–421,760`; `server/routes/contacts.ts:556–568` | Use the active list authority or explicitly label separate all-class health inventory, inclusion rules, as-of and source. Make cache invalidation coherent. Trace the chip/list delta with a common snapshot; its cause is not proved. 154,418 census/backfill includes a different historical/archive scope; it is not a lost-contact count. |
| CL10 | CONFIRMED UX GAP | CRM3-21, CRM3-26 / R08 | C2; C1 navigation foundation | 22 contact tabs visible for the observed admin record; all 22 selected at least once. Notes selection leaves URL unchanged; reload resets to Overview. Source contains 25 conditional tabs. | `client/src/pages/dashboard/ContactDetail.tsx:1263` | Implement the specified five contact areas with stable nested section keys, record identity and filter/scroll restoration. Preserve every role-appropriate conditional section and direct entrance. Selection is not durable action certification. |
| CL11 | CONFIRMED ACCESSIBILITY DEFECT | CRM3-22 / R13; C1 shared accessibility | C1 | Live viewport metadata includes `maximum-scale=1`. | `client/index.html:5` | Remove zoom restriction; verify public and CRM zoom/reflow. Desktop audit does not substitute for 320/390/768 layouts, keyboard, touch targets or 200% zoom. |
| CL12 | CONFIRMED OPERATING-GUIDE CONTRADICTION | CRM3-25 / R11; related R03/R07/R12 | C5 copy/navigation; A/B runtime contracts; Stage 8 content | GHL page correctly states Replit owns cadence yet still instructs building 66 GHL workflows for timing. Sequence Guide says all-native-GHL/100%; Marketing Playbook describes six automated GHL workflows. | `client/src/pages/dashboard/GhlWorkflowManager.tsx:1522,1544,1724`; `GhlSequenceGuide.tsx:2064,2087`; `MarketingPlaybook.tsx:696` (same dashboard directory) | Make all operator guidance follow actual sequence, sync and delivery ownership. Historical/reference workflow IDs must not look like current launch blockers. Reconcile the whole guide, not just its top banner; preserve approved claims/certification obligations. |
| CL13 | CONFIRMED DEPLOYMENT GAP | R01; C3 current route integration | C3 compatibility/integration; D serving verification | Reviewed main contains new `/dashboard/canonical-enrichment`; serving site returns 404. Accessible source commits differ. | `client/src/App.tsx:632`; `client/src/pages/dashboard/CanonicalEnrichment.tsx`; `client/src/pages/DashboardLayout.tsx` | Preserve new main implementation and integrate its five views into Prospecting. Add supported old/new entrance adapters; verify the exact later deployed build. Live 404 does not prove current main component is broken. |

## Preserved working behavior and superseded allegations

| Receipt | Verdict | Existing scope | Owner / remaining proof | Verified result and limit |
| --- | --- | --- | --- | --- |
| CL14 | PRESERVED REPAIR | CRM3-08 / R05 | C3 | Provider Results selects and mounts the actual results panel with three visible result logs. Existing `VALID_TABS` and panel repair remain. No paid provider call tested. |
| CL15 | WORKING ALIAS / READ | R05/R08 | C3 | Lead Imports opens `/dashboard/lead-ops?tab=imports`; one import has 1,472 processed = 0 new + 1,471 existing + 1 error. Preserve consolidation; newer main XLSX changes remain unserved. |
| CL16 | VALIDATION WORKS | B / C2 notes contract | B durability; C2 UX | Empty Add Note disabled; entering an unsaved draft enables it; clearing disables it. Disabled empty input is correct validation. No save submitted. |
| CL17 | FORMS OPEN / CANCEL | R04/R08 | B durable action; C2 presentation | Work New Task and contact Create Task open their respective dialogs and cancel. This verifies opening/cancel only, not create, assignment, SLA or persistence. |
| CL18 | TRUTHFUL DEGRADED STATE | CRM3-13 / R12 | B/C2 | Inbox displays partial voicemail results. Email filter explains unavailable/incomplete source rather than asserting confirmed zero email. Preserve this repaired distinction; delivery/history still needs B/D evidence. |
| CL19 | CONFIGURATION VERIFIED | CRM3-03, CRM3-04 / R03 | A contracts; C5 presentation; D native closure | Final rendered incoming-GHL switch is checked true and outboundPaused is true. Connection health probe succeeds. Stored preview reports 0 applied; no apply/run/toggle clicked. Enabled/configured does not prove fresh native sync consumption. |
| CL20 | COMPILED BRAND VERIFIED | C1 Liberty design baseline / R13 | C1 | Light desktop renders IBM Plex Sans and expected navy/blue/red tokens. Proposed new sizes/44px targets/density are requirements, not deployed design. Empty root font alias does not prove font failure: computed font is correct. |

The GHL stored preview displayed 3,994 read, 2,070 matched, 269 would fill, 1,808 would add and 2,185 conflicts, with zero updated/added. These are plan observations, not proven consumption. Historical GHL IDs/sync timestamps and zero 24-hour webhook count do not establish present native parity. No controls were changed.

## Navigation and tab coverage

All 27 normal admin sidebar destinations were opened: Overview; Contacts & Leads; Pipeline; Messages & Inbox; Tasks & Appointments; AI Advisor; Portfolio; Applications; Statement Reviews; Documents; Underwriting; Onboarding; Merchant Risk; Boarding; Lead Ops; Ready for Outreach; Outreach; Lead Imports; Reports; Leaderboard; Settings; Referral Program; Partner Orgs; Playbooks; Knowledge Base; Training; Security. This is 21 core entries + 2 partner links + 4 resource links with Dev Mode off; role-only Collateral and developer discovery routes are a different inventory.

Primary tab groups exercised include Contact22 visible tabs, LeadOps13, Outbound6, Reports6 and Financial Forecasting, Administration11, GHL3, Underwriting3, Onboarding2, MerchantRisk2, Boarding6, Work2 and Contacts&Leads2. Settled state was inspected for the listed defects; rapid-click stale selections/loading skeletons were corrected through fresh observations, not labeled persistent faults. Final Contact Chargebacks settled at no-chargebacks; final Leads selected and settled at 0 leads / no leads found. These are read states for this session, not data completeness or mutation passes.

Current main has 147 dashboard route patterns. The 309 historical panel-reference register remains historical; this session did not certify every one of those panels or every button. Keep the existing ownership partition C2=25/C3=21/C4=38/C5=63 route patterns and C2=30/C3=28/C4=67/C5=184 historical panels. Refresh dynamic tabs/actions in each build preflight rather than pretending a route census proves functionality.

## Proposed workspace and exact Liberty design contract

The proposed employee shell remains 11 entries in this order: **Today, Records, Pipeline, Inbox, Work, Merchant Operations, Prospecting, Campaigns, Reports, Administration, Resources**. Permissions reduce each role's visible entries; merchant/partner portals keep their existing boundaries. Canonical Enrichment becomes Prospecting context, not a twelfth entry. C1 builds the registry/foundation; C2–C4 ship workspaces; C5 performs final cutover after their functional receipts; D verifies the integrated release.

| Area | Reconciled structure / exact owner |
| --- | --- |
| Contact | C2: Overview; Sales Work; Conversations; Lifecycle; Service Performance. Preserve Activity/History drawer and nested conditional sections. 22 observed tabs does not replace source inventory of25. |
| Prospecting | C3: Inventory; Sources & Imports; Enrichment; Qualification & Staging; Program Health. Canonical five views remain nested and URL-addressable. |
| Campaigns | C3: Manage; Audience; Delivery; Results; map existing six primary tabs into these four and preserve nested content/actions. This later exact prompt contract supersedes older Overview/Content wording. |
| Reports | C4: four primary areas with three Financial child views; exact legacy-route/query mappings remain in C4 prompt. |
| Administration | C5: Users & Access; Integrations; Operational Controls; Data & Audit; Release Readiness. Operator views remain addressable inside the owning context. |
| Resources | C5: preserve approved playbooks/knowledge/training/security resources and role-only destinations, remove duplicate main-shell entrances. Stage8 owns final claims/certification. |

| Token / component | Live compiled baseline | Required scoped CRM target |
| --- | --- | --- |
| Branding | background40 33%98%; foreground/primary222 47%11%; accent221 78%48%; brand-red0 72%47%; border214.3 31.8%91.4%; radius.5rem | Reuse Liberty palette with exact light/dark mappings already embedded in every C prompt. Validate real compiled text/background/focus/chart contrast, not color names alone. |
| Typography | IBM Plex Sans computed; heading18/28 w600, main16/24 w400, tab14/20 w500 | Plex Sans operational; Plex Mono IDs/code; title24/32 w600, section18/24, body14/20, label12/16, metrics28/32 tabular. Source Serif remains marketing only. |
| Density | Current selected tab height32px; root aliases can be empty while local/computed styles work | Spacing4/8/12/16/24/32px;44px controls/touch targets;16px card padding;24px section gap; row44/header40; pagination25/50/100 where supported. |
| Shell / overlays | Desktop observed1363×936 light only | Sidebar256/48px; header56px; canvas max1280px; logo32px; record drawer480px/mobile full width; dialog560px. Test all existing portal inheritance. |
| States | Partial Inbox and loading states observed | Separate loading/empty/no-match/permission/error/stale/pending/conflict/unknown; visible action reason/retry; no success banner before durable result. |
| Accessibility | Live max-scale restriction present | Remove restriction; keyboard focus2px +2px offset; supported contrast4.5:1 text/3:1 component;200% zoom;320/390/768/1280/1440 layouts; real dark/mobile checks remain build gates. |

## Build handoff and remaining execution evidence

### C1

- CL01 and CL02 are now reproduced live. The registry must translate Financial aliases to the correct child selector and retain Operator parent `tab=monitor`; use real current parent/child components in compatibility tests. Do not claim normalization works from string-only assertions.
- CL11 is reproduced in live metadata. Remove `maximum-scale=1`; verify actual zoom/reflow at build.
- CL20 confirms compiled Liberty/Plex branding. Measured light baseline: `--background:40 33% 98%`, `--foreground/--primary:222 47% 11%`, `--accent:221 78% 48%`, `--brand-red:0 72% 47%`, `--border:214.3 31.8% 91.4%`, radius `.5rem`. Actual heading 18/28 weight600, main16/24 weight400, tab14/20 weight500 height32. Empty root `--font-sans` and root `--sidebar-width` are not proof of broken computed font/local sidebar values.
- Build targets remain title24/32, section18/24, body14/20, label12/16, metric28/32, spacing4/8/12/16/24/32, 44px interactive targets, card16 and section24. These are new scoped CRM requirements. Keep existing public marketing styles, portaled controls and dark-token contracts.
- C1 delivers usable shared components and representative existing-record/worklist screens, but leaves global menu cutover to C5 after C2–C4 are functional. Refresh route inventories at build; do not freeze this audit SHA.

### C2

- CL10: the live admin record exposes 22 tabs; source contains 25 conditional declarations. Group all into the specified five areas and retain role/record-conditional destinations. Notes URL/reload resets to Overview today: repair stable area/section state and back/forward/reload. Do not delete three conditionals because this record did not expose them.
- CL09: list154,011, Production chip154,012, global email health154,414, Test402. A owns class/actor/filter/archive/as-of authority. C2 consumes that contract and displays scope; it must not relabel all-class total as filtered production or subtract test totals client-side. The one-record chip/list delta remains a snapshot/cache lineage check, not a confirmed loss.
- CL16: empty-note Add Note is correctly disabled; unsaved text enables it. Preserve validation, pending, retry/conflict and drafts. B owns actual notes/task API durability; prove save/readback once on protected disposable fixtures.
- CL17: both Work and contact task forms open/cancel; durable create, assignment, task closure and SLA transitions are still required B/C2 build proofs.
- CL18: preserve Inbox incomplete-source explanations and partial counts. Never convert integration errors or skipped channels to a green empty result.
- All 22 visible contact sections selected at least once; final Chargebacks settled with a no-chargebacks state. This is selection/read evidence, not proof that all section actions work or role/object permissions pass. New layout must still cover mobile/dark/keyboard and actual mutations on fixtures.

### C3

- CL14 confirms Provider Results works on serving. Keep its repaired panel and regression coverage; do not rebuild the old broken-tab allegation. Results rendering does not prove execution of Serper/OpenAI/Apollo/Outscraper/ZeroBounce.
- CL15 confirms standalone Lead Imports already redirects into Lead Ops Imports and loads the import summary. Preserve working compatibility; no duplicate import workspace. Keep newer main XLSX/source-reader upgrades without claiming their live verification.
- CL13 confirms the new main Canonical Enrichment page is unserved (live404). Integrate current main five views into Prospecting using the exact specified canonicalView adapters. Preserve old/new entrance compatibility and status authority; D proves exact serving build after deployment.
- CL06: Outreach Command labels all-unarchived inventory1,575 as Active Deals while production Pipeline/ReportOverview show2. A repairs definition/scope; C3 consumes it with precise label/as-of and does not manufacture matching values.
- The 13 live Lead Ops tabs and six live outbound primary tabs establish current clutter. Implement the specified Prospecting five-area and Campaigns four-area mappings while retaining nested status, source lineage, actual action owners and worker diagnostics.
- Keep current user policy: no recreated paid-approval/credit/spend-limit controls or stale pilot/SHA barriers; ZeroBounce status stays distinct, DBPR restaurants/food trucks remain excluded. This session did not run enrichment, promotion, enrollment or sending; Stage4 owns provider/worker/schedule execution proofs.

### C4

- CL01 is reproduced: legacy Forecasting uses `tab=forecasting` and falls into Revenue Dashboard; proper Financial child uses `financialTab=forecasting`. Consume C1 normalization and test every financial entrance, reload/back, filters and role wrappers.
- CL07 is reproduced: Portfolio0 but Healthy Merchants100, from literal `100-alerts.length`. Coordinate A actual same-scope merchant/assessment authority; remove fabricated denominator and score. Empty/no alerts, unassessed, stale, unavailable and actual healthy populations must differ visibly.
- CL08 is reproduced: OnboardingTotal0/Board0 versus AtRisk2/PendingDocs2. A unifies record class/actor/pipeline/archive/stage populations; B supplies actionable task predicate. C4 binds all views/cards to that authority and exposes completeness. Existing AI query truncates at500 and omits class: no global total from this sample.
- CL06/CL09 metric parity means the same metric with the same scope/snapshot agrees across views; all-class inventory and production sales counts are legitimately different. Pipeline and ReportsOverview each show2; no final source/class validity or revenue model closure follows from their numerical agreement.
- Two same-name Liberty QA display rows are classification/lineage review inputs, not permission to merge, purge or declare valid production merchants. Stage5/6 processor/onboarding/financial execution obligations remain.

### C5

- CL02: preserve Operator parent selector. CL03: Queue Holds live crash requires both logical-hold and physical-queue DTO repairs. Match the actual coordinator union including degraded response, observed unknown state/outcome/errors/epochs. No `.map` cast/fallback that conceals malformed data and no queue reconciliation/resume side effect from rendering.
- CL04: PermissionsAudit shows0 routes due legacy Express extractor. Implement supported real registration inventory with explicit unknown guard metadata; test registered routes, nested paths and methods. Zero extracted routes is a broken diagnostic, not proof of no APIs or safe/public access.
- CL05: repair schema-invalid readiness probes for users/documents/GHL activity against actual migrated schema, not by downgrading failures or inventing columns. Preserve genuine knowledge/certification deficits for Stage8. Registry-derived counts must replace fixed25 title when actual response contains26 checks. Readiness repair is not Stage9 certification.
- CL12: reconcile every GHL guide/playbook/WorkflowIDs paragraph. Correct top banner currently coexists with obsolete 66-workflow/native100% timing instructions. Render actual A/B runtime ownership and reference-only external IDs; no workflow creation, token replacement or send enablement as a copy repair.
- CL19: final incoming switch checked true, outboundPaused true, connection health probe successful. Stored incoming run is preview-ready with0applied; no manual apply was clicked. Show separate connected, incoming enabled, last successful consumption, preview/apply state, stale lease, and outbound paused. Never turn off GHL incoming to enforce no-send.
- Cut over to11 role-filtered employee destinations only after functioning C2–C4 route/view/action receipts. Resources retains Stage8 approved-claims/training ownership. The final design must not turn diagnostics or static guides into operational certification.

A owns common class/actor/filter/archive/stage/denominator/as-of contracts. B owns real workflow mutations, canonical task predicates, notes/inbox/lifecycle and persistence. UI tasks consume those contracts rather than maintaining parallel calculations. D verifies final serving-source integration, safe no-send canaries, role/object denial and durable readback against the completed release. Stage4 provider execution, Stage5/6 processor/post-sale closure, Stage8 content/certification and Stage9 final freeze/security/rollback remain their original lanes.

There are no new unassigned findings in this update. Remaining evidence work is explicitly assigned to those existing tasks. Read-only audit does not certify production writes, alternate roles, mobile/dark layouts, native GHL consumption, worker schedules, current CI or every action. Keep every original parent row and record tested/merged/deployed/runtime-verified/closed separately after each implementation task.

## Evidence files

- `liberty-stage3-live-ui-evidence-2026-10-04.json` — 151 sequential observations, including intermediate loading states and later settled outcomes; evaluate each by its label/state.
- `liberty-stage3-queue-holds-live.jpg` — observed Queue Holds error boundary.
- `c-live-source-anchor-receipt.json` — current source anchors and serving whole-file equality comparisons.
- C1–C5 prompts — retain their full A–F + numbered1–12 preflight/build/verification format, exact token matrices, ownership registers and action gates; new section G supplies this authenticated evidence.
- Consolidated implementation specification Section17 and go-live ledger Section25 — current reconciled record; prior source-only session limitations are retained as historical evidence.
