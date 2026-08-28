# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD

Verify every dependency, advisory, lockfile, workflow, and installation claim against current remote `main`. If materially valid, correct the task and implement the smallest safe repair in the same run. Do not use a lockfile bypass as proof of reproducibility, blindly upgrade major versions, add unrelated dependencies, or weaken tests to obtain a green result.

Required sequence:

Repository baseline → certification prerequisite → VFC → dependency/lock inventory → reachability and ownership → root cause → blast radius → data/auth/concurrency/external checks → verdict → corrected plan → kill lines → implementation → clean-install/security gates → post-build searches → diff review → final VFC → merge verdict.

**Absolute audit rule:** Do not stop after the first high advisory, install failure, or merge blocker. Audit every current high and every install owner, then return a complete P0/P1/P2 matrix with exact remediation, deferral owner, tests, and release effect.

## 1. TASK IDENTITY

**RVR-02 — Portable Dependency Installation and Reachable Supply-Chain Remediation**

**Primary evidence:** August 27 VG certification reported 31 high, 39 moderate, and 6 low dependency findings; current-main drafting inspection found 91 `package-firewall.replit.local` resolutions and CI installation using `npm install ... --package-lock=false`.

**Runtime row supported:** `RV-CI-01`.

**Parallelism:** May run beside CRO-01 on a separate branch. Own only package metadata, lockfile, dependency workflow installation, and dependency-specific source adaptations. Do not touch CRO-01 routes/services/tests or `scripts/ci-suite-manifest.ts` without explicit coordination.

## 2. WHAT & WHY

The repository’s declared dependencies can be installed inside Replit/CI because current workflows ignore the lockfile, while independent `npm ci` attempts can fail on Replit-internal absolute tarball URLs. That defeats deterministic supply-chain proof and can cause auditors, clean clones, and release environments to resolve different dependency graphs. The certification also found high advisories, but advisory counts alone do not prove exploitability or justify destabilizing upgrades.

Make the lockfile portable and authoritative, make CI consume it, classify every current high advisory by runtime reachability and fix availability, and remediate safe reachable findings without broad framework churn.

## 3. BASELINE AND PREREQUISITE

Drafting baseline to recapture independently:

- `origin/main`: `c5d0baa8c697778caccaed4dba74e456c9a07063`.
- Migration head: `0165_outbound_send_claim_lease`; no migration expected.
- Current `package.json` declares Node/TypeScript application dependencies and scripts.
- Current drafting count: 91 lockfile `resolved` URLs reference `http://package-firewall.replit.local/npm/`.
- Current CI uses `npm install --include=dev --ignore-scripts --no-audit --no-fund --package-lock=false` in static and integration jobs.
- An independent `npm ci` failed at `zip-stream@7.0.5` because the internal tarball URL returned 404.
- August 27 certification counts must be rerun; they are historical claims, not current advisory truth.

Capture branch, HEAD, remote SHA, tree state, Node/npm versions, package manager configuration, package/lock hashes, install commands across workflows/scripts/deployment, and current audit output without printing environment credentials.

## 4. VERIFIED FROM CODE — PREFLIGHT

| ID | Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | Lockfile contains environment-private resolutions | CONFIRMED/PARTIAL/FALSE/OUTDATED | Count, schemes, hosts, affected packages | lockfile metadata |
| VFC-02 | Clean `npm ci` is non-portable | CONFIRMED/PARTIAL/FALSE/OUTDATED | Reproduction in clean temporary worktree | command/exit only |
| VFC-03 | CI bypasses the lockfile | CONFIRMED/PARTIAL/FALSE/OUTDATED | Exact install commands | workflow evidence |
| VFC-04 | High advisories remain | CONFIRMED/PARTIAL/FALSE/OUTDATED | Current production/dev counts and advisory IDs | redacted audit artifact |
| VFC-05 | Each high advisory is reachable | CONFIRMED/PARTIAL/FALSE/OUTDATED | Import/bundle/runtime path and fix version | source/build evidence |
| VFC-06 | Integrity hashes permit portable regeneration | CONFIRMED/PARTIAL/FALSE/OUTDATED | Version/integrity comparison | lock diff |

Do not treat package name presence, an `npm audit` count, or a transitive path as proof of a production exploit.

## 5. REQUIRED SEARCHES AND CLASSIFICATION

Inspect:

- every package manager file, `.npmrc`, Replit config, Docker/deploy script, post-merge script, GitHub workflow, cache key, and install command;
- every internal/private `resolved` URL and any missing/changed integrity field;
- production, development, build-only, optional, and transitive dependency paths;
- imports/usages of each high-advisory package, server bundle inclusion, browser bundle inclusion, and exposed input boundary;
- existing dependency/security scanners and artifact retention;
- native/build scripts currently suppressed by `--ignore-scripts` and whether the application genuinely requires them.

Produce an advisory disposition table: advisory/package, installed path, production/dev, reachable/unreachable/unknown, fixed version, semver impact, code adaptation required, test owner, and action.

## 6. ROOT CAUSE AND SOURCE OF TRUTH

Verify whether the root cause is a lockfile generated through an environment-specific registry plus workflows deliberately bypassing it. Correct the workflow and lockfile together; neither is sufficient alone.

- `package.json` owns declared intent.
- `package-lock.json` owns exact versions/integrities/resolution.
- Current CI workflow owns clean-install enforcement.
- Existing build/typecheck/security tests own compatibility proof.
- Do not introduce Yarn, pnpm, a second lockfile, or a custom downloader.

## 7. BLAST RADIUS

### In scope

- Portable lockfile regeneration using the standard public registry or approved portable registry.
- Exact preservation of dependency versions where possible.
- CI change from lockfile-bypassing install to deterministic clean install.
- Current advisory rerun, reachability classification, and safe patched-version upgrades.
- Minimal source adaptations required by approved non-breaking/security upgrades.
- Reproducible audit artifacts containing IDs/counts/paths but no credentials.

### Out of scope

- Broad dependency modernization, framework migration, package-manager replacement, formatting sweep, or speculative major upgrades.
- Disabling audit failures, ignoring reachable highs without owner/expiry, or pinning known-vulnerable versions merely to preserve tests.
- Production configuration, CRM behavior, provider calls, deployment, schema, or data changes.

## 8. DATA, AUTHORIZATION, CONCURRENCY, AND EXTERNAL EFFECTS

**Migration required: NO.** Dependency installation may download public packages but must not execute application migrations, seeds, provider calls, or production startup. Never print registry credentials/tokens. Do not configure global npm credentials.

Clean-install proof must run in new temporary directories at least twice, with an empty `node_modules`, unchanged lockfile hash, and deterministic dependency tree. Parallel CI jobs must share caches only by lockfile hash and must not mutate or rewrite the lockfile.

Repository administrators own required-check/branch-protection activation; this task may prepare workflow changes but cannot claim protection was enabled without direct evidence.

## 9. PREFLIGHT VERDICT

Use exactly one Liberty verdict. If the lockfile and CI are already portable and every high is either safely fixed or explicitly non-reachable with evidence, return `NOT NEW TASK`. If major upgrades would materially expand scope, complete portable-lock/CI work and safe independent upgrades, then split only the blocked package family with exact justification.

## 10. CORRECTED BUILD PLAN

1. Recapture current dependency graph, install surfaces, and current advisory results.
2. Reproduce clean-install behavior outside the preexisting `node_modules`.
3. Regenerate the lockfile through an approved portable registry without manual mass substitution and compare versions/integrities.
4. Make CI and release scripts use the lockfile deterministically.
5. Classify every high advisory by reachability and fix path.
6. Apply smallest safe patched/minor upgrades first; adapt code only where required.
7. For any necessary major upgrade, prove scope and either complete it safely or isolate it as a blocking follow-up.
8. Run two clean installs, dependency-tree comparison, security audit, typecheck, build, and all affected suites.
9. Confirm no lockfile drift occurs during tests/build.

## 11. DONE LOOKS LIKE

- A clean portable environment can run `npm ci` from the checked-in lockfile.
- CI no longer hides lockfile defects with `--package-lock=false`.
- Repeated clean installs produce the same dependency tree and unchanged lockfile.
- Every current high advisory has a reviewed, evidence-backed disposition.
- Every reachable fixable high is remediated or explicitly blocks merge.
- No application migration, production data, deployment, or provider was touched.

## 12. KILL LINES

- **KILL LINE:** If required CI can pass while ignoring or rewriting the committed lockfile, the task has failed.
- STOP if private registry credentials or URLs containing credentials are committed or printed.
- STOP if lockfile integrity/version changes are unexplained.
- STOP if `npm audit --force`, blanket overrides, broad major upgrades, or disabled tests conceal compatibility risk.
- STOP if a reachable high is marked accepted without owner, evidence, expiry, and explicit release decision.
- STOP if install/build scripts perform production mutation or external provider activity.

## 13. TESTS AND GATES

Required applicable proof:

- clean `npm ci` twice in disposable directories;
- lockfile hash and `npm ls --all`/equivalent tree comparison;
- production-only and full dependency audits with machine-readable artifacts;
- focused tests for affected dependency consumers;
- capability manifest, deterministic-static, integration/server suites where affected;
- `npm run check`, `npm run build`, build-artifact scan, and `git diff --check`;
- current CI workflow on exact SHA.

Report actual commands, exit codes, counts, and advisory dispositions. Do not call local installation proof branch-protection or deployed-runtime proof.

## 14. POST-BUILD SEARCH AND DIFF REVIEW

Prove there is no Replit-only/private absolute tarball resolution, no lockfile-bypass install in required workflows, no second lockfile/package manager, no audit-disable flag, no unexplained dependency change, and no CRO/CRM/provider/schema change. Review full diff and generated artifacts.

## 15. FINAL VFC AND RESPONSE

| ID | Requirement | Evidence | Test/Gate | Status |
|---|---|---|---|---|
| VFC-F01 | Portable deterministic install | lock/workflow | two clean installs | PASS/FAIL |
| VFC-F02 | Lockfile required by CI | workflow | exact-SHA CI | PASS/FAIL |
| VFC-F03 | High advisories dispositioned | audit matrix | security gate | PASS/FAIL |
| VFC-F04 | Reachable highs remediated | package/source diff | focused regressions | PASS/FAIL |
| VFC-F05 | No production/external mutation | diff/log | review | PASS/FAIL |

Return verdict, repository state, exact dependency before/after, verified root cause and corrections, implementation `file:line`, tests/gates, grep verification, kill lines, runtime/operations boundary, realistic residual advisories, and final merge status. Never merge, deploy, or alter branch protection without explicit authorization.

## 16. RELEVANT FILES

- `package.json`
- `package-lock.json`
- `.npmrc` or Replit/package-manager configuration if present
- `.github/workflows/ci.yml`
- `scripts/post-merge.sh`
- `scripts/pre-deploy.ts`
- `scripts/run-pre-deploy.sh`
- `scripts/scan-build-artifacts.ts`
- current dependency/SAST workflow owners discovered in preflight
- minimal consumers of approved upgraded packages
- August 27 certification artifacts

## FINAL DIRECTIVE

Do not solve portability by ignoring the lockfile and do not solve advisories by destabilizing the application. Establish one portable graph, classify reachability, repair safe current defects, and transparently isolate only genuinely incompatible upgrade work.
