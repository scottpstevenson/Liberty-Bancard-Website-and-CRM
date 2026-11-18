# Production audit: Phase 7 and Task 2161

Audit date: November 18, 2026 (America/New_York). Scope: published source, signed-in production reads and stateless email simulations, the Phase 7 contract, the complete corrected #2161 contract, current tests and UI. This is an audit, not an activation or publication. No production business records, approvals, provider settings, schedules, outbound controls or deployment were changed.

## Decision

The published application contains the discovery implementation, TypeScript repairs and HTTP repairs. The signed-in production funnel, discovery panel, task detail and calendar read paths work in the inspected admin session. Phase 7's production schema/native-object diagnostic passes. These observations do not certify a real experiment, production discovery run, historical funnel reconstruction or every CRM role/device.

Required work falls into three distinct groups:

1. **Fix code/evidence defects:** dependency-policy findings, the missing discovery logical-job entry, incomplete contact-merge dispositions, the CI completion-receipt wrapper, migration-upgrade fixtures and SendGrid metadata response codec; incorrect current-package readiness selection, hidden copy flags, narrow report-tab text overlap, assistant/field overlap, missing mobile-preference reset, calendar deep-link state loss, dark-link contrast, and misleading retained count terminology. Make the draft sample shortfall explicit. Refresh dated acceptance records.
2. **Reconcile source:** GitHub main lacks the discovery publish-safe constraint fix already deployed from Replit. Preserve that fix when reconciling repositories.
3. **Complete operational setup when separately authorized:** verify and start non-sending measurement; initialize discovery definitions and select its narrow worker; obtain real copy/design approvals and adequate samples. None requires treating outbound pause as a defect or bypassing it. A paid preview, retained production import and schedule enable remain separate decisions.

**The completed unchanged 304-entry roster is not green: 247 passed and 57 failed, with zero suite setup/teardown or shared-launcher failures.** Diagnostic reruns are separate and do not rewrite that original count. No release approval is inferred.

## Source and environment

| Identity | Verified value |
|---|---|
| Audit checkout | `/Users/matt/Developer/liberty-production-audit` |
| Audit branch | `codex/production-phase7-2161-audit` |
| Audit starting HEAD / Replit workspace HEAD | `c54fdf180220e100a43fe4c115a2d6eea591d896` |
| Served application SHA | `bc4f3b0f8a01aa50708a9a807019d987211372a1` |
| Application tree for both commits | `210f801ce56b2e80b5b9dd671b1a461221b2607a` |
| Application publish-build identity | `0d596e7e-5dfc-4909-b27b-d516aaf2157f` |
| Production builtAt | `2026-11-18T13:46:39.815Z` |
| GitHub origin main (fresh read) | `a9acad2dd35225788cd2e3d28fa73765c352cf83` |
| GitHub remote | `https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM.git` |
| Replit workspace | `/home/runner/workspace`, main, clean; two commits ahead of its origin/main |
| Verification runtime | Official Node 22.22.0, npm 10.9.4; fresh locked `npm ci` |
| Workspace ambient runtime | Node 22.23.5 (within declared range), npm 10.9.9 (differs from declared exact npm) |

`c54fdf18` is publication bookkeeping over `bc4f3b0f`, with identical trees. Application-issued build identity is distinct from Replit's platform publication ID. Final public health recheck still reports the same served SHA/build and production environment. Current production SFP release selection and live owner match the actual served application SHA/build; no manual selection was performed.

Git ancestry independently confirms discovery `83a80670`, TypeScript `4b003c5d` and HTTP repairs `1d85a3b8` are in the audited tree. The local history is shallow at `21b0db48`; the older Phase 7 receipt's `720f06d9` object is unavailable here, so its ancestry was not inferred. Current Phase 7 source and fresh compiled tests were inspected directly.

GitHub main differs in exactly four files: new append-only `migrations/0389_discovery_id_checks_publish_safe.sql`, its journal entry, two boolean checks in `shared/schema.ts`, and `.agents/memory/publish-not-valid-checks.md`. Migration 0389 rewrites bare boolean singleton checks to `id = true`; this preserves their NOT NULL boolean semantics and avoids malformed Publish-generated SQL. Do not lose these changes by copying GitHub's older tree over Replit.

The provided working preferences apply. There is no root AGENTS.md in this clean checkout. Relevant repository migration/publish/runtime memory and current task/certification documents were read as evidence; their historical authorization statements did not grant new production actions.

## Confirmed fixes and UI issues

| Priority | Finding | Evidence and concrete fix |
|---|---|---|
| P1 dependency maintenance | **Locked dependencies fail the existing security policy: nine high, zero critical package findings.** | Fresh `npm audit --json` under Node 22.22.0/npm 10.9.4 reports 23 total package findings (9 high, 13 moderate, 1 low). High entries: body-parser, multer, zod/zod-validation-error, undici, vite, picomatch/fdir/tinyglobby. Findings overlap through dependency chains and are not nine independent demonstrated exploits. Prioritize runtime request parsing/uploads/validation; separate build/dev reachability and transitive paths. Review available patched releases, retain locked installs and run upload/parser/validation/build regressions. Zod and its error helper advertise major-version fixes: do not blindly force-upgrade. No exploitability or production incident is claimed. Private JSON retains exact advisory IDs/URLs/ranges. |
| P1 Phase 7 integration contract | **Contact-merge disposition coverage omits new immutable Phase 7 pointers and other live FKs.** | The live-catalog guard in an isolated fully migrated database reports unclassified `conversion_journey_evidence.contact_id` and `cro07_provider_receipts.contact_id`, plus twelve newer schema pointers. `server/services/contact-merge.ts` has a code-owned versioned disposition manifest; classify each added pointer with its evidence/workflow owner, retaining immutable history and explicit handoff/blocking where required. Add merge preview/execute/replay/rollback coverage with those rows present. Do not rewrite append-only evidence or automatically transfer all references. No production merge was attempted, so this proves incomplete coverage, not observed data loss. |
| P1 Task 2161 governance | **New discovery queue is missing from the logical-job manifest.** | `check-queue-compliance.ts` fails: `Queue "scheduled-discovery" has no manifest entry`. The physical name exists in `queue-names.ts:9` and the actual worker dispatches `processDiscoveryTick` at `queue-manager.ts:2994`, but `logical-job-manifest.ts` has no corresponding entry. Add a typed entry for the real tick/job-name pattern, owned data-discovery effect, paused-outbound semantics, durable backlog and release controller. Verify queue lookup/admin inventory and preserve all provider/activation/schedule safeguards. Focused #2161 scanner tests pass but currently miss this broader governance gate; register this check in its acceptance coverage. `test-redis-topology.ts` also still certifies 42 queues while the actual roster has 43; review the added queue/profile/Redis contract, then update the recorded roster/digest with evidence. Missing classification does not prove outbound was sent. |
| P1 verification | **CI rejects a successful static suite because it guesses assertion evidence from console wording.** | Latest GitHub [CI run 44304167925](https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM/actions/runs/44304167925), main `a9acad2d`: first of 108 static suites prints `ok (44 aliases, 220 generated cases)`, then wrapper exits 65. `scripts/run-denied-certification-suite.ts:17–28` counts only tick/PASS/passed output and requires that count before exit, even for `runner-owned` stateless entries. On the published source, direct alias suite exit=0; the actual CI static runner exit=1 with child exit=65. Respect the manifest's completion contract; use explicit structured evidence for suites that require receipts, preserve nonzero exits/provider denial, and test a successful stateless suite without magic console words. Do not merely rename the first log message: other valid output would still be misclassified. Integration, dependency audit and artifact scan in that GitHub run were skipped, not passed. |
| P1 verification | **Phase 7 upgrade fixture no longer represents a pre-Phase 7 database.** | `scripts/test-phase7-upgrade.ts:37`: it removes only 0387 while retaining 0388/0389. The timestamp-based migrator records the later high-water mark, then skips 0387 when it is restored. Original parity assertion fails with Phase 7 objects absent only in the artificial upgrade database. Restrict the baseline to entries strictly before 0387, assert its journal head, and retain catalog parity, replay, business-data retention and validated-check assertions. A diagnostic copy making only that baseline correction passes the unchanged parity assertion; catalog diff is `{}`. Production's separate schema check passes, so this is not evidence that production lacks Phase 7. |
| P1 source operations | **GitHub is missing the already-published discovery constraint repair.** | Reconcile `bc4f3b0f` into GitHub through the normal source workflow; retain migration 0389 and the matching model checks. No push or merge was performed by this audit. |
| P2 Phase 7 integration | **SendGrid coverage probe rejects the vendor-documented API-key response envelope.** | `server/services/phase7-sendgrid.ts:126` reads `api_key_id/scopes` only at the top level; `test-phase7-integration.ts:330` supplies only that flat fixture. [SendGrid's current response contract](https://www.twilio.com/docs/sendgrid/api-reference/api-keys/retrieve-an-existing-api-key) also documents `result: [{api_key_id, scopes, ...}]`. In a separate real-PG diagnostic clone, replacing only the flat fixture with that documented envelope makes the existing healthy-probe assertion fail: one metadata GET, then `SENDGRID_SMTP_ACCOUNT_NOT_VERIFIED`. Normalize the documented envelope and retained flat shape with strict unique matching ID/scope checks; refuse empty, ambiguous, mismatched or malformed metadata, and cover both forms. Live provider payload shape was not queried, so this is a confirmed contract-compatibility defect, not a confirmed explanation of the current disabled production measurement. |
| P2 shared readiness UI | **Current packages falsely display “not the selected current package.”** | `client/src/lib/email-lane-states.ts:107–114` uses the first package matching an asset ID, including superseded versions. Live Healthcare sequence 1154 is pinned by several historical versions and one current version. The first catalog match is superseded/selected=no, while the unique current version is selected=yes; the sequence screen displays the historical result. Resolve the unique current version for both sequence and campaign helpers, preserving explicit conflict handling for multiple current pins. Test historical versions preceding a current version. The backend catalog correctly reports all five current packages selected, but their content revisions are not approved: preserve those genuine content holds rather than making the row green. |
| P2 Phase 7 UI | **Copy-review findings are returned but never displayed.** | `client/src/pages/dashboard/Phase7CopyInventory.tsx:275`: the Review cell contains only a conditional draft-preparation button. Render each finding's rule, explanation and review status; distinguish automated flags from reviewed defects and show current-package context. A flagged row was opened in production and its flags remained invisible. |
| P2 Phase 7 UI | **Report-tab labels overlap at 320px.** | `client/src/pages/dashboard/ReportingHub.tsx:72`: four non-wrapping labels shrink into one row. Production measurement: Growth Metrics scroll width 88/client width 79; Conversion Funnel 104/90. Document overflow is zero, so existing overflow-only tests miss the collision. Use a two-row or explicit horizontal tab layout; verify text bounds and keyboard focus at narrow widths. |
| P2 shared CRM UI | **Floating assistant covers part of the funnel Vertical input on phones.** | `client/src/components/DashboardDataAgent.tsx:167`: fixed bottom/right placement. At 320px the button occupies x240–296/y820–876 while the field occupies y832–876. Add sufficient content/safe-area clearance or reposition/collapse the trigger near active controls. Test overlay intersection, not document width alone. |
| P2 mobile navigation | **Advertised mobile-layout recovery control is absent.** | `client/src/components/crm/MobileDestinationNotice.tsx:30` says to switch back from More. Production More contains “Switch to Desktop View” only; `MobileMore.tsx:117` and related navigation set `prefer_desktop=true`, and no client reset was found. Add a visible switch to mobile that clears the preference while preserving destination semantics, or correct the promise and provide another recovery control. No stored preference was changed in this audit. |
| P2 planning/UI | **The current review template's sample requirement is not reconciled with actual eligible volume.** | `server/services/phase7-draft-workspace.ts:175` sets 6,000 per arm, 28 collection days + 14 maturity days. Eligible Healthcare/Automotive/Beauty pools are 518/210/193 total, not 12,000 each. `Phase7CopyInventory.tsx:185` gives only generic insufficiency wording. Display the actual required/available/shortfall populations and capacity constraints for each proposed design. Retain statistically justified minimums; do not lower them or lift send controls merely to manufacture a result. These are planning defaults, not frozen live designs. |
| P2 calendar deep links | **Legacy calendar redirect drops calendar selection parameters.** | In an isolated real browser, `/dashboard/calendar?cal_month=2026-10&cal_date=2026-10-20` becomes `/dashboard/tasks-appointments?tab=calendar` and shows November. `legacy-aliases.ts:65–80` preserves generic context but omits Calendar's `cal_*` selectors. Add a destination-specific allowlist for the validated month/date/source/item/window fields, preserve safe fragments, and test calendar deep-link/back/reload behavior. This was observed in an isolated compiled client, not freshly reproduced through production. |
| P2 retained metric UI | **Today calls a time-window count “current contact records.”** | `client/src/pages/dashboard/Overview.tsx:1238` labels `totalLeads`; `server/routes/analytics.ts:1164` filters non-archived production contacts created since the requested window (30 days by default). Label the population/window explicitly, e.g. “Production contacts created (30 days).” This is a naming discrepancy, not evidence of missing contacts. |
| P2 shared CRM accessibility | **Dark-theme contact/task links have insufficient text contrast.** | Fresh compiled real-browser suite records `text-blue-600` (#2563eb) on #0f1729 at 3.458:1 against its 4.5:1 normal-text threshold: contact next action at all five widths and task contact links at desktop widths (seven failing cells). `ContactDetail.tsx:2157` hardcodes that color; use an appropriate theme-aware link token/dark color and verify both themes. These are isolated browser measurements of published source, not newly measured production customer records. |
| P3 usability | **689-row copy inventory lacks filtering/pagination and sticky headings.** | `Phase7CopyInventory.tsx:219–237`: all rows are mapped into a bounded 32rem scroll container. Add current/noncurrent package, vertical, owner and finding filters; retain stable hashes and virtualize/page the rows. No unbounded document-height claim is made. |
| P3 clarity | **“Dev Mode: On” appears on production but controls sidebar visibility.** | `client/src/pages/DashboardLayout.tsx:441,846`: local advanced-navigation preference, not NODE_ENV or an authentication bypass. Rename it “Advanced navigation” and reduce duplicate legacy entrances. Existing user preference was preserved. |
| P3 message presentation | **Plain-text email includes internal footer delimiters.** | Production simulation exposes `[CAN-SPAM-FOOTER]` / closing marker in the text part. `server/services/can-spam-footer.ts:101–138` adds them; `smtp-email.ts:294,398` passes that text to the transport. Polish the final recipient-facing text while preserving footer deduplication, address/unsubscribe content and final-envelope hashing. No actual email was sent or inspected in an external client. |
| P3 verification coverage | **Task 2161's populated UI states lack a registered browser regression suite.** | The two task suites exercise real persistence, queues, HTTP guards and pure/scanner contracts, but neither drives Chromium. Original implementation delivery includes manual admin/manager/mobile/unknown/error screenshots; this audit freshly exercises the production empty panel only. Add mounted real-browser coverage for retained preview/import, unknown/expired/error/retry, manager read-only and phone cards with denied provider egress. This is a coverage upgrade, not evidence those unexercised production states are broken. |

UI review used the repository web-design guidelines skill and its [current upstream guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). The actionable findings above come from actual source/production observations. No automated flags were counted as confirmed security, legal or accessibility violations.

## Production readback

Authenticated admin GETs and rendered UI were inspected on `https://libertybancard.com`; anonymous requests to discovery, Phase 7 schema and send-state returned 401. Full role/IDOR/CSRF HTTP matrices were exercised only with isolated test identities, not by altering production users. Phase 7 also has fresh private-browser role checks; #2161's populated browser-state screenshots are historical implementation evidence rather than a newly executed browser matrix.

| Check | Production result |
|---|---|
| Outbound authority | Final authenticated recheck at 2026-11-18 17:19:35 UTC (12:19 EST): paused, epoch 4, database available, `canSend=false`; no pause mutation |
| SFP current release | Selected and ready; owner live; matches served SHA/build |
| Phase 7 schema | All 14 expected tables present; six experiment columns; collecting-step index; native functions/triggers verified; validated checks; zero invalid checks |
| Phase 7 feedback | Measurement disabled; unavailable because SendGrid subscription and mailbox continuity have not been observed. No governed live experiment was found. The schema diagnostic's `productionActivation:false` is a constant statement that the GET does not activate anything, not an independent runtime activation measurement. |
| Funnel | Correctly mounted; partial coverage; zero entered journeys in inspected Oct 20–Nov 18 cohort; unavailable rates, not fabricated conversions |
| Historical coverage | Reconciliation has not been run; no nearest-record inference or historical-message replay was performed |
| CSV | Downloaded through signed-in UI; same filters and observation cutoff as the funnel; valid header-only CSV for zero matching journeys |
| Invalid cohort URL | Explicit conflict state, no broader fallback population; valid URL restored afterward |
| Experiments | No governed live experiments; no results or winners invented |
| Current SFP package readiness | All five current backend catalog versions selected=yes, content qualification=no because campaign content revision is not approved. The sequence/campaign display helper can show an older superseded version instead. |
| Actual current email previews | Nine current sequence touches across Healthcare/Automotive/Beauty render via production's stateless asset-addressed simulation; one logo, one signature, configured sender/reply path and footer applied; no send/store/enqueue |
| Selected-task repair | Existing task 7076 read successfully and matched task-list identity; no task edited |
| Calendar repair | November Eastern-boundary GET returns an array without server error; no production boundary fixtures were inserted |
| Industry SSR | All 14 listed industry URLs return 200 with server-rendered main/headline content; unknown slug returns a real 404 |
| Discovery scope | Unique active taxonomy-v2 program; Broward/Miami-Dade/Palm Beach FIPS; five current canonical verticals; current program pin |
| Discovery controls | Provider and runtime ready; validation promotion true and ZeroBounce ready; schedule false; definitions 0; runs 0; worker selective but not selected; heartbeat absent |
| Discovery accounting | Zero current daily dispatches; 96 units of old unresolved holds separately visible, not attributed to the new lane |
| Discovery UI | Actual Sources & Imports panel loads; readable at 320/390/768 with no document overflow; no pilot/import/save/initialize/enable action clicked |

An attempted read-only SQL connection using the SSH-exposed production-looking PG credentials was rejected with 28P01. This does not establish a production database outage or justify changing credentials. The live CRM diagnostics supplied the Phase 7 catalog verification. Task 2161's status queries prove the referenced tables can be queried, but exact production parity for all six tables, partial indexes and singleton checks (especially the unqueried lane) remains **unverified**. Obtain a narrow authenticated schema diagnostic/read-only production catalog receipt before the first paid run; do not replay the development journal in production.

### Copy review and design readiness

The complete bounded installed inventory contains 689 steps: sequence 523, campaign 79, workflow 79, template 8. There are 289 automated flags across 230 rows: direct booking-widget links 173, unverified duration claims 69, CTA mismatches 29, unsupported timing claims 18. These are review candidates, not 289 confirmed defects. All rows remain labelled automated-screen-only/human-context-review-required.

Five package pins are current. Their 30 paired sequence/campaign steps have zero automated flags. Nine current sequence previews were rendered in production and show the configured sender/reply path, one logo/signature and applied footer; narrow/text/images-off controls were inspected on one Healthcare touch. These are simulations, not external email-client/delivery certification or content approval. All five current campaign revisions remain unapproved according to the backend readiness owner. Other installed content should be reviewed in its lifecycle context before reactivation; it should not be bulk-rewritten or discarded.

Fresh read-only eligibility ranks Healthcare 518, Automotive 210, Beauty/Spa 193, Construction/Trades/Home Services 184 and Fitness/Recreation 110. This is **eligible-volume ranking, not conversion performance**. Existing release holds include promotional authority and outbound pause; remaining capacity at observation was 30 for the sender and 200 globally for the day. The current draft plan's 12,000 exposures per vertical is not feasible from today's pools. Treat that as insufficient data, not permission to relax evidence requirements. Recheck actual future eligible population/capacity against a reviewed frozen plan.

Three provisional copy/design proposals exist in the repository. Production has no governed review artifacts/experiments in the inspected inventory. Persisting review-only draft families through the existing CR06/CRO07 owner, checking every touch/subject preview and obtaining normal approvals remain nonsending content work. Publication, draft approval, experiment admission and delivery permission are separate states.

### Operational completion still needed

**Phase 7 measurement:** verify the exact SendGrid account/SMTP key identity, Event Webhook ID/signing public key/callback flags/read scopes and authenticated reply-mailbox reader continuity. Required configuration is documented in `docs/certification/phase7/sendgrid-feedback.md`, including `PHASE7_MEASUREMENT_ENABLED`, `SENDGRID_API_KEY`, webhook ID/public key, feedback source/account and APP_URL. Do not print or commit keys. The admin feedback-status GET performs no provider probe and therefore cannot identify which credential/configuration is absent. Once verified, only the non-sending measurement owner may be enabled through its configuration owner; outbound pause is not a technical reason to keep measurement off. Recent healthy observations cannot backdate historical coverage. Actual collection/maturity/90-day observation and real client/device acceptance remain outstanding.

**Task 2161 discovery:** first repair the missing logical-job classification and verify its gate, then initialize current-program definitions and select only the `scheduled-discovery` capability alongside preserved selective groups. The worker uses one owned 30-second recovery schedule and initializes definitions while leaving new scheduled searches off. Verify the exact deployed schema, worker heartbeat, provider/runtime authority and program/query revisions. Do not select a broad full background profile. A paid preview makes no business/contact imports; its retained artifact must be reused by a later explicit import without a second purchase. Schedule enable and downstream production crawl/materialization/preparation/current validation remain separately observed stages. No live paid preview/import was performed, so there is no production run/task/artifact/import lineage to certify. Historical ambiguous holds require evidence-based reconciliation, not automatic release or repurchase.

## Executed verification

All fresh checks target the published application SHA in isolated clones. Official Node archive was verified against the vendor SHASUMS; locked dependencies were freshly installed. Private socket-only PostgreSQL 16, private Redis/ports/namespaces and provider-denial boundaries were used. Production credentials were scrubbed from test environments. The provider-configuration warnings printed by those scrubbed test environments are **not** a production credential census.

| Check | Current result |
|---|---|
| `npm ci` / production build | PASS / PASS |
| `npm run check` | PASS, zero TypeScript diagnostics |
| CI suite manifest `--check` | PASS |
| Actual GitHub CI at main `a9acad2d` | FAIL: static wrapper exit 65 after the first otherwise-successful suite; integration, external dependency audit and artifact gate skipped |
| Current-source CI wrapper diagnosis | Direct alias suite exit 0; unchanged CI static runner exit 1/child 65, reproducing GitHub |
| Migration integrity | PASS, 1,033 checks; two recorded historical duplicate-timestamp warnings |
| Paid-provider adapter scan / provider manifest coverage | PASS / PASS |
| Phase 7 contracts | PASS, 64 behavior checks |
| Phase 7 real-PG integration | PASS, 52 checks |
| Phase 7 original upgrade fixture | FAIL, independently diagnosed above |
| Unchanged C4 recheck | PASS after fresh candidate build and verified historical baseline; original missing-prerequisite failure remains in the 57 |
| Corrected-baseline diagnostic copy | PASS; unchanged parity/replay/data-retention/check assertions; not a committed repair |
| SendGrid documented-envelope negative control | FAIL as expected at healthy-probe assertion; same real-PG integration with only response envelope changed. Confirms unsupported documented shape; no vendor call. |
| Phase 7 browser | PASS, 51 checks; private persisted role sessions and compiled client |
| Public mobile | PASS, 72 routes × five widths × two themes = 720 cells; zero narrow-width control/font diagnostics |
| Broader public visibility / shell design | PASS / PASS (390/1440 visibility in both themes; separate shell matrix) |
| Public fonts / overlays / server-hydrated parity / visitor corrections | PASS 4/4 in isolated Chromium; no production/device certification inferred |
| Public desktop diagnostics | 92 width/theme cells record smaller form fonts/controls at 768/1280; review diagnostics, not 92 narrow-mobile failures |
| Task 2161 persistence/queue/restart | PASS, 66 checks, including 35 registered HTTP authorization/CSRF checks |
| Task 2161 contracts/scanner mutations | PASS, 38 checks; unmanaged transport/unclassified-suite mutations detected and restored |
| Current waterfall and selected validation handoff | PASS in fresh full-run entries; controlled fake provider seams, no real vendor call |
| Public shell recheck | PASS unchanged suite from non-hidden isolated clone; initial hidden-path failure retained |
| Calendar browser diagnostic | PASS with only final reload selecting canonical October destination; original suite remains failed |
| Repaired HTTP suites | PASS 2/2 (`test-stage3-c2-actions.ts`, `test-stage3-c4-actions.ts`) |
| Historical fixtures and retained fault recovery | PASS: both full actual-workbook suites; retained fault/restart/legacy/budget phases; all five hash-verified XLSX fixtures |
| Upload handoff / heartbeat | PASS / PASS |
| Paid controls convergence / provider contracts | PASS (17 checks) / PASS; fake transports, no live vendor call |
| Full 304-entry roster | **FAIL: 247/304 passed; 57 child failures; 0 suite setup/teardown failures; 0 shared-launcher failures. All 304 entries produced results.** |

The first full-roster attempt was interrupted by a Replit workspace restart; its `/tmp` evidence disappeared. It has no complete result and is not combined with the later run. The replacement uses ignored persistent `.local/production-audit-2026-11-18` and copies logs back to the Mac. The older Mac 210/304 result belongs to an earlier attempt/environment and is not the current result.

All five historical XLSX fixtures were found in the actual Replit workspace, matched the exact expected hashes and row counts, and were extracted only into an owned private test directory: 2,914 rows, 1,245 businesses, 2,754 emails. The actual-workbook intake and recovery suites, retained fault/restart/legacy/budget phases, upload handoff/heartbeat and paid-control/provider-contract regressions all passed on the current published source. They are not missing globally. No workbook was uploaded/imported into production. Pre-C5 and pre-4D client baselines were built in isolated historical clones; pre-4D ignored asset bytes were restored from the existing workspace and hashed, but their historical byte identity is not separately certified. Performance comparisons remain local fixture measurements, not production budgets.

Existing browser assertions prove mount/no-document-overflow but miss text collisions and floating overlays. Extend those assertions when repairing the corresponding UI. WebKit, actual iPhone/Android, real email clients, mature populated winner UI, production-scale plans/CPU/network and provider invoices remain unexercised.

### Broader gate failures independently traced

These remain original-run failures; diagnostic variants do not turn the published repository's tests green.

| Suite | Confirmed cause / required maintenance |
|---|---|
| `test-stage3-d-r2-contracts.ts` | At line 108 it requires the literal `res.status(404).end()` inside the industry route. The actual owner calls `sendPublicNotFound`, which sets 404/no-store/noindex and returns branded HTML. Production reads independently verify 14 known routes return server-rendered 200 and the unknown route returns 404. Replace the exact-source-string check with registered-handler HTTP assertions preserving the SSR/real-404 contract; do not revert the branded 404. |
| `test-wd-locations-contract.ts` / `test-wd-industries-contract.ts` | Both require the exact `if (!html) return res.status(404).end();` text. The actual route invokes `sendPublicNotFound`, which sets the real 404 plus branded HTML/no-store/noindex. Preserve negative controls while replacing the literal implementation match with semantic HTTP assertions. The industry live 404 was independently observed; these two tests do not establish a production soft-404 regression. |
| `test-c2-postmerge-browser.ts` | The repair write and persisted SQL assertions pass, then the original test navigates to `/dashboard/calendar` without an October selector and waits for October 20, 2026. `Calendar.tsx:164–170` defaults to the actual current month, November. A diagnostic supplying October parameters through that legacy route still fails: captured URL becomes `/dashboard/tasks-appointments?tab=calendar` and November remains selected. `legacy-aliases.ts` omits Calendar's `cal_*` keys from its allowlist. A diagnostic changing only the final reload to the canonical October destination passes all original assertions (the initial fixture still opens its current-month event). Repair the test with that explicit destination; separately preserve the calendar's validated month/date/source/item/window state across its legacy alias. Never blindly carry arbitrary query keys. The two repaired HTTP suites remain independently passing. |
| `test-stage3-c5-mounted.ts` / `GhlSettings.test.tsx` | Its general fetch fallback returns `{connected:true,configured:true}` for content overview, premium drafts and acknowledgement status. Components expect their real structured contracts. Production overview/acknowledgement reads contain the expected fields. A diagnostic test copy that adds only those three read fixtures passes the original `GHL_SETTINGS_MOUNTED_PASS` assertions, including no writes on mount and one bounded continuation. Update fixtures; optionally reject malformed API shapes as unavailable in UI. Do not label the observed fixture exception a confirmed production crash. |
| `test-stage3-d-v-contact-actor-browser.ts` | The test hardcodes serving commit `cafc77ab...` and asserts zero client/shared/migration differences from that historical tree before exercising its actor-switch behavior. The current published build intentionally contains later code/schema, so it stops at that binding assertion. Bind the test to the current reviewed candidate/build receipt and retain actual actor/version/permission late-response assertions; do not simply delete the isolation test or call this a live client/server mismatch. |
| `test-stage3-c4-browser.ts` | The initial batch reaches its matched-performance phase, then rejects a missing `generated-artifacts/c4-performance-baseline/dist/candidate-integrity.json`. This run lacked that declared historical-build prerequisite. Its supported builder subsequently compiled reference `85296699...` in production mode and verified 471 output hashes. The unchanged suite subsequently passes in a separate non-hidden clone after its candidate and historical build receipts are present; the initial failure remains recorded, rather than being converted to a pass. |
| `test-public-shell-browser.mjs` | Initial failure: account form absent after a full navigation to `/login`. A diagnostic readiness wait also fails, and captured DOM reveals Express `NotFoundError`, not an auth rejection. The exact fixture uses absolute `res.sendFile(...)` under this audit's hidden `.local` ancestor; installed `send/index.js:457–468` ignores dot-path components by default. The unchanged original suite passes from a non-hidden isolated clone, confirming this audit-path effect. Do not change production auth or globally allow dotfiles to address this audit-location effect. |
| `test-stage3-b-lifecycle.ts` | At line 46 it posts a public privacy request without `Idempotency-Key` and expects 201; the current shared public-intake owner correctly returns 400 `MISSING_IDEMPOTENCY_KEY`. The real `DataRetention.tsx:58` caller supplies its stable request key. Supply a valid stable fixture UUID, retain missing-key/replay/conflict and server-field-injection negatives, and rerun the lifecycle assertions. Do not weaken the current public-intake guard. |
| `test-stage3-c1-browser.mjs` | Initial hidden-clone failure has captured Express NotFoundError and the same absolute sendFile/dot-path cause as public-shell. The unchanged non-hidden rerun gets past login but later fails the native-pointer guard on `input-edit-firstname` (target geometry and hit match the input). The remaining connected/settled-input guard condition is unresolved; no production contact edit or authentication regression is inferred. Preserve the guard and capture element connectivity and stable geometry across the edit transition before proposing a repair. |
| `test-stage3-c2-browser.mjs` | Completes its bounded role/layout/read/write checks, then fails its final visual assertion with seven dark-theme cells: the contact next-action link at five widths and task-contact links at 1280/1440 have 3.458:1 contrast. No other performance category appears in the captured seven-item list. Fix the real theme colors; retain the contrast assertion. |
| `test-phase6-provenance-and-record-class.ts` / `test-phase6-intake-cohorts.ts` | Both terminate in fixture `finally` cleanup: hard-deleting contacts violates the new `conversion_journey_evidence_contact_id_fkey` (23503). Use owned transaction rollback/disposable-database teardown rather than deleting contacts with immutable evidence. Preserve the production evidence FK; these exits do not by themselves prove business assertions passed because cleanup can mask an earlier exception. |
| `test-phase6-workspace-identity.ts` | It compares every visual TabsTrigger to top-level registry tabs. The new visual Conversion Funnel maps intentionally to `tab=growth&growthView=conversion-funnel`; ReportingHub and workspace identity already share that semantic mapping. Add a nested-view-aware assertion rather than adding a nonexistent canonical `tab=conversion-funnel` route merely to satisfy the parser. |
| `test-website-email-migration.ts` | `reverseTo0381` removes only 0382's ledger hash/objects while retaining later migrations' timestamps. The current timestamp-based migrator therefore does not reapply 0382, and the executed upgrade check fails on the missing lifecycle table. Construct a genuine prior-prefix database/journal before upgrading the whole chain; retain real historic-row, partial-schema, replay and model-parity checks. This is the same high-water fixture design problem independently traced for Phase 7, not evidence production's website lifecycle table is absent. |

The broad `scripts/certification/test-canonical-provider-import.ts` gate reached 528/1,472 deferred rows before its existing 180-second process limit terminated it (exit 143/ETIMEDOUT). Recorded batches made progress without reported per-row failure; bulk completion within this gate remains unverified. Profile its real SQL/recovery cost and use an appropriate bounded fixture/budget based on measured evidence; do not waive the test or claim an import product defect from timeout alone. The separate exact historical-workbook intake and retained faults-only gates did pass; the full retained qualification gate fails separately below.

`test-partner-hub-react-media.ts` fails before render assertions under the declared Node 22.22.0 runtime: its `registerHooks.load`/nextLoad chain returns undefined source (`ERR_INVALID_RETURN_PROPERTY_VALUE`, line 43). Repair the test loader compatibility while retaining the real React body-image/negative-control assertions; the failing test does not establish a live missing image. Exact triggering module/loader interaction remains untraced.

`test-stage3-b-browser.ts` initially receives the same hidden-path Express NotFoundError at its absolute sendFile boundary. An unchanged non-hidden rerun gets through the knowledge and lifecycle paths, then fails looking for `button-compose-email-contact` at line 74. That remaining selector/interaction contract needs independent reconciliation with the current contact action UI; no production compose action was invoked and no cause is assumed.

Additional current gates:

- Migration seed registration rejects three unclassified writes: 0360 contacts email-status cleanup, 0376 GHL appointment-state backfill, and 0381 condition-chase version backfill. Classify each actual historical business-state repair with a reason, or register convergence only if it is required configuration. Do not repeatedly replay one-time business changes at startup or blanket-exempt new migrations.
- SFP correction certification reaches its release check then rejects 306 changed audit/generated receipt paths against an old Task 1999-only working-tree allowlist. This batch intentionally generated those receipts in its private clone. Give the suite a clean isolated candidate or bind immutable source inputs separately from owned output; preserve genuine unexpected-code-drift detection. Its original result remains failed.
- SFP 2000/2001 certification stops before provider dispatch: `canonical_target_selection_required`, zero fake-provider calls and no current-run provider operation. The current validation owner (`sfp-validation.ts:1432`) enforces canonical selected-target authority; the older fixture has not established it. Update fixtures through the actual selected-target owner and retain governance/receipt assertions; do not restore the broad validation path. Complete diagnosis of any later assertions remains unexecuted. The newer selected-recipient handoff/waterfall tests pass independently.

`test-ghl-route-pause-gates-1629.ts` passes its per-call-site gating and gate-removal negative controls, then fails equality between two route-file inventories. Reconcile the actual target/allowlist sets while preserving each real pause negative control; this result is not proof of an ungated provider mutation.

`test-sequence-compliance.ts` has executed email-allowance/audit expectations failing with `mismatched_email_token`. Its fixture writes contact token hashes and provider observations, but current readiness refuses the resolved evidence. Trace the actual contact/address/receipt decision and current canonical cohort authority before changing either side. The later daily-cap expectations are also unfulfilled; do not attribute all failures solely to the first denial without a corrected rerun. No token, consent or pause guard should be loosened to make this suite green.

Remaining broader gates include `test-contactability.ts` (email-allowance fixtures denied as `mismatched_email_token`), `test-new-lead-enrollment-policy.ts` (missing expected candidate/audit rows), `sfp-certification.ts` (exact-source decryption checks plus no fake transport invocation), `test-transport-dispatch.ts` (step edit rejected because sequence is not live and paused/draft), and `check-cro02-authority.ts` (imports but does not call `authorizeCommercialUse`). Their recorded failures require bounded owner/caller reconciliation; no obsolete-test/product-defect classification is assigned here.

`test-cro03c-static.ts:246` requires four literal `hasCurrentCro03cValidationAuthority(` source matches but finds one. Preserve the actual commercial-use contract and replace/extend source-shape checks with connected behavior rather than restoring old call counts. `test-cro03c-integration.ts` fails `CRO03C_WORKER_FLEET_INVALID`; its signed inventory names deployment `certification`, while its heartbeat publication omits deployment identity and defaults to `unknown` in this scrubbed environment (`runtime-heartbeat.ts:66–67`). Bind the fixture publisher to its signed deployment/environment, retain mismatch/stale/missing-fleet negatives, and rerun; no production fleet defect was demonstrated.

The ledger-convergence guard remains active: `test-cro03-ledger-convergence.ts` catches only `/CRO03_IMMUTABLE_ROW_GUARD/`, while a diagnostic copy logging the actual caught exception records **`cro03_provider_ledger is immutable`**. The raw UPDATE is rejected; this is not proof that convergence removed the guard. Bind the assertion to the current defined guard contract (including expected SQLSTATE/relation) and retain a mutation negative control rather than accepting arbitrary errors.

Other executed broader failures: CRO-03B integration rejects a legacy write with `CRO03B_ACTIVE_RECIPE_WRITE_FENCED`; CSV handoff certification lacks its required admin fixture; convergence-verifier integrity lacks an initial `commercial_membership_revisions` fixture row. CR06/CRO07 real-PG suites stop because their fixture current-provider evidence is not qualified; reconcile the actual receipt owner before claiming later promotion assertions are exercised. The CR06 source inventory detects the added `website-email-lane-store.ts` active enrollment writer: explicitly review its warm/lifecycle owner and guard coverage, then classify it in the inventory. Do not merely add an exemption or infer an actual outbound bypass from the source-list delta.

Further recorded gates stop at explicit contracts: `test-cro03-integration.ts` invokes the now-unapproved enrichment-factory Apollo caller; `test-cro03-http-authorization.ts` lacks expected source-occurrence/qualification-policy fixture rows; `test-crm-operator-experience.ts` requires an exact old task-query source string; `test-reconciliation-certification.ts` seeds `contact_census_runs` without required `selector_hash`. Reconcile their real current owners/fixtures before certifying those paths. Missing-key/NOT NULL/provider-allowlist protections are not repair targets merely because they reject these fixtures.

The local SEO gate reports hydrated metadata missing on `/blog` and `/data-processing-agreement` (82/84 client routes pass; sitemap 541 unique/audited URLs and partner title/description uniqueness pass). Both page sources already mount `SEO`; inspect the failed hydration/request/head observation before adding duplicate metadata or treating this as a confirmed production indexing defect. The 82 duplicate-description/length notes are advisory, not 82 additional failing routes. No fresh production hydrated-head recheck was performed for those two pages.

**Broader canonical handoff gates remain unresolved:** `test-audited-retained-import-recovery.ts` fails its full retained-path assertion with 0 versus 58 expected outcomes; `test-canonical-registry-projection.ts` fails “Concurrent local workers fulfill all supported registry records”; `test-crm-contact-link-automation.ts` throws `[SelectiveProfile] Suppressed job tick could not be deferred` at the actual queue boundary. These are separate from the passing actual-workbook intake and retained **faults-only** phases. Trace the expected native qualification outcomes, projection leases and selected-worker boundary on the current owners before repairing fixtures or production code. No claim that the entire historical import-to-qualification path is green is warranted; live end-to-end acceptance should await this reconciliation.

Pause-gate failures require careful interpretation:

- `test-pause-fence.ts` requires an existing `outbound_pause_control` singleton, but the disposable selected suite starts without the server and seeds only the four legacy `system_settings` rows. It observes a missing control row and a paused `safe_default`, not an allowed send. Production's separate authenticated read verifies its real database authority row at epoch 4. Initialize the isolated fixture through the actual pause owner and retain persisted-row/fail-closed assertions; do not restart or reseed production for this test.
- `test-outbound-pause-authority.ts` requires a literal pause-authority import and `registerInflight()` inside `toolkit.ts`. The actual SMS reply route now delegates to the single `sendGhlSms` transport (`toolkit.ts:198–211`); that transport's authority, in-flight registration-before-epoch-recheck and denial behavior pass this suite's other checks. Add registered SMS-route → real transport → zero-provider-call tests under pause and scan for bypasses; do not introduce a second ad hoc route transport merely to satisfy the old source pattern. These two source failures do not demonstrate a live pause bypass.

The later `test-outbound-boundary-1626.ts` also stops on the absent isolated pause-control singleton: it reads `rows[0].epoch` after only legacy test pause state was set. Initialize that owned fixture through the real authority before running the epoch-interleaving negatives; those assertions are currently unexecuted, not passed.

`test-forms.ts` submits the literal text `fake-statement` labelled as a PDF (`:319–320`). The current file-content guard rejects it with 415 `STATEMENT_FILE_TYPE_UNSUPPORTED`; the estimate submission independently returns 201 with a receipt. Use a valid synthetic PDF for the positive upload and retain fake/unsupported-file negatives. The run also logs a nonfatal SQLSTATE 42P10 during estimate follow-up; the exact conflicting writer/index remains untraced and is not excused by the successful HTTP response. `test-statement-acquisition.ts` fails two held-projection/merchant-confirmation state expectations, while follow-up/no-delivery and lifecycle assertions pass; reconcile actual durable effect receipts before assigning cause. `test-nba.ts` records action/urgency/human-required expectation failures; current recommendation-owner/fixture reconciliation remains outstanding.

Other full-roster failures retain their executed results and are not labelled environmental, obsolete or product defects without further evidence. The CI console-marker issue, Phase 7 upgrade-fixture issue and documented SendGrid response mismatch are separate from these retained-suite failures.

## Phase 7 acceptance disposition: all 48 rows

Fresh fixture results, source facts and production reads are deliberately separated. “Fixture PASS” means contained engineering proof, not a live outcome.

| ID | Current disposition / remaining work |
|---|---|
| P7-01 | Served SHA/tree/build and current source recorded; GitHub synchronization gap remains. |
| P7-02 | Production diagnostic verifies expected tables/columns/index/native owners; no journal replay inferred. |
| P7-03 | Current command/allocation/dispatch/receipt/feedback/reporting owners traced in source and fixtures. |
| P7-04 | Fixture PASS: generic edits reject server-owned experiment fields. |
| P7-05 | Fixture PASS: semantic hashes and immutable design/content guards. |
| P7-06 | Fixture PASS: canonical current SFP pair and CR06 binding; live approved artifacts absent. |
| P7-07 | Fixture PASS: stable business assignment and overlap/concurrency exclusion. |
| P7-08 | Fixture PASS: subject-only design constraints; human subject/content approval pending. |
| P7-09 | Fixture PASS: final rendering/envelope binding and dispatch gates; no live send. |
| P7-10 | Fixture PASS: definitive receipt exposure and successful retry exactly once. |
| P7-11 | Original flat-response fixture PASS: signed/provider/mailbox lineage; documented API-key response-envelope negative control exposes a probe compatibility defect. Live subscription/reader continuity unavailable. |
| P7-12 | Fixture PASS: replay/dedup repair; no historical-message replay performed. |
| P7-13 | Fixture PASS: statistics/horizons/minimums; current volume cannot meet default draft plan. |
| P7-14 | Fixture PASS: lease/revision fencing, including expired evaluator. |
| P7-15 | Fixture PASS: human handoff makes new draft family; no live promotion. |
| P7-16 | Fixture PASS: frozen guardrail/cancel stop; no live dispatch. |
| P7-17 | Fixture PASS for role/account/ownership negatives; production admin and anonymous reads observed. |
| P7-18 | Existing safety authorities retained; production paused epoch 4 and current release ready. |
| P7-19 | Live complete 689-step inventory; human review incomplete and returned flags hidden in UI. |
| P7-20 | Live eligible-volume top three established; provisional refreshed copy reviewed in source; no conversion-winner claim. |
| P7-21 | Fixture real-renderer/missing-persona proof; nine current production simulations show sender/reply/logo/signature/footer. Refreshed draft/subject-arm approval and actual email-client rendering remain pending; text footer delimiters need polish. |
| P7-22 | Three provisional repository designs; no production governed review records, approvals, admissions or sends. |
| P7-23 | Live read-only eligibility executed; explicit per-design shortfall UI/reporting needs improvement. |
| P7-24 | Fixture PASS plus live mounted seven-stage business/deal cohort; historical coverage partial. |
| P7-25 | Writer bridges/native owners verified; historical source reconciliation not run. |
| P7-26 | Fixture PASS: atomic append-only evidence/correction and rollback. |
| P7-27 | Fixture PASS: unknown/unlinked/late/test states; live zero cohort not reconstructed. |
| P7-28 | Source/fixture provenance and cutoff dimensions verified; unavailable chains stay unknown. |
| P7-29 | Fixture PASS: Eastern/DST/numeric grain and atomic SDR replacement. |
| P7-30 | Fixture PASS: bounded versioned cohort API; live empty and invalid-filter states verified. |
| P7-31 | Fixture full-cursor export proof; production empty chart/drilldown/header-only CSV share filters/cutoff. |
| P7-32 | Retained readers inspected; Today contact-window terminology and current-package readiness display need correction. |
| P7-33 | Fixture PASS: scoped report/export sessions; no live multi-user role manipulation. |
| P7-34 | Fixture and production Reports URL/navigation reads verified; no experiment selected because none exists. |
| P7-35 | Five-width/both-theme fixtures and five-width production Chrome observed; tab/overlay defects remain. |
| P7-36 | Fixture empty/unavailable/invalid/permission states pass; production honest partial/empty/conflict; mature winner unexercised. |
| P7-37 | Fresh 720 compiled public layout cells pass; 14 production industry SSR routes and unknown-slug 404 verified; actual devices/WebKit unexercised. |
| P7-38 | Existing image provenance retained; lazy-loaded images pass layout checks; no new license or production-budget certification. |
| P7-39 | Published SHA/build/runtime selection read back and matched. |
| P7-40 | Bounded SQL/export verified at fixture scale; production query-plan/load certification not performed. |
| P7-41 | Source/fixture non-sending bounded evaluator owner verified; live measurement flag off. |
| P7-42 | Fixture PASS: concurrent owners, recovery, rollback, guardrail/lease failure cases. |
| P7-43 | Original upgrade gate FAIL; baseline-only diagnostic correction passes; requires repository fixture fix. |
| P7-44 | Registration/manifests PASS; actual CI static completion-wrapper defect prevents integration/artifact/dependency jobs; full-roster status separately recorded above. |
| P7-45 | Rollback handoff reviewed; actual publish performed by owner, no rollback exercised by audit. |
| P7-46 | Former 41 TS diagnostics resolved; current waterfall/handoff suites pass; broader remaining failures not assumed obsolete. |
| P7-47 | Engineering, deployment, live measurement, observation and device states kept separate. |
| P7-48 | This dated audit supersedes stale “not merged/not published/41 type errors” status for current observations; original records remain historical. |

## Task 2161 acceptance disposition

Step 0 was recaptured through the source/runtime/working-tree/schema observations above; exact production discovery catalog parity remains limited as stated. Steps 1–13 and the nine Done items were traced against current owners, fixtures and production reads. Definitions/pins/coverage (1), typed pre-business operations (2), async transport/retention (3), versioned canonical matching (4), retained processor/mapping (5), deterministic import/recovery/counts (6), durable lane/queue/workload (7), crawl/materialization/preparation/current validation (8), independent unit/cost populations (9), existing-workspace roles/UI (10), registered verification (11), scope boundaries (12) and delivery/rollback (13) are implemented. Operational activation and exact production schema parity retain the limits above.

Current [official Outscraper endpoint documentation](https://docs.outscraper.com/endpoints/google-maps-search/) supports GET `/google-maps-search`, async results and a four-hour post-completion availability window. The new lane selects the versioned endpoint explicitly, limit 100 and no paid enrichment add-ons. [The legacy route is deprecated](https://docs.outscraper.com/endpoints/maps-search/); that is not evidence an existing caller currently fails. No real paid request was issued to test either route.

| Acceptance | Fresh engineering evidence / live limit |
|---|---|
| T01 | PASS: concurrent processes/admin/scheduled occurrence produce one submission through real durable lane/operation rows; no live purchase. |
| T02 | PASS: process exits before dispatch, accepted-before-ID, after ID and mid-import; retained artifact/recovery uses same execution. |
| T03 | PASS: same-ID polling, transient failure, explicit expiry/unknown holds and no repurchase. |
| T04 | PASS: preview has zero business/contact/validation materialization; retained import makes zero new search submissions. |
| T05 | PASS: exact owned identities, cosmetic/suffix/phone/domain practical matches; conflicts/branches held or separated. |
| T06 | PASS: nested multiple emails, names/titles, business-only rows, website/address and separate Google ID namespaces. |
| T07 | PASS: malformed/non-JSON/204/missing-ID distinction; explicit zero history without placeholder. |
| T08 | PASS: overlay duplicate counts, distinct new/matched businesses and contacts, stable restart/replay outcomes. |
| T09 | PASS: saturation, exact county/ZIP/revision/manual coverage and changed program scope; no false census. |
| T10 | PASS: cold-start canonical processing and manual CSV/XLSX/Apollo/custom compatibility; historical original fixtures recovered; broader full retained qualification/registry/contact-link regressions fail and require reconciliation. |
| T11 | PASS: indexed 100,002-business fixture, bounded candidate lookup/memory; not a production latency benchmark. |
| T12 | PASS: current selected validation handoff/captured adapter path with real private infrastructure and fake network seams; no live downstream lineage. |
| T13 | PASS: 35 actual registered HTTP auth/CSRF checks. Fresh live admin read-only empty panel at phone/tablet widths; original delivery's populated/error/manager browser screenshots remain historical evidence. No fresh populated-state browser regression suite exists. |
| T14 | PASS: provider/scanner mutation detection, manifest registration and current waterfall regressions. |
| T15 | PASS: versioned endpoint contract, narrow profile selection, actual BullMQ owned repeat and heartbeat while schedule off. |

| Done item | Disposition |
|---|---|
| D1 — admin definitions/readiness/history/counts/costs | Persistence/contracts exercise populated states; live empty panel/readiness/counts verified; no live history exists. |
| D2 — explicit paid preview, no materialization | Real isolated queue/HTTP/persistence proof (T01/T04/T07); no paid production action. |
| D3 — retained import, no repurchase; scheduled shared path | Fixture PASS (T02/T04/T08/T10); no production artifact/import lineage. |
| D4 — default-off schedule and workload controls | Fixture PASS and production schedule off; workload defaults visible; no save/enable action. |
| D5 — singleton search, same-ID resume, uncertain hold | Real process/Redis/PG fixture PASS (T01–T03); no new production submission. |
| D6 — practical matching with real-conflict holds | Fixture PASS (T05/T06/T08/T11); no global/manual matching policy change. |
| D7 — preserve manual files/evidence/suppression/recovery | Exact historical workbook intake, faults-only recovery and upload regressions PASS. Broader full retained qualification, registry projection and contact-link gates fail and remain unresolved; no production manual import performed. |
| D8 — actual crawl/preparation/current-validation owners | Selected handoff and waterfall fixtures PASS; production downstream eligible/queued/processed/validated lineage not exercised. |
| D9 — UI/navigation/migrations/registration/restarts/release | Implementation and focused tests present; production empty UI verified. Missing logical-job classification, exact discovery schema parity, populated browser automation, broader gate repairs, GitHub source reconciliation and operational evidence remain unfinished. No all-green delivery gate claim. |

V01–V16 / F01–F14 reconciliation: transport reuse and versioned endpoint (V01/V15); real pre-business operation subject and lost-ID marker/reconciliation (V02/V03/V13, F01/F02/F03/F11/F12); occurrence/artifact/canonical identity and shared cold-start importer (V04/V05/V14, F05/F06); practical policy in the canonical resolver (V06, F04); independent business/contact/usage/cost populations and full native field mapping (V07, F08/F09); zero-materialization preview and retained import (V08, F06); retention/expiry/saturation/exact geography and manual coverage (V09/V10, F07/F12); current selected crawl/materialization/preparation/validation path with old broad lane contained (V11/V12, F10); actual real-PG/process/browser/mutation checks (V16, F13/F14). These are fresh fixture/source dispositions; none claims paid production completion.

The nine Done items therefore have substantial engineering evidence, with D9 verification/reconciliation gaps explicitly retained. Scheduled business discovery is not operationally complete in production: definitions absent, worker not selected, schedule off, zero live run/import/crawl/validation receipts. That is a configuration/acceptance gap, not proof the durable discovery engine is broken.

## Complete original-run failure inventory

The 57 failed suite paths below are the authoritative original batch receipt. Passing diagnostic variants and environment-corrected rechecks are recorded separately above. Full machine-readable 304-entry results and raw logs remain in private evidence; the list is not a claim of 57 production bugs.

- `scripts/test-stage3-d-r2-contracts.ts`
- `scripts/test-stage3-c5-mounted.ts`
- `scripts/test-stage3-d-v-contact-actor-browser.ts`
- `scripts/test-website-email-migration.ts`
- `scripts/test-stage3-c4-browser.ts`
- `scripts/test-c2-postmerge-browser.ts`
- `scripts/test-wd-locations-contract.ts`
- `scripts/test-wd-industries-contract.ts`
- `scripts/test-public-shell-browser.mjs`
- `scripts/test-stage3-c2-browser.mjs`
- `scripts/test-phase6-provenance-and-record-class.ts`
- `scripts/test-phase6-intake-cohorts.ts`
- `scripts/test-phase6-workspace-identity.ts`
- `scripts/test-phase7-upgrade.ts`
- `scripts/test-stage3-c1-browser.mjs`
- `scripts/certification/test-audited-retained-import-recovery.ts`
- `scripts/certification/test-canonical-registry-projection.ts`
- `scripts/certification/test-crm-contact-link-automation.ts`
- `scripts/certification/test-canonical-provider-import.ts`
- `scripts/test-partner-hub-react-media.ts`
- `scripts/test-stage3-b-lifecycle.ts`
- `scripts/test-stage3-b-browser.ts`
- `scripts/check-migration-seed-registration.ts`
- `scripts/dependency-audit-policy.ts`
- `scripts/test-sfp-disposable-certification.ts`
- `scripts/test-sfp2000-disposable-certification.ts`
- `scripts/test-sfp2001-campaign-staging-certification.ts`
- `scripts/check-contact-merge-manifest.ts`
- `scripts/check-queue-compliance.ts`
- `scripts/test-ghl-route-pause-gates-1629.ts`
- `scripts/test-sequence-compliance.ts`
- `scripts/test-contactability.ts`
- `scripts/test-new-lead-enrollment-policy.ts`
- `scripts/sfp-certification.ts`
- `scripts/test-transport-dispatch.ts`
- `scripts/test-redis-topology.ts`
- `scripts/check-cro02-authority.ts`
- `scripts/test-cro03c-static.ts`
- `scripts/test-cro03c-integration.ts`
- `scripts/test-cro03b-integration.ts`
- `scripts/certify-cro03b-csv-handoff.ts`
- `scripts/test-cro03-ledger-convergence.ts`
- `scripts/test-seed-convergence-verifier-integrity.ts`
- `server/tests/cr06-promotional-boundary-inventory.source.test.ts`
- `scripts/test-cr06-disposable-certification.ts`
- `scripts/test-cro07-disposable-certification.ts`
- `scripts/test-cro03-integration.ts`
- `scripts/test-cro03-http-authorization.ts`
- `scripts/test-crm-operator-experience.ts`
- `scripts/test-reconciliation-certification.ts`
- `scripts/seo-audit.ts`
- `scripts/test-pause-fence.ts`
- `scripts/test-outbound-pause-authority.ts`
- `scripts/test-outbound-boundary-1626.ts`
- `scripts/test-statement-acquisition.ts`
- `scripts/test-nba.ts`
- `scripts/test-forms.ts`

## Evidence and preservation

Private Mac evidence: `/Users/matt/.local/share/liberty-dev/production-audit-2026-11-18/`. Fresh rerun logs: its `verification-rerun/` directory. Production JSON/screenshots/AX output are private; raw customer workbooks, credentials, mailbox contents and the full installed copy inventory are not committed to the repository.

Key screenshots: `phase7-copy-review-flags-not-shown.jpg`, `phase7-funnel-320.jpg`, `2161-imports-320.jpg`, `production-current-package-wrong-label.jpg`, `production-healthcare-email-preview.jpg` and `2161-production-imports-desktop.jpg`. Phone metrics, nine preview receipts and the successful empty CSV are retained beside them. Temporary viewport overrides were reset; no browser profile/auth caches were copied or preferences altered.

Replit verification scratch is isolated under `/home/runner/workspace/.local/production-audit-2026-11-18`; Git-ignored artifacts do not dirty or alter the workspace's tracked application source. SSH is used directly through `liberty-replit`. No Replit Agent was messaged. Existing Mac services/worktrees and production settings were preserved. All verification runners finished; their disposable DB/Redis/server resources were torn down. The audit-owned temporary workbook extraction was removed after checking its exact owner marker, while original attached assets were preserved; their logs and source receipts remain reviewable.
