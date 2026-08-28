# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## TASK

**CRO-02 — Classification, Provenance, Identity & Quarantine**

**Primary findings:** `CAR-010`, `CAR-011`, `CAR-012`, `CAR-013`

## MODE

PREFLIGHT + BUILD

First verify this task against the current codebase and repository state. Task 1699/CRO-01 is now merged on the verified live-main baseline below. If that prerequisite remains present and this task remains materially valid and safe after corrections, continue directly into implementation in the same run. Do not stop after another plan unless a genuine blocker exists.

Do not blindly trust historical row counts, production observations, paths, line numbers, or the assumption that older BT-06/BT-07/BT-08 work is absent. Extend the current authorities. Do not create a second classifier, provenance writer, organization writer, contact writer, or merge engine. Do not classify records from names, email domains, filenames, prefixes, or provider labels alone.

Complete the audit end to end even when a P0 is found. Finish every independent safe portion and return the total P0/P1/P2 correction set. Stop before only the blocked destructive, production, external, or owner-authorized portion.

Required sequence:

Repository baseline → prerequisite VFC → targeted searches → verified root cause → source-of-truth check → blast radius → data/auth/concurrency/external-side-effect checks → P0/P1/P2 correction register → preflight verdict → corrected build plan → kill lines → implementation → isolated tests/gates → post-build searches → diff review → final VFC → merge verdict.

## 1. REPOSITORY BASELINE

Recapture before making claims:

- current branch and HEAD SHA;
- exact `origin/main` SHA and whether HEAD is its tree/descendant;
- `git status --short`, staged and unstaged diff, and pre-existing unrelated changes;
- origin URL and available repository visibility/protection evidence;
- migration SQL head and Drizzle journal head;
- current CI workflow and suite-manifest capabilities.

Verified planning baseline on 2026-08-27:

- remote: `https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM.git`;
- live `origin/main`: `2f463398029fdc5adcd992ac4f068f81a2dfe640`;
- commit time/subject: `2026-08-27T20:27:28Z — Establish canonical revenue read and conversion contracts`;
- parent: `2cf2ba72895cf58489177c022abe9794c1515a25`;
- Task 1698/CRO-00 commit `658fabb95c79c9dc9fd577edc2cf887f67e7deb6` is an ancestor;
- Task 1699/CRO-01 is represented by live-main commit `2f463398029fdc5adcd992ac4f068f81a2dfe640`;
- migration head: `0165_outbound_send_claim_lease.sql` / journal index `169`, tag `0165_outbound_send_claim_lease`, `when=1794900000000`;
- the clean inspection worktree had no diff or `git diff --check` output.

Independently recapture this baseline at execution time. Preserve unrelated work. Never reset, rebase, clean, or overwrite a dirty checkout to make the task appear clean.

## 2. PREREQUISITE CHECK

**Current finding: SATISFIED.** CRO-01 is merged on live `main` and now owns canonical People/Prospect Staging/Lead/Deal/Merchant read definitions and privacy-safe reconciliation.

CRO-02 must consume that read contract and make its production/non-production decisions traceable. It must not redefine Lead or Merchant. If CRO-01 is missing or the live tree has drifted materially, use `NOT BUILD-READY`, finish the full audit, and identify the exact prerequisite delta.

## 3. VERIFIED FROM CODE — PREFLIGHT

Produce an updated table before implementation. The current live-main findings to recapture are:

| ID | Task Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | No commercial-classification authority exists | OUTDATED | BT-06 already provides the sole purpose-aware classification gate, immutable transition events, preview/approve/execute commands, evidence allowlisting, distinct production approval, and fail-closed non-production rules. | `server/services/commercial-classification-authority.ts:1-21,40-123,182-287,292-384` |
| VFC-02 | Classification covers the full commercial graph | FALSE | The executable subject union and lookup cover only `contact`, `deal`, `prospect`, and legacy `company`. | `server/services/commercial-classification-authority.ts:47-51,140-176` |
| VFC-03 | Canonical businesses are a classified root | FALSE | `businesses`, aliases, and locations are the canonical discovery organization model, but BT-06 imports and classifies legacy `companies`, not `businesses`. | `shared/schema.ts:3365-3450`; `server/services/commercial-classification-authority.ts:26-36,47-51` |
| VFC-04 | Existing rows were safely inferred as production | FALSE | Migration 0150 deliberately defaulted existing contacts, deals, prospects, and companies to `unknown`; it forbids silent historical promotion. | `migrations/0150_commercial_classification.sql:7-23` |
| VFC-05 | Production projections currently fail closed | CONFIRMED | CRO-01’s Lead and Deal authorities require production contact/deal roots, and its reconciliation reports aggregate non-production buckets. | `server/services/revenue-read-authority.ts:117-157,160-198,201-230`; `docs/canonical-revenue-contract.md:18-28` |
| VFC-06 | Record-class event coverage extends to all named operational objects | FALSE | Event snapshots are explicit only on `outbound_send_log` and `statement_upload_commands`; statements, applications, MIDs/merchant projections, tasks, campaigns, sequences, imports, and canonical businesses do not all have a resolved inherited/snapshot contract. | `migrations/0150_commercial_classification.sql:25-56`; `shared/schema.ts:239,516,637,1301,5128` |
| VFC-07 | Contact identity and reviewed merge controls are missing | OUTDATED | BT-07 provides versioned observations, reviewed merge operations, redirects, relationship actions, undo, and reconciliation; unsafe legacy merge endpoints are disabled. | `migrations/0151_canonical_identity_merge.sql:1-81`; `shared/schema.ts:6425-6533`; `server/routes/crm-operations.ts:348-370` |
| VFC-08 | Imports still bypass canonical intake | PARTIAL / OUTDATED | Current CSV intake claims a durable execution, sends each accepted row through `writeContact`, records row dispositions, and requires terminal ledger reconciliation. Historical or non-CSV sources still require coverage reconciliation. | `server/routes/imports.ts:1529-1561,1985-2015,2091-2098`; `migrations/0155_canonical_intake_authority.sql:4-54` |
| VFC-09 | Import totals have one exact durable equation | PARTIAL | The durable row ledger has terminal dispositions, while the UI/import summary also tracks created, updated, duplicate, invalid, skipped, and errors. CRO-02 must prove one mapping rather than invent new counts. | `shared/schema.ts:316-331`; `server/routes/imports.ts:2136-2157` |
| VFC-10 | Missing provenance can be reconstructed automatically | FALSE | Current source events and intake evidence can support proven links; absence of immutable evidence must remain `untraceable`/`legacy_unknown`. No code or production query proves a safe universal reconstruction. | `shared/schema.ts:260-310,316-331`; `server/routes/imports.ts:1991-2004` |
| VFC-11 | All contacts require a prospect row | FALSE | CRO-01 explicitly preserves contacts from many intake paths and optional one-way prospect linkage. CRO-02 must not fabricate prospect history. | `docs/canonical-revenue-contract.md:20-28`; `shared/schema.ts:1283-1357` |
| VFC-12 | Historical production counts remain current proof | OUTDATED / UNVERIFIED | The old counts are audit observations, not constants. This task may expose aggregate-only coverage queries but must not claim current production truth without authorized runtime evidence. | repository evidence plus runtime boundary |

Inspect surrounding implementations; grep hits alone are not proof.

## 4. REQUIRED SEARCH / GREP CHECKS

Use `rg`, Git inventory, schema inventory, and route/worker tracing to inspect at minimum:

- every `record_class`, `recordClass`, `record_class_at_event`, classification command/event, and purpose gate;
- direct writes to classification fields outside the current authority;
- `contacts`, `prospects`, `deals`, legacy `companies`, canonical `businesses`, aliases/locations, statements, applications, merchant MIDs/profiles, tasks, campaigns, previews/members, sequences/enrollments, import executions/rows, and source events;
- production KPI, revenue, Portfolio, Reporting, payout, campaign, sequence, export, Ready, GHL, and provider-spend predicates;
- import writers and every `writeContact` caller, row-disposition creator, source-event creator, and business-ingest path;
- identity normalization, collision detection, reviewed merge candidates/operations, redirects, undo, and legacy merge endpoints;
- decision-maker fields and business/contact relationship evidence;
- existing aggregate lineage and coverage/reconciliation endpoints;
- migrations `0150`, `0151`, `0155`–`0157`, `0162`–`0165`, and the next legal journal entry;
- tests, CI manifest ownership, route guards, and deployment/runtime documentation.

Post the exact commands and summarize matches by owner. Never print raw rows, identities, payloads, document bodies, or secrets.

## 5. VERIFIED ROOT CAUSE

State the original assumption and corrected reality:

| Original Assumption | Verified Reality | Required Correction |
|---|---|---|
| Classification must be built from scratch | BT-06 is already the only commercial-class authority | Extend it; never create a second classifier |
| Identity/merge safety is missing | BT-07 already owns normalized observations and reviewed/reversible merges | Consume its resolution state and add coverage evidence only |
| Intake provenance is uniformly absent | Current CSV intake has durable execution and row ledgers, but historical and non-CSV coverage remains unproven | Reconcile sources; preserve unknown/untraceable without fabricated history |
| `companies` is the canonical organization | `businesses` plus aliases/locations is the current discovery identity; `companies` remains compatibility data | Define inheritance/linkage without a competing organization writer |
| Every table needs an independent mutable `record_class` column | Derived objects can inherit or snapshot a root decision | Select the smallest explicit root/inheritance/event-snapshot model |
| Old production counts prove the current state | They are stale audit observations | Use aggregate-only recapture under separately authorized runtime access |

Root cause: BT-06, BT-07, and BT-08 established strong local authorities but cover different slices. The commercial graph still lacks a complete, explicit inheritance and coverage contract connecting canonical businesses, people, revenue objects, operational events, imports, and outreach projections. This makes fail-closed exclusion safe but leaves many real records unclassified and many derived surfaces unable to prove why they were included or excluded.

## 6. SOURCE-OF-TRUTH CHECK

Preserve these owners:

- **Commercial class vocabulary and transitions:** `CommercialClassificationAuthority` only.
- **Canonical contact writes and provenance events:** `writeContact` only.
- **Canonical organization identity:** `businesses` plus aliases/locations and the existing business-ingest owner.
- **Prospect staging:** `prospects`; linkage to contacts is optional and one-way.
- **Revenue objects/counts:** CRO-01 `revenue-read-authority.ts` and its shared deal/MID predicates.
- **Identity evidence and merge:** BT-07 identity observations and reviewed merge operations only.
- **Import execution/row accounting:** BT-08 canonical intake execution and row-disposition ledger.
- **GHL:** external projection/mapping only; never classification or identity truth.

Add one executable classification/provenance graph contract describing:

1. class-bearing roots;
2. inherited derived objects;
3. immutable event-time snapshots;
4. conflict resolution when linked roots disagree;
5. `unknown`, `untraceable`, and `legacy_unknown` semantics;
6. the evidence required for promotion to production;
7. the identity-resolution state required for pilot eligibility.

## 7. BLAST RADIUS

### In scope

- Extend the current authority to canonical business identity and every task-owned derived projection.
- Add aggregate-only classification/provenance/identity coverage and conflict buckets.
- Formalize root, inheritance, snapshot, and conflict semantics.
- Reconcile import execution and row-disposition categories.
- Require immutable primary-source evidence for production promotion and later pilot qualification.
- Expose reviewed identity state and decision-maker relationship completeness without performing automatic merges.
- Ensure CRO-01 revenue and existing outreach/provider gates consume the same resolved commercial decision.
- Add dry-run preview/approve/execute workflows and focused isolated tests.

### Out of scope

- Running production classification, reclassification, backfill, merge, cleanup, or deletion.
- Guessing history, provenance, or identity from names/domains/phone alone.
- Mass-merging contacts or changing merge policy.
- Provider calls, enrichment, cohort qualification, campaign enrollment, GHL writes, deployment, or outreach.
- Implementing CRO-03/CRO-04 provider and qualification authorities.
- Repairing Tasks, Campaign UX, Pipeline UX, or unrelated CRM pages.

Before editing, list exact expected files and explicitly excluded files. CRO-01 revenue files may receive only minimal consumer integration; do not rewrite its canonical object definitions.

## 8. DATA / SCHEMA CHECK

**Migration expected: YES, subject to preflight proof of the smallest additive model.**

The current executable subject union cannot represent canonical businesses or the full derived graph. Prefer an additive, versioned root/link/snapshot/coverage design over adding mutable columns indiscriminately to every table.

If needed, the next valid migration after the verified head is `0166_*`, Drizzle journal index `170`, with a strictly greater unique timestamp than `1794900000000`. Recapture the head first.

Migration rules:

- no `db push`;
- never edit or renumber historical migrations;
- no production execution or backfill;
- run from empty disposable PostgreSQL and run twice for idempotency;
- prove constraints do not silently classify or rewrite existing rows;
- default legacy/unresolved state must remain fail-closed;
- document downgrade/forward-fix behavior.

## 9. AUTHORIZATION CHECK

| Action | Agent | Manager | Admin | Operations/Data Owner |
|---|---:|---:|---:|---:|
| View own scoped aggregate coverage | Yes, no cross-agent buckets | Team aggregate | Global aggregate | As authorized |
| Preview classification | No by default | Optional reviewed policy | Yes | Owner-approved |
| Approve production classification | No | No unless explicitly designated | Distinct authorized approver | Owner-approved |
| Execute approved command | No | No unless explicitly designated | Yes, with version lock | Owner-approved |
| Review merge candidate | Scoped only | Team | Yes | As authorized |
| Execute reviewed merge | No | No | Existing BT-07 admin authority only | Owner-approved |
| Run production reconstruction/backfill | No | No | No by local access alone | Explicit separate approval |

Do not infer authority from database, Git, Replit, admin UI, or local shell access. Apply authorization before aggregation and ensure another agent’s existence, counts, conflicts, or provenance are not leaked.

## 10. CONCURRENCY / IDEMPOTENCY CHECK

Verify:

- classification command/event idempotency and collision behavior;
- distinct approver enforcement for production promotion;
- root locks and linked-root conflict checks;
- replay of source evidence cannot create duplicate pointers/events;
- import equation remains stable under retry, crash, and concurrent replay;
- classification and provenance projection changes commit atomically or reconcile durably;
- stale preview/version approval returns a conflict;
- identity resolution consumes BT-07 redirects and cannot merge transitively by accident;
- coverage scans are deterministic and do not mutate records;
- no root can be promoted while a linked commercial root is non-production or unresolved under the policy.

## 11. EXTERNAL SIDE-EFFECT CHECK

All automated proof must be local and isolated. Provider, GHL, campaign, deployment, production-database, and outbound transports must be denied.

Code may produce an owner runbook for a later production dry run. Do not claim that production records were classified, quarantined, merged, repaired, or counted without direct authorized evidence.

## 12. P0 / P1 / P2 CORRECTION REGISTER

### P0 — required before merge

- Extend the existing class graph beyond the current four executable subject types without creating a second authority.
- Define fail-closed classification inheritance/snapshots for canonical business and every task-owned production revenue/outreach projection.
- Prove zero unknown/test/demo/synthetic inclusion in production projections on non-empty isolated fixtures.
- Require immutable source evidence and resolved identity state for production promotion/pilot eligibility.
- Reconcile import execution/row dispositions exactly with no missing bucket.
- Keep production classification/backfill/merge execution disabled and separately authorized.

### P1 — required for task completion unless proven unrelated

- Add aggregate-only coverage/conflict APIs with role scope and a single `asOf`.
- Map legacy `companies` to canonical `businesses` explicitly without copying organizations.
- Expose primary-source, identity-resolution, and decision-maker relationship completeness.
- Ensure every changed revenue/outreach consumer uses the authority instead of direct class reads.
- Add replay, race, authorization, privacy, and migration tests.

### P2 — follow-up hardening

- Operator coverage dashboards and reviewed remediation queues beyond the minimum aggregate evidence.
- Production reconstruction batches, manual review staffing, and operational SLAs.
- Historical data-quality cleanup that requires business decisions not present in immutable evidence.

## 13. PREFLIGHT VERDICT

Use exactly one:

- BUILD-READY
- BUILD-READY WITH CORRECTIONS
- PREFLIGHT REQUIRED
- NOT BUILD-READY
- NOT NEW TASK
- WATCH

**Current verdict: BUILD-READY WITH CORRECTIONS.** CRO-01 is merged. BT-06/07/08 already exist and must be extended. Production classification/reconstruction remains a blocked operations step while safe schema, authority, read projections, tests, and runbooks proceed.

## 14. CORRECTED BUILD PLAN

1. Recapture live main, migration head, worktree, and CRO-01 prerequisite.
2. Inventory every class-bearing root, inherited object, event snapshot, and production projection.
3. Write the executable classification/provenance graph contract and reason taxonomy.
4. Extend `CommercialClassificationAuthority` and schema minimally for canonical businesses and derived decisions.
5. Build deterministic coverage/reconciliation queries with role scope and `asOf`.
6. Reconcile import dispositions to one exact equation and preserve all terminal reasons.
7. Link primary source, identity resolution, decision-maker evidence, and class state without copying records.
8. Wire CRO-01 revenue and current outreach/provider pre-spend readers to the shared resolved decision.
9. Add admin-only preview/approve/execute flows and a production dry-run runbook; do not execute it.
10. Add static, migration, integration, HTTP-role, replay, concurrency, privacy, and regression tests.
11. Run post-build searches, full diff review, and final VFC/kill-line mapping.

## 15. DONE LOOKS LIKE

- One canonical executable contract defines commercial root, inheritance, snapshot, and conflict behavior.
- Canonical businesses are covered without reviving legacy `companies` as a new writer.
- Unknown/test/demo/synthetic records are excluded from production revenue and outreach projections.
- Missing evidence remains unknown/untraceable; no history is fabricated.
- Import executions and row dispositions reconcile exactly.
- Pilot-eligible records have a primary source reference, resolved identity evidence, and an explicit decision-maker relationship state.
- Reviewed merge authority is preserved and legacy/automatic merge paths remain blocked.
- Coverage and conflict endpoints return aggregate-only, role-scoped buckets with filters/policy version/`asOf`.
- Production promotion requires immutable evidence, version locking, and a distinct authorized approver.
- No production data, provider, GHL, campaign, deployment, or outreach mutation occurs.

## 16. KILL LINES

- STOP if a second classification, contact, organization, provenance, or merge writer is introduced.
- STOP if any record is promoted from filename, prefix, name, domain, phone, provider label, or score alone.
- STOP if missing evidence is represented as known provenance.
- STOP if contacts are cloned into prospects or organizations are copied to manufacture history.
- STOP if unknown/test/demo/synthetic records can enter a production revenue/outreach projection.
- STOP if production promotion lacks immutable evidence, version locking, and distinct approval.
- STOP if automatic or mass phone-based merging is enabled.
- STOP if counts/conflicts leak cross-agent object existence.
- STOP if production classification, backfill, merge, cleanup, provider, GHL, campaign, deployment, or outreach side effects occur.
- STOP if `db push` is used, migration history is edited, or an unapproved backfill is required.

Finding one kill-line failure does not end the audit. Record it, isolate the affected implementation, and finish auditing all independent requirements.

## 17. IMPLEMENTATION RULES

Use the smallest reviewable diff and current project conventions. Use parameterized queries, immutable non-PII evidence references, stable reason codes, current role helpers, privacy-preserving not-found behavior, and one `asOf` per aggregate snapshot.

Do not expose raw identities, source rows, provider payloads, document contents, credentials, or free-form SQL errors. Avoid broad renames, formatting sweeps, dependency/lockfile churn, and unrelated cleanup.

## 18. TEST REQUIREMENTS

Use non-empty isolated fixtures and cover:

- all class values and invalid values;
- canonical business/contact/deal/prospect roots plus inherited statements/applications/MIDs/tasks/campaigns/sequences/imports;
- linked-root agreement and conflict;
- unknown/untraceable preservation;
- distinct actor/approver and stale version denial;
- preview, approve, execute, exact replay, divergent replay, and concurrent commands;
- import `input = terminal dispositions` across success, duplicate, invalid, deferred, failure, crash, and replay;
- primary-source pointer present/missing/conflicted;
- identity resolved/unresolved/collision/redirected;
- decision-maker known/unknown/conflicted;
- production projection exclusion for every non-production class;
- anonymous, Agent A, Agent B, manager, and admin role matrix;
- aggregate-only output with no PII;
- migration empty-bootstrap and second-run idempotency;
- provider/GHL/outbound transports denied.

Tests must fail if fixture setup is empty or a required suite is skipped.

## 19. SMOKE / INTEGRATION PLAN

Create one focused disposable flow:

`import row → source event → canonical business/contact → identity observation → reviewed class command → CRO-01 Lead/Deal or Merchant projection`

Prove positive, negative, conflict, replay, and authorization cases. Do not run against production or call external providers.

## 20. REQUIRED GATES

Run and report exact command, exit code, and result:

- focused CRO-02 static and disposable PostgreSQL suites;
- `npx tsx scripts/ci-suite-manifest.ts --check`;
- `npx tsx scripts/run-ci-suites.ts --capability deterministic-static`;
- disposable migration bootstrap twice and `npx tsx scripts/run-ci-suites.ts --capability deterministic-integration`;
- provider-denied server plus `npx tsx scripts/run-ci-suites.ts --capability server-required`;
- `npx tsx scripts/check-route-guards.ts`;
- `npx tsx scripts/check-migration-integrity.ts`;
- commercial-classification, contact-writer, intake-authority, identity/merge, and API coverage scans;
- `npm run check`;
- `npm run build`;
- `git diff --check`.

Do not invent commands. If a command cannot run, state the exact environmental blocker and do not convert static inspection into PASS.

## 21. POST-BUILD GREP CHECKS

Prove:

- no direct task-owned `record_class` write bypasses the authority;
- subject/inheritance coverage includes canonical businesses and all task-owned projections;
- no name/domain/phone/filename/prefix heuristic performs classification or merge;
- no contact-to-prospect or company-to-business cloning path was added;
- CRO-01 production predicates consume the resolved class decision;
- Ready/campaign/provider pre-spend paths fail closed on unresolved class/provenance/identity;
- no production backfill/cleanup, provider, GHL, campaign, deployment, or outreach code was added;
- no CRO-03 provider factory or CRO-04 cohort policy leaked into scope.

## 22. DIFF REVIEW

Run `git status --short`, `git diff --stat`, staged/unstaged full diff, and `git diff --check`. Confirm only CRO-02-owned files changed. Confirm no secrets, PII, raw imports, database dumps, provider payloads, debug output, generated junk, unrelated assets, lockfile drift, or production configuration mutation entered the diff.

## 23. FINAL VFC TABLE

Expand until every Done Looks Like row and kill line is mapped:

| ID | Requirement | Evidence | Test / Gate | Status |
|---|---|---|---|---|
| VFC-F01 | One canonical class/provenance graph | `file:line` | contract tests | PASS/FAIL |
| VFC-F02 | Canonical business coverage | `file:line` | root/inheritance tests | PASS/FAIL |
| VFC-F03 | Non-production quarantine | `file:line` | projection matrix | PASS/FAIL |
| VFC-F04 | Unknown/untraceable preserved | `file:line` | negative evidence tests | PASS/FAIL |
| VFC-F05 | Exact import reconciliation | `file:line` | crash/replay tests | PASS/FAIL |
| VFC-F06 | Primary source and identity evidence | `file:line` | evidence matrix | PASS/FAIL |
| VFC-F07 | Reviewed merge authority preserved | `file:line` | merge/grep gates | PASS/FAIL |
| VFC-F08 | Role/privacy-safe coverage | `file:line` | HTTP role matrix | PASS/FAIL |
| VFC-F09 | Safe migration | `file:line` | bootstrap twice/integrity | PASS/FAIL |
| VFC-F10 | No production/external mutation | diff/search | provider-denied gates | PASS/FAIL |

## 24. FINAL RESPONSE FORMAT

Return:

- **VERDICT:** COMPLETE / VERIFIED, PARTIALLY COMPLETE, or DO NOT MERGE.
- **Repository State:** starting/ending SHA, worktree, migration head.
- **Prerequisite State:** exact CRO-01 evidence.
- **Verified Root Cause and Assumption Corrections.**
- **P0 / P1 / P2 Corrections:** every finding, including unresolved items.
- **Classification/Provenance Contract.**
- **Implementation:** `file:line — change`.
- **Before/After Reconciliation:** aggregate-only buckets and equations.
- **Tests/Gates:** command, exit code, result.
- **Grep and Kill-Line Verification.**
- **Runtime/Operations Verification:** isolate code/test proof from production truth.
- **Remaining Risks and Owner Actions.**
- **Final Status:** SAFE TO MERGE, SAFE TO MERGE — RUNTIME VERIFICATION PENDING, or DO NOT MERGE.
- **Branch/PR URL:** never merge or deploy without explicit authorization.

Do not call local/mock evidence production verification.

## 25. RELEVANT FILES / AREAS TO VERIFY

- `server/services/commercial-classification-authority.ts`
- `server/services/revenue-read-authority.ts`
- `server/services/contact-writer.ts`
- `server/services/contact-identity.ts`
- `server/services/contact-merge.ts`
- `server/services/sdr/dedupe.ts`
- `server/routes/imports.ts`
- `server/routes/contacts.ts`
- `server/routes/routes-revenue.ts`
- `server/routes/crm-operations.ts`
- `shared/schema.ts`
- `migrations/0150_commercial_classification.sql`
- `migrations/0151_canonical_identity_merge.sql`
- `migrations/0155_canonical_intake_authority.sql`
- `migrations/0156_import_execution_source_payload.sql`
- `migrations/0157_csv_import_execution_projection.sql`
- `migrations/meta/_journal.json`
- `docs/canonical-revenue-contract.md`
- `scripts/check-migration-integrity.ts`
- `scripts/ci-suite-manifest.ts`
- `scripts/check-route-guards.ts`
- `.github/workflows/ci.yml`

Locate current owners first; do not assume every listed path remains unchanged.

## 26. FINAL DIRECTIVE

Verify this task from the exact current repository. If the safe code-side work remains build-ready, implement it now. Preserve all existing BT-06/07/08 and CRO-01 guarantees. Isolate only production classification/reconstruction/merge and other external operations that genuinely require later owner approval. Do not create another planning loop without a real blocker.
