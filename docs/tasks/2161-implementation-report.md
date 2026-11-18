# Task 2161 — implementation and acceptance report

Date: 2026-11-18. Scope: the complete supplied task, Steps 0–13, audit sections 1–27, V01–V16, F01–F14 and T01–T15. The complete original text is retained in `2161-scheduled-outscraper-discovery.md`, with explicit current corrections above it. Historical statements are evidence to verify, not additional authority to change production.

## Source, environment and authority

- Authoritative implementation: `/Users/matt/Developer/liberty-2161-clean`, local branch `codex/task-2161-scheduled-discovery`. Base `21b0db4873414e3c57665fc376ff86cab5e044aa`. The commit containing this report identifies the candidate; no push, merge or publication was performed.
- Remote independently checked and fetched: `https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM.git`; origin/main remained exactly the base during delivery. Fresh clone object verification passed.
- Original checkout `/Users/matt/Documents/GitHub/Liberty-Bancard-Website-and-CRM` remains on `codex/local-development-setup` at `361886eb`, with its untracked setup documentation preserved. Its app on 5187, Postgres on 55437 and Redis on 56387 were not stopped or retargeted.
- The first task worktree, now `/Users/matt/Developer/liberty-2161-scheduled-discovery`, was preserved after the original shared Git store failed an untouched-base tree read with a short-pack error. No destructive repair was attempted. The independent clean clone removes that store from the task's verification dependency. Its node_modules links to the preserved locked installation in that task directory; do not delete that directory while using this preview.
- Runtime: Node 22.22.0, npm 10.9.4. Locked `npm ci` installed 761 packages without changing package.json or package-lock.json. Toolchain: `/Users/matt/.local/share/liberty-dev/toolchains/node-v22.22.0-darwin-arm64/bin`.
- Tests use separately migrated, socket-only PostgreSQL 16 databases, private Redis processes/prefixes and owned loopback HTTP ports. Provider credentials are scrubbed; fatal network denial is installed before application imports. Fake provider responses are captured at the real adapter/socket seams, not delivered to vendors.
- Mini resource routing was attempted; trusted alias did not resolve. Contained Air execution preserved existing services. No browser/auth caches were copied.

## Live baseline, independently verified

Read-only Replit **Production Database** inspection, database `neondb`, at 04:09 UTC and aggregate refresh at 05:30 UTC. Editing remained disabled. The signed-in Replit account was checked; this is production database evidence, not a new-production-CRM UI acceptance claim.

| Item | Observed |
|---|---|
| Serving/runtime SHA | `d34f09fca7fa9d044d362521f051a1a0ae96af5f` |
| Unique active v2 program | `f19cd9e4-9978-46f1-9973-df8df22df10a`, south-florida-v1 |
| Scope | FIPS 12011/12086/12099; Automotive, Healthcare, Beauty/Spa, Construction/Trades/Home Services, Fitness/Recreation; policy/taxonomy 2 |
| Canonical inventory | 99,984; latest creation 2026-11-07 20:30:39 UTC |
| Weekly creation, Monday New York | Sep 14: 6,008; Sep 21: 27,299; Sep 28: 52,501; Oct 5: 1,082; Oct 12: 6,566; Oct 19: 6,514; Oct 26: 11; Nov 2: 3; no creations in Nov 9/16 weeks as of observation |
| Outscraper place links | 2,220; latest first-seen 2026-10-15 13:51:08 UTC |
| Sunbiz links | 161,807; latest created 2026-10-24 07:05:44 UTC |
| Outscraper operation creation | 2026-09-29 19:33:07 through 2026-10-13 07:52:21 UTC |
| Outscraper control | Enabled, closed; consumed 8,268, reserved 96 |
| Historical outstanding holds | 44 failed/ambiguous discovery operations = 82 units; 2 running discovery = 4; 10 running poll = 10; total 96 |
| ZeroBounce | Enabled, closed; consumed 3,867, reserved 126 |
| Serper | Disabled, closed; consumed 48,342, reserved 3,492 |
| Outbound/GHL | Paused epoch 4 / disabled epoch 16, rechecked |
| Migration distinction | Production journal 318 entries; source before task 391 entries. Production has no new discovery tables. Publish reconciliation is not proof every journal entry ran. |

The source history/table data supports the dated slowdown. It does not prove only manual imports worked, or that every source row is a new business. The task's six-upload/4,386-row history and 2,468-contact intake figures remain separately labelled historical planning evidence; the final aggregate refresh did not independently recalculate those upload totals. Actual production invoices, effective promotion secret, deployed background profile and uncommitted Replit workspace state remain unverified. No secret was retrieved to resolve those questions.

## Delivered requirements and canonical owners

| Done ID | Delivered behavior | Evidence |
|---|---|---|
| 1 | Active-program useful definitions, exact area/revision coverage, due/paused states, saturation, honest readiness/count/cost details | T05/T08/T09/T11/T13; 63 definitions for full synthetic program; real DB parity and UI |
| 2 | Explicit admin paid preview records provider/accounting/artifact evidence while making zero business/contact/source/crawl/preparation/validation changes | T01/T04; before/after actual table counts |
| 3 | Retained preview import reuses original artifact/task with no second search; scheduled mode imports automatically through canonical processing | T02/T04/T08; durable execution/history receipts |
| 4 | Schedule defaults off; bounded daily count, repeat window and IANA timezone; daily count includes pilot dispatches but limits automatic work | T09/T15; pre-I/O transaction and displayed count policy |
| 5 | PostgreSQL session advisory lock plus durable lane serialize replicas/pilots; known IDs resume, uncertainty holds without repurchase | T01/T02/T03; actual independent child process deaths/restarts |
| 6 | Versioned practical matching, exact owned identities, compatible unique domain/phone/name+address; conflicts/branches held or separated | T05/T11; canonical writer locks and bounded indexed lookup |
| 7 | Existing manual default preserved; portable real CSV/XLSX/Apollo/custom imports retain original evidence, restrictions and multiple emails | T10; existing 82-check canonical suite and retained recovery phases; historical private fixture limitation below |
| 8 | Actual free crawl → staged email → contact → recipient preparation → validation intent/recovery → BullMQ worker/default adapter → receipt/ready-held | T12; captured fake HTTPS/DNS/ZeroBounce at real seams; zero outbound |
| 9 | Existing workspace UI, admin/manager roles, CSRF/object guards, schema/journal, manifests/scanners, rollback and release dispositions | T13/T14/T15; registered runner, catalog parity and browser checks |

The independent subrequirements remain traceable to Steps 1–11: useful term mapping and unique v2 selection (1); typed pre-business operation ownership and immutable occurrence identity (2); malformed/empty/204/5xx classification, retention and reconciliation (3); same preview/write/recovery matching version and indexed retrieval (4); preserved native API evidence and multi-email/business-only mapping (5); deterministic execution/history/partial-commit recovery and count receipts (6); database lane, frequent polling, daily/repeat/failure scheduling and worker selection (7); exact crawler/current validation owners with containment (8); units/estimates/legacy holds (9); accessible existing-workspace operator controls (10); actual registered gates and negative mutations (11). Steps 0, 12 and 13 are covered by the source baseline, preserved scope boundaries and this report.

Changed canonical owners:

- `server/services/sdr/outscraper.ts`: explicit versioned modern Maps endpoint for the new lane; legacy default retained. Bounded JSON decoding, true place-ID namespace, explicit supported empty result, missing-ID/non-JSON uncertainty, 204 failure.
- `server/services/cro03/sfp-provider-operations.ts`: genuine pre-business search-run reservation/attempt/lease/dispatch/settlement under current provider/runtime authority. Existing spend ledger remains authoritative; no fake business or new spend ceiling.
- `server/services/scheduled-discovery/{service,policy}.ts`: definitions, scope pins, idempotent runs, advisory/durable lane, recovery, immutable artifact hashes, preview overlay, retained canonical import, coverage, workload and evidence.
- `organization-resolution-policy.ts` and `organization-resolver.ts`: `scheduled-discovery-v1` inside the existing resolver. Existing generated domain/phone keys and normalized-name index bound candidates; exact owned IDs are resolved before broad weak brand evidence. Default manual policy unchanged.
- `canonical-provider-import.ts`, `csv-import-processor.ts`, `csv-import-recovery.ts`: trusted version metadata, native cold-start provider processor, atomic durable business outcome facts and unchanged original/default paths.
- `queue-names.ts`, `background-profile.ts`, `queue-manager.ts`: narrow `scheduled-discovery` capability, concurrency 1, attempts 1, a single owned 30-second recovery repeat and current runtime heartbeat/wakeup ownership. No legacy queue revival or blanket schedule removal.
- `server/routes/scheduled-discovery.ts`/`routes.ts`: normal full registry, admin mutations, admin/manager reads, strict bounded schemas, server actor/program, CSRF, no unauthenticated worker route.
- `ScheduledDiscoveryPanel.tsx`, `LeadOpsCenter.tsx`, `LeadImports.tsx`: existing Imports workspace and history deep link. `CrmPresentation.tsx` adds a default-off full-phone-width drawer option used only here.

## Verification claims and fix-effectiveness matrix

These dispositions reassess the V claims against the actual implementation. The complete original claim/verdict wording remains in the task document.

| Claim | Current disposition and detecting evidence |
|---|---|
| V01 | Confirmed transport reuse; T07/T15 test both endpoint contracts |
| V02 | Original business-pinned worker is unsuitable; real search-run subject added; T01/T04 starts with no businesses |
| V03 | ID alone insufficient; pre-I/O marker + unknown + retained lane; T02/T03 actual process death |
| V04 | Separate occurrence, task, artifact, execution and business identities; T04/T08 lineage and replay |
| V05 | Existing processor reused and made provider-stable before upload registration; T02/T10 |
| V06 | Discovery-only relaxed policy implemented; T05/T11; default fixture behavior retained |
| V07 | Row dispositions differ from distinct businesses/contacts; durable atomic facts; T08 |
| V08 | Preview is read-only, not import-and-rollback; T04 all relevant tables unchanged |
| V09 | Results are time-limited; conservative shared four-hour bound/24-hour deadline; T03 |
| V10 | Limit explicit, saturated means incomplete; narrower validated slice/exact coverage; T09 |
| V11 | Downstream needs actual owners and eligibility; T12 proves selected receipt with fake transport; production not inferred |
| V12 | Broad legacy lane is contained; current intent queue proved separately; T12 |
| V13 | Manifest alone insufficient; actual reserve/attempt/marker/accounting plus negative scanner mutations; T01/T14 |
| V14 | Manual compatibility requires execution; portable formats/default policy and retained restart pass; missing historical workbook gate remains blocked |
| V15 | Legacy endpoint retained; new lane explicitly opts into modern endpoint; T07/T15; no real paid compatibility call |
| V16 | Pure mocks insufficient; real private DB/Redis/full HTTP/auth, independent processes and browser evidence supplied |

| Finding | Effective change | Detection |
|---|---|---|
| F01 | Search-run target and canonical operation/attempt authority | Empty-business pilot persists genuine operation; no fake business |
| F02 | Pre-I/O marker/session lock; post-marker uncertainty holds | Exits before dispatch, after acceptance before ID and after ID; 5xx submission never repeats |
| F03 | Context-free transport/retention reused; no whole business-pinned/add-on flow | Endpoint/purpose/call counts and no paid contact enrichment |
| F04 | One persisted discovery policy in preview, writer and recovery | Same place/name change, exact source/domain/phone/name-address, conflict/branch/large-brand cases |
| F05 | Stable cold-start canonical provider processing | Import before first upload and actual mid-contact-commit exit/restart |
| F06 | Retained artifact → readonly preview → explicit local import | Zero preview changes, one original submission, one deterministic execution |
| F07 | Explicit limit, real geography/taxonomy, saturation and exact coverage | Wrong county/category/unresolved rows excluded; scope drift blocks import; pause drains accepted task |
| F08 | Distinct business facts/contact IDs and unit-aware cost certainty | New/matched business plus new emails, replay, zero result, unknown prices |
| F09 | Native API field mapping/contacts and true ID namespaces | Website/street survive; multiple mailboxes; Google-only business creates no fictitious place ID/mailbox |
| F10 | Existing staged crawler/recipient/current intent queue | Actual BullMQ/default adapter/canonical validation receipt, ready-held, no old-lane/outbound effects |
| F11 | Durable lane + session advisory lock + narrow frequent worker | Concurrent independent workers exactly one submit; one repeat installed; actual heartbeat |
| F12 | Separate schedule/provider/pause/scope/expiry/retry semantics | Same-ID drain with schedule/definition off or active-program missing, provider-disabled no I/O, 503 poll retry |
| F13 | Existing workspace/table/cards/detail and independent readiness | Browser admin/manager, unknown/expired/preview/evidence/loading/empty/error/retry, phone sizing |
| F14 | Exact manifest/mandatory/fixture registration and negative mutation tests | Real selected pre-deploy runner; unmanaged URL/wrapper/unclassified-suite mutations fail and restored copy passes |

## Schema, lineage, population and cost contracts

Migration `0388_scheduled_outscraper_discovery.sql`, journal idx 391, timestamp 1800400330002. Source journal now 392 entries. It adds six tables: discovery_schedules, discovery_definitions, discovery_runs, discovery_artifacts, discovery_lane and discovery_coverage; plus the search subject provider-operation index. No migration activates a schedule, seeds production program data, rewrites history or installs a native trigger/function.

Executed real catalog parity: **6 tables, 73 columns, 7 task indexes, 19 checks, 7 foreign keys**, including unique occurrence/task/operation/execution identities, active-definition partial uniqueness, valid opaque task IDs and endpoint version. Source migration integrity passed 1,030 checks with two unchanged historical timestamp warnings.

Lineage is `program ID+pin → definition ID+revision → occurrence UUID → provider operation+attempt+dispatch marker → opaque task ID → immutable canonical-JSON SHA256 artifact+mapper version → deterministic import execution envelope → existing csv_imports history+source rows → canonical business outcomes/contact source evidence`. Artifact JSONB key order cannot change its content hash. Import rechecks current program/revision and shared writer locks. Existing history is not rehashed. Concrete synthetic acceptance IDs are emitted as `TASK2161_ACCEPTANCE_LINEAGE` in the final selected-gate log.

The main six-row acceptance artifact has two would-create businesses, one intra-result duplicate, one outside-program row, one malformed row and one unresolved row. Preview changes zero materialization/downstream records. Retained import creates two distinct businesses and two contacts (both emails belong to one business; the other is business-only with a Google source ID and no fabricated mailbox/place ID). Replays retain the same execution/totals and create no second provider search. Separate fixtures prove an existing matched business can gain a new contact and that a partial contact commit recovers without changing execution.

Population definitions:

- Raw/returned rows: bounded original provider records, including excluded ones. Not businesses or contacts.
- Preview would-create/would-match/duplicate/held/invalid/out-of-scope/unresolved: current read-only observations under the pinned policy, not reservations or committed output.
- New/matched businesses: distinct business IDs in atomic first-outcome execution metadata at the actual resolver commit boundary. Never inferred from an import row's “created” disposition.
- Contacts: distinct actual materialized contact IDs from durable source evidence, independently of business count. No-email rows remain businesses only.
- Downstream panels show current state of businesses touched by the import, including existing contacts/later work. They are explicitly not exclusive causal counts of newly created discovery contacts. Crawled, staged, materialized, prepared, queued, blocked and validation-completed are distinct.
- Dispatch count: actual marked submissions today in the configured timezone, including pilots and conservatively unknown marked outcomes. Polls and retained retries do not consume new-search slots; the daily automatic workload limit is not a price approval or spend cap.
- Accounting: original search operation uses result units; polls use request units. Price estimates only exist when the catalog unit matches the observed quantity. Unknown usage/price remains unknown. Actual invoice charge is always unknown absent separate reconciliation. No fake $0 manual coverage. Historical reserved/ambiguous holds remain separate and untouched; completed/released rows' old reserved_units are not outstanding holds.

## Test receipts and gate disposition

Private logs: `/Users/matt/.local/share/liberty-dev/logs/2161-*.log`. These are local evidence, not production credentials. All selected provider responses used synthetic data; no vendor invoice or paid pilot was generated.

| Test | Executed result |
|---|---|
| T01 | Same-definition admin/scheduled race, parallel ticks and independent worker processes: exactly one actual captured submission |
| T02 | Real child exits before dispatch, after acceptance before ID, after ID and after first contact commit; same execution/artifact recovered; artifact-retained and pending phases resume |
| T03 | Known-ID retry/drain, unknown holds, transient 503 polling, ambiguous 503 submission and explicit expiry; no automatic repurchase |
| T04 | Zero preview writes across businesses/contacts/sources/crawl/preparation/validation; retained import buys nothing again |
| T05 | Practical policy, namespace/conflict/branch cases, bounded shared-brand overflow and exact uniquely owned place |
| T06 | Native website/address, nested/all email identities, business-only Google-ID case, retained restrictions |
| T07 | Supported empty payload/zero-row history vs malformed/non-JSON/202-no-ID/204 failure fixtures |
| T08 | Distinct new/matched businesses, contacts, stable replay and preview duplicate overlay |
| T09 | Active unique v2 scope, useful queries, wrong county/category/unresolved, changed program, pause drain, limit/saturation and exact coverage |
| T10 | Cold worker before upload, real CSV and OOXML XLSX, Apollo/custom, default policy, retained originals and contact restrictions |
| T11 | 100,002 synthetic businesses; actual indexed plan, bounded lookup/memory; weak overflow held; exact place remains automatic |
| T12 | Actual crawler parser over captured HTTPS/DNS → staged encrypted candidate → contact materialization → recipient preparation → validation intent recovery → real zerobounce-batch-validate BullMQ worker → default adapter/physical address claim → captured fake receipt → ready-held; no outbound/legacy activation |
| T13 | Full route registry, real login/CSRF, admin+manager reads, agent/anonymous denial, admin missing/wrong CSRF, actor/program spoof, unknown/invalid object, inactive foreign-program mutation/coverage/pilot denial: 35 checks. Browser evidence below. |
| T14 | Real scanners plus unmanaged transport/wrapper and unclassified suite mutations in private copy; restore goes green. Current waterfall regression passes 10 assertions. |
| T15 | Legacy/modern endpoint fixtures and actual narrow worker/profile/one repeat/heartbeat; unrelated queues absent |

The actual repository `run-sfp2060-predeploy-disposable.ts --only …` selected and ran four registered suites on independently migrated databases, Redis and ports: new contracts (**38**), discovery persistence (**66**, plus HTTP/manual/schema/downstream subchecks), updated paid waterfall, updated current validation handoff. **4/4 passed; no child, setup, teardown or launcher failures**. This is deliberately not a claim that the full mandatory release roster ran.

Other executed existing checks: canonical provider import **82 checks / 1,472 rows / 15 serial batches**; retained canonical recovery **faults, restart, legacy, budget** phases; upload handoff 6 checks; upload heartbeat 3; provider contracts; manifest coverage; paid controls convergence; background profile; paid-adapter scan and CI manifest validation. Older logs contain initial failures as well as later passes; use the final result markers, not an arbitrary early line.

Two gate upgrades were evidence-driven. Both failures reproduced on untouched base at 21b0db4: the paid-waterfall mock lacked current location/employer evidence and bulk email response; it now exercises those contracts while preserving ownership/known-domain-stop assertions. The former 1,262-line validation certification depended on retired routine fleet-certificate/frozen-cohort behavior. It was replaced by the current selected-recipient path above, with explicit retired-refresh/broad-auto-run no-purchase assertions. This changes its historical assertion scope; it does not assert the retired lane works. The base version remains in Git history.

**Global typecheck is still red:** untouched base and candidate both report the same 41 diagnostic lines, with zero added diagnostics. A default-heap attempt also exhausted Node memory; the bounded 6GiB compiler run completed and established the comparison. These failures are not relabelled passing. Final build and integrity receipts are recorded in the delivery addendum below.

**Historical private recovery fixture remains blocked:** `scripts/certification/test-provider-import-recovery.ts` exits ENOENT for `/tmp/canonical-enrichment-workbooks/manifest.json`; its five hardcoded source XLSX assets are absent in both base and candidate. Portable CSV/XLSX compatibility passes, but does not stand in for those 2,914 historical rows. Do not fabricate the manifest or claim this required fixture passed. Full release-roster execution was not performed.

## Browser, operator and security evidence

Normal local password authentication reaches the signed-in Today CRM and current Prospecting → Sources & Imports → Imports workspace. Preview uses synthetic admin/manager users, no production credentials or copied customer database. Nine UI-state fixtures are explicitly labelled **“UI STATE FIXTURE — no provider request or materialization”**; they are display tests, not purchase/import/receipt evidence. Real runtime proof comes from the separate disposable tests.

Desktop checks cover independent off/provider/worker/runtime/promotion readiness, ten-row server pagination and filtering, unknown reconciliation choices, expired/preview/importing/completed/failed/queued states, exact versions, retained evidence, history links and zero-cost uncertainty. Paid/import/enable actions were not clicked during browser testing.

At actual Chrome responsive **390×844**, the existing mobile app initially offers its desktop-layout handoff; taking that handoff preserves the route. The discovery view uses labelled cards and wraps without document overflow (390px viewport and document); primary visible controls are at least 44px high. The full-width details opt-in resolves the shared 288px constraint; final drawer is 390px wide with 389px internal scroll width. Browser viewport/device tools are restored afterward.

Loading is observed against a temporary exclusive lock on the private preview schedules table. Error/retry is observed against a timed private-table rename, with restoration; an explicit Retry discovery then recovers the normal 63-definition view. Production is never involved. Empty filter, unknown reconciliation and expired states are checked in the real browser. Normal browser manager login independently confirms disabled schedule inputs, the read-only explanation and absence of pilot/import/reconcile controls. The manager's paid/schedule mutations are denied in the real authenticated HTTP matrix, independently of hidden UI controls.

Evidence images are in `2161-evidence/`. UI fixtures and error injection are not asserted as completed live discovery. No release/approval or sending authority follows from local acceptance.


## Full source census

Executed from the complete clean checkout, across the specified source roots (not a claim of whole-repository line review). Each matching source line was read; the broad retention family includes many unrelated privacy/marketing/storage references, explicitly excluded from changes. Full exact commands and matching paths/lines are retained in `2161-census/*.txt` and summary.json. Source scans establish ownership/call sites; runtime claims rely on the executed tests above.

| Family | Matches / reviewed | Files | Disposition |
|---|---:|---:|---|
| transport | 24 / 24 | 9 | Transport/wrapper reuse, both endpoint contracts, governed submission and polling. |
| async | 292 / 292 | 118 | Task-ID/retention owners classified; unrelated privacy, marketing and storage retention left unchanged. |
| processor | 27 / 27 | 13 | Stable provider cold-start path and existing manual registration/recovery preserved. |
| materializer | 108 / 108 | 32 | Shared resolver/materializer reused; durable business outcome facts added at commit. |
| validation | 89 / 89 | 24 | Current intent recovery and worker only; actual queue/receipt proved. |
| legacy-broad | 10 / 10 | 4 | Broad unattended auto-run remains contained; no activation. |
| legacy-cohort | 1 / 1 | 1 | Historical cohort implementation remains unscheduled. |
| workspace | 16 / 16 | 10 | Current Imports workspace/history extended; compatibility redirects unchanged. |
| paid-approval | 28 / 28 | 13 | Existing approved adapter compatibility only; no new explicitPaidApproval assignment in discovery. |
| unknown | 18 / 18 | 6 | Unknown holds, reconciliation and UI guard; no automatic repurchase. |
| name-key | 61 / 61 | 11 | Existing indexed normalized-name owner reused; bounded candidate plan executed. |
| promotion | 18 / 18 | 7 | Existing selected-promotion owner/readiness; production environment value unverified. |

## Release, rollback and remaining gates

| Disposition | Actual status |
|---|---|
| Code and task rewrite | Implemented on separate local branch; original complete task retained |
| Engineering feature acceptance | Task-owned parser/persistence/restart/queue/HTTP/scanner tests pass with fake transport and real private infrastructure |
| Global release gates | Not all green: 41 unchanged type diagnostics; historical private recovery assets missing; full roster not run |
| Production schema/profile | Not deployed; applied discovery schema and selected queue unverified in production because no release happened |
| Local preview | 127.0.0.1:5188; private database/Redis, background off, provider transport denied, schedule off, outbound paused |
| Real paid pilot | Not performed |
| Production retained import/scheduler activation | Not performed; no admin approval recorded |
| Production crawl/current-recipient validation for a new run | Not performed; only disposable captured-provider acceptance |
| Outbound/Serper/GHL | Preserved paused/disabled/owner-controlled; no changes |

Future release owner must resolve/accept the actual repository gate policy and missing private fixture, review source drift, run the full required release checks, publish the reviewed commit through the normal platform path, and verify six-table/index/check parity against the actual published schema (do not blindly replay the development journal against production). Keep the schedule off. Configure the existing Redis/runtime selector/owner using the reviewed published artifact, preserve the existing capability groups, and add **only** `scheduled-discovery` to the selective profile as separately authorized. Verify one owned 30-second repeat, current heartbeat, provider/runtime authority and program pin before an explicitly authorized pilot. Do not select “full” or replace another worker's groups. Outscraper credential and transport activation must use normal provider controls; a key alone grants no authority.

A real paid preview, retained production import, schedule enable, and effective selected-recipient promotion each require their normal explicit admin/release decisions. The production promotion override setting was absent; its environment fallback and actual deployed profile were not inspected, so production selected validation readiness cannot be claimed. No legacy broad auto-run or outbound unpause is a dependency.

Rollback order: disable new schedules first; drain known accepted task IDs and retain artifacts under current controls; unknown submissions stay held for evidence-based admin reconciliation. Do not erase their lane/attempt/ledger or automatically release historical holds. Stop/remove only the task-owned worker/repeat after accepted work is safely accounted for. Retain the additive tables and audit/source receipts; reverting application code must not drop them or alter existing business/consent history. Local preview stops by signalling its own runner only; leave original 5187/55437/56387 services alone.

Reproduce locally: prepend the declared toolchain directory to PATH, run `node node_modules/tsx/dist/cli.mjs scripts/run-task2161-preview.ts` for the private preview, or the actual disposable pre-deploy runner with the four exact `--only` suite paths above. The preview writes a mode-0600 private environment file at `/Users/matt/.local/share/liberty-dev/task2161/preview-environment.json`, including generated local-only login credentials. Do not copy it into Git or reuse those values in production. No paid-provider credential is required for contained acceptance.
