# Task #1998 — Live-Repository Audit and Required Corrections

**Task:** Canonical South Florida Cohort Foundation  
**Repository baseline audited:** `origin/main` at `6a0bd39a8ad8a9285bf5cb5bb1e5d0b93968de6a`  
**Audit date:** 2026-09-23  
**Audit type:** pre-build, repository-backed plan correction  
**Implementation status:** no Task #1998 implementation was present or changed during this audit

## Executive verdict

Task #1998 is the correct first build task in the five-task sequence, but it is **not ready to implement exactly as written**.

Its two central diagnoses are confirmed:

1. `roi-cohort-selector.ts` loads only target-county `business_locations` rows before geography resolution, so a known non-target location can be mislabeled `geography_unresolved`.
2. The selector compares raw `businesses.vertical` strings directly to five narrow labels, so valid broad/fine taxonomy evidence is rejected.

However, the task also contains two stale/false claims and omits several correctness requirements that can produce another misleading or non-replayable cohort:

- SFP is **already independent** of MI-09/Level 1; there is no Level-1 hard precondition to remove.
- Normal SFP selection does **not** presently score unresolved geography or unresolved vertical rows; that defect statement is inaccurate. The real scoring defect is that `active`/`unvalidated` email states receive positive validation/readiness value even though they are not `provider_valid`.
- `GET /api/lead-ops/sfp/program` mutates state, and funnel preview is incorrectly blocked until the program is active.
- The freeze path is not transactional, does not use a stable complete input fingerprint, returns a zeroed funnel on idempotent replay, can reopen prior rows, and stores only selected members—not one terminal decision per scanned business.
- The UI generates a new timestamp idempotency key for every click while claiming the action is replay-idempotent.
- The HTTP/UI cohort cap is 500 even though this task requires a program cap of 100.
- The current DBPR query does not use the canonical `canonical_source_links` predicate.
- The existing structural SFP suite passes, but it does not execute the geography, vertical, funnel, freeze, transaction, concurrency, or replay behavior required by this task.

**Build verdict: PROCEED ONLY AFTER applying every correction below to the Task #1998 plan.** Preserve the five-task split. Do not pull Task #1999–#2002 provider, discovery, validation, source-materialization, campaign, or outreach work into this task.

---

# Exact directive to send to Replit

Use the remainder of this file as the authoritative correction addendum for Task #1998. It supersedes conflicting language in the proposed task while preserving every non-conflicting requirement.

## 1. Preflight and baseline authority

Before editing:

1. Fetch and pin the actual current `origin/main`; report the full SHA. The audit baseline was `6a0bd39a8ad8a9285bf5cb5bb1e5d0b93968de6a`, but do not assume it is still current.
2. Confirm the prior five-task dependency split still exists conceptually:
   - #1998: canonical SFP cohort foundation;
   - #1999: unified discovery/candidate evidence and provider waterfall;
   - #2000: validation/outreach eligibility;
   - #2001: campaign/sequence staging and recurring operations;
   - #2002: full source-universe expansion.
3. Re-audit the listed files against the pinned SHA before implementation. If any repository fact below has changed, adapt the implementation and document the delta; do not silently follow stale line numbers.
4. Use a clean worktree. Preserve unrelated user changes.
5. Do not call any live provider, send outreach, activate recurrence, mutate production data, or publish as part of implementation or testing.

## 2. Correct the task's stale statements

Replace the task's defect statements 4 and 6 with the following:

### Replacement defect 4 — email/ROI semantics are overstated

Normal SFP selection currently excludes unresolved geography unless `includeGeographyUnresolved` is explicitly enabled, and it excludes raw vertical mismatches before scoring. The defect is **not** that the normal SFP path scores unresolved geography/vertical rows. The real defect is that ROI dimensions award positive `emailSourceConfidence` and `validationState` to `active` and `unvalidated` contact statuses. Those states are not `provider_valid` and must not be scored as validation proof.

### Replacement defect 6 — SFP entry is already independent

SFP already states and implements independence from MI-09 pilot runs, Level-1 handoffs, and `master_leads`. Preserve that independence with regression tests. Do not create a fake “remove Level 1 gate” code change and do not modify CRO-03A/MI-09 merely to satisfy stale task language.

## 3. Give SFP its own versioned configuration authority

The task currently says `system_settings.cro03c_roi_pilot_verticals` remains the configuration source. That conflicts with the requirement that SFP be an independent subsystem.

Implement these rules:

1. `sfp_programs` is the SFP program authority for target counties, stable target vertical IDs, program cap, and policy version.
2. Use stable target IDs—`med_spa`, `dental`, `auto_repair`, `restaurant`, `retail`—with separate display labels. Do not use mutable labels as identity.
3. Add a versioned, reviewable SFP classifier policy artifact/table containing aliases, positive rules, negative rules, confidence thresholds, and policy version.
4. Existing `system_settings.cro03c_roi_pilot_verticals` may be read **once only as a backward-compatible initializer** if needed. It must not remain the runtime SFP authority and must never silently overwrite an existing SFP program on a read request.
5. A frozen run must retain the exact program policy/config snapshot and versions it used.
6. Do not activate CRO-03A policy v2 and do not change CRO-03A's own policy engine.

## 4. Make read endpoints genuinely read-only

Current behavior is unsafe and misleading:

- `GET /api/lead-ops/sfp/program` calls `ensureProgram()`;
- `ensureProgram()` updates county, vertical, and policy fields for an existing program;
- `previewFunnel()` calls `ensureProgram()` and rejects preview when the program is inactive.

Correct this boundary:

1. Add a read-only `getProgram()` path. `GET /api/lead-ops/sfp/program` must perform no insert/update.
2. Keep program creation/config convergence behind explicit admin POST endpoints with audit receipts.
3. Funnel preview must work while the program is inactive. Preview performs no provider call and should not require paid-stage activation.
4. Cohort freeze is an explicit admin mutation, but it must not implicitly activate the program or recurring work.
5. Provider/discovery/validation stages may continue to require separate activation/authority in their owning tasks.
6. Add route-level tests proving all GET endpoints are mutation-free.

## 5. Use the canonical eligible universe and canonical DBPR predicate

1. Scan only `businesses.record_class = 'canonical'` for this task.
2. Replace the selector's ad hoc DBPR contact/source-event query with `businessLacksDbprLineageSql()` or `businessHasDbprLineageSql()` from `server/services/dbpr.ts`, which uses `canonical_source_links` and excludes any DBPR-family lineage.
3. Preserve explicit exclusions for existing customers, suppression/opt-out/complaint, hard-bounce/invalid-only, terminal inactive entities, and test/demo/internal records.
4. Do not assume those exclusion counters also constitute geography or vertical counters. Policy exclusions are terminal dispositions in the decision ledger described below.
5. Do not hardcode the historical 6,471/257/6,209 counts. Recompute environment-labeled counts when production verification is eventually run.

## 6. Implement deterministic all-location geography resolution

Create a pure, versioned SFP business-location resolver and use it from the selector.

### Required evidence evaluation

1. Load **all** `business_locations` rows for each scanned business, including target FIPS, non-target FIPS, null FIPS, ZIP/city-only, and conflicting rows.
2. Evaluate each location using the existing versioned South Florida geography reference, with authority order:
   - direct county FIPS;
   - ZIP inference;
   - city inference;
   - unresolved.
3. Use the primary `businesses` address only as a documented fallback evidence record; it must not erase stronger location evidence.
4. Persist the geography reference version used.

### Required business-level rollup

- If any location resolves inside the three configured counties, the business is inside SFP. Choose the qualifying location deterministically by evidence authority, primary-location flag, then lowest location ID. Preserve that location ID and note multi-location evidence.
- A business with both inside and outside locations remains eligible through the chosen inside location; it is not a conflict merely because it is multi-location.
- If no location is inside and any same-location evidence is contradictory/ambiguous, classify `geography_conflicting`.
- Classify `geography_outside` only when at least one location is authoritatively outside and every other location is also resolved outside. An outside row plus an unresolved row remains unresolved, because an unclassified SFP location may still exist.
- Otherwise classify `geography_unresolved`.

When geography comes only from the primary `businesses` fallback, allow a nullable `business_location_id` only if the immutable decision row stores `location_source='business_primary'` and a normalized evidence snapshot/hash. Do not invent a location ID.

## 7. Build a separate five-target SFP classifier

Do not solve this with raw equality and do not blindly reuse the coarse canonical resolver as the final SFP classifier. The existing canonical resolver intentionally collapses `Med Spa` and `Dental` into `Healthcare`, and `Auto Repair` into `Auto`; it cannot by itself distinguish the five requested campaign targets.

Implement a pure, versioned SFP resolver with terminal outcomes:

- `resolved_high`
- `resolved_medium`
- `review_required`
- `not_target`
- `unresolved`

Required inputs for Task #1998 are limited to evidence already durably present at this boundary: business vertical/subvertical, industry fields, canonical name, source category/lineage metadata, and other persisted non-provider business evidence.

Important scope correction: the current free-discovery candidate schema persists encrypted email candidates and limited attribution metadata; it does **not** persist reusable homepage/services/about-page text. Therefore Task #1998 must not claim that it classifies from free-crawl page content unless such evidence is already durably present on the pinned baseline. Capturing page bundles and governed OpenAI fallback belongs to Task #1999.

Classifier rules must include:

1. Exact target labels as high-confidence evidence.
2. Versioned positive aliases/keywords for all five targets.
3. Explicit negative evidence so broad labels are not over-promoted:
   - `Healthcare` alone is not automatically Dental;
   - `Salon/Spa` alone is not automatically Med Spa;
   - `Auto` alone must distinguish repair/service from dealer, rental, wash/detailing, etc.;
   - `Food/Beverage` must distinguish restaurants from wholesale/manufacturing;
   - `Retail` must exclude clearly non-retail or marketplace-only evidence where applicable.
4. Broad/ambiguous evidence yields `review_required` or `unresolved`, never a fabricated target.
5. Persist target ID, classifier outcome, confidence, classifier version, reason codes, and an evidence hash/reference.

## 8. Add a one-row-per-business decision ledger and truthful funnel

`sfp_cohort_members` should remain selected members only. Do not put excluded businesses into that table.

Add an immutable `sfp_cohort_decisions` (or equivalently named) table with exactly one row per `(cohort_run_id, business_id)`. Every scanned canonical business receives one terminal disposition from this ordered taxonomy:

1. `excluded_dbpr`
2. `excluded_existing_customer`
3. `excluded_suppressed`
4. `excluded_bounced_invalid_only`
5. `excluded_inactive_entity`
6. `excluded_test_demo_internal`
7. `geography_outside`
8. `geography_conflicting`
9. `geography_unresolved`
10. `vertical_not_target`
11. `vertical_review_required`
12. `vertical_unresolved`
13. `eligible_not_selected_cohort_cap`
14. `selected_frozen`

The terminal identity is:

`sum(all terminal disposition counts) = total scanned canonical businesses`

Keep stage metrics such as `southFlorida` and `inTargetVertical` separately. They are useful but overlap and must never be added to terminal exclusions in a fake reconciliation formula. The original task formula `inside + outside + conflicting + unresolved + excluded = total` is acceptable only if `inside` and `excluded` are mutually exclusive terminal categories; the implementation above is less ambiguous and is authoritative.

Persist and return both:

- terminal disposition counts, which reconcile exactly;
- non-terminal stage metrics, clearly labeled as overlapping funnel stages.

## 9. Correct ROI scoring semantics and persistence

1. Score only businesses that resolved inside SFP and resolved to a target vertical. `review_required`, `not_target`, unresolved, and policy-excluded rows are not scored into the selectable cohort.
2. Correct email scoring:
   - `active` is not `provider_valid`;
   - `unvalidated` is not validation proof;
   - neither state receives positive `validationState` credit;
   - only a fresh, provenance-backed provider-valid result may receive provider-validation credit;
   - email validation never implies consent or outreach authorization.
3. Preserve all 13 score dimensions, score version, classifier version, geography version, and program policy version on the run-scoped decision/member evidence.
4. Replace score-only ordering with a stable total ordering: `roi_score DESC, canonical_business_id ASC` (plus `business_location_id ASC` if selection can contain location-level ties).
5. Do not rely on `cro03c_roi_candidate_scores ... ON CONFLICT DO NOTHING` as written: that table has no conflict key covering these inserts, so repeated runs append duplicates. Either make scores explicitly run-scoped with a uniqueness contract or persist the authoritative score only in the run decision/member snapshot.
6. Do not swallow authoritative score-persistence errors as warnings. A freeze must fail atomically if its evidence cannot be persisted.

## 10. Make cohort freeze actually transactional and replay-safe

Implement freeze under a database transaction with a consistent snapshot and keyset pagination (or an equivalent frozen source-ID snapshot). Do not use mutable `OFFSET` pagination across a live table for a deterministic freeze.

Required freeze semantics:

1. Enforce `1..100` for the program cohort in service, HTTP route, schema/config, and UI.
2. Record `selection_rank` for every selected member.
3. Freeze the program config, target IDs, geography version, classifier policy/version, ROI score version, exclusion policy version, source high-water/snapshot identity, and request payload hash on the run.
4. Compute `cohort_hash` from a canonical serialization of the full immutable member manifest—not only business IDs. Include at least business ID, qualifying location ID/source, county FIPS, target vertical ID, classifier evidence hash/confidence/version, ROI score/dimensions/version, selection rank, and policy versions.
5. Scope idempotency to program + idempotency key. Store a request hash. The same key and same payload returns the original stored run, members, and funnel. The same key with a different payload returns a deterministic 409 idempotency-payload-mismatch error.
6. A replay must return the persisted funnel/decision snapshot, not a synthetic all-zero funnel.
7. Do not use an upsert that reopens a previously failed/frozen row by setting it back to `freezing`.
8. Insert the run, all decisions, all members, funnel snapshot, and final frozen state atomically. A failure leaves no partial frozen cohort.
9. Concurrent calls with the same key create exactly one run and one member/decision set.

### Replace “unfreeze” with immutable cancellation/supersession

Do not delete or rewrite a frozen cohort. Replace the task's “freeze/unfreeze” language with `freeze`, `void`, and `supersede`:

- `void` prevents future stage admission and records actor, timestamp, and reason;
- `supersede` points to a newly frozen run;
- prior members, decisions, hashes, provider operations, and audit history remain immutable;
- downstream services reject voided/superseded runs for new work without erasing completed history.

This is necessary because Tasks #1999–#2001 attach provider spend, validation, and staging evidence to `cohort_run_id`.

## 11. Represent the 25-record paid canary without activating providers

Task #1998 must prepare—but not execute—the downstream canary boundary:

1. Persist a deterministic canary designation for at most the first 25 ranked selected members, or expose an immutable derivation from `selection_rank <= 25` in the frozen contract.
2. Store the configured canary cap in the run snapshot; hard maximum is 25.
3. Do not call Serper, Outscraper, Apollo, OpenAI, ZeroBounce, GHL, campaigns, sequences, or outreach.
4. Task #1999 consumes the canary/cohort contract and owns provider execution.

## 12. Fix the Lead Ops operator flow

Update `SouthFloridaProspectingPanel.tsx` and routes so:

1. Program read and funnel preview work while inactive.
2. Initialization/configuration is an explicit mutation.
3. Program cohort input is capped at 100 everywhere, not 500.
4. Freeze uses a stable client-generated operation key retained across retries. `Date.now()` on every mutation invocation is not a replay key.
5. A retry of the same logical freeze reuses the same key; a deliberate new freeze creates a new key.
6. The UI displays the request/config fingerprint, run policy versions, cohort hash, selected count, canary count, and exact terminal reconciliation.
7. Stage metrics are visually separated from terminal disposition counts so overlapping numbers are not presented as additive.
8. The operator can void/supersede a frozen run through an explicit confirmation flow, never “unfreeze” it in place.
9. Every mutation returns an audit receipt/correlation ID and refreshes authoritative server state.
10. No button in this task starts a provider call, background recurrence, validation, campaign staging, enrollment, or send.

## 13. Required additive schema changes

Use the next available migration number after the current head on the pinned baseline, and mirror the changes in `shared/schema.ts` because deployment uses the Drizzle schema as well as the journaled migrations.

At minimum, the schema must be able to represent:

- immutable run request/config/input hashes and all policy/reference versions;
- run lifecycle fields for frozen/voided/superseded with actor/reason/timestamps;
- run-scoped one-row-per-business decisions;
- qualifying `business_location_id` when present;
- geography source/class/reference version and evidence snapshot/hash;
- stable target vertical ID, classifier outcome/confidence/version/reason/evidence hash;
- ROI dimensions and score version;
- selection rank and canary designation/cap;
- program-scoped idempotency + request-hash mismatch detection.

Add foreign keys to `businesses` and `business_locations` where possible, explicit check constraints/enums for state/disposition fields, and indexes for run/disposition/rank queries. Migrations must be additive and rollback-safe; do not rewrite historical 0277/0278 files.

## 14. Required deterministic and integration tests

The current `scripts/test-sfp-pipeline-correction.mjs` suite is structural source scanning. It passed 21 assertions on the audited baseline, but that is not behavioral proof for Task #1998.

Keep the useful structural checks and add real tests registered in `scripts/ci-suite-manifest.ts`:

### Pure fixture tests

- direct target FIPS, direct non-target FIPS, ZIP inference, city inference, unknown, and ambiguous geography;
- all-location rollup, including inside+outside, outside-only, outside+unresolved, conflicting evidence, and business-primary fallback;
- deterministic qualifying-location selection;
- all five exact target labels;
- positive aliases and required negative exclusions for all five targets;
- broad `Healthcare`, `Salon/Spa`, `Auto`, and `Food/Beverage` evidence never over-classifies without target-specific proof;
- every classifier terminal outcome;
- stable score ordering/tie breaker;
- `active` and `unvalidated` email states produce zero provider-validation credit.

### Disposable-database integration tests

- canonical DBPR lineage exclusion through `canonical_source_links`, including mixed DBPR + non-DBPR lineage;
- one terminal decision per scanned business and exact reconciliation;
- preview GETs cause zero writes;
- preview works while the program is inactive;
- route/service/UI bounds reject 0, 101, 500, fractions, NaN, and malformed values;
- successful freeze writes run, decisions, members, funnel, versions, and hashes atomically;
- injected mid-freeze failure rolls the entire freeze back;
- same key + same payload replays the stored result and stored funnel;
- same key + different payload returns 409 mismatch;
- concurrent same-key calls produce one run and no duplicate decisions/members;
- changed evidence/config produces a new input/cohort hash with a new operation key;
- void/supersede is append-only and blocks new downstream admission;
- no MI-09/Level-1/master-leads prerequisite;
- no provider, GHL, campaign, sequence, or outreach transport is invoked.

### Required checks

- `npx tsc --noEmit`
- `npx tsx scripts/ci-suite-manifest.ts --check`
- `npx tsx scripts/check-migration-integrity.ts`
- existing SFP structural suite
- new pure Task #1998 suite
- new disposable-DB Task #1998 suite
- existing CRO-03A geography/static suites unchanged and green
- API coverage and role-guard suites

Do not call a test “integration” if it only searches source text. Use fake transports and an isolated disposable database; no live provider credentials or production database writes.

## 15. Production proof must be separated from build completion

The original task simultaneously requires production-verified before/after counts and says not to publish. Replit cannot truthfully provide post-deploy production proof before operator publication.

Use a two-stage completion contract:

### Build completion report

Before publish, report:

- pinned base SHA and implementation commit SHA;
- migration head and integrity result;
- files changed;
- every deterministic/disposable test result;
- fixture funnel reconciliation;
- fixture freeze hash/replay/concurrency/rollback proof;
- explicit zero live-provider calls and zero outreach;
- status: `READY FOR OPERATOR PUBLISH — PRODUCTION VERIFICATION REQUIRED`.

### Post-publish production verification

Only after the operator publishes:

1. Capture environment identity, deployment/release identity, migration head, and SFP policy versions.
2. Run read-only funnel preview while the program remains provider-inactive.
3. Report live terminal and stage counts; do not reuse the historical 6,471/257/6,209 figures as current truth.
4. Prove terminal counts reconcile exactly to the live canonical scan.
5. Show at least one non-unresolved target classification only if production evidence genuinely supports it; do not manufacture a non-empty cohort to satisfy a test.
6. Freeze one bounded operator-authorized cohort without invoking providers.
7. Record cohort hash, member count, canary count, policy/config/input hashes, and an idempotent replay receipt.
8. Prove provider operations, spend, validation calls, campaign/sequence rows, `master_leads`, and outbound sends did not change as a side effect.

If production contains no evidence-qualified target business, the correct result is an empty cohort with truthful terminal reasons—not a forced non-empty acceptance result.

## 16. Downstream contract preservation

Tasks #1999–#2001 already consume `sfp_cohort_runs.id`, `cohort_hash`, and `sfp_cohort_members`. Preserve those identities and update consumers only as needed for the new immutable status/rank/version fields.

Before closing Task #1998, statically and behaviorally prove:

- paid/free/validation/staging services accept only a frozen, non-voided run;
- selected membership remains immutable;
- selected order is reproducible;
- downstream queries use the frozen member set rather than rerunning the live selector;
- no global staged candidate can enter an SFP operation merely because the selector changed.

## 17. Explicit scope and kill lines

### In scope now

- SFP program/config authority cleanup;
- all-location geography resolution;
- deterministic five-target classifier using already-persisted non-provider evidence;
- terminal decision ledger and truthful funnel;
- corrected ROI scoring semantics;
- immutable transactional freeze/void/supersede;
- preview/freeze UI and routes;
- schema/migrations/tests needed for those contracts.

### Out of scope now

- page-content capture not already persisted;
- governed OpenAI classification;
- Serper, Outscraper, Apollo, or ZeroBounce calls;
- free/contact crawler changes;
- Sunbiz/source-universe materialization;
- validation/promotion to `master_leads`;
- campaign/sequence creation, staging, enrollment, or launch;
- recurring operations;
- any production publish or activation.

### Stop/kill conditions

Stop and report instead of bypassing if implementation would:

- weaken DBPR, suppression, existing-customer, bounce, or test exclusions;
- infer a five-target vertical without evidence;
- treat `active`/`unvalidated` as provider-valid;
- mutate state on a GET;
- reuse an idempotency key with a different payload;
- rewrite/delete a frozen cohort or its evidence;
- call a paid provider or outreach transport;
- activate recurrence or send outreach;
- claim production proof before deployment.

## 18. Required verification-for-completion matrix

The final response must include a PASS/FAIL table with evidence for every row:

| ID | Required proof |
|---|---|
| VFC-01 | Current `origin/main` SHA pinned; task diff isolated |
| VFC-02 | SFP configuration is SFP-owned and versioned |
| VFC-03 | Program/funnel GETs are read-only and preview works inactive |
| VFC-04 | Canonical DBPR lineage predicate reused |
| VFC-05 | All locations evaluated with deterministic rollup and qualifying location evidence |
| VFC-06 | Five-target classifier passes positive and negative fixtures without providers |
| VFC-07 | One terminal decision per scanned business; terminal sum equals total |
| VFC-08 | `active`/`unvalidated` receive no provider-validation credit |
| VFC-09 | Stable total ordering and full run/member manifest hash |
| VFC-10 | Program cap 100 and canary cap 25 enforced at every layer |
| VFC-11 | Freeze is atomic; injected failure leaves no partial cohort |
| VFC-12 | Idempotent replay returns stored evidence; payload mismatch is rejected |
| VFC-13 | Concurrent same-key freeze produces exactly one result |
| VFC-14 | Frozen cohorts are immutable; void/supersede preserves history |
| VFC-15 | Downstream services require a frozen, non-voided run and frozen membership |
| VFC-16 | Migration and Drizzle schema agree; integrity check passes |
| VFC-17 | Pure and disposable-DB suites are registered and pass |
| VFC-18 | TSC, API coverage, role guards, existing SFP, and CRO-03A regressions pass |
| VFC-19 | Zero provider calls, zero spend, zero campaign/sequence changes, zero outreach |
| VFC-20 | Build report clearly labels production verification as pending until publish |

## 19. Required final response format

Return:

1. base SHA and implementation SHA;
2. concise root-cause summary;
3. exact files/migrations changed;
4. schema and API contract summary;
5. tests/checks run with exact pass/fail counts;
6. VFC matrix with evidence locations;
7. known limitations and deferred ownership mapped to #1999–#2002;
8. explicit confirmation of no provider calls, no production writes, no activation, and no outreach;
9. exact post-publish read-only verification steps.

End with exactly:

`READY FOR OPERATOR PUBLISH — PRODUCTION VERIFICATION REQUIRED`

---

# Repository evidence supporting these corrections

| Finding | Current repository evidence at audited SHA |
|---|---|
| Raw five-label matching | `server/services/cro03/roi-cohort-selector.ts:36-43, 435-441` |
| Pilot-named setting drives SFP | `roi-cohort-selector.ts:109-121`; `south-florida-prospecting.ts:71-94` |
| Ad hoc DBPR query | `roi-cohort-selector.ts:228-235`; canonical authority is `server/services/dbpr.ts:60-77` |
| Target-only FIPS map | `roi-cohort-selector.ts:261-277` |
| Mutable OFFSET scan | `roi-cohort-selector.ts:279-340` |
| Exclusions precede geography and make stage counters overlap | `roi-cohort-selector.ts:349-391` |
| Exact vertical mismatch collapsed into unresolved | `roi-cohort-selector.ts:435-440` |
| `active`/`unvalidated` receive positive email/validation score | `roi-cohort-selector.ts:445-460` |
| Score ties lack explicit stable tie breaker | `roi-cohort-selector.ts:483-486` |
| Score table is append-only without conflict key despite `ON CONFLICT DO NOTHING` | `migrations/0275_roi_candidate_scores_table.sql`; `roi-cohort-selector.ts:540-557` |
| SFP is already MI-09 independent | `server/services/cro03/south-florida-prospecting.ts:1-18`; migration 0277 lines 1-2 |
| GET program mutates via `ensureProgram` | `server/routes/lead-ops.ts:2860-2868`; `south-florida-prospecting.ts:71-113` |
| Preview blocked while inactive | `south-florida-prospecting.ts:175-181` |
| Replay returns zeroed funnel | `south-florida-prospecting.ts:223-243` |
| Run upsert can reopen a prior row | `south-florida-prospecting.ts:248-256` |
| Freeze writes are not one transaction | `south-florida-prospecting.ts:248-347` |
| Cohort hash contains only sorted business IDs | `south-florida-prospecting.ts:298-301` |
| Existing member schema lacks required location/classifier/dimensions/rank evidence | `migrations/0277_south_florida_prospecting.sql:39-55`; `shared/schema.ts:9254-9268` |
| No excluded decision ledger exists | migrations 0277/0278 and `shared/schema.ts` SFP tables |
| HTTP/UI allow 500 despite proposed cap 100 | `server/routes/lead-ops.ts:2937-2945`; `SouthFloridaProspectingPanel.tsx:473-477` |
| UI uses timestamp as freeze idempotency key | `SouthFloridaProspectingPanel.tsx:261-266` |
| Current SFP suite is structural source scanning | `scripts/test-sfp-pipeline-correction.mjs:1-160`; registered as `deterministic-static` in `scripts/ci-suite-manifest.ts` |
| Free-discovery schema does not retain reusable page text for vertical classification | `migrations/0271_free_discovery_evidence.sql:27-61` |

# Audit execution notes

- The supplied Task #1998 plan was reviewed in full against the pinned clean worktree.
- The three prior documents were reconciled: system audit, execution roadmap, and implementation task plan dated 2026-09-23.
- `node scripts/test-sfp-pipeline-correction.mjs` passed **21/21** structural assertions on the audited SHA. This confirms current static guardrails only; it does not validate Task #1998 behavior.
- A full local TypeScript run could not be independently repeated in the clean audit worktree because repository dependencies were not installed there. Do not treat historical TSC claims as new audit evidence; Replit must run TSC after implementation.
- No production database or provider was accessed. No repository code, configuration, secrets, or data was changed by this audit.

**FINAL AUDIT VERDICT:** TASK VALID AFTER CORRECTION; NOT SAFE TO BUILD AS ORIGINALLY WRITTEN.
