# Phase 8 — Cleanup & Hardening
## Liberty premium preflight + build task

**Status:** Authorized implementation in progress on `codex/phase8-cleanup-hardening`; see `../certification/phase8/README.md` for evidence and independent release gates.
**Roadmap owner:** `docs/LIBERTY_BANCARD_MASTER_AUDIT_ROADMAP.md`, Phase 8, P8-1–P8-4.
**Prepared:** November 18, 2026, America/New_York.
**Planning branch:** `codex/phase8-preflight-plan`. Future implementation belongs on a separate `codex/phase8-cleanup-hardening` branch rebased from the then-current main.
**Execution boundary:** This document proposes the engineering contract. The current request authorizes planning and read-only audit, not implementation, production cleanup, publishing or activation. Once the owner authorizes this build contract, complete its engineering scope locally without inventing additional approval stages for routine reversible work.

## What & Why

Complete the roadmap's four cleanup and hardening tracks through the existing Liberty authorities: (P8-1) repository/artifact hygiene and safe test-data boundaries; (P8-2) one execution owner per scheduled logical job; (P8-3) measured query and index improvements; (P8-4) reliable current documentation and operational labels.

The fresh audit changes the original premises. Legacy GHL sync and re-enrichment starters are already disabled; nightly discovery throws before unreachable legacy code; daily outreach and SDR sweeps already use database leases. Several suggested missing indexes are installed and valid in production, while equivalent duplicate index definitions also exist. Production has no `pg_stat_statements`. Archive candidates still have restoration-tool references. Historic test-like labels and Data Health issue counts do not prove disposable records. Phase 7's retained status document contains old failure/publication claims that no longer describe current source.

The roadmap's **30+ days of production stability prerequisite remains unverified**. Planning and later authorized isolated engineering can proceed. Production scheduler cutover, index removal and data classification changes remain separately gated on evidence and release authorization. A green health response or the age of the domain does not establish 30 days of stability.

Deliver a smaller, safer and easier-to-operate application with reviewable measurements and durable evidence. Do not manufacture cleanup volume, add duplicate indexes, enable senders, or claim that every timer or historical file is a defect.

## Done looks like

1. Every cleanup candidate has an owner, reference search, retention decision, hash and restoration procedure. Required runtime assets and recovery paths survive; historical evidence is retained. Production receives no heuristic deletes or blanket role-based account removal.
2. Every relevant logical schedule has a verified caller/startup/manual/queue map and one durable execution contract. Concurrent processes, retries, Redis outages, partial initialization, restarts and clock boundaries cannot duplicate its externally visible effects or reset daily counters twice. Intentional polling, heartbeats and retry timers remain explicitly classified.
3. Existing indexes and real query contracts are reconciled before changing DDL. Every proposed addition or removal has native dependency/definition proof, representative before/after plans, returned-fact parity, measured workload results, write/storage cost and a tested rollback. A justified zero-new-index outcome is acceptable.
4. The authoritative document index distinguishes current contracts, historical evidence and superseded guidance. All 157 existing Markdown docs receive a disposition; the full 880-path docs inventory is accounted for without deleting retained screenshots/logs. Scope counts are frozen at task start and updated when files change.
5. Affected CRM diagnostics use the same authorities as execution. A saved identity is not labelled active merely because it exists. Configured Redis is not displayed as proof that every queue/worker is active. Import result labels identify the entity and receipt stage they actually count.
6. Cleanup guard, scheduler concurrency/failure, measured database, document-contract and affected browser/role tests are registered in both real manifests. TypeScript, locked build, required checks and the final candidate's full pre-deploy/CI results are reported truthfully. No claimed full pass can be based only on selected suites.
7. One handoff separates engineering complete, required checks, merged, schema applied, published, live readback, stability observation and production activation. Outbound stays paused and the shared Outscraper cap stays $50/month throughout.

## Scope and authority

### In scope

- All four P8 roadmap rows and the directly connected hardening findings below.
- Safe repository archival/reference repair, generated artifact placement, deployment input inventory and reproducible runtime/dependency checks.
- Bounded repairs to existing scheduler ownership, period/idempotency fencing, timer lifecycle and America/New_York clock semantics.
- Query profiling and justified index addition/consolidation through the existing schema delivery owner.
- Current-document reconciliation, a documentation status index, and targeted operational UI label/accessibility repairs within existing screens.
- Baseline comparison and repair of task-owned stale fixtures/assertions when actual contracts prove the correction.

### Preserved boundaries

- Production is read-only during engineering. No cleanup script, backfill, replay, provider probe, manual job trigger, email test, enrollment, import, paid search, identity activation or control mutation is authorized by this contract.
- Outbound pause, consent, suppression, commercial classification, runtime ownership, provider budgets, immutable evidence and object access remain authoritative. Existing approved Scott-only staff-intake alerts retain their exact fixed-recipient purpose; do not broaden or disable them.
- Existing authorized production discovery/enrichment continues under its current settings and $50 cap. The audit does not turn it off or start extra work. Isolated tests deny provider I/O and use private PostgreSQL/Redis resources.
- Do not message the Replit Agent. Use SSH for authorized workspace reads and later authorized sync/restart. Publishing and production schema delivery remain separate owner actions.
- Preserve other worktrees, running previews, platform-owned `.local/state`, credentials and unsaved work. Do not delete Git history, customer records, billing/provider history, retained imports, consent/audit receipts or migration history.
- No broad redesign, replacement scheduler platform, new outbound campaign, new acquisition feature or unrelated dependency-major upgrade.

## Part I — Fresh preflight

### 1. Source, runtime and deployment identity

Fresh planning baseline:

| Surface | Observed result | Meaning |
|---|---|---|
| GitHub main / local audited code | `d67d24c61acc462931c418e8068624c86144c7ae`, clean | Staff-alert commit and earlier fixes are in main |
| Tracked tree | `34ccfc6eed7181cd645c78d05dad38f780265a5c` | Comparison identity independent of commit metadata |
| Replit workspace | `53b7de8eeb1ab09aacb79e4b3c45e4a80dc402eb`, clean; parent d67d24c6 | `Published your App` metadata commit; same tracked tree, empty diff from main; preserve it |
| Production `/api/health` | d67d24c6, production, status ok; build `7f573214-cd61-416a-8dcf-e5d6639a58b9` | Current serving identity was read; it supersedes earlier unpublished-state notes |
| Production database | `neondb`, SELECT-only console, editing off | Catalog/controls read independently of development |
| Production controls | paused, epoch 4; Outscraper limit 50,000,000 micros | Do not change these during this task |
| Runtime contract | Node `>=22.22.0 <23`, npm `10.9.4`, packageManager npm@10.9.4 | Keep current declared contract; do not silently loosen it |
| Local checks | Node 22.22.0 / npm 10.9.4 | Existing locked dependencies reused; no install/fix |
| Replit shell / dev process | shell Node 22.23.5/npm 10.9.9; dev process uses pinned Node 22.22.0 | Shell and running process differ. Actual production build toolchain must be recaptured before release |
| Migration head | 397 entries; idx 396, `0393_team_intake_email_alerts`, max when 1800400330007 | These are observations, not reservation of 0394 |

Before implementation, recheck branch, SHA/tree, remote freshness, dirty/untracked work, active tasks/PR collisions, runtime, lock digest, serving identity and schema owner. Fetching does not authorize resetting or overwriting work. Pin base/candidate and compare equivalent environments when attributing failures. Reserve migration numbers and strictly increasing `when` only after current-head reconciliation. Never rewrite old journal entries to remove historical warnings.

### 2. Verified-fact and correction register

Use the IDs below throughout the build, tests and final effectiveness matrix. Confidence/status is deliberately specific; an inventory candidate is not an established runtime failure.

| ID | Verified fact / limitation | Required disposition |
|---|---|---|
| P8-V01 | Correct roadmap is Cleanup & Hardening, four P8 rows; 30-day stability is unverified | Keep engineering/release/stability acceptance separate |
| P8-V02 | Six tracked file candidates total 1,252,096 bytes: two repair Python files, three July backup JSONs, one archived CTA script | Review and archive/remove with references and restoration proof; this is not a multi-gigabyte size fix |
| P8-V03 | `backfill-templates-apply.ts` and `backfill-sdr-campaigns.ts` still scan scripts/ for backup files; dry-run writes there | Repair recovery contracts before relocating backups; an unrelated ancient backup must not authorize a new apply |
| P8-V04 | `cleanup-test-data.ts` has a pre-import disposable guard; internals include heuristic contact matching and merchant-role removal | Preserve/refine disposable-only restrictions. Never run it on production or use its predicates to identify live deletion candidates |
| P8-V05 | Live staging lists include Demo/Test-labelled items; provenance unverified. Data Health's 720 is no-email/active, not a synthetic-record count | Review classification evidence and counts by population. No name-based deletion, hiding or automatic reclassification |
| P8-V06 | `ghl-sync.startAutoSyncLoop` and re-enrichment starter are disabled; nightly discovery throws before old interval code | Retire unreachable bodies/compatibility only after caller and contract tests. Do not revive fallbacks |
| P8-V07 | Daily outreach and SDR sweep already acquire heartbeat-backed DB leases | Test/extend current authority; do not claim that regex matches prove duplicate execution |
| P8-V08 | Inbox scheduler tests `dailyMaintenanceInterval` but recursively schedules timeout handles without assigning it; fixed UTC-5 midnight arithmetic ignores DST | Reproduce double-start/stop/DST defects without live effects; repair ownership, handle lifecycle and period semantics |
| P8-V09 | Funnel aggregation has a local hourly timer; execution ownership and all callers require completion of the census | Prove whether concurrent or repeated period writes are possible, then fence/retire only demonstrated gaps |
| P8-V10 | Assigned-contact, enrollment contact/status and deal pipeline/stage indexes exist and are valid in production | Close obsolete missing-index claims; inspect real predicates/plans before any new index |
| P8-V11 | Four pairs have equivalent production index definitions: GHL contact ID; deal contact ID, pipeline, pipeline/stage | Candidates for consolidation only; dependencies, uniqueness, predicates, operator classes, usage and rollback are still unverified |
| P8-V12 | Production lacks pg_stat_statements; cumulative table counters and row/dead-row estimates were read | Use approved alternative measurements. Do not install/reset production instrumentation or call estimates exact counts |
| P8-V13 | Audit-log schema/installed indexes use entity_type/entity_id/entity_key | Trace actual contact-history query; do not invent a contactId index from the old roadmap example |
| P8-V14 | 880 tracked docs paths / 157 Markdown docs; Phase 7 owner-status text still reports 41 TypeScript diagnostics and unpublished state | Preserve dated historical evidence; add current/superseded status and reconcile living summaries against fresh results |
| P8-V15 | Fresh npm lock-only audit: 0 high, 0 critical, 16 moderate, 1 low | Do not reintroduce old nine-high claims. Classify current paths/impact and fix relevant reachable issues; report unresolved findings without blanket forced upgrades |
| P8-V16 | Fresh TypeScript, cleanup guard, migration integrity, queue compliance and CI manifest checks pass; manifest has 306 suites | These are bounded planning checks, not a fresh full-roster result or proof old failures all disappeared |
| P8-V17 | Live identity wizard says Identity active for a saved identity with blank status; source uses identities.length > 0; System Readiness reports 0 active | Use shared identity eligibility/presentation semantics and distinguish saved, usable, warmup and remaining capacity |
| P8-V18 | System Readiness's Redis copy claims durable queues active; live discovery correctly exposes selective profile and heartbeat | Reflect selected group, control state and freshness per logical job. Configured Redis alone is not execution proof |
| P8-V19 | Live discovery import history labels 27 new as contacts; `LeadImports.tsx` unconditionally labels generic newRecords as contacts | Trace retained import facts and entity semantics; fix labels/DTO only after proof, preserving original accounting |
| P8-V20 | Replit .local 5.3G, .cache 1.2G, node_modules 914M, dist 42M; .local/worktrees 3.4G; .replitignore currently excludes generated-artifacts | Inventory actual publish inputs and broken symlinks. Do not infer layer size from du or delete active/platform state |

Evidence: `phase8-evidence/source-audit.json`, `phase8-evidence/live-audit.json`, the catalog query and bounded check logs next to this document. Catalog was read at 2026-11-18 22:23:31 EST. Raw record details, tokens, private backup contents and customer query parameters are excluded.

### 3. Preflight investigations and verdict

Complete the call/authority maps before touching runtime code:

- Cleanup: every candidate's Git history, imports, documentation references, repair/backfill consumers, runtime asset dependency, owner and retention purpose. Produce one of retain/current, archive/restore, safely remove, or investigate; no unexplained matches.
- Schedules: exported starter, direct runner, startup profile/group, route/manual caller, queue processor/repeat schedule, shared lease key, period identity, in-flight fence, effect owner, pause behavior, provider budget, heartbeat, cancellation and crash recovery. Include SLA and new staff-intake recovery as adjacent owners so migration cannot accidentally duplicate or disable them. CRO-08A continuous-factory code is an existing subsystem name, not proof that roadmap Phase 8 is complete.
- Database: actual route/storage query and actor scope, WHERE/JOIN/ORDER/LIMIT contract, population and skew, native column/index definitions, duplicate/dependency/constraint inventory, EXPLAIN estimates and trustworthy duration samples. Exclude PII literals from evidence.
- Documents: classify all text contracts and retained artifacts; establish current source-of-truth precedence among roadmap, Knowledge Brief, replit.md, task contracts, certification records and memory. Dated evidence stays dated.
- UI: trace System Readiness, Activation identity wizard, job/queue status and import labels to their current server owners. Record the observed mismatch and actual DTO before proposing UI copy.

**Planning verdict:** READY FOR ENGINEERING PREFLIGHT once the owner authorizes implementation of this contract. No production action is approved. Initial high-value engineering targets are archive/recovery contract integrity, inbox scheduler lifecycle/DST, measured duplicate-index investigation, living-document reconciliation and the observed operational-label defects. Query-specific index choices and production stability acceptance remain evidence-gated, rather than guessed in this draft.

## Part II — Build contract

### 4. Architecture and implementation choice

Use one integrated Phase 8 task with four workstreams and a shared verification ledger. Extend existing job registry, logical-job manifest, background profiles, queue owner, schema delivery, classification and CRM components. Preserve their interfaces and historical evidence.

| Approach | Tradeoff | Decision |
|---|---|---|
| Targeted repairs under existing authorities, measured DDL, one consolidated acceptance ledger | Requires completing caller/definition maps; minimizes compatibility changes | Recommended |
| Replace every timer with a new scheduler abstraction | Large data/ownership migration, including timers that are already safe or intentionally local | Outside this task unless a bounded gap cannot be solved by current owners |
| Inventory/docs-only cleanup | Useful first checkpoint; leaves demonstrated timer/UI defects unresolved | Preflight milestone, not final build completion |

Use a task-owned checkout and disposable resources. Prefer the trusted mini for heavy build/browser-test workloads only after verifying the exact Liberty source, runtime and assets there; preserve existing Air work and other owners' jobs. Ordinary signed-in browser audit stays in Chrome on the Air. Never copy browser/authentication caches or reuse another task's database, ports, worktree or output directory.

New durable occurrence state is allowed only if existing ownership/receipt contracts cannot express period identity safely. Justify its minimal fields, uniqueness, ownership, retry/crash semantics, retention, migration and rollback before implementation. Do not add a second control plane or a new paid provider lane.

### 5. P8-1 — Repository, artifact and data hygiene

1. Record path/hash/size/owner/reference results for all six current candidates. Archive repair scripts with invocation history and a dated historical-only header; update explicit references. Remove the completed CTA artifact only when no supported recovery/test/runtime contract requires it and Git restoration is documented.
2. Review backup JSON classification without copying its content into public docs. Preserve required recovery copies in a supported private archive or existing retained artifact location, with hashes and a restore test. If an external archive is needed and unavailable, retain the files and disclose that disposition; do not destroy the only recovery copy.
3. Repair backup producer/consumer coupling. Supported dry-run/apply must bind the exact backup to the target, source revision, intended entities and content digest, and reject stale, unrelated, missing, malformed or wrong-environment backups. Do not run those historical apply commands against shared development or production while testing this change.
4. Inventory task-created caches, disposable DB artifacts, retained test outputs, platform state, active worktrees and runtime-needed files separately. Put future task-generated artifacts under a verified excluded location and clean up only owned disposable resources after completion. No broad `rm -rf .local`, `.cache`, worktrees or attached assets.
5. Verify actual deployment include/exclude behavior and effective layer size against the platform's then-current limit. The prior 8-GiB failure is historical evidence, not a fresh size measurement. Check symlink targets and all server/client/runtime assets after exclusions. Set a documented measured size/headroom budget and fail regressions without deleting another task's resources.
6. Reconcile Node/npm at the actual build/install boundary. Preserve the declared Node range and exact npm 10.9.4 contract, locked installation and lock digest. Confirm whether the platform's preliminary npm install changes resolution; fix supported build/bootstrap configuration if needed, without changing engines simply to silence warnings.
7. Extend disposable cleanup refusal tests to wrong environment, production-like target, missing isolation reservation, mismatched database URLs and Redis prefixes. If cleanup internals are retained, prove protected audit/consent/provider evidence and unrelated identities cannot be selected outside a verified disposable fixture.
8. For live Test/Demo-labelled lists, deliver a read-only provenance/classification review with exact IDs and owner disposition, not deletion SQL. Any later live archive/reclassification needs its supported reversible product path and separate authorization. Production evidence records remain intact.

### 6. P8-2 — Schedule ownership and hardening

1. Produce a disposition for each named roadmap scheduler plus all affected starters/callers. Distinguish executable work scheduling from heartbeat, debounce, retry sleep, polling and unreachable code.
2. Keep disabled GHL/re-enrichment/discovery entry points disabled. Remove dead bodies only after references and existing tests are reconciled. Preserve supported compatibility exports with explicit refusal where callers still depend on them.
3. Retire a legacy schedule when one canonical queue owner already implements the identical work. Otherwise retain a narrow intentional scheduler with shared database authority; record why it remains and test it. Never start a fallback automatically on Redis/queue partial failure. Fail closed with an honest unavailable/held state.
4. Fix inbox maintenance's start/stop handle tracking and cancellation, including its already-scheduled callbacks. Derive periods in America/New_York using supported timezone-aware logic, including March/November DST boundaries. Define missed periods, restart catch-up and midnight behavior explicitly. A counter reset is applied at most once for a period and never reduces consumed allowance within that period.
5. Verify daily outreach, SDR sweep and funnel aggregation under concurrent queue/manual/legacy triggers. A lease proves concurrent ownership, not durable exactly-once completion. Use stable logical occurrence/effect identities and existing receipts/checkpoints to prevent sequential replay of irreversible effects after restart or lease expiry. Unknown provider dispatch must not be automatically repeated.
6. Check token/epoch ownership immediately before effectful writes/I/O; stale owners cannot commit after another owner acquires work. Heartbeat loss, unavailable registry and partial initialization must return an honest blocked/unavailable outcome. Preserve pause and provider accounting at their canonical transport boundaries.
7. Reconcile manifest entries, physical queue census, background profiles and operational read contracts. Add no unclassified queue. Preserve intentional staff-alert recovery and current scheduled-discovery/provider controls. A task can certify held behavior while outbound remains paused.
8. Define rollback so old and new scheduler versions cannot both own the same period during rolling deployment. Rehearse disabling the new dispatcher, draining or retaining in-flight work and resuming existing checkpoints. Do not delete queued evidence or reset spend/send counters.

### 7. P8-3 — Profile first; change indexes with evidence

1. Confirm the three named existing indexes in development and production catalogs. Close those original roadmap hypotheses as already satisfied unless the actual hot-query predicate/order needs a different measured index.
2. Complete the four equivalent-definition candidate investigations. Inspect pg_index, pg_constraint, pg_depend, predicate/expression/column order, collation/opclass, included columns, validity, sizes and usage observation interval. Prefix coverage alone is not sufficient proof of redundancy; preserve uniqueness, FK/ON CONFLICT and exclusion semantics.
3. Since production has no pg_stat_statements, use existing authorized request telemetry, query fingerprints and bounded representative reads/plans. Do not install an extension, reset shared counters, enable global SQL logging or run production EXPLAIN ANALYZE/load tests by assumption. If provider-approved instrumentation needs configuration, provide its exact narrow request and continue independent local profiling.
4. Capture representative query distributions in an isolated database with synthetic production-shaped volume/skew, current actor scoping and non-production classes. Use EXPLAIN (ANALYZE, BUFFERS) there and sanitized production EXPLAIN without ANALYZE only when safely supported. Include cold/warm, common/rare and empty-result cases; time parameters are measured consistently.
5. For each candidate, freeze the workload and metric before changing DDL. Report p50/p95/sample count, buffers, rows examined/returned, plan/index path, DB size and write overhead. A justified improvement needs repeatable evidence and equal returned IDs/counts/order. It must introduce no unexplained regression beyond 10% in any agreed representative workload; choose a stronger improvement target from the measured bottleneck before implementation, not after seeing results. Do not promise a universal latency target without baseline data.
6. Audit audit-log contact history through actual entity-key storage and filtering. Never add an index to an invented contact_id column. Native lineage/permissions and historical records must remain identical.
7. Propose only justified DDL, including an explicit no-change decision when current indexes are adequate. New migrations are additive for state/columns; reviewed redundant-index drops require exact dependency proof and a tested recreation rollback. Never rewrite historical migrations or mass-drop low-usage indexes.
8. Test actual migration-owner compatibility: fresh apply, upgrade from audited head with populated data, interruption/recovery and older-reader compatibility. Reconcile Drizzle declarations, installed native definitions and the managed Publish diff. Concurrent index operations need an explicit supported non-transactional owner; do not place them blindly inside the transactional journal or run an alternate production migration script.

### 8. P8-4 — Current documentation and operational UI truth

1. Generate a docs inventory with path, class, owner, status, controlling reference and last verified source. Treat the 157 existing Markdown docs as the initial textual review set; account for all other tracked docs artifacts separately. Review operationally relevant guidance outside docs/ and memory where it affects these contracts.
2. Keep historical task contracts, logs and screenshots immutable. Mark stale living guidance with a concise superseded/as-of header and a current replacement link, retaining its historical context. Update current roadmap, Knowledge Brief and replit.md only where the build changes their actual contracts.
3. Correct Phase 7 living-status drift using current evidence. Do not copy forward 41 TypeScript diagnostics, nine high dependencies, 57 failing suites, unpublished status or zero-discovery definitions as current facts. Conversely, do not erase a documented historical failure or mark an unexecuted suite passing. Keep each bounded result's SHA/date/scope.
4. Repair the identity wizard's existence-based active badge and readiness-reader divergence through the existing sender identity authority. Display saved/configured, usable status, warmup, capacity and pause as distinct facts. Never activate or change an identity just to make the label green.
5. Replace generic Redis-active assertions with actual selected profile/group, current owner/heartbeat, held/paused/disabled/unavailable states and observation timestamps. Do not run jobs to refresh a health card. Missing optional sender/workflow configuration must not be presented as a Phase 8 code failure.
6. Trace newRecords in scheduled/canonical imports versus actual contact materialization. If it counts businesses or generic intake rows, display that entity/stage and retained receipt evidence. Preserve historical row accounting and distinguish new/matched/duplicate/review/excluded from contacts created, qualified recipients, enrollments, deals and deliveries. Do not relabel counts without tracing the writer.
7. Existing workspace components and CRM tokens govern presentation. Use compact, readable health summaries with progressive details, clear timestamps and actionable ownership. Preserve the eleven-entry navigation, namespaced URL state, Back/reload selections, data-table scrolling and mobile assistant separation. No cosmetic reskin or new top-level cleanup dashboard.
8. Read-only diagnostics remain admin/manager-scoped as currently contracted. Destructive/reclassification actions are not added by this task. All touched screens must cover loading, empty, populated, stale, unavailable, permission-denied, partial results and retryable error states without invented success.

## Part III — Verification, gates and acceptance

### 9. Requirement-to-proof and fix-effectiveness ledger

For every P8-V01–P8-V20 row, record: original claim; confirmed current fact; route/caller/storage owner; exact root cause or evidence limitation; change or justified retain/no-change disposition; failing-before control; passing-after proof; negative control; migration/permission impact; and remaining live evidence. A source-text match or passing mock alone is insufficient connected-behavior proof.

Create focused suites in `scripts/certification/` and register them in both `scripts/pre-deploy.ts` and `scripts/ci-suite-manifest.ts` with real infrastructure/network/completion contracts. Final names may follow repo conventions, but the coverage below is mandatory:

| Gate | Executed behavior required | Failure condition |
|---|---|---|
| G0 Source/authority | Fresh main/candidate/tree, collisions, runtime/lock identity, real DB/provider boundaries | Unreviewed drift, wrong database or provider-capable fixture |
| G1 Archive/recovery | Exact backup binding; supported archive restore; runtime import/asset smoke | Orphaned references, stale backup accepted, missing required asset or lost only recovery copy |
| G2 Cleanup safety | Guard refusal before DB import; approved private fixture scope | Shared/prod-like cleanup accepted, heuristic production cleanup or evidence deletion |
| G3 Scheduler | Two processes, manual+queue, double start/stop, sequential replay, lease takeover, crash/restart and Redis failure | Duplicate effect, orphan timer, stale-owner commit or automatic unsafe fallback |
| G4 Time/counter | DST start/end, month/day boundaries, restart across midnight, repeated callbacks | Duplicate period/reset, lost period without declared policy, allowance inflated or counters reset twice |
| G5 Database | Native definition/dependency parity; populated migration; returned-fact parity; measured workload and rollback | Duplicate new index, altered integrity/access, unsafe DDL owner or unsupported performance claim |
| G6 Docs/UI | All inventory dispositions; checked links/contracts; actual mounted states and server authority agreement | Historical proof rewritten, active claims from existence/config only, wrong entity label or broken URL/permission state |
| G7 Regression/security | TypeScript; locked build; npm audit reachability; relevant existing suites; manifest/migration/queue gates | Task-owned regression, new unresolved reachable high/critical, omitted required suite or silent skip |
| G8 Release/live | Authorized source merge/schema/publish; native readback, live UI/worker observation and unchanged controls | Wrong serving candidate, unverified schema, unauthorized activation or live claim based only on local results |
| G9 Stability | Explicit 30-day observation evidence, incident/SLO/change-window review | Stability acceptance claimed from uptime badge/domain age or elapsed time without records |

Use actual DB/queue/HTTP contracts in disposable tests. Provider transports are fake and denied at the network boundary. Test through the real scheduler/transport entry points, not a parallel implementation of the expected logic. Include concurrent process ownership and native persisted postconditions where those are the guarantees being claimed.

### 10. UI, role and device acceptance matrix

- Admin and manager reads; agent/merchant/partner/anonymous denial; no new role grants. Existing mutation paths retain auth/CSRF/object fencing and stale-session behavior.
- Existing diagnostic, activation and import screens at 1280, 768 and 390 CSS pixels; light/dark, keyboard-only and 200% zoom. Check table overflow stays local, controls have accessible names and focus, and tabs/assistant do not obscure content.
- Assert DOM and stored/returned facts for labels; screenshots supplement assertions. Freeze/reload URL selections and test Back. Cover selected/disabled/held/unavailable/error states and delayed responses.
- Production read-only desktop acceptance is separate from isolated mounted browser results. Real-phone/WebKit verification is executed if available or precisely NOT EXERCISED; desktop Chromium is not relabelled as device coverage.

### 11. Baselines, full checks and failure handling

Fresh planning checks actually run: TypeScript pass; cleanup guard pass; migration integrity 1045 checks with two historical duplicate-when warnings; queue compliance pass; CI manifest pass with 306 mandatory suites; npm lock-only audit 0 high/critical, 16 moderate, 1 low. Logs are retained beside this task. No full roster, application build or mobile suite was run for this planning document.

The preceding staff-alert validation separately recorded 84 passes/3 failures in the older pause suite on both candidate and clean baseline. Treat that as prior recorded evidence. Reproduce relevant current failures at build time and trace the actual production owners before classifying them. Do not globally waive failures as old, delete assertions to turn a gate green, or claim all historic failures are still present.

Run focused failing-before/passing-after cases first, then affected regression suites, current typecheck/build and the canonical required full gate/CI on the final implementation candidate. Keep each required suite's exit, execution receipt, setup/teardown and pause result. Repair task-owned failures in this task; for an unrelated required failure, give exact candidate/baseline replay, owner and release impact. An incomplete required full gate remains incomplete release evidence. No production or shared dev DB may be substituted to make tests run.

### 12. Migration, release and rollback ownership

No migration is created merely because Phase 8 has a schema track. If durable state or justified indexes need DDL, reserve current journal idx/tag/when after collision checks, document affected data volume/locks, and keep declarations/native objects/managed diff consistent. Production remains Publish-owned; no db:push, manual ledger stamping or dev-journal replay in production.

A pre-release handoff includes exact source/tree and artifact identity, lock/runtime digest, tests and full-roster status, migration/diff/lock plan, measured image size/headroom, data retention/archive restoration proof, counter/receipt continuity, UI matrix and rollback sequence. Publishing, enabling a new dispatcher or touching production records requires the owner's separate authorization. Do not send the task to the Replit Agent.

Rollback retains all additive evidence and preserves pause/budget/profile controls. Revert the exact code/artifact through the existing deployment owner, restore a reviewed removed index only if justified and compatible, and resume from durable checkpoints. Old/new schedule coexistence must not double-run. Do not roll back by deleting receipts, resetting counters, replaying provider purchases, globally clearing Redis or restoring a database over live writes.

### 13. Required deliverables and final report

- Updated task-owned requirement/fact ledger and Fix Effectiveness Matrix covering all twenty IDs and the four roadmap tracks.
- Repository archive/reference/retention manifest with hashes and restore proof; safe generated-artifact/deployment input report.
- Scheduler owner/caller/profile/period/effect map and concurrency, DST, cancellation, crash and stale-owner proof.
- Query inventory, production native catalog evidence, profiling limitations, before/after representative plans/timings, every index decision and migration/rollback evidence.
- Documentation status index, precise living-doc changes and preserved historical evidence links.
- Actual API/UI/role/responsive tests, screenshots of affected states, truthful unavailable/config states and import entity semantics.
- Final source/tree/artifact, installed source/toolchain identity, required-check receipts, dependency dispositions, full CI/gate outcomes and any exact unresolved owner inputs.
- One concise owner handoff with independent states: **planned; engineering complete; focused checks passed; full required gates passed; merged; schema verified; published; production readback verified; stability observation met; scheduler cutover authorized/performed; outbound paused**. Do not collapse them into “Phase 8 complete.”

## Relevant files and existing owners

- Roadmap/knowledge: `docs/LIBERTY_BANCARD_MASTER_AUDIT_ROADMAP.md`, `docs/LIBERTY_BANCARD_KNOWLEDGE_BRIEF.md`, `docs/certification/phase7/roadmap-status.md`, `replit.md`, task and certification records.
- Hygiene: `scripts/cleanup-test-data.ts`, `scripts/cleanup-demo-data.ts`, `scripts/purge-test-contacts.ts`, `scripts/cleanup-smoke-contacts.ts`, `scripts/test-cleanup-guard.ts`, `scripts/test-infrastructure-guard.ts`; the six archived-file candidates in source-audit.json; `scripts/backfill-templates-dryrun.ts`, `scripts/backfill-templates-apply.ts`, `scripts/backfill-sdr-campaigns.ts`; `.replit`, `.replitignore`, `script/build.ts`.
- Ownership: `server/index.ts`, `server/services/background-profile.ts`, `server/services/queue-manager.ts`, `server/services/queue-connection.ts`, `server/services/job-registry.ts`, `server/services/logical-job-manifest.ts`, `server/services/outbound-queue-coordinator.ts`, `server/services/outbound-pause-authority.ts`, existing CRO-03 runtime and CRO-08A occurrence owners.
- Schedule callers: `server/services/ghl-sync.ts`, `server/services/daily-outreach.ts`, `server/services/sla-worker.ts`, `server/services/sdr/orchestrator.ts`, `server/services/sdr/re-enrichment.ts`, `server/services/sdr/funnel-metrics.ts`, `server/services/sdr/inbox-rotation.ts`, `server/services/sdr/lead-finder.ts`, `server/services/partner-application-intake.ts`, `server/services/team-intake-alerts.ts`, routes in `server/routes/sdr.ts` and `server/routes/activation.ts`.
- Database/query: `shared/schema.ts`, `server/storage/contacts.ts`, `server/storage/deals.ts`, actual audit/history readers, `server/db-migrate.ts`, `server/startup-migration-policy.ts`, `server/native-objects/`, `migrations/`, `migrations/meta/_journal.json` and the managed schema preview.
- UI: `client/src/pages/dashboard/ActivationPanel.tsx`, `SystemReadiness.tsx`, `DataHealth.tsx`, `LeadImports.tsx`, actual administration/job-health containers, `server/routes/admin.ts`, `server/routes/activation.ts`, canonical provider/import and identity owners, existing CRM tokens/destination-state helpers.
- Verification: both suite manifests, cleanup/migration/queue guard suites, existing job-registry/profile/lease/Redis-topology tests, affected scheduler and identity/import/browser tests. Discover exact current suite paths before selecting them.

**Build directive, effective only after owner authorization:** Execute the complete bounded contract through existing Liberty authorities on a separate local branch. Resolve task-owned defects and foreseeable dependent work end to end. Keep production read-only, outbound paused, existing paid-search settings/cap intact, and publishing/activation separate. Return the consolidated evidence and reviewable release candidate; do not create extra tasks for work already included here.
