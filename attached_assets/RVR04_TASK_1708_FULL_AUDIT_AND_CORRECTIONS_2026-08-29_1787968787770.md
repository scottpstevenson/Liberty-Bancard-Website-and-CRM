# Liberty Bancard — Task #1708 / RVR-04 Full Audit and Controlling Corrections

**Audit date:** 2026-08-29  
**Task audited:** `#1708 - Isolated Certification Infrastructure`  
**Repository baseline audited:** `bd36d65dfa635b0efd20e8c3f702754bdf66f71e`  
**Audit mode:** read-only repository, task-plan, workflow, runner, manifest, migration, and focused-gate verification  
**Controlling verdict:** **BUILD-READY WITH MATERIAL CORRECTIONS — DO NOT EXECUTE THE ATTACHED PLAN AS WRITTEN**

---

## 1. Executive Verdict

The task has the right owner, objective, and general architecture. It correctly recognizes that PostgreSQL, Redis, guarded migrations, provider-denial wrappers, Redis namespace reservations, denied-server startup, and capability classification already exist. RVR-04 should harden those owners instead of building parallel infrastructure.

The attached plan is not yet safe to execute unchanged. It accurately identifies the auth-action opt-in, CRO-03 database-topology contradiction, false pre-deploy skip accounting, incomplete process cleanup, stale-manifest warnings, three CSRF classifications, and unowned port eviction. A full live-code audit found **14 additional material corrections: 6 P0, 6 P1, and 2 P2**.

These corrections belong in **this same RVR-04 task**. They are not a recommendation to create 14 follow-up tasks. The only separate operational owners are genuine external/release administration and any independently approved release-identity work whose scope is proven by an exact task and merge SHA.

No CRM business logic, CRO-04 through CRO-06 work, provider activation, production data, GHL action, campaign action, outreach, deployment, or production release belongs in RVR-04.

---

## 2. Repository State Recaptured

| Item | Verified state |
|---|---|
| Branch target | `main` |
| `origin/main` / audited commit | `bd36d65dfa635b0efd20e8c3f702754bdf66f71e` |
| Commit subject | `Remove obsolete audit and preflight text attachments` |
| Audit worktree | Clean, detached, no task implementation changes |
| Root SQL migration count | 182 |
| Migration head | `0177_cro03_source_staging_evidence` |
| Migration integrity | PASS — 400 checks; two documented historical duplicate-timestamp warnings |
| Suite manifest | PASS — 82 unique classified suites |
| Capability counts | 33 static, 29 integration, 14 server-required, 6 server-optional |
| CI services | PostgreSQL 16 and Redis 7 are provisioned |
| Production/provider use | None |

The task plan's reference to an untracked attachment describes the executor's planning workspace, not a durable repository property. Every implementation run must recapture its own status and must never add user-provided task text or audit attachments to the repository.

---

## 3. Audit Scope and Method

The audit inspected:

- the full attached Task #1708 plan;
- current Git state, ancestry, migration journal, and migration files;
- `.github/workflows/ci.yml`;
- `scripts/ci-suite-manifest.ts`, `scripts/run-ci-suites.ts`, `scripts/pre-deploy.ts`, and `scripts/run-pre-deploy.sh`;
- certification child-environment, provider-denial, database guard, Redis reservation, denied-server, and child-process owners;
- all six `server-optional` entries and representative required suites;
- CRO-03, auth-action, statement-acquisition, and backlog-preview certification paths;
- build/release-artifact behavior, spawned command behavior, and network assumptions;
- the relevant project roadmaps and prior Liberty boundaries.

Search results were used only to locate owners. Findings below were based on the surrounding implementations and execution contracts.

---

## 4. Attached Plan VFC — Confirmed Findings

| ID | Attached-plan claim | Audit verdict | Required disposition |
|---|---|---|---|
| VFC-A01 | Disposable PostgreSQL/Redis infrastructure already exists | PASS | Extend it; do not create another harness |
| VFC-A02 | Auth-action opt-in is missing from child environments/CI | CONFIRMED | Add narrow manifest-declared opt-in only for its owning suite |
| VFC-A03 | CRO-03 HTTP suite rejects the canonical equal test URLs | CONFIRMED | Reuse the canonical disposable guard and equal URLs |
| VFC-A04 | Backlog pre-deploy delegation can be counted as passed | CONFIRMED | Distinguish executed, delegated, skipped, failed, and not run |
| VFC-A05 | Statement test must keep the canonical sequence paused | CONFIRMED | Preserve isolated active test-sequence behavior |
| VFC-A06 | Exit zero does not prove meaningful execution | CONFIRMED | Add suite-specific completion receipts |
| VFC-A07 | Timeout cleanup kills only the immediate child | CONFIRMED | Own and verify the full process group/tree |
| VFC-A08 | Stale manifest entries only warn | CONFIRMED | Fail unless an explicit delegation record owns the difference |
| VFC-A09 | Three public/token browser fetches lack scanner classification | CONFIRMED | Add narrow per-call-site `CSRF_EXEMPT` classifications |
| VFC-A10 | Pre-deploy kills any listener on port 5000 | CONFIRMED | Never signal an unowned listener; use an owned port/handshake |
| VFC-A11 | Release identity is not proven by source inspection | PASS | Keep separate evidence status; do not invent runtime proof |
| VFC-A12 | CRO-03 live-like proof is not permission for live providers | PASS | Run registered synthetic/disposable suites; keep providers denied |
| VFC-A13 | Tracked-file regression is currently clear | PASS | Preserve scanner and clean diff |
| VFC-A14 | Current manifest count is 82 | PASS | Recompute after any reclassification |
| VFC-A15 | Migration head is 0177 | PASS | No migration is expected for RVR-04 |
| VFC-A16 | Plan-mode build absence is not a pass | PASS | Executor/CI must run the build and artifact gate |

---

## 5. Newly Verified Gaps the Attached Plan Missed

| ID | Severity | Gap | Why it matters |
|---|---|---|---|
| VFC-N01 | P0 | Dependency audit calls the public npm registry while the task requires loopback-only execution | The declared network contract and required suite inventory cannot both be true |
| VFC-N02 | P0 | Provider denial patches fetch/http/https in one process, not all descendant processes or direct socket APIs | A spawned or direct-socket client can escape the proof boundary |
| VFC-N03 | P0 | Several local safety suites are classified `server-optional` and self-skip | Required authorization, health, form, and ownership behavior can remain untested on green CI |
| VFC-N04 | P0 | Auth-action integration reads and partially executes migration 0176 itself | This is a competing migrator and can hide canonical bootstrap failures |
| VFC-N05 | P0 | Server and suite Redis receipts/prefixes do not establish one shared resource identity; cleanup does not prove zero owned keys | Tests can observe different namespaces and leave state behind |
| VFC-N06 | P0 | There is no enforceable completion-receipt protocol | Required suites can exit 0 after skipped setup or zero core checks |
| VFC-N07 | P1 | Four capability labels do not declare exact per-suite resources and side effects | The runner over-provisions some suites and cannot validate others precisely |
| VFC-N08 | P1 | Skip/delegation accounting is fixed only piecemeal | Other suites can still be reported green without execution |
| VFC-N09 | P1 | Signal, timeout, shell trap, and CI cleanup semantics are incomplete | Orphans and false-zero signal exits remain possible |
| VFC-N10 | P1 | Port 5000 is hard-coded separately from `BASE_URL` and lacks an exact-run handshake | A stale/unrelated server can be tested or killed |
| VFC-N11 | P1 | Release-artifact gate is classified pure/static although it writes `dist` and spawns build tools | The capability contract is false and concurrent runs can collide |
| VFC-N12 | P1 | Child HOME/XDG/npm config and `npx` behavior are not isolated | Local credentials/config and implicit downloads can enter certification |
| VFC-N13 | P2 | External task numbers are referenced without repository-verifiable scope or merge evidence | They cannot serve as waivers or acceptance evidence by themselves |
| VFC-N14 | P2 | Comments and inventory text still describe obsolete suite counts/ownership | Stale documentation will recreate runner drift |

---

## 6. What Is Already Correct and Must Be Preserved

- CI provisions PostgreSQL 16 and Redis 7.
- Canonical migrations are applied through the guarded migration owner and checked for repeatability.
- Test database equality, loopback, naming, and environment checks already exist.
- Child environments use an allowlist rather than inheriting every parent secret.
- Fetch/http/https denial and custom-hook denial already exist as a useful inner layer.
- Redis namespace reservation is high-entropy, NX-based, and token-fenced.
- A denied application server and readiness probe already exist.
- The statement-acquisition test creates an isolated active sequence and proves the canonical sequence remains paused.
- Backlog preview truthfully distinguishes `unavailable`, `schema_missing`, and data-bearing results.
- Provider activation and production provider transport remain disabled.
- Current migration and manifest integrity checks pass.

RVR-04 must strengthen these owners. It must not replace them with new parallel runners, migrators, denial libraries, or cleanup systems.

---

## 7. P0 Corrections — Mandatory Before Build Acceptance

### P0-01 — Split external security access from provider-denied integration

`scripts/dependency-audit-policy.ts` invokes `npm audit` against `https://registry.npmjs.org`. It is currently classified as deterministic integration, while RVR-04 requires loopback/PostgreSQL/Redis-only network access for all 29 integration suites.

Required correction:

1. Introduce an explicit `external-security` execution owner or replace the live audit with validation of a separately produced locked advisory artifact.
2. If live npm advisory access remains, run it in a dedicated job with only the npm registry allowlisted and with no application, database, Redis, provider, email, GHL, or production credentials.
3. Keep the dependency-policy fixture tests static/provider-free.
4. Do not describe or count the live npm audit as provider-denied deterministic integration.
5. Persist exact lockfile hash, registry host, command, exit status, timestamp, and artifact hash.

### P0-02 — Make network denial cover the full owned execution tree

The current monkeypatch is a valuable process-local guard, not a complete egress boundary. It does not prove denial for direct `net`/`tls`/DNS/alternate Undici usage or spawned `npm`, `npx`, Node, shell, and build descendants.

Required correction:

1. Inventory fetch, http, https, undici, net, tls, DNS, socket, and subprocess network surfaces.
2. Apply an inherited preload/launcher to every owned Node descendant and add an OS/container egress boundary where available.
3. Scrub all provider credentials and provider-enabling configuration from the complete owned tree.
4. Record and fail on every denied attempt with only protocol/host class and suite identity—never secrets, query strings, payloads, or PII.
5. Test fetch, http, https, custom agents, direct sockets, alternate clients, and spawned children.
6. Keep the separate `external-security` job under its narrower registry-only policy.

### P0-03 — Reclassify or split the six `server-optional` suites

The optional class currently contains local safety behavior that does not inherently require live providers:

| Suite | Correct disposition |
|---|---|
| `scripts/test-live-health.ts` | Promote local DB/Redis/health contract to server-required; unreachable server must fail |
| `scripts/test-forms.ts` | Promote synthetic denied-provider public-form flows to server-required |
| `scripts/smoke-portfolio.ts` | Promote ownership/scoping checks to server-required |
| `scripts/smoke-golive-gate.ts` | Promote role/gate behavior to server-required |
| `scripts/test-chat-business-hours.ts` | Split deterministic business-hours logic from any live AI probe; fake/deny AI for required proof |
| `scripts/test-ai-assistant-boundaries.ts` | Run authorization/no-action/grounding boundaries with synthetic users and fake provider; no skipped auth sections |

Genuinely live-provider probes may remain operator evidence, but they must be non-mandatory, visibly pending, and must never be counted as an executed pass.

### P0-04 — Remove suite-local migration execution

`server/tests/auth-actions.integration.test.ts` reads migration 0176 and executes a prefix. CI already owns canonical journal application.

Required correction:

1. Apply the full journal only through `run-guarded-canonical-migration.ts` or its canonical owner.
2. Run the canonical disposable-infrastructure guard before importing database/application modules.
3. Have the auth-action suite assert its required tables, columns, constraints, and indexes already exist at the current migration head.
4. Do not parse or partially execute production migration SQL inside the suite.
5. If a unit test needs synthetic DDL, use an isolated temporary schema/fixture unrelated to a production migration file.

### P0-05 — Create one run-scoped resource identity and share exact receipts

Current names and URL equality do not prove that the harness created and owns every resource. The denied server and server-required client suite can receive different Redis prefixes, and reservation release does not prove all owned keys are gone.

Required correction:

1. Generate one high-entropy `certificationRunId` before any stateful action.
2. Bind to it: reviewed SHA, test database/schema identity, Redis prefix, port, temp directory, server PID/process group, server nonce, and artifact directory.
3. Issue signed/token-fenced resource receipts from the harness.
4. Make server-required suites consume the exact denied server's database and Redis receipt, not mint a second namespace.
5. Give standalone integration suites their declared resource receipts.
6. On cleanup, enumerate and delete only keys under the owned prefix after token verification, prove zero owned keys remain, then release the reservation key.
7. Never use broad Redis flush, broad process kill, or shared database cleanup.
8. Prove two simultaneous runs receive distinct database/schema, Redis, port, process, temp, and artifact identities.

### P0-06 — Enforce meaningful completion receipts

Required suites currently can exit 0 after setup is unavailable or core assertions are skipped. A log line or generic assertion count is not sufficient.

Required correction:

1. Extend manifest metadata with a suite-specific `completionContract`.
2. Runner creates a per-suite nonce and private receipt path.
3. Suite atomically writes exactly one JSON receipt containing: schema version, run ID, suite ID, exact script, reviewed SHA, capability, resource receipt IDs, named required checkpoints, fixture counts, assertion counts, skipped-required checkpoints, cleanup result, and terminal status.
4. Runner rejects missing, duplicate, stale, wrong-SHA, wrong-run, wrong-script, empty-fixture, skipped-required, or failed-cleanup receipts even when the child exits 0.
5. A required suite must execute every named required checkpoint.
6. Retrofit every protected stateful and server-required suite in RVR-04 scope, including current self-skip paths in role guards, contactability, health, forms, go-live, and AI boundaries.

---

## 8. P1 Corrections — Required for Complete Acceptance

### P1-01 — Replace the four-label-only model with declarative suite resources

Keep capability grouping, but add validated metadata per suite:

- PostgreSQL: none / migrated disposable / temporary schema;
- Redis: none / run-shared / suite-isolated;
- server: none / denied server receipt;
- network policy: none / loopback-only / npm-advisory-only;
- approved opt-ins and exact values;
- workspace writes and artifact output;
- timeout and termination grace;
- completion contract;
- pre-deploy owner or explicit delegation owner.

The runner must derive environment and prerequisites from this metadata. It must not require both PostgreSQL and Redis merely because a suite is labeled integration.

### P1-02 — Generalize truthful evidence accounting

Every report and persisted summary must distinguish:

- `executedPassed`;
- `executedFailed`;
- `delegatedPending`;
- `optionalSkipped`;
- `notRun`;
- `infrastructureFailed`.

`passed=true` is permitted only when every task-owned required suite executed and passed its completion contract. Delegated or optional work may remain visible but cannot inflate pass totals.

### P1-03 — Finish process-tree and signal correctness

1. Start every owned server/suite in an owned process group or equivalent platform-safe tree owner.
2. On timeout/failure: send SIGTERM, wait a bounded grace period, send SIGKILL if needed, then wait/reap.
3. Verify no descendants, owned listener, owned temp artifacts, Redis keys, or reservation remain.
4. Validate timeouts as finite, positive, and bounded.
5. Use separate idempotent INT, TERM, and EXIT handlers in shell; preserve the initiating nonzero status and use `128 + signal` where appropriate.
6. Make CI cleanup wait and verify rather than issuing a best-effort kill.

### P1-04 — Make port and server identity owned

1. Allocate or accept a run-owned loopback port.
2. Derive/export `PORT` and `BASE_URL` from one source.
3. If the port is occupied, fail without signaling the owner.
4. Denied-server readiness must return the expected run nonce, exact SHA, process identity, and provider-denied mode.
5. Reject a healthy response from any stale or unrelated server.

### P1-05 — Correct release-artifact classification and isolation

`scripts/release-artifact-gate.ts` writes `dist` and invokes compilation/build tools. It is not a pure read-only static suite.

Required correction:

1. Mark it with a build-artifact resource contract or give it a dedicated build capability/job.
2. Run in a clean isolated workspace/output directory.
3. Use locked local executables; no implicit package download.
4. Capture exact SHA, lock hash, output inventory/hash, scan result, and cleanup result.
5. Prevent collision with application/runtime `dist` and concurrent certification runs.

### P1-06 — Isolate HOME, package-manager configuration, and tools

1. Use a run-owned temporary HOME and XDG directories.
2. Supply an explicit npm config with no inherited auth tokens or private registries unless the dedicated external-security job requires the public registry.
3. Invoke `process.execPath` and resolved local package binaries; avoid download-capable `npx` behavior.
4. Preserve only manifest-approved variables.
5. Test that parent `.npmrc`, user config, provider keys, production URLs, and shell secrets are not visible to children.

---

## 9. P2 Corrections — Documentation and Follow-through

### P2-01 — Treat external task references as boundaries, not proof

Task numbers #1719 and #1720 are not repository evidence by themselves. Before relying on either:

- record the exact approved scope;
- record its branch/merge SHA;
- prove its files and gates do not leave an RVR-04 requirement unowned;
- keep all currently registered RVR-04-required suites in this task until ownership is demonstrably transferred.

RVR-04 must not claim release-identity or live-like provider proof merely because another ticket exists.

### P2-02 — Refresh comments and inventories

Update manifest comments, pre-deploy text, counts, “optional” descriptions, server-suite counts, and runbook examples after reclassification. Generated evidence must compute counts from the manifest rather than hard-code 82 or any capability subtotal.

---

## 10. Corrected Capability and Network Model

| Execution class | Resources | Network | Credentials | Required result |
|---|---|---|---|---|
| Deterministic static | Source + isolated temp only | None | None | Completion receipt + no writes outside owned temp |
| Deterministic integration | Declared disposable PostgreSQL and/or Redis | Loopback only | Synthetic test secrets only | Migrated resource receipts + completion receipt |
| Server required | Exact denied-server resource receipt | Loopback only | Synthetic users/test secrets only | Server handshake + completion receipt |
| Build artifact | Clean isolated checkout/output | None | None | Exact-SHA artifact inventory/hash + scans |
| External security | Lockfile/source only | Public npm advisory registry only | No application/provider/DB/Redis credentials | Audit artifact bound to lock hash and SHA |
| Operator/live evidence | Separately authorized environment | Explicitly approved endpoints only | Separate operational authority | Never counted as deterministic task pass |

Provider-denied and external-security execution must never share an environment merely for convenience.

---

## 11. Completion Receipt Contract

Minimum receipt shape:

```json
{
  "schemaVersion": 1,
  "certificationRunId": "opaque-run-id",
  "suiteId": "manifest-suite-id",
  "script": "exact/script/path.ts",
  "reviewedSha": "40-character-sha",
  "capability": "server-required",
  "resourceReceiptIds": ["opaque-receipt-id"],
  "requiredCheckpoints": [
    { "id": "anonymous-denied", "executed": true, "assertions": 2 }
  ],
  "fixtureCounts": { "users": 3, "records": 2 },
  "skippedRequired": [],
  "cleanup": { "status": "passed" },
  "terminalStatus": "passed"
}
```

The receipt must contain opaque/synthetic identifiers only. It must not contain PII, secrets, SQL, provider payloads, production URLs, raw rows, or credentials.

---

## 12. Disposable Resource Identity Contract

The harness must prove this relationship:

| Resource | Required binding |
|---|---|
| Git | Exact reviewed SHA and clean tree |
| PostgreSQL | Test-only URL, unique run-owned database/schema marker, full journal head |
| Redis | Unique prefix, reservation token, zero pre-existing keys, zero leftover keys |
| Server | Owned process group, loopback port, run nonce, exact SHA, denial mode |
| Suite | Manifest ID, capability, exact resource receipts, completion nonce |
| Files | Run-owned temp/output path, cleanup inventory |
| Evidence | Run ID, SHA, commands, exit codes, timestamps, result categories |

Database-name pattern matching alone is not proof of ownership. URL equality alone is not proof that fixtures and the server use the same harness-created state.

---

## 13. Auth-Action and CRO-03 Database Corrections

- Add `AUTH_ACTION_DB_TEST_OPT_IN` to the allowlist only through manifest metadata for `server/tests/auth-actions.integration.test.ts`.
- Require exact value `1`; reject it outside `NODE_ENV=test` and the disposable guard.
- Remove suite-local migration 0176 execution.
- Update `scripts/test-cro03-http-authorization.ts` to call the canonical disposable infrastructure guard before database/application imports.
- Use equal `DATABASE_URL` and `TEST_DATABASE_URL` for the denied server and fixture writer.
- Remove the contradictory inequality check and any duplicate approval logic.
- Keep all provider activation variables absent/denied.

---

## 14. CSRF Corrections

The three current scanner failures are narrow public/token-auth browser flows:

- `client/src/pages/PartnerOrgDashboard.tsx:95`
- `client/src/pages/PartnerOrgDashboard.tsx:105`
- `client/src/pages/VerifyEmail.tsx:23`

Add the scanner's required per-call-site `CSRF_EXEMPT` classification with the exact exempt server route and reason. Do not globally weaken the scanner, expand server exemptions, switch unrelated authenticated routes to raw fetch, or add a blanket file-level suppression.

Post-fix proof must show zero unclassified state-changing browser calls.

---

## 15. Pre-Deploy and Delegation Semantics

- Pre-deploy may delegate disposable-only suites to CI, but the local result must say `delegatedPending`, not pass.
- The final task verdict may be COMPLETE only when exact-SHA CI evidence shows each delegated required suite executed and passed.
- Remove hard-coded success totals.
- Persist the category for every suite.
- A missing CI artifact, wrong SHA, stale artifact, or incomplete completion receipt is `notRun`/failure, never inferred pass.
- Statement-acquisition and backlog-preview truth contracts remain unchanged.

---

## 16. Process, Port, and Cleanup Contract

For every owned process:

1. Allocate owned identities before spawn.
2. Spawn in an owned group/tree.
3. Wait for nonce/SHA/denial-mode readiness.
4. Run the declared suite.
5. On normal exit or failure, terminate the group gracefully.
6. Escalate after a bounded grace period.
7. Reap children.
8. Prove the owned port is closed.
9. Prove owned Redis keys are zero.
10. Prove owned temp/artifact paths are removed or intentionally retained as evidence.
11. Preserve the original failure/signal exit code.

Never kill an arbitrary listener, scan and delete another prefix, flush Redis, truncate a shared database, or use broad process-name kills.

---

## 17. Corrected Build Plan

1. **Recapture current main** — exact SHA, clean status, migration head, manifest, workflow, and task prerequisites.
2. **Freeze the resource schema** — add per-suite resource/network/opt-in/timeout/completion metadata without creating a competing manifest.
3. **Repair canonical database use** — auth opt-in, remove local migration execution, and align CRO-03 HTTP with the canonical guard.
4. **Implement run identity and receipts** — one run ID, resource receipts, server handshake, and suite completion receipts.
5. **Strengthen egress denial** — full owned process tree and direct socket surfaces; split npm advisory access.
6. **Reclassify optional suites** — promote/split local safety checks and eliminate required self-skips.
7. **Harden process lifecycle** — owned ports/groups, timeout escalation, signal-safe shell traps, CI wait/verification.
8. **Isolate build and tools** — clean build artifact path, temp HOME/XDG, local locked binaries, explicit npm policy.
9. **Make evidence truthful** — executed/delegated/optional/not-run/failure categories and exact-SHA artifact binding.
10. **Run all gates** — static, integration, server, build, external security, migration, searches, and diff review.

Do not divide these corrections into new cleanup tickets. They are the acceptance work of RVR-04.

---

## 18. Done Looks Like

- Every suite declares exact resources, side effects, network policy, opt-ins, timeout, and completion contract.
- All task-owned required suites execute on exact-SHA CI and produce valid receipts.
- No required suite exits green after skipped setup, missing fixtures, unreachable server, or skipped core checks.
- The full owned process tree is provider/network denied except the separately isolated npm advisory job.
- The auth-action suite uses canonical migrated state and never executes migration SQL.
- The denied server and its HTTP suites share the exact harness-issued database and Redis receipts.
- Two concurrent certification runs cannot collide in database/schema, Redis, port, temp, process, or artifact identity.
- Cleanup removes only owned resources and proves zero owned leftovers.
- Port occupation fails safely without killing another process.
- All local safety portions of formerly optional suites are required.
- Build output is exact-SHA, isolated, scanned, hashed, and reproducible.
- Delegated and optional work is visible and never counted as executed pass.
- Provider activation, production access, deployment, campaign, outreach, and GHL mutation remain absent.

---

## 19. Kill Lines

Stop and return **DO NOT MERGE** if:

- any task-owned required suite can skip and still pass;
- a completion receipt can be forged/reused across run, suite, script, or SHA;
- the auth-action suite still executes production migration SQL;
- provider denial does not cover owned descendants or direct socket paths;
- the npm audit is run inside the no-external-network environment;
- a server-required suite uses a different database or Redis identity than the denied server;
- cleanup can delete an unowned key, process, listener, database, schema, or file;
- an occupied port is resolved by killing the current owner;
- any required local authorization/health/form/ownership test remains optional merely because it currently self-skips;
- `passed=true` can include delegated, skipped, or not-run required work;
- concurrent runs share state;
- production credentials/data, live providers, GHL, deployment, campaigns, or outreach are used;
- a new migration runner, provider-denial authority, manifest, or broad cleanup owner is introduced;
- `db push`, migration-history editing, or production migration execution is used.

---

## 20. Test Requirements

Add or extend focused tests for:

- child environment allowlist and suite-scoped auth opt-in;
- canonical migration bootstrap through 0177 and idempotent rerun;
- rejection of suite-local migration bypass;
- resource receipt mismatch, stale token, wrong run, wrong SHA, and wrong suite;
- same-server database/Redis receipt use;
- two concurrent run identities;
- pre-existing Redis key rejection and zero owned leftovers;
- completion receipt missing, duplicate, stale, empty fixture, skipped checkpoint, failed cleanup, and wrong nonce;
- fetch/http/https/custom-agent/net/tls/DNS/alternate-client/spawned-child denial;
- npm advisory job allowlist and credential absence;
- unreachable denied server as failure;
- formerly optional role, health, form, portfolio, go-live, business-hours, and AI-boundary local checks;
- SIGINT, SIGTERM, timeout, stubborn child, grandchild, port-holding child, and cleanup failure;
- occupied unowned port without termination;
- exact SHA/run nonce/process identity readiness;
- build artifact isolation and concurrent build runs;
- truthful executed/delegated/optional/not-run summary states;
- the three exact CSRF exemptions and rejection of broad suppressions.

Fixtures must be synthetic, nonempty, isolated, and self-verifying. Provider attempts must fail the test immediately.

---

## 21. Required Gates

Run and report exact command, exit code, duration, and result:

1. TypeScript check with incremental state disabled.
2. Production build in the isolated build-artifact workspace.
3. Manifest validation with computed counts.
4. Deterministic static capability.
5. Guarded canonical migration bootstrap and idempotent rerun through 0177.
6. Deterministic integration capability using manifest-declared resources.
7. Denied server startup and all reclassified server-required suites.
8. Process-tree/network-denial focused tests.
9. Completion-receipt and resource-receipt negative tests.
10. Concurrent-run isolation test.
11. External-security npm advisory job or its approved offline-artifact equivalent.
12. CSRF scanner, API coverage, route guard, tracked-file, secrets/privacy, and provider scans.
13. Migration integrity whether or not no migration was added.
14. Release-artifact scan and exact-SHA inventory/hash.
15. `git diff --check`.
16. Final status, stat, and full diff review.

If local execution delegates any gate to CI, final approval must wait for the exact-SHA CI artifact. “Unavailable locally” is not a completed gate.

---

## 22. Post-Build Search Verification

Prove with searches and surrounding-code review that:

- no suite reads or executes migration SQL;
- no `db push`, broad Redis flush, unscoped Redis scan/delete, or production URL fallback exists;
- no arbitrary `lsof`/`fuser` PID list is killed;
- `PORT` and `BASE_URL` derive from the same owned identity;
- no required suite reports a skipped assertion as a pass;
- no required server test exits 0 merely because the server or user is unavailable;
- no provider credential survives child-environment construction;
- no owned child can use fetch/http/https/net/tls/DNS/alternate client/spawned process to bypass denial;
- no implicit `npx` download remains in certification execution;
- no parent HOME/XDG/npm authentication configuration is inherited;
- every task-owned suite has exact capability/resource/completion metadata;
- no delegated/optional/not-run suite is counted as executed pass;
- no production/GHL/provider/deployment/campaign/outreach mutation was added;
- no CR-04 through CR-06 application work leaked into the diff.

---

## 23. Diff Review

Before verdict, capture:

- starting and ending SHA;
- `git status --short`;
- `git diff --stat`;
- full diff;
- migration file/journal status;
- manifest count and classification changes;
- workflow and generated evidence changes;
- package/lockfile changes, if any.

Confirm the diff contains only RVR-04 harness, suite, workflow, and documentation owners. Reject secrets, PII, database dumps, provider payloads, generated application assets, user task attachments, unrelated formatting, lockfile drift, production configuration, or CRM behavior changes.

---

## 24. Final VFC Table Required From Executor

| ID | Requirement | Evidence | Gate | Status |
|---|---|---|---|---|
| VFC-F01 | Exact current-main baseline and clean scope | SHA/status/migration head | baseline capture | PASS/FAIL |
| VFC-F02 | Declarative suite resource contracts | manifest/schema | manifest negative tests | PASS/FAIL |
| VFC-F03 | Canonical migrated database only | runner/test code | bootstrap + bypass scan | PASS/FAIL |
| VFC-F04 | Full-tree provider/network denial | launcher/policy | escape-path tests | PASS/FAIL |
| VFC-F05 | External npm security job isolated | workflow/env | registry/credential test | PASS/FAIL |
| VFC-F06 | Shared run/resource identity | receipts/handshake | concurrent-run tests | PASS/FAIL |
| VFC-F07 | Meaningful suite completion | receipt validation | skip/empty/stale tests | PASS/FAIL |
| VFC-F08 | Required local safety suites execute | manifest/results | server-required gates | PASS/FAIL |
| VFC-F09 | Process/port cleanup is owned | launcher/traps | timeout/signal tests | PASS/FAIL |
| VFC-F10 | Evidence accounting is truthful | report schema | delegation tests | PASS/FAIL |
| VFC-F11 | Build artifact is isolated/exact-SHA | artifact inventory | clean build + scan | PASS/FAIL |
| VFC-F12 | CSRF classifications are narrow | three call sites | CSRF scanner | PASS/FAIL |
| VFC-F13 | No competing authority introduced | diff/search | architecture scan | PASS/FAIL |
| VFC-F14 | No production/external mutation | environment/diff | denial + post-build scan | PASS/FAIL |
| VFC-F15 | Zero owned leftovers | cleanup receipts | post-run verification | PASS/FAIL |

Every Done Looks Like row and every kill line must map to evidence. A blank, delegated, unavailable, or not-run row is not PASS.

---

## 25. Final Response Format

Return:

- **VERDICT:** COMPLETE / VERIFIED, PARTIALLY COMPLETE, or DO NOT MERGE.
- **Repository State:** start/end SHA, branch, tree, migration head.
- **Verified Root Causes and Corrections.**
- **Capability and Resource Contract.**
- **Implementation:** file and line evidence.
- **Suite Inventory:** executed pass/fail, delegated, optional skipped, not run.
- **Tests/Gates:** exact command, exit code, duration, result.
- **Network and Provider-Denial Proof.**
- **Process/Resource Cleanup Proof.**
- **Post-Build and Kill-Line Verification.**
- **Runtime/Operations:** separate isolated proof from production truth.
- **Remaining Risks:** only genuinely external administration or separately owned release evidence.
- **Final Status:** SAFE TO MERGE, SAFE TO MERGE — EXACT-SHA CI VERIFICATION PENDING, or DO NOT MERGE.
- **Branch/PR URL:** never merge or deploy without explicit authorization.

---

## 26. Current Audit Execution Evidence

| Check | Result |
|---|---|
| Fetch and recapture `origin/main` | PASS at `bd36d65dfa635b0efd20e8c3f702754bdf66f71e` |
| Clean detached audit worktree | PASS |
| Manifest check | PASS — 82 suites; 33/29/14/6; no duplicate or unclassified pre-deploy entry |
| Migration integrity | PASS — 400 checks; two historical warnings |
| CSRF scanner | FAIL as expected — exactly three unclassified public/token-auth call sites |
| TypeScript rerun in audit container | INCONCLUSIVE — Node exhausted the container memory limit; not treated as a repository failure or pass |
| Disposable PostgreSQL/Redis suites | NOT RUN in this audit environment |
| Production/provider verification | NOT RUN and not authorized |

The attached plan's reported TypeScript PASS remains executor evidence, not independently reproduced proof from this audit. Exact-SHA CI must supply the acceptance result.

---

## 27. Controlling Addendum — Append to Task #1708

The following directive supersedes any conflicting language in the attached plan:

> Implement RVR-04 on the recaptured current `main` and retain the existing canonical manifest, migration, child-environment, provider-denial, Redis reservation, denied-server, and runner owners. In addition to the task's existing corrections, implement P0-01 through P0-06 and P1-01 through P1-06 in this audit. Do not split these task-owned acceptance requirements into follow-up tickets.
>
> Separate public npm advisory access from provider-denied integration; protect the entire owned process tree and direct socket surfaces; reclassify or split all six server-optional suites so local safety checks are required; remove suite-local execution of migration 0176; bind database, Redis, server, port, process, temp, artifact, suite, and evidence to one run-scoped resource identity; and require validated suite-specific completion receipts.
>
> Use per-suite declarative resource/network/opt-in/timeout/completion metadata. Make all executed, failed, delegated, optional-skipped, not-run, and infrastructure-failed outcomes explicit. Isolate build output, HOME/XDG/npm configuration, and executable resolution. Own the complete process lifecycle and never kill an unowned listener or delete unowned state.
>
> RVR-04 is not complete until all task-owned required suites execute and pass on the exact reviewed SHA. Local infrastructure absence may justify `SAFE TO MERGE — EXACT-SHA CI VERIFICATION PENDING`, but it may not produce COMPLETE/VERIFIED. No production database, live provider, GHL, deployment, campaign, outreach, or CR-04 through CR-06 mutation is permitted.

---

## 28. Practical Review Standard

Block merge for any realistic path to false-green certification, shared-state access, competing migration authority, external-network escape, unowned cleanup, skipped authorization coverage, stale-server testing, resource collision, or production/provider mutation.

Do not block the task merely because genuine production/runtime verification remains separately authorized. Isolated certification must be complete and truthful about that distinction.

---

## 29. Relevant Files

- `.github/workflows/ci.yml`
- `scripts/ci-suite-manifest.ts`
- `scripts/run-ci-suites.ts`
- `scripts/pre-deploy.ts`
- `scripts/run-pre-deploy.sh`
- `scripts/certification-process-env.ts`
- `scripts/certification-provider-deny.ts`
- `scripts/certification-child-process.ts`
- `scripts/test-infrastructure-guard.ts`
- `scripts/test-certification-redis-reservation.ts`
- `scripts/run-denied-certification-server.ts`
- `scripts/run-denied-certification-suite.ts`
- `scripts/run-guarded-canonical-migration.ts`
- `scripts/dependency-audit-policy.ts`
- `scripts/release-artifact-gate.ts`
- `scripts/test-cro03-http-authorization.ts`
- `server/tests/auth-actions.integration.test.ts`
- `scripts/test-statement-acquisition.ts`
- `scripts/test-backlog-preview.ts`
- `server/services/backlog-preview-service.ts`
- `scripts/scan-csrf-fetch.ts`
- `client/src/pages/PartnerOrgDashboard.tsx`
- `client/src/pages/VerifyEmail.tsx`
- `scripts/test-live-health.ts`
- `scripts/test-forms.ts`
- `scripts/smoke-portfolio.ts`
- `scripts/smoke-golive-gate.ts`
- `scripts/test-chat-business-hours.ts`
- `scripts/test-ai-assistant-boundaries.ts`
- `scripts/smoke-role-guards.ts`
- `scripts/test-contactability.ts`
- `migrations/meta/_journal.json`
- `migrations/0176_auth_action_runtime_hardening.sql`
- `migrations/0177_cro03_source_staging_evidence.sql`

---

## 30. Final Audit Status

**Task objective:** valid.  
**Attached plan:** materially improved but incomplete.  
**Build status after this addendum:** **BUILD-READY WITH MATERIAL CORRECTIONS.**  
**Current merge verdict:** not applicable; no RVR-04 implementation was audited.  
**Execution instruction:** send Task #1708 with Section 27 as the controlling addendum, while treating Sections 7–25 as its acceptance contract.
