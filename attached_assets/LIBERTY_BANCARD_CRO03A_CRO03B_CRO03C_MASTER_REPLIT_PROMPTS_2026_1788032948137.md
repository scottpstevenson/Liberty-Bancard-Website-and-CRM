# LIBERTY BANCARD — CRO-03A THROUGH CRO-03C MASTER REPLIT PROMPT BUNDLE

**Prepared:** 2026-08-29  
**Repository audit baseline:** `main` at `2273f80b0bb4f3f9b628c8a2316d9d445865b1bc`  
**Execution rule:** The SHA above is evidence of the drafting baseline, not permission to skip preflight. Re-verify current `main`, the migration head, recent merges, and all affected owners before each task.

Execute these as three separate tasks, in order:

1. **CRO-03A — South Florida Candidate Intake & Merchant Qualification**
2. **CRO-03B — Unified Crawl Recipe, AI Evidence, Arbitration & Canonical Projection**
3. **CRO-03C — Live Enrichment Provider Activation & Governed Production Canary**

These tasks authorize building and operating contact enrichment. They do **not** authorize contact enrollment, campaign activation, GHL outbound mutation, email delivery, SMS delivery, RVM, or lifting the canonical global outbound pause.

---

# MASTER REPLIT PROMPT 1 OF 3

# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD. Audit the current repository, correct stale assumptions, and implement every safe build-ready portion of **CRO-03A — South Florida Candidate Intake & Merchant Qualification** in the same run. Do not stop at another plan unless a genuine owner decision or unavailable prerequisite makes implementation unsafe.

This task owns source qualification and selection only. It does not call live providers, crawl websites, use AI transport, create campaign enrollments, send messages, mutate GHL, create deals, or lift any outbound pause. It must convert today’s permanently quarantined source staging into an evidence-backed, versioned, deterministic candidate pool that CRO-03B can consume.

Do not trust this prompt’s baseline SHA, paths, counts, migration number, source list, or historical task state without verification. Do not use `db push`, rewrite applied migrations, weaken existing CRO-03 durability, erase immutable observations, promote every raw record to `contacts`, infer geography or vertical without evidence, or create a second identity/vertical/consent authority.

Required sequence: baseline → VFC → exhaustive searches → root cause → source-of-truth ownership → blast radius → schema/auth/concurrency/external checks → verdict → corrected plan → kill lines → implementation → tests/gates → post-build searches → diff → final VFC → merge verdict.

## 1. REPOSITORY BASELINE

Capture and report:

- branch, exact HEAD SHA, upstream relation, last relevant CRO-03/CR-04/CR-05 merges, and working-tree status;
- root migration SQL high-water mark, Drizzle journal high-water mark, and custom migration ledger/runner state;
- Node/npm versions required by the repository;
- current CRO-03 tables, constraints, triggers, routes, workers, registered tests, CI capability classification, and pre-deploy ownership;
- current source-store inventory for `sunbiz_entities`, `prospects`, `master_leads`, `sdr_merchants`, `lead_discovery_results`, provider CSV rows/import executions, canonical `businesses`, and `contacts`;
- current global outbound pause and channel-pause state read-only, without changing it;
- read-only aggregate counts by source type, record class, geography evidence, vertical evidence, qualification disposition, suppression state, existing-customer/open-opportunity state, and duplicate/identity-conflict state where safe and performant.

Preserve unrelated modifications. If the repository is dirty, identify ownership before touching overlapping files.

## 2. VERIFIED FROM CODE — PREFLIGHT

Return a VFC table before implementation:

| ID | Task Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | CRO-03 source staging exists | CONFIRMED / PARTIAL / FALSE / OUTDATED | Verify `cro03_source_subjects`, observations, normalized candidates, dispositions, recipe rows and memberships | `file:line` / migration |
| VFC-02 | South Florida staging is executable | ... | Audit the current recipe status, route, spend policy and item disposition | ... |
| VFC-03 | Prospect and Sunbiz routes create executable enrichment | ... | Verify whether they return `STAGING_RECIPE_DISABLED` or another current outcome | ... |
| VFC-04 | Provider CSV rows are promoted | ... | Verify whether Apollo/Outscraper CSV rows remain deferred evidence only | ... |
| VFC-05 | All relevant raw stores use the source envelope | ... | Inventory every raw-store writer and CRO-03 staging caller | ... |
| VFC-06 | Qualification is versioned and reproducible | ... | Verify geography, fit, exclusion, duplicate and disposition snapshots | ... |
| VFC-07 | Candidate selection is idempotent and concurrent-safe | ... | Verify stable keys, claims, singleton/active-run constraints and replay behavior | ... |
| VFC-08 | Qualification can create contacts/deals/outbound effects | ... | Prove the current and intended boundary | ... |

At the drafting baseline, the following were verified and must be rechecked:

- `server/services/cro03/source-staging.ts` defined `SOUTH_FLORIDA_STAGING_RECIPE` with `status: "disabled"`, no providers, no spend, and default quarantine.
- Migration `0177_cro03_source_staging_evidence.sql` constrained `cro03_staging_recipes.status` to `disabled`, inserted only disabled recipe version 1, and forced Apollo, Outscraper, Serper and ZeroBounce controls disabled.
- `createCro03SourceBatch()` created blocked items with `STAGING_RECIPE_DISABLED` and zero executable count.
- Sunbiz enrichment routes returned blocked staging results.
- Apollo/Outscraper provider CSV rows were staged and deferred rather than promoted.
- `createCro03Batch()` accepted contact IDs only; non-contact source subjects could not enter the executable factory.

## 3. REQUIRED SEARCH / GREP CHECKS

Search current code and migrations for:

- `SOUTH_FLORIDA_STAGING_RECIPE`, `STAGING_RECIPE_DISABLED`, `cro03_staging_recipes`, `createCro03SourceBatch`, `createCro03Batch`;
- every `cro03_source_subjects`, `cro03_source_observations`, `cro03_normalized_candidates`, `cro03_candidate_dispositions`, `cro03_batch_memberships` and `cro03_enrichment_items` reader/writer;
- all source types and source-system identifiers;
- every writer/reader of `sunbiz_entities`, `prospects`, `master_leads`, `sdr_merchants`, `lead_discovery_results`, `import_executions`, provider CSV classifications, `businesses`, `contacts`, deals and campaigns;
- existing record classification, provenance, identity-cluster, business alias/location, existing-customer, opportunity, suppression, DNC and contactability authorities;
- canonical vertical constants, subvertical mappings, source authority and confidence thresholds;
- existing lead/SDR scoring, processor signals, volume estimates, readiness, campaign mappings and manual overrides;
- South Florida county, city, ZIP and address normalization logic;
- scheduled/manual Sunbiz, prospect, import and discovery paths;
- raw SQL inserts/updates that bypass source staging;
- UI/API surfaces that claim a record was enriched, qualified, promoted or ready;
- tests that assert staging is permanently disabled.

Search for stale flags, dead settings, duplicate taxonomy tables, loose keyword lists, memory-only cursors, `setImmediate`, unbounded loops, swallowed errors, raw PII logging and any path that creates contacts/deals/enrollments from source qualification. Grep is an inventory, not proof; inspect surrounding control flow.

## 4. VERIFIED ROOT CAUSE

State the exact current root cause. Reconcile at least:

| Original Assumption | Verified Reality | Required Correction |
|---|---|---|
| Source staging is a usable intake pipeline | It may be an append-only quarantine with no active recipe | Add an approved versioned qualification authority without mutating v1 history |
| All raw sources share one intake contract | Several parallel stores may stage inconsistently or not at all | Route each source through one immutable source-observation envelope |
| South Florida targeting is implemented | A county allowlist may exist only as inert JSON | Implement deterministic evidence-based geography decisions |
| Existing verticals identify merchant fit | Multiple taxonomies/scorers may disagree | Reuse canonical vertical authority and persist the exact version/input |
| A high score means outreach-ready | Fit, identity, validation, consent and campaign readiness are distinct | Persist candidate-fit qualification only; never grant outreach permission |
| Duplicate suppression is sufficient | Hash-only matching may hide shared phones/addresses or ambiguous organizations | Use canonical identity candidates and review states; never phone-only auto-merge |

Do not call the task complete merely because a table or JSON recipe exists. The output must be a durable, queryable, rerunnable candidate cohort with reconciled dispositions.

## 5. SOURCE-OF-TRUTH CHECK

Identify and preserve one owner for each concept:

- raw acquisition fact: original source store plus immutable CRO-03 observation;
- source envelope and observed payload hash: CRO-03 source staging;
- organization identity: canonical `businesses`/organization-resolution owner, with aliases and locations as evidence;
- CRM person/contact: `contacts` through the canonical contact writer only;
- vertical: current canonical vertical resolver and source-authority rules;
- commercial relationship/existing customer/open opportunity: CRO-02 commercial graph/resolution authority;
- consent, suppression and contactability: existing channel-specific authorities; never part of fit scoring;
- candidate-fit qualification: the versioned CRO-03A policy built by this task;
- provider routing and field recipe: CRO-03B, not this task;
- provider activation/budgets: CRO-03C, not this task;
- campaign readiness: CR-04/CRO-05A/CR-06, not this task.

Do not create a parallel master lead table, vertical resolver, contact writer, suppression engine, or commercial graph.

## 6. BLAST RADIUS

### In scope

- extending the CRO-03 source envelope to every verified acquisition/staging source needed for South Florida merchant discovery;
- adding missing source types such as canonical business, master lead, registry/import or discovery result only when verified necessary;
- versioned geography, vertical-fit, exclusion, duplicate and paid-enrichment eligibility decisions;
- immutable qualification evidence and deterministic selection snapshots;
- a durable qualification run/item lifecycle with pagination, cancellation, restart and reconciliation;
- controlled activation pointer for an approved recipe version without editing immutable recipe history;
- counts-only and masked operator preview/status surfaces in the existing Lead Ops/Prospects/Enrichment area;
- tests and migrations required for the above.

### Out of scope

- network/provider/AI calls;
- website crawling or field extraction;
- canonical field arbitration and contact/business creation from new evidence;
- ZeroBounce execution;
- continuous production scheduling/backfill;
- division/group/owner assignment;
- campaign/sequence construction, enrollment, GHL mutation or sending;
- speculative cleanup of legacy stores.

List expected files after preflight and explicitly untouched areas. Keep the diff focused.

## 7. DATA / SCHEMA CHECK

Verify whether the current schema can represent the required lifecycle. Prefer additive use of existing CRO-03 tables. If missing, use the next valid migration and Drizzle journal entry—never `db push`.

The persisted contract must provide:

1. **Immutable recipe definitions.** Preserve disabled recipe v1. Do not update it in place.
2. **One mutable activation pointer/control per recipe key** with current version, enabled/paused state, optimistic version, actor, reason and timestamps. The active pointer is not permission for provider I/O.
3. **Durable qualification runs** with idempotency key, actor, frozen filter/policy versions, selection hash, cursor, state, counts, cancellation and terminal receipt.
4. **Durable qualification items/decisions** tied to source subject and exact observation, including:
   - geography decision/evidence and policy version;
   - canonical vertical/subvertical candidate, source, confidence and taxonomy version;
   - entity/record classification;
   - exclusion decisions and reason codes;
   - identity/duplicate state;
   - fit score, component breakdown and score version;
   - free-enrichment eligibility, paid-enrichment eligibility and required missing fields;
   - final `selected`, `blocked`, `review_required`, `duplicate`, `existing_relationship`, `outside_geography`, `suppressed`, `inactive_entity`, `insufficient_evidence` or equivalent normalized disposition.
5. **Reconciliation invariants.** Total selected source rows must equal all terminal and outstanding buckets exactly.
6. **No raw credential, unbounded provider payload, or unnecessary plaintext PII** in control/audit rows. Candidate values use the existing encrypted/masked evidence boundaries where applicable.

Default geography policy:

- state: Florida;
- counties: Miami-Dade, Broward and Palm Beach;
- county evidence outranks city/ZIP inference;
- a versioned ZIP/city fallback may classify probable South Florida but must retain `inferred` versus `verified`;
- conflicting or insufficient geography becomes review/deferred, not silently in-scope;
- Monroe is not enabled unless the active policy explicitly includes it.

Candidate-fit scoring must be versioned, deterministic and separate from lead score/readiness. Components may include active registry status, geography confidence, canonical vertical fit, plausible operating location, processor/switchability signals, estimated merchant size/complexity, identity confidence, existing website/phone coverage, decision-maker discoverability and source freshness. Consent or deliverability must not be converted into fit points.

Before any migration, inventory constraints/triggers/consumers. Prove clean replay and upgraded-state behavior. Never rewrite immutable observations or guess historical classifications.

## 8. AUTHORIZATION CHECK

Verify and enforce server-side authorization:

| Action | Agent | Manager | Admin | System worker |
|---|---:|---:|---:|---:|
| View counts/masked qualification results | scoped/read | yes | yes | n/a |
| Create bounded qualification preview/run | no unless existing policy says otherwise | yes | yes | authorized scheduler only |
| Cancel own/scoped run | no | scoped | yes | owner worker |
| Approve/activate recipe version | no | no | yes | no |
| Change geography/score/exclusion policy | no | no | yes | no |
| View raw source PII | existing field-level policy only | existing policy | existing policy | purpose-bound |

Managers must not gain provider-enable, budget, secret, global policy or unbounded backfill authority. Admin actions require reasoned audit records and optimistic concurrency. Counts-only previews must not leak cross-owner PII.

## 9. CONCURRENCY / IDEMPOTENCY CHECK

Prove:

- same idempotency key + same frozen selection returns the original run;
- same key + different payload/policy returns a typed conflict;
- simultaneous creators cannot produce duplicate runs or decisions;
- selection uses stable source subject + observation identity, not array ordinal as business identity;
- a newer source observation does not mutate a frozen run; it can be selected only by a new run;
- pagination/cursor replay cannot skip or duplicate subjects;
- cancellation and lease expiry are recoverable;
- a source row changing, archiving or becoming suppressed after selection supersedes downstream use rather than rewriting history;
- duplicate detection never merges from shared phone/address alone;
- run counts reconcile after crash, retry and cancellation.

Use database constraints, transactions, claims and fences. Do not rely on process memory.

## 10. EXTERNAL SIDE-EFFECT CHECK

This task must make **zero external enrichment calls**. Tests and implementation must prove:

- no Serper, Outscraper, Apollo, ZeroBounce, OpenAI, GHL or arbitrary website transport;
- no contact, business, deal, campaign, sequence enrollment, outbound message or GHL mutation;
- no provider reservation or consumed billing unit;
- no automatic follow-up task or promotional action;
- only immutable source evidence, qualification control/run/item/decision rows and redacted audit records are written.

Keep canonical global outbound pause true. Qualification must be independent of the send pause, but it may not weaken or bypass it.

## 11. PREFLIGHT VERDICT

Choose BUILD-READY, BUILD-READY WITH CORRECTIONS, PREFLIGHT REQUIRED, NOT BUILD-READY, NOT NEW TASK, or WATCH. Continue immediately for either build-ready verdict.

If the current repository already implements part of this task, preserve it and close only the remaining verified gaps. Do not reopen completed CRO-03 durability work.

## 12. CORRECTED BUILD PLAN

At minimum, the build plan must:

1. inventory and normalize source adapters into the immutable CRO-03 source envelope;
2. define and persist qualification policy/version and active-pointer authority;
3. implement South Florida geography evaluation;
4. reuse canonical vertical resolution and persist its evidence/version;
5. implement exclusions and relationship/suppression checks through existing authorities;
6. implement deterministic candidate-fit scoring and missing-field classification;
7. implement durable run/item claims, replay, cancellation and reconciliation;
8. expose bounded preview/run/status/reason APIs and minimal existing-console UI;
9. leave selected subjects ready for CRO-03B recipe planning without provider execution;
10. register all new static/integration/authorization tests in canonical CI/pre-deploy ownership.

Separate **blocking corrections** from optional follow-up hardening. This task is not complete if every candidate remains permanently blocked under the old recipe.

## 13. KILL LINES

- KILL LINE: If an eligible source still cannot become a durable selected CRO-03A candidate without first being manually converted to `contacts`, the task has FAILED.
- KILL LINE: If qualification can create a contact, deal, enrollment, outbound message, GHL mutation or provider charge, the task has FAILED.
- STOP if disabled recipe v1 or immutable observations are edited in place.
- STOP if a raw keyword, phone, address or AI guess becomes canonical identity/vertical without evidence and confidence.
- STOP if existing customers, open opportunities, test/demo/synthetic rows, suppressed/DNC rows, inactive entities or out-of-geography records can silently enter the paid-enrichment candidate set.
- STOP if unresolved duplicates are auto-merged or phone alone establishes a person.
- STOP if fit score is represented as consent, validation, readiness or campaign eligibility.
- STOP if concurrent/replayed runs create duplicate decisions or unreconciled counts.
- STOP if logs/API errors expose raw PII, secrets or source payloads.

## 14. IMPLEMENTATION RULES

- Use existing CRO-03 evidence, CRO-02 relationship, vertical, identity, record-classification and consent/suppression owners.
- Prefer pure deterministic policy functions with explicit versions.
- Preserve immutable history; corrections are new rows/versions.
- Keep provider transport compile-time/runtime disabled in this task.
- No broad refactor, dependency churn, unrelated formatting, legacy deletion or production data backfill.
- No client-only authorization.
- No source-specific direct promotion shortcut.
- Do not add a second CRM/Lead Ops console; extend the current authoritative surface.

## 15. TEST REQUIREMENTS

Add production-path tests covering:

- every supported source type and source-system identity;
- exact observation replay and changed-observation behavior;
- Miami-Dade, Broward, Palm Beach, outside Florida, Monroe-disabled, inferred ZIP/city, conflicting and missing geography;
- active/inactive entity, existing customer, open opportunity, test/demo/synthetic, suppressed/DNC and missing provenance;
- canonical and noncanonical verticals, subvertical mapping, manual override and low-confidence discovery evidence;
- exact duplicate, ambiguous duplicate, shared business phone and shared address;
- fit-score boundaries and version changes;
- selected/blocked/review dispositions and full count reconciliation;
- idempotency mismatch, simultaneous run creation, worker claims, lease recovery, cancellation and cursor restart;
- agent/manager/admin/worker authorization and IDOR;
- no provider operation, contact, business, deal, campaign, enrollment, outbound/GHL side effect;
- privacy-safe API/error/log output.

Tests use disposable PostgreSQL and isolated Redis where stateful. Network/provider denial must be active.

## 16. SMOKE / INTEGRATION TEST

Create or extend a focused disposable certification suite, for example `scripts/test-cro03a-source-qualification.ts`, that stages representative Sunbiz, prospect, SDR, master-lead/discovery and provider-CSV fixtures; runs qualification twice and concurrently; verifies exact dispositions and counts; restarts/resumes a claimed run; and proves zero contact/provider/outbound effects.

The suite must use the real qualification service and database constraints, not a mock-only policy assertion. Register it in `scripts/ci-suite-manifest.ts` and the canonical pre-deploy gate with provider denial.

## 17. POST-BUILD GREP CHECKS

Prove:

- active code no longer hardcodes every source result to `STAGING_RECIPE_DISABLED`;
- all required raw source entry points call the canonical source-envelope adapter or have a documented excluded reason;
- no task-owned source qualification path calls provider adapters or contact/deal/enrollment writers;
- no duplicate geography/vertical/fit authority was introduced;
- no unbounded source scan or memory-only run cursor exists;
- existing disabled recipe history remains intact;
- new tests are registered and cannot silently skip stateful/provider-denial proof.

## 18. REQUIRED GATES

Run and report actual commands/results for:

- migration integrity and clean disposable migration replay;
- upgraded-state migration verification;
- CRO-03 static, integration, HTTP authorization and client-endpoint suites;
- new CRO-03A qualification static/integration/authorization suite;
- commercial classification, identity/provenance, canonical writer, consent/suppression and record-classification regressions;
- provider-denial and paid-provider adapter scans;
- TypeScript `npm run check`;
- production `npm run build`;
- canonical pre-deploy/CI manifest checks where feasible;
- `git diff --check`.

Do not claim complete with a task-owned red or silently skipped gate.

## 19. DIFF REVIEW

Run `git status`, `git diff --stat`, `git diff`, migration/journal review and tracked-file scan. Confirm no secrets, PII fixtures, raw provider bodies, generated exports, lockfile drift, unrelated formatting, production config mutation or outbound flag changes.

## 20. FINAL VFC TABLE

Return one row for every Done Looks Like requirement and kill line:

| ID | Requirement | Evidence | Test / Gate | Status |
|---|---|---|---|---|
| VFC-F01 | Source stores enter one immutable envelope | `file:line` | suite | PASS / FAIL |
| VFC-F02 | South Florida qualification is versioned/reproducible | ... | ... | ... |
| VFC-F03 | Selection is idempotent/concurrent-safe | ... | ... | ... |
| VFC-F04 | Zero provider/contact/outbound effects | ... | ... | ... |

## 21. FINAL RESPONSE FORMAT

Return:

1. verdict and SAFE TO MERGE / SAFE TO MERGE — RUNTIME VERIFICATION PENDING / DO NOT MERGE;
2. starting and ending SHA/branch/worktree;
3. migration head before/after;
4. verified root cause and corrections to stale task claims;
5. source types and canonical owners;
6. implemented files/lines and schema objects;
7. before/after read-only cohort counts and reconciled fixture counts;
8. test/gate table with exact commands;
9. provider/network-denial and outbound-no-effect proof;
10. grep/diff/kill-line proof;
11. remaining runtime-only risks and exact dependency contract handed to CRO-03B.

## LIBERTY-SPECIFIC SAFETY RULES

- Raw source inventory is not a CRM audience.
- Registry officers and registered agents are evidence, not automatically the desired decision-maker.
- Email validity is not consent; fit is not readiness.
- Shared business phones do not establish person identity.
- All contact creation remains canonical-writer-owned.
- No provider calls or GHL/outbound effects in CRO-03A.
- No `db push`, migration rewriting or broad production cleanup.

## PRACTICAL REVIEW STANDARD

Block for false qualification, unverifiable geography/vertical, duplicate spend eligibility, identity conflation, unauthorized policy mutation, PII leakage, non-idempotent runs, or any external/contact/outbound side effect. Do not block a correct deterministic candidate pool because CRO-03B/03C are not yet built; instead prove the handoff contract explicitly.

---

# TASK TO PREFLIGHT + BUILD

## CRO-03A — South Florida Candidate Intake & Merchant Qualification

**Primary correction:** Turn the immutable but permanently disabled source-staging foundation into a governed, versioned candidate-qualification authority.  
**Dependencies:** Existing CRO-03 durable factory/source evidence, CRO-02 commercial graph, canonical identity/vertical/consent authorities, and current import-idempotency/consent-certification corrections if they remain unmerged.

### What & Why

CRO-03 created durable evidence tables, but current non-contact source intake is intentionally and permanently quarantined. Sunbiz entities, prospects, SDR merchants, discovery results and Apollo/Outscraper CSV evidence cannot become a governed, executable candidate pool. Liberty therefore has source volume without a reproducible answer to which active South Florida merchants are worth enriching.

Build a versioned candidate-qualification layer over the existing CRO-03 source evidence. It must select the best plausible merchant-processing businesses in Miami-Dade, Broward and Palm Beach, preserve all source and exclusion truth, and hand CRO-03B a frozen selected cohort—without calling a provider or creating a contact.

### Done Looks Like

- Every required source enters one immutable CRO-03 source envelope.
- A versioned South Florida policy produces deterministic selected/blocked/review dispositions and reason codes.
- Geography, canonical vertical, active status, source freshness, identity state, relationship/suppression state, missing fields and merchant-fit components are frozen per decision.
- Existing customers/opportunities, inactive/test/demo/synthetic, suppressed/DNC, outside-geography and unresolved-identity rows cannot enter paid-enrichment eligibility silently.
- Replays, concurrent runs, cancellation and restart reconcile exactly.
- Operators can preview counts and run/status results through existing authorized surfaces.
- No provider, AI, website, GHL, contact, deal, campaign, enrollment or send side effect occurs.
- CRO-03B receives an explicit queryable contract for selected source observation IDs and frozen qualification versions.

### Out of Scope

- Crawl/provider execution, field arbitration/projection, continuous scheduling, ownership assignment and campaign operations.

### Proposed Implementation Steps

1. Re-audit every raw source and its current CRO-03 staging coverage.
2. Add only the missing source-envelope types/adapters.
3. Add an append-only South Florida qualification policy version plus one audited active-version control.
4. Implement durable run/item claims, frozen selections, geography/vertical/exclusion/identity decisions and candidate-fit scoring.
5. Persist normalized dispositions and exact count reconciliation.
6. Add authorized counts-only preview, run, status, cancellation and policy-control APIs/UI to the existing operator surface.
7. Register disposable concurrency/replay/auth/provider-denial certification.

### Relevant Files and Areas to Verify

- `server/services/cro03/contracts.ts`
- `server/services/cro03/source-staging.ts`
- `server/services/cro03/enrichment-factory.ts`
- `server/routes/cro03.ts`, `server/routes/prospects.ts`, `server/routes/imports.ts`
- source writers/readers for Sunbiz, prospects, master leads, SDR merchants and discovery results
- `server/services/commercial-resolution.ts`
- canonical organization/contact/vertical/record-classification/consent services
- `shared/schema.ts`, next migration and `migrations/meta/_journal.json`
- existing Lead Ops/Prospects/Enrichment UI and CRO-03/CI/pre-deploy tests

### Existing Kill Line

KILL LINE: If a raw record must be manually turned into a contact before it can become a governed enrichment candidate—or if qualification itself creates commercial/outbound effects—the task has FAILED.

## FINAL DIRECTIVE

Verify current main, correct the task, and build it now. Preserve CRO-03’s immutable evidence and durability. Replace permanent quarantine with a governed selection authority, not a bulk-contact conversion shortcut.

---

# MASTER REPLIT PROMPT 2 OF 3

# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD. Implement **CRO-03B — Unified Crawl Recipe, AI Evidence, Arbitration & Canonical Projection** after verifying CRO-03A is merged and its exact handoff contract exists on current `main`.

This task builds the complete deterministic enrichment waterfall and canonical projection path using fake/injected transports and network denial. It must not enable live paid providers; that is CRO-03C. It may exercise real production code through controlled fixtures, but every deterministic suite must be incapable of reaching Serper, Outscraper, Apollo, ZeroBounce, OpenAI or arbitrary public websites.

Do not bolt another orchestrator beside CRO-03, preserve legacy direct writers, treat an LLM as an authority, call every provider for every record, allow raw provider responses to overwrite CRM fields, validate an email before winner projection, create a contact before organization/person identity is sufficient, use `db push`, or weaken the global outbound/GHL boundary.

Required sequence: baseline → dependency proof → VFC → exhaustive provider/writer/search inventory → root cause → canonical ownership → blast/schema/auth/concurrency/external checks → verdict → corrected recipe plan → kill lines → build → disposable certification → diff/VFC → merge verdict.

## 1. REPOSITORY BASELINE

Capture:

- branch, HEAD SHA, worktree, recent CRO-03A/CRO-03/CR-04/CR-05 merges;
- migration and journal head;
- CRO-03A policy/run/item/decision schema and selected-cohort handoff;
- current CRO-03 route, providers, worker context, operations, attempts, observations, candidates, arbitration, mutation commands, receipts and ledger;
- current provider manifest and approved callers;
- current SafeEgress, RDAP, JSON-LD, contact-page, Serper, Outscraper, Apollo, ZeroBounce, Sunbiz and AI code paths;
- current canonical organization/business resolution, contact writer, vertical resolver, readiness/scoring triggers and commercial-resolution fences;
- current legacy enrichers and every overlapping field writer;
- current CI/pre-deploy CRO-03/provider-denial suite ownership.

If CRO-03A is absent, stale, red or does not produce immutable selected source observations, stop and return a dependency blocker rather than implementing a second candidate selector.

## 2. VERIFIED FROM CODE — PREFLIGHT

Return a VFC table including:

| ID | Task Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | CRO-03A selected cohorts exist | ... | Verify immutable selected observation/policy handoff | ... |
| VFC-02 | Current route is a field-level waterfall | ... | Inspect whether it selects one provider plus ZeroBounce | ... |
| VFC-03 | Public-web/RDAP/JSON-LD are CRO-03 evidence steps | ... | Verify direct legacy writes versus observations/candidates | ... |
| VFC-04 | AI extraction is governed CRO-03 evidence | ... | Verify model/prompt/evidence lineage and write authority | ... |
| VFC-05 | Serper is executed inside CRO-03 | ... | Verify gateway ownership and `existing_authority_required` deferral | ... |
| VFC-06 | Outscraper performs multi-result identity resolution | ... | Verify scoring, ties, confidence and result limits | ... |
| VFC-07 | Apollo is organization-bound | ... | Verify frozen organization/domain and person-title handling | ... |
| VFC-08 | Arbitration chooses authoritative winners | ... | Verify whether any distinct value becomes an unresolved conflict | ... |
| VFC-09 | Non-contact subjects can become canonical company/contact | ... | Verify business/contact projection path and provenance | ... |
| VFC-10 | ZeroBounce runs only after winning email projection | ... | Verify generation-bound validation intent | ... |

At the drafting baseline, current code was verified to:

- route to exactly one of Outscraper, Apollo or Serper based on broad gaps, then optionally append ZeroBounce;
- issue CRO-03 worker authorization contexts only for Apollo and Outscraper;
- defer Serper in the CRO-03 worker as `existing_authority_required`;
- treat all distinct candidate values as a conflict rather than apply field-specific authority/freshness/margin rules;
- project only a limited contact-field map and require an existing contact membership;
- retain separate legacy Sunbiz/SDR/public-web/AI paths that may write overlapping stores;
- include a bounded SSRF-resistant `safe-egress.ts` foundation;
- create a generation-bound `cro03_winning_email` validation intent after email projection.

## 3. REQUIRED SEARCH / GREP CHECKS

Inventory and inspect:

- `selectCro03Route`, frozen route plans, provider step selection and re-evaluation;
- `CRO03_PROVIDERS`, candidate fields/outcomes, provider context and reservation logic;
- `arbitrateField`, source rank/confidence/freshness/manual authority, conflicts and mutation commands;
- candidate vault encryption/masking and observation/receipt lineage;
- all direct adapters and URLs for Serper, Outscraper, Apollo, ZeroBounce and OpenAI;
- `safe-egress`, DNS/IP/redirect/body/content-type controls;
- RDAP, JSON-LD, homepage/contact/about/team/location crawlers and robots/rate/TTL logic;
- Sunbiz detail/officer/registered-agent extraction and direct field writes;
- AI classification, summaries, prompts, model IDs, token/cost audit and direct writes;
- organization resolver/service, `ingestBusiness`, aliases/locations, reviewed links and commercial graph;
- `writeContact`, `updateContactLocalFirst`, contact identity/provenance, generation and post-write triggers;
- canonical vertical source authority and manual overrides;
- ZeroBounce intent creation/worker/evidence/readiness;
- every legacy enrichment route/UI/action and scheduler that could bypass the factory;
- raw PII/provider-body logging and unbounded HTML/JSON parsing;
- current tests/scanners and all assertions that transport must remain disabled.

Search around each match; do not infer behavior from filenames.

## 4. VERIFIED ROOT CAUSE

Reconcile:

| Problem | Current Reality | Correction |
|---|---|---|
| Provider strategy exists | The route may select one coarse provider and stop rather than re-evaluate field gaps | Build a versioned, stepwise recipe state machine |
| Public web/AI enrichment exists | Legacy paths may write operational fields directly | Convert them to observations/candidates under CRO-03 |
| Outscraper matches businesses | Query/results may not preserve a formal threshold/margin/evidence decision | Add deterministic multi-result organization matching |
| Apollo finds contacts | Organization binding exists but title/person selection may be simplistic | Add versioned decision-maker policy and ambiguous-person review |
| Candidate arbitration exists | Any conflicting value may block, regardless of authority/freshness | Add field-specific deterministic arbitration with protected authority |
| CRO-03 creates final contacts | Current worker may require an existing contact | Support selected source → organization → canonical contact projection |
| ZeroBounce is connected | It must validate only the projected winning email generation | Preserve and certify that exact sequence |

## 5. SOURCE-OF-TRUTH CHECK

Preserve:

- CRO-03A for selected candidate qualification;
- CRO-03 for recipe plan/step/run/observation/candidate/arbitration/mutation/economics lifecycle;
- provider manifest for allowed adapters/callers/capabilities/redaction;
- SafeEgress for public-web network boundary;
- SerperGateway for Serper API/circuit/budget transport authority;
- canonical organization/business identity service and reviewed link rules;
- canonical contact writer for contact creation and local-first mutation;
- canonical vertical resolver for classification projection;
- ZeroBounce validation-intent/readiness authority for final email validity;
- consent/contactability for outreach permission, never enrichment facts;
- CR-04/CRO-05A/CR-06 for final ready/ownership/campaign handoff.

No second provider ledger, crawl queue, contact writer, organization table, validation engine, AI audit or arbitration truth.

## 6. BLAST RADIUS

### In scope

- versioned field-level enrichment recipes and durable step state;
- qualified non-contact source execution;
- internal/registry evidence reuse before external steps;
- first-party public-web discovery/crawl through SafeEgress;
- RDAP and JSON-LD parsing as evidence;
- AI extraction/classification over retained bounded evidence;
- CRO-03 Serper/Outscraper/Apollo adapters with injected transports;
- multi-result organization/person match decisions;
- field-specific arbitration, protected manual authority and review queue;
- canonical business/contact projection and exact provenance;
- generation-bound ZeroBounce intent after winning email projection;
- retirement/adaptation of legacy direct writers and client actions;
- APIs/UI needed to inspect recipe, evidence, conflicts and outcomes without exposing raw PII.

### Out of scope

- live provider or public-internet calls;
- provider credentials/budget enablement and production canary;
- continuous scheduler/backfill ownership;
- division/group/owner assignment;
- campaign/sequence activation, enrollment, GHL mutation or sending;
- social-only scraping or content/advisor sources excluded by manifest;
- using registered-agent/WHOIS registrant data as a default decision-maker.

## 7. DATA / SCHEMA CHECK

Use the next additive migration only if current structures cannot express the recipe. Required persisted behavior:

1. **Immutable recipe/version.** Store ordered/conditional steps, field targets, prerequisites, stop conditions, source policies, timeout/TTL and cost class. Freeze the recipe hash on each membership/item.
2. **Durable step state.** Every item/step records planned, eligible, blocked, running, success, no-result, retry-wait, conflict, superseded or terminal failure with claim/lease/fence and attempt lineage.
3. **Evidence artifacts.** Retain URL/source reference, observed time, content/evidence hash, page type, parser version, bounded redacted excerpt/structured facts and expiry. Do not retain full arbitrary pages or raw provider bodies without a proven requirement and retention policy.
4. **AI evidence.** Record model, prompt/schema version, input evidence hashes, output hash, token/cost usage, confidence and validation errors. AI output remains candidate evidence.
5. **Match decisions.** Persist all Outscraper/Apollo alternatives in masked/redacted form, feature scores, threshold, winning margin, tie/conflict reason and matcher version.
6. **Arbitration.** Persist field policy version, candidate set hash, authority/freshness/confidence factors, protected/manual evidence, winner/no-winner/conflict and reason.
7. **Projection.** Mutation commands point to exact winning evidence, expected generations/current hashes, canonical business/contact IDs and idempotent receipts.
8. **Handoff.** Winning email projection creates exactly one validation intent for that email token hash/generation/purpose.

The recipe must be conditional and stop when requirements are met. Recommended order:

1. frozen source/CRO-03A/Sunbiz evidence;
2. canonical organization identity and aliases/locations;
3. existing first-party website/domain evidence;
4. safe homepage/contact/about/team/location + JSON-LD extraction;
5. RDAP only as corroborating domain evidence;
6. Serper for justified website/phone/identity gaps;
7. Outscraper for unresolved real-world business/location matching;
8. AI structured extraction/classification from already-retained evidence;
9. Apollo only after organization/domain resolution and paid-eligibility handoff;
10. field arbitration and canonical projection;
11. ZeroBounce intent only after the winning email is projected;
12. recompute remaining gaps and stop—never blindly call every provider.

The exact order may be corrected after preflight, but cheap/internal evidence must precede paid person enrichment.

## 8. AUTHORIZATION CHECK

Enforce:

| Action | Agent | Manager | Admin | CRO-03 worker |
|---|---:|---:|---:|---:|
| View masked recipe/evidence/outcomes | scoped | yes | yes | purpose-bound |
| Create bounded recipe run from approved CRO-03A cohort | no | yes | yes | scheduler command only |
| Resolve conflict manually | no | policy-scoped if existing authority permits | yes | no |
| Override protected canonical field | no | no unless existing policy explicitly permits | audited only | no |
| Change/approve recipe version | no | no | yes | no |
| Invoke adapter transport | no | no | no direct call | valid durable context only |

Manual decisions require immutable reason/actor evidence. UI hiding is insufficient. No route may accept caller-supplied worker context, operation ID, claim token, source rank or confidence as authority.

## 9. CONCURRENCY / IDEMPOTENCY CHECK

Prove:

- one item/recipe step/attempt per stable key;
- two workers cannot execute the same step or project the same winner;
- leases/fences are checked immediately before and after transport seam, even though tests inject it;
- crash after reservation, attempt, observation, candidate, arbitration, projection command and canonical write is recoverable;
- `success`, `no_result`, retryable failure, terminal failure and ambiguous billing remain distinct;
- a new source/contact/business generation supersedes stale work;
- an operator edit/manual override wins and prevents stale provider projection;
- route re-evaluation cannot loop or repeatedly spend on the same field within TTL;
- ZeroBounce intent is exactly once for the projected generation;
- batch/item/step/economics counts reconcile after cancellation/restart.

## 10. EXTERNAL SIDE-EFFECT CHECK

All task tests must inject fakes and activate network/provider denial. No deterministic run may reach a real provider or arbitrary host.

Document intended production ordering for CRO-03C:

`qualification → item claim → current commercial fence → operation/reservation → attempt → immediate context/fence check → transport → terminal attempt/observation/receipt/ledger → candidate → arbitration → mutation command → canonical write → generation-bound ZeroBounce intent`.

In this task, the transport seam must remain disabled outside test-only injected fixtures. GHL/outbound/campaign effects remain impossible.

## 11. PREFLIGHT VERDICT

Choose the standard Liberty verdict and continue for build-ready outcomes. Stop if CRO-03A’s handoff is missing or organization/contact authority cannot be resolved safely.

## 12. CORRECTED BUILD PLAN

At minimum:

1. freeze a versioned field-recipe contract from CRO-03A qualification/missing fields;
2. extend the durable factory to non-contact selected source subjects;
3. unify first-party web/RDAP/JSON-LD/Sunbiz evidence under CRO-03;
4. add SafeEgress page policy, per-domain limits, redirect/body/content/robots handling and fixtures;
5. add schema-validated AI extraction with retained evidence spans/hashes and no direct writes;
6. integrate Serper through SerperGateway and the CRO-03 operation context without bypassing its circuit/budget authority;
7. formalize Outscraper multi-result matching and Apollo organization/person policy;
8. implement field-specific arbitration and protected/manual precedence;
9. project through canonical business/contact writers with exact provenance and optimistic generations;
10. create/recover exactly one final-email validation intent;
11. retire or adapt legacy direct enrichment writers/routes/UI so they submit evidence or fail closed;
12. add disposable end-to-end certification and scanners.

## 13. KILL LINES

- KILL LINE: If any provider, crawler or AI path can write a canonical contact/business field without a CRO-03 observation, candidate, arbitration decision and mutation receipt, the task has FAILED.
- KILL LINE: If a non-contact selected source cannot reach canonical business/contact projection through the governed recipe, the task has FAILED.
- STOP if every distinct value is either blindly overwritten or permanently conflicted without field authority logic.
- STOP if Outscraper selects a tied/unanchored result or Apollo searches people without a frozen organization/domain.
- STOP if AI invents facts, selects budgets, grants consent/readiness, or writes canonical fields directly.
- STOP if WHOIS/registered-agent/social-only data becomes the default marketing person.
- STOP if unsafe egress permits private/link-local/metadata hosts, unbounded redirects/bodies/content types or uncontrolled per-domain crawling.
- STOP if ZeroBounce runs before the winning email generation is projected.
- STOP if legacy direct writers remain active outside an explicit governed adapter/allowlist.
- STOP if deterministic tests can reach real network/providers or create outbound/GHL effects.

## 14. IMPLEMENTATION RULES

- Preserve current CRO-03 operations/attempts/receipts/ledger/fences; extend rather than replace.
- Keep provider transport disabled except explicit test-injected seams.
- Use field-specific authority, not one global provider rank.
- Manual/operator and authoritative registry identity cannot be silently overwritten.
- AI extraction schemas must reject unsupported fields and unresolved citations.
- Role inbox, personal email, business phone and person phone remain distinct evidence classes where current schema supports them; add compatible evidence metadata if missing.
- No unbounded fan-out, raw page/provider-body persistence, secrets, PII logs or unrelated refactors.

## 15. TEST REQUIREMENTS

Cover:

- recipe decisions for all important gap combinations and stop conditions;
- source-only subject through business/contact projection;
- existing contact re-enrichment with protected manual values;
- homepage/contact/about/team/location, JSON-LD, RDAP, robots deny, redirect/IP/size/content-type/timeouts and per-domain limits;
- AI valid extraction, missing citation, schema violation, hallucinated field, timeout and token-budget exhaustion;
- Serper gateway disabled/budget/circuit/no-result/success through fake transport;
- Outscraper zero/one/many result, exact anchor, weighted match, tie, below threshold and changed identity;
- Apollo organization exact/ambiguous/no-result and decision-maker title preference/conflict;
- field arbitration agreement, clear authority winner, high-authority conflict, freshness expiry, protected manual override and replay;
- canonical business/contact create/link/update, collision/review and stale generation;
- winning email → mutation applied → item requeued → exactly one ZeroBounce intent;
- crash/recovery at every durable boundary and full batch/economics reconciliation;
- auth/IDOR/privacy and retired endpoint/client scans;
- no deal/campaign/enrollment/GHL/send effect.

## 16. SMOKE / INTEGRATION TEST

Extend `scripts/test-cro03-integration.ts` or add a focused registered suite such as `scripts/test-cro03b-unified-recipe.ts`. It must use disposable PostgreSQL/Redis and injected transports to prove at least these end-to-end fixtures:

1. Sunbiz active merchant → website discovery → public page/AI facts → canonical company/contact → winning email intent;
2. unresolved company → Serper/Outscraper alternatives → deterministic match → projection;
3. resolved organization missing person → Apollo winner → projection → ZeroBounce intent;
4. conflicting business/person/email evidence → review/no unsafe projection;
5. crash/replay and cancellation with exact ledger/receipt reconciliation.

Provider-deny must fail the suite if any real network path is attempted.

## 17. POST-BUILD GREP CHECKS

Prove:

- no active legacy enrichment field writer bypasses CRO-03;
- every allowed external adapter has one manifest-approved caller and injectable transport;
- raw Serper fetch scanner remains clean;
- direct Outscraper/Apollo/OpenAI/public-web call sites are eliminated or explicitly test-only/approved;
- `arbitrateField` or successor uses field policy/version rather than conflict-on-any-distinct or last-write-wins;
- non-contact subjects no longer supersede merely because `contact_id` is null;
- ZeroBounce intent remains after projection;
- no sending/GHL/campaign activation changes occurred.

## 18. REQUIRED GATES

Run migration integrity/replay, CRO-03A dependency suite, all existing CRO-03 suites, Apollo organization resolution, provider-manifest/readiness, Serper gateway/raw-fetch scan, paid-provider adapter scan, SafeEgress/SSRF tests, canonical identity/writer/provenance tests, contact generation/ZeroBounce recovery tests, authorization/IDOR, provider-denial, CI manifest, TypeScript, production build, pre-deploy where feasible and `git diff --check`.

## 19. DIFF REVIEW

Review status/stat/full diff, migrations/journal, provider manifest, approved callers, routes, test registration and generated files. Reject secrets, live payloads, PII fixtures, broad lockfile drift, unrelated formatting, outbound flag mutation or hidden legacy fallback.

## 20. FINAL VFC TABLE

Represent every Done Looks Like item and kill line, including:

| ID | Requirement | Evidence | Test / Gate | Status |
|---|---|---|---|---|
| VFC-F01 | Conditional field-level recipe | ... | ... | PASS / FAIL |
| VFC-F02 | Public web/AI/provider facts are evidence-first | ... | ... | ... |
| VFC-F03 | Deterministic field arbitration | ... | ... | ... |
| VFC-F04 | Source subject → canonical business/contact | ... | ... | ... |
| VFC-F05 | Winning email → ZeroBounce intent | ... | ... | ... |
| VFC-F06 | Provider/network/outbound denial | ... | ... | ... |

## 21. FINAL RESPONSE FORMAT

Return verdict/merge safety, starting/ending SHA, dependency proof, migration head, root cause corrections, recipe and authority table, changed files/lines, migration/schema objects, retired/adapted legacy paths, disposable fixture outcomes, test/gate table, provider-denial proof, diff/grep/kill-line proof, unresolved runtime items and exact CRO-03C activation contract.

## LIBERTY-SPECIFIC SAFETY RULES

- Evidence precedes arbitration; arbitration precedes projection; projection precedes ZeroBounce validation.
- AI is an extractor/classifier with citations, never commercial truth.
- Apollo is organization-bound and reserved for qualified missing-person gaps.
- Outscraper is multi-result business evidence, not an arbitrary crawler.
- Serper finds evidence; it does not authorize identity by itself.
- ZeroBounce validates the final email; it does not find or select it.
- No actual sends, enrollments or GHL mutations.

## PRACTICAL REVIEW STANDARD

Block for wrong-organization/person risk, arbitrary web egress, hallucinated AI facts, last-write-wins, stale projection, duplicate paid step, provider-denial failure or any outbound effect. Do not block because live provider yield is unproven; that proof belongs to CRO-03C.

---

# TASK TO PREFLIGHT + BUILD

## CRO-03B — Unified Crawl Recipe, AI Evidence, Arbitration & Canonical Projection

**Primary correction:** Replace fragmented provider-specific enrichment and the one-provider route with one evidence-first, gap-driven recipe that supports qualified non-contact sources through canonical projection.  
**Dependency:** CRO-03A merged, migrated and green with an immutable selected-cohort handoff.

### What & Why

Liberty has the pieces of enrichment but not one governed recipe. Public web, Sunbiz, Serper, Outscraper, Apollo and AI currently have different callers, evidence behavior and field ownership. The CRO-03 route is too coarse, non-contact source subjects cannot complete the factory, and arbitration/projection do not yet deliver the full source-to-contact workflow.

Build one conditional evidence-first enrichment recipe that consumes CRO-03A candidates, uses the cheapest/most authoritative evidence first, calls paid providers only for remaining justified gaps, resolves conflicts deterministically, creates/updates canonical business and contact records through existing writers, and creates ZeroBounce intent for the final winning email.

### Done Looks Like

- A selected source subject receives a frozen, versioned, gap-driven recipe.
- Public web/RDAP/JSON-LD/Sunbiz/Serper/Outscraper/AI/Apollo all produce retained CRO-03 evidence/candidates.
- Outscraper and Apollo use deterministic organization/person matching with conflicts quarantined.
- AI output is schema-validated, cited and non-authoritative until arbitration.
- Field-specific arbitration protects manual/authoritative evidence and selects a winner only when justified.
- Canonical company/contact projection is idempotent, generation-safe and provenance-complete.
- The final winning email creates exactly one current-generation ZeroBounce intent.
- Legacy bypass writers/actions are retired or routed into CRO-03.
- Disposable provider-denied end-to-end certification passes.
- Live provider transport remains disabled pending CRO-03C.

### Out of Scope

- Real provider/public-internet calls, credentials/budget activation, continuous production scheduling, ownership assignment, campaign enrollment, GHL mutation and sending.

### Proposed Implementation Steps

1. Freeze a versioned conditional recipe from CRO-03A decisions and current field gaps.
2. Extend CRO-03 durable items/steps to qualified non-contact subjects.
3. Convert registry/public-web/RDAP/JSON-LD and AI outputs into retained observations/candidates.
4. Integrate SerperGateway, formalize Outscraper multi-result matching and preserve Apollo frozen-organization resolution.
5. Replace conflict-on-any-distinct arbitration with field-specific authority/freshness/confidence/manual-override decisions.
6. Project business/contact winners through canonical writers and generations.
7. Requeue after projection and create exactly one winning-email ZeroBounce intent.
8. Retire/adapt legacy bypass writers and register disposable provider-denied end-to-end certification.

### Relevant Files and Areas to Verify

- `server/services/cro03/**`
- `server/routes/cro03.ts`
- `server/services/provider-manifest.ts`, `provider-readiness-control.ts`, `serper-gateway.ts`
- `server/services/sdr/apollo.ts`, `outscraper.ts`, `serper-enrichment.ts`, `zerobounce.ts`
- public-web/RDAP/JSON-LD/contact-page and Sunbiz enrichment services
- AI client/audit/classification services
- canonical organization/business/contact/vertical/provenance services
- `shared/schema.ts`, migrations/journal, queue manager/job registry
- CRO-03, SafeEgress, provider-denial, authorization and scanner suites

### Existing Kill Line

KILL LINE: If any enrichment source can bypass CRO-03 evidence/arbitration—or if a selected source cannot become a canonical company/contact and final-email validation intent through the governed recipe—the task has FAILED.

## FINAL DIRECTIVE

Verify CRO-03A, correct stale assumptions, and build the unified recipe now with provider-denied certification. Do not mistake adapters for integration or AI text for evidence.

---

# MASTER REPLIT PROMPT 3 OF 3

# LIBERTY BANCARD — PREFLIGHT + BUILD + AUTHORIZED LIVE ENRICHMENT CANARY MODE

## MODE

PREFLIGHT + BUILD + separately isolated live-enrichment activation. Implement **CRO-03C — Live Enrichment Provider Activation & Governed Production Canary** only after CRO-03A and CRO-03B are merged and all deterministic gates are green.

The owner explicitly authorizes live, bounded enrichment activity for:

- Sunbiz/public-registry ingestion and entity-detail evidence through the approved bounded registry adapter;
- first-party public website crawling through the approved SafeEgress boundary;
- Serper business/search evidence;
- Outscraper Maps/business evidence;
- governed OpenAI-compatible extraction/classification;
- Apollo organization-bound person enrichment;
- ZeroBounce validation of the projected winning email.

This authorization is limited to task-defined canaries and a single bounded initial production enrichment batch. It does **not** authorize campaign enrollment, GHL mutation, email, SMS, RVM, sender activation, lifting global/channel pauses, broad historical backfill, unbounded spend, or use of excluded social/content sources.

Deterministic tests still deny all real provider/network traffic. Live canaries run only as separately labeled operational steps after code, migration, exact-release and outbound-pause gates pass.

Do not replace the compile-time false constant with an environment variable alone; infer enablement from secret presence; bypass provider controls; combine provider activation with send activation; print credentials; hardcode unknown monetary costs; retry ambiguous billed calls; or claim live based on fake transport tests.

## 1. REPOSITORY BASELINE

Capture:

- current branch/HEAD/worktree and merged CRO-03A/03B SHAs;
- migration/journal head and exact deployed web/worker SHA if production activation is attempted;
- current global/channel pause, coordinator and outbound transport state read-only;
- current provider manifest, approved callers, credentials-present booleans, control rows, circuits, budgets/windows, reservations/consumption, recent attempts/observations/receipts and scheduler/queue health;
- Serper-specific control-row state and reconciliation with general provider controls;
- ZeroBounce validation-intent backlog/current budget;
- current CRO-03 transport constant, policy endpoint and canary definitions;
- provider/network test-denial configuration;
- production Redis/queue heartbeat, backlog age, DLQ and exact worker topology;
- read-only eligible CRO-03A cohort counts and CRO-03B dry-run field-gap/cost forecast.

Never return secret values or raw candidate/provider payloads.

## 2. VERIFIED FROM CODE — PREFLIGHT

Return:

| ID | Task Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | CRO-03A/03B dependencies are merged and green | ... | Exact SHAs and gates | ... |
| VFC-02 | Live provider transport is runtime-controlled | ... | Audit compile-time constant and policy API | ... |
| VFC-03 | Provider controls exist for every live recipe source | ... | Rows/capabilities/budgets/circuits | ... |
| VFC-04 | Secret presence enables providers | ... | Must be false; explicit control required | ... |
| VFC-05 | Serper has one reconciled authority | ... | General control plus SerperGateway-specific control | ... |
| VFC-06 | Apollo/Outscraper/Serper/AI/ZeroBounce issue durable operations before I/O | ... | Verify exact ordering | ... |
| VFC-07 | Billing units match provider model | ... | Request/result/token/subscription handling | ... |
| VFC-08 | Live provider canaries are executable and bounded | ... | Current definitions/API/control state | ... |
| VFC-09 | Enrichment can run while outbound remains paused | ... | Prove independent gates | ... |
| VFC-10 | Production runtime is healthy enough for canary | ... | Exact-SHA queue/DB/Redis evidence | ... |

At the drafting baseline, recheck these verified facts:

- `CRO03_PROVIDER_TRANSPORT_ENABLED = false as const` blocked non-ZeroBounce production transport.
- `/api/cro03/policy` returned `liveTransport: false`.
- all CRO-03 canary definitions were `executable: false`.
- static tests required the permanent false posture.
- `provider_controls` existed, but provider seeding/ownership was incomplete and Serper also used a separate `serper_control` singleton.
- provider manifest approved callers did not uniformly identify the CRO-03 factory for Serper/ZeroBounce/AI.
- the enrichment queue already called CRO-03 item/mutation processors, but continuous source selection/scheduling was a later CRO-08A concern.

## 3. REQUIRED SEARCH / GREP CHECKS

Inspect:

- all compile-time/env/runtime provider flags and policy responses;
- `provider_controls`, `provider_operations`, attempts, observations, validation intents, CRO-03 provider runs/ledger/receipts and their constraints;
- `serper_control` and every Serper admin/gateway caller;
- provider manifest source IDs, billing units, approved callers/adapters, retry/timeout/redaction policy;
- every provider URL/client/import and raw fetch scanner;
- CRO-03 worker authorization context creation/validation and immediate pre-I/O checks;
- credentials/config readiness endpoints and UI;
- budget window rollover, reservation settlement, refunds/releases and ambiguous billing;
- circuit state transitions, half-open probe ownership and admin actions;
- canary/batch create/cancel/status/reconciliation APIs and authorization;
- queue workers, schedules, coordinator holds, pause authority and job registry;
- GHL/outbound/enrollment side-effect boundaries;
- all tests that assert providers can never be live and all tests that may accidentally use real credentials.

## 4. VERIFIED ROOT CAUSE

Reconcile:

| Assumption | Verified Reality | Correction |
|---|---|---|
| The durable factory can run live | A compile-time false may make all production provider controls irrelevant | Replace it with one fail-closed runtime activation authority |
| Credentials are sufficient | Secrets prove configuration only | Require explicit enabled control, budget, circuit, recipe, cohort and worker context |
| Every provider shares one budget model | Billing differs by request/result/token/subscription | Meter and reconcile provider-specific units/amounts honestly |
| Serper is already governed | It has a mature gateway but may not share CRO-03 operation lineage | Preserve gateway control and attach it to the CRO-03 run/operation/receipt chain |
| ZeroBounce is part of the same route | It is correctly a generation-bound intent with its own worker | Preserve that owner and link its result back to CRO-03 |
| Enrichment activation requires outbound unpause | These are separate effects | Permit enrichment while proving every send/GHL/enrollment boundary remains paused |

## 5. SOURCE-OF-TRUTH CHECK

Use:

- provider manifest for static capabilities/callers/billing/redaction;
- `provider_controls` as the general mutable paid-provider enable/budget/circuit authority;
- SerperGateway/`serper_control` as Serper’s adapter-specific quota/circuit authority; a CRO-03 Serper call must pass both, not bypass either;
- AI audit plus a compatible provider control/token cap for model spend;
- ZeroBounce validation-intent worker for final email validation;
- CRO-03 operation/run/attempt/observation/receipt/ledger for enrichment lineage;
- CRO-03A selected cohort and CRO-03B recipe for what may run;
- canonical outbound-pause authority for sending prohibition;
- job registry/queue manager for worker activity;
- CRO-08A for later continuous scheduling/backfill scale.

Do not add a parallel secrets page, budget ledger, Serper client, ZeroBounce validator, circuit breaker or scheduler.

## 6. BLAST RADIUS

### In scope

- replacing permanent transport false with fail-closed database-backed runtime activation;
- bounded Sunbiz/public-registry runtime enablement, rate limits and source receipts without treating registry officers as automatic contacts;
- complete provider control rows and manifest/caller reconciliation for Serper, Outscraper, Apollo, AI extraction and ZeroBounce;
- operator readiness, enable/disable, budget/window and canary commands with audit/versioning;
- extending valid CRO-03 worker contexts to every direct live recipe transport that needs them;
- provider-specific unit/cost settlement and ambiguous billing quarantine;
- live micro-canaries, one bounded 100-item maximum initial production enrichment batch and exact-SHA evidence;
- provider health/yield/cost/field/validation reconciliation;
- proof enrichment works while all outreach/GHL mutation remains paused;
- minimal existing Operations/Enrichment UI needed to operate and stop providers.

### Out of scope

- recurring broad discovery/backfill schedules and scale automation owned by CRO-08A;
- more than one initial production batch or more than 100 selected candidates;
- campaign enrollment/activation, GHL writes, email/SMS/RVM;
- raising budgets beyond explicit control values;
- social-only/Apify/Proxycurl activation unless a separately audited task explicitly adds them;
- DNS/sender/pilot outreach work;
- changing CRO-03A qualification or CRO-03B field authority to improve canary numbers.

## 7. DATA / SCHEMA CHECK

Use additive migration(s) only when necessary. Required controls:

- a durable activation revision/command or equivalent audit-backed mutation with idempotency key, provider, previous/new state, budget/window, actor, reason, expected version and receipt;
- provider control rows for each authorized paid provider/capability, seeded **disabled** with no implicit budget;
- explicit daily/window budget units and optional amount micros where cost can be known honestly;
- correct accounting unit per manifest: Serper/ZeroBounce requests, Outscraper results or provider-returned billable unit, AI tokens/operations, Apollo plan-credit/result semantics;
- reservation and exactly one terminal settlement; ambiguous billed/unknown outcomes never auto-retry;
- immutable canary definition/revision with selected cohort hash, recipe/policy versions, max items, per-provider caps, actor, expiry, stop thresholds and results;
- exact linkage from live provider response/receipt reference through operation → attempt → observation → candidate/validation evidence → provider run → ledger/receipt;
- no secrets or raw sensitive response bodies in database/audit/API.

Do not seed providers enabled. Activation occurs through the authorized admin command after readiness and canary gates.

## 8. AUTHORIZATION CHECK

Enforce server-side:

| Action | Agent | Manager | Admin | Worker |
|---|---:|---:|---:|---:|
| View redacted provider health/yield | scoped/read | yes | yes | n/a |
| View budgets/circuits without secrets | no | read-only | yes | n/a |
| Enable/disable provider or change budget | no | no | reasoned audited mutation | no |
| Start live canary/initial batch | no | no | admin + idempotency + approved definition | execute claimed command only |
| Cancel batch/open circuit | no | no | yes | automatic stop policy |
| Invoke provider directly | no | no | no | current durable context only |

No browser-supplied `enabled`, caller, worker context, claim token, cost, confidence or result is trusted. Emergency disable must be atomic, audited and immediately prevent new reservations.

## 9. CONCURRENCY / IDEMPOTENCY CHECK

Prove:

- optimistic/versioned activation mutations and replay-safe idempotency;
- simultaneous enable/budget/canary commands cannot oversubscribe or duplicate;
- reservations are atomic across web/worker replicas;
- provider/unit budget cannot go negative or exceed cap under concurrency;
- disable/cancel/lease loss between reservation and I/O prevents dispatch and releases unspent units;
- a dispatch timeout becomes ambiguous, opens/quarantines as policy requires, and is not auto-retried;
- provider result callbacks/retries settle once;
- stale source/contact/business generations supersede projection;
- ZeroBounce validates only the current winning email generation;
- canary/item/provider/economics totals reconcile after crash/restart.

## 10. EXTERNAL SIDE-EFFECT CHECK

Separate deterministic certification from authorized live operations.

### Deterministic build gates

- provider/network denial enabled;
- injected transports only;
- disposable DB/Redis;
- no credentials needed or read;
- no production state mutation.

### Authorized live canary gates

Before any real call, require:

1. exact deployed web/worker SHA equals the certified SHA;
2. migration head matches;
3. CRO-03A/03B gates are green;
4. `outboundGlobalPaused=true` and every send/GHL/enrollment gate is healthy;
5. provider secret-present boolean true, control enabled intentionally, circuit closed and non-null bounded budget;
6. queue/Redis/database heartbeat healthy and backlog/DLQ within threshold;
7. immutable canary cohort/recipe hash frozen;
8. admin activation/canary receipt committed before dispatch.

After live calls, prove no `outbound_messages`, sequence enrollments, GHL mutations, email/SMS/RVM transport attempts or pause changes occurred.

## 11. PREFLIGHT VERDICT

Use the standard verdict. Distinguish:

- **code/build merge verdict**;
- **deployment/exact-SHA verdict**;
- **provider readiness verdict per provider**;
- **live canary verdict per provider**;
- **bounded initial-batch verdict**;
- **outreach verdict**, which must remain `PAUSED / NOT AUTHORIZED`.

Do not mark the task fully live if credentials, budgets, deployed SHA or canary evidence are missing.

## 12. CORRECTED BUILD AND ACTIVATION PLAN

### Phase 1 — build under provider denial

1. replace compile-time false with fail-closed runtime activation authority;
2. seed/reconcile disabled controls and approved manifest callers;
3. extend worker context/operation lineage to Serper and AI where required while preserving SerperGateway and ZeroBounce owners;
4. implement audited admin control/canary/status APIs and minimal existing-console UI;
5. implement provider-specific metering, settlement, circuit/stop and reconciliation;
6. update static tests so they require fail-closed controls—not permanent impossibility of activation;
7. pass all disposable deterministic gates.

### Phase 2 — deploy and read-only readiness

1. deploy only the certified SHA through the normal release process;
2. verify SHA, migration, queue topology, pause, provider-secret booleans and control state;
3. freeze a CRO-03A-qualified/CRO-03B-dry-run canary cohort.

### Phase 3 — live micro-canaries

Maximum initial micro-canary scope unless a lower configured budget applies:

| Source/provider | Maximum |
|---|---:|
| Sunbiz/public registry | 10 entity-detail evidence fetches or the lower configured batch cap |
| First-party web | 10 approved business domains, bounded pages only |
| Serper | 10 requests |
| Outscraper | 5 queries, maximum 5 returned candidates considered per query |
| AI extraction | 10 extraction operations under explicit token cap |
| Apollo | 5 frozen organization resolutions, bounded person results |
| ZeroBounce | 10 projected winning emails |

Run providers in recipe order, not as a fan-out. A candidate stops when required fields are satisfied.

### Phase 4 — bounded initial production enrichment batch

Only after every applicable micro-canary passes, allow one immutable batch of at most 100 CRO-03A-selected candidates under configured daily/provider budgets. Do not schedule the next batch automatically; CRO-08A owns continuous schedules/backfills.

## 13. KILL LINES

- KILL LINE: If any live enrichment call can occur because a secret exists, an environment flag is true, or an admin clicked a legacy test endpoint without a durable enabled control, budget, operation, reservation, worker context and canary/batch authority, the task has FAILED.
- KILL LINE: If activating enrichment changes outbound pause, enrolls a contact, mutates GHL or sends any message, the task has FAILED.
- STOP on exact-SHA/migration mismatch, stale queue heartbeat, unhealthy Redis/DB, unreadable pause authority or missing credential/control.
- STOP on any wrong-organization/person projection, protected-field overwrite, duplicate spend, budget overrun, missing receipt/ledger lineage, secret/PII leak or outbound effect.
- STOP provider on authentication/authorization failure, circuit open, unexpected billing unit, ambiguous billed timeout, malformed response above threshold or configured cap exhaustion.
- STOP a canary on two consecutive provider failures or zero useful field yield after the provider’s entire micro-cap; return evidence for policy review instead of broadening queries.
- STOP if Outscraper/Apollo ties/low-confidence matches are projected.
- STOP if AI output lacks retained evidence/citations or exceeds token cap.
- STOP if ZeroBounce evidence is not tied to current email hash/generation.
- STOP if deterministic CI can reach real providers.

## 14. IMPLEMENTATION RULES

- Fail closed on missing/unreadable/malformed control state.
- Secret presence is readiness evidence only.
- Provider enablement and budget changes are explicit, versioned, reasoned admin mutations.
- Outbound pause remains true and independent.
- Preserve SerperGateway and ZeroBounce canonical owners.
- No automatic retry after an ambiguous potentially billed call.
- Redact request/response bodies, headers, keys, full emails/phones/person names from logs and general status APIs.
- Do not hardcode permanent budgets from this prompt; configured caps may be lower and always win.
- Do not enable Apify, Proxycurl, social-only sources or GHL.

## 15. TEST REQUIREMENTS

Deterministic tests must cover:

- disabled/missing/malformed controls and no-key behavior;
- explicit admin enable/disable/budget mutation authorization, audit, replay and optimistic conflict;
- concurrent budget reservations and cap exhaustion;
- immediate pre-I/O authority/fence revocation;
- provider success/no-result/rate limit/auth error/timeout/parse error/circuit/ambiguous billing;
- request/result/token settlement and exact ledger/receipt reconciliation;
- Serper dual-authority behavior;
- Apollo/Outscraper/AI/ZeroBounce approved caller/context rejection;
- canary size/provider cap/expiry/cohort hash and cancellation;
- global outbound pause remains true and send/GHL/enrollment attempts remain zero;
- restart/recovery and exact terminal receipts;
- redacted admin/UI/API responses and IDOR;
- production transport impossible in `NODE_ENV=test` even with real-looking secrets.

## 16. LIVE SMOKE / INTEGRATION TEST

Create a two-mode suite/command:

1. default deterministic provider-denied certification owned by CI;
2. explicit production canary command requiring exact environment, admin authorization receipt, immutable canary ID and maximum caps.

The live command must refuse `--all`, arbitrary IDs, wildcard cohorts, missing caps, wrong SHA, unpaused outbound, unknown control state or a non-production/cross-environment target. It must print only IDs, counts, normalized outcomes, masked evidence and unit/cost totals.

Capture per provider:

- eligible, attempted, blocked, succeeded, no-result, conflicted, failed and superseded counts;
- fields/candidates found and projected;
- validation outcomes;
- requested/reserved/consumed/released/ambiguous units and known cost;
- latency and retry/circuit results;
- zero outbound/GHL/enrollment effect proof.

## 17. POST-BUILD GREP CHECKS

Prove:

- permanent `CRO03_PROVIDER_TRANSPORT_ENABLED = false as const` and hardcoded `liveTransport: false` are replaced by fail-closed runtime truth;
- tests no longer require permanent disablement, but still require default denial;
- no provider URL/client gained a new unauthorized caller;
- no secret-presence or env-only enablement exists;
- all live transports are immediately adjacent to current worker context/fence checks;
- Serper raw-fetch and paid-provider adapter scans remain clean;
- no outbound/GHL/enrollment/send flag or caller changed;
- canary/batch limits cannot be bypassed from UI/API.

## 18. REQUIRED GATES

Before live activity run migration integrity/replay, CRO-03A/03B suites, all CRO-03 durability/recovery/auth/static suites, provider manifest/readiness, Serper gateway/admin/cooldown/raw-fetch scan, paid-provider adapter scan, ZeroBounce campaign/intent recovery, SafeEgress, provider-denial, outbound pause/compliance/GHL boundary, CI manifest, TypeScript, production build, release artifact gate, pre-deploy and `git diff --check`.

After deployment, record exact-SHA/migration/queue/pause/provider readiness and then the bounded live canary results. A fake test cannot replace live evidence; a live call cannot replace deterministic gates.

## 19. DIFF REVIEW

Review all code, migration, manifest, UI/API, test registration and operational scripts. Confirm no credentials, payloads, PII, broad environment files, production budget values, lockfile drift, unrelated cleanup or sending changes.

## 20. FINAL VFC TABLE

Include every requirement/kill line and separate statuses:

| ID | Requirement | Code Evidence | Deterministic Gate | Live Evidence | Status |
|---|---|---|---|---|---|
| VFC-F01 | Runtime provider authority replaces permanent false | ... | ... | readiness | PASS / FAIL / PENDING |
| VFC-F02 | Every call has operation/reservation/context/receipt | ... | ... | canary | ... |
| VFC-F03 | Provider budgets/circuits reconcile | ... | ... | canary | ... |
| VFC-F04 | All six enrichment stages connect in recipe order | ... | ... | canary/batch | ... |
| VFC-F05 | Outbound/GHL/enrollment remain paused and zero-effect | ... | ... | before/after counts | ... |

## 21. FINAL RESPONSE FORMAT

Return:

1. build, deploy, provider-by-provider canary, initial-batch and outreach verdicts;
2. starting/ending/deployed SHA and migration head;
3. control/manifest/caller authority map;
4. exact provider caps used—never keys;
5. changed files/lines and schema objects;
6. deterministic gate table and provider-denial proof;
7. exact-SHA runtime readiness table;
8. live canary/batch funnel, yield, cost/unit and error results;
9. ledger/receipt/budget reconciliation;
10. before/after outbound pause plus zero enrollment/GHL/send proof;
11. automatic stops triggered and remaining provider/runtime risks;
12. SAFE TO MERGE / SAFE TO DEPLOY / LIVE ENRICHMENT ACTIVE verdicts separately;
13. explicit handoff to CRO-05A and CRO-08A.

## LIBERTY-SPECIFIC SAFETY RULES

- Live enrichment is authorized; live outreach is not.
- Provider credentials never grant authority by themselves.
- Provider calls require durable spend/effect ownership before I/O.
- No ambiguous billed call is auto-retried.
- ZeroBounce validates only the final current-generation email.
- GHL remains an external projection and must not be mutated by this task.
- Continuous scheduling and broad backfill remain CRO-08A.
- No `db push`, production cleanup or historical evidence rewriting.

## PRACTICAL REVIEW STANDARD

Block for unbounded spend, env-only activation, wrong subject projection, stale context, missing receipt/ledger lineage, provider-denial regression, secret/PII leakage, false live claims or any outbound effect. Do not preserve permanent compile-time disablement merely because it was previously a safety boundary; replace it with durable, explicit, observable runtime authority.

---

# TASK TO PREFLIGHT + BUILD

## CRO-03C — Live Enrichment Provider Activation & Governed Production Canary

**Primary correction:** Replace permanent compile-time provider disablement with explicit durable runtime authority and prove the complete recipe through bounded live production evidence.  
**Dependencies:** CRO-03A and CRO-03B merged and deployed at an exact certified SHA; provider credentials, explicit bounded budgets and healthy DB/Redis/queue/pause authority.

### What & Why

CRO-03’s durable factory and CRO-03B’s recipe cannot deliver production enrichment while transport is permanently disabled and provider controls/callers/canaries are incomplete. Liberty needs real public-web, Serper, Outscraper, AI, Apollo and ZeroBounce execution now, while actual outreach remains paused.

Replace permanent transport disablement with explicit database-backed provider authority, activate bounded provider canaries, prove the entire recipe on real selected candidates, and run one maximum-100-candidate production enrichment batch. Preserve every CRO-03 reservation, fence, evidence, arbitration, projection and ZeroBounce-generation guarantee.

### Done Looks Like

- Every authorized enrichment provider has a complete manifest, control, credential-readiness, budget, circuit, operation and settlement path.
- Production transport is fail-closed by runtime authority rather than compile-time impossible.
- Enrichment activation is independent of the global outbound pause.
- Deterministic tests remain provider-denied.
- Exact-release live micro-canaries pass within immutable caps.
- One bounded initial batch completes/reconciles and yields canonical companies/contacts plus current ZeroBounce evidence where emails exist.
- Costs/units, outcomes, yield, conflicts and failures are visible and reconciled.
- No campaign enrollment, GHL mutation or message send occurs; global outbound pause remains true.

### Out of Scope

- Continuous broad scheduling/backfills, more than the single bounded initial batch, Apify/Proxycurl/social-source activation, campaign enrollment, GHL mutation, sender activation and all message delivery.

### Proposed Implementation Steps

1. Replace permanent transport false with fail-closed database-backed activation and audited admin commands.
2. Reconcile provider manifest callers, general controls, SerperGateway control and ZeroBounce/AI ownership.
3. Implement provider-specific reservation, metering, settlement, circuit and canary controls.
4. Update deterministic tests to require default denial while permitting explicitly authorized production execution.
5. Deploy the exact green SHA and verify migration, pause and worker/queue health.
6. Run the capped Sunbiz, public-web, Serper, Outscraper, AI, Apollo and ZeroBounce micro-canaries in recipe order.
7. If all applicable canaries pass, run one frozen maximum-100-candidate production enrichment batch.
8. Reconcile yield/cost/evidence/projection and prove zero outbound/GHL/enrollment effects.

### Relevant Files and Areas to Verify

- `server/services/cro03/enrichment-factory.ts`, `provider-context.ts`, `routing-policy.ts`, contracts and receipts/ledger code
- `server/routes/cro03.ts`
- `server/services/provider-manifest.ts`, `provider-readiness-control.ts`, `serper-gateway.ts`
- Serper, Outscraper, Apollo, ZeroBounce and AI adapters
- queue manager, job registry, coordinator and outbound-pause authority
- Operations/Enrichment admin UI and authorization policies
- `shared/schema.ts`, next migration and journal
- CI suite manifest, pre-deploy, provider-deny, paid-adapter/raw-fetch, CRO-03 and outbound/GHL safety suites

### Existing Kill Line

KILL LINE: If live enrichment can bypass explicit durable provider authority—or if enabling it causes any enrollment, GHL mutation, message transport or outbound-pause change—the task has FAILED.

## FINAL DIRECTIVE

Build under provider denial, deploy the exact certified release, then execute only the authorized bounded live canaries and one initial batch. Return honest provider-by-provider runtime evidence. Do not call fake success “live,” and do not use live enrichment authorization as outreach authorization.
