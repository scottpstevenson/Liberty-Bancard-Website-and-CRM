# Stage 3 A workspace execution receipts — 2026-10-03

## Status and provenance

**INCOMPLETE / NOT RELEASE-READY.** This is an intermediate, independently tested
workspace candidate, not a completion/merge/deployment receipt. Original findings,
evidence qualifications and B/C/D/later-stage ownership remain intact.

- Starting/current tracked HEAD: `1c6f81a95aea4f3502e2274763d767a31a982338`.
- Earlier public health observation: serving `c85deb3c45bd617b066dc066b579d66520137d0b`,
  built `2026-10-03T13:05:59.405Z`, build ID
  `c206d29c-54f4-4b24-88b6-4203fe93e13c`. This predates the repairs.
- Supported local toolchain: Node `22.22.0`, npm `10.9.4`.
- Package manifest SHA256:
  `4408be46ca7912b4f0ac9667a0047970284122091bd092e1210a799703379cb0`.
- Portable lock SHA256:
  `ff31ba4ad57820f730239b88abd7140a159c589b9742d7955fb576dc5bac9aba`.
- Regenerated lock through public npm in a disposable directory; exact locked
  versions/integrities preserved. Four private HTTP resolutions replaced by npm's
  public metadata resolution, not an unaudited text substitution.
- Local dirty-tree build ID `aa5b987a-aa5b-42f3-9126-e633f98cc853`. The build embeds
  HEAD, not a clean-tree proof. It is **not** equivalent to a deployed artifact.
- Earlier dev restart rendered the login screen only. Latest verification uses
  an isolated registered-handler server, real synthetic password sessions and
  Chromium; no further full application startup was used. Desktop and 402px
  phone viewport in the existing desktop-view mode PASS for SequenceReport
  runtime and cold-audience labels. Native mobile work queues are not certified.
- Important observed dev side effect: the existing startup
  `ContactClassBackfill` logged 17 test + 7 production records changed from
  `unknown`, despite background profile `off`. This was not an intentional task
  identity-cleanup action; the profile is not a read-only startup guarantee.
  No production startup/deployment was performed. No speculative undo attempted.

## Gate receipts

| Gate | Actual execution and limits |
| --- | --- |
| A-G01 | Source/manifest/lock identities recorded. No repaired serving-artifact or deployed-install receipt. Pending D/platform. |
| A-G02 install | `npm ci --include=dev --registry=https://registry.npmjs.org` on disposable public-registry copy, supported toolchain, scripts enabled: exit 0. Earlier ignore-scripts receipt is superseded by this stock install only. |
| A-G02 sources | `npx tsx scripts/dependency-policy-evidence.ts --strict-sources --output ...`: exit 0, 1,032 locked packages fingerprinted. `test-dependency-policy-evidence.ts` and `test-inventory-artifact-dependencies.ts`: PASS. No private HTTP package resolutions remain. |
| A-G02 security | `scripts/dependency-audit-policy.ts` FAIL: 0 critical, 7 high. Fresh public audit reports braces GHSA-vfj7-8cjw-p6xm affects all published versions through 3.0.3; public latest is 3.0.3. Tailwind/chokidar/micromatch/fast-glob/typography/animate chain affected. Automatic proposed typography 0.4.1 is a major downgrade, and animate has no suggested fix. No audit exception, major migration or blind override applied. |
| A-G02 stock static | Earlier `scripts/run-ci-suites.ts --capability deterministic-static` stopped at the baseline SFP expectation for `assertPaidBudgetAuthorized`. User subsequently confirmed paid approval and paid limits were intentionally removed. The source-only test now asserts that the removed gate stays absent, retaining activation/reservation/dispatch checks; `node scripts/test-sfp-pipeline-correction.mjs`: PASS, 21 assertions. No runtime approval or limit reinstated. Full stock jobs are still not certified; the complete static runner has not been rerun after this correction. |
| A-G03 focused | `test-stage3-a-authority.ts` PASS on guarded disposable DB: actual local password sessions for admin/manager/agent/merchant/affiliate/partner; cold owned/unassigned positive and nonowned omission; mixed set rejected with no audit write; duplicate IDs rejected; missing CSRF rejected; repeated processed outcomes enrolled=0 and no deceptive tags; denied workflow CRUD/read/run/history roles; unsupported/missing entities produce no workflow runs; zero provider fetches. Does not yet cover all stale-owner/deal-state races, receipt-backed true enrollment, every consumer/export/cache permutation or injected legacy bridge outcomes. |
| A-G04 focused | Same fixture/asOf/UTC/agent tests compare actual storage list with shared metric read: open/in_progress/completed/cancelled and deleted rows, overdue and state-filtered list: PASS. Source adoption in storage, task routes, overview/task analytics and briefing. Remaining A: exhaustive linked-class/archive/unlinked/ownership/timezone and actual HTTP overview/analytics/briefing cross-reader snapshot fixtures. B: client/UI/AI factual/fallback/workflows. |
| A-G05 focused | Actual DB 2 steps / 3 memberships / 1 unique contact with active/cancelled/completed history: PASS, not six. Remaining A: zero-child fixtures, manager owned/global-denied actual sessions and interacting browser/API-failure receipts. |
| A-G06 focused | Actual full-population 5,001 additional production recommendations with bounded 100-row details: PASS. Actual deployment/cash/paid-off unavailable and old rejected-stage recommendation never automatically paid off. Model-price ambiguity cannot multiply recommendations. Remaining A: exhaustive archive/test/rejected/empty/month-cost and observed shipment/order evidence permutations. No financial ingestion added. |
| A-G07 service | `test-ghl-inbound-sync-integration.ts` PASS: fake GET multi-page preview/apply; identity conflicts, blank preservation, no provider projections/validation/readiness; idempotency; active pointer concurrency; outbound/epoch/lease fences; signed partial/update webhook and replay. Actual Node fetch with loopback 302/307 host/path/location alternatives rejects redirects; zero destination requests/apply counts; safe error persisted; incoming remains Enabled in disposable fixture. Remaining A: timeout/429/redirect retry checkpoint permutations. No historical failure/attack/token-leak claim. |
| A-G07 middleware | `test-ghl-inbound-route-guards.ts`: PASS 42 actual middleware role checks and five validation checks; no persisted sessions. Its DB-bound imports now require pre-import infrastructure guard. Not mislabeled HTTP/session certification. |
| A-G07 source | Pure pagination suite PASS; guarded sanitizer/source suite PASS. Neither substitutes for service/DB/history. |
| A-G08 | Source changes return durable local 202 degraded identity and retry canonical incomplete orchestration; completed/accepted replay no-op. Initial linkage is in the orchestration catch. **Not closed:** fault injection before/after commit, linkage/task/effect/audit/queue failures, concurrent replay and durable pending receipt coverage still required. |
| A-G09 component | Actual React server renders: 27 typed SMTP/GHL configuration × global pause permutations plus failed/unavailable read PASS; sequence reason not recorded rather than asserted compliance. Ten existing incoming UI static-state fixtures PASS. These are not interactive browser/worker/native receipts. |
| A-G10 | Both supplied canonical documents append individual intermediate dispositions for all 33 original A parent rows plus amendment subclaims; prior 95 finding definitions retained. Final handoff remains pending outstanding A gates. No composite parent marked resolved. |
| Static/build | `npm run check`: exit 0. `npm run build`: exit 0, existing CJS/import.meta warning retained. `scripts/ci-suite-manifest.ts --check`: PASS, 144 required suites classified consistently with pre-deploy. `git diff --check`: PASS. |

The disposable infrastructure was loopback PostgreSQL with dedicated test DBs and
isolated Redis prefix; runs used `env -i`, fake fixture session material and
`BACKGROUND_JOB_PROFILE=off`, `GHL_TRANSPORT_FAILFAST=true`. No production DB,
production DDL, control toggles, sends, spend, native writes or released held
enrollment intents were authorized or performed.

## Exported contracts and consumers

- `coldLeadPredicate(user, values, asOf)` is a dormant, sourced, visible production
  contact census, not consent/readiness/value. `requestColdReengagement(user, ids)`
  locks/rechecks the complete set and returns processed `held|blocked|skipped`
  outcomes with `enrolled:false`, enrolled total zero and explicit reasons.
  Local audit holds are not executable enrollment intents. Legacy bridge
  `replit_direct` alone cannot prove performed enrollment.
- `TaskReadScope`, `taskStateSql`, `taskReadPredicate(scope)`,
  `readTaskMetrics(scope)` are contract v1. Scope includes actor, record class,
  states, asOf, timezone, due range, deal and source. Deleted tasks excluded;
  archived/class-invalid linked objects excluded; agent links require exact
  ownership; unlinked tasks require exact task assignee. Creation normalization
  and authority guard preserved. asOf freezes comparisons, not concurrent
  snapshots; parity test uses static fixture data. No cache claims are made.
- Actual task consumers: `server/storage/tasks.ts`, task GET routes in
  `tickets-tasks.ts`, overview/report in `analytics.ts`, due/overdue reads in
  `daily-briefing.ts`. Task read failure is not zero; briefing task population
  marks degraded/unavailable. Other contact/deal/ticket summaries remain distinct
  populations. Shared contact/deal predicates are now adopted by the overview
  and briefing deal reads; registered agent scalar comparisons PASS.
- `SEQUENCE_REPORT_SQL` independently aggregates child identities;
  `SequenceRuntimeStatus` version 1 and `readSequenceRuntimeStatus()` separate
  configured, global pause, unobserved enablement/probe/delivery and unknown reason.
  `SequenceRuntimeFacts` is the tested consumer. Manager client uses owned
  enrollment read; no expanded global manager access. Paused active memberships
  are not proved delivery or stalled unique people.
- `readTerminalRecommendationReport(page, thresholds)` aggregates a single full
  scoped SQL statement; details capped at 100/page. Population is production,
  nonarchived recommendations; actor scope management, USD, UTC, statement
  snapshot. Recommendation/model cost/estimated GP are forecast inputs;
  deployment/cash/paid-off actuals null. Empty successful count is zero; missing
  model price/GP is unknown. Shipment/order proof is not inferred.
- Manual-create compatible contact response adds `_handoff` request identity,
  lifecycle state and replay; postcommit error returns 202 `degraded/retryable`.
  Same-key retry uses canonical request work identities, not new native writes.
  Actual pre/postcommit, task, request-link/work-link/effect faults and concurrent
  replay PASS with one contact/task. Replay retains pending provider projection
  and explicitly unobserved delivery; no external effect is released.
- Incoming diagnostic observation: `source`, `observedAt`, `ownerMode`,
  checkpoint, lease expiry, stored-run freshness and `consumption` evidence.
  No stored run means not observed, not healthy/connected. Separate manual
  incoming/webhook lanes from legacy queue ownership. No fleet activation.

## Changed implementation and certification paths

Package: `package-lock.json` (manifest intent unchanged).

Server routes: `analytics.ts`, `campaigns.ts`, `contacts.ts`, `daily-briefing.ts`,
`terminal-economics.ts`, `tickets-tasks.ts`, `workflows.ts`.

Server services/storage: `cold-lead-authority.ts`, `ghl-inbound-sync.ts`,
`inbound-request-authority.ts`, `revenue-read-authority.ts`,
`sequence-report-query.ts`, `sequence-runtime-status.ts`, `task-read-authority.ts`,
`terminal-report-authority.ts`, `storage/tasks.ts`.

Shared: `ghl-inbound-sync.ts`, `sequence-runtime-status.ts`.

Client: `components/dashboard/GhlInboundSyncCard.tsx`,
`components/dashboard/SequenceRuntimeFacts.tsx`,
`pages/dashboard/{ColdLeads,SequenceReport,Sequences,TerminalROI}.tsx`.

Certification: `ci-suite-manifest.ts`, `pre-deploy.ts`,
`test-sfp-pipeline-correction.mjs` (user-confirmed obsolete paid-approval expectation),
`test-ghl-inbound-{route-guards,sync,sync-integration}.ts`,
`test-ghl-inbound-ui-render.mjs`, `test-stage3-a-authority.ts`,
`test-stage3-a-runtime-render.mjs`, `test-stage3-a-runtime-ui.tsx`.

Canonical documents: exact supplied specification and current ledger, append-only
intermediate dispositions. No Sandbox artifact or production deployment changes.

Provider execution comments in `sfp-provider-operations.ts` no longer claim an
explicit paid-approval gate. This is documentation only, with no runtime change.

## Latest coherent verification — 2026-10-03

These receipts supersede outdated pending statements above, not the preserved
original findings. **Task remains incomplete / not ready for review or release.**

Durable logs: `.local/tasks/stage3-a-final/`; signed-in screenshots:
`.local/tasks/stage3-a-browser/sequence-1440.jpg` and `sequence-402.jpg`.

- `scripts/test-stage3-a-authority.ts`, with the optional Chromium proof: exit 0.
  Actual session/CSRF/DB reads prove owned/unassigned visibility, the deliberate
  owned-deal versus direct-object distinction, complete-set denial, and contact
  and related-deal ownership races observed waiting at real row locks. Final
  relationship scope is rechecked before audit; denied mixed sets have no writes.
  Held/blocked requests remain enrolled=0 with no activation tags/provider I/O.
- Shared task linked class/archive/ticket/owner/unlinked/state/date fixtures PASS.
  Actual same-clock HTTP list, overview, analytics and briefing comparisons PASS;
  static data/frozen application clock is not a concurrent DB snapshot claim.
  Shared contact/deal overview comparisons PASS. Creation authority is preserved.
- Actual independent 2-step/3-membership, repeated-contact, zero-child and manager
  owned-positive/global-and-other-denied reads PASS. Injected read error is 500,
  not a successful empty result.
- Full-population 5,001-row recommendation fixtures PASS. Archived/test rows are
  excluded, rejected recommendations remain forecasts, unknown model cost
  makes both total/monthly forecast cost unavailable. UTC timestamp comparisons
  are explicit; deployment, cash recovery and paid-off actuals remain null.
- Actual registered create/writer/request authority PASS for precommit failure,
  timeout after commit, orchestrator/task failure, DB request-link/work-link/
  internal-effect fault, same-key payload/caller conflicts, and concurrent replay.
  Stable camelCase identity, one canonical task, held external effects and visible
  pending projection survive replay. No provider write/release was performed.
- `scripts/test-ghl-inbound-sync-integration.ts`: exit 0. Actual fake-service
  302/307 origin/path/location redirects cause no destination request/apply.
  Timeout/429 on a later page preserve checkpoints and incomplete state; replay
  remains safe, incoming stays Enabled. Existing no-echo/lease/epoch/webhook and
  multi-page tests PASS. Not proof of historic/native production metadata.
- 27 typed runtime render permutations plus unavailable read PASS. Signed-in
  desktop and phone viewport using the existing desktop-view control PASS.
  Runtime facts now remain visible with zero sending identities. Active sequence
  state and configured limits no longer imply send permission/throughput.
  No native mobile-workqueue, real probe, verified delivery or fleet-health claim.
- Final `scripts/run-ci-suites.ts --capability writable-build`: exit 0, 1/1.
  Typecheck, production build, dependency inventory and redacting artifact scan
  PASS. Isolated copy owns independent Git metadata. Build ID
  `978c5de8-9f9c-4265-b640-3f63863bab4b` embeds base HEAD, not repaired serving
  equivalence; the candidate is uncommitted and has not been deployed.
- Real-lock strict provenance PASS, 1,032 fingerprints. Package manifest hash
  remains unchanged. Dependency audit remains FAIL: 0 critical / 7 high, with
  no exception, blind override or unapproved Tailwind-chain migration.
- Stock static runner reaches `API Coverage` and fails nine missing endpoints.
  Current analyzer against exported unchanged HEAD yields the identical nine;
  `newVsBaseline=[]`. This is baseline proof, not a passing stock job.
- Stock integration reaches SFP disposable certification and rejects this
  uncommitted task's clean/diff-isolation state. No user repairs stashed, no
  assertion removed, no whole-job PASS claimed. Server-required stock gates
  remain uncertified. Both required stock jobs remain blocked.
- Additional PASS: dependency-policy/inventory fixtures, reporting boundaries,
  runtime render, and `git diff --check`. No schema migration was added.

Additional changed paths: `server/services/contact-writer.ts`,
`scripts/run-ci-suites.ts`, `scripts/test-reporting-boundaries.ts`,
`scripts/stage3-a-{browser,cold,create,read}-fixtures.ts`.
Complete tracked/new path censuses are in the durable receipt directory.
Canonical specification and ledger retain all 95 original IDs, individual
33-parent A dispositions and outstanding B/C/D/later-stage owners.

## Approved dependency/API continuation — candidate checkpoint

The user approved the smallest dependency migration needed for the high-severity
security gate, preservation of branding/layout/behavior, resolution of all nine
real API mismatches without suppression, a committed clean-checkout integration
run, and no deployment.

- Tailwind's compiler and Vite integration are now 4.3.3. The original resolved
  palette, typography/shadow/blur/radius/ring scales and MIT-licensed reset are
  retained as design compatibility data; no vulnerable v3 engine is retained.
- Exact npm public metadata verified all 31 installer-introduced mirror
  tarball identities against their retained versions and SRI before npm
  regeneration. Strict actual-lock policy PASS: 939 fingerprints. Package
  intent and existing overrides are preserved.
- API census PASS: 831 client endpoints, 1,679 mounted handlers, no exceptions.
  The missing inbox thread read uses existing immutable-source/object
  authority, with actual session owner/nonowner/portal/missing tests.
  Locations uses contact PUT; reconciliation cancellation uses existing
  DELETE; agent assignment uses existing deal PUT ownership email. The already
  retired virtual-terminal client was removed, its permissions column says
  Retired without an unsupported toggle, and case intake no longer manufactures
  audit events or claims an unobserved notification.
- Restricted external-security capability PASS 1/1: zero high/critical;
  seven moderate and one low remain, outside this minimal high-severity repair.
- Public desktop/phone Chromium measurements PASS for original brand color,
  hero sizes and no horizontal overflow. Changed signed-in reporting pages
  PASS at desktop and phone widths in supported desktop-view mode.
- The complete static runner also found outdated source-binding checks and a
  DB-bound lifecycle unit import mislabeled static. Source checks now assert
  the injected alias's canonical production binding; the lifecycle test is
  pre-import guarded and classified integration, not downgraded.

Full static, clean installation/build, clean-checkout integration and
server-required stock gate outcomes are still pending at this candidate
checkpoint. This does not renew serving-build, native/history, B/C/D or
production release claims.

## Final scoped implementation handoff — 2026-10-03

The user confirmed closure of the implemented Task A work and stopped expansion
into unrelated legacy test repairs. **Implementation/focused certification
complete; NOT RELEASE-READY.** This is a scoped task handoff, not a claim that
both full stock CI jobs pass or that Stage 3 is certified. Earlier entries are
dated receipts; the following supersedes their outdated candidate/gate statuses.

- Implementation source: `255d25bbbf6d014ed34a18ca5e46aae0be1278df`.
  Final handoff changes are documentation/temporary-harness cleanup only.
- Supported public stock install PASS, real-lock policy PASS (939 fingerprints),
  API census PASS (831 client endpoints / 1,679 mounted handlers).
- External security PASS: zero high/critical; seven moderate and one low remain.
- Stock deterministic-static PASS, 57/57; writable-build PASS, 1/1, including
  typecheck, build, inventory and redacting artifact scan. The build artifact
  identifies source `9ded5299fd72b53c4f203c93e9cb24ee7f2c9661`, not a deployed
  repaired build. Subsequent certification-script changes do not renew that build.
- Focused registered-session/DB authority suite PASS; same-clock backend task
  parity, contact list/facet/cache/export scope, sequence fanout/manager reads,
  full-population forecast-only finance and create/replay recovery PASS.
  Actual incoming fake-service redirect/checkpoint/no-echo tests PASS.
- Public desktop/phone brand preservation and signed-in reporting browser proof
  PASS. Native mobile work queues remain unverified. Runtime incoming observations
  explicitly separate unavailable legacy GHL/enrichment/SLA/communications owner
  and native-mapping proof; 27 render permutations plus unavailable-read PASS.
- Full `deterministic-integration` stopped at suite 21/61, **CR-06 Disposable
  Authority Certification**: its Redis reservation conflicts with the stock
  runner's reservation. Full job FAILED; no complete integration receipt.
- Full `server-required` stopped at **New-Lead Enrollment Policy**: B9/B22
  expected candidate audit records and B23 expected membership were absent.
  Full job FAILED. No baseline-equivalence proof is claimed for these failures,
  and no product authorization/cohort/pause policy was weakened to satisfy them.
- The unverified, uncommitted CR-06 child-reservation experiment was withdrawn,
  not included in delivered code. Owned disposable server/PostgreSQL/Redis were
  stopped and the temporary exposed certification port mapping removed.
- Durable final logs: `stage3-a-final/handoff-{static-build,integration,server,
  authority,browser,security,install}.log` and `handoff-policy.json`.
  These retain failures as well as passes; receipt absence is never zero/success.

Both supplied canonical documents retain all 95 original findings and the
individual 33-parent A matrix, with final corrections below their dated matrices.
B owns task/AI/UI/workflow completion; C owns its presentation/redesign slices;
D/platform/later stages retain native/history, fleet, deployment and release
evidence. Composite parents remain PARTIAL where those obligations remain.
Outbound stays Paused, incoming independently Enabled, proposals Hold for Review.
No production deployment/DDL, spend, native writes, real sends/enrollment or
release of held intents was performed. Required full-CI failures remain explicit
release blockers even though the user requested closure of this scoped task.

### Configured completion validation limitation

Completion API coverage and code review PASSED. Configured
`npx tsx scripts/smoke-role-guards.ts` could not meaningfully reach its application:
the log reports all four retries timing out for anonymous, merchant and admin
requests, with transport result -1 rather than an HTTP authorization response.
The completion monitor exhausted its polling budget without a terminal result.
This environment-bound smoke check is **unavailable, not PASS**, and is audited
as the reason to skip rerunning configured validation on scoped closure.
The disposable registered-session role/CSRF/object-denial receipts remain valid;
they do not substitute for app-wide smoke or full-CI release certification.