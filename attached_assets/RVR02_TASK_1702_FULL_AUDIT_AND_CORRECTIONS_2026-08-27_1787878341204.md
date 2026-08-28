# Liberty Bancard — Task #1702 RVR-02 Full Audit and Controlling Corrections

**Task audited:** `#1702 - Portable Dependency Supply Chain`  
**Task identity:** RVR-02 — Portable Dependency Installation and Reachable Supply-Chain Remediation  
**Audit date:** 2026-08-27  
**Authoritative audited SHA:** `2f463398029fdc5adcd992ac4f068f81a2dfe640`  
**Audit mode:** Full read-only repository, lock, registry metadata, CI/release, reachability, lifecycle, advisory, security-boundary, test, and diff review in disposable worktrees

## 1. Executive Verdict

**VERDICT: NOT BUILD-READY AS WRITTEN — BUILD-READY ONLY AFTER OWNER AUTHORIZATION AND THE CONTROLLING CORRECTIONS IN SECTION 18.**

The root problem is confirmed and more severe than the draft’s `PREFLIGHT REQUIRED` wording suggests:

- the root lock contains 91 plain-HTTP Replit-internal tarball URLs;
- GitHub Actions deliberately ignores the committed lock in both required jobs;
- a real clean install outside Replit fails on those internal URLs;
- the current toolchain is not frozen across Replit, CI, and independent execution;
- the install policy suppresses lifecycle scripts without proving native/build compatibility;
- several high advisories are actively reachable; and
- `xlsx` has no fixed release on the public npm registry while three application paths parse uploaded workbooks.

The task is directionally correct but cannot safely combine lock portability and advisory upgrades without two separately verified phases. Portability normalization must preserve the current dependency graph exactly; security remediation must then make explicit, reviewed graph changes. A single regenerated lock diff cannot prove both.

The repository’s lock prohibition is also genuine owner-authored policy, not a stale agent comment. `replit.md:10` was committed by `scott1013` on 2026-02-10. This audit does not override it. The owner must expressly authorize Task #1702 as a narrow exception for the root `package-lock.json` before build work begins.

### Correction count

| Priority | Count | Meaning |
|---|---:|---|
| P0 | 17 | Must be resolved before implementation or merge |
| P1 | 11 | Required for complete, reproducible acceptance |
| P2 | 5 | Follow-up hardening with an assigned owner |
| **Total** | **33** | |

## 2. Exact Repository Baseline

| Item | Verified state |
|---|---|
| Remote | `https://github.com/scottpstevenson/Liberty-Bancard-Website-and-CRM.git` |
| `origin/main` | `2f463398029fdc5adcd992ac4f068f81a2dfe640` |
| Commit date | `2026-08-27T20:27:28Z` |
| Subject | `Establish canonical revenue read and conversion contracts` |
| Parent | `2cf2ba72895cf58489177c022abe9794c1515a25` |
| Audit worktree | Clean detached worktree at exact `origin/main` |
| Root package manager | npm; lockfile version 3 |
| Root lock entries | 1,013 package entries; 1,012 dependencies in current audit metadata |
| Root lock hash | `4398e255a8e38c221417ff006d11a53387eca4f8ee2bd7342f9b050ee02e80c4` |
| Root package hash | `99a7807aa2411f23cf50e070a790b4154bf705deba89382c0d5d095fe72e6c2f` |
| Registry resolution hosts | 921 `registry.npmjs.org`; 91 `package-firewall.replit.local` |
| Resolved entries without integrity | 0 |
| CI baseline | 63 suites: 20 deterministic-static, 25 deterministic-integration, 12 server-required, 6 server-optional |
| Migration head | `0165_outbound_send_claim_lease`; no RVR-02 migration is authorized |

The user’s existing checkout remains on an older branch with unrelated media modifications. It was not touched. Disposable worktrees were used for the install and static evidence.

## 3. Toolchain and Install Reality

The task’s observed Node/npm versions are not a repository contract.

| Surface | Current version/configuration |
|---|---|
| Replit `.replit` module | `nodejs-20` |
| GitHub Actions | `node-version: "22"` without an exact patch/npm pin |
| Task preflight observation | Node `22.17.0`, npm `10.8.2` |
| Independent audit environment | Node `24.19.0`, npm `11.9.0` |
| `package.json` | No `engines`, no `packageManager`, no Volta/toolchain pin |

That mismatch is a P0 because npm major/minor differences can rewrite lock metadata, optional-package layout, peer resolution, and platform selection. Replit’s Node 20 line is also now outside the current CI line and must be deliberately aligned or explicitly certified as a supported runtime.

### Real install result

`npm ci --include=dev --ignore-scripts --no-audit --no-fund --dry-run` exits 0, but a dry run does not fetch/unpack the tarballs and is not portability proof.

The real disposable command:

```bash
npm ci --include=dev --ignore-scripts --no-audit --no-fund
```

failed with exit 1. The npm log records repeated 404s for the internal host and terminates with:

```text
E404 404 Not Found - GET http://package-firewall.replit.local/npm/zip-stream/-/zip-stream-7.0.5.tgz
```

The public npm registry does publish `zip-stream@7.0.5`; its public tarball URL is `https://registry.npmjs.org/zip-stream/-/zip-stream-7.0.5.tgz`, and its registry SRI exactly matches the committed lock SRI. That proves the representative normalization path is plausible. It does not substitute for verifying all 91 internal entries.

Therefore Task VFC-02 must be corrected from “historical failure outdated” to:

> **CONFIRMED ENVIRONMENT-BOUND FAILURE.** Replit-local installation may succeed, but a current independent real install fails from the committed lock. A Replit-local success is not portability evidence.

## 4. Corrected VFC Table

| ID | Task claim | Audit verdict | Verified reality / correction |
|---|---|---|---|
| VFC-01 | Root lock has 91 Replit-internal resolutions | **CONFIRMED** | Exactly 91 root-lock package entries use `http://package-firewall.replit.local`; all carry SRI. |
| VFC-02 | Prior clean-install failure is outdated | **FALSE OUTSIDE REPLIT** | Dry run passes, but a real external clean install currently fails with internal-host 404s, including `zip-stream@7.0.5`. |
| VFC-03 | Required CI ignores the lock | **CONFIRMED** | Static and integration jobs both use `npm install ... --package-lock=false`. Commit `2009f82` replaced prior `npm ci` after instability. |
| VFC-04 | Current audit counts are 31/18-high and 28/16-high | **CONFIRMED AS OF AUDIT** | Full: 0 critical, 18 high, 11 moderate, 2 low. `--omit=dev`: 0 critical, 16 high, 11 moderate, 1 low. Counts are volatile, not acceptance constants. |
| VFC-05 | High families are all equivalent runtime risks | **FALSE** | They span server runtime, client bundle, build-only, optional/native, remote-input, admin-upload, and apparently unused direct paths. Reachability must be artifact/purpose-specific. |
| VFC-06 | Lock integrity metadata is sufficient | **PARTIAL** | SRI exists, but every normalized public tarball must match it and the phase-A graph must be identical apart from approved URL/tool metadata. |
| VFC-07 | Lockfile ownership is unresolved | **CONFIRMED** | The prohibition is an explicit owner preference. Task approval must state the narrow exception; the executor cannot infer it. |
| VFC-08 | Node/npm baseline is portable | **FALSE** | Replit Node 20, CI Node 22, task Node/npm 22.17/10.8.2, and independent Node/npm 24/11 disagree; no repository pin exists. |
| VFC-09 | `--ignore-scripts` is proven safe | **FALSE** | Eleven locked packages declare install scripts, including `esbuild`, `sharp`, `ssh2`, `bufferutil`, and `msgpackr-extract`. Current CI passes some gates, but native/build artifact completeness is not independently certified. |
| VFC-10 | `npm audit --omit=dev` equals production reachability | **FALSE** | The production bundle embeds an allowlist, externalizes other dependencies, and the client bundle ships separate code. npm’s dev flags alone do not describe deployed reachability. |
| VFC-11 | Existing artifact scan verifies dependency closure | **FALSE** | `scan-build-artifacts.ts` scans credential patterns only; it does not identify bundled/external vulnerable packages or produce an SBOM. |
| VFC-12 | XLSX can be dispositioned as an ordinary deferred high | **FALSE / P0** | Public npm latest is still `xlsx@0.18.5`, audit reports no fix, and live admin/manager upload paths parse XLSX/XLS files. Exposure must be removed/replaced or the task is DO NOT MERGE. |
| VFC-13 | Direct major fixes are small lock changes | **FALSE** | Drizzle requires `0.39.3 → 0.45.2`; Sharp requires `0.34.5 → 0.35.4`. npm classifies both as semver-major fixes. |
| VFC-14 | CI is the only unlocked install surface | **FALSE** | `scripts/post-merge.sh` uses fallback `npm install`; running it also executes migrations and direct SQL. Its install line is in scope, but the script must never be executed by this task. |
| VFC-15 | Mockup Sandbox can be ignored by every scanner | **PARTIAL** | Its graph is out of scope, but root scanners/cache paths must explicitly target root files and prove the sandbox cannot influence root CI/build. Global “zero internal URL” searches will otherwise be false. |
| VFC-16 | No application source adaptation may be required | **FALSE** | XLSX removal/replacement, Nodemailer hardening, Drizzle/Sharp major compatibility, Multer upload regression proof, and possibly WS cleanup require bounded source adaptations. |
| VFC-17 | Two same-environment installs prove portability | **FALSE** | At least one real clean install must execute outside Replit and one must execute in the supported Replit/runtime toolchain. Both must use the exact committed lock and pinned toolchain. |
| VFC-18 | Existing CI cache is unambiguous | **PARTIAL** | `setup-node` enables npm caching, but with multiple lockfiles the root `cache-dependency-path: package-lock.json` should be explicit. |

## 5. Current High Advisory and Reachability Matrix

This is an audit-time matrix, not a permanent package list. The executor must regenerate it from the final lock.

| Family | Locked / current path | Reachability | Required disposition |
|---|---|---|---|
| `drizzle-orm` | direct `0.39.3`; fixed `0.45.2` is semver-major | Core server/database runtime; one current `sql.identifier` call uses a closed table-name map, but the ORM is pervasive | Isolated major-upgrade tranche inside the task with full schema/query/migration/integration proof, or explicit DO NOT MERGE blocker; no forced update |
| `multer` | direct `2.0.2`; fixed/latest `2.2.0` | Remote upload boundary; memory uploads 5/10 MB and disk uploads up to 300 MB | Upgrade to 2.2.0; prove aborted upload cleanup, nested fields, limits, temp cleanup, role guards, and stable safe errors |
| `nodemailer` | direct `8.0.7`; fixed 8.x releases exist through 8.0.11 | Active SMTP runtime and integration verifier | Upgrade within 8.x first; set/verify `disableFileAccess` and `disableUrlAccess`; deny raw/attachment URL/file features; network-free mail construction tests |
| `sharp` | direct `0.34.5`; fixed `0.35.4` is semver-major | Public OG PNG route; server generates/escapes SVG rather than accepting arbitrary image bytes | Isolated native/major compatibility proof; import/libvips/OG/cache tests on supported Node; no live server/provider requirement |
| `ws` | direct `8.18.0`; latest observed 8.21.3 | No direct application import found; OpenAI also depends on WS | Remove unused direct declaration if confirmed, then update the owning parent/transitive path; prove no bundle/runtime regression |
| `xlsx` | direct/public latest `0.18.5`; no npm fix | Admin/manager residual upload; manager/admin lead import; admin master-lead import; untrusted workbook parsing | Replace with reviewed parser plus strict sheet/row/cell/zip/formula/prototype bounds, or disable XLS/XLSX and accept CSV only. Remaining exposure = DO NOT MERGE |
| `path-to-regexp` | Express → router → `8.3.0` | Remote HTTP route matching | Update owning Express/router graph to fixed `8.4+`; rerun route inventory/guards/API and server suites |
| `ip-address` | express-rate-limit → `10.1.0` | Remote request IP/rate-limit boundary | Update owning parent to fixed child; test IPv4 leading-zero, IPv6, proxy/trust and public rate limits |
| `undici` | Cheerio/Jsdom → `7.28.0` | Cheerio is runtime on external fetched HTML; Jsdom is test-only by imports but declared as production dependency | Update owning parents; prove scraper parsing and denied-network tests; correct package classification where safe |
| `lodash` | Recharts → `4.17.21` | Client bundle via dashboard charts | Update owning Recharts graph or compatible targeted child; verify chart bundle and no vulnerable API use |
| `brace-expansion` | Archiver → readdir-glob → minimatch | Server archive/file-processing path; pattern inputs need tracing | Update owning parents; test archive behavior and adversarial patterns without unbounded allocations |
| `minimatch` | Archiver/readdir-glob → `9.0.5` | File/archive glob path | Update parent; focused glob/archive tests |
| `picomatch` | Tailwind/Micromatch and Vite/Tinyglobby | Build and file-glob paths | Update owning build packages; no blanket override without compatibility proof |
| `postcss` | hoisted `8.5.6` | Build-time CSS pipeline; audit omit-dev classification is misleading | Update to fixed version; build malicious source-map fixture in isolated temp input; verify output |
| `nanoid` | PostCSS → `3.3.11` | Build/transitive, not direct app generator | Update owning PostCSS graph and verify final lock |
| `rollup` | Vite → `4.53.5`; dev-only audit delta | Build-time bundler | Update through fixed Vite/Rollup graph; path-traversal build fixture |
| `vite` | direct dev `7.3.0`; fixed 7.x releases exist | Build and development server, not production server runtime | Update within 7.x before considering Vite 8; production build and dev-server deny/path tests |
| `tmp` | ioredis-mock → fengari → `0.2.5` | Mock Redis fallback chain; can be runtime-reachable when Redis is absent | Update owning chain or compatible targeted child; prove no production mock fallback regression |

## 6. P0 Correction Register

### P0-01 — Obtain an explicit narrow lockfile exception

The task approval must say:

> The owner authorizes Task #1702 as a one-task exception to `replit.md:10` for the root `package-lock.json` only. The exception does not authorize manual edits to `node_modules`, the Mockup Sandbox lock, another lockfile, or unrelated dependency modernization.

Without that statement, the executor may perform read-only classification only.

### P0-02 — Separate portability from security graph changes

Use two mandatory phases and two independently reviewable commits/diffs:

1. **Phase A — portable lock:** preserve root specs, every package version, SRI, dependency edge, peer/optional/dev flag, and package count. Change only the 91 approved resolution URLs and necessary toolchain metadata/CI enforcement.
2. **Phase B — security remediation:** start from the certified phase-A lock and make only approved package/source changes, one family group at a time.

Do not “regenerate one lock” and mix both effects. If Phase B cannot close, preserve the Phase-A patch for an owner-authorized re-scope; do not falsely certify the combined task.

### P0-03 — Freeze the supported Node/npm contract

Choose and document one supported runtime/build line. The recommended current contract is supported Node 22 with a pinned npm 10 release, because CI is already on Node 22 and Replit Node 20 is stale. Add `engines` and `packageManager`, enforce the toolchain before lock generation/install, and align `.replit`’s Node module or explicitly block merge until the deployment owner does. If RVR-05 also owns `.replit`, assign RVR-02 ownership to the Node module line only and RVR-05 ownership to deployment identity lines.

### P0-04 — Freeze the registry and URL policy

Root public packages must resolve only through canonical HTTPS `registry.npmjs.org` URLs unless an individually reviewed exception is documented. Reject HTTP, credentials, query tokens, Replit-internal hosts, Git URLs, local files, and unapproved domains. Scope this rule to the root graph; the Mockup Sandbox remains excluded and must not affect root CI/build/cache.

### P0-05 — Preserve every Phase-A version, edge, and SRI

Do not use ordinary lock regeneration as the portability algorithm. Normalize the 91 URLs under the pinned npm/toolchain and compare canonical graph fingerprints. For every changed URL, fetch the public registry metadata/tarball in the disposable proof and verify the committed SRI. Any unavailable version or mismatch is a stop condition.

### P0-06 — Require distinct-environment real installs

Two installs in the same Replit cache are insufficient. Require:

- one cold, empty-cache GitHub-hosted Ubuntu install outside Replit;
- one clean install under the supported Replit/runtime toolchain;
- exact lock hash before/after; and
- identical canonical dependency-tree fingerprints.

Dry runs, existing `node_modules`, warm-cache-only proof, and unlocked installs do not count.

### P0-07 — Replace every root unlocked/fallback install

Change both CI jobs to the approved deterministic `npm ci` command. Explicitly set `cache-dependency-path: package-lock.json`. Change only the install line in `scripts/post-merge.sh` from fallback `npm install` to the approved clean-install contract. Do not execute `post-merge.sh`: it runs migrations and direct SQL and is outside this task’s side-effect authority. Search all release/deploy/workflow scripts for bypasses.

### P0-08 — Freeze lifecycle-script policy and native proof

The lock contains 11 install-script packages: `bufferutil`, `core-js`, `cpu-features`, three esbuild placements, `es5-ext`, `fsevents`, `msgpackr-extract`, `sharp`, and `ssh2`. Either:

- keep `--ignore-scripts` and prove required binaries/native modules are supplied and functional through explicit import/build/runtime probes; or
- execute only a reviewed allowlist of required lifecycle builds in a network-denied, secret-free environment.

Never silently enable all dependency scripts. Never claim `npm ci` success if TypeScript/build/native probes fail afterward.

### P0-09 — Enforce lock use, freshness, and immutability in CI

Required CI must fail when the root lock is missing, stale, rewritten, contains an unapproved resolution, or yields an invalid/extraneous tree. Add root-lock policy checks before install, `npm ci`, `npm ls --all`, package/lock diff checks, and the final audit policy gate. No `--package-lock=false`, fallback install, `--no-package-lock`, or lock-rewriting install may remain.

### P0-10 — Use actual artifact reachability, not npm omit-dev labels

Classify each high as one or more of: build-time executable, server-bundled, server-external runtime, client-bundled, test-only, optional/native, unreachable, or unused direct. Include the `script/build.ts` bundle allowlist and Vite client graph. `npm audit --omit=dev` is a secondary scanner result, not the production truth source.

### P0-11 — Remove or replace the exposed XLSX parser

`xlsx@0.18.5` has no fixed public npm release and is actively used on uploaded files. Before merge, either:

- replace it with a reviewed maintained parser and add ZIP/decompression, workbook, sheet, row, cell, string, formula, prototype-key, timeout, and memory limits; or
- remove XLS/XLSX acceptance from all affected MIME/extension paths and return a stable safe “CSV required” response.

Keep CSV through `csv-parse`. Do not leak parser exception messages. If XLSX remains reachable, final status is `DO NOT MERGE`.

### P0-12 — Isolate Drizzle and Sharp major upgrades

Do not run a forced audit fix. Treat Drizzle `0.39.3→0.45.2` and Sharp `0.34.5→0.35.4` as separate reviewed sub-diffs after Phase A. Drizzle requires full typecheck, disposable migration bootstrap/idempotency, schema/query/integration suites, and a dynamic-identifier scan. Sharp requires supported-platform install, native load/libvips evidence, OG generation/cache/error tests, and build/runtime artifact proof. Failure in either is an exact blocker or an owner-approved, time-bounded defer with a compensating control—not silent acceptance.

### P0-13 — Close direct reachable patch/minor highs

At minimum:

- Multer to fixed 2.2.0 with adversarial upload tests;
- Nodemailer to a fixed 8.x release first, with file/URL access disabled and network-free message tests;
- Vite to a fixed 7.x release before any Vite 8 modernization;
- WS through its actual owner path; remove the unused direct declaration if confirmed and update the transitive owner.

No provider, SMTP, server, or production network call is required.

### P0-14 — Close transitive highs through accountable parents

Update the parent package that owns each vulnerable transitive whenever possible: Express/router for path-to-regexp, express-rate-limit for ip-address, Archiver/readdir-glob for minimatch/brace-expansion, Cheerio/Jsdom for Undici, Recharts for Lodash, Tailwind/PostCSS/Vite for build glob/CSS packages, and ioredis-mock/Fengari for tmp. A targeted override is allowed only with upstream compatibility evidence, an explanatory comment/record, tests, owner, and removal condition. Blanket overrides are prohibited.

### P0-15 — Make advisory policy executable and fail closed

Do not permit blanket `npm audit fix`, even without `--force`. Use explicit package/version changes. Add a policy gate that parses machine-readable audit results, distinguishes scanner failure from zero findings, and blocks every new critical/high. A deferred unreachable high requires advisory ID, package/path, reachability proof, compensating control, owner, expiry, and explicit release decision. A reachable high cannot remain exposed merely because npm reports no automatic fix.

### P0-16 — Add dependency-aware build evidence

The existing artifact scanner only searches for credentials. Add a dependency reachability/SBOM gate that accounts for server-bundled inputs, server externals, and client bundle inputs, and proves a remediated/removed high is absent from the relevant final artifact graph. Do not weaken the existing redacting credential scan.

### P0-17 — Resolve parallel-task file ownership

RVR-02 owns root `package.json`, root `package-lock.json`, dependency install/cache/audit steps in `.github/workflows/ci.yml`, the dependency install line in `scripts/post-merge.sh`, bounded dependency-policy scripts/docs, and only source adaptations required by approved upgrades. It does not own CRM behavior, migrations, providers, capability-manifest policy, branch protection, or the Mockup Sandbox. Coordinate `.github/workflows/ci.yml` with RVR-01/RVR-04 and `.replit` with RVR-05 before editing; stop overlapping edits rather than overwriting them.

## 7. P1 Acceptance Corrections

### P1-01 — Add a canonical graph fingerprint

Create a deterministic script that hashes root specifiers, versions, dependency edges, peer/optional/dev flags, platform/CPU metadata, and SRI while normalizing approved registry URLs. Use separate Phase-A and Phase-B fingerprints. `npm ls` text alone is not a stable comparison artifact.

### P1-02 — Add a root lock policy scanner with negative fixtures

Test internal HTTP host, credential-bearing URL, unapproved host, missing SRI, local file, Git URL, missing lock, stale package/lock mismatch, and divergent graph fixtures. Scope fixtures to temporary directories and never print credentials.

### P1-03 — Record a durable advisory matrix

Add a reviewed document or generated artifact containing advisory ID, package, installed paths, parent paths, current/fixed versions, direct/transitive, build/runtime/client classification, input boundary, action, source adaptations, tests, owner/expiry, and audit `asOf` with Node/npm/registry identity.

### P1-04 — Add package-specific security regressions

Cover Multer abort/nesting/cleanup/limits, Nodemailer file/URL/raw denial, Sharp OG/native load, XLSX replacement-or-denial, Express/path matching, rate-limit IP parsing, archive/glob adversarial inputs, CSS/source-map handling, and scraper/Undici network denial. Tests must use bounded synthetic data.

### P1-05 — Prove install-script/native completeness

After the approved install, test `tsx`, TypeScript, all esbuild placements used by build tooling, Sharp load/render, SSH2 module load, optional bufferutil behavior, and the full release artifact gate. Report skipped optional modules explicitly.

### P1-06 — Make cache behavior explicit

Use root lock hash for cache keys and prove no cache contains or restores `node_modules`. Run one cold-cache install and one warm-cache install; both must use the same lock/tree and neither may hide registry failures.

### P1-07 — Correct dependency classification where safe

Review type-only packages and test-only `jsdom` currently declared as production dependencies. Move only proven development-only packages to `devDependencies`, with build/server artifact proof. Do not mix this cleanup into Phase A.

### P1-08 — Add final-lock audits to required CI

Run full and omit-dev machine-readable audits after install and after build. Use the executable policy gate rather than relying only on npm’s exit code. Record final counts as evidence, not hard-coded future constants.

### P1-09 — Preserve the existing 63-suite baseline

RVR-02 does not own capability semantics, but every added mandatory dependency/security suite must be registered consistently if the current CI system requires it. Report the final exact count, not “63” as post-build truth. Coordinate with RVR-04 before manifest edits.

### P1-10 — Require rollback and commit separation

Provide Phase-A and per-family Phase-B commit/diff evidence so a failed major upgrade can be reverted without restoring the internal URLs or unlocked CI. No lock rollback may reintroduce `package-firewall.replit.local`.

### P1-11 — Freeze final reporting and safe logs

Report exact commands, exits, hashes, counts, package names/advisory IDs, and redacted errors. Do not expose cache contents, auth tokens, registry credentials, environment values, user data, or full npm configuration. Separate isolated install/build evidence from deployment/runtime truth.

## 8. P2 Follow-up Hardening

| ID | Follow-up | Owner |
|---|---|---|
| P2-01 | Scheduled dependency update service with grouped, tested PRs | Repository maintenance |
| P2-02 | Npm signature/provenance verification feasibility and fail-safe policy | Security/supply chain |
| P2-03 | License policy and retained CycloneDX/SPDX artifact per release | Legal/security/release |
| P2-04 | macOS/Windows developer-install certification beyond required Linux/Replit proof | Developer experience |
| P2-05 | Branch protection, required-check administration, and exact deployed-SHA runtime rerun | Repository admin / RVR final operations |

## 9. Corrected Build Structure

### Phase A — Portable exact graph

1. Recapture clean current main, task/PR ownership, hashes, Node/npm/registry, lock hosts, CI/release install commands, and overlapping tasks.
2. Obtain the explicit root-lock exception.
3. Freeze supported Node/npm and root registry policy.
4. Normalize and verify all 91 internal URLs while preserving versions, edges, flags, SRI, and package count.
5. Add root-lock policy/fingerprint tests.
6. Replace CI and post-merge dependency install commands without executing post-merge or any app/migration.
7. Prove real clean installs outside Replit and in the supported Replit/runtime toolchain.
8. Commit/review Phase A independently.

### Phase B — Reachable advisory closure

1. Re-run full/omit-dev audit against Phase A and create the complete advisory/path matrix.
2. Generate build/server/client reachability evidence.
3. Remove/replace/disable XLSX exposure first.
4. Apply Multer/Nodemailer/Vite/WS and parent-owned transitive fixes in bounded groups.
5. Apply Drizzle and Sharp major fixes only as isolated sub-diffs with full compatibility gates.
6. Add executable advisory policy and package-specific regression suites.
7. Run the final clean installs, audits, release artifact gate, complete suite capabilities, searches, and full diff review.

## 10. Data, Authorization, and Side-Effect Contract

Allowed:

- public package registry metadata/tarball downloads in disposable environments;
- root package/lock and bounded CI/release install changes after owner authorization;
- local typecheck/build/static/disposable tests;
- fake/denied network fixtures.

Forbidden:

- application startup against production configuration;
- `scripts/post-merge.sh` execution;
- migrations, seeds, direct SQL, database writes, provider calls, SMTP delivery, GHL, campaigns, deployment, branch-protection changes, or production inspection;
- global npm credential/registry changes;
- printing secrets/configuration;
- modifying `node_modules` manually or committing it;
- Mockup Sandbox package/lock changes.

## 11. Required Tests and Gates

Report command, exact exit, and result for:

- owner-authorization and task-overlap preflight;
- root lock host/SRI/credential policy scanner and negative fixtures;
- Phase-A graph invariant/fingerprint comparison;
- verification of all 91 public replacement tarballs against SRI;
- external cold-cache `npm ci` and supported Replit/runtime clean `npm ci`;
- warm-cache repeat with unchanged lock/tree;
- `npm ls --all` and invalid/extraneous check;
- full and omit-dev `npm audit --json` with policy evaluation;
- package-specific security tests;
- install-script/native module probes;
- CI manifest validation and affected deterministic suites;
- `npm run check` and `npm run build` through the release artifact gate;
- dependency-aware artifact/SBOM gate and existing credential artifact scan;
- API/route/upload regressions where affected;
- `git diff --check`, status, stat, staged and unstaged full diff.

## 12. Commands Actually Run During This Audit

| Command | Exit | Result |
|---|---:|---|
| `git fetch --prune origin` | 0 | Live `origin/main` remained `2f463398...` |
| Lock host/integrity inventory | 0 | 921 public + 91 internal; 0 resolved entries missing SRI |
| `npm audit --json --audit-level=low` | 1 | 31 findings: 18 high, 11 moderate, 2 low, 0 critical |
| `npm audit --json --omit=dev --audit-level=low` | 1 | 28 findings: 16 high, 11 moderate, 1 low, 0 critical |
| `npm ci ... --dry-run` | 0 | Dry plan only; 864 packages; not portability proof |
| Real `npm ci --include=dev --ignore-scripts --no-audit --no-fund` | 1 | Reproduced internal-host 404 failure; terminated on `zip-stream@7.0.5` |
| `npm view zip-stream@7.0.5 dist.tarball dist.integrity --json` | 0 | Public tarball exists and SRI matches committed lock |
| `npm install --package-lock-only ... --dry-run` | 0 | No lock change; not a real install/normalization proof |
| `node scripts/ci-suite-manifest.ts --check` | 0 | PASS; 63 current suites classified |
| `node scripts/check-migration-integrity.ts` | 0 | PASS; 364 checks, two historical warnings |
| `node scripts/scan-tracked-files.ts` | 0 | PASS |
| `node scripts/test-scan-tracked-files.ts` | 1 | Plain Node cannot resolve extensionless TS import; requires installed `tsx` toolchain |
| `node scripts/check-api-coverage.ts` | 0 | PASS; 16 pre-existing unmatched paths, no new path |
| `git diff --check` | 0 | PASS |
| `git status --short --branch` | 0 | Clean detached proof worktree |

No typecheck, build, dependency-backed suite, or full CI capability run is claimed because the committed root lock cannot complete installation in this environment. This is an actual lock portability failure, not a filesystem write-permission limitation.

## 13. Required Post-Build Searches

```bash
rg -n "package-firewall\.replit\.local|http://|_authToken|NODE_AUTH_TOKEN|NPM_TOKEN" package-lock.json package.json .github scripts .replit replit.md
rg -n "npm (install|i|ci)|package-lock=false|no-package-lock|ignore-scripts|cache-dependency-path" .github scripts .replit package.json
rg -n '"engines"|"packageManager"|node-version|nodejs-' package.json .github .replit
rg -n 'from ["'"'](xlsx|multer|nodemailer|sharp|ws|drizzle-orm|vite)' server client shared script scripts
rg -n "XLSX\.(read|readFile)|sheet_to_|\.xlsx|\.xls|spreadsheetml|vnd\.ms-excel" server client shared
rg -n "multer\(|memoryStorage|diskStorage|fileSize|uploadLarge|upload\.single" server
rg -n "createTransport|sendMail|disableFileAccess|disableUrlAccess|raw:|attachments:" server
rg -n "sql\.identifier|identifier\(" server shared scripts
rg -n "scan-build-artifacts|release-artifact-gate|sbom|metafile|dependency.*artifact" scripts script .github
git ls-files | rg '(^|/)(node_modules|package-lock\.json|package\.json|\.npmrc|yarn\.lock|pnpm-lock|bun\.lock)'
```

The global repository still contains the explicitly excluded Mockup Sandbox lock. Final verification must distinguish root-scope success from that out-of-scope artifact rather than claiming zero internal URLs across the entire repository.

## 14. Kill Lines

- Stop before root lock changes without the explicit owner exception.
- Stop if Phase-A portability changes any package version, edge, flag, SRI, or count without a separately approved explanation.
- Stop if Replit/CI/npm toolchain versions remain undefined or materially inconsistent.
- Stop if any root resolution is HTTP, credential-bearing, internal, local, Git-based, or on an unapproved host.
- Stop if CI/post-merge can bypass, ignore, rewrite, or fall back around the committed lock.
- Stop if install-script suppression leaves a missing/broken native or build dependency.
- Stop if dry-run, warm-cache, Replit-only, or existing-node_modules evidence is presented as portability proof.
- Stop if `xlsx` remains exposed to uploaded workbooks without a maintained fixed parser and strict resource/input bounds.
- Stop if Drizzle or Sharp is forced across a major boundary without isolated compatibility proof.
- Stop if `npm audit fix`, blanket overrides, disabled tests, suppressed audits, or unexplained graph drift is used.
- Stop if a scanner/network failure is treated as zero findings.
- Stop if any reachable critical/high lacks remediation or an explicit permitted disposition; no-fix is not permission to leave exposure reachable.
- Stop if root and Mockup Sandbox graphs are combined or the sandbox influences root CI/build/cache.
- Stop if RVR-01/RVR-04/RVR-05 or CRM-owned files are overwritten.
- Stop if `post-merge.sh`, app startup, migrations, SQL, seeds, providers, SMTP, GHL, campaigns, deployment, branch protection, or production systems are invoked.

## 15. Final VFC Template

| ID | Requirement | Required evidence | Required test/gate | Status |
|---|---|---|---|---|
| VFC-F01 | Explicit owner lock exception | task/owner record | preflight assertion | PASS/FAIL |
| VFC-F02 | Frozen supported Node/npm contract | package/workflow/Replit config | version matrix | PASS/FAIL |
| VFC-F03 | Phase-A exact graph preserved | before/after fingerprints | graph invariant suite | PASS/FAIL |
| VFC-F04 | All 91 URLs public HTTPS with matching SRI | lock/registry evidence | tarball verification | PASS/FAIL |
| VFC-F05 | Real external and Replit clean installs | logs/hashes/trees | two-environment `npm ci` | PASS/FAIL |
| VFC-F06 | CI/post-merge consume lock with no fallback | workflow/script diff | install policy scanner | PASS/FAIL |
| VFC-F07 | Lifecycle/native policy complete | allowlist/probes | native/build suite | PASS/FAIL |
| VFC-F08 | Reachability matrix covers every final high | reviewed matrix | audit-policy gate | PASS/FAIL |
| VFC-F09 | XLSX exposure removed or replaced safely | routes/parser contract | malicious/bounded fixtures | PASS/FAIL |
| VFC-F10 | Multer/Nodemailer/WS direct risks closed | package/source diff | focused security tests | PASS/FAIL |
| VFC-F11 | Drizzle/Sharp major compatibility proven | isolated diffs | integration/native/build gates | PASS/FAIL |
| VFC-F12 | Transitive highs closed through owning parents | final tree | parent-specific regressions | PASS/FAIL |
| VFC-F13 | Build/server/client artifact graph certified | SBOM/metafile evidence | dependency artifact gate | PASS/FAIL |
| VFC-F14 | Full and omit-dev policies pass/fail honestly | audit JSON summary | scanner-unavailable negative | PASS/FAIL |
| VFC-F15 | Existing release/type/build/security gates pass | exact command logs | CI capabilities | PASS/FAIL |
| VFC-F16 | Mockup/CRM/migration/external fences preserved | diff/search | kill-line review | PASS/FAIL |
| VFC-F17 | No secrets or unrelated changes | full diff | artifact/tracked-file scan | PASS/FAIL |
| VFC-F18 | No production/external mutation | operation log | side-effect denial | PASS/FAIL |

## 16. Final Response Requirements

Return:

- **VERDICT:** COMPLETE / VERIFIED, PARTIALLY COMPLETE, or DO NOT MERGE.
- Starting/ending SHA, branch/worktree, package/lock hashes, toolchain, registry, migration head.
- Exact owner-authorization evidence.
- Phase-A and Phase-B diff/fingerprint separation.
- Complete final advisory/reachability/action matrix.
- Every install/audit/test/build command with exit and redacted result.
- Root lock/cache/install search proof.
- Package-specific source/test evidence.
- SBOM/artifact reachability evidence.
- Full kill-line and diff review.
- Clear separation between isolated build proof and deployed runtime truth.
- Residual owner/admin actions, including branch protection and deployment/certification rerun.
- Exactly one final status: `SAFE TO MERGE`, `SAFE TO MERGE — RUNTIME VERIFICATION PENDING`, or `DO NOT MERGE`.
- Branch/PR URL; never merge or deploy without explicit authorization.

## 17. Final Audit Status

**Task status:** NOT BUILD-READY AS WRITTEN.  
**Lockfile status:** Explicit owner exception still required.  
**Portability finding:** Confirmed by a real current install failure.  
**Advisory status:** 18 current high families; at least XLSX, Multer, Nodemailer, Drizzle, Sharp, Express/routing, rate-limit/IP, and build-tool paths require direct closure or exact blocking evidence.  
**Implementation status:** No repository implementation was performed.  
**Production/runtime status:** Not accessed or changed.  

## 18. Controlling Addendum to Send to Replit

Send Task #1702 followed by this section. This addendum supersedes conflicting task language. The first paragraph must be approved by the owner before the build starts.

---

### TASK #1702 CONTROLLING CORRECTIONS

**Owner authorization required:** When the owner explicitly approves this task for build, that approval is a narrow exception to `replit.md:10` permitting changes to the root `package-lock.json` only for Task #1702. It does not permit manual `node_modules` changes, Mockup Sandbox dependency changes, another lockfile, or unrelated modernization. Without explicit owner approval, perform read-only preflight only.

1. Recapture exact main, worktree, package/lock hashes, lock hosts, Node/npm/registry, CI/release install commands, current audit JSON, migration head, and overlapping RVR tasks. The audited baseline was `2f463398...`; do not assume it remains current.

2. Correct the current VFC: the portability failure is current outside Replit. A real clean install from the committed lock failed with internal-host 404s and terminated on `zip-stream@7.0.5`; Replit-local success and dry-run success do not disprove it.

3. Use two mandatory, independently reviewable phases. Phase A normalizes portability while preserving every version, edge, peer/optional/dev flag, SRI, root specifier, and package count. Phase B starts from that certified lock and performs explicit security upgrades. Never combine both into one unexplained regenerated-lock diff.

4. Freeze and enforce one supported Node/npm contract. Current `.replit` uses Node 20, CI uses unpinned Node 22, and no `engines`/`packageManager` exists. Prefer supported Node 22 plus pinned npm 10; align the `.replit` Node line or return a blocker. Coordinate only that line with RVR-05.

5. Root public packages must resolve through canonical HTTPS `registry.npmjs.org` URLs. Reject HTTP, credentials, internal hosts, local/file/Git URLs, and unapproved domains. The Mockup Sandbox lock is excluded and must not influence root CI/build/cache.

6. Verify every one of the 91 normalized public tarballs against the existing SRI. Any missing version or mismatch stops Phase A. Produce deterministic before/after graph fingerprints.

7. Prove one cold real install on GitHub-hosted Ubuntu outside Replit and one clean install under the supported Replit/runtime toolchain. Use empty `node_modules`; include one cold cache and one warm cache; compare lock hashes and canonical trees. Dry runs do not count.

8. Replace both CI `npm install --package-lock=false` commands with deterministic `npm ci`; explicitly set root `cache-dependency-path`. Replace only the dependency install line in `scripts/post-merge.sh`; never execute that script because it runs migrations/direct SQL. Eliminate every fallback/unlocked/rewrite bypass.

9. Freeze lifecycle-script policy. Eleven locked packages declare install scripts, including esbuild, Sharp, SSH2, bufferutil, and msgpackr-extract. Keep scripts disabled only if explicit native/build probes prove the resulting install complete; otherwise execute a reviewed allowlist in a network-denied, secret-free environment. Never enable all scripts silently.

10. Add root lock host/SRI/freshness/fingerprint tests and negative fixtures. Required CI must fail on missing/stale/rewritten lock, unapproved URL, missing SRI, invalid/extraneous tree, scanner failure, or changed graph.

11. Build the final advisory matrix from machine-readable audit JSON and actual artifacts. Classify build-time, server-bundled, server-external, client-bundled, test-only, optional/native, unreachable, and unused-direct paths. `npm audit --omit=dev` is not production truth by itself.

12. Remove the current XLSX exposure before merge. Public npm latest remains `xlsx@0.18.5` with no audit fix, while residual, lead-import, and master-lead routes parse uploads. Replace it with a maintained bounded parser or disable XLS/XLSX and accept CSV only. Add ZIP/workbook/sheet/row/cell/string/formula/prototype/time/memory limits and safe errors if replaced. Remaining XLSX exposure means `DO NOT MERGE`.

13. Close direct patch/minor risks first: Multer 2.2.0 with abort/nesting/cleanup/limit tests; a fixed Nodemailer 8.x with file/URL/raw denial and fake transport; fixed Vite 7.x; and WS through its actual owner path, removing the unused direct declaration if confirmed.

14. Isolate Drizzle `0.39.3→0.45.2` and Sharp `0.34.5→0.35.4` as separate major-upgrade sub-diffs. Drizzle requires typecheck, disposable migrations, query/schema/integration and dynamic-identifier proof. Sharp requires supported-platform native load/libvips, OG generation/cache/error, build, and runtime artifact proof. Do not force either.

15. Close transitive highs through owning parents: Express/router, express-rate-limit, Archiver/readdir-glob, Cheerio/Jsdom, Recharts, Tailwind/PostCSS/Vite, and ioredis-mock/Fengari. Targeted overrides require compatibility evidence, owner, expiry/removal condition, and tests. Blanket overrides and blanket `npm audit fix` are prohibited.

16. Add an executable audit policy that distinguishes scanner unavailable from zero findings and blocks every new critical/high. Any defer requires advisory ID, path, reachability evidence, compensating control, owner, expiry, and explicit release decision. Reachable no-fix is not acceptable exposure.

17. Add dependency-aware artifact/SBOM proof for server-bundled, server-external, and client-bundled inputs. Preserve the existing credential-only artifact scanner; do not misrepresent it as dependency proof.

18. Run package-specific security regressions, native/install probes, full and omit-dev audits, `npm ls --all`, manifest validation, affected deterministic suites, the release artifact typecheck/build/credential scan, dependency artifact gate, API/route/upload regressions, post-build searches, `git diff --check`, and complete status/stat/staged/unstaged diff review. Report exact commands/exits.

19. Preserve the file fence: no Mockup Sandbox dependencies, CRM behavior, schema/migrations, providers, capability-manifest semantics, branch-protection mutation, production config, or unrelated source. Coordinate `.github/workflows/ci.yml` with RVR-01/RVR-04 and `.replit` with RVR-05; never overwrite parallel work.

20. Do not start the application, run post-merge, migrate/seed/query production, send SMTP, call providers/GHL, activate campaigns, deploy, or change branch protection. Final evidence is isolated supply-chain/build proof only.

21. Final VFC must prove owner authorization; pinned toolchain; exact Phase-A graph; all 91 SRI matches; two-environment installs; locked CI/post-merge; lifecycle/native completeness; every final high disposition; XLSX closure; direct/major/transitive compatibility; artifact/SBOM closure; honest audit gates; full suite/diff proof; file fence; and zero production/external mutation.

22. Return exactly one merge result. If XLSX remains reachable, a reachable high is unclosed, graph drift is unexplained, the lock can be bypassed, or required proof cannot run, return `DO NOT MERGE`. Never merge or deploy without explicit authorization.

---
