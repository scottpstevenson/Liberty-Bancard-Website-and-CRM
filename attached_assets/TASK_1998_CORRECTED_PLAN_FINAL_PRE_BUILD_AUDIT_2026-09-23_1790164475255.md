# Task #1998 Corrected Plan — Final Pre-Build Audit

**Audit date:** 2026-09-23  
**Audited plan:** `#1998 - Canonical South Florida Cohort Foundation (Corrected)`  
**Repository baseline:** `origin/main` at `6a0bd39a8ad8a9285bf5cb5bb1e5d0b93968de6a`  
**Verdict:** **BUILD-READY ONLY AFTER C-01 THROUGH C-10 ARE INCORPORATED**

## Executive verdict

The corrected Task #1998 is materially better than the original plan and is aligned with the prior system audit, execution roadmap, implementation task plan, and the earlier live-repository audit. It correctly identifies the geography and vertical-classification defects, preserves SFP's independence from CRO-03A/MI-09, keeps providers and outreach out of Task #1998, and adds the necessary deterministic cohort, ledger, idempotency, and migration work.

It is not yet safe to send to Build Mode exactly as written. Ten finite corrections remain. The most important are: use a consistent database snapshot rather than mutable `OFFSET`; separate immutable cohort lifecycle from later stage progress; enforce frozen-evidence immutability at the database boundary; scope suppression to the correct subject instead of automatically excluding a whole business; and make the referenced 20-item verification matrix self-contained.

These are corrections to Task #1998, not new project tasks. They do not expand Task #1998 into provider activation, validation, campaign creation, Sunbiz expansion, or outreach. Tasks #1999-#2002 remain downstream and unchanged.

## Evidence and baseline checks

| Check | Result | Evidence |
| --- | --- | --- |
| Clean audit worktree | PASS | Detached clean worktree at the exact `origin/main` SHA below |
| `origin/main` | PASS | `6a0bd39a8ad8a9285bf5cb5bb1e5d0b93968de6a` |
| Migration head | PASS | Journal index 282, tag `0278_sfp_governed_operations`, `when=1800000009300` |
| Existing SFP structural suite | PASS | `node scripts/test-sfp-pipeline-correction.mjs`: 21/21 |
| CI suite manifest check | PASS | Manifest classified successfully with no stale/duplicate registration failure |
| Migration integrity | PASS WITH HISTORICAL WARNINGS | 703 checks; 0 errors; 2 pre-existing historical `when` collision warnings |
| TypeScript compilation | NOT RUN | Clean worktree did not contain installed TypeScript dependencies; this is an environment limitation, not a code failure. Build Mode must install the locked dependencies and run `npx tsc --noEmit`. |

The current passing SFP suite is predominantly a structural source check. It does not prove atomic database behavior, concurrent idempotency, direct-SQL immutability, or consumer admission against a real disposable database. Task #1998 correctly proposes integration coverage, but the corrections below make the required proofs exact.

## What the corrected task gets right

- It replaces the false claim that SFP is blocked on CRO-03A/MI-09 and explicitly keeps the subsystems independent.
- It identifies the real location-resolution defect: the selector builds evidence from target-county rows instead of evaluating all locations.
- It identifies the real vertical defect: raw exact-string equality rejects broader canonical labels.
- It recognizes that `active` and `unvalidated` are not provider-valid outcomes and must receive zero provider-validation credit.
- It moves SFP configuration away from `system_settings.cro03c_roi_pilot_verticals` as recurring runtime authority.
- It requires a terminal decision for every scanned canonical business and exact funnel reconciliation.
- It requires stable ranking, a full-manifest cohort hash, atomic freeze, idempotent replay, mismatch rejection, immutable void/supersede, and a provider-free 25-member canary.
- It keeps provider calls, ZeroBounce validation, campaigns, recurrence, production writes, and outreach outside Task #1998.

## Required corrections

### C-01 — Re-pin the repository at execution time

**Severity:** Required

The plan states that the workspace is already clean and permanently synchronized to one SHA. That was true for this audit worktree, but it is not a safe future Build Mode assumption.

**Add to the task:**

> At kickoff, fetch `origin/main`, record the then-current base SHA, and execute from a clean task branch/worktree. If `origin/main` differs from the audited SHA, reconcile every repository claim against the new base before editing and report the drift. Do not reset, overwrite, or include unrelated user changes. The completion report must contain both the actual base SHA and implementation SHA.

### C-02 — Freeze from one consistent snapshot using keyset traversal

**Severity:** Critical

The current selector uses mutable `OFFSET` paging. Saying “one transaction” is not enough unless the source universe and configuration are read from one consistent snapshot. Under ordinary read-committed behavior, inserts or updates during selection can produce gaps, duplicates, or a cohort whose decision ledger does not reconcile to the same source state.

**Add to Steps 4 and 8:**

> Build the authoritative freeze from a single repeatable-read (or stronger) snapshot. Freeze the program/config version, policy versions, source high-water/snapshot identity, and request hash at run creation. Traverse businesses with keyset pagination on stable canonical IDs; do not use mutable `OFFSET`. Preview may be non-authoritative, but preview and freeze must call the same pure decision engine and report their policy/config versions.

### C-03 — Separate cohort lifecycle from downstream stage progress

**Severity:** Critical

Current code changes `sfp_cohort_runs.status` to `staged` during validation. If downstream consumers are changed to require `status='frozen'`, a legitimately processed cohort will later become inadmissible. Cohort immutability and processing progress are different state machines.

**Required design:**

- Add an immutable cohort lifecycle field such as `cohort_state`: `freezing | frozen | failed | voided | superseded`.
- Keep discovery/provider/validation/campaign progress only in `sfp_stage_runs` and the downstream operation tables.
- Remove or retire the `sfp-validation.ts` write that changes the cohort run to `staged`.
- Every consumer must require `cohort_state='frozen'` and `voided_at IS NULL`/`superseded_at IS NULL` without changing that lifecycle when a stage completes.
- Preserve the existing downstream identities: `sfp_cohort_runs.id`, `cohort_hash`, and `sfp_cohort_members`.

### C-04 — Enforce frozen-evidence immutability in the database

**Severity:** Critical

Application-service promises are insufficient. Current foreign keys include cascading deletion paths, and direct SQL could still update or remove frozen members and historical evidence.

**Add to migration and tests:**

> Enforce immutability at the database boundary. A frozen run's request/config/input hashes, policy versions, decision rows, member rows, selection ranks, qualifying-location evidence, canary designation, and cohort hash must reject update/delete operations. Use restrictive foreign-key behavior and guarded triggers/functions as appropriate; do not cascade-delete historical stage/provider evidence. Voiding and superseding append new lifecycle evidence and never rewrite the frozen manifest. Disposable-database tests must prove direct SQL update/delete rejection and preserved history.

### C-05 — Make suppression and bounce exclusions subject-aware

**Severity:** Critical

The current selector marks a business suppressed when any linked contact is suppressed. That can incorrectly eliminate a business that has another usable, unsuppressed decision-maker or role address. The same distinction matters for bounced/invalid email evidence.

**Replace the broad exclusion rule with:**

> A canonical business-wide do-not-contact, excluded-source, DBPR, or existing-customer rule may terminally exclude the business. A contact- or email-specific suppression/bounce applies to that exact subject/candidate and must not automatically suppress every other candidate for the business. Persist the suppression scope, subject identifier or normalized-email hash, authority, reason, and evidence reference. Use `excluded_suppressed`/`excluded_bounced` at business level only when the authoritative rule is business-wide or when the policy deterministically proves that no usable unsuppressed candidate can remain. Unknown suppression scope fails closed for admission and is surfaced for review rather than silently broadened.

Task #1998 still must not perform provider validation or create contact candidates; it only makes eligibility evidence correctly scoped for downstream tasks.

### C-06 — Apply the 100 cap only to cohort selection

**Severity:** Required

The phrase “cap 1-100 everywhere” is over-broad. Task #1998 owns the program/freeze cohort limit, not the batch limits for discovery, paid enrichment, validation, or campaign staging in Tasks #1999-#2001.

**Clarify:**

> Enforce `maxCohortSize` 1-100 at the SFP program, preview, freeze route, freeze service, schema constraint, and UI input. Keep the canary cap at 25. Do not reduce or redefine `sfp_stage_runs.max_items` or downstream stage/provider batch caps as part of Task #1998. Update the existing structural test that currently asserts the legacy 500 cohort bound.

### C-07 — Define the one-time legacy initializer precisely

**Severity:** Required

“May be read once” is ambiguous and can recreate hidden runtime authority.

**Add:**

> The legacy `system_settings.cro03c_roi_pilot_verticals` value may be consumed only by an explicit admin initialize/configure mutation, and only when no SFP-owned program configuration exists. Persist the initializer source, source revision/hash, resulting normalized SFP configuration, actor, timestamp, and audit receipt. GET, preview, freeze, and ordinary `ensureProgram` logic must never read or reconverge from that key. After initialization, `sfp_programs` and its versioned policy artifact are the sole SFP authority.

Use the existing `sfp_programs` table rather than creating an unspecified parallel “equivalent” authority unless a migration-backed reason is documented.

### C-08 — Make the verification contract self-contained

**Severity:** Required

The task currently refers to “the 20 items specified in the audit attachment.” A builder may not receive that attachment, and an external reference is not an executable acceptance contract.

**Required:** Embed VFC-01 through VFC-20 from this document verbatim in Task #1998. The completion report must mark each PASS or FAIL and give concrete evidence paths/test names. A FAIL cannot be relabeled as production verification pending.

Also add these affected consumer files to Relevant files:

- `server/services/cro03/sfp-provider-operations.ts`
- `server/services/cro03/sfp-paid-waterfall.ts`
- `server/services/cro03/sfp-validation.ts`
- `migrations/meta/_journal.json`

### C-09 — Define stable UI idempotency-key lifecycle

**Severity:** Required

Replacing `Date.now()` with a random key is only correct if retries reuse the same logical key.

**Add:**

> Generate `crypto.randomUUID()` once when the operator begins a logical freeze and retain it in component state/ref through timeout, retry, reload recovery where feasible, and terminal response. Retrying the same requested freeze reuses the key. An explicit “start new cohort” action rotates the key. The server stores a normalized request hash; same program+key+hash returns the original run and complete stored funnel, while same program+key+different hash returns HTTP 409 with a stable error code.

### C-10 — Tighten the task text and completion boundary

**Severity:** Required

Apply these editorial and boundary corrections:

- Replace malformed telephone-style links for migrations 0277/0278 with code literals.
- State that Task #1998 performs no page crawling, OpenAI calls, Serper, Apollo, Outscraper, ZeroBounce, GHL, spend, promotion, sequence creation, recurrence, or production mutation.
- Require fake transports and network-deny assertions even though no provider path should be reachable.
- Require a kickoff repository-drift report before edits and one final completion report after all tests; do not drip-feed newly discovered blockers after implementation begins.
- End the build report with exactly: `READY FOR OPERATOR PUBLISH — PRODUCTION VERIFICATION REQUIRED`.

## Self-contained verification contract

| ID | Acceptance requirement |
| --- | --- |
| VFC-01 | Current `origin/main` SHA pinned; task diff isolated |
| VFC-02 | SFP configuration is SFP-owned and versioned |
| VFC-03 | Program/funnel GETs are read-only and preview works inactive |
| VFC-04 | Canonical DBPR lineage predicate reused |
| VFC-05 | All locations evaluated with deterministic rollup and qualifying-location evidence |
| VFC-06 | Five-target classifier passes positive and negative fixtures without providers |
| VFC-07 | One terminal decision per scanned business; terminal sum equals total |
| VFC-08 | `active`/`unvalidated` receive no provider-validation credit |
| VFC-09 | Stable total ordering and full run/member manifest hash |
| VFC-10 | Program cohort cap 100 and canary cap 25 enforced at their owned layers |
| VFC-11 | Freeze uses one consistent snapshot and is atomic; injected failure leaves no partial cohort |
| VFC-12 | Idempotent replay returns the original stored evidence; payload mismatch is rejected |
| VFC-13 | Concurrent same-key freeze produces exactly one result |
| VFC-14 | Frozen cohorts are database-enforced immutable; void/supersede preserves history |
| VFC-15 | Downstream services require a frozen, non-voided/non-superseded lifecycle and immutable membership |
| VFC-16 | Migration, journal, and Drizzle schema agree; integrity check passes |
| VFC-17 | Pure and disposable-database suites are registered and pass |
| VFC-18 | TSC, API coverage, role guards, existing SFP, and CRO-03A regressions pass |
| VFC-19 | Zero live provider calls, zero spend, zero campaign/sequence changes, zero outreach, and zero production writes |
| VFC-20 | Build report clearly labels production verification as pending until operator publish |

## Exact directive to send Replit

Attach this audit file and the corrected Task #1998 plan, then send:

> Reconcile the attached corrected Task #1998 plan against the attached final pre-build audit. Before editing, fetch and re-pin `origin/main`, confirm a clean isolated task branch/worktree, and produce a short kickoff drift report. Incorporate every required correction C-01 through C-10 and embed VFC-01 through VFC-20 directly into the executable task plan. Then implement Task #1998 only—do not begin Tasks #1999-#2002 and do not activate providers, validation, recurrence, campaigns, outreach, or production writes. Run the locked-repository TypeScript, structural, disposable-database integration, CI-manifest, and migration-integrity checks. Return one final completion report with an evidence location for every VFC item, explicit zero-provider/zero-outreach/zero-production-write proof, the actual base and implementation SHAs, and the exact terminal line `READY FOR OPERATOR PUBLISH — PRODUCTION VERIFICATION REQUIRED`. If a true repository contradiction appears, stop once with the complete evidence-backed contradiction list; do not implement speculative partial fixes or drip-feed blockers.

## Final disposition

The five-task dependency plan remains valid:

1. #1998 establishes the canonical, immutable South Florida cohort.
2. #1999 consumes that cohort for unified discovery and candidate evidence.
3. #2000 validates candidates and computes outreach eligibility.
4. #2001 stages governed paused campaigns/sequences and recurring operations.
5. #2002 expands the source universe in parallel after #1998.

Task #1998 should proceed only after C-01 through C-10 are merged into its plan. No additional broad task is required by this audit.
