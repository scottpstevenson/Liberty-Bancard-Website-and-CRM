# Liberty Stage 3 — Task #2074 / C4 repository and live CRM audit

Date: 2026-10-08 UTC. Task reviewed: **2074 — Merchant Operations and Reports**, supplied in `Pasted text(8).txt`, including the portable merge audit, original C4 prompt, common preflight contract, route/panel assignments and 402-path manifest.

**Verdict: BUILD WITH THE CORRECTIONS BELOW.** The proposed Merchant Operations and Reports scope is grounded in existing code. It is not implemented or accepted merely because its entrances already load. Apply this amendment to the **same #2074**; retain the original contract and K01–K09. No new task ladder, final sidebar cutover, publication, native execution or release GO is authorized by this audit.

The principal changes to the supplied task are: refresh its baseline; preserve the newly repaired Calendar duration and Contact pending-task code; add the chargeback command, Portfolio paging, kickoff handoff, revenue relationship, additional read-state and nested-navigation repairs; explicitly adopt the existing CRM typography/header geometry; and tighten evidence/registration requirements. Existing A/B/C1/C2 ownership remains intact.

## 1. Evidence identity and what was actually verified

| Evidence | Current result | Interpretation |
| --- | --- | --- |
| Accessible GitHub `main`, checked again during this audit | `e05948b0242ae87479c69e069ec524b9f9d72b89` | Current code baseline; clean detached audit checkout. |
| Current source tree | `908c17753ef707a02cda68f25f17dda97591b97e` | Different from the supplied task's baseline tree. |
| Supplied task baseline | `436b1575adbd2fbc9bcb2025d8bff88196455057`, tree `822d01cf05fe0c10e36fa0962c3d3ed2c1d2fa5b` | Historical; equals the C2 merge tree. |
| Live `/api/health` observed in the cloud browser | `ddcb35aaf271436437434c06af6c3d1644490207`; builtAt `2026-10-08T14:54:54.220Z`; publishBuildId `f8a4602d-de8f-4bbe-90fa-c803cf98f10e`; status `ok`, production | Live observation belongs to the older C2 build. New main repairs are **not proven deployed**. A later health re-observation was credential-protection restricted. |
| `ghlTransportFailFast` | `false` in that health observation | Does not establish inbound consumption, no-echo, webhook completeness or every outbound gate. |
| Supplied 402-path manifest | 402 unique paths resolve; 400 retain the supplied blob identity; Calendar and ContactDetail changed | Content reconciliation, not 402 independent runtime passes or a fresh binary visual audit. |
| Source ownership census | 147 dashboard patterns: C2 25, C3 24, C4 39, C5 59. Panels: 309; C2 30, C3 28, C4 70, C5 181 | **Already correct in generated code.** Do not create a count repair or duplicate Underwriting ownership transfer. |
| Live entrance attempts | All 39 assigned patterns attempted; 35 employee page/alias outcomes observable; two portal entrances only initial loading; two checks credential-protection restricted | See the complete route register below. An entrance is not an all-actions pass. |
| Production actions | No durable save/send/upload/link/approval/activation/enrollment/settings/deployment performed | No live mutation acceptance claimed. |
| Toolchain here | Node 24.19.0/npm 11.9.0 | This audit environment differs from supported Node 22.22.0/npm 10.9.4. The supplied Replit toolchain observation is not disproved. |
| Current test/build execution | Static inventory/content checks and a standalone UTC date counterexample only | No install, typecheck, full stock suite, compiled browser fixture, DB/Redis mutation test or build run here. |

The two commits after the supplied baseline add a retained C2 report and Calendar/Contact pending-task repairs. Six changed paths: the attached report, `client/src/lib/calendar-date-repair.ts`, Calendar.tsx, ContactDetail.tsx, `docs/certification/stage3-c2/postmerge-repairs.md`, and `scripts/test-c2-postmerge-repairs.ts`.

Task input SHA-256: `be540c7afe03d374bea72a2a1d84c394ff3643d41d3a211dde911190cf38366f`.

Cloud direct navigation and accessibility observation worked for the employee entrances listed below. Several actual clicks, including an enabled financial selector, failed with **credential_observation_restricted**. Documented fresh-document recovery did not restore click verification. That is a browser environment limitation, **not a reproduced dead CRM button**. Actual all-control, alternate-role, phone/dark/zoom, error-injection and durable-action evidence must come from the protected fixture and subsequent integrated verification. Initial spinners are not reported as permanent product failures.

## 2. Reconciliation of the supplied M01–M12 register

**Eleven rows retain an open source defect or qualified contract gap; M04 is now source-repaired and awaiting stronger acceptance/live proof.** M09's legal-target decision remains conditional. This is the disposition of these twelve amendment rows, not a recount of the original 95 audit claims.

All client page paths in this table are under `client/src/pages/dashboard/` unless stated otherwise. Line anchors bind to the current audit HEAD.

| Row | Current adjudication and causal evidence | Exact correction / acceptance |
| --- | --- | --- |
| M01 / C4-V06 / CL07 | **Confirmed in code and live.** MerchantHealth.tsx:265–266 calculates `healthyCount = max(0,100-alerts.length)` and an invented average score. Live shows 100 healthy merchants and infers all merchants healthy from no alerts. Portfolio's different population has zero merchants; that contrast alone is not an equivalent-scope mismatch. | Through A's existing reader, expose actual eligible/assessed cohort and completeness, or unavailable/unassessed. Separate active alerts, assessment coverage, observed health and modeled score. No invented denominator, score or universal-health inference. Test zero eligible, unassessed, partial, stale, failed, forbidden and genuinely assessed healthy populations. |
| M02 / C4-V08 / CL08 | **Confirmed source gap.** Onboarding.tsx:144–169 requests 500 deals and contacts labelled `limit=5000`; contact reads cap at 500. Status failure becomes `[]`; raw keys omit the protected actor contract. | Use scoped joined/exact relationship reads or complete pagination, actor/permission/query-bound keys and AbortSignal. Declare totals/completeness/asOf/timezone. Prove a relationship outside the first 500, >500 deals, actor change and independent status failure. Do not infer a universal spinner or broaden eligibility. Include the additional board/kickoff paths in Section 3. |
| M03 / C2-R07 | **Still confirmed.** Calendar.tsx:136–147 sends the last day's UTC date as the exclusive end. `server/routes/activity.ts:733–747` and storage use the repaired exclusive bound. Pure UTC counterexample: October 31 noon is excluded by `end=2026-10-31`. | Request the next month's exclusive boundary in the approved timezone/read contract. Preserve exclusive backend overlap semantics. Test last-day noon, next-month midnight, spanning events, negative/positive offsets and DST. This is not repaired by the new date-move helper. |
| M04 / C2-R07 | **Source repaired since the attachment; live acceptance pending.** `client/src/lib/calendar-date-repair.ts` preserves browser-local start including seconds/ms and positive elapsed duration; invalid originals require explicit validated replacements. Calendar now invokes it and retains provider/read-only denial. | Withdraw the instruction to recreate the old equal-start/end fix. Preserve this implementation, register its test, and add real-handler/disposable persistence plus mounted editor acceptance. The retained 42 UTC/44 New York/42 Los Angeles assertions are prior injected-store/helper evidence, not this audit's fresh pass or 128 unique production controls. |
| M05 / existing read-state scopes | **Confirmed, with additional C4 consumers below.** DocumentsTab:54–62, ChargebacksTab:21–29, CallLogsTab:120–135, ChangeHistory:162–172, DealsTab proposal read:262–273, and contact-detail-tabs/DealAgentAssignment:14–18 return absence on failed reads. CompanyIntelligence:281 lacks HTTP/schema validation. Contacts activity and ContactDetail churn similarly mask unavailable data. | Independently model loaded-empty, denied, failed, stale, malformed and unrequested sources. No editable “none” assignment on failed assignment read. Preserve successful sibling sources and safe last-known values. C4 repairs its interiors and the narrow shared consumers already assigned; C2 keeps shell/history ownership. Communication Health, Timeline, Delivery and Locations already contain error handling: do not generalize. |
| M06 / C2-R06 | **Confirmed source semantic gap.** MobileInbox:59–68,98–125 substitutes generated local-session preview when a successful projection has null body. The failure branch itself does not substitute it. Desktop already has separate session message/link handling. | Render metadata as metadata, then use existing authorized session-message and privileged link ownership for mobile. No invented authored message; no contact draft before an authorized link. Test anonymous management triage, agent linked scope, missing/empty messages, linking race, stale/foreign selection and beyond-window selection. Current sampled native thread unavailability does not establish this mobile path's runtime cause. |
| M07 / C2 mobile pause | **Confirmed UI gap, not a sent-email exploit.** MobilePipeline:666–680 exposes native tel/mailto while MobileContactDetail already consumes pause observation. | Reuse fail-closed paused/unavailable affordances for pointer, keyboard and native alternatives, keeping profile navigation. Verify MobileQuickLog as a connected consumer. Preserve server send authority; do not turn advisory observation into permission. No actual dial/mail/send in tests. |
| M08 / existing capability scope | **Confirmed capability mismatch.** StageRules uses AI transport capability to gate manual rule configuration. | Separate harmless draft configuration from AI transport and activation authority. Preserve real role/CSRF/automation/pause policy; an AI outage is not manual edit authorization. Test AI available/unavailable, non-AI edit, forbidden actor, paused activation and zero execution. |
| M09 / Pipeline transition scope | **Confirmed affordance inconsistency; target validity conditional.** Static SALES_STAGES choices disagree with stored distributions. `server/services/deal-stage-service.ts:22–63` already defines historical/ordered/special legal transitions; a displayed custom stage is not automatically legal. | Consume existing authorized transition policy. Preserve legacy current-stage display, expose valid destinations and explicit disabled reasons for invalid targets. No arbitrary drop-target authorization or second transition engine. Test valid historic/custom destinations only when the actual policy permits them, expected-stage conflict, scoped counts and individual versus privileged bulk authority. |
| M10 / A task DTO + C2 caller | **Confirmed.** `server/routes/my-day.ts:162` selects effectiveState but returns raw task compatibility status at tasksToday; SalesRepHome uses legacy status for overdue classification. SQL scope already includes authoritative open/in_progress and a 20-row queue cap. | Project compatibility status through existing task authority or consume effectiveState consistently. Preserve scoped metrics and queue-vs-total distinction. Test deliberately divergent legacy/authority states, cancelled/completed/open/in-progress, timezone boundaries, >20 rows and readback. Do not replace correct SQL eligibility. |
| M11 / A record projection + C2 | **Confirmed.** `server/routes/crm-operations.ts:75` selects first nonarchived deal, including terminal stages, while ContactDetail's active fallback excludes Won/Lost. | Define active consistently through the existing reader and choose deterministically. Test terminal-only, archived-only, mixed open/terminal, multiple pipelines/classes and authorized context. Preserve retained history; no blanket production-only filter. This semantic repair does not satisfy C2's separate compact-header design obligation. |
| M12 / A/B inbox reader + C2 | **Confirmed instability mechanism; production loss not reproduced.** Inbox local source calls `getAllLiveChats(limit,offset)`; `server/storage/misc.ts:462–466` sorts mutable lastMessageAt without an ID tie-break/snapshot. Existing signed merge cursor and overfetch buffers are present. | Stabilize local continuation through the existing cursor owner with deterministic identity ties and a coherent snapshot/cutoff contract, or explicitly prove a weaker supported projection. Merely adding an ID tie-break does not solve reordering between offset pages. Test insert/update/equal-time pages, failed-source retry, preserved buffers and no advancement loss. |

Additional inherited repair: ContactDetail now uses shared `isPendingTask` for open plus in_progress. The previous C2 postmerge pending-count allegation is **source repaired**, not live-certified, and is different from the still-open M10 My Day DTO issue. Do not repair it twice.

## 3. Additional corrections to put into the same task

These **seven scoped amendments** attach to existing repair owners. They are not seven new disjoint original finding IDs, and are not added to 95.

### A01 — Chargeback submission callers do not satisfy the durable endpoint

**Source-confirmed action defect, P1.** Contact `contact-detail-tabs/ChargebacksTab.tsx:31–47` posts MID/notes without a UUIDv4 `Idempotency-Key`. Standalone `Chargebacks.tsx:208–222` posts `{}`, also without that header, then claims the packet was transmitted and status became Responded. `server/routes/chargebacks.ts:404–435` requires the UUID header and nonempty MID; it returns **202 `{accepted:true,command}`**, a queued command rather than final transmission.

`apiRequest` in `client/src/lib/queryClient.ts:43–82` adds CSRF and task-creation intent metadata; it does **not** automatically add chargeback idempotency. Do not mistake task middleware for this missing header.

Repair both callers through B's existing chargeback command contract: authorized typed case/MID, one stable UUID per submission intent, stable payload across unknown outcomes, explicit accepted/queued/failed/final-receipt states, and appropriate scoped readback/invalidation. Accepted must not be called transmitted or Responded. If actual native submission is unavailable or prohibited, show that exact reason and retain safe evidence preparation. Do not enable a processor worker or enqueue a production test command to obtain proof.

Required fixture cases: missing MID; unauthorized target; invalid/stale input; double click; same-key replay; same-key changed payload; response loss after acceptance; worker unavailable; delayed final failure/success using denied/fake native transport. Assert one durable intent, correct receipt and zero real transmission. Parent: existing B command/lifecycle group; C4 Service/Chargebacks integration.

### A02 — Portfolio only exposes the first page

**Source-confirmed workflow/completeness defect, P2.** MerchantPortfolio.tsx:261–272 sends sort/owner without pagination. Its local search/risk filters operate only on received rows. `server/routes/portfolio.ts:27–32` defaults to 100 rows, maximum 500; it returns page metadata and independently scoped aggregates. The UI provides no continuation for an eligible merchant beyond its first page.

Expose authoritative paging/filter scope through the existing A reader and C1 worklist controls. Default 50; 25/50/100 when supported. Reset page on filter changes, use actual total/completeness, deterministic ordering and query identity including all inputs/actor. Implement server filtering or explicitly label loaded-page filtering; never present page search as complete portfolio search. Preserve activated-MID production/nonarchived membership and assignment authority. Do not turn every contact or open sales deal into a merchant to fill the list.

Test >100 eligible merchants, equal sort values, all filter/page combinations, linked contactId/dealId/editableDealId, agent ownership, unknown totals, stale/failed page and filtered metric link/export parity. Existing optimistic follow-up rollback is present; no wholesale rollback defect is alleged. Preserve date-only semantics consistently; UTC-noon conversion is not timezone-invariant at every positive offset.

### A03 — Kickoff requires an existing deal but ignores it, with partial workflow risk

**Source-confirmed UI/command mismatch, P1; intended handoff semantics require explicit adjudication.** OnboardingKickoff.tsx requires dealId in its form and lets the user select a deal, but submit:67–109 does not use it. Instead it creates a new onboarding deal and sequentially creates several tasks. `server/routes/deals.ts:117+` persists the deal and starts existing downstream work before subsequent client task requests finish. A later failure cannot undo those earlier commits. A retry starts again at deal creation, with recomputed task due dates.

Do not assume creating a separate onboarding deal is inherently wrong. Establish whether the existing policy transitions the selected deal or creates a separately linked handoff deal. Make that choice explicit and preserve the selected source identity in the approved contract. Reuse existing B intent/readback/task creation semantics; do not create a parallel work-command engine. Add a narrow orchestrated handoff/resume contract under the existing owner if needed, with stable accepted deal/step identities, fixed due payloads, conflict/unknown/partial states and no duplicate deal on retry. A completed task subrequest already uses `prepareWorkCreation`; the confirmed gap is the **whole handoff and ignored selection**, not universal missing task idempotency.

Replace first-page contact/deal pickers with authorized contextual/exact or server-search readers and honest availability. Accepting a contact does not authorize an arbitrary deal. Tests must inject failure/response loss after deal creation and after each task; validate resume, actor switch, stale/foreign deal, date timezone, >first-page relationships and downstream denied-provider seams. No real blueprint/provider generation, terminal order or production kickoff write. Parent: B lifecycle/handoff + C4 Delivery, using A relationship authority.

### A04 — Revenue parent-group filters can omit valid financial rows

**Source-confirmed completeness and cache-identity defect, P1.** ResidualRevenue.tsx:510–548 obtains the first 500 contacts and first requested 1,000 deals, then derives group contacts and MIDs from those loaded batches. Non-OK responses become empty envelopes. Raw keys `['/api/contacts']` and `['/api/deals']` do not express those request parameters. A valid child/MID outside the batches can be excluded from the selected group or the filter can be populated from a different same-key cached page.

Use A's exact authorized parent/member/MID relationship contract, joined reads or complete documented continuation. Bind actor, filters, population and completeness to query identity. Do not silently treat unavailable membership as zero revenue. Share the approved filtered population across summaries, rows and export with period/currency/units/asOf/source. Preserve modeled/forecast versus actual residual labels and native-ingestion unavailability. Current StatementReview, DocumentVault and Forecasting already read `.data` envelopes: do not introduce an unrelated array-envelope repair.

Test parent/member/MID beyond both page windows, empty versus failed group lookup, stale cache from a different parameter set, agent/partner scope, missing actual report, same-filter export and partial period. Export provenance also applies to OperationsReport's CPL CSV: it currently exports numbers without the on-screen allocation/input provenance. Include user-provided spend, allocation/model label, period/scope/asOf and units rather than converting estimates into observed cost. Parent: A metrics/relationship authority; C4 Financial/Operations consumers.

### A05 — Extend M05 to the C4-owned board, underwriting and report readers

**Source-confirmed, P2.** Name these paths explicitly in the task so its broad state requirement becomes reviewable:

- OnboardingBoard.tsx:159–167 workflow-stage failure becomes `[]` then disappears. Task read:207–221 becomes `[]`; SLA classification excludes completed/done but includes **cancelled** tasks. Use the canonical pending-task projection. Board/KPI requests:425–447 throw errors, but rendering does not consume their error states and defaults board data to empty. Refresh:466 emits “Refreshed” before awaiting the result; fix confirmation and independent board/KPI retry/readback.
- Underwriting.tsx:99–114,204–237,265+: failed statistics become zeros and failed queue/approved reads become “Queue is clear” or empty. Expose each source's failure/denial independently. Do not permit Rules Config editing from an unloaded/error default object or relax decision authority.
- OutreachAnalytics.tsx:225+ message and A/B sources lack the campaign source's explicit error branch and can show “No messages”/“No A/B tests” after failure. Preserve its correct loaded-campaign summary label and primary error handling. Do not claim loaded summaries already represent a global aggregate.
- ResidualRevenue import/reconciliation subsidiary unavailable states and membership lookups need distinct failure handling. Preserve primary report error handling and existing honest monetary labels.

Use existing `use-crm-query.ts`, `CrmDataState` and source DTOs; no independent predicate/SQL. Test one successful and one failed sibling source, initial failure, refresh failure with safe last-known data, malformed JSON, denied actor, cancellation and genuine zero. Parent M05/M02/M10 and existing C4 read-state/metric repair scope.

### A06 — Complete typed nested state without dropping context

**Source-confirmed compatibility gaps, P2.** OnboardingHub, SupportHub, MerchantRiskHub and MerchantSuccessHub read the first `tab` value and silently default invalid/conflicting input. Their `goTab` functions reconstruct the URL using only `tab`, dropping compatible context/filter/fragment state. Underwriting sections and Revenue's five nested views remain local state.

Extend the existing C1 registry/codecs in `client/src/lib/crm-destination-state.ts` for C4 consumers. Keep separate typed workspace area, route-owned section and nested view selectors; do not overload one `tab` with incompatible levels. Preserve current six Reporting URL values and `financialTab` precedence through the existing financial parser. Add registered nested selectors for Revenue and Underwriting without inventing their names as already-shipped contracts. Equal duplicates collapse; conflicting/invalid/forbidden selections get an explicit reason and permitted fallback. Preserve validated typed context/fragments; push user choices, replace compatibility redirects; no external or name-based navigation.

Prove each retained selector, reload, Back/Forward, permitted context/filter survival, duplicate/conflict input, unauthorized child denial **before mount/fetch**, agent standalone entries and direct notification/bookmark links. The selected default Risk view is currently Chargebacks; choosing Health as the new grouped default must be explicit and preserve legacy default behavior/aliases, not silently reinterpret existing links. Parent: C1 adapter authority, C4 consumer integration.

### A07 — Explicitly adopt the existing design; do not ship grouping alone

**Confirmed current adoption gap; required design completion, P2.** Live Portfolio, applications, statement reviews, documents, underwriting and several hubs render a shell H1 plus a child H1. DashboardLayout.tsx:415 and794–801 already supports an adopted-page shell title mode; the C4 surfaces need coordinated adoption. OnboardingBoard status selectors still use `h-7` and essential labels use 10px. They have not met the retained 44px/12px contract merely because a theme file exists.

Consume the existing `client/src/components/crm/CrmPresentation.tsx`, `client/src/styles/crm-theme.css` and shared worklist/overlay primitives. Add C4-owned adoption to the existing shell mode, one visible H1, no doubled main gutters, correct child H2, limited header actions, tabular amounts and responsive tables/cards. Do not rewrite global tokens or marketing/portal typography. Geometry and contrast must be measured in the rendered container. Exact retained design is in Section 5.

**Keep C2 compact Contact header in existing C2-R10.** Original C2 step 4 explicitly required identity/owner/lifecycle/consent/next action above the area navigation and one primary plus at most two secondary actions, with remaining actions in overflow. Five Contact areas shipped, but the substantial readiness block and action density did not fulfill that header requirement. It was omitted from my earlier closeout wording; it is not reassigned to C4 or deferred to C5. C4 consumes the corrected shell and does not build a second RecordHeader.

## 4. Preserve, narrow and do not reopen these claims

| Claim | Current disposition |
| --- | --- |
| Historical Financial aliases are broken | **Source repaired, with live forecasting/terminal-roi/revenue alias selection observed.** Preserve C1 explicit financialTab precedence and conflict/default reasons. Default `/financial-hub` live check was restricted; do not promote that to a pass. |
| C4 ownership still 38 routes / 67 panels | **Stale.** Current generated registry/census already 39/70; R-107 and T-218–220 belong to C4. Historical input strings remain historical. |
| Underwriting's panel destination says Administration | Owner is corrected, but retained panel `target` text and original table still say Administration. Retain immutable originalDisposition; add a current C4 Delivery target/crosswalk in the handoff so builders do not follow stale destination wording. No authority transfer. |
| Calendar date fix still collapses duration | **Source repaired at e059; not proven deployed.** M03 month window remains open. |
| Contact pending count still open-only | **Source repaired at e059.** M10 is a different open DTO/caller defect. |
| All empty Boarding screens / disabled Refresh are defects | **Denied as a blanket claim.** Live zero eligible submissions and disabled Refresh are expected. Test accurate unavailable/error states separately. |
| Universal Onboarding loading failure | **Not reproduced.** Overview/Board and hydrated kickoff entrances available; initial loading is not proof of permanent spinner. |
| Terminal ROI exposes verified native recovery | **Denied.** Current UI explicitly identifies model-based forecasts and unavailable verified deployment/actual cash recovery. Preserve that honest distinction. |
| Normal sequence enrollment / relationship graph lacks all guards | Existing guards from prior B/C2 reviews stay intact. No blanket reopened IDOR/enrollment allegation. Real role/session and handler proof remain required. |
| ReviewComplete always has stale retry / unstable intent | Existing stable intent and exact protected readback repairs are present. Unknown/partial outcome fixtures are acceptance obligations, not a reproduced regression. |
| Service worker unconditionally returns 503 / People silently ignores conflicting duplicates | Supplied audit correctly withdraws these. Preserve fail-closed privacy and existing codec behavior. |
| Contextual Contact history must use production-only revenue eligibility | **Unsupported.** Contextual retained/archive classes and financial/merchant cohorts have distinct meanings. |
| C4 owns “A's aggregate contract” | Narrow to **C4 report UI and adoption; A owns aggregate/data authority**. C4 owns the shared OutreachAnalytics presentation consumed by C3; C3 must not clone it. |
| A `.local` planning file is missing, so build must stop | The task embeds portable contracts. Reconcile current tracked copies/provenance; an absent private path alone is not a blocker. |
| Prior C1/C2 receipt proves this whole candidate | **Denied.** Different source/build/fixture identities and untested controls remain distinguished. Source inventory, assertion counts and observations are not interchangeable. |

Prior reports are reconciled through original C4-V01–08, CRM3/REF parent IDs and dated CL subclaims retained in the supplied task and master spec. Preserve **95 original entries / 14 repair groups / established eight-task accounting**. This scoped C4 audit does not globally re-adjudicate all 95 claims, turn 39 routes or 70 panels into defects, or replace every historical status with confirmed.

## 5. Exact C4 destination and UI completion contract

### Workspace composition

| Group | Retained entrances / child views | Required UI outcome |
| --- | --- | --- |
| Merchant Operations entry | `/dashboard/portfolio` | Default Portfolio, meaningful scoped worklist and at most five summaries; retain merchant membership and typed row actions. |
| Acquisition | `/dashboard/merchant-applications`, `/dashboard/statement-review`, `/dashboard/document-vault` | Applications retain All/Submitted/Under Review/Approved/Declined/Draft. Statements retain current review/report owner. Documents retain secure authorized preview/download/upload metadata and versions. Opening records starts no provider parsing/processor execution. |
| Delivery | `/dashboard/underwriting`, `/dashboard/boarding`, `/dashboard/onboarding`; contextual `/dashboard/onboarding-kickoff` | Underwriting queue/approved/config keep privileged handler authority. Boarding retains all/submitted/under_review/more_info_needed/approved/declined status filters. Onboarding retains overview/board plus contextual kickoff; no invented processor/MID route. |
| Service | `/dashboard/merchant-risk`, `/dashboard/merchant-success`, `/dashboard/support-hub` | Risk health/chargebacks; Success reviews/testimonials/nps/retention; Support tickets/rfis/review-queue. Nest secondary selection; no flat ten-tab header. Honest data/source/sample/native state and durable B actions. |
| Partners | referral-program, partner-referral-pipeline, partner-portal employee admin, partner-orgs, co-branded-proposals | Local subgroup, each existing guard preserved. Actual `/dashboard/partner` and `/dashboard/merchant-portal` remain separate identity/theme boundaries. |
| Reports entry / Sales & Growth | `/dashboard/reporting?tab=overview`; tab=growth; tab=win-loss | Four top-level areas; Sales & Growth contains all three existing selectors with accurate scoped metrics. |
| Reports / Operations | `tab=operations` | Existing sections, task authority, chart table equivalents, matched filter/export provenance. |
| Reports / Outreach | `tab=outreach-analytics` | Campaigns/A-B/Recent Messages retain one shared C4 component consumed by C3; independent availability and paused outbound. |
| Reports / Financial | `tab=financial&financialTab=revenue\|forecasting\|terminal-roi` | Preserve canonical aliases and the nested Revenue Dashboard/By Partner/Import & Reconcile/History/Payouts. Actual versus forecast/model/unavailable is explicit. |
| Scoped report boundaries | `/dashboard/my-earnings`, `/dashboard/leaderboard`, `/dashboard/executive` | Retain agent Earnings and actual per-route scope; do not mount the restricted manager/admin hub for agents. Executive remains its current authorized entry. |
| Contact interiors | Existing C2 Lifecycle / Service & Performance area+section slots | Reuse C2 identity/URL/RecordHeader and B actions; Documents/Processing/Delivery/Chargebacks/Churn/NPS interior layouts. No second outer shell or timeline/history authority. |

Use a 200px local rail **only when measured available container width permits**. On narrow containers use one labelled section select/drawer and breadcrumbs. Navigation group visibility does not widen endpoint permissions. Do not hide legitimate scoped standalone entries behind a newly restricted hub. C5 later replaces the global sidebar with eleven entries; #2074 supplies working grouped destinations and handoff, not that cutover.

### Existing token contract to consume

Current implementation is `client/src/styles/crm-theme.css`, explicitly employee scoped. These are actual shipped variables, replacing the original prompt's historical “proposed token” language. Use existing Radix/shadcn/Lucide and Tailwind 4 compatibility; no new component library or dependency/font upgrade.

| Token / element | Light | Dark / behavior |
| --- | --- | --- |
| Body/display/sans | IBM Plex Sans; system-ui fallback | Same; 400 body, 500 controls/labels, 600 headings. |
| IDs/diagnostics | IBM Plex Mono | Same; amounts remain Sans with tabular numerals. |
| Background / foreground | `40 33% 98%` / `222 47% 11%` | `222 47% 11%` / `210 40% 98%` |
| Card/popover | white / navy text | `222 47% 10%` / `210 40% 98%` |
| Primary | `222 47% 11%` / `210 40% 98%` | inverse light/navy pair |
| Accent | `221 78% 48%` / `210 40% 98%` | `217.2 32.6% 17.5%` / light |
| Brand red | `0 72% 47%` | `0 70% 55%`; sparse identity/error emphasis, not every action. |
| Destructive | `0 84.2% 60.2%` with corrected **navy foreground** | `0 62.8% 30.6%` with light foreground; do not restore the original failing white/light-red pair. |
| Muted text | `215 16% 47%` | `215 20.2% 65.1%` |
| Border/input | `214.3 31.8% 91.4%` | `217.2 32.6% 17.5%`; interactive control border uses existing stronger `--crm-control-border`. |
| Focus ring | navy | `212.7 26.8% 83.9%`; visible 2px ring/2px offset, actual computed contrast. |
| Spacing variables 1–6 | 4/8/12/16/24/32px | Same; one gutter owner. |
| Title | 24px/32px, 600 | One H1 per page; shell title is non-heading when adopted child owns H1. |
| Section / body / essential label | 18/24 at600; 14/20 at400; 12/16 at500 | Same; no essential 10px text. |
| Metric | 28/32 at600, tabular | At most five summaries, scope/asOf/availability; no zero on failure. |
| Controls / textarea | 44px minimum target; textarea min96px, line20px, padding12px | Touch input text16px below768px; pointer/keyboard/pending/disabled reason. |
| Radii | controls6px; surfaces8px | Existing variables; no arbitrary new rounding system. |
| Content geometry | existing sidebar256px expanded/48px collapsed; shell header56px; content max1280px | Main padding12px <640px,24px >=640px; card16px; section24px. Do not apply main padding twice. |
| Page header | title/context left; one primary + <=2 secondary; More actions overflow; gap16px | Stack below768px; text wrapping and actual container width govern. |
| Worklist | search min240px on wide containers,44px field; gap8px; debounce250ms | Abort stale reads, reset page on changed filter, narrow drawer/full-width search. |
| Table / narrow equivalent | body row min44px; cells x12/y10; sticky header with max-height min(640px,70dvh) | Current shared table header already min44px. Retain interactive44px targets; the historical40px decorative-header proposal must not shrink controls. Below768px use equivalent cards with the same row IDs/scope/actions. |
| Column budgets | selection44; identity min220 flexible; owner140; state140; next date140; actions44 | Responsive optional columns based on available content width; never force a desktop table through body clipping. |
| Overlays | existing scoped portals; elevated shadow only for overlays | Correct connected focus, scroll ownership, Escape order and empty toast viewport pointer transparency. |

Measure 320/390/768/1280/1440px, light/dark, actual 200% zoom, keyboard/focus/reduced motion and meaningful long/large/missing values. Include 1363px allocated Inbox regression if shared changes affect it. Do not accept screenshot filenames, font inventory or thumbnails as these measurements. Public Source Serif, dedicated-mobile safe-area offsets and portal branding remain isolated.

## 6. Implementation order within existing #2074

1. **Refresh and preserve.** Bind current execution HEAD/tree/toolchain and source/serving separation; reconcile the new six-path delta and current 39/70 assignment. Read portable inputs and actual A/B/C1/C2 contracts. Keep repaired M04 and Contact pending count. Record current targets for Underwriting without rewriting historical input/receipt rows.
2. **Wire one C4 navigation/state owner.** Implement grouped Merchant Operations and four-area Reports through current registry/codecs/primitives. Preserve standalone/alias wrappers and all child identities. Include A06 context/duplicate/history cases before replacing local selectors. No C5 global sidebar cutover.
3. **Repair data semantics through A.** M01/M02/M10/M11/M12 plus A02/A04/A05: complete scoped relationships/paging, actual task/cohort meaning, stable continuation, source availability and equivalent-period/filter export. C4 consumes/adopts these contracts rather than owning new SQL authority.
4. **Repair action consumers through B.** A01/A03 and inherited M05/service interiors use existing intent/fence/actor/version/idempotency/readback. Prove partial accepted outcomes and failure recovery before displaying success. Keep native and provider transports denied in fixtures.
5. **Apply narrow shared corrections and design adoption.** Preserve M04; fix M03/M06/M07/M08/M09 through existing owners. Deliver C4 interior typography/geometry/error states and A07 adoption. Keep C2-R10 compact header assigned to C2; no new record shell.
6. **Run focused current-candidate proof, then required lanes.** Register tests in both manifest/predeploy structures using correct capability classification; use protected isolated infrastructure, real handler/session/CSRF order and compiled mounted UI. Fix new failures, keep unrelated baseline failures and their exact owners, and never import an older passing source identity.
7. **Close out by claim, route, control and build identity.** Every original assigned claim and every owned action receives evidence or a specific remaining gate/owner. C4 hands working destinations to C5, Outreach presentation to C3, integrated serving proof to D, and native execution to later lanes. Update the master spec/Go Live ledger after implementation and subsequent audit. Source complete is not deployed complete.

## 7. Gate and kill-line amendments

Retain all original gates and K01–K09. Add the following concrete cases to the existing gate rows; these identifiers are this review's check map, not extra implementation tasks.

| Check | Required evidence | Stop only the affected acceptance if… |
| --- | --- | --- |
| G-A Source/receipt | Current HEAD/tree, clean diff, new changed-path manifest, supported toolchain; distinct fixture input/output/build/serving identities | New head inherits historical pass text or compiled source differs from the claimed candidate. |
| G-B Registry/history | All39 patterns/70 panel references plus actual current conditional controls; valid/invalid/duplicate/forbidden paths, nested state, reload/Back/Forward/context | Wrong destination/context/namespace, silent conflict, broken alias or unauthorized child mount/request. |
| G-C Health/relationships | Actual cohort/assessment completeness; >500 onboarding relationships; >100 Portfolio rows; complete parent/MID financial scope | Invented denominator/healthy score, truncated lookup presented complete, mixed actor/pipeline/class or different same-metric predicates. |
| G-D Independent read states | Each M05/A05 source fails independently with successful siblings; explicit denied/error/malformed/stale/empty; retry/readback | Failure becomes empty/zero/none/clear queue, editable placeholder or false refreshed success. |
| G-E Tasks/header facts | Divergent legacy/effective state, cancelled/open/inprogress/terminal deal fixtures; canonical projection and deterministic identity | Competing task/active-deal definition or missing authority fields drive labels/actions. |
| G-F Chargeback/kickoff | Actual protected handlers and durable readback under duplicate, conflict, response loss and partial-step faults; stable submission/handoff IDs | 202 is called transmitted, chargeback contract still rejected, selected source deal ignored, retry duplicates accepted handoff or wrong-context action. |
| G-G Calendar/mobile/capability | Last-day exclusive range, DST/date move and positive duration; provider/read-only denial; mobile null-body projection; paused tel/mail/quick-log; authorized stage choices | Collapsed event, missed month boundary, fabricated message, native handoff under pause, arbitrary stage authorization or automation enabled by AI availability. |
| G-H Paging | Actor/query-bound continuation with equal-time inserts/updates/retry and preserved buffers | Repeat/skip is hidden behind a claimed complete snapshot, or failed source advances irrecoverably. |
| G-I UI | Measured shared tokens, one H1, 44px targets, <=5 metrics, limited header actions, narrow cards/rail/select, overlays/focus/contrast/zoom | Body clipping hides unusable panels, essential labels too small, unreachable action, focus trap or public/portal theme regression. |
| G-J Performance | Useful hydrated records <=2.5s and local response <=200ms at declared volume/cache/network/hardware; matched current/base for existing372ms case | Spinner/first paint masquerades as useful data or unrelated earlier measurement waives current failure. |
| G-K Safety/authority | Fixture start guards precede DB imports; actual role/session/CSRF/object middleware; zero real provider/native/outbound effects; inbound policy preserved | Production/shared DB/Redis used, real sends/queues/provider writes occur, role expanded, or incoming GHL disabled to prove outbound pause. |
| G-L Handoff | Per-parent status, source/handler/mounted/browser evidence and remaining owners; current build/rollback receipts; no deployment claim | 95claims,39routes,70panels or1,002 inventory controls become a fake pass percentage. |

**Additional evidence corrections:**

- `scripts/test-c2-postmerge-repairs.ts` is not referenced in `scripts/ci-suite-manifest.ts`, `scripts/pre-deploy.ts`, `scripts/run-pre-deploy.sh` or package scripts at the audited HEAD. Register under its genuine capability, with explicit timezone executions and no production DB dependency; extract pure portions only if needed without reducing obligations.
- The existing `scripts/test-toast-viewport-layout.mjs` is also unregistered in those gate files. Its frontend-only Vite/loopback harness must be classified as actually implemented, not called a pure AST check or a production server pass. Preserve empty-viewport and toast-root behavior and add owned execution/registration without normal app startup.
- Preserve original C2 final site-session/Enter/beyond-window, compiled source and full handler/session/object-authority qualification. The retained injected postmerge test and prior335 observations do not erase those gaps. The earlier universal1,002-control inventory remains unexecuted unless a specific current receipt attributes execution.

**Kill lines remain:** outbound email/SMS/sequences PAUSED; proposal auto-send Hold for Review; inbound GHL independently ENABLED/no-echo. No actual native calls, send/enroll/activate/resume, paid generation, processor submission, production kickoff/approval/write/purge/archive/merge, settings/role/worker/schedule change or publication. Do not restore withdrawn provider-paid approval/spend-limit policies. Denied test transport is isolation, not a new product approval gate. No default application startup or predeploy operational side effects to obtain a UI pass.

### Read-only source discovery checks

These locate implementation and callers; match presence is not behavior acceptance. Run from the refreshed checkout, retain outputs/status, then trace actual route/service/consumer calls.

```bash
git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
git status --short
git diff --check
rg -n 'healthyCount|avgHealthScore' client/src/pages/dashboard/MerchantHealth.tsx
rg -n 'limit=5000|limit: 500|return \[\]|useQuery' client/src/pages/dashboard/Onboarding.tsx
rg -n 'startOfMonth|endOfMonth|startParam|endParam|moveCalendarEventToDate' client/src/pages/dashboard/Calendar.tsx
rg -n 'isPendingTask|pendingTasks' client/src/pages/dashboard/ContactDetail.tsx
rg -n 'submit-to-card-brand|Idempotency-Key|accepted|transmitted' client/src/pages/dashboard/Chargebacks.tsx client/src/pages/dashboard/contact-detail-tabs/ChargebacksTab.tsx server/routes/chargebacks.ts
rg -n 'api/portfolio|ownerParam|riskFilter|search' client/src/pages/dashboard/MerchantPortfolio.tsx
rg -n 'parsedLimit|parsedOffset|orderClause|total|scope' server/routes/portfolio.ts
rg -n 'dealId|newDealId|api/tasks|api/deals|dueDate' client/src/pages/dashboard/OnboardingKickoff.tsx
rg -n 'groupMidSet|groupContactIds|limit=500|limit=1000|queryKey' client/src/pages/dashboard/ResidualRevenue.tsx
rg -n 'return \[\]|isError|refetch|Refreshed|nearestSlaDue|status !==' client/src/pages/dashboard/OnboardingBoard.tsx
rg -n 'queue =|stats\?|approvedToday|isError|Queue is clear' client/src/pages/dashboard/Underwriting.tsx
rg -n 'goTab|URLSearchParams|get\("tab"\)' client/src/pages/dashboard/OnboardingHub.tsx client/src/pages/dashboard/SupportHub.tsx client/src/pages/dashboard/MerchantRiskHub.tsx client/src/pages/dashboard/MerchantSuccessHub.tsx
rg -n 'effectiveState|tasksToday|taskReadPredicate|activeDeal' server/routes/my-day.ts server/routes/crm-operations.ts
rg -n 'getAllLiveChats|lastMessageAt' server/routes/inbox.ts server/storage/misc.ts
rg -n 'isAdoptedPage|text-page-title|<h1' client/src/pages/DashboardLayout.tsx
rg -n 'test-c2-postmerge|test-toast-viewport' scripts/ci-suite-manifest.ts scripts/pre-deploy.ts scripts/run-pre-deploy.sh package.json
```

The final registration grep currently has no matches (exit1); that is the gate-discovery finding, not a test failure. A failed lookup for an incorrect filename such as `scripts/pre-deploy-test.sh`, `server/routes/tasks.ts` or a guessed DashboardLayout folder is not a missing implementation allegation. Actual destinations are `scripts/pre-deploy.ts`, `server/routes/tickets-tasks.ts` and `client/src/pages/DashboardLayout.tsx`.

After scope/capability review and required disposable guard setup, the supported repository runner is `node_modules/.bin/tsx scripts/run-ci-suites.ts --capability <classified-capability>`; `npm run check` is the typecheck and `npm run build` invokes `script/build.ts`. This audit did not run them. Do not replace required registered lanes with greps, standalone mocks or a normal production predeploy invocation. Do not execute server-optional native/provider lanes under this C4 task.

## 8. Complete current 39-route audit register

`Observed` means authenticated admin desktop entrance/selected alias outcome only. It does not certify all data, actions, roles or responsive states. Source guards are from the actual current registry/App declarations; privileged child/server authority remains independent.

| ID | Current entrance | Observed outcome / compatibility destination | Source entry guard | Proposed local group |
| --- | --- | --- | --- | --- |
| R-001 | `/dashboard/partner` | Initial loading view only; portal access/content unverified. Retain /dashboard/partner | PartnerProtectedRoute: partner/admin; outside employee theme | Separate portal boundary |
| R-013 | `/dashboard/onboarding` | Observed entrance → /dashboard/onboarding | ProtectedRoute: admin/manager | Delivery |
| R-014 | `/dashboard/tickets` | Observed entrance → /dashboard/support-hub?tab=tickets | legacy alias; destination guard applies | Service |
| R-019 | `/dashboard/review-requests` | Observed entrance → /dashboard/merchant-success?tab=reviews | legacy alias; destination guard applies | Service |
| R-020 | `/dashboard/testimonial-submissions` | Observed entrance → /dashboard/merchant-success?tab=testimonials | legacy alias; destination guard applies | Service |
| R-021 | `/dashboard/onboarding-kickoff` | Hydrated Contact/Deal/Terminal/Start form observed; no submission → /dashboard/onboarding-kickoff | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | Delivery |
| R-023 | `/dashboard/rfis` | Observed entrance → /dashboard/support-hub?tab=rfis | legacy alias; destination guard applies | Service |
| R-024 | `/dashboard/review-queue` | Observed entrance → /dashboard/support-hub?tab=review-queue | legacy alias; destination guard applies | Service |
| R-037 | `/dashboard/outreach-analytics` | Observed entrance → /dashboard/reporting?tab=outreach-analytics | legacy alias; destination guard applies | Reports |
| R-038 | `/dashboard/reporting` | Observed entrance → /dashboard/reporting | ProtectedRoute: admin/manager | Reports |
| R-040 | `/dashboard/win-loss` | Observed entrance → /dashboard/reporting?tab=win-loss | legacy alias; destination guard applies | Reports |
| R-045 | `/dashboard/statement-review` | Observed entrance → /dashboard/statement-review | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | Acquisition |
| R-051 | `/dashboard/merchant-applications` | Observed entrance → /dashboard/merchant-applications | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | Acquisition |
| R-052 | `/dashboard/boarding` | Observed entrance → /dashboard/boarding | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | Delivery |
| R-053 | `/dashboard/onboarding-board` | Observed entrance → /dashboard/onboarding?tab=board | legacy alias; destination guard applies | Delivery |
| R-054 | `/dashboard/merchant-portal` | Initial loading view only; portal access/content unverified. Retain /dashboard/merchant-portal | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | Separate portal boundary |
| R-055 | `/dashboard/merchant-health` | Observed entrance → /dashboard/merchant-risk?tab=health | legacy alias; destination guard applies | Service |
| R-056 | `/dashboard/chargebacks` | Observed entrance → /dashboard/merchant-risk?tab=chargebacks | legacy alias; destination guard applies | Service |
| R-057 | `/dashboard/nps` | Observed entrance → /dashboard/merchant-success?tab=nps | legacy alias; destination guard applies | Service |
| R-058 | `/dashboard/retention-campaigns` | Observed entrance → /dashboard/merchant-success?tab=retention | legacy alias; destination guard applies | Service |
| R-060 | `/dashboard/my-earnings` | Cloud credential-protection restricted; runtime result unverified. Source contract: /dashboard/my-earnings | ProtectedRoute: agent | Reports / scoped standalone |
| R-061 | `/dashboard/residual-revenue` | Observed entrance → /dashboard/reporting?tab=financial&financialTab=revenue | legacy alias; destination guard applies | Reports |
| R-062 | `/dashboard/referral-program` | Observed entrance → /dashboard/referral-program | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | Partners |
| R-063 | `/dashboard/partner-referral-pipeline` | Observed entrance → /dashboard/partner-referral-pipeline | ProtectedRoute: admin/manager | Partners |
| R-064 | `/dashboard/partner-portal` | Observed entrance → /dashboard/partner-portal | ProtectedRoute: admin/manager | Partners |
| R-065 | `/dashboard/partner-orgs` | Observed entrance → /dashboard/partner-orgs | ProtectedRoute: admin | Partners |
| R-066 | `/dashboard/co-branded-proposals` | Observed entrance → /dashboard/co-branded-proposals | ProtectedRoute: admin/manager | Partners |
| R-076 | `/dashboard/forecasting` | Observed entrance → /dashboard/reporting?tab=financial&financialTab=forecasting | legacy alias; destination guard applies | Reports |
| R-095 | `/dashboard/leaderboard` | Observed entrance → /dashboard/leaderboard | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | Reports / scoped standalone |
| R-096 | `/dashboard/terminal-roi` | Observed entrance → /dashboard/reporting?tab=financial&financialTab=terminal-roi | legacy alias; destination guard applies | Reports |
| R-099 | `/dashboard/document-vault` | Observed entrance → /dashboard/document-vault | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | Acquisition |
| R-104 | `/dashboard/growth-kpi` | Observed entrance → /dashboard/reporting?tab=growth | legacy alias; destination guard applies | Reports |
| R-107 | `/dashboard/underwriting` | Observed entrance → /dashboard/underwriting | ProtectedRoute: admin/manager | Delivery |
| R-113 | `/dashboard/merchant-success` | Observed entrance → /dashboard/merchant-success | ProtectedRoute: admin/manager | Service |
| R-114 | `/dashboard/portfolio` | Observed entrance → /dashboard/portfolio | ProtectedRoute: authenticated dashboard roles; merchant/partner boundaries | Portfolio |
| R-115 | `/dashboard/support-hub` | Observed entrance → /dashboard/support-hub | ProtectedRoute: admin/manager | Service |
| R-119 | `/dashboard/financial-hub` | Cloud credential-protection restricted; runtime result unverified. Source contract: C1 financial adapter → Reporting financial (default revenue; explicit valid financialTab precedence) | ProtectedRoute: admin/manager | Reports |
| R-124 | `/dashboard/merchant-risk` | Observed entrance → /dashboard/merchant-risk | ProtectedRoute: admin/manager | Service |
| R-141 | `/dashboard/executive` | Observed entrance → /dashboard/executive | ProtectedRoute: admin/manager | Reports / scoped standalone |

## 9. Complete 70-panel reference reconciliation

These are preserved **historical reference IDs**, with repeated hub/nested representations of some capabilities. They are not 70 unique controls or 70 current passes. Every row remains assigned to C4. The build must append current mounted control/action evidence, including dynamic/conditional children, rather than delete historical rows. Underwriting current delivery destination below supersedes its stale Administration target; privileged configuration/decision authority stays unchanged.

| Reference ID | Retained route / selection | Historical label | Current required presentation | Current proof |
| --- | --- | --- | --- | --- |
| T-051 | `/dashboard/reporting` | Overview / hub-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-052 | `/dashboard/reporting?tab=growth` | Growth Metrics / hub-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-053 | `/dashboard/reporting?tab=win-loss` | Win/Loss / hub-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-054 | `/dashboard/reporting?tab=outreach-analytics` | Outreach Analytics / hub-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-055 | `/dashboard/reporting?tab=operations` | Operations Report / hub-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-056 | `/dashboard/reporting?tab=financial` | Financial / hub-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-065 | `/dashboard/onboarding` | Onboarding / hub-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-066 | `/dashboard/onboarding?tab=board` | Board / hub-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-067 | `/dashboard/merchant-risk` | Chargebacks / hub-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-068 | `/dashboard/merchant-risk?tab=health` | Merchant Health / hub-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-069 | `/dashboard/support-hub` | Tickets / hub-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-070 | `/dashboard/support-hub?tab=rfis` | RFIs / hub-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-071 | `/dashboard/support-hub?tab=review-queue` | Review Queue / hub-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-072 | `/dashboard/merchant-success` | Review Requests / hub-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-073 | `/dashboard/merchant-success?tab=testimonials` | Testimonials / hub-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-074 | `/dashboard/merchant-success?tab=nps` | NPS / CSAT / hub-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-075 | `/dashboard/merchant-success?tab=retention` | Retention Campaigns / hub-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-079 | `/dashboard/financial-hub` | Revenue Dashboard / hub-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-080 | `/dashboard/reporting?tab=financial&financialTab=forecasting` | Forecasting / hub-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-081 | `/dashboard/reporting?tab=financial&financialTab=terminal-roi` | Terminal ROI / tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-122 | `/dashboard/reporting?tab=financial` | Revenue Dashboard / nested-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-123 | `/dashboard/reporting?tab=financial&financialTab=forecasting` | Forecasting / nested-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-124 | `/dashboard/reporting?tab=financial&financialTab=terminal-roi` | Terminal ROI / nested-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-125 | `/dashboard/reporting?tab=financial&financialTab=revenue` | Dashboard / nested-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-126 | `/dashboard/reporting?tab=financial&financialTab=revenue` | By Partner / nested-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-127 | `/dashboard/reporting?tab=financial&financialTab=revenue` | Import & Reconcile / nested-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-128 | `/dashboard/reporting?tab=financial&financialTab=revenue` | History / nested-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-129 | `/dashboard/reporting?tab=financial&financialTab=revenue` | Payouts / nested-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-130 | `/dashboard/reporting?tab=outreach-analytics` | Campaigns / nested-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-131 | `/dashboard/reporting?tab=outreach-analytics` | A/B Testing / nested-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-132 | `/dashboard/reporting?tab=outreach-analytics` | Recent Messages / nested-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-133 | `/dashboard/merchant-risk?tab=health` | Health Alerts / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-134 | `/dashboard/merchant-risk?tab=health` | Churn Risk / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-135 | `/dashboard/merchant-risk?tab=health` | NPS / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-136 | `/dashboard/merchant-risk?tab=health` | Signal Settings / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-195 | `/dashboard/leaderboard` | Deals / nested-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-196 | `/dashboard/leaderboard` | Revenue / nested-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-197 | `/dashboard/leaderboard` | Proposals / nested-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-198 | `/dashboard/leaderboard` | Calls / nested-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-199 | `/dashboard/leaderboard` | Close Rate / nested-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-200 | `/dashboard/leaderboard` | Contacts Added / nested-tab | Reports → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-218 | `/dashboard/underwriting` | Needs Review / nested-tab | Merchant Operations / Delivery / Underwriting; retain privileged Rules Config authority | Source/assignment preserved; individual action acceptance pending |
| T-219 | `/dashboard/underwriting` | Auto-Approved Today / nested-tab | Merchant Operations / Delivery / Underwriting; retain privileged Rules Config authority | Source/assignment preserved; individual action acceptance pending |
| T-220 | `/dashboard/underwriting` | Rules Config / nested-tab | Merchant Operations / Delivery / Underwriting; retain privileged Rules Config authority | Source/assignment preserved; individual action acceptance pending |
| T-221 | `/dashboard/merchant-applications` | All / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-222 | `/dashboard/merchant-applications` | Submitted / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-223 | `/dashboard/merchant-applications` | Under Review / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-224 | `/dashboard/merchant-applications` | Approved / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-225 | `/dashboard/merchant-applications` | Declined / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-226 | `/dashboard/merchant-applications` | Draft / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-227 | `/dashboard/boarding` | All / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-228 | `/dashboard/boarding` | Submitted / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-229 | `/dashboard/boarding` | Under Review / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-230 | `/dashboard/boarding` | More Info Needed / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-231 | `/dashboard/boarding` | Approved / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-232 | `/dashboard/boarding` | Declined / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-242 | `/dashboard/merchant-success?tab=reviews` | Review Requests / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-243 | `/dashboard/merchant-success?tab=testimonials` | Testimonials / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-244 | `/dashboard/merchant-success?tab=nps` | NPS / CSAT / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-245 | `/dashboard/merchant-success?tab=retention` | Retention Campaigns / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-246 | `/dashboard/support-hub?tab=tickets` | Tickets / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-247 | `/dashboard/support-hub?tab=rfis` | RFIs / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-248 | `/dashboard/support-hub?tab=review-queue` | Review Queue / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-252 | `/dashboard/merchant-success?tab=testimonials` | Pending / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-253 | `/dashboard/merchant-success?tab=testimonials` | Approved / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-254 | `/dashboard/merchant-success?tab=testimonials` | Rejected / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-255 | `/dashboard/merchant-success?tab=testimonials` | All / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-256 | `/dashboard/support-hub?tab=review-queue` | Pending / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-257 | `/dashboard/support-hub?tab=review-queue` | Approved / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |
| T-258 | `/dashboard/support-hub?tab=review-queue` | All / nested-tab | Merchant Operations → retained nested section | Source/assignment preserved; individual action acceptance pending |

## 10. Live data observations and limits

- Portfolio settled with zero eligible merchants/tasks/tickets. Boarding settled with zero submissions and disabled Refresh. These are not defects solely because the screen is empty.
- Merchant Health settled with the unsupported “100 healthy” and all-healthy inference; source causality confirms M01.
- Reporting Overview settled with active pipeline 2, open tickets 7 and tasks 0. Those numbers use different cohorts from activated-MID Portfolio; forcing them equal would be incorrect. No current same-metric cross-page corruption fixture was run. Compare canonical predicate/actor/class/archive/pipeline/period/timezone/asOf/snapshot/availability before asserting a mismatch.
- Financial aliases selected their intended Forecasting, Terminal ROI and Revenue children. Terminal ROI's explicit modeled/unavailable native language is retained. Revenue's five nested view labels are present, but their individual action/role/export/native workflows were not clicked or certified.
- Applications, statements, documents, underwriting, support, success and partner employee entrances were observed. Kickoff's loaded form was specifically awaited; initial source reads and controls are not a completed kickoff workflow.
- Neither portal's initial loading observation proves authorized portal content or isolation. The restricted Earnings/default Financial checks are not site outages or verified redirects. Button click restriction is an environment blocker; no fabricated clickable-action pass is supplied.
- No live error injection, durable action, >page-window fixture, alternate-role walkthrough, actual phone/dark/200% zoom, measured all-page contrast or performance acceptance occurred. Required cases remain assigned in Section7; native/production proof stays with D/later stages.

## 11. Replit-ready amendment message

> Update the existing Task #2074 with this audit before Build Mode. Keep its complete original C4/common contract and K01–K09. Refresh baseline to the actual current execution HEAD (this review used e05948b); preserve the new Calendar duration and Contact pending-task fixes rather than reimplementing them. Add Section3's seven scoped amendments and Section7's evidence/gate corrections through the existing A/B/C1/C2 owners. Current 39-route/70-panel ownership already exists; retain all IDs and correct only the current Underwriting destination wording/crosswalk. Deliver the actual grouped Merchant Operations, four-area Reports and Lifecycle/Service interior design, not only navigation wrappers. Keep compact Contact header assigned to existing C2-R10, final eleven-entry sidebar to C5 and integrated serving proof to D. Outbound remains paused; incoming GHL remains independently enabled/no-echo. Do not publish, execute native/provider workflows or claim every control passes from this read-only audit. Complete the safe independent build slices and report each remaining dependent gate with precise evidence and owner.

No remote task, application source, DB/schema, runtime/settings, provider or production workflow was modified by this review. Stage3 remains in progress; prior Stage1/2 completion is unchanged. No SHA freeze or release GO.
