# Liberty Bancard — Task #1702 Revised-Plan Final Re-Audit

**Task:** RVR-02 — Portable Dependency Remediation  
**Task text audited:** `Pasted markdown(20260828-102016).md`  
**Audit date:** 2026-08-28  
**Authoritative repository SHA:** `2db2f01a0bd489e95a9a4db8c9ea82c591f8ee42`  
**Mode:** Full read-only task-plan audit against live `origin/main`

## 1. Verdict

**VERDICT: BUILD-READY WITH 8 FINAL CORRECTIONS — IMPLEMENTATION REMAINS BLOCKED UNTIL THE OWNER EXPLICITLY AUTHORIZES THE ROOT `package-lock.json` EXCEPTION.**

The revised task successfully closes the ten material omissions identified in the first audit. It now has the correct current SHA, lock/package hashes, advisory counts, migration head, CRO-02 compatibility boundaries, CSV-only XLSX disposition, Nodemailer 9.x correction, WS/OpenAI peer treatment, true transitive owners, two-phase graph contract, and current 67-suite baseline.

This re-audit found **eight genuine remaining corrections**, not a decomposed or inflated requirement count:

| Priority | Count | Meaning |
|---|---:|---|
| P0 | 3 | Must be corrected before implementation begins |
| P1 | 5 | Must be corrected for complete acceptance and merge evidence |
| P2 | 0 | No new follow-up task is required |
| **Total** | **8** | |

The largest remaining problem is not an advisory-version detail. The plan proposes removing unused `ioredis-mock`, but it names only part of the repository's false mock-Redis contract. The live system never constructs an in-memory Redis substitute: `getRedisConnection()` throws without a real `REDIS_URL`, `_usingMock` is never set true, and selected legacy interval workers may run instead. Multiple APIs, dashboards, readiness probes, tests, and documents still report a nonexistent in-memory queue. Removing the package without closing that contract would leave materially false operational status.

## 2. Verified Current Baseline

| Item | Verified result |
|---|---|
| `origin/main` | `2db2f01a0bd489e95a9a4db8c9ea82c591f8ee42` |
| Commit | `Complete CRO-02 shadow commercial resolution and graph fencing` |
| Root package hash | `99a7807aa2411f23cf50e070a790b4154bf705deba89382c0d5d095fe72e6c2f` |
| Root lock hash | `4398e255a8e38c221417ff006d11a53387eca4f8ee2bd7342f9b050ee02e80c4` |
| Lock | npm v3; 1,012 non-root entries |
| Resolution hosts | 921 public npm + 91 Replit-internal HTTP |
| SRI | Present on all 1,012 resolved entries |
| Audit | 31 total: 18 high, 11 moderate, 2 low, 0 critical |
| Manifest | 67 suites: 22 static, 26 integration, 13 server-required, 6 optional |
| Migration head | `0173_cro02_graph_lock_order`, journal index 177 |
| Migration integrity | PASS: 388 checks, two historical warnings |
| CRO-01 static baseline | FAIL: obsolete line-80 prohibition against migration 0166 |
| Dynamic Drizzle identifiers | Exactly four current sites: commercial resolution 377/450 and classification authority 605/834 |

The task is correct that #1700 did not change `package.json`, `package-lock.json`, CI install commands, `replit.md`, `scripts/post-merge.sh`, or `.replit`. The intervening #1701 merge changed `.replit` port mappings only; it did not change the Node module line. No wait on #1700 is required.

## 3. Confirmed Package and Advisory Corrections

The revised task correctly repaired the earlier package assumptions:

- Nodemailer `8.0.7` is affected by advisories through `<=9.0.0`; `9.0.1` is the first current 9.x version outside that reported range.
- WS `8.18.0` satisfies OpenAI `6.18.0`'s optional `ws@^8.18.0` peer and is affected below `8.21.0`.
- Multer `2.0.2` is affected; `2.2.0` is a current fixed target.
- Vite `7.3.0` is affected; current 7.x fixed releases require Node `^20.19.0 || >=22.12.0`.
- Drizzle ORM `0.39.3` is affected below `0.45.2`.
- Sharp `0.34.5` is affected below `0.35.0`; current fixed `0.35.4` requires Node `>=20.9.0`.
- `xlsx@0.18.5` remains affected with no npm audit fix and is executable on three web import paths plus two historical scripts.
- Vulnerable `minimatch@9.0.5` is owned by Tailwind → Sucrase → Glob, not Archiver.
- Archiver → readdir-glob owns the vulnerable `brace-expansion@5.0.6` placement.
- `ioredis-mock` has no live source import and owns the current Fengari/tmp chain.

## 4. P0 Corrections

### P0-01 — Correct the Node/npm contract to what Replit can actually enforce

The task says to pin an exact Node/npm contract everywhere, including `.replit`. The current `.replit` module declaration selects a **Node major module line** (`nodejs-20`); it does not prove an exact patch pin. Treating that as an exact pin would create a false VFC.

**Exact correction:**

1. Select a supported, non-EOL Replit Node module line only after verifying it is available.
2. Put a compatible Node range in `package.json.engines`, not an unsupported claim of an exact Replit patch.
3. Put the exact npm lock-generator version in `packageManager`.
4. Pin an exact Node patch and npm version in GitHub CI.
5. Add a pre-install toolchain assertion that runs before `npm ci` and verifies:
   - CI uses the exact certified Node/npm pair;
   - Replit uses the approved Node range and exact npm version; and
   - unsupported/EOL versions fail before lock generation or installation.
6. Record the actual Replit Node patch in each clean-install proof; do not claim `.replit` alone freezes it.

The current Node 20 runtime is already EOL in August 2026. It may be used only as evidence of current state, not selected as the new supported contract.

**Kill line:** Stop if the selected Replit module is unavailable, the Replit patch is outside the approved range, npm differs from the lock generator, or the same lock/tree cannot be reproduced.

### P0-02 — Expand Multer coverage from the incorrect 15-site count

The plan says Multer must cover “all 15 shared middleware call sites.” Live source has:

- **16 registrations** through the shared `upload` / `uploadLarge` instances; and
- **1 additional registration** through the separate `wizardUpload` instance.

The affected registration surface is therefore **17**, across three Multer configurations.

**Exact correction:**

- Inventory all registrations dynamically; do not hard-code 15 as final truth.
- Prove the three configurations independently:
  - shared memory upload (`upload`);
  - shared 300 MB disk upload (`uploadLarge`); and
  - 5 MB wizard memory upload (`wizardUpload`).
- Add a static ownership test that fails if a new Multer constructor or registration appears without classification.
- Cover all 17 current registrations with route-contract preservation, while concentrating adversarial abort, nested-field, resource-limit, disk-cleanup, memory-bound, and multipart-error tests at the three configuration authorities.
- Preserve each route's existing authentication, role, object scope, field name, file count, MIME/extension policy, error envelope, and cleanup behavior.

**Kill line:** Stop if any Multer constructor/registration is unclassified or if disk/memory cleanup, authorization, limits, or error contracts regress.

### P0-03 — Replace the complete false `ioredis-mock` runtime contract

The task correctly identifies `ioredis-mock` as unused, but its named cleanup list is incomplete. Current truth:

- `server/services/queue-connection.ts` never imports or constructs `ioredis-mock`;
- `_usingMock` is initialized false and never set true;
- missing/unreachable Redis causes QueueManager initialization to fail;
- selected existing interval workers may operate, but there is no in-memory BullMQ queue or durable-equivalent mock.

False or stale mock-mode behavior/copy exists across at least:

- `replit.md:54`
- `docs/launch-env-checklist.md:125`
- `scripts/go-live-check.ts:149-151`
- `scripts/test-bullmq-resilience.ts:8-13` and its skip-as-pass behavior
- `scripts/test-outbound-system.ts:849`
- `scripts/test-outbound-readiness.ts:226`
- `server/routes/wizard.ts:112-120,231,644-686`
- `server/routes/activation.ts:609`
- `server/routes/admin.ts:1018,3042,3089,3254,4312-4313`
- `server/services/integration-validator.ts:120-121`
- `server/services/system-audit/probes/queues.ts:69-71`
- `server/services/launch-readiness-full.ts:619-636`
- `server/services/queue-connection.ts:22-25`
- `server/services/queue-manager.ts` topology/metrics `usingMock*` projections
- `server/routes/queue-metrics.ts`
- `client/src/pages/dashboard/SetupWizard.tsx`
- `client/src/pages/dashboard/SystemReadiness.tsx:456`
- `client/src/pages/dashboard/ActivationPanel.tsx`
- `client/src/pages/dashboard/OperatorDashboard.tsx`

**Exact correction:**

1. Remove `ioredis-mock` from the root graph and confirm Fengari/Fengari-interop/tmp disappear if no other owner remains.
2. Replace the dead mock boolean as the canonical contract with an explicit, truthful queue mode such as:
   - `bullmq_redis` — real Redis/BullMQ available;
   - `legacy_interval_partial` — only specifically claimed legacy interval jobs are active; or
   - `unavailable` — no queue execution authority is available.
3. Preserve compatibility adapters only where required, but never label a non-mock state “mock.”
4. Update every server DTO, dashboard, readiness probe, launch check, test, and current documentation consumer.
5. Rewrite `test-bullmq-resilience.ts` so required CI proof uses isolated real Redis. It must not pass by catching QueueManager initialization failure and calling the test “skipped.”
6. State exactly which legacy jobs continue without Redis; do not imply all BullMQ jobs have setInterval equivalents.

**Kill line:** Stop if any current operator surface reports in-memory/mock Redis, if a required queue test passes by skip, or if missing Redis can be presented as a healthy/durable queue state.

## 5. P1 Acceptance Corrections

### P1-01 — Correct the esbuild placement statement

The lock has 11 install-script entries, but **three**, not two, are esbuild placements:

1. root `node_modules/esbuild@0.25.12`;
2. `node_modules/vite/node_modules/esbuild@0.27.2`; and
3. `node_modules/drizzle-kit/node_modules/@esbuild-kit/esm-loader/node_modules/esbuild@0.27.2`.

Classify and probe all three. The third belongs to the Drizzle-kit/aliased-tsx toolchain. A safe probe may verify module/CLI loading but must never run `db push`.

### P1-02 — Do not treat the esbuild allowlist as artifact proof

`script/build.ts:7-33` makes packages bundle-eligible. It does not by itself prove every allowlisted package is present in `dist/index.cjs`; tree-shaking and dynamic/optional imports can change inclusion. In particular, WS is allowlisted and satisfies an OpenAI optional peer, but source/allowlist evidence alone does not prove its final bundle location.

Change P0-10 to say:

> The allowlist establishes bundle eligibility. The esbuild metafile, final external inventory, client metadata, and lock join establish actual artifact reachability.

Do not pre-classify an allowlisted package as bundled before the build evidence exists.

### P1-03 — Remove the RVR-04 ownership contradiction

The task correctly says #1708 is the current Draft RVR-04 and coordinates CI/certification files. P0-17 later says “RVR-04/RVR-05 are absent,” which contradicts that state.

Replace it with:

> RVR-01 is merged; #1703 (RVR-03) and #1708 (RVR-04) are Drafts; no current RVR-05 task was found. Drafts are not prerequisites, but any task that becomes active before implementation creates a shared-file coordination fence.

### P1-04 — Treat 67 as the starting suite count, not final truth

The current manifest has 67 suites, but RVR-02 adds lock-policy, graph-fingerprint, lifecycle/native, advisory-policy, package-security, and artifact-dependency tests. If these are mandatory, the final manifest may exceed 67.

Replace “the dynamically current 67-suite manifest” in Done Looks Like with:

> The 67-suite starting manifest plus every new mandatory RVR-02 suite is classified, validated, and executed; the final response reports the discovered ending count.

No test may be omitted merely to retain the number 67.

### P1-05 — Restore the executable acceptance package

The revised task contains strong prose requirements but dropped the prior report's explicit gate list, post-build searches, final VFC table, and final response contract. Restore them so the executor cannot satisfy broad prose with partial evidence.

At minimum, require exact command, exit, and result for:

- authorization/task-overlap/toolchain preflight;
- root lock URL/SRI/freshness/fingerprint scanner and negative fixtures;
- all 91 public tarball/SRI verifications;
- Phase-A invariant comparison;
- cold external, clean Replit, and warm-cache installs;
- `npm ls --all` and post-install lock/package immutability;
- full and omit-dev machine-readable audits plus fail-closed policy tests;
- all three esbuild placements and all required lifecycle/native probes;
- all three Multer configurations and the 17-registration inventory;
- CSV-only/XLSX-denial tests and zero executable XLSX import scan;
- Nodemailer, WS/OpenAI peer, Vite/Rollup, Drizzle, Sharp, route/IP, scraper, chart, archive, and queue-mode regressions;
- manifest validation and the final discovered static/integration/server-required capabilities;
- disposable migration bootstrap and idempotency through 0173;
- `npm run check`, release artifact build/gate, credential scan, and dependency-artifact inventory;
- API/route coverage where affected;
- required post-build searches;
- `git diff --check`, status, stat, and full staged/unstaged diff review.

Restore a final VFC covering owner authorization, toolchain, exact Phase-A graph, 91 SRI matches, two-environment installs, locked CI/post-merge, lifecycle completeness, advisory closure, XLSX removal, Multer/Nodemailer/WS, Drizzle/Sharp, transitive closure, artifact inventory, honest audit policy, complete suite gates, file fences, secrets/diff hygiene, and zero production/external mutation.

Require exactly one final merge result: `SAFE TO MERGE`, `SAFE TO MERGE — RUNTIME VERIFICATION PENDING`, or `DO NOT MERGE`, plus starting/ending SHA, hashes, toolchain, migration head, authorization evidence, phase-separated diffs, advisory matrix, exact command exits, residual actions, and branch/PR URL.

## 6. Corrected Final Verdict

After the eight corrections above are inserted:

**PREFLIGHT VERDICT: BUILD-READY.**  
**IMPLEMENTATION AUTHORITY: BLOCKED UNTIL EXPLICIT ROOT-LOCK OWNER APPROVAL.**

The approved owner statement may be:

> I authorize Task #1702 as a one-task exception to `replit.md:10` for changes to the root `package-lock.json` only, within the audited RVR-02 scope. This does not authorize edits to `node_modules`, the Mockup Sandbox graph, migrations, production systems, providers, deployment, or unrelated dependency modernization.

No dependency on merged #1700 remains. Draft #1703 and #1708 are coordination checks only unless either becomes active before implementation.

## 7. Controlling Addendum to Send to Replit

Append this section to the revised Task #1702. It supersedes conflicting text.

---

### TASK #1702 FINAL CONTROLLING CORRECTIONS

1. Treat `.replit` as selecting an approved Node module line, not proving an exact patch. Use a supported Node range in `engines`, exact npm in `packageManager`, an exact Node/npm pair in CI, a pre-install version assertion, and recorded Replit runtime proof. Current Node 20 is EOL and cannot be selected as the new contract.

2. Correct Multer scope: live code has 16 shared `upload`/`uploadLarge` registrations plus one separate `wizardUpload` registration, for 17 total across three configurations. Inventory all dynamically; test every configuration and preserve every route contract. Do not hard-code 15.

3. Remove `ioredis-mock` only with complete runtime-truth closure. Replace the dead `usingMock*` contract across queue connection/manager, routes, APIs, dashboards, readiness/launch probes, tests, and current docs with truthful `bullmq_redis`, `legacy_interval_partial`, or `unavailable` semantics. Required tests must use isolated Redis or assert failure truthfully; skip-as-pass is forbidden. Do not claim all BullMQ jobs have interval fallbacks.

4. Correct lifecycle evidence: the 11 install-script entries include three esbuild placements—root, Vite-nested, and Drizzle-kit/aliased-tsx-nested. Classify/probe all three without running `db push`.

5. Treat `script/build.ts` allowlisting as bundle eligibility only. Use esbuild/Vite metadata, final external inventory, and lock joining to establish actual artifact reachability, including WS/OpenAI optional-peer disposition.

6. Correct ownership text: #1703 (RVR-03) and #1708 (RVR-04) are Drafts; no current RVR-05 task was found. Drafts are not prerequisites, but an overlapping task that becomes active creates a shared-file coordination fence.

7. Treat 67 as the starting suite count. Register and run every new mandatory RVR-02 suite and report the discovered final count; never omit a test to preserve 67.

8. Restore explicit required gates, post-build searches, final VFC, and final response structure. Report exact commands/exits, phase-separated diffs, hashes, 91 SRI results, install trees, advisory/artifact matrix, package-specific gates, full capability results, migration proof through 0173, diff/kill-line review, and exactly one merge status. Missing required proof is `DO NOT MERGE`, not an inferred pass.

All other revised-task requirements remain controlling. No implementation may begin until the owner explicitly approves the narrow root-lock exception.

---

## 8. Audit Execution Evidence

| Command/check | Exit | Result |
|---|---:|---|
| `git fetch --prune origin` and `git rev-parse origin/main` | 0 | Current main confirmed at `2db2f01a...` |
| Root package/lock SHA-256 | 0 | Matches revised task |
| Lock URL/SRI inventory | 0 | 921 public, 91 internal, all 1,012 with SRI |
| `npm audit --package-lock-only --json` | 1 | Expected finding exit; 31 total, 18 high, 11 moderate, 2 low |
| `node scripts/ci-suite-manifest.ts --check` | 0 | 67 suites valid |
| `node scripts/check-migration-integrity.ts` | 0 | 388 checks passed; two historical warnings |
| `node scripts/test-cro01-revenue-contract-static.ts` | 1 | Reproduced obsolete migration-0166 assertion failure |
| Dynamic identifier inventory | 0 | Exactly four current `sql.identifier` sites |
| Install-script inventory | 0 | 11 entries, including three esbuild placements |
| Multer registration inventory | 0 | 16 shared + one wizard registration |
| XLSX executable/UI/doc inventory | 0 | Revised task's three web paths, two scripts, UIs/docs confirmed |
| Nodemailer/WS package metadata checks | 0 | Revised fixed-line/peer corrections confirmed |
| Mock-Redis source inventory | 0 | No live mock import; broader false contract confirmed |
| Detached worktree status | 0 | Clean audit worktree; user's unrelated checkout changes untouched |

Dependency-backed type/build/integration/server gates were not rerun because the committed lock still cannot complete a portable installation in this environment. That is the task's confirmed defect, not a write-permission limitation. No application, migration, database, provider, SMTP, deployment, campaign, or production operation was invoked.
