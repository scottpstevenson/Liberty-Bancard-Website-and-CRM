# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD

First verify this task against the current codebase and repository state. If it remains materially valid and safe after corrections, continue directly into implementation in the same run. Do not stop after another plan unless a genuine blocker exists.

Do not blindly trust old claims, paths, line numbers, counts, surface names, table semantics, or the known anchor SHA. Do not redesign architecture, create competing sources of truth, perform speculative refactors, clean unrelated code, expand scope silently, use `db push`, weaken tests, expose secrets/PII, or make production-data mutations merely to satisfy a test.

Stop before a blocked portion only if the finding is false, the proposed owner is wrong, CRO-00 is not merged, a prerequisite is missing, destructive/external authority is unavailable, safe work depends on unavailable runtime evidence, scope must genuinely be split, or a kill line is reached. Complete every independent safe portion that is not blocked.

Required sequence:

Repository baseline → prerequisite check → VFC → targeted searches → verified root cause → source-of-truth check → blast radius → data/auth/concurrency/external-side-effect checks → preflight verdict → corrected build plan → kill lines → implementation → tests/gates → post-build searches → diff review → final VFC → merge verdict.

This is **CRO-01**, the second implementation task in the consolidated Revenue CRM and Cold-Outreach program. It owns normalized findings `CAR-006` through `CAR-009`.

Task 1694 preservation boundary: this task owns the canonical deal/read/count contract and any task-owned deals API root cause needed for truthful Pipeline data. `CRO-05` owns `CAR-045` dashboard null safety, Pipeline error/retry UX, client/server correlation and desktop/mobile reliability. Preserve a stable privacy-safe API error contract and explicit handoff without importing the full operator UI task.

## 1. REPOSITORY BASELINE

Known anchor when this task was written:

- PR #6 was squash-merged on 2026-08-27.
- `main` was `0e947faac9f7cd6aafbd634366e38e2dcd912f25` before CRO-00.

Recapture before making claims:

- fetch `origin/main` and record its exact full SHA;
- current branch and HEAD SHA;
- `git status --short` and whether unrelated changes already exist;
- origin URL and accessible repository metadata;
- PR #6 merged state/current descendant relationship;
- CRO-00 task PR/merge state and exact merged SHA;
- relevant GitHub workflow and branch-protection visibility;
- current migration SQL and Drizzle journal heads;
- current route/page/schema/service owners and test commands.

**Prerequisite:** CRO-00 must be merged or its exact equivalent must be verified in current main with all final VFC rows passing. If not, return `PREFLIGHT REQUIRED` or `NOT BUILD-READY`; do not duplicate CRO-00 inside this task.

Start from current clean `origin/main` on a dedicated task branch. Preserve unrelated/untracked uploads. Never print credentials, contact identities, database rows, message bodies or provider payloads.

No production data migration, record classification/backfill, GHL mutation, deployment, campaign activation or outreach is authorized.

## 2. VERIFIED FROM CODE — PREFLIGHT

Produce a concise table before implementation:

| ID | Task Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | People is backed by canonical `contacts` | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |
| VFC-02 | Current Leads is backed by separate `prospects` staging records | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |
| VFC-03 | Prospect-to-contact promotion is one-way and only a minority of prospects are linked | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | source and bounded aggregate evidence |
| VFC-04 | UI totals can be derived from 100/500-row fetch caps instead of authoritative totals | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |
| VFC-05 | Pipeline, Reporting, Statements, Applications, Portfolio and GHL stages do not share one deal/merchant read authority | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |
| VFC-06 | Cold prospects can appear in merchant/portfolio-like projections | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |
| VFC-07 | Existing prospect conversion is intended to be idempotent and can be preserved | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` and tests |
| VFC-08 | Canonical read models/views can be corrected without production data mutation | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | repository evidence |

Reconcile authenticated observations rather than hard-coding them. The audit observed 155,356 contacts, 12,711 prospects, 1,559 prospect/contact links, a 1,919,454 Lead Ops pool, 152,496 Outbound Prospects and 153,643 Ready records. Treat these as time-stamped evidence, not expected constants.

## 3. REQUIRED SEARCH / GREP CHECKS

Use `rg`, route/page/schema inventory, API consumer tracing and current tests to inspect at minimum:

### UI and route surfaces

- People, Leads, Prospects, Lead Ops, Lead Imports, Outbound Prospects and Ready for Outreach pages/tabs/routes;
- `ContactsAndLeads`, contacts/prospects pages, navigation labels and route definitions;
- KPI/count cards, pagination limits, `limit=100`, `limit=500`, client-array `.length` totals and sample labels;
- loading, empty, error, forbidden, deep-link and page-refresh behavior.

### Canonical entities and transitions

- schemas and writers/readers for contacts, prospects, businesses/companies, deals, statements, applications, merchants/portfolio and ownership;
- prospect conversion/promotion, `prospects.contact_id`, contact creation/reuse, deal creation/reuse and retry behavior;
- imports or intake paths that create contacts without prospect rows;
- every definition or label of “lead”, “prospect”, “merchant”, “customer”, “deal” and “pipeline”.

### Revenue consumers

- Pipeline queries/routes/components;
- Reporting deal/funnel/count queries;
- Tasks, Statement Reviews, Applications, Underwriting/Onboarding and Portfolio consumers;
- GHL opportunity/pipeline stage mappings and local deal reads;
- current stage-transition service and any direct deal-stage writers;
- any report that infers real merchant/revenue status from a prospect/contact label.

### Counts and reconciliation

- authoritative count endpoints versus page-list endpoints;
- joins/filter policies used by each surface;
- handling of archived, unknown, test/demo, duplicates and pagination;
- existing reconciliation scripts, APIs and tests;
- N+1/full-table-loading risks introduced by proposed read models.

Do not query or print production records. Use code, schema, aggregate-only evidence and isolated fixtures.

## 4. VERIFIED ROOT CAUSE

State:

- why multiple stores and projections are presented as “leads”;
- why enrichment/scoring occurs in staging while canonical CRM/outreach uses contacts;
- why only explicit prospect conversion creates the current bridge;
- why page fetch limits leak into KPI semantics;
- why deal/merchant consumers disagree;
- which current owner is safe to preserve.

Include:

| Original Assumption | Verified Reality | Correction |
|---|---|---|
| People and Leads are two views of the same canonical entity | ... | ... |
| Every contact should have a prospect row | ... | ... |
| A displayed page length is a reliable total | ... | ... |
| Every deal/portfolio row represents a real sales opportunity or merchant | ... | ... |
| Pipeline, Reporting and Portfolio already share one population | ... | ... |

If a later change already fixed a finding, prove the fix and complete remaining items without creating duplicate read models.

## 5. SOURCE-OF-TRUTH CHECK

Verify the current authority and mutation owner for:

- raw discovery record/evidence;
- prospect staging record;
- canonical contact/person endpoint;
- canonical organization/business identity;
- qualified Lead definition;
- deal/opportunity and stage transition;
- statement, proposal, application and onboarding linkage;
- activated merchant/portfolio membership;
- internal owner/assignee;
- GHL external opportunity/contact mapping;
- authoritative server-derived counts.

Target semantics to validate/correct:

- **Discovery record:** raw source observation/evidence, not a CRM lead.
- **Prospect:** pre-CRM staged candidate.
- **Contact:** canonical person/contact endpoint.
- **Lead:** canonical contact/business with one open qualified deal or equivalent verified lead state.
- **Deal:** single local sales-opportunity/stage authority.
- **Merchant:** won/onboarded account with processor/merchant evidence, not a cold prospect.

Do not create alternate contacts, prospects, deals or merchants. Do not fabricate prospect rows for existing contacts. Do not implement CRO-02’s commercial classification/provenance schema here.

## 6. BLAST RADIUS

### In scope

- navigation/labels distinguishing People, Prospect Staging, Leads, Deals and Merchants;
- canonical read models/APIs for real Leads and authoritative totals;
- idempotent prospect promotion semantics and exact contact/deal reuse;
- Pipeline/Reporting/Tasks/Statements/Applications/Portfolio/GHL consumer inventory and task-owned read alignment;
- a stable privacy-safe deals API failure contract (status, reason code and correlation identifier) for the later CRO-05 Pipeline UI, when the existing owner supports it without duplicating server-error authority;
- reconciliation APIs/counts and mismatch buckets;
- page/list versus global-count separation;
- loading/empty/error/forbidden states directly affected by changed APIs;
- focused isolated schema/query/API/UI/browser tests;
- task-owned documentation/evidence.

### Out of scope

- classifying/backfilling unknown/test/demo production rows (`CRO-02`);
- provenance reconstruction, identity merging or business-role evidence (`CRO-02`);
- durable enrichment (`CRO-03`);
- channel-qualified Ready/cohort authority (`CRO-04`);
- Task 1694 dashboard formatter hardening, Pipeline explanation/retry UI, client/server diagnostic correlation and desktop/mobile failure states (`CAR-045` / `CRO-05`), except the canonical deal/API contract owned here;
- full task-flood, Inbox/GHL workflow and operator remediation (`CRO-05`), except correcting shared canonical object/count consumers;
- campaign/content/feedback/attribution work (`CRO-06`/`CRO-07`);
- operations certification/deployment/pilot (`CRO-08`/`CRO-09`);
- production record cleanup or destructive migration.

Before editing, list exact files expected to change and files explicitly not expected to change. If full consumer correction is too broad for one reviewable task, implement the canonical contract/read models and compatibility adapters required here, then assign remaining UI-specific defects to CRO-05 without leaving two authorities.

## 7. DATA / SCHEMA CHECK

Migration required: **NO by default**.

Prefer canonical views/read services/API projections and existing IDs/links. CRO-02 owns new classification/provenance/identity structures. CRO-05 owns broader workflow/GHL repairs.

If current schema cannot express the verified canonical object relationship without an additive change:

- explain the exact missing contract and all readers/writers;
- prove it belongs to CRO-01 rather than CRO-02/CRO-05;
- use the next valid additive migration/journal entry;
- never use `db push` or edit historical migrations;
- apply the migration twice in disposable PostgreSQL;
- include compatibility/rollback and no-production-backfill behavior.

No production relabeling, data copying, contact-to-prospect cloning or merchant/deal cleanup is authorized.

## 8. AUTHORIZATION CHECK

Verify current policy and test direct API access:

| Action | Anonymous | Agent A | Agent B | Manager | Admin |
|---|---:|---:|---:|---:|---:|
| View own permitted Leads/contacts/deals | No | Scoped | Scoped | Authorized team scope | Yes |
| View Prospect Staging | No | Policy-scoped | Policy-scoped | Authorized scope | Yes |
| Convert prospect to contact/lead | No | Only if explicitly permitted | Only if explicitly permitted | Scoped | Yes |
| View Pipeline/Statements/Applications | No | Parent-owner scope | Parent-owner scope | Team scope | Yes |
| View merchant Portfolio | No | Authorized merchant scope | Authorized merchant scope | Team scope | Yes |
| Access another agent’s indirect object | No | No | No | Policy scope only | Yes |

Client hiding is not authorization. Reuse current single-tenant CRM role/capability policy; do not invent workspace/tenant semantics.

## 9. CONCURRENCY / IDEMPOTENCY CHECK

Prove:

- repeated/concurrent prospect conversion creates or reuses exactly one intended canonical contact and one intended open deal;
- `prospects.contact_id` or current equivalent cannot point to conflicting contacts;
- retries after contact creation but before deal/link completion recover deterministically;
- authoritative counts are transactionally consistent or explicitly snapshot-timestamped;
- pagination/filter changes do not change global totals incorrectly;
- read-model refresh/cache behavior cannot strand stale identity or leak cross-agent objects;
- compatibility adapters do not create dual mutation owners.

No external GHL mutation may be used to prove local idempotency.

## 10. EXTERNAL SIDE-EFFECT CHECK

Required local promotion ordering to verify in isolated fixtures:

1. Resolve prospect/source identity and authorization.
2. Claim idempotent promotion command or existing canonical uniqueness boundary.
3. Create/reuse canonical contact through the current contact owner.
4. Persist/reconcile the prospect/contact link.
5. Create/reuse the one intended qualified deal through the current deal owner.
6. Emit durable audit/projection intents.
7. Return canonical IDs and truthful disposition.

GHL mapping/sync, provider enrichment, production records, deployment and outreach are not part of this proof. Do not claim they occurred.

## 11. PREFLIGHT VERDICT

Use exactly one:

- BUILD-READY
- BUILD-READY WITH CORRECTIONS
- PREFLIGHT REQUIRED
- NOT BUILD-READY
- NOT NEW TASK
- WATCH

If CRO-00 is merged/equivalent and this task remains build-ready, implement immediately.

## 12. CORRECTED BUILD PLAN

Before editing, state:

- verified What & Why;
- exact Done Looks Like;
- canonical entities/services/routes/pages currently involved;
- migration decision;
- minimal implementation steps and focused tests.

Separate:

- **BLOCKING CORRECTION** — required for canonical truth and merge;
- **FOLLOW-UP HARDENING** — valid CRO-02/CRO-05 work that must not expand this task.

Minimum Done Looks Like:

- People, Prospect Staging, Leads, Deals and Merchants have explicit non-overlapping definitions;
- current Leads UI is relabeled Prospect Staging;
- a real Leads view is derived from canonical contacts/businesses plus the verified open qualified deal/lead authority;
- existing contacts do not require fabricated prospect rows;
- prospect promotion is idempotent;
- all totals are server-derived and independent of current page size;
- Pipeline and Reporting use the same local deal authority;
- cold prospects cannot appear as merchants;
- reconciliation endpoints identify mismatch buckets without printing PII;
- CRO-02 can later quarantine unknown/test/demo records without replacing these read contracts.

## 13. KILL LINES

- KILL LINE: If People, Prospect Staging, Leads, Deals or Merchants remain ambiguous or backed by competing definitions, the task has FAILED.
- STOP if the implementation copies all contacts into `prospects` or fabricates prospect history.
- STOP if a client page length/fetch cap can still masquerade as a global total.
- STOP if prospect promotion can create duplicate contacts or duplicate intended deals under replay/concurrency.
- STOP if cold prospects can still enter merchant/portfolio projections without merchant evidence.
- STOP if Pipeline and Reporting use different deal populations after task-owned changes.
- STOP if this task creates a second contact, organization, deal, stage or merchant mutation owner.
- STOP if it implements competing `record_class`, provenance or identity-merge authority owned by CRO-02.
- STOP if unauthorized cross-agent records become visible through new joins/read models.
- STOP if production data, GHL, providers, deployment or outreach is mutated.
- STOP if migration uses `db push`, edits historical migrations or requires an unapproved production backfill.

## 14. IMPLEMENTATION RULES

Use the smallest safe diff and current project conventions. Prefer read models, canonical services and compatibility adapters over broad renames or table rewrites. No unrelated UI redesign, dependency change, formatting sweep, production config mutation, data cleanup, new provider or alternate CRM architecture.

All API totals must define filters and as-of semantics. Preserve raw/staging data. If root cause or ownership differs materially, correct the plan before editing and continue only if the task remains independently reviewable.

## 15. TEST REQUIREMENTS

Tests must cover applicable happy, negative, boundary, replay, concurrency, authorization and regression cases:

- People/Prospect Staging/Leads/Deals/Merchants definitions against isolated fixtures;
- total count greater than page size and independent of page/limit/cursor;
- zero, one, and multiple-page datasets;
- archived/unknown/test/demo fixtures remain explicitly classified in reconciliation output without CRO-02 production policy implementation;
- prospect promotion first run, replay, concurrent calls and partial-failure recovery;
- contact exists before prospect conversion;
- deal exists before retry;
- Pipeline/Reporting/Statements/Applications/Portfolio use consistent canonical IDs/counts;
- cold prospect is not merchant;
- anonymous/agent A/agent B/manager/admin direct API matrix;
- loading/empty/error/forbidden/deep-link refresh behavior for changed UI.

Tests must create their fixtures and must not silently pass because tables are empty.

## 16. SMOKE / INTEGRATION TEST

Extend current tests for:

- prospect conversion/idempotency;
- contacts/prospects API pagination and counts;
- deal-stage and Pipeline/Reporting reconciliation;
- merchant/Portfolio qualification;
- route/ownership guards;
- browser navigation for People, Prospect Staging and Leads.

Add one focused reconciliation suite if needed:

`discovery/prospect → contact → open deal/Lead → statement/application → merchant`

The suite must use disposable PostgreSQL/Redis and fake/denied providers. It must not create GHL/provider/network side effects.

## 17. POST-BUILD GREP CHECKS

Re-run searches and prove:

- navigation no longer labels prospect staging as canonical Leads;
- no changed KPI derives global totals from page-array length or fixed fetch cap;
- no new path clones contacts into prospects;
- no task-owned consumer retains a second deal/merchant definition;
- Pipeline and Reporting read the same canonical deal authority;
- no cold-prospect fallback populates Portfolio;
- no direct mutation owner or cross-agent authorization bypass was added;
- no CRO-02 classification/provenance implementation leaked into this task;
- no production data/GHL/provider mutation logic was added.

## 18. REQUIRED GATES

Discover and run actual current repository commands. At minimum, where present/applicable:

- focused CRO-01 tests;
- deterministic-static related suites;
- disposable deterministic-integration and server-required suites;
- TypeScript check;
- production build;
- migration integrity if schema/migration changed or policy requires it;
- CI capability manifest;
- API coverage;
- role/security controls;
- prospect-conversion tests;
- Pipeline/Reporting/Portfolio reconciliation tests;
- browser role/navigation matrix for changed surfaces;
- `git diff --check`.

Report exact command, exit code and PASS/FAIL. Any skip, timeout, missing fixture, unreachable isolated service or unavailable required capability is a non-pass. Fix task-caused failures; identify unrelated failures honestly.

## 19. DIFF REVIEW

Run `git status --short`, `git diff --stat`, and full `git diff`. Confirm:

- only CRO-01-owned files changed;
- no secrets, PII, recipient data, database dumps, debug output or generated junk entered the diff;
- no unrelated lockfile/format/config drift;
- migrations and journal agree if used;
- no production data/GHL/provider/deployment/outreach mutation occurred.

## 20. FINAL VFC TABLE

Map every Done Looks Like requirement and kill line to file/evidence and a test/gate:

| ID | Requirement | Evidence | Test / Gate | Status |
|---|---|---|---|---|
| VFC-F01 | Explicit canonical object definitions | `file:line` | contract/query tests | PASS / FAIL |
| VFC-F02 | Prospect Staging and real Leads UI/API | `file:line` | browser/API tests | PASS / FAIL |
| VFC-F03 | Totals independent of pagination | `file:line` | multi-page count tests | PASS / FAIL |
| VFC-F04 | Idempotent prospect promotion | `file:line` | replay/concurrency integration | PASS / FAIL |
| VFC-F05 | Pipeline/Reporting share deal authority | `file:line` | reconciliation suite | PASS / FAIL |
| VFC-F06 | Portfolio requires merchant evidence | `file:line` | negative/positive fixtures | PASS / FAIL |
| VFC-F07 | Role/object access remains scoped | `file:line` | role matrix | PASS / FAIL |
| VFC-F08 | Task 1694 canonical deal/API prerequisite is complete and remaining dashboard/Pipeline reliability rows are assigned to CRO-05 | contract and traceability mapping | API/scope review | PASS / FAIL |

Expand until every material requirement and kill line is represented.

## 21. FINAL RESPONSE FORMAT

Return:

- **VERDICT:** COMPLETE / VERIFIED, PARTIALLY COMPLETE, or DO NOT MERGE
- **Repository State:** starting SHA, ending SHA/working tree, current migration head
- **Prerequisite State:** CRO-00 exact merged/equivalent evidence
- **Verified Root Cause**
- **Preflight Corrections**
- **Canonical Object Contract**
- **Implementation:** `file:line — change`
- **Before/After Reconciliation:** counts and mismatch buckets without PII
- **Tests / Gates:** command, exit and result
- **Post-Build Search Verification**
- **Kill-Line Verification**
- **Runtime/Operations Verification:** distinguish isolated behavior from production truth
- **Remaining Risks:** assign CRO-02/CRO-05 or other successor owner
- **Final Status:** SAFE TO MERGE, SAFE TO MERGE — RUNTIME VERIFICATION PENDING, or DO NOT MERGE
- **Branch/PR URL:** do not merge or deploy without explicit authorization

Do not call local, static or isolated evidence production verification.

## LIBERTY-SPECIFIC SAFETY RULES

- Database: no `db push`, production migration/backfill/cleanup, ordinary-database stateful tests or bulk copying.
- CRM: contacts remain canonical; prospects remain staging; Lead is a defined sales state/view; merchant requires evidence.
- Authorization: single-tenant role/ownership policy, no invented workspace/tenant model and no client-only security.
- External systems: no GHL/provider/deployment/outreach side effects.
- Evidence: aggregate counts, IDs/hashes/reason codes only; never expose raw PII or database rows.

## PRACTICAL REVIEW STANDARD

Block implementation for realistic risk of duplicate identities/deals, false totals, merchant contamination, unauthorized data exposure, competing authorities or production mutation. Do not block safe canonical read-model and count corrections merely because CRO-02 classification or CRO-05 operator remediation comes later.

---

# TASK TO PREFLIGHT + BUILD

## CRO-01 — Canonical Revenue Object Model and Count Truth

**Primary consolidated findings:** `CAR-006`, `CAR-007`, `CAR-008`, `CAR-009`  
**Preserved Task 1694 prerequisite:** canonical deal/query/count and privacy-safe deals API contract; remaining requirements are `CAR-045` / `CRO-05`.

### What & Why

The authenticated production audit proved that People, current Leads, Lead Ops, Lead Imports, Outbound Prospects and Ready for Outreach represent different populations. Current Leads is prospect staging, not the canonical set of qualified contacts/deals. Page fetch caps can masquerade as totals. Pipeline, Reporting, Statements, Applications, Portfolio and GHL stage consumers do not reliably share one deal/merchant population.

This task establishes explicit revenue-object meanings and truthful server-derived counts without copying records, classifying production data or replacing existing writers. Later tasks will add commercial classification/provenance and operator remediation against these stable contracts.

### Done Looks Like

- Discovery, Prospect Staging, Contact, Lead, Deal and Merchant are explicitly defined.
- Current Leads becomes Prospect Staging.
- Real Leads derives from canonical contacts/businesses plus one verified open qualified deal/lead authority.
- Existing contacts do not require fabricated prospect rows.
- Prospect conversion is idempotent and creates/reuses one contact and one intended deal.
- Global totals are server-derived and independent of current page size.
- Pipeline and Reporting share the same local deal population.
- Portfolio contains only records satisfying the verified merchant-evidence predicate.
- Reconciliation APIs expose exact counts and mismatch reasons without PII.
- The canonical deals API exposes or preserves a stable privacy-safe error contract that CRO-05 can render and correlate, and the final response assigns all remaining `1694-*` rows to CRO-05.

### Relevant Files and Areas to Verify

- contact/lead/prospect navigation and pages, including `ContactsAndLeads` equivalents
- contacts/prospects routes and storage/read services
- prospect conversion/promotion service
- contacts, prospects, businesses/companies, deals and merchant schema
- deal-stage transition service and readers
- Pipeline, Reporting, Tasks, Statement Reviews, Applications and Portfolio routes/pages
- GHL opportunity/pipeline mapping readers
- pagination/count utilities and API query clients
- role guards and browser tests

Do not assume paths or owners remain unchanged; locate current implementations first.

### Existing Kill Line

KILL LINE: If multiple incompatible populations can still be presented as canonical Leads, Deals or Merchants—or if page-limited data is still presented as a global total—the task has FAILED.

## FINAL DIRECTIVE

Do not implement this task exactly as written merely because it was provided. Verify it first against current main and the merged CRO-00 prerequisite. Then perform the complete sequence in this prompt. If task-owned corrections are build-ready, implement and test them now. Do not create another planning loop without a real blocker, and do not pull CRO-02 classification or CRO-05 operator scope into this PR.
