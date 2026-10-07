# Liberty Task 2072 C1 final prebuild audit and corrections

**Audited source:** `442fd044f10f52db4bf391dabcb1299403314eaf`, current `origin/main`, checked again after the audit. **Date:** October 7, 2026 UTC / October 6 US Eastern. **Task:** #2072 Shared Liberty CRM Foundation. **Repository:** `scottpstevenson/Liberty-Bancard-Website-and-CRM`.

**Final verdict: APPROVED FOR BUILD — CORRECTIONS INCORPORATED.** This document incorporates the corrections into the #2072 execution contract below. Apply that amended contract to the same Replit task before Build Mode. This audit did not edit the remote Replit task, implement application code, run stock CI, or certify the serving CRM. The approval concerns the coherent, bounded implementation design and its required tests.

Keep one C1 implementation task. Keep the eventual eleven destinations and existing menus until C5. C1 supplies shared contracts and usable representative consumers; C2–C5 still own their complete workspaces. The original 95 source claims, fourteen repair groups and eight-task accounting remain unchanged. The ten correction bundles below are grouped task amendments, not ten newly deduplicated defects or closure of those 95 claims.

## 1. Baseline and dependency status

| Item | Independently checked result |
| --- | --- |
| Checkout | Clean detached audit worktree at current main; no app edits |
| HEAD and freshly fetched origin/main | `442fd044f10f52db4bf391dabcb1299403314eaf` |
| Ahead / behind | 0 / 0; merge base equals HEAD |
| Parent | `94a4742d5d1953ea8102071aee2b9b5553ad1d06` |
| Earlier C1 baseline | `5d19e8c...` is historical, not execution authority |
| Latest relevant merges | #2071 local retained-import milestone at current HEAD; Stage 3 specification at parent; Task B workflow commit `75d0a1ec` already in ancestry |
| Migration journal | `migrations/meta/_journal.json`: 350 entries, last idx349/tag `0346_rep_invite_purpose`; source journal only, not proof installed in production |
| App route inventory | 245 literal path declarations; 147 dashboard patterns; all 147 retained route IDs match current App paths |
| Historical panel inventory | 309 retained evidence rows; actions and current dynamic panels require new build receipts |
| Current suite roster | Static extraction: 172 in pre-deploy, 172 in manifest, identical script sets, no duplicate manifest scripts; stock manifest check not executed |
| Release receipt in repo | Reports 125 passes, 45 executed failures and 2 opt-in skips. This is a failed historical configured release, not this audit's execution result or a waiver |
| Local audit runtime | Node24.19.0/npm11.9.0; repository requires Node >=22.22.0 <23 / npm10.9.4 |
| Dependencies here | No local `node_modules/.bin/tsx` or `tsc`; no dependency install or unsupported-toolchain gate claimed |
| Serving identity / live modes | Not refreshed in this audit. The October4 serving and browser receipts and #2071 runtime observations remain dated evidence |
| Independent future work | #2077 native retained-population/restart/replay certification; #2078 primary diagnostics and postpublication cycles. Neither blocks safe C1 implementation |
| Active branch / PR collisions | Local remote refs inventoried; no authoritative open-PR or Replit private workspace inspection. Recheck overlapping changes before edit/merge |

Two files advertised as binding are **absent from the clean GitHub checkout**: `.local/tasks/liberty-stage3-post-2071-audit.md` and `.local/tasks/liberty-stage3-c-preflight-common.md`. Their absence does not establish absence in Replit. Export them there if present, preserve their actual text and provenance, and make their non-secret instructions portable under `docs/certification/stage3-c1/`. If absent there too, use this current-source addendum and the complete retained C1 prompt as the explicit known contract; identify any genuinely unknown private requirement rather than pretend it was read. Do not make independently safe registry/theme work wait for native #2077/#2078 proof. Stop only a dependent operation if an actual missing instruction changes its authority or safety.

## 2. Verified fact claims

All eight original seed claims were rechecked. Verdicts describe their premise; missing new implementation is expected before C1.

| ID | Verdict | Current source evidence | Consequence |
| --- | --- | --- | --- |
| C1-V01 | CONFIRMED | `App.tsx:346–350,771–772`; `FinancialHub.tsx:12–13`; `OperatorDashboard.tsx:4049–4057`; `SystemHealthHub.tsx:17–24` | Financial legacy child key mismatch and Operator parent-key loss remain. Fix adapter plus mounted consumers, including both parents |
| C1-V02 | CONFIRMED structure; NOT YET IMPLEMENTED registry | `DashboardLayout.tsx:136–249` separate group arrays and canonical enrichment entry | Build shared metadata; no premature menu activation or claim every array entry is a separate defect |
| C1-V03 | CONFIRMED existing branding | `index.css:19–22` and root/dark variables | Preserve IBM Plex and current navy/blue/red tokens. No new brand system |
| C1-V04 | PARTIAL integration claim | `tailwind.config.ts:91–96` aliases versus CSS body/display variables; prior CL20 computed Plex receipt | Resolve scoped aliases and prove computed style. Empty aliases do not prove broken rendered fonts |
| C1-V05 | CONFIRMED source; PROPOSED upgrade | `components/ui/button.tsx:29`, existing min36/32/40px variants | Implement CRM44px target treatment without resizing public primitives globally |
| C1-V06 | CONFIRMED, wider affected path | `client/index.html:5` **and** `server/ssrShared.ts:120` both restrict maximum scale | Remove both restrictions; verify actual zoom/reflow and public SSR behavior |
| C1-V07 | CONFIRMED existing compiler | Tailwind4.3.3 package/lock, Vite plugin, `@config`, legacy theme/preflight | Preserve compiled compatibility and isolate CRM changes |
| C1-V08 | CONFIRMED existing primitive; PROPOSED extension | `DashboardErrorState.tsx` current error/retry component | Compose typed states; do not install a second error system |
| VFC-09 | CONFIRMED mismatch in inherited ownership | R039/R046/R047/R109 point into OutboundCenter but have inconsistent C3/C5 owners; R107 and T218–220 put Underwriting in C5 | Resolve one workspace render owner with privileged contextual links |
| VFC-10 | CONFIRMED current URL behavior | TasksAppointments uses replace and recreates only `tab`; ContactsAndLeads and LeadOps use replace for tab changes; ContactDetail initializes local overview | Shared push/replace policy is a new acceptance contract. Preserve state; do not assume existing handlers already comply |
| VFC-11 | CONFIRMED request/caching gap | `getQueryFn` ignores QueryFunction signal, joins entire key as path; default staleTime Infinity. Contacts and Tasks custom fetchers also ignore signal | Typed request URL independent of cache identity; forward cancellation and scope protected caches |
| VFC-12 | PARTIAL account-cache allegation | `use-auth.ts` updates auth cache on login/MFA/signup; no explicit protected cache removal; logout hard reloads `/login` | Hard logout normally clears memory. Test account/role transitions and in-flight responses; no claim logout always leaks data |
| VFC-13 | CONFIRMED API contract limitation | `/api/tasks` in `server/routes/tickets-tasks.ts:100–120` parses deal/source only and returns array; storage has optional limit/offset but route does not pass them | Do not promise server task pagination or totals from that response. Choose existing paginated Contacts for C1 list adoption |
| VFC-14 | CONFIRMED existing Contacts authority | `/api/contacts` and `/facets` use shared parsed filters and readPeople/readPeopleFacets; use-contacts has rows/facets split | Reuse both real contracts; preserve independent facet failure and asOf; no page-length total |
| VFC-15 | CONFIRMED portal integration gap | Dialog, Sheet, Select and menu primitives use Radix portals; shared Toaster is outside route descendants | A class only on main cannot theme body portals; explicitly propagate employee theme to content and nested overlays |
| VFC-16 | CONFIRMED scope hazard | ProtectedRoute mounts DashboardLayout for merchant portal; partner route has separate wrapper; shell has merchant items | Apply CRM theme by employee boundary, not all ProtectedRoute/layout users |
| VFC-17 | CONFIRMED duplicate heading source | `DashboardLayout.tsx:776` shell H1; `ContactDetail.tsx:1819` record H1 | Define one page heading owner for adopted surfaces; do not create a third headline |
| VFC-18 | CONFIRMED current/future state distinction | LeadOps has thirteen keys and two staging keys; no canonical key. CanonicalEnrichment has five views in local state | R147 nested target is future C3 contract; retain functional standalone route until mounted parity |
| VFC-19 | CONFIRMED existing persistence, unsafe delete call path | saved_filters schema; GET/POST actor-scoped; DELETE handler at templates-settings.ts:162 passes only ID; misc.ts:311 deletes by ID | Use URL presets in C1. Do not advertise absent persistence, or reuse unsafe delete authority without separate narrow A/B repair and IDOR proof |
| VFC-20 | STALE prior B premise | `scripts/ci-suite-manifest.ts:150–154` registers SSR Style Isolation now | Preserve registration; do not reopen old missing-registration finding as current C1 defect |
| VFC-21 | UNVERIFIABLE here | Private `.local/tasks` instructions, fresh serving modes, real role/browser/CI/native receipts | Portable evidence and required build proof; no inferred production pass |

The two defect-bearing original seeds are V01 and V06; V02/V05/V08 describe existing structures with proposed upgrades, V03/V07 preservation, V04 a narrowed integration gap. This categorization is about **eight seeds**, not a new breakdown of all 95 source findings.

## 3. Consolidated corrections and fix effectiveness

Every proposed repair below **requires failing-before/passing-after or meaningful acceptance proof during build**. Source tracing proves the cause or missing contract; it does not prove the repair is implemented.

| Bundle | Priority | Root cause / correction site | Exact change and competing paths | Mandatory proof |
| --- | --- | --- | --- | --- |
| C1-R01 Portable contract | P2 | Task depends on untracked private paths | Export real files if present; attach complete original C1 plus this update, hashes and precedence. Do not fabricate private review text | Clean checkout can resolve every binding instruction; no dependency on temporary `/tmp` log |
| C1-R02 Single owner and guards | P1 | Historical register mixes menu placement with target ownership | Correct R039/R046/R109 to C3 Campaigns, R107 to C4 Merchant Ops; retain C5 contextual control links. Derive effective alias target guards, not uniform role lists | All147 paths accounted; forbidden children issue zero requests; employee/merchant/partner/mobile boundaries retained |
| C1-R03 State and compatibility | P2 | Child key ambiguity, Operator deletes parent selector, parent resets view, tab changes replace history/drop filters | One parser/builder, mounted financial/operator repair, push tab history, replace alias/filter normalization; Contact/Prospecting contracts explicit pending owners | Direct/click/reload/back/forward; conflict/duplicate/invalid/forbidden; real correct child visible and request intercepted |
| C1-R04 Functional bounded adoption | P2 | “Representative” unspecified; fake read fixtures could replace real API; task server pagination absent | Adopt existing People list and Contact RecordHeader only; real rows/facets, current B handlers preserved; do not replace Contact outer shell | Selection/search/retry/page/record link and actual permitted action readback; no mock production truth |
| C1-R05 Requests and protected cache | P1 | Cache key/path coupling; unconsumed signal; no explicit protected context clearing | Separate request URL and actor/scope key; forward signal; enable by access/active state; cancel/remove old protected scope before actor/role transition renders | Delayed old response after filter/role/account change cannot paint or restore old data; no hidden polling; mutation invalidation still works |
| C1-R06 Scoped theme and overlays | P2 | Portal CSS inheritance breaks outside root; layout also used by merchant | Employee theme provider/context and CRM portal content boundary, including nested overlays/toasts, opt-in controls | Computed light/dark tokens/font/44px on every overlay and trigger; public and portal routes unchanged |
| C1-R07 Zoom in both templates | P2 | Client HTML and SSR independently emit max scale | Remove maximum-scale=1 from both viewport declarations; preserve existing SSR CSS/layer delivery | Fresh client and server HTML lack restriction; actual200% zoom at required sizes, no public SSR style regression |
| C1-R08 Layout coherence | P2 | Two H1 owners; gutters duplicated; viewport breakpoints ignore reduced container;40px header cannot contain44px target | Adopted page owns H1, shell label semantic; one gutter; container-aware cards/detail rail; interactive headers >=44px | Measured bounds at320/390/768/1280/1440 and zoom, keyboard, long labels/values; no clipped targets or whole-page horizontal scroll |
| C1-R09 Data/preset contracts | P1 for scope; P2 UX | Row counts mistaken for totals, unknown filters/presets, saved-view delete lacks owner | Reuse row/facet scope, expose unavailable totals; only supported Mine/Team/Unassigned; URL presets, no new schema | Same filters/actor/class/archive/asOf across list and metrics; no unassigned preset that still returns assigned records |
| C1-R10 Evidence and completion | P2 | All309 cross-workspace historical actions could be required as C1 execution, hiding ownership; old CI counts/passes reused | Complete147 inventory and309 disposition; execute owned/adopted action denominator only; hand off later actions; register actual tests, preserve172 baseline suites | No untested row silently passes; manifest real check, supported compiled build, source-versus-serving receipts separated |

### C1-R03 exact URL rules

- Financial accepts `/dashboard/forecasting`, `/dashboard/revenue`, `/dashboard/terminal-roi` and `/dashboard/financial-hub?tab=revenue|forecasting|terminal-roi`. Normalize to `/dashboard/reporting?tab=financial&financialTab=<child>`. An explicit valid single `financialTab` wins over the legacy child `tab`; duplicate identical values may collapse; contradictory repeated values or ambiguous invalid input show a reason and safe permitted fallback. Do not merely change the Forecasting redirect and leave Revenue/ROI entrances inconsistent.
- Operator canonical monitor state is `/dashboard/system-health?tab=monitor&view=<validated-view>`. Under this parent, setView **must retain** tab=monitor. SystemHealthHub goTab must use the builder, preserve compatible state, clear incompatible child state when leaving monitor, and restore valid prior view deliberately. The raw legacy Operator adapter must not append duplicate tab keys. Unknown/forbidden outcomes are explicit. Managers retain Readiness/SEO access but cannot mount admin-only monitor/incidents. Do not solve this by allowing managers all Operator panels.
- User area/section/view selection pushes history. Alias canonicalization replaces. Debounced text/filter changes replace and reset paging. Page navigation policy is documented consistently. Hydration/reload/back selects the existing URL before its request, not after a wrong default fetch.
- Keep safe source/search/owner/date/status/class/archive/page/record context by per-entry allowlist; preserve fragment anchors when registered. Strip token/session/secret-like values. Never normalize a contradictory retained source fingerprint into a different source, and never call recovery/materialization on navigation.
- Keep Contact ID, Company ID, Business ID, Deal ID and source/provider identifiers typed. A numeric `id` does not define its entity; incoming GHL/source identity is not automatically a local contact. Unresolvable links show an explicit outcome without writes.
- Contact25 and Prospecting13 + staging + Canonical5 parsers/builders receive direct and mounted harness tests in C1. Their full live grouped rendering remains C2/C3. A mapping-only pass is not production Contact/Prospecting repair. C1 owns actual financial/operator compatibility wiring necessary to prove its adapters; C4/C5 later design those full workspaces.

The existing ContactsAndLeads legacy `prospect-staging` return currently precedes its useState/useEffect calls. If this parser is changed in C1, keep hooks unconditional or resolve the alias before mounting the hub; test same-component URL transition into/out of that legacy value. The conditional hook-order hazard is source-visible; a browser exception has not been reproduced in this audit.

### C1-R04 exact representative consumers

Use `/dashboard/contacts-leads?tab=people` and the existing agent `/dashboard/contacts` wrapper for **one shared People worklist**. Consume `useContacts` plus `useContactsFacets` and existing shared A readers. Implement real toolbar/search, server50 default with25/50/100 choices supported by `/api/contacts`, paging, page-only selection, narrow cards, retry and record anchors. Preserve all existing filter and B action semantics; do not remove create/assign/archive/restore or expose hard delete. Mount `RecordHeader` on `/dashboard/contacts/:id` using its existing read authority. Keep its current outer composition and conditional section capabilities for C2.

Do not fabricate a paginated Tasks DTO: HTTP `/api/tasks` does not accept paging today even though storage has optional limit/offset. Full Work pagination is a bounded later dependency for C2/A using the same authority. A task array length can be labelled loaded rows, not server total. Do not add a second task predicate in C1 to make a generic component look complete.

Shared primitives are usable and typed: PageHeader, AreaNav, MetricStrip, Toolbar, DataTable/card renderer, RecordHeader, ActionMenu, DataState, IntegrationStatus, DetailDrawer. Combine with existing components when they already satisfy a behavior. Add no new component library. The C1 representative must demonstrate states, links and actual handler preservation; all CRM pages are not redesigned by this task.

### C1-R05 request and cache contract

`queryKey` represents endpoint family plus actor ID/role or permission generation, scope and normalized filters. `queryFn` builds the actual HTTP URL separately and consumes `signal`. Do **not** append actor/role objects to keys and then feed them into existing `queryKey.join('/')`. Keep a stable endpoint-family prefix or update every actual mutation invalidator together. Read cancellation does not replace B command idempotency/versioning.

Scope-specific last-known data can remain visible after a refresh error with stale/asOf messaging. It must never survive an account/role/scope boundary. Cancel pending protected reads, remove former protected cache entries and reset selection/record drawers before showing the new context. Preserve auth/MFA continuation behavior and public caches. Logout uses a hard reload today; prove context transitions rather than asserting an always-reproducible logout leak. Retry/focus behavior is explicit per adopted query, not a global switch to polling Infinity-stale cached data.

### C1-R06 portal and brand isolation

CRM scope includes employee admin/manager/agent surfaces only. `/dashboard/merchant-portal` uses the shared layout today, so decorating every ProtectedRoute or DashboardLayout indiscriminately violates the task. Partner/admin partner portal entrances and `/mobile/*` keep their existing separate layout contracts.

The theme must reach Dialog/Sheet/Select/Dropdown/Popover/Tooltip/AlertDialog/ContextMenu content, nested children and Toaster notifications generated by an adopted CRM surface. Apply the scoped class/variables to portal content or a purpose-built portal container through a context-aware adapter. Verify the actual supported Radix API rather than blindly adding unsupported `container` props to wrappers. Avoid global body CRM classes, and avoid moving overlays into clipped main/scroll descendants. Test nested select inside dialog, keyboard focus return, escape, scroll and theme changes while open. Close buttons and menu options also need44px targets.

## 4. Amended #2072 execution contract

**Apply this amendment to #2072 in place.** It supersedes conflicting assertions in the attached summary, retained prompt and historical register. All compatible original requirements, exact branding, source IDs and kill lines remain. The immutable original task is retained in Appendix D for comparison. Remote task editing is a Replit handoff action, not something this audit claims to have performed.

**What and why:** Build one typed destination/query registry, safe URL adapters, employee-scoped Liberty theme and actual reusable list/record primitives. Repair the financial/operator compatibility defects with minimal current consumer wiring. Deliver People worklist and Contact RecordHeader adoption as the representative proof. Leave existing menu activation and complete workspace composition to their designated C2–C5 owners.

**Done looks like:**

1. All147 existing dashboard patterns and every discovered added/mobile boundary have source owner, effective wrapper/child capability, entity namespace, allowed query/default/conflict outcome, current versus future target, alias/history behavior and safe retirement condition. All309 historical rows have a current disposition and remaining owner. None is certified functional from inventory alone.
2. Financial and Operator mounted chains work on direct entry/click/reload/back/forward and deny unauthorized child reads. Contact/Prospecting shared contracts are complete and mounted-harness tested, with actual later C2/C3 adoption expressly pending where not changed here.
3. People list/record header use real existing reads and actions; paging/selection/filter/reset/row links/retry work; mutation receipts use disposable preview. No production mock data or parallel authority.
4. Exact scoped tokens, compiled fonts,44px targets, overlays, responsive states and zoom pass. Existing public/merchant/partner/dedicated-mobile branding remains isolated.
5. Registered relevant tests plus supported stock gates have honest results, introduced/affected/baseline failures are distinguished, all claimed actions have receipts, and C2–C5 receive actual interfaces and component destinations. No premature sidebar cutover, deployment or Stage3 GO.

**Implementation sequence:** portable inputs and baseline → registry/ownership → URL adapters and minimum mounted compatibility repairs → theme/portal adapters and shared primitives → actual People/RecordHeader adoption → cancellation/cache/scope checks → compiled behavioral/visual verification → same-task handoff and canonical report/ledger update. Recheck current main first; preserve concurrent changes.

**No schema change required** for this C1 contract. Use URL presets. The existing saved-filters capability must not be described as absent. Record its ID-only deletion as a source-confirmed authority gap with A/B as repair owner: pass the authenticated actor into deletion, predicate by both ID and owner, return a non-disclosing denial/not-found outcome, and prove another user cannot delete the fixture. No runtime exploit is claimed. Persistent editing must not reuse that unsafe path. C1 does not silently add that scope or activate unsafe controls. No migration reservations are needed; recheck current journal only if an expressly justified later additive scope changes.

**Out of scope:** complete C2 daily work/25-section Contact regrouping; complete C3 Prospecting/Campaigns; C4 lifecycle/report UI; C5 Administration/Resources/global shell cutover; new backend metric/access/action authority; native retained recovery or diagnostics; provider execution, sending, enrollment, worker/schedule changes, production mutation, deployment and final release freeze/certification.

## 5. Requirement and ownership ledger

The identifiers below are audit requirement references, not original finding IDs. Each independently testable requirement gets a final build outcome; contract rows remain pending until implemented/tested.

| Requirement | Required result | Owner / present disposition |
| --- | --- | --- |
| Q01 | Current source/branch/journal/toolchain recorded | C1; source verified |
| Q02 | Complete portable original/common/current inheritance with hashes | C1; export private text if present |
| Q03 | Original95/14 groups/eight tasks and IDs preserved | C1; accounting preserved |
| Q04 |147 paths assigned once | C1; source census verified, new registry pending |
| Q05 | Effective route/child guards explicit | C1; source wrappers captured, metadata pending |
| Q06 | Entity namespace and source identity explicit | C1; typed implementation pending |
| Q07 | Query allowlist/default/duplicate/invalid outcomes | C1; pending |
| Q08 | Safe aliases and fragments/filter/record retention | C1; pending |
| Q09 | Correct push/replace/back/reload semantics | C1 adapters; C2–C5 adoption |
| Q10 | Financial mounted child matches legacy intent | C1 minimum repair; C4 full workspace |
| Q11 | Operator mounted parent/child state retained | C1 minimum repair; C5 full workspace |
| Q12 | Contact25 mapped including conditionals/drawers | C1 contract; C2 rendering |
| Q13 | Prospecting13/staging/Canonical5 mapped | C1 contract; C3 rendering |
| Q14 | Reports6→4 and financial3 retained | C1 contract; C4 rendering |
| Q15 | Administration11 and Operator46 mapped | C1 contract; C5 rendering, privileged controls intact |
| Q16 |309 historical rows retained with later dispositions | C1 inventory; owning task actual action proof |
| Q17 | All eleven eventual destinations, role-aware | C1 metadata; C5 activation |
| Q18 | Employee theme excludes public/merchant/partner | C1 pending measured proof |
| Q19 | Exact light/dark existing colors/shadows retained | C1 pending measured proof |
| Q20 | IBM Plex typography and deliberate aliases | C1 pending computed proof |
| Q21 |44px triggers/options/close/checkbox/controls | C1 pending measured proof |
| Q22 | Exact spacing/radii/header/sidebar/main geometry | C1 definitions; C5 full shell application |
| Q23 | One adopted H1 and gutter/scroll owner | C1 representative; C2–C5 consumers |
| Q24 | Container-aware table/cards/rail layout | C1 pending |
| Q25 | Portal and nested overlay/toast theme/focus | C1 pending |
| Q26 | Both viewport templates permit zoom | C1 source defect confirmed; repair pending |
| Q27 | Actual200% zoom/reflow, reduced motion | C1 pending browser proof |
| Q28 | Same real rows/read authority in representative | C1 pending |
| Q29 | Supported paging and truthful total/facet scope | C1 pending; task pagination not claimed |
| Q30 | Search250ms, reset paging, stale request cancellation | C1 pending |
| Q31 | Page-only selection and real record anchor | C1 pending |
| Q32 | Mine/Team/Unassigned only backed by predicate | C1 pending; unavailable presets omitted honestly |
| Q33 | URL presets; no unsafe persistence or cross-device promise | C1 fixed scope |
| Q34 | Actor/role/scope cache identity + clearing | C1 pending |
| Q35 | No hidden query/polling or provider call on mount | C1 pending requests/effects proof |
| Q36 | Loading/empty/no-match/denied/unavailable distinct | C1 pending |
| Q37 | Stale/pending/conflict/success truthful | C1 pending |
| Q38 | No null/error→0, fake chart or clickable metric | C1 pending |
| Q39 | Existing B CSRF/version/retry/cancel authority preserved | C1 presentation; B authority unchanged |
| Q40 | Disposable real action readback and wrong-record denial | C1 adopted actions; later tasks own other actions |
| Q41 |320/390/768/1280/1440, light/dark/keyboard | C1 pending browser proof |
| Q42 | Useful list2.5s and local response200ms measured | C1 pending with declared fixture/network |
| Q43 | Shared compiler/preflight/public SSR preserved | C1 pending compiled regression; old B missing suite now stale |
| Q44 | Actual new suites registered with correct capabilities | C1 pending; current172 preserved |
| Q45 | Supported stock install/typecheck/security/build | Executor pending; not run here |
| Q46 | Guarded migration/integration/server gates when applicable | Executor pending; disposable only |
| Q47 | Full action CSV denominator and per-row outcome | C1 adopted surfaces; later action owner explicit |
| Q48 | Source/merge/deploy/schema/provider/live states separated | C1 handoff required |
| Q49 | Scoped rollback, no destructive/data reversal | C1 plan required |
| Q50 | Report/ledger updates after task/audit | This audit updated canonical documents |
| Q51 | Incoming GHL enabled/no-echo; outbound paused/held | Preserve independently; not freshly runtime verified here |
| Q52 | #2077/#2078 execution not duplicated or awaited by independent UI | C1 scope preserved |

### Exact eleven-destination handoff

This retained contract is metadata/compatibility scope in C1; C5 activates the final sidebar only after workspace readiness.

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


### Exact workspace ownership correction

R039 AcquisitionHub now redirects to OutboundCenter analytics. Give that alias a C3 target owner and Campaigns Results group; C5 may retain a privileged discovery link in Resources. R046 Outreach and R047 Outreach Command both target the same command surface; C3 owns it. R109 OutreachHub targets OutboundCenter; C3 owns that alias as well. R107 Underwriting is Merchant Operations/C4. T218 Needs Review, T219 Auto-Approved Today and T220 Rules Config inherit C4 presentation with current privileged rules capability; an Administration rules shortcut does not transfer the whole page to C5.

Before correction, route-owner counts are C2=25/C3=21/C4=38/C5=63; panel-owner counts C2=30/C3=28/C4=67/C5=184. Applying just these four route and three panel ownership corrections yields **route C2=25/C3=24/C4=39/C5=59** and **historical panel C2=30/C3=28/C4=70/C5=181**. These are implementation assignments, not unique finding counts. C1 owns the shared registry separately. Additions discovered during execution retain stable new IDs.

R014 Tickets/R023 RFIs already redirect to a restricted SupportHub. Do not claim a newly introduced agent regression solely from this table or broaden that hub to make it green. Inventory actual agent workflow access and permitted standalone/contextual alternatives under existing backend authority. Preserve non-admin/manager standalone LeadIntelligence and LeadCommandCenter branches at App:375–397. Keep R033 legacy Prospect import until parity. Keep R137 BusinessDetail as business namespace and R147 standalone Canonical Enrichment until its future nested state is actually mounted. R146 Forbidden remains a real boundary, not an alias loop.

## 6. Safety, authorization, concurrency and recovery

K01–K09 in the complete original C1 remain binding. Their implementation meaning is:

- Outbound email/SMS/sequences remain paused; proposals held. No real send/enroll/resume/provider/dial/AI execution, worker/schedule mutation or production native writes. Do not restore removed provider approvals/spend caps or an early release/SFP freeze.
- Incoming GHL remains independently enabled with no-echo. A disabled Send control is not a disabled contact sync. Preserve immutable source subject/fingerprints and imported history.
- Any mutation/session test uses guarded disposable PostgreSQL, identical DATABASE_URL/TEST_DATABASE_URL, NODE_ENV=test, reserved isolated Redis namespace and denied provider transport before imports. No production fixture or db:push/startup DDL/shared flush.
- Backend actors/object/access/class/archive predicates and B command/version/CSRF authority remain canonical. Hidden/forbidden panels cannot mount/query. A new sidebar group grants no additional role access.
- No mass purge/archive/merge, erased consent/audit/source/authority history or native guard bypass. No route deletion before compatibility parity. No error-to-success/empty/zero or decorative actionable metric.
- Stop only affected adoption on wrong entity/tab, role leak, incompatible query, stale replay, public style regression, bad scope or inaccessible behavior; preserve the working entrance and continue independent safe pieces. Roll back CRM-scoped files/consumer wiring, not data or history.
- C1 supplies contracts/primitives; C2–C4 complete their workspaces; C5 activates eleven entries after those are ready; D verifies integrated live build. #2077/#2078 remain independent native/diagnostic owners.

Concurrency proof for C1 centers on overlapping read requests, filter/record changes, account/role changes and selection reset. Existing B actions still need double-click, stale-version, cancellation, timeout-after-commit and retry proof when exposed by adopted controls; do not add local booleans as durable authority. Portal focus/unsaved state must stay tied to the correct record on navigation. No queue, lease, scheduler or provider pipeline changes are proposed. Existing authority remains untouched and must be checked by negative-effect tests on navigation/mount.

## 7. Existing gates and exact searches

All seven exact original SectionD grep expressions were rerun against this source. These are discovery results, not behavioral passes. Match counts are output lines, not distinct defects. Manual review covered the relevant ownership and parent/child/read/portal call chains stated in this report; the full1252 query lines were not individually certified.

| Check | Exact scope/pattern | Exit | Match lines | Disposition |
| --- | --- | --- | --- | --- |
| legacy-role-routes | `rg -n Legacy|Redirect|path=|allowedRoles|role === client/src/App.tsx` | 0 | 382 | Relevant current source matches reviewed; discovery only |
| font-aliases | `rg -n font-sans|font-serif|font-body|--font-sans|--font-serif|--font-body|--font-display client/src/index.css tailwind.config.ts client/src/components` | 0 | 7 | Relevant current source matches reviewed; discovery only |
| viewport-fonts | `rg -n maximum-scale|IBM.Plex|fonts.googleapis client/index.html` | 0 | 3 | Relevant current source matches reviewed; discovery only |
| shell-geometry | `rg -n h-14|--sidebar-width|h-8|max-w-7xl|p-3 client/src/pages/DashboardLayout.tsx` | 0 | 11 | Relevant current source matches reviewed; discovery only |
| child-url-state | `rg -n financialTab|tab|view|stagingTab|VALID_TABS|activeTab client/src/pages/dashboard/FinancialHub.tsx client/src/pages/dashboard/ContactDetail.tsx client/src/pages/dashboard/LeadOpsCenter.tsx client/src/pages/dashboard/OperatorDashboard.tsx` | 0 | 689 | Relevant current source matches reviewed; discovery only |
| new-crm-symbols | `rg -n crm-theme|CrmPageHeader|ScopedMetricStrip|WorklistToolbar|CrmDataState|crm-destinations client/src` | 1 | 0 | Expected absent before C1 build, not failed implementation |
| query-loading | `rg -n useQuery|refetchInterval|enabled|forceMount|limit=5000 client/src/pages/dashboard` | 0 | 1252 | Relevant current source matches reviewed; discovery only |
| diff-whitespace | `git diff --check` | 0 | 0 | Clean whitespace diff; no edits |

Additional required build discovery checks (review actual matches; do not interpret rg1 automatically as failure or pass):

```bash
rg -n 'maximum-scale|user-scalable' client/index.html server/ssrShared.ts
rg -n 'async \(\{ queryKey|queryKey.join|signal|staleTime|cancelQueries|removeQueries|meta:' client/src/lib/queryClient.ts client/src/hooks/use-auth.ts client/src/hooks/use-contacts.ts client/src/components/crm
rg -n 'Portal|DialogContent|SheetContent|SelectContent|Toaster|crm-theme' client/src/components client/src/App.tsx
rg -n '<h1|text-contact-name|text-page-title|p-3|p-6|max-w-7xl|sidebar-width' client/src/pages/DashboardLayout.tsx client/src/pages/dashboard/Contacts.tsx client/src/pages/dashboard/ContactDetail.tsx
rg -n 'api/tasks|limit|offset|getTasks' server/routes/tickets-tasks.ts server/storage/tasks.ts client/src/pages/dashboard/Tasks.tsx
rg -n 'api/contacts|facets|parseStrictPagination|readPeople' server/routes/contacts.ts client/src/hooks/use-contacts.ts
rg -n 'saved-filters|deleteSavedFilter|userId' server/routes/templates-settings.ts server/storage/misc.ts
rg -n 'provider-results|STAGING_SUBTABS|VALID_TABS|canonicalView' client/src/pages/dashboard/LeadOpsCenter.tsx client/src/pages/dashboard/CanonicalEnrichment.tsx
rg -n 'SSR Style Isolation|test-ssr-style-isolation|stage3-c1' scripts/ci-suite-manifest.ts scripts/pre-deploy.ts
rg -n 'forceMount|refetchInterval|useQuery|enabled' client/src/components/crm client/src/pages/dashboard/Contacts.tsx client/src/pages/dashboard/ContactDetail.tsx
```

**Gate results here:** git diff --check clean; source census and static suite-list comparison verified. Stock install, typecheck, security, production build, actual manifest checker, DB/migrations, session/action/browser/accessibility/performance/native gates **NOT RUN**. Local Node24/npm11 and missing installed tsx/tsc are unsuitable for the supported execution receipt. No synthetic pass,127-as-pass or unsupported-toolchain release claim.

**Build executor:** use supported Node22.22/npm10.9.4 and checked-in lockfile. Run original Section8 commands: npm ci --include=dev --ignore-scripts --no-audit --no-fund; dependency-policy and inventory checks; real manifest --check; npm run check; capability-classified deterministic-static, external-security and writable-build gates. Use current CI isolation/startup guards for any needed canonical apply-twice/integration/server/session/browser proof. Preserve every current suite and register new C1 checks. SSR Style Isolation is already registered; do not count adding it again as a fix.

Reported45 baseline failures require exact current receipts and untouched-base comparison where reproducible. Fix task-introduced and task-affected failures. Record unchanged failures honestly without waiving task-specific acceptance or declaring the release green. C1 implementation can proceed while independent later evidence is pending; a task with missing mandatory acceptance receipts is not code/test complete.

## 8. Verification matrix and handoff

| Group | Required test behavior | Proof boundary |
| --- | --- | --- |
| Navigation | Every147 registry row resolves to current allowed destination or explicit safe reason; relevant aliases preserve source/ID/filter/fragment state | Metadata and mounted adapter proof; full later routes get owning C2–C5 receipts |
| Financial | Legacy Forecasting/Revenue/ROI and nested Reporting child; conflict input; direct/reload/back | Actual child visible with correct request, not URL-string assertion |
| Operator | Legacy raw query; monitor view change; parent change; manager forbidden monitor; all46 valid views catalogued | No parent loss; denied monitor never mounts/requests |
| Contact/Prospecting contract |25 Contact keys,13 LeadOps keys, two staging selectors, five Canonical views; role/record conditionals | Codec and mounted harness in C1; later actual grouped-render verdict expressly pending |
| Representative list | Real People rows/facets;50/25/100; search250ms; filter resets; retry; unavailable facets with usable rows | Same authority/scope, no loaded-row totals, no mock production data |
| Representative record/actions | Real contact read and record header; link namespace; permission reasons; retained current permitted action and cancel behavior | Disposable durable action readback, audit/version receipt where action exposed; production read-only |
| Requests/cache | Out-of-order old requests, inactive tabs, role/account switches, same-scope stale refresh | AbortSignal consumed, old protected data/effects zero, invalidators still work |
| Visual | Exact tokens/fonts/geometry;320/390/768/1280/1440; light/dark; keyboard/200% zoom; reduced motion/long text | Actual production-compiled computed styles/screenshots; not design screenshot alone |
| Portals | Select in dialog, menu/tooltip/sheet/alert/toast, focus return/escape/scroll/theme switch | All overlays scoped without public body mutation/clipping |
| Isolation | Public marketing SSR/forms, merchant/partner portals, dedicated mobile | Existing layout/typography retained; only deliberate viewport accessibility change |
| Safety | Navigation/mount effects, paused sends, GHL sync separation; denied provider transport in tests | No external execution; real runtime modes only if freshly read with dated identity |
| Evidence | action CSV totals/pass/defect/blocked/untested, registry/state dispositions, performance/asOf and source/build identity | No original finding auto-closed; D retains integrated live verdict |

Create/retain `docs/certification/stage3-c1/actions.csv` with original required columns from AppendixD's inherited prompt, plus a clear ownership/disposition record for all309 historical entries. Execute every control added/changed/adopted by C1, including expected-disabled reasons. Do not require C1 to execute all later-workspace actions simply because their historical rows are in the common inventory. Those get explicit C2–C5 owners, not silent passes or undifferentiated “blocked”. Every adopted mutation requires request/handler/authorization/durable refresh readback, not modal-open proof.

Current shared files overlap A/B and future C tasks: App, DashboardLayout, queryClient/use-auth/use-contacts, primitives/theme, manifest/pre-deploy and docs. Preserve latest A/B readers, CSRF/prepared work commands, version/idempotency/invalidation contracts and Tailwind/SSR repair. No migration collision introduced; no applied migration edited. Recheck the branch before build and re-review any changed canonical symbol.

**Build Mode handoff:** update **#2072** with Sections3–8 and retain the complete original C1 prompt/known kill lines. Then implement and verify the bounded scope in one task. Do not send a new audit-only task or native diagnostics task. If private binding files contain materially additional requirements, export and reconcile the exact content before its dependent work; independent safe work continues. Return changed files/final source SHA, registered tests/results, scoped screenshots/metrics, action denominator/outcomes, rollback and explicit remaining C2–C5/D/#2077/#2078 boundaries.

**Status separation:** task contract corrected in this file; remote task update not performed; implementation/code complete not claimed; no commit/merge/deploy; no schema applied; credentials/provider connection/activation/live runtime not refreshed; no sends or incoming-sync toggle. Stage3 remains in progress.

## Appendix A. Complete shared Liberty visual contract retained

The following is copied from the complete retained C1 prompt. It remains the exact brand/design specification, with **these clarifications**: interactive table headers grow to >=44px; cards/rail respond to available container as well as viewport; adopted surfaces have one H1/gutter; scopes include portaled content and exclude merchant/partner; remove max-scale in both templates. Existing token values are preserved. Proposed tokens are implementation targets and require compiled measurement.


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


## Appendix B. Exact Contact 25-key shared mapping

C2 owns grouped rendering. C1 publishes/test-drives this existing agreed contract; no conditional key is dropped because an admin example showed22.

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


## Appendix C. Current 147-route source census and corrected render ownership

This is a code-derived census, not a runtime/action pass or the implemented registry. Effective alias guard must be evaluated at its target; SystemHealth adds admin-only child guards. Ordinary ProtectedRoute redirects partner/merchant before rendering employee content; standalone Forbidden and dedicated mobile/partner boundaries remain explicit. C1 must enrich every row with typed entity/query/retirement contracts, rather than treating generic historical guard text as complete.

| Original route ID | Current pattern | Current component or alias target | Current wrapper disposition | Primary workspace owner |
| --- | --- | --- | --- | --- |
| R-001 | `/dashboard/partner` | `PartnerPortal` | PartnerProtectedRoute: partner/admin; outside employee theme | C4 / Merchant Operations / portal boundary |
| R-002 | `/dashboard/mobile/contacts/:id` | `mobile compatibility` | mobile compatibility redirect; MobileApp owns access | C2 / Scoped mobile / access boundary |
| R-003 | `/dashboard/mobile/pipeline` | `mobile compatibility` | mobile compatibility redirect; MobileApp owns access | C2 / Scoped mobile / access boundary |
| R-004 | `/dashboard/mobile/tasks` | `mobile compatibility` | mobile compatibility redirect; MobileApp owns access | C2 / Scoped mobile / access boundary |
| R-005 | `/dashboard/mobile` | `mobile compatibility` | mobile compatibility redirect; MobileApp owns access | C2 / Scoped mobile / access boundary |
| R-006 | `/dashboard` | `Overview` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C2 / Today / contextual AI |
| R-007 | `/dashboard/companies/:id` | `CompanyDetail` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C2 / Records |
| R-008 | `/dashboard/contacts/:id` | `ContactDetail` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C2 / Records |
| R-009 | `/dashboard/contacts` | `Contacts` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C2 / Records |
| R-010 | `/dashboard/my-leads` | `Leads` | AgentRoute: agent | C2 / Records |
| R-011 | `/dashboard/chat` | `Chat` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C2 / Today / contextual AI |
| R-012 | `/dashboard/pipeline` | `Pipeline` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C2 / Pipeline |
| R-013 | `/dashboard/onboarding` | `OnboardingHub` | ProtectedRoute: admin/manager | C4 / Merchant Operations |
| R-014 | `/dashboard/tickets` | `/dashboard/support-hub?tab=tickets` | legacy alias; destination guard applies | C4 / Merchant Operations |
| R-015 | `/dashboard/tasks` | `/dashboard/tasks-appointments?tab=tasks` | legacy alias; destination guard applies | C2 / Work / header notifications |
| R-016 | `/dashboard/notifications` | `Notifications` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C2 / Work / header notifications |
| R-017 | `/dashboard/call-outcome` | `CallOutcome` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C2 / Record contextual tool |
| R-018 | `/dashboard/review-complete` | `ReviewComplete` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C2 / Record contextual tool |
| R-019 | `/dashboard/review-requests` | `/dashboard/merchant-success?tab=reviews` | legacy alias; destination guard applies | C4 / Merchant Operations |
| R-020 | `/dashboard/testimonial-submissions` | `/dashboard/merchant-success?tab=testimonials` | legacy alias; destination guard applies | C4 / Merchant Operations |
| R-021 | `/dashboard/onboarding-kickoff` | `OnboardingKickoff` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C4 / Merchant Operations |
| R-022 | `/dashboard/workflows` | `Workflows` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C5 / Administration / operational controls |
| R-023 | `/dashboard/rfis` | `/dashboard/support-hub?tab=rfis` | legacy alias; destination guard applies | C4 / Merchant Operations |
| R-024 | `/dashboard/review-queue` | `/dashboard/support-hub?tab=review-queue` | legacy alias; destination guard applies | C4 / Merchant Operations |
| R-025 | `/dashboard/case-study-intake` | `CaseStudyIntake` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C5 / Resources / privileged acquisition tools |
| R-026 | `/dashboard/ghl-settings` | `/dashboard/ghl-integration?tab=settings` | legacy alias; destination guard applies | C5 / Administration / operational controls |
| R-027 | `/dashboard/ghl-workflows` | `/dashboard/ghl-integration?tab=workflow-ids` | legacy alias; destination guard applies | C5 / Administration / operational controls |
| R-028 | `/dashboard/automation` | `Automation` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C5 / Administration / operational controls |
| R-029 | `/dashboard/contacts-leads` | `ContactsAndLeads` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C2 / Records |
| R-030 | `/dashboard/tasks-appointments` | `TasksAppointments` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C2 / Work / header notifications |
| R-031 | `/dashboard/outbound-center` | `OutboundCenter` | ProtectedRoute: admin/manager | C3 / Campaigns |
| R-147 | `/dashboard/canonical-enrichment` | `CanonicalEnrichment` | ProtectedRoute: admin/manager | C3 / Prospecting |
| R-032 | `/dashboard/prospects` | `LegacyProspectsRedirect` | ProtectedRoute: admin/manager | C3 / Prospecting |
| R-033 | `/dashboard/prospects/import` | `ProspectImport` | ProtectedRoute: admin/manager | C3 / Prospecting |
| R-034 | `/dashboard/lead-imports` | `LegacyLeadImportsRedirect` | ProtectedRoute: admin/manager | C3 / Prospecting |
| R-035 | `/dashboard/master-lead-database` | `LegacyMasterLeadDatabaseRedirect` | ProtectedRoute: admin | C3 / Prospecting |
| R-036 | `/dashboard/campaigns` | `/dashboard/outbound-center?tab=campaigns` | legacy alias; destination guard applies | C3 / Campaigns |
| R-037 | `/dashboard/outreach-analytics` | `/dashboard/reporting?tab=outreach-analytics` | legacy alias; destination guard applies | C4 / Reports |
| R-038 | `/dashboard/reporting` | `ReportingHub` | ProtectedRoute: admin/manager | C4 / Reports |
| R-039 | `/dashboard/acquisition-hub` | `/dashboard/outbound-center?tab=analytics` | legacy alias; destination guard applies | C3 / Campaigns Results |
| R-040 | `/dashboard/win-loss` | `/dashboard/reporting?tab=win-loss` | legacy alias; destination guard applies | C4 / Reports |
| R-041 | `/dashboard/stage-rules` | `StageRules` | ProtectedRoute: admin/manager | C2 / Pipeline |
| R-042 | `/dashboard/sequences` | `/dashboard/outbound-center?tab=sequences` | legacy alias; destination guard applies | C3 / Campaigns |
| R-043 | `/dashboard/lead-gen` | `LeadGenCleaner` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C3 / Prospecting |
| R-044 | `/dashboard/lead-intelligence` | `LegacyLeadIntelligenceRedirect` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C3 / Prospecting |
| R-045 | `/dashboard/statement-review` | `StatementReview` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C4 / Merchant Operations |
| R-046 | `/dashboard/outreach` | `/dashboard/outbound-center?tab=command` | legacy alias; destination guard applies | C3 / Campaigns Command |
| R-047 | `/dashboard/outreach-command` | `/dashboard/outbound-center?tab=command` | legacy alias; destination guard applies | C3 / Campaigns |
| R-048 | `/dashboard/lead-engine` | `LegacyLeadIntelligenceRedirect` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C3 / Prospecting |
| R-049 | `/dashboard/lead-command-center` | `LegacyLeadCommandCenterRedirect` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C3 / Prospecting |
| R-050 | `/dashboard/blaze` | `/dashboard/content-hub?tab=blaze` | legacy alias; destination guard applies | C5 / Resources / privileged acquisition tools |
| R-051 | `/dashboard/merchant-applications` | `MerchantApplicationsList` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C4 / Merchant Operations |
| R-052 | `/dashboard/boarding` | `BoardingTracker` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C4 / Merchant Operations |
| R-053 | `/dashboard/onboarding-board` | `/dashboard/onboarding?tab=board` | legacy alias; destination guard applies | C4 / Merchant Operations |
| R-054 | `/dashboard/merchant-portal` | `MerchantPortal` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C4 / Merchant Operations / portal boundary |
| R-055 | `/dashboard/merchant-health` | `/dashboard/merchant-risk?tab=health` | legacy alias; destination guard applies | C4 / Merchant Operations |
| R-056 | `/dashboard/chargebacks` | `/dashboard/merchant-risk?tab=chargebacks` | legacy alias; destination guard applies | C4 / Merchant Operations |
| R-057 | `/dashboard/nps` | `/dashboard/merchant-success?tab=nps` | legacy alias; destination guard applies | C4 / Merchant Operations |
| R-058 | `/dashboard/retention-campaigns` | `/dashboard/merchant-success?tab=retention` | legacy alias; destination guard applies | C4 / Merchant Operations |
| R-059 | `/dashboard/agent-management` | `AgentManagement` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C5 / Administration / operational controls |
| R-060 | `/dashboard/my-earnings` | `MyEarnings` | ProtectedRoute: agent | C4 / Reports |
| R-061 | `/dashboard/residual-revenue` | `/dashboard/financial-hub?tab=revenue` | legacy alias; destination guard applies | C4 / Reports |
| R-062 | `/dashboard/referral-program` | `ReferralProgram` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C4 / Merchant Operations |
| R-063 | `/dashboard/partner-referral-pipeline` | `PartnerReferralPipeline` | ProtectedRoute: admin/manager | C4 / Merchant Operations / partner administration |
| R-064 | `/dashboard/partner-portal` | `PartnerPortalAdmin` | ProtectedRoute: admin/manager | C4 / Merchant Operations / partner administration |
| R-065 | `/dashboard/partner-orgs` | `PartnerOrgs` | ProtectedRoute: admin | C4 / Merchant Operations / partner administration |
| R-066 | `/dashboard/co-branded-proposals` | `CoBrandedProposals` | ProtectedRoute: admin/manager | C4 / Merchant Operations |
| R-067 | `/dashboard/knowledge-base` | `KnowledgeBase` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C5 / Resources |
| R-068 | `/dashboard/knowledge-admin` | `KnowledgeAdmin` | ProtectedRoute: admin/manager | C5 / Resources |
| R-069 | `/dashboard/consent-audit` | `/dashboard/admin-hub?tab=consent` | legacy alias; destination guard applies | C5 / Administration / operational controls |
| R-070 | `/dashboard/calendar` | `/dashboard/tasks-appointments?tab=calendar` | legacy alias; destination guard applies | C2 / Work / header notifications |
| R-071 | `/dashboard/user-management` | `/dashboard/admin-hub?tab=users` | legacy alias; destination guard applies | C5 / Administration / operational controls |
| R-072 | `/dashboard/permissions` | `/dashboard/admin-hub?tab=permissions` | legacy alias; destination guard applies | C5 / Administration / operational controls |
| R-073 | `/dashboard/security` | `SecuritySettings` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C5 / Administration / operational controls |
| R-074 | `/dashboard/settings/integrations` | `SettingsIntegrations` | ProtectedRoute: admin/manager | C5 / Administration / operational controls |
| R-075 | `/dashboard/settings/arbitration` | `ArbitrationLog` | ProtectedRoute: admin/manager | C5 / Administration / operational controls |
| R-076 | `/dashboard/forecasting` | `/dashboard/financial-hub?tab=forecasting` | legacy alias; destination guard applies | C4 / Reports |
| R-077 | `/dashboard/pci-assessment` | `/dashboard/admin-hub?tab=pci` | legacy alias; destination guard applies | C5 / Administration / operational controls |
| R-078 | `/dashboard/data-requests` | `DataRequests` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C5 / Administration / operational controls |
| R-079 | `/dashboard/audit-logs` | `/dashboard/admin-hub?tab=audit-log` | legacy alias; destination guard applies | C5 / Administration / operational controls |
| R-080 | `/dashboard/blog-generator` | `/dashboard/content-hub?tab=blog` | legacy alias; destination guard applies | C5 / Resources / privileged acquisition tools |
| R-081 | `/dashboard/content` | `/dashboard/content-hub?tab=content` | legacy alias; destination guard applies | C5 / Resources / privileged acquisition tools |
| R-082 | `/dashboard/social` | `/dashboard/content-hub?tab=linkedin` | legacy alias; destination guard applies | C5 / Resources / privileged acquisition tools |
| R-083 | `/dashboard/sdr` | `/dashboard/sdr-hub?tab=sdr` | legacy alias; destination guard applies | C5 / Administration / operational controls |
| R-084 | `/dashboard/sms-inbox` | `/dashboard/comms-hub?tab=messages` | legacy alias; destination guard applies | C2 / Inbox |
| R-085 | `/dashboard/bin-lookup` | `BinLookup` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C2 / Record contextual tool |
| R-086 | `/dashboard/round-robin` | `RoundRobinAdmin` | ProtectedRoute: admin/manager | C5 / Administration / operational controls |
| R-087 | `/dashboard/inbox-health` | `/dashboard/deliverability-hub?tab=inbox-health` | legacy alias; destination guard applies | C5 / Administration / operational controls |
| R-088 | `/dashboard/email-health` | `/dashboard/deliverability-hub?tab=email-health` | legacy alias; destination guard applies | C5 / Administration / operational controls |
| R-089 | `/dashboard/activation` | `ActivationPanel` | ProtectedRoute: admin/manager | C5 / Administration / operational controls |
| R-090 | `/dashboard/setup-wizard` | `SetupWizard` | ProtectedRoute: admin/manager | C5 / Administration / operational controls |
| R-091 | `/dashboard/operator` | `LegacyOperatorRedirect` | legacy alias; destination guard applies | C5 / Administration / operational controls |
| R-092 | `/dashboard/seo-health` | `/dashboard/system-health?tab=seo` | legacy alias; destination guard applies | C5 / Administration / operational controls |
| R-093 | `/dashboard/system-readiness` | `/dashboard/system-health?tab=readiness` | legacy alias; destination guard applies | C5 / Administration / operational controls |
| R-094 | `/dashboard/training` | `Training` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C5 / Resources |
| R-095 | `/dashboard/leaderboard` | `Leaderboard` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C4 / Reports |
| R-096 | `/dashboard/terminal-roi` | `/dashboard/financial-hub?tab=terminal-roi` | legacy alias; destination guard applies | C4 / Reports |
| R-097 | `/dashboard/my-day` | `SalesRepHome` | AgentRoute: agent | C2 / Today / contextual AI |
| R-098 | `/dashboard/live-chat` | `/dashboard/comms-hub?tab=live-chat` | legacy alias; destination guard applies | C2 / Inbox |
| R-099 | `/dashboard/document-vault` | `DocumentVault` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C4 / Merchant Operations |
| R-100 | `/dashboard/virtual-terminal` | `/dashboard` | legacy alias; destination guard applies | C5 / Administration / operational controls |
| R-101 | `/dashboard/ghl-sequence-guide` | `/dashboard/ghl-integration?tab=sequence-guide` | legacy alias; destination guard applies | C5 / Administration / operational controls |
| R-102 | `/dashboard/marketing-playbook` | `/dashboard/playbooks?tab=marketing` | legacy alias; destination guard applies | C5 / Resources |
| R-103 | `/dashboard/growth-playbook` | `/dashboard/playbooks?tab=growth` | legacy alias; destination guard applies | C5 / Resources |
| R-104 | `/dashboard/growth-kpi` | `/dashboard/reporting?tab=growth` | legacy alias; destination guard applies | C4 / Reports |
| R-105 | `/dashboard/widget-generator` | `WidgetGenerator` | ProtectedRoute: admin/manager | C5 / Resources / privileged acquisition tools |
| R-106 | `/dashboard/cold-leads` | `/dashboard/outbound-center?tab=prospects` | legacy alias; destination guard applies | C3 / Campaigns |
| R-107 | `/dashboard/underwriting` | `UnderwritingPage` | ProtectedRoute: admin/manager | C4 / Merchant Operations Underwriting |
| R-108 | `/dashboard/conversation-ai` | `/dashboard/sdr-hub?tab=chatbot` | legacy alias; destination guard applies | C5 / Administration / operational controls |
| R-109 | `/dashboard/outreach-hub` | `/dashboard/outbound-center` | legacy alias; destination guard applies | C3 / Campaigns |
| R-110 | `/dashboard/ghl-integration` | `GhlIntegrationHub` | ProtectedRoute: admin/manager | C5 / Administration / operational controls |
| R-111 | `/dashboard/playbooks` | `PlaybooksHub` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C5 / Resources |
| R-112 | `/dashboard/content-hub` | `ContentHub` | ProtectedRoute: admin/manager | C5 / Resources / privileged acquisition tools |
| R-113 | `/dashboard/merchant-success` | `MerchantSuccessHub` | ProtectedRoute: admin/manager | C4 / Merchant Operations |
| R-114 | `/dashboard/portfolio` | `MerchantPortfolio` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C4 / Merchant Operations |
| R-115 | `/dashboard/support-hub` | `SupportHub` | ProtectedRoute: admin/manager | C4 / Merchant Operations |
| R-116 | `/dashboard/comms-hub` | `CommsHub` | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | C2 / Inbox |
| R-117 | `/dashboard/sdr-hub` | `SDRHub` | ProtectedRoute: admin/manager | C5 / Administration / operational controls |
| R-118 | `/dashboard/deliverability-hub` | `DeliverabilityHub` | ProtectedRoute: admin/manager | C5 / Administration / operational controls |
| R-119 | `/dashboard/financial-hub` | `FinancialHub` | ProtectedRoute: admin/manager | C4 / Reports |
| R-120 | `/dashboard/system-health` | `SystemHealthHub` | ProtectedRoute: admin/manager | C5 / Administration / operational controls |
| R-121 | `/dashboard/admin-hub` | `AdminHub` | ProtectedRoute: admin/manager | C5 / Administration / operational controls |
| R-122 | `/dashboard/automation-registry` | `AutomationRegistry` | ProtectedRoute: admin | C5 / Administration / operational controls |
| R-123 | `/dashboard/nba` | `NbaPriorityPage` | ProtectedRoute: admin/manager | C2 / Today / contextual AI |
| R-124 | `/dashboard/merchant-risk` | `MerchantRiskHub` | ProtectedRoute: admin/manager | C4 / Merchant Operations |
| R-125 | `/dashboard/launch-readiness` | `LaunchReadiness` | ProtectedRoute: admin/manager | C5 / Administration / operational controls |
| R-126 | `/dashboard/outbound-readiness` | `OutboundReadiness` | ProtectedRoute: admin/manager | C5 / Administration / operational controls |
| R-127 | `/dashboard/outbound-preflight` | `OutboundPreflight` | ProtectedRoute: admin/manager | C5 / Administration / operational controls |
| R-128 | `/dashboard/data-health` | `DataHealth` | ProtectedRoute: admin/manager | C5 / Administration / operational controls |
| R-129 | `/dashboard/data-quality` | `LegacyDataQualityRedirect` | ProtectedRoute: admin/manager | C3 / Prospecting |
| R-130 | `/dashboard/blocked-contacts` | `BlockedContacts` | ProtectedRoute: admin/manager | C5 / Administration / operational controls |
| R-131 | `/dashboard/deliverability-settings` | `DeliverabilitySettings` | ProtectedRoute: admin/manager | C5 / Administration / operational controls |
| R-132 | `/dashboard/ghl-conflicts` | `GhlConflicts` | ProtectedRoute: admin/manager | C5 / Administration / operational controls |
| R-133 | `/dashboard/information-flow` | `/dashboard/admin-hub?tab=info-flow` | legacy alias; destination guard applies | C5 / Administration / operational controls |
| R-134 | `/dashboard/contact-census` | `ContactCensus` | ProtectedRoute: admin | C3 / Prospecting |
| R-135 | `/dashboard/system-audit` | `SystemAudit` | ProtectedRoute: admin/manager | C5 / Administration / operational controls |
| R-136 | `/dashboard/queue-holds` | `QueueHoldsPage` | ProtectedRoute: admin | C5 / Administration / operational controls |
| R-137 | `/dashboard/lead-ops/business/:id` | `BusinessDetailPage` | ProtectedRoute: admin/manager | C3 / Prospecting |
| R-138 | `/dashboard/lead-ops` | `LeadOpsCenter` | ProtectedRoute: admin/manager | C3 / Prospecting |
| R-139 | `/dashboard/identity-crosswalk` | `IdentityCrosswalk` | ProtectedRoute: admin | C3 / Prospecting |
| R-140 | `/dashboard/outreach-queue` | `OutreachQueue` | ProtectedRoute: admin/manager/agent | C3 / Prospecting |
| R-141 | `/dashboard/executive` | `ExecutiveDashboard` | ProtectedRoute: admin/manager | C4 / Reports |
| R-142 | `/dashboard/sequence-report` | `SequenceReport` | ProtectedRoute: admin/manager | C3 / Campaigns |
| R-143 | `/dashboard/ghl-workflow-ids` | `/dashboard/ghl-integration?tab=workflow-ids` | legacy alias; destination guard applies | C5 / Administration / operational controls |
| R-144 | `/dashboard/social-composer` | `/dashboard/content-hub?tab=linkedin` | legacy alias; destination guard applies | C5 / Resources / privileged acquisition tools |
| R-145 | `/dashboard/blaze-integration` | `/dashboard/content-hub?tab=blaze` | legacy alias; destination guard applies | C5 / Resources / privileged acquisition tools |
| R-146 | `/dashboard/forbidden` | `Forbidden` | standalone Forbidden boundary | C5 / Scoped mobile / access boundary |

## Appendix D. Original supplied task preserved

This is the unmodified supplied task, preserved for diff/review. The amended contract above supersedes its conflicting scope/acceptance assumptions. The full790-line inherited prompt, including every309 historical panel row, is tracked at `attached_assets/LIBERTY_STAGE3_TASK_C1_PREFLIGHT_BUILD_MASTER_PROMPT_1791318462918.md`; it was read and its row counts verified. The current147 source census and ownership amendments above replace only conflicting assertions.

# #2072 - Shared Liberty CRM Foundation

## Current HEAD inheritance refresh

Current source baseline: `442fd044f10f52db4bf391dabcb1299403314eaf`, merged Task #2071 local code-fix milestone, parent `94a4742d5d1953ea8102071aee2b9b5553ad1d06`. The initial `5d19e8c5410ffb5dea754fba894fe0be4d158642` source audit is historical. Read `.local/tasks/liberty-stage3-post-2071-audit.md` in full as a binding update to this plan and common evidence; all unmodified original assignment/register/design/action/kill-line requirements remain mandatory.

No routing/theme/registry implementation was delivered by #2071. All C1 findings and the eleven-destination handoff remain unchanged; preserve the inherited immutable-source identity boundary and expanded gate wiring.

Compatible legacy record/import entrances retain typed source identity and cannot normalize contradictory fingerprints or invoke recovery during navigation.

**Acceptance/ownership:** #2071 merged code is not full retained-recovery acceptance. Existing draft #2077 owns authentic native full-population/foreign-decision/restart/replay certification and release baseline analysis; #2078 owns fresh causal primary diagnostics and post-publication API/worker/cycle/convergence proof. Do not duplicate, execute, declare passed or make independent UI work await these drafts. Preserve originals, immutable history, native unique/FK/append-only guards, incoming GHL enabled/no-echo and outbound paused/proposals held.

**Fresh checks:** All task-specific SectionD greps were repeated at this HEAD (C1 expected missing new-registry scan still exits1; other expressions exit0). Route/panel inventory unchanged:245 literal App routes,147 dashboard patterns and309 historical panel references. No dependency installation/stock CI/typecheck/build/DB/browser/runtime/private-input certification ran in this update; local tsx/tsc remains absent. Initial169-suite supplemental receipt is historical; delivery reports172 mandatory suites and a FAILED configured release (125passed/45failed/2opt-in skips). Verify current manifest/stock gates and individual baseline failures rather than waiving or importing old pass claims.

## What & Why

Build Stage 3 C1: one typed destination/state registry, compatible URL adapters, scoped Liberty CRM theme and reusable working list/record components. This removes verified URL-selection defects and supplies the functional foundation consumed by C2–C5 without prematurely replacing the sidebar or changing backend authority.

## Done looks like

- All 147 dashboard route patterns have explicit owner, guard, entity namespace, query/alias/state disposition; dedicated mobile/public/portal boundaries retained.
- Financial, Operator, Contact and Prospecting entrances preserve valid record/filter/child state across direct navigation, click, reload and back/forward, with explicit invalid/forbidden fallback.
- Representative real CRM worklist/record surfaces use reusable accessible components and real read contracts, with truthful loading/error/empty/denied/stale states; no permanent mock data/persistence.
- CRM light/dark tokens, portals, 44px targets, zoom/reflow and responsive layout meet the complete shared design contract; public and portal designs remain unchanged.
- C2–C5 receive tested registry/primitives/URL contracts; current menus stay functional until C5 cutover.

## Out of scope

Final eleven-entry sidebar cutover; duplicate access/metric SQL or durable-action authority; paid/provider/native execution, sends/enrollment/resume, production mutations, deployments or Stage 3 GO. No forced uniform permissions or cross-device saved-view promise unsupported by existing persistence.

## Steps

1. **Refresh inherited ownership** — Preserve the complete route/panel/source register and merged A/B behavior, and map actual aliases, conditional role branches, typed entity links and dynamic views to a single implementation owner.
2. **Destination and state contract** — Build a typed registry/parser/builder with deterministic query precedence, safe parameter retention, compatible alias translation, role-specific fallbacks and history semantics; navigation must never trigger writes.
3. **Compatibility repairs** — Normalize financial child selection and Operator parent/child state, then publish all Contact and Prospecting mapping contracts for their workspace owners to adopt without duplicating page shells.
4. **Scoped UI primitives** — Implement the full Liberty light/dark typography/geometry/state contract, explicitly themed portaled overlays and reusable page header, scoped metrics, toolbar, worklist, record layout and error/state components.
5. **Functional adoption** — Mount representative existing CRM list/record consumers using real read authority and API-supported pagination/presets, with inactive query gating, cancellation, protected cache handling and no mock aggregate truth.
6. **Behavior and visual verification** — Prove actual mounted alias/role/state interactions, compiled style/portal/accessibility/responsive/performance behavior and public/portal regressions; preserve all original subclaims and hand off exact contracts and receipts.

## Initial preflight and binding evidence

HEAD `5d19e8c5410ffb5dea754fba894fe0be4d158642`; post-B-merge source. Read `.local/tasks/liberty-stage3-c-preflight-common.md` in full: its kill lines, acceptance/gates/action-record requirements and provenance limits bind this build. Read the COMPLETE supplied C1 prompt, including all 147 route rows, 309 historical panel references, exact destination mappings and full light/dark visual contract. This plan's current-code corrections supersede stale baseline assertions; untouched assignment/contracts remain mandatory, not optional reference. Execute the safe owned work after approval, not another audit-only response.

| **Seed / source claim**         | **Current verified code**                                                                                                                                                                                                                          | **Disposition / required outcome**                                                                                                                                                                                                                                                                                                               |
| :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1-V01; CRM3-09/10 R05; CL01/02 | `client/src/App.tsx:346-350` appends incoming query to Operator `tab=monitor`; `:771-772` Forecasting emits `tab=forecasting`. `FinancialHub.tsx:12-13` consumes `financialTab`, default revenue; `OperatorDashboard.tsx:4049-4057` deletes `tab`. | Confirmed defects. Financial canonical target is `/dashboard/reporting?tab=financial&financialTab=forecasting`; legacy financial keys normalize with documented precedence. Operator requires `/dashboard/system-health?tab=monitor&view=...`. C1 owns builders/adapters, C4/C5 consumer wiring. Test real nested components, not strings alone. |
| C1-V02 R08                      | `DashboardLayout.tsx:136-249` separate duplicated group arrays; canonical enrichment entry at177.                                                                                                                                                  | Registry absent; unify metadata now, not sidebar activation. Keep current role-specific menus functional.                                                                                                                                                                                                                                        |
| C1-V03 R13; CL20                | `index.css:19-22` Plex Sans/Mono + marketing serif; root/dark variables at8/75 onward.                                                                                                                                                             | Existing branding preserved. Empty root aliases are not proof computed fonts fail. Adopt exact supplied CRM tokens without public redesign.                                                                                                                                                                                                      |
| C1-V04 integration              | `tailwind.config.ts:91-96` sans/serif use font-sans/font-serif while CSS defines body/display.                                                                                                                                                     | Resolve intentional alias integration and prove computed style; preserve Tailwind4 compatibility/preflight, not another migration.                                                                                                                                                                                                               |
| C1-V05 primitives               | `components/ui/button.tsx:29` existing shared 36/32/40px target variants.                                                                                                                                                                          | New 44px treatment scoped to CRM; do not resize every public button.                                                                                                                                                                                                                                                                             |
| C1-V06; CRM3-22 R13; CL11       | `client/index.html:5` includes maximum-scale=1.                                                                                                                                                                                                    | Remove restriction; actual 200% zoom/reflow/public regression proof required.                                                                                                                                                                                                                                                                    |
| C1-V07 integration              | Existing Tailwind4.3.3/Vite plugin/@config/legacy theme.                                                                                                                                                                                           | Preserve current compiler/theme integration, production-compiled portals and public SSR.                                                                                                                                                                                                                                                         |
| C1-V08 R13                      | `components/DashboardErrorState.tsx:11` existing retry/error primitive.                                                                                                                                                                            | Extend/compose rather than duplicate; add truthful distinct empty/no-match/unavailable/denied/degraded/stale modes.                                                                                                                                                                                                                              |

Assigned parents/subclaims: CRM3-09/10 navigation slices; CRM3-21/24/26 common layout/state; CRM3-22 shared lazy/paging/error/performance; REF-004 inventory support (C5 owns server diagnostic); REF-058 completeness rebuttal, never blanket closure; REF-031/043/044/048/053/056 shared discovery/layout only. All exact original register rows retained. C2 owns Contact outer shell; C3 Prospecting; C4 financial/lifecycle consumers; C5 Operator/admin and shell. Do not count CL rows as new defects.

## Navigation and design handoff

Publish exact eleven eventual destinations Today, Records, Pipeline, Inbox, Work, Merchant Operations, Prospecting, Campaigns, Reports, Administration, Resources with existing role wrappers. C1 inventories them; C5 activates them. Preserve legacy non-admin/manager branches still rendering Lead Intelligence/Command Center: `App.tsx:375-397`; menu retirement alone does not permit page deletion.

Contact maps all 25 conditional keys to five areas and History drawer; C2 adopts. Prospecting maps 13 leaf keys plus staging selectors and Canonical Enrichment five views; C3 adopts. Reports maps six old outer selectors to four areas while keeping three financial children; C4 adopts. Administration maps eleven selectors/46 Operator views to five areas; C5 adopts. Keep source/search/owner/date/class/pagination/record identifiers and safe compatible queries, strip unsafe secret-like parameters; duplicate/unknown/forbidden keys get explicit outcome. User tab selection pushes history; debounced filters replace; alias normalization replaces.

Use complete visual/state contract in common evidence and supplied C1 prompt. Named Mine/Team/Unassigned presets only where server scope permits; unsupported saved views are URL presets, not fabricated persistence. Defaults50 and sizes25/50/100 only API-supported. Metrics use authoritative scope metadata, never derive totals from rows. Inactive panels must not mount/poll; cancel stale requests; account/role changes clear protected caches. Real read fixtures may drive component tests, not shipping mock data.

## Grep and gate receipt

All seven exact Section D grep checks executed at baseline: six exit0; the new registry/component scan exit1 (expected absent). Commands are retained verbatim in the supplied C1 prompt; temporary full output `/tmp/stage3-c1-grep.log`. Key scans: legacy/role routes; font aliases; viewport; shell geometry; Financial/Contact/LeadOps/Operator URL keys; new CRM symbols; dashboard query/poll/forceMount/limit5000. Re-run every expression after build and review actual matches/no-matches.

Current environment Node22.22/npm10.9.4, empty node_modules. Stock tsx gates unavailable (127), not passed. Common evidence records five supplemental source checks passing via temporary TypeScript5.6.3 compilation; these do NOT certify stock CI/typecheck/build. Mandatory executor gates are the common stock install/policy/manifest/typecheck/static/security/isolated-build pipeline; guarded fresh/idempotent migrations/integration/session/server where needed; actual component/browser/role/portal/zoom/compiled-style tests. Record exact original claim suboutcomes and all route/control/action CSV coverage, measured budgets, clean candidate and rollback. No source-fixed→deployed inference.

## Kill lines and rollback

Common K01–K09 bind in full. Specifically no final menu cutover, broad root/public CSS changes, route removal or generalized admin/manager rights. Stop affected adoption on wrong entity/tab, unauthorized hidden request, stale replay/query, public style regression or inaccessible flow; preserve functioning old entry while fixing independently safe slices. Rollback is the prior routing/CRM-scoped consumer, not destructive state/data reversal. No production testing or deploy.

## Relevant files

- `.local/tasks/liberty-stage3-post-2071-audit.md`
- `docs/certification/audited-retained-recovery-status.md`
- `docs/certification/canonical-retained-recovery-release.md`
- `server/services/provider-import-identity.ts`
- `scripts/ci-suite-manifest.ts`
- `client/src/App.tsx`
- `client/src/pages/DashboardLayout.tsx`
- `client/src/index.css`
- `client/index.html`
- `tailwind.config.ts`
- `vite.config.ts`
- `tailwind-legacy-theme.json`
- `client/src/components/ui/button.tsx`
- `client/src/components/DashboardErrorState.tsx`
- `client/src/pages/dashboard/FinancialHub.tsx`
- `client/src/pages/dashboard/ContactDetail.tsx`
- `client/src/pages/dashboard/LeadOpsCenter.tsx`
- `client/src/pages/dashboard/OperatorDashboard.tsx`
- `scripts/ci-suite-manifest.ts`
- `scripts/run-ci-suites.ts`
- `.github/workflows/ci.yml`
- `.local/tasks/liberty-stage3-c-preflight-common.md`
- `attached_assets/LIBERTY_STAGE3_TASK_C1_PREFLIGHT_BUILD_MASTER_PROMPT_1791318462918.md`
- `attached_assets/LIBERTY_STAGE3_C1_C5_LIVE_RECONCILIATION_2026-10-04_1791318462918.md`
## Appendix E. Source hashes and audit receipt

| Input | SHA256 |
| --- | --- |
| Original supplied #2072 task | `e33f48bc7f8907cd81078ce6bf56265a586794a4ce8b2dff04648e778afa8d2f` |
| Retained complete C1 prompt | `110475857e66fd7b36871b83a21fafa866e8c6a89e264c37eabebc7def8d9e30` |
| Retained C1–C5 October4 reconciliation | `4828cb177677fe45a0b194f8db0e9f21eb1f07068c89c712db8e21a342bfecbc` |

Line anchors refer to reviewed442fd044 only. The source checkout remained clean. No customer payloads or secret values are included.
