# LIBERTY BANCARD — STAGE 3 TASK A
# MASTER REPLIT PREFLIGHT + BUILD PROMPT


## Task A — Reproducible source, shared authority and truthful metrics

Implement R01/R02/R03/R06/R07 and the shared non-UI CRM3-05 contract. Repair source/dependency reproducibility, collection and selected-ID authorization, metric definitions, no-echo GHL incoming pagination, sequence totals/manager read contract, and runtime truth. Keep all currently functioning incoming repairs. Minimal consumer changes needed to honor DTOs/labels are in scope; global UI redesign is not.

### A. Verified from current code — seeded preflight table

| ID / original entries | Verdict and exact current source evidence | Repair and closure requirement |
| --- | --- | --- |
| A01 / CRM3-01 | CURRENT PROVENANCE GAP: new serving SHA is not accessible from origin; health is not source equivalence | Obtain serving source + lockfile + receipt; compare actual contents, do not infer from Published your App. Safe source-only work continues with explicit limitation. |
| V01 / CRM3-02 | SOURCE CONFIRMED: package-lock.json has package-firewall.replit.internal resolved URLs; previous stock install 502 is dated, not rerun here | Regenerate portable supported lockfile and prove clean supported npm ci/stock CI. Check actual availability/version policy before changing resolutions. |
| V11 / CRM3-14 | SOURCE CONFIRMED: cold-lead read/bulk routes in server/routes/contacts.ts do not reuse full actor/object authority; existing server/services/crm-object-access.ts and revenue-read-authority.ts provide reuse targets | Scope SQL before pagination/count; authorize all selected IDs before local writes or jobs; role/IDOR fixtures through actual routes. Preserve approved unassigned semantics. |
| V22 / REF-056, CRM3-14/25 | SOURCE CONFIRMED: server/routes/workflows.ts create/update/run use isAuthenticated; delete requires admin/manager | Management role policy + valid object IDs + scoped run entities before executor; admin/manager positive and other-role negative no-effect tests. B consumes guard. |
| V08 / CRM3-11, REF-006/069 | SOURCE-TRACED DIFFERENT SCOPE: revenue-read-authority.ts has class/archive/filter/actor predicates; list versus all-class census labels were inconsistent in earlier live view | Same-scope list/count/facet/export contracts and explicit all-class census labels; no forced parity across intentionally different populations. |
| V09 / CRM3-12 | SOURCE CONFIRMED: terminal-economics.ts around 268–340 takes first 5,000 deals, filters terminalRecommendation, calls rows deployed, uses forecast GP/time for payback | Full scoped bounded SQL; separate recommendation/ordered/verified deployed and forecast versus actual ledger. If no deployment/cash receipt exists, return unknown/unavailable actual, not invented deployed/paid-off. |
| V12 / CRM3-15 | SOURCE CONFIRMED: contacts.ts ~500 estimatedValue=total*15000 | Remove unsupported measured value or label explicit scenario with assumptions/version; audience/status labels match actual predicates. |
| V13 / CRM3-16, REF-011/066 | SOURCE CONFIRMED: campaigns.ts ~1938–1940 joins both sequence_steps and sequence_enrollments onto parent before counting | Aggregate independently by sequence and distinct enrollment identity; 2 steps/3 memberships must produce 2 and 3, not 6. Clarify paused/stalled/terminal semantics. |
| V14 / CRM3-17 | SOURCE-TRACED READ/CLIENT CONTRACT: manager page uses an admin-only global enrollment dependency; earlier actual handler returned 403 and UI defaulted empty | Existing owned per-sequence read or scoped summary; retain admin-only global endpoint if appropriate, show failure explicitly, manager cannot read another owner's sequence. |
| V16 / CRM3-03, REF-008/069 | SOURCE CONFIRMED VALIDATOR + DATED LIVE FAILURE: ghl-inbound-sync.ts ~282–319 rejects unsupported nextPage metadata; earlier persisted run read 3,994 then GHL_INBOUND_PAGINATION_INVALID | Capture sanitized response shape; support only verified pagination forms, preserve host/location/limit/cursor safety, bounded progress and lease/replay. Numeric nextPage has not been proven as that live payload's root cause. |
| A11 / CRM3-03/04 | VERIFIED EXISTING SOURCE REPAIR: incoming route/service/shared DTO, admin-only control, paused-epoch/lease checks and local-only import already exist | Regression-test existing import, no echo, preserve fields/dedupe/unmatched add/replay, incoming enabled while outbound paused. Do not introduce a second sync engine or disable one-way authority. |
| A12 / CRM3-20, REF-009/014/015/017/041 | PARTIAL / RUNTIME RECEIPT REQUIRED: config/connection is separate from freshness/consumption/native stage semantics | Honest configured/connected/enabled/last-success/heartbeat/backlog/error DTO; exact worker ownership receipts; no blanket job enablement, OpenAI call, provider spend or native mapping guess. |
| A13 / CRM3-05 | SOURCE CONFIRMED SHARED PREDICATE GAP: tasks storage excludes deleted rows; overview/briefing contain independent predicates | A supplies one shared task query/metric authority and canonical DTO. B wires consumers and fixes AI factual claims; do not independently patch two divergent copies. |

### B. Relevant files and blast radius

Inspect: `package.json`, `package-lock.json`, `.github/workflows/ci.yml`, `script/build.ts`, `shared/sfp-publish-build-identity.ts`; `server/routes/contacts.ts`, `server/services/crm-object-access.ts`, `server/services/revenue-read-authority.ts`, `server/routes/analytics.ts`, `server/routes/terminal-economics.ts`; `server/storage/tasks.ts`, `server/services/task-authority.ts`, `server/services/task-normalization.ts`, `server/types/task-types.ts`, `server/routes/daily-briefing.ts`; `server/routes/campaigns.ts`, `server/storage/automation.ts`, `shared/schema.ts`; `server/routes/workflows.ts`, `server/routes.ts`, `server/services/workflow-executor.ts`; `server/routes/ghl-inbound-sync.ts`, `server/services/ghl-inbound-sync.ts`, `shared/ghl-inbound-sync.ts`, `server/services/ghl.ts`, `server/services/ghl-sync.ts`, `server/routes/ghl-mutation-pause.ts`, `server/routes/admin.ts`, `server/services/cro03/sfp-runtime-fence.ts`; minimal consumers `ContactsAndLeads.tsx`, `ColdLeads.tsx`, `TerminalROI.tsx`, `Sequences.tsx`, `GhlSettings.tsx`, `AutomationRegistry.tsx` under `client/src/pages/dashboard/`.

These are inspection/change candidates, not a requirement to edit every file. Prefer narrow shared repairs; list exact changed paths in preflight. No route registry or 11-entry sidebar cutover, provider pricing changes, workflow activation or blanket staff access changes.

### C. Implementation sequence

1. Record source/build mismatch, local work and supported toolchain. Compare available serving source and current branch; retain new user GHL repair. Inventory all A-owned subclaims before editing.
2. Reproduce stock lockfile installation in a clean disposable checkout on supported Node/npm. Inspect manifest intent, overrides, available versions, integrity and dependency-policy scanners. Regenerate using supported registry resolution without ad hoc tarball substitutions or arbitrary upgrades. If an exact version is unavailable, state it and choose the smallest documented supported change consistent with package intent; validate API impact and vulnerability policy. No blind global URL replacement or skipped dependency checks.
3. Extend CRM object/read authority to cold-lead list/count/pagination/facets/export and every selected-ID mutation. Validate entire selected set and return a consistent unauthorized/not-found policy before writes. Match owner/unassigned/deal authority, class, archived, consent and record existence. Protect shared workflow CRUD/run routes by explicit approved management roles and run entity authorization before any action. Keep manager ownership policy where present.
4. Define shared scoped read contracts for contacts/deals/tasks and reporting. Reuse revenue-read-authority and task-authority; preserve task states open/in_progress/completed/cancelled and legacy open↔pending normalization. Document asOf/timezone/cache keys. Source grouping, object count and event histories are different metrics; label them. Connect minimal metric consumers without a broad layout change.
5. Repair sequence aggregate SQL using independently grouped subqueries/CTEs. Count distinct membership IDs, not joined rows or necessarily distinct contacts; a separate contact metric uses distinct contact IDs. Preserve enrollment state semantics, exclude only what the named metric contract specifies. Provide manager-authorized summaries/per-sequence fetch and error-aware minimal consumer contract. Do not grant global admin access or resume stalled memberships.
6. Repair cold-lead value claims and terminal economics. Separate scenarios from observed money, recommendations from deployment receipts, forecasting from cash receipts. Remove arbitrary list caps from aggregate truth using scoped SQL plus paged details. Preserve audit history and clarify unknown actuals. Native processor/residual ingestion is Stage 6, not a prerequisite to honest unknown labels.
7. Reproduce GHL pagination with the existing actual service and injected fake GET transport. Recover only sanitized metadata from the failed run/log if safely available; do not expose contacts/tokens. Implement supported nextPageUrl/cursor behavior after inspecting documented/observed contract. Validate origin/HTTPS/path/location, page size, monotonic/nonrepeating cursor, bounded total pages, missing/malformed metadata, timeout/rate limit and retry state. No silently dropping pages to finish a run. Preserve preview→execute hash, idempotency key, pause epoch, lease and webhook-enabled checks; test stale/revoked authority and concurrent steps. Do not weaken parser simply to accept arbitrary redirects.
8. Verify local-first manual contact create/replay and orchestration failure behavior for REF-003. Inject GHL/queue/audit failures before and after commit. A durable local creation must not encourage duplicate retry via ambiguous 500; reflect accepted/pending/degraded obligations and stable idempotent identity according to existing request authority. Do not make provider write success a condition of local persistence. Task B owns UI/work queue integration.
9. Map runtime owners for incoming, enrichment, assignment/SLA and communication separately. Report historical vs actionable backlog and last successful processed checkpoint; distinguish enabled, paused, configured, connected and healthy. Change diagnostic truth, not production worker settings. Explicit stage IDs need approved semantic evidence; unmapped is truthful, not permission to guess.
10. Run all A acceptance fixtures and CI. Record actual outcome per claim. Handoff shared symbols/DTOs/permission predicates to B/C1/C2/C3/C4/C5. Update the same specification and ledger; leave genuine native/worker/provenance gaps individually owned.

### D. Required A rg checks — before and after

```bash
rg -n 'package-firewall|replit\.internal|"resolved"' package-lock.json
rg -n 'cold-leads|re-engage|estimatedValue|15000|assignedToMe' server/routes/contacts.ts client/src/pages/dashboard/ColdLeads.tsx
rg -n 'authorizeContact|authorizeDeal|contactScope|recordClass|archived|cache' server/services/crm-object-access.ts server/services/revenue-read-authority.ts
rg -n 'app\.(post|put|delete)|/run|isAuthenticated|requireRole' server/routes/workflows.ts
rg -n 'TASK_AUTHORITY_STATES|legacyTaskStatus|deletedAt|deleted_at|due_date|asOf' server/storage/tasks.ts server/services/task-authority.ts server/routes/analytics.ts server/routes/daily-briefing.ts
rg -n 'LEFT JOIN sequence|COUNT\(|/api/enrollments|enrollment' server/routes/campaigns.ts client/src/pages/dashboard/Sequences.tsx
rg -n 'terminalRecommendation|totalDeployed|paid_off|5000|estimated' server/routes/terminal-economics.ts client/src/pages/dashboard/TerminalROI.tsx
rg -n 'nextPage|startAfter|PAGINATION_INVALID|lease|epoch|previewHash|WebhookEnabled' server/services/ghl-inbound-sync.ts server/routes/ghl-inbound-sync.ts shared/ghl-inbound-sync.ts
rg -n 'Connected|Healthy|health probe|lastSuccess|heartbeat|backlog' client/src/pages/dashboard/GhlSettings.tsx client/src/pages/dashboard/AutomationRegistry.tsx server/routes/admin.ts
git diff --check
git diff --stat
```

Post-build private internal resolved URLs must be absent from the portable lockfile. Remaining 15000/deployed/LEFT JOIN matches require semantic review, not indiscriminate removal. Prove shared predicate use, role enforcement and supported pagination by behavior; code-text scans alone cannot pass them.

### E. Task A gate matrix

| Gate | Meaningful required proof | Failure consequence |
| --- | --- | --- |
| A-G01 source | Current source/build/lockfile receipts or exact source-only limitation; clean/diff provenance | No serving/deployed closure without equivalence; independent source work proceeds |
| A-G02 reproducibility | Supported clean stock install + dependency policy + stock CI build/security suites | Not merge ready if required CI remains failed/unrun |
| A-G03 authorization | Real registered route/session fixtures: owners/nonowners, all roles, mixed IDs, counts/exports/cache, changed owner before execute; no writes on deny | Block affected mutation/read release |
| A-G04 metric parity | Same fixture and asOf/class/owner/status: list vs count/facet/export; task deleted/archived-linked/test/unassigned/completed/overdue/time boundary cases | Block contract handoff until parity or explicitly different labels |
| A-G05 sequence | 2 steps/3 memberships→2/3; zero steps/memberships, historical terminal states, different owners; manager scoped read positive/global restriction negative; API error is not zero | No sequence-count closure without actual DB results |
| A-G06 finance | Recommendation-only/test/archived fixture never counts as actual deployed; unknown actual ledger is unavailable; forecast assumptions labelled; >5,000 aggregate not truncated | No misleading deployment/payback/value metrics |
| A-G07 incoming | Actual existing import with fake GET pages: preserve nonblank, fill missing, add unmatched, dedupe/replay, checkpoint/resume, malformed/host/cursor failures, revoked lease/pause/webhook authority; zero POST/PATCH/send/spend/enrollment effects | Stop affected import if safety fails; incoming control remains independently enabled |
| A-G08 create/replay | Actual contact creation orchestrator: validation, repeat command, timeout after commit, failed GHL/queue stage, stable contact ID and honest response | REF-003 cannot close from modal/code presence |
| A-G09 runtime | Exact owner and actual heartbeat/checkpoint/queue receipts where accessible; unavailable source never labelled Healthy | Component code can pass with external runtime explicitly pending D/Stage 4 |
| A-G10 handoff | Every assigned source/subclaim disposition, DTO/authority symbols, tests, minimal browser scope label checks, report/ledger update | No complete A report with omitted unverified claims |

Extend existing focused tests `scripts/test-ghl-inbound-sync.ts`, `scripts/test-ghl-inbound-sync-integration.ts`, `scripts/test-ghl-inbound-route-guards.ts`, `scripts/test-ghl-inbound-sync-ui.tsx` through the appropriate guarded canonical harness. Add actual registered-route tests for cold-lead/workflow authorization and DB-backed aggregate/metric counterexamples. Do not run direct integration imports before infrastructure guards; inspect existing test classification and add missing coverage to the manifest.

### F. Task A completion contract

Return tested shared authority and truthful outputs, with source fixes reviewable, native historical obligations retained, no communication/spend effects and incoming still independently enabled. Do not claim GHL/native count parity, all worker fleet health, full CRM navigation certification or deployed equivalence from a source-only checkout. B starts from this handoff; later navigation/design tasks remain C1–C5.

## Mode and delivery rules

PREFLIGHT + BUILD in one run. Inspect current reality, correct stale assumptions, implement the owned repairs, test them, and return reviewable code and evidence. Do not return another generic audit or wait for every historical/native claim before doing independent safe work. A prerequisite failure stops only the dependent mutation, test or deployment claim. Report an exact blocker and finish independent work.

This prompt authorizes implementation in a reviewable branch, not production deployment, destructive cleanup, provider spend, enrollment or sending. Follow the repository's current AGENTS.md if present. Use small cohesive commits within this task; do not overwrite unrelated work. Read the consolidated Stage 3 specification, especially Sections 10, 12, 13 and 14, and the current go-live ledger. Attach those documents to Replit if they are not in its workspace. Preserve all original 95 finding IDs and their subclaims. 95 is a source-entry count, not a unique defect count.

Evidence classes: SOURCE CONFIRMED; ACTUAL HANDLER/DB PROVED; BROWSER PROVED; VERIFIED REPAIR; NOT REPRODUCED; EXPECTED CONTROL; DISPROVED CLAIM; UPGRADE; HISTORICAL RECEIPT MISSING; EXTERNAL ACCESS BLOCKED. A composite row stays PARTIAL until each required subclaim has an outcome. An existing button or passing regex is not a durable mutation pass.

## 1. Current baseline and serving-source preflight

Repository: https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM

Authoring audit, 2026-10-02: current GitHub main `74c15805a5cbdb3e0a82183c8c56104999075671`, freshly cloned and source reviewed. Public `https://dev.libertybancard.com/api/health` returned status ok, serving SHA `1fe28bc0d1ff9ad86e777c96b67902701f159fd8`, builtAt `2026-10-02T21:40:33.861Z`, publishBuildId `a17e3a59-81fe-4ad6-80ab-0b2b27b8ec61`, production, ghlTransportFailFast false. Fetching that SHA from origin failed `not our ref`. The earlier accessible serving build `4cd62b589cef10a773909414aebe9e71d164dfd8` and its live observations are dated evidence, not proof of the current serving source.

Re-read HEAD, dirty status, branches, current health/build identity, package manifest/lockfile, schema/migrations and changed files before editing. Obtain the current Replit serving source/commit or source archive with lockfile and build receipt; compare to the audited main. Preserve unrelated local changes. No Stage 9 freeze here. If source provenance is unavailable, build safe source repairs against the accessible checkout and label them source-only; do not certify that they fix the current deployed build.

Record supported toolchain: package.json Node `>=22.22.0 <23`, npm `10.9.4`; CI selects Node `22.22.0`. Check actual versions. Record health separately from database, Redis, worker heartbeat, queue progress and successful sync receipts. Never print secrets, cookies, connection passwords, private payloads or entire environment files.

## 2. Required verified-from-code table

The seeded VFC table below is the authoring audit, not an instruction to blindly trust it. Recheck every row against actual HEAD and serving source when available. Add symbol/current line range, exact original IDs, expected contract, current verdict, counterexample fixture, intended repair, changed files and post-build result. Do not replace evidence with a publish label. Historical live/component test receipts from specification Section 13 are retained but were not rerun during prompt authoring. This turn performed source inspection and public health/source-provenance checks; no new full CI, DB suite, production browser mutation or deployed repair is claimed.

## 3. Safety preflight and non-negotiable kill lines

K01 — Stop any path that sends real email/SMS, enrolls contacts, resumes sequences, enables auto-send, spends on providers, changes budgets/schedules, or triggers native GHL workflows. Outbound stays PAUSED; proposals stay Hold for Review.

K02 — Do not disable incoming GHL contact sync to satisfy the outbound pause. Preserve independent incoming Enabled control and the existing GHL→local no-echo boundary. Incoming enabled is not proof of a successful import/webhook. Do not add GHL contact/tag/stage writes without a separately authorized native-trigger review.

K03 — Stop mutations/tests if database or Redis identity/isolation cannot be proved. Use a dedicated disposable PostgreSQL database, DATABASE_URL=TEST_DATABASE_URL, NODE_ENV=test, isolated Redis namespace, repository certification guards, provider/public transport denied. Assert before importing database-bound code. No production copies containing customer data; no permissive fallback, db:push, selective fake schema certification, shared Redis flush or production pre-deploy gate as a unit-test runner.

K04 — No production purge, mass reclassification by names/emails, identity merge by display string, fake deal restore, consent/audit deletion, FK constraint drop, user hard delete or reconstruction of native deleted opportunities from stale local links. Protected fixture teardown is permitted only on proved disposable infrastructure.

K05 — Authorization is server-side before read, count, cache, write, queue, workflow or external effect. Denied mixed-ID requests must have no partial writes. Retain session/CSRF checks and portal/tenant boundaries. UI hiding is not enforcement.

K06 — No dependency-policy bypass/private URL rewrite workaround masquerading as a reproducible release; no suppressed failing tests, altered suite capability to skip coverage, unsafe migration runner, invented deployment receipts or “0” substituted for an API error.

K07 — Stop the affected operation on stale snapshot, changed owner/state, replay payload mismatch, unknown record class, missing consent/retention authority, or incomplete dependencies. Return an actionable conflict/blocked state. Do not stop unrelated implementation.

K08 — No full sidebar/navigation redesign, route removal, 11-destination cutover, processor onboarding, provider execution, sales certification or final release certification in A/B. C1–C5, Stages 4–9 and D own those lanes. Existing deep links must continue to work.

## 4. Required repository and infrastructure searches

Run from the repository root, using rg first. Commands are discovery checks; inspect every hit and zero-hit result. Record command, SHA, exit code and relevant symbols. rg exit 1 means no match, not automatically failure or pass. Do not print raw secret values.

```bash
git rev-parse HEAD
git status --short
git log -5 --oneline
rg --files -g AGENTS.md
node --version
npm --version
rg -n 'engines|packageManager|db:migrate|test:' package.json
rg -n 'node-version|npm ci|run-ci-suites|run-guarded-canonical-migration' .github/workflows/ci.yml
rg -n 'RUNNABLE_CAPABILITIES|assertDisposableTestInfrastructure|spawnCertificationTsx' scripts/run-ci-suites.ts
rg -n 'DATABASE_URL|TEST_DATABASE_URL|NODE_ENV|TEST_REDIS_PREFIX' scripts/test-infrastructure-guard.ts scripts/certification-child-process.ts
rg -n 'publishBuildId|builtAt|sha' script/build.ts shared/sfp-publish-build-identity.ts
```

## 5. Source-of-truth and overlap contract

| Shared scope | Task A owns | Task B owns | Later owner |
| --- | --- | --- | --- |
| Tasks | One actor/class/delete/status/date predicate and typed metric contract; preserve existing status normalization | Task/list/Home/briefing consumers, durable task actions, assignment/SLA and notifications | C2 presentation |
| Sequences | Independent aggregate SQL; authorized manager summary/per-sequence read; runtime-truth contract | Safe archive/delete/cancel policies and controls using A authority | C3 presentation; Stage 4 outbound lifecycle |
| Contacts/relationships | Collection/per-ID access and metric scopes | Archive/restore, record creation workflow and explicit relational actions | C2/C4 workspace design; Stages 5–6 lifecycle |
| Users | Existing role/session authority verified and reused | Existing provisioning surfaced locally; safe deactivate/reactivate and session invalidation | C5 administration redesign; Stage 9 full security |
| Workflows | Shared mutation/run role guards and run-entity authorization before executor | Governed editor/save/run UI, cancellation, audit and no-send execution fixtures | C5 discovery; Stage 4 native execution |
| Consent/knowledge | Preserve existing authorities and boundaries | Exact consent event labels, request workflow, actual Knowledge query/error repair | C5 layout; Stage 8 certification |

One owner implements each authority. B must consume A's tested contracts, not create competing SQL or authorization. If B exposes a remaining A contract gap, repair it in the A-owned shared module with an explicit follow-up receipt, not a second implementation. Nondependent B work can proceed; coupled integration cannot be declared passed until A prerequisites exist.

For a named metric, document numerator, denominator, source, actor/team/tenant scope, record_class, archive/delete rules, statuses, date/timezone, snapshot/asOf, cache key and missing-data behavior. Different semantics may have different totals only with explicit labels. Never force local and native GHL numbers to match. Preserve intentional unassigned visibility according to current approved authority; do not silently tighten all agent access to assignedTo only.

## 6. Data, schema, authorization and concurrency review

Prefer existing schema and authorities. Search every reader/writer before changing a field, status or DTO. If persistence requires a migration, make it additive and reversible operationally, verify schema-vs-migration consistency, run the canonical migration harness from empty and rerun for idempotency. Do not edit applied migrations or drop history. Specify restore/rollback without data loss.

Enumerate anonymous, admin, manager, agent owner/nonowner, merchant, affiliate and partner cases for each changed route. Use actual valid session fixtures through registered routes; test 401/403/404 policy, list/count leakage, forged path/body IDs, owner changes, CSRF and effect denial. Prior middleware-only proof is not full-session certification.

Use transactions and existing uniqueness/lease/epoch controls for retries, assignment, dedupe, lifecycle transitions and bulk actions. Test double click, concurrent requests, stale version, timeout after commit and retry. Select IDs and dependencies under a stable authority; no unchecked read-then-write race. No queue or provider effect before authorization/commit.

## 7. Preflight verdict and build behavior

Return a short internal preflight verdict: READY TO BUILD; BUILD WITH SPECIFIC EXTERNAL/PROVENANCE LIMIT; or BLOCKED UNSAFE OPERATION. Immediately implement the safe owned scope in the same run. Confirmed source defects get repairs; disputed/partial claims get actual component/handler fixtures and repairs if reproduced. Expected controls, disproved allegations and existing verified repairs get regression checks, not invented features or policy relaxation. Missing native/historical evidence gets exact IDs/receipt requirements and a D/later-lane owner; it must not prevent local repairs.

## 8. Required CI and test gate procedure

Use current `.github/workflows/ci.yml` and `scripts/ci-suite-manifest.ts` as the executable CI authority. Stock installation must use the declared toolchain and the checked-in lockfile:

```bash
npm ci --include=dev --ignore-scripts --no-audit --no-fund
npx tsx scripts/test-dependency-policy-evidence.ts
npx tsx scripts/test-inventory-artifact-dependencies.ts
npx tsx scripts/ci-suite-manifest.ts --check
npx tsx scripts/run-ci-suites.ts --capability deterministic-static
npx tsx scripts/run-ci-suites.ts --capability external-security
npx tsx scripts/run-ci-suites.ts --capability writable-build
```

Run integration in CI's isolated PostgreSQL/Redis setup with the exact certification environment; do not copy production credentials. Generate a unique TEST_REDIS_PREFIX using `scripts/generate-certification-redis-prefix.ts`, retain provider denial settings and the repository guards. Then run:

```bash
npx tsx scripts/test-certification-process-env.ts
npx tsx scripts/test-certification-provider-deny.ts
npx tsx scripts/test-certification-server-readiness.ts
npx tsx scripts/test-certification-redis-reservation.ts
npx tsx scripts/run-guarded-canonical-migration.ts
npx tsx scripts/run-guarded-canonical-migration.ts
npx tsx scripts/run-ci-suites.ts --capability deterministic-integration
```

Start only the owned disposable certification server through `scripts/run-denied-certification-server.ts`, following CI's readiness and seed checks; then run `scripts/run-ci-suites.ts --capability server-required`. Terminate only the process started for this run. Add meaningful new regression suites to the canonical manifest with the right DB/server/provider capabilities and guards. Do not run old DB-mutating scripts directly against the default Replit DB; route through a proven disposable guard/wrapper first. Full stock CI receipts are required for merge readiness. If environment failure prevents execution, distinguish code-complete from untested and report exact command/error; do not call it passed.

## 9. Browser and action gates

Use the signed-in cloud browser when available for read-only current-source reconciliation. Perform mutation checks in the protected disposable preview/fixture environment with outbound/provider transports denied. Enumerate each changed action: route, control label, role, input, expected request, result, persisted readback, refresh, retry/error/empty state, notification/queue/audit effects and unwanted-effect count. Desktop and narrow mobile viewport, keyboard/focus, loading/degraded states and back/reload are required for changed UI. Clicks must hit the intended actual handler. A modal opening is not a Save/Archive/Assign pass; verify database/read API and refreshed UI.

If a role session or browser is unavailable, run actual handler/DB/session tests and mark browser certification pending with exact owner; never fabricate clicks. Unavailable native GHL does not block no-echo local fixtures. No new real invitations, emails, processor calls or production test records are authorized by this prompt.

## 10. Post-build search, diff and completion gates

Repeat the task-specific searches and inspect the diff for unrelated changes, auth weakening, raw secret/PII logs, dropped audit trails, widened provider access, duplicate authority, stale literals/DTO assumptions and hidden error→empty fallbacks. Search remaining metric readers and action writers across server/client, not just changed files. rg matches are leads, not conclusive defects; retain valid uses with documented rationale. Required gates: supported stock install, canonical manifest, appropriate meaningful tests, stock CI/build/security, actual registered-handler/DB fixtures, no-send/no-echo, changed UI browser checks, complete source-row ownership and updated report/ledger. Security failures or unproved side-effect isolation block the affected build operation.

## 11. Final verified-from-code and handoff format

Produce one final table: original ID + subclaim; repair cause ID; preflight verdict; exact symbol/files/lines; implemented behavior; test/DB/browser receipt; post-build verdict; source commit; deployed build if actually authorized/verified; remaining owner. Do not close an entire composite row from one passing subclaim. Keep source fixed, merged, deployed and verified live as separate states.

Report: what changed/why; reviewed baseline and final commit; changed files; gate commands/results; durable fixture receipts; pause/incoming controls and unwanted-effect counts; rollback/restore path; remaining exact external/historical obligations; explicit READY FOR REVIEW / NOT READY verdict. Update the consolidated implementation specification and current go-live ledger after this task. No Stage 3 GO, Stage 9 certification or production deployment claim from an A/B task alone.

## 12. Complete assigned source-entry/subclaim register

This register retains the original allegation and prior qualification; it is not a fresh runtime verdict. The seeded VFC tables and current-source evidence above identify confirmed code defects. In preflight split every composite allegation into individual outcomes and apply the named authority/action/gate. A/B cross-list shared parents intentionally; the ownership table prevents duplicate repair. Full source entries outside these boundaries remain in C1–C5/D and later stages, not silently closed.

| Original ID / claim | Prior evidence state / required next proof | Exact execution boundary |
| --- | --- | --- |
| CRM3-01 — Production cannot be bound to the reviewed source | Recheck exact current-source and dated live/component subclaims in specification Section13. Relevant confirmed causes are separately identified in seeded VFC; remaining subclaims need actual assigned handler/DB/browser or historical receipts. | A: serving-source comparison + supported lockfile/CI receipts. |
| CRM3-02 — Stock CI cannot install its lockfile | Recheck exact current-source and dated live/component subclaims in specification Section13. Relevant confirmed causes are separately identified in seeded VFC; remaining subclaims need actual assigned handler/DB/browser or historical receipts. | A: serving-source comparison + supported lockfile/CI receipts. |
| CRM3-03 — GHL sync is killed and data writes share the send pause | Recheck exact current-source and dated live/component subclaims in specification Section13. Relevant confirmed causes are separately identified in seeded VFC; remaining subclaims need actual assigned handler/DB/browser or historical receipts. | A: incoming pagination/no-echo, manual-create failure/replay boundary and honest runtime DTOs. B: workflow consumer. D native/serving receipts, Stage4 provider fleet. |
| CRM3-04 — Connected/configured badges falsely imply operational health | Recheck exact current-source and dated live/component subclaims in specification Section13. Relevant confirmed causes are separately identified in seeded VFC; remaining subclaims need actual assigned handler/DB/browser or historical receipts. | A: incoming pagination/no-echo, manual-create failure/replay boundary and honest runtime DTOs. B: workflow consumer. D native/serving receipts, Stage4 provider fleet. |
| CRM3-05 — Work counts and AI briefing contradict actionable tasks | Recheck exact current-source and dated live/component subclaims in specification Section13. Relevant confirmed causes are separately identified in seeded VFC; remaining subclaims need actual assigned handler/DB/browser or historical receipts. | A defines shared task predicate; B wires actual list/Home/briefing and assignment/SLA/notification actions. Original ticket correction receipts remain separate. |
| CRM3-11 — Scope mismatches make lists and reports disagree | Recheck exact current-source and dated live/component subclaims in specification Section13. Relevant confirmed causes are separately identified in seeded VFC; remaining subclaims need actual assigned handler/DB/browser or historical receipts. | A: scoped lists/counts/financial truth and labelled assumptions. C2/C4 layout, Stage6 actual financial ingestion; no identity purge. |
| CRM3-12 — Terminal ROI represents test/new-lead equipment as deployed | Recheck exact current-source and dated live/component subclaims in specification Section13. Relevant confirmed causes are separately identified in seeded VFC; remaining subclaims need actual assigned handler/DB/browser or historical receipts. | A: scoped lists/counts/financial truth and labelled assumptions. C2/C4 layout, Stage6 actual financial ingestion; no identity purge. |
| CRM3-14 — Cold-lead collection and bulk re-engagement lack agent scope | Recheck exact current-source and dated live/component subclaims in specification Section13. Relevant confirmed causes are separately identified in seeded VFC; remaining subclaims need actual assigned handler/DB/browser or historical receipts. | A: collection/per-ID/role authority. B: existing provisioning and recoverable user/session lifecycle; C5 layout, Stage9 full security. |
| CRM3-15 — Re-engagement audience label and value math are unsupported | Recheck exact current-source and dated live/component subclaims in specification Section13. Relevant confirmed causes are separately identified in seeded VFC; remaining subclaims need actual assigned handler/DB/browser or historical receipts. | A: scoped lists/counts/financial truth and labelled assumptions. C2/C4 layout, Stage6 actual financial ingestion; no identity purge. |
| CRM3-16 — Sequence report counts are multiplied by a join | Recheck exact current-source and dated live/component subclaims in specification Section13. Relevant confirmed causes are separately identified in seeded VFC; remaining subclaims need actual assigned handler/DB/browser or historical receipts. | A: sequence aggregate + scoped manager read/runtime truth. B: archive/cancel/dependency lifecycle; C3 design and Stage4 native/outbound execution. |
| CRM3-17 — Manager enrollment fetch contract produces misleading empty counts | Recheck exact current-source and dated live/component subclaims in specification Section13. Relevant confirmed causes are separately identified in seeded VFC; remaining subclaims need actual assigned handler/DB/browser or historical receipts. | A: sequence aggregate + scoped manager read/runtime truth. B: archive/cancel/dependency lifecycle; C3 design and Stage4 native/outbound execution. |
| CRM3-20 — Enrichment runtime owner and worker health are not proved | Recheck exact current-source and dated live/component subclaims in specification Section13. Relevant confirmed causes are separately identified in seeded VFC; remaining subclaims need actual assigned handler/DB/browser or historical receipts. | A: incoming pagination/no-echo, manual-create failure/replay boundary and honest runtime DTOs. B: workflow consumer. D native/serving receipts, Stage4 provider fleet. |
| CRM3-23 — Provisioning exists but is hard to discover; deactivation must be proved | Recheck exact current-source and dated live/component subclaims in specification Section13. Relevant confirmed causes are separately identified in seeded VFC; remaining subclaims need actual assigned handler/DB/browser or historical receipts. | A: collection/per-ID/role authority. B: existing provisioning and recoverable user/session lifecycle; C5 layout, Stage9 full security. |
| CRM3-25 — Security and training readiness remain explicit follow-up items | Recheck exact current-source and dated live/component subclaims in specification Section13. Relevant confirmed causes are separately identified in seeded VFC; remaining subclaims need actual assigned handler/DB/browser or historical receipts. | B owns V21 Knowledge SQL/error repair and consumes A V22 guard. C5 diagnostics, D integrated probes, Stages8/9 training/security certification. |
| REF-003 — D3 Create returns 500 after commit | UNVERIFIED. Manual Create opens and validates blank state; no persisted production create. The alleged post-commit 500 requires original request/response/contact IDs and an isolated full orchestration fixture. Current incoming import repair does not prove this separate endpoint. | A: incoming pagination/no-echo, manual-create failure/replay boundary and honest runtime DTOs. B: workflow consumer. D native/serving receipts, Stage4 provider fleet. |
| REF-006 — D6 Empty pipeline/old deal notices | PARTIAL. Pipeline has 2 current deals; callback detail shows 3 related deals. Different archive/class/list predicates are plausible and traced; do not call all 3 duplicate or lost. Reconcile IDs and scopes before closure. | A: scoped lists/counts/financial truth and labelled assumptions. C2/C4 layout, Stage6 actual financial ingestion; no identity purge. |
| REF-008 — D8 Sync killed/backlog/stage mapping | PARTIAL. Old killed-sync conclusion superseded: incoming Enabled, outbound Paused. Current persisted import fails pagination (V16). Actual successful durable import and backlog eligibility remain open. | A: incoming pagination/no-echo, manual-create failure/replay boundary and honest runtime DTOs. B: workflow consumer. D native/serving receipts, Stage4 provider fleet. |
| REF-009 — D9 12/20 automations killed | PARTIAL. Old registry kill counts are historical and not authority for current incoming updates. One-way incoming control verified independently; do not unpause all automations. Every worker profile/kill-switch receipt remains separate. | A: incoming pagination/no-echo, manual-create failure/replay boundary and honest runtime DTOs. B: workflow consumer. D native/serving receipts, Stage4 provider fleet. |
| REF-011 — D11 Sequences/test/GHL/stalled counts | PARTIAL. Sequence count inflation proven with actual SQL fixture (V13). Runtime delivery copy also false under pause (V18). Claimed native missing 39 and true stalled unique-contact count require provider IDs and execution receipts. | A: sequence aggregate + scoped manager read/runtime truth. B: archive/cancel/dependency lifecycle; C3 design and Stage4 native/outbound execution. |
| REF-014 — D14 OpenAI missing/405/no embeddings | SUPERSEDED STATE. Current readiness says configured/connected; Knowledge Admin sources zero. No actual governed model call/indexing pass. CRM3-25, Stage 8. | A: incoming pagination/no-echo, manual-create failure/replay boundary and honest runtime DTOs. B: workflow consumer. D native/serving receipts, Stage4 provider fleet. |
| REF-015 — D15 Redis missing | SUPERSEDED STATE. Current readiness says connected and queues render. DLQ/heartbeat/worker receipts are not established by that badge. CRM3-04/20. | A: incoming pagination/no-echo, manual-create failure/replay boundary and honest runtime DTOs. B: workflow consumer. D native/serving receipts, Stage4 provider fleet. |
| REF-017 — D17 0/39 workflow IDs | CONFIRMED CURRENT. Legacy wizard 0/39; current integration contracts show their own requirements. Map actual inbound versus local-owned cadence dependencies. CRM3-04. | A: sequence aggregate + scoped manager read/runtime truth. B: archive/cancel/dependency lifecycle; C3 design and Stage4 native/outbound execution. |
| REF-018 — D18 Test rows/users/sequences | CONFIRMED CURRENT. 402 Test contacts currently, 28 visible users including fixtures; class leakage/scopes remain CRM3-11/18/23. No cleanup executed. | A: scoped lists/counts/financial truth and labelled assumptions. C2/C4 layout, Stage6 actual financial ingestion; no identity purge. |
| REF-020 — D20 No Invite capability | DISPROVED. Activation Runbook provisioning/resend exists; discoverability and lifecycle proof remain CRM3-23. No invitations sent. | A: collection/per-ID/role authority. B: existing provisioning and recoverable user/session lifecycle; C5 layout, Stage9 full security. |
| REF-029 — DEV-29 Stalled cleanup absent | PROPOSED UPGRADE. Correct CRM3-16 counts first; distinguish paused/retry/terminal memberships and real Referral Flywheel. No blanket clearing/resume. | A: sequence aggregate + scoped manager read/runtime truth. B: archive/cancel/dependency lifecycle; C3 design and Stage4 native/outbound execution. |
| REF-041 — G10 21 external vs 11 local stages | PROPOSED UPGRADE. ID/state/direction/trigger mapping; current CRM's historical mapping claims are insufficient. No forced numerical equality. | A: incoming pagination/no-echo, manual-create failure/replay boundary and honest runtime DTOs. B: workflow consumer. D native/serving receipts, Stage4 provider fleet. |
| REF-046 — Lead Ops empty / old 6,471 business assertion | SUPERSEDED STATE. SUPERSEDED UI STATE: canonical inventory and business detail now render; historical business count is not the current authority denominator. | A: scoped lists/counts/financial truth and labelled assumptions. C2/C4 layout, Stage6 actual financial ingestion; no identity purge. |
| REF-052 — Login/roles/pending/2FA | PARTIAL. Scott admin session works; Pending email and 2FA off/warning visible. No universal account or role-security conclusion. Real manager/agent/merchant/partner sessions, deactivation and recovery remain untested. | A: collection/per-ID/role authority. B: existing provisioning and recoverable user/session lifecycle; C5 layout, Stage9 full security. |
| REF-059 — First 30 rows / 25 plausible / 83% valid | DISPROVED. REJECTED inference: visual plausibility is not validation, target fit, decision-maker evidence or permission. No database-wide quality percentage adopted. | A: scoped lists/counts/financial truth and labelled assumptions. C2/C4 layout, Stage6 actual financial ingestion; no identity purge. |
| REF-060 — QQ/numeric addresses | DISPROVED. REJECTED invalidity inference based only on domain/local-part appearance. | A: scoped lists/counts/financial truth and labelled assumptions. C2/C4 layout, Stage6 actual financial ingestion; no identity purge. |
| REF-061 — Image-file email strings; Null/N/a display prefixes | PARTIAL. Null/N/a display prefixes observed in current People records beside meaningful company names. Image-filename email examples not located by exact authoritative IDs. Preserve raw input/provenance; do not mass-overwrite identities from a cosmetic clue. | A: scoped lists/counts/financial truth and labelled assumptions. C2/C4 layout, Stage6 actual financial ingestion; no identity purge. |
| REF-066 — 2,094 → 2,097 stalled; roughly 2,040 real Referral Flywheel | DISPROVED. COUNT INTERPRETATION DISPROVED by source join amplification. Obtain unique membership/contact aggregates before cleanup decisions. | A: sequence aggregate + scoped manager read/runtime truth. B: archive/cancel/dependency lifecycle; C3 design and Stage4 native/outbound execution. |
| REF-069 — Local/GHL contacts/stages/workflows/users/forms/phones comparison | PARTIAL. Current local population/scope and incoming Enabled observed; import failure V16, explicit-ID stage strategy has all 9 local stages unmapped. Native contacts/workflows/users/forms/phones unavailable. Mapping absence requires approved semantic contracts; numerical parity is not required. | A: incoming pagination/no-echo, manual-create failure/replay boundary and honest runtime DTOs. B: workflow consumer. D native/serving receipts, Stage4 provider fleet. |

For each row, identify a test/receipt and retain expected/disproved/superseded subclaims with rationale. Native receipt gaps (including REF-037/038/065 where applicable) belong to D, not a justification to block safe B lifecycle code. Earlier cleanup/identity claims REF-064/067 need immutable IDs, actor/timestamp, before/after state and command/audit receipts; present population counts are not proof. Do not mark those findings resolved from new fixture tests. Unavailable native history is not a confirmed current defect.

## Final directive

Complete preflight and safe implementation in this run. Return reviewable repairs and exact receipts, not another planning-only response. Keep outbound paused and incoming GHL contact sync independently enabled. Update the existing report and ledger after implementation; do not claim deployment or Stage 3 certification without the corresponding evidence.
