# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD. Verify this task against current repository and CI reality, correct stale assumptions, and implement all safe build-ready portions in the same run. Do not stop after another plan unless a genuine blocker exists.

Do not blindly trust task counts, workflow names, migration numbers, paths, or old failures. Do not rewrite applied migration history casually, use `db push`, weaken tests, make production provider calls, normalize broken tests by loosening assertions, mutate shared production state, duplicate documentation authority, or clean unrelated code.

Required sequence: baseline → VFC → searches → root cause → ownership → blast radius → schema/auth/concurrency/external checks → verdict → corrected plan → kill lines → implementation → tests/gates → post-build searches → diff → final VFC → merge verdict.

## 1. REPOSITORY BASELINE

Capture:

- branch, HEAD SHA and working-tree status;
- current GitHub workflow files/check names visible from the repository;
- package scripts and actual pre-deploy suite inventory;
- migration SQL high-water mark, Drizzle journal high-water mark, and custom ledger/runner behavior;
- current test DB/schema/Redis/provider isolation configuration.

Preserve unrelated modifications.

## 2. VERIFIED FROM CODE — PREFLIGHT

Provide:

| ID | Task Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | ... | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |

Verify current CI versus pre-deploy gates, branch-check configuration that can be proven from available access, all safety suites, isolation/teardown helpers, coordinator hold/pause epoch/provider-control behavior, PE recovery production functions and assertions, migration runner/journal anomalies, authenticated raw client mutations, CSRF-aware API client, RBAC tests, and active audit-document ownership.

## 3. REQUIRED SEARCH / GREP CHECKS

Inspect current code for:

- `.github/workflows/**`, `package.json` scripts, `scripts/pre-deploy.ts`, all test suite registrations/timeouts;
- typecheck/build/compliance/pause/coordinator/Serper/GHL/ZeroBounce/NBA/PE recovery tests;
- test schema/database URLs, Redis prefixes, queue names, fake transports, env guards and cleanup;
- `applyPauseMutation`, hold creation/release, epochs, system settings and provider control rows;
- PE intent status/claim token/lease/retry/max attempts and production functions used by tests;
- root `migrations/**`, Drizzle journal/meta, custom migration runner/ledger/runtime DDL;
- authenticated frontend raw `fetch`/mutation clients, CSRF headers/tokens and shared API client;
- `isAuthenticated`, `isDashboardUser`, `requireRole`, route-policy/RBAC tests;
- original audit filenames plus current ledger/index/register/roadmap references.

Also search for swallowed errors, real provider URLs in tests, `setImmediate`, process-memory-only retries, destructive SQL, `TRUNCATE`, and test-created records/holds that can leak. Inspect context; grep is not proof.

## 4. VERIFIED ROOT CAUSE

State what the task claimed and the exact current gaps. Distinguish:

- checks implemented locally but omitted from GitHub Actions;
- checks required by branch protection versus merely present in YAML;
- test defects versus real production defects;
- migration metadata anomalies versus already-applied immutable history;
- code-enforceable controls versus external GitHub settings;
- active authority documents versus immutable historical baselines.

Include:

| Original Assumption | Verified Reality | Correction |
|---|---|---|
| ... | ... | ... |

## 5. SOURCE-OF-TRUTH CHECK

Identify:

- canonical release/pre-deploy gate owner;
- canonical GitHub Actions workflow/check owner;
- canonical migration runner and Drizzle journal owner;
- canonical test isolation/fixture owner;
- canonical queue/coordinator/provider-control owners used by tests;
- canonical CSRF-aware frontend mutation client;
- canonical server-side RBAC policy;
- canonical active audit ledger/index/register/roadmap.

Do not create parallel runners, migration ledgers, API clients, role maps, or active audit indexes.

## 6. BLAST RADIUS

### In scope

- aligning CI required checks with the actual release gate;
- isolated test schemas/Redis prefixes/fake transports;
- fixing production-path PE recovery assertions;
- exact pre/post teardown state restoration and leak detection;
- migration journal/runner validation and safe correction strategy;
- authenticated raw client mutation inventory and migration to canonical CSRF-aware client;
- RBAC role-matrix regression;
- immutable historical audits and one active authority/cadence.

### Out of scope

- enabling providers/outbound;
- changing business behavior solely to simplify tests;
- rewriting applied migrations without a proven safe compatibility plan;
- changing GitHub branch protection when credentials/authority are unavailable;
- unrelated application refactors or documentation rewriting.

List exact expected and explicitly untouched files. Keep the diff minimal.

## 7. DATA / SCHEMA CHECK

Verify migration SQL, journal indices/timestamps/hashes, custom ledger entries, runtime DDL, clean-database replay, and upgraded-database behavior. Rules:

- never `db push`;
- never renumber/edit already-applied migrations merely for aesthetics;
- use an additive corrective migration/validator when history cannot safely change;
- do not run destructive cleanup against production/shared DB;
- test migration replay in isolated disposable state;
- document migration head before and after.

If no new migration is required, state `Migration required: NO`.

## 8. AUTHORIZATION CHECK

For affected API/UI operations, verify actual server and client behavior:

| Action | Public | Agent | Manager | Admin |
|---|---:|---:|---:|---:|
| Relevant mutation/control | ... | ... | ... | ... |

RBAC must be enforced server-side. CSRF coverage must follow the canonical client/server mechanism. GitHub branch-protection changes require repository-admin authority and must be reported separately from code changes.

## 9. CONCURRENCY / IDEMPOTENCY CHECK

Required for PE recovery, pause/coordinator, queues and teardown. Verify atomic claims, tokens/leases, stable idempotency, simultaneous workers/tests, retry/max attempts, crash windows, partial success, duplicate jobs/holds, and exact teardown after failure/SIGTERM. Tests must not assume serial execution when production is concurrent.

## 10. EXTERNAL SIDE-EFFECT CHECK

All tests must use fake provider transports and isolated queues/state. Document DB/Redis/fake-call/audit ordering. Verify provider env guards cannot accidentally fall through, external URLs are never reached, and teardown occurs on success/failure/timeout. Do not claim CI configuration is enforced branch protection without GitHub evidence.

## 11. PREFLIGHT VERDICT

Choose BUILD-READY, BUILD-READY WITH CORRECTIONS, PREFLIGHT REQUIRED, NOT BUILD-READY, NOT NEW TASK, or WATCH. Continue immediately for build-ready verdicts. If the full task must split, identify the smallest safe atomic split and complete the independent portion rather than stopping at a plan.

## 12. CORRECTED BUILD PLAN

State verified What & Why, exact Done Looks Like, and current-file steps. Separate **BLOCKING CORRECTION** from optional **FOLLOW-UP HARDENING**. Identify external operations (for example branch protection) that code can prepare but not prove.

## 13. KILL LINES

- KILL LINE: If required CI can be green while omitting a safety-critical release gate for the exact SHA, the task has FAILED.
- STOP if tests call real providers or mutate shared production state.
- STOP if teardown leaks contacts, holds, pause epochs, queues, settings, counters, or provider-control rows.
- STOP if assertions are weakened instead of exercising the production path.
- STOP if concurrent claim/max-attempt behavior remains unproven by production functions.
- STOP if applied migrations are rewritten unsafely, journal truth diverges, or `db push` is used.
- STOP if authenticated mutations bypass canonical CSRF handling or server RBAC.
- STOP if a second active audit authority is created or original audits are overwritten.

## 14. IMPLEMENTATION RULES

Use existing runners/helpers/clients/policies, smallest safe diff, no unrelated cleanup, broad renames, formatting sweeps, dependency changes, or production config mutation. Do not make production code less safe to accommodate tests.

## 15. TEST REQUIREMENTS

Prove applicable happy, negative, boundary, replay, concurrency, authorization, partial-failure and regression behavior:

- every required gate is invoked and failure propagates;
- isolated tests cannot reach real providers/shared queues;
- teardown restores exact pre-test state after pass/fail/timeout;
- PE concurrent claim and max attempts use production functions;
- clean migration replay and upgraded-state validation pass;
- CSRF-aware client succeeds and raw/unauthorized mutations fail;
- role matrix matches server policy;
- document authority checks prevent drift/duplication.

## 16. SMOKE / INTEGRATION TEST

Extend existing release/test-isolation suites rather than creating redundant assertion counters. Add a focused script only where no current suite can prove the production behavior. It must run safely in pre-deploy and report leaked state as a hard failure.

## 17. POST-BUILD GREP CHECKS

Prove omitted suites are now owned, unsafe test provider paths and direct shared-state cleanup are gone, production functions are tested, migration anomalies are handled without parallel truth, raw authenticated client mutations are migrated/justified, and no stale active audit authority remains.

## 18. REQUIRED GATES

Run actual targeted tests, related subsystem suites, typecheck, production build, pre-deploy/compliance, migration validation/clean replay where feasible, RBAC/CSRF contracts and `git diff --check`. Report command/result. Determine ownership of failures and never claim complete with a task-owned red gate.

## 19. DIFF REVIEW

Run `git status`, `git diff --stat`, and `git diff`. Confirm only intended files, no secrets/PII/debug/generated junk/lockfile drift/unrelated formatting/production config mutation.

## 20. FINAL VFC TABLE

| ID | Requirement | Evidence | Test / Gate | Status |
|---|---|---|---|---|
| VFC-F01 | ... | `file:line` | ... | PASS / FAIL |

Represent every Done Looks Like requirement and kill line.

## 21. FINAL RESPONSE FORMAT

Return VERDICT, repository starting/ending state, migration head, verified root cause, corrections, `file:line` implementation, gate table, grep proof, kill-line proof, runtime/external GitHub verification distinction, realistic risks, and SAFE TO MERGE / SAFE TO MERGE — RUNTIME VERIFICATION PENDING / DO NOT MERGE.

## LIBERTY-SPECIFIC SAFETY RULES

- Jobs: revenue-critical tests must exercise durable production claims/recovery, not `setImmediate`, memory-only retries, or swallowed errors.
- Outreach/GHL/providers: fake transports and isolated state only; no live provider effects.
- Contacts/imports: test fixtures must preserve identity/provenance rules and be fully removed without broad production cleanup.
- Authorization: client hiding is never sufficient; preserve server RBAC and canonical CSRF handling.
- Database: no `db push`; validate clean and upgraded migration paths without rewriting applied history unsafely.

## PRACTICAL REVIEW STANDARD

Block for realistic false-green CI, shared-state contamination, real provider calls, unsafe migration drift, authorization gaps, or unrecoverable job state. Do not block an otherwise safe gate improvement merely because external GitHub branch-protection configuration requires repository-admin follow-through.

---

# TASK TO PREFLIGHT + BUILD

## BT-05 — CI, Migration & Test-Isolation Authority

**Primary findings:** `SEC-03`, `SEC-04`, `SEC-05`, `SEC-07`, `QUE-04`, `QUE-06`, `QUE-11`, `DOC-01`, `DOC-02`, `DOC-03`, `DOC-04`
**Dependencies:** Runs alongside BT-01 through BT-04

### What & Why

The audits found that local pre-deploy coverage could exceed GitHub Actions coverage, branch protection might not require the real safety gate, migration truth had journal/index/timestamp/custom-runner anomalies, some recovery assertions did not conclusively exercise production behavior, tests could leak shared state, authenticated client mutations were not uniformly proven to use the canonical CSRF-aware client, and several documents could compete as active authority. Recent test work corrected some coordinator/Serper/GHL leaks, so verify current reality before changing anything.

### Done Looks Like

- CI requires typecheck, production build, compliance scans, and every safety-critical suite for the exact SHA.
- Protected `main` requires those checks where repository-admin evidence is available; otherwise the exact external step is reported.
- Pause/coordinator/Serper/GHL/ZeroBounce/NBA/PE tests use isolated state and fake transports.
- Teardown restores the exact pre-test state and proves no holds, contacts, epochs, counters, queues or control rows leak.
- PE concurrent-claim/retry/max-attempt tests exercise production functions conclusively.
- A clean disposable database migrates deterministically to head; existing upgraded state validates without rewriting unsafe history.
- Authenticated client mutations use the canonical CSRF-aware path or a verified equivalent.
- Server RBAC has a required role-matrix regression gate.
- The eight original audits remain immutable historical baselines; one current ledger/index/register/roadmap set is active.

### Out of Scope

- Business-feature refactors.
- Real provider calls or production-state cleanup.
- Unsafe rewriting of applied migration history.
- Claiming branch protection is enforced without GitHub settings evidence.
- Rewriting the original eight audits.

### Proposed Implementation Steps

1. Compare package/pre-deploy suite inventory with every GitHub workflow and required check.
2. Verify and strengthen isolation helpers, fake transports and exact-state teardown.
3. Repair residual PE recovery tests to call production claim/retry/max-attempt paths.
4. Audit migration SQL/journal/custom ledger; implement the smallest safe validator/correction and clean replay proof.
5. Inventory authenticated frontend mutations; migrate residual unsafe calls to the canonical CSRF-aware client.
6. Add/require the server role-matrix test.
7. Codify immutable baseline versus active audit authority and update cadence.
8. Run the focused and full release gates; report any external branch-protection action separately.

### Relevant Files and Areas to Verify

- `.github/workflows/**`
- `package.json`
- `scripts/pre-deploy.ts`, `scripts/run-pre-deploy.sh`, current test scripts
- pause/coordinator/Serper/GHL/ZeroBounce/NBA/PE recovery test helpers
- queue/Redis/database fixture and teardown utilities
- root `migrations/**`, Drizzle journal/meta, custom DB migration runner/ledger
- frontend shared API/CSRF client and authenticated mutation call sites
- server auth/RBAC route guards and role tests
- current audit ledger/index/register/roadmap and the eight immutable source audits

Locate current owners; do not rely on historical paths or suite counts.

### Existing Kill Line

KILL LINE: If a commit can satisfy the required CI while skipping the actual safety-critical release gate—or if the gate itself mutates shared/production state or uses real providers—the task has FAILED.

## FINAL DIRECTIVE

Verify first, correct the plan, and build all safe code-owned portions in this run. Do not confuse workflow YAML with enforced branch protection, a passing assertion counter with production-path proof, or a clean new database with safe upgraded-state migration behavior.
