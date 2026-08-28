# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD

Verify the current certification infrastructure before changing it. Current `main` already contains PostgreSQL/Redis CI services, provider-denial wrappers, Redis namespace reservation, guarded migration launchers, and server-required suite orchestration added during the August 27 certification. Preserve and extend those canonical owners; do not rebuild them, create a second runner, or claim the historical “environment absent” finding remains unchanged.

Required sequence:

Repository baseline → certification implementation ancestry → VFC → capability graph → root cause/current gap → owner check → blast radius → data/auth/concurrency/network checks → verdict → corrected plan → kill lines → implementation → negative/positive isolation tests → CI/pre-deploy gates → post-build searches → diff review → final VFC → merge verdict.

**Absolute audit rule:** Do not stop after one missing capability or unsafe escape. Audit every parent/child process, suite capability, database/Redis boundary, provider/network path, cleanup path, and skip condition, and return the complete P0/P1/P2 correction matrix.

## 1. TASK IDENTITY

**RVR-04 — Reproducible Isolated Certification and Required-Gate Closure**

**Runtime rows unlocked:** `RV-1548-02`–`RV-1548-08`, `RV-OUT-01`–`RV-OUT-04`, `RV-QUE-04`, `RV-ZB-03`, `RV-UI-02`, and `RV-REV-01`, subject to each row’s fixture and access requirements.

**Parallelism:** Preflight may run beside CRO-01. Implementation must use a strict file fence. CRO-01 may modify `scripts/ci-suite-manifest.ts` and add focused suites; coordinate or wait before editing that manifest. This task owns certification wrappers, workflow provisioning, capability enforcement, cleanup, and isolated server/browser-equivalent execution—not CRM behavior.

## 2. WHAT & WHY

Last night’s certification workspace could not run stateful suites because `TEST_DATABASE_URL` was absent, while the repository’s GitHub integration workflow already contained disposable PostgreSQL/Redis services and later certification hardening added explicit environment replacement and provider denial. The real problem is therefore not “no harness exists.” It is proving that one canonical harness is portable across CI and approved disposable workspaces, that every protected suite actually exercises non-empty fixtures, and that missing capabilities fail rather than skip or fall back to shared state.

## 3. BASELINE AND CURRENT OWNERS

Drafting baseline to recapture:

- `origin/main`: `c5d0baa8c697778caccaed4dba74e456c9a07063`.
- Migration head: `0165_outbound_send_claim_lease`.
- Current CI provisions PostgreSQL 16 and Redis 7 and sets `TEST_DATABASE_URL`, `REDIS_URL`, `NODE_ENV=test`, test encryption/session values, and provider-disabled configuration.
- Current CI generates a unique Redis prefix, tests isolation controls, applies canonical migrations twice, runs deterministic-integration, starts a denied certification server, and runs server-required suites.
- Current install still bypasses the lockfile; RVR-02 owns that correction.
- Existing owners include `certification-process-env.ts`, `certification-provider-deny.ts`, Redis reservation, guarded migration, denied suite/server launchers, server readiness, `ci-suite-manifest.ts`, `run-ci-suites.ts`, and `.github/workflows/ci.yml`.

Capture current SHA/tree, migration head, workflow run on exact SHA, all suite capabilities/counts, environment replacement lists, provider credential scrub list, network denial coverage, cleanup hooks, and whether browser-equivalent tests exist.

## 4. VERIFIED FROM CODE — PREFLIGHT

| ID | Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | Disposable DB/Redis provisioning is missing | CONFIRMED/PARTIAL/FALSE/OUTDATED | Current workflow/services and local portability | workflow/scripts |
| VFC-02 | Provider denial is incomplete | CONFIRMED/PARTIAL/FALSE/OUTDATED | fetch/http/https/constructor/child-process coverage | `file:line` |
| VFC-03 | Redis namespaces can collide/leak | CONFIRMED/PARTIAL/FALSE/OUTDATED | reservation, stale-key rejection, cleanup | `file:line` |
| VFC-04 | Migrations run twice from empty state | CONFIRMED/PARTIAL/FALSE/OUTDATED | guarded canonical runner and CI execution | gate evidence |
| VFC-05 | Protected suites can skip empty fixtures | CONFIRMED/PARTIAL/FALSE/OUTDATED | manifest/runner/test behavior | suite evidence |
| VFC-06 | Server-required suites use the denied isolated server | CONFIRMED/PARTIAL/FALSE/OUTDATED | process environment and readiness | process evidence |
| VFC-07 | Browser/role coverage remains unavailable | CONFIRMED/PARTIAL/FALSE/OUTDATED | current dependencies/scripts/capabilities | repository evidence |

## 5. MANDATORY CAPABILITY INVENTORY

Trace every parent/child process and prove its complete replacement environment. Inventory database URLs, Redis URLs/prefixes, session/encryption keys, release/process identity, feature flags, provider credentials, proxy variables, HTTP agents/hooks, worker/scheduler startup flags, seed users, ports, temp/output paths, teardown, timeouts, and artifact redaction.

Search all mandatory suites for `skip`, empty-fixture success, production URL fallback, default Redis prefix, direct provider SDK/HTTP construction, shared database use, background worker startup, and cleanup that can delete outside the reserved namespace.

## 6. ROOT CAUSE AND SOURCE OF TRUTH

Verify the corrected root cause: implementation exists, but the certification entry point used outside GitHub did not receive required disposable capabilities and therefore failed closed. Close portability and enforcement gaps through the existing wrappers and capability manifest.

- Suite classification: `scripts/ci-suite-manifest.ts`.
- Capability execution: `scripts/run-ci-suites.ts`.
- Environment replacement/provider denial/Redis reservation: existing certification scripts.
- Database migration: canonical guarded migration runner; never `db push`.
- Workflow provisioning: `.github/workflows/ci.yml`.
- Pre-deploy: current `scripts/pre-deploy.ts`/shell wrapper.

Do not create a second manifest, migrator, provider mock authority, or test database selection rule.

## 7. BLAST RADIUS

### In scope

- Portable approved invocation of the existing isolated harness.
- Fail-closed capability validation before imports/startup.
- Exact replacement environment for every child.
- Unique atomic Redis namespace reservation and cleanup.
- Migration bootstrap/reapply, deterministic-integration, denied server, server-required, and browser-equivalent/role coverage where repository patterns support it.
- Non-empty fixture assertions and redacted artifacts.
- Required CI/pre-deploy enforcement.

### Out of scope

- Production/shared database or Redis use.
- Real providers, production credentials, provider balance checks, deployment, pause/unpause, campaigns, outreach, production data, or browser login to production.
- Rewriting CRM tests or fixing application behavior unrelated to harness correctness.
- Adding a new browser framework/dependency without proving existing patterns cannot satisfy required coverage.

Migration required: NO for harness work. Test schema applies existing migrations only.

## 8. AUTHORIZATION, CONCURRENCY, AND SIDE EFFECTS

Only explicitly approved disposable URLs may be used. Reject URL equality with production/shared configuration, missing `TEST_DATABASE_URL`, non-test `NODE_ENV`, non-unique Redis prefix, real credential presence, external network attempts, and unreserved namespaces before application imports.

Concurrent certification runs must reserve distinct namespaces atomically, never use `FLUSHALL`/`FLUSHDB`, delete only their own prefix, use unique ports/temp paths/users, and release reservations on success, failure, signal, and timeout. Database cleanup must target only the approved disposable database.

## 9. PREFLIGHT VERDICT

Use one Liberty verdict. Return `NOT NEW TASK` if current exact-main CI and a clean approved local/disposable invocation already satisfy every requirement. If only external infrastructure access is missing and code is complete, return `WATCH` or `SAFE TO MERGE — RUNTIME VERIFICATION PENDING`; do not manufacture code churn.

## 10. CORRECTED BUILD PLAN

1. Recapture workflow/harness ancestry and exact current capability graph.
2. Run negative pre-import probes for every missing/unsafe capability.
3. Run positive harness proof in a disposable environment if authorized.
4. Consolidate any divergent local/CI entry point onto existing wrappers.
5. Close child-environment, provider-denial, Redis reservation, cleanup, or readiness gaps.
6. Make protected suites fail on skip/empty fixture/core assertion absence.
7. Add browser-equivalent role/navigation coverage using current repository conventions; add a dependency only after a documented blocker and separate approval.
8. Apply migrations twice, run all capabilities, and collect redacted exact-SHA artifacts.
9. Prove teardown leaves no database process, server, namespace, temp credential, or provider attempt.

## 11. DONE LOOKS LIKE

- One canonical command/workflow provisions and verifies disposable PostgreSQL and isolated Redis.
- Every child receives an explicit replacement environment with no real provider credential.
- Any external network attempt fails the process and is counted/redacted.
- Migration applies twice through the canonical runner.
- Every mandatory stateful/server/role suite runs non-empty fixtures and cannot silently skip.
- Parallel runs cannot collide or clean each other’s state.
- Full teardown is proven on pass, failure, signal, and timeout.
- No production/shared system or provider was touched.

## 12. KILL LINES

- **KILL LINE:** If any protected stateful suite can run against production/shared state, the task has failed.
- STOP if missing isolation becomes a skip/pass instead of a hard failure.
- STOP if real provider credentials survive into any child or an external request is allowed.
- STOP if Redis cleanup uses global commands or an unreserved prefix.
- STOP if migration uses `db push`, a competing runner, or edits applied history.
- STOP if server readiness passes while the process is dead, unhealthy, or provider-capable.
- STOP if test fixtures are empty or core assertions do not execute.

## 13. TESTS AND GATES

Cover missing/malformed/same-as-production DB URL, wrong `NODE_ENV`, absent/colliding/stale Redis prefix, inherited credentials/proxy/agent/hooks, URL-plus-options overrides, fetch/http/https denial, dummy AI loopback constructor, child environment replacement, migration twice, concurrent reservations, crash/signal cleanup, dead server, route readiness, non-empty fixtures, and forbidden provider mutations.

Run isolation tests, capability manifest, all three capability classes, guarded migration twice, route guards/API/security scans, full pre-deploy with exact `RELEASE_SHA` in the disposable environment, `npm run check`, `npm run build`, and `git diff --check`. Report commands/exits and retain redacted artifacts.

## 14. POST-BUILD SEARCH AND DIFF REVIEW

Prove no raw test DB fallback, default/shared Redis prefix, inherited provider key, external network escape, direct migrator, silent skip, global Redis cleanup, orphan process, or duplicate harness exists. Confirm no CRM/CRO/provider production behavior changed.

## 15. FINAL VFC AND RESPONSE

| ID | Requirement | Evidence | Test/Gate | Status |
|---|---|---|---|---|
| VFC-F01 | Disposable DB/Redis enforced | wrapper/workflow | negative/positive isolation | PASS/FAIL |
| VFC-F02 | Provider/network denied | boundary | escape tests | PASS/FAIL |
| VFC-F03 | Migration replay safe | runner | apply twice | PASS/FAIL |
| VFC-F04 | Protected suites non-empty | manifest/suites | capability runs | PASS/FAIL |
| VFC-F05 | Parallel cleanup isolated | reservation | concurrency/crash tests | PASS/FAIL |
| VFC-F06 | No production mutation | evidence | diff/teardown | PASS/FAIL |

Return complete Liberty final format, distinguishing repository implementation, disposable runtime proof, GitHub exact-SHA proof, and still-pending production/provider access. Never claim a runtime register row closed without updating the validated register against the exact required evidence.

## 16. RELEVANT FILES

- `.github/workflows/ci.yml`
- `scripts/ci-suite-manifest.ts`
- `scripts/run-ci-suites.ts`
- `scripts/certification-process-env.ts`
- `scripts/certification-provider-deny.ts`
- `scripts/certification-child-process.ts`
- `scripts/generate-certification-redis-prefix.ts`
- `scripts/run-guarded-canonical-migration.ts`
- `scripts/run-denied-certification-suite.ts`
- `scripts/run-denied-certification-server.ts`
- `scripts/run-denied-certification-server-child.ts`
- `scripts/certification-server-readiness.ts`
- associated certification regression tests
- `scripts/pre-deploy.ts`
- `scripts/run-pre-deploy.sh`
- August 27 runbook/register/evidence packet

## FINAL DIRECTIVE

Treat current isolation code as canonical. Verify what remains, make the harness portable and impossible to misuse, run every authorized disposable gate, and avoid code churn where only owner-provided infrastructure or runtime access is missing.
