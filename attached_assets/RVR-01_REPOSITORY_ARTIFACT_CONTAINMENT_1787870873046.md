# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD

First verify this task against the current codebase, current remote `main`, and the August 27 VG certification artifacts. If the finding remains materially valid and safe after corrections, continue directly into implementation in the same run. Do not stop after producing another plan unless a genuine blocker exists.

Do not blindly trust historical counts, paths, line numbers, scanner results, or the certification SHA. Do not expose file contents, PII, credentials, statement data, or provider payloads. Do not rewrite shared history, delete production data, mutate deployments, or broaden cleanup from confirmed repository artifacts to unrelated assets.

Required sequence:

Repository baseline → certification-prerequisite check → VFC → metadata-only inventory → verified root cause → source-of-truth check → blast radius → data/auth/concurrency/external-side-effect checks → preflight verdict → corrected build plan → kill lines → implementation → tests/gates → post-build searches → diff review → final VFC → merge verdict.

**Absolute audit rule:** Finding one P0, kill line, or sufficient evidence for `NOT BUILD-READY` does not permit stopping. Continue through the entire affected scope and return the complete P0/P1/P2 correction matrix with exact fixes, callers, tests, and remaining owner actions.

## 1. TASK IDENTITY

**RVR-01 — Repository Artifact Containment and Scanner Regression Repair**

**Primary runtime evidence:** August 27 VG certification repository-hygiene finding.

**Runtime rows supported:** `RV-CI-01` and release-governance evidence; this task does not itself close a runtime row.

**Parallelism:** May run beside CRO-01 only on a separate branch with an explicit file fence. Do not modify CRM routes, schemas, migrations, campaign/sequence code, provider integrations, or `scripts/ci-suite-manifest.ts` unless preflight proves registration is missing and CRO-01 ownership has been coordinated.

## 2. WHAT & WHY

The August 27 certification found six tracked synthetic statement PDFs and tracked pasted-instruction artifacts that were outside the existing tracked-file scanner’s rule coverage. Current-main recapture at task drafting found a seventh tracked test-statement PDF after the certification SHA. The scanner correctly blocks backups, dumps, spreadsheets, archives, and most exports, but it currently allows all PDFs and most content under `attached_assets/` and `uploads/statement-command/`.

Contain only confirmed generated/test/operational artifacts, preserve legitimate product assets and synthetic fixtures required by tests, and strengthen the existing canonical scanner so the same classes cannot silently re-enter the tracked tree.

## 3. REPOSITORY BASELINE

Drafting evidence, which the executor must independently recapture:

- Current remote baseline observed during drafting: `origin/main` at `c5d0baa8c697778caccaed4dba74e456c9a07063`.
- Latest commit at that baseline: `Add test statement PDF to uploads`.
- Current migration head: `0165_outbound_send_claim_lease.sql`; migration journal index `169`.
- August 27 certification commit: `0e947faac9f7cd6aafbd634366e38e2dcd912f25`.
- Certification tested SHA: `78ae07e8c5ffb643467a93dc42b95834d65289a8`.
- Current-main drafting inventory found seven tracked `uploads/statement-command/*-test-statement.pdf` files.
- The developer checkout contained unrelated modified media assets; they must remain untouched.

Before making claims or edits, capture branch, HEAD, `origin/main`, merge-base, `git status --short`, migration head, and current relevant tracked paths. Preserve unrelated work and never reset/rebase it.

## 4. VERIFIED FROM CODE — PREFLIGHT

Produce this table before implementation:

| ID | Task Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | Generated statement PDFs remain tracked | CONFIRMED / PARTIAL / FALSE / OUTDATED | Exact count and metadata-only classification | Git inventory |
| VFC-02 | Existing scanner allows the affected paths | CONFIRMED / PARTIAL / FALSE / OUTDATED | Exact `classify()` behavior and rule gap | `scripts/scan-tracked-files.ts` |
| VFC-03 | Existing regression tests omit the affected classes | CONFIRMED / PARTIAL / FALSE / OUTDATED | Exact missing/covered cases | `scripts/test-scan-tracked-files.ts` |
| VFC-04 | Scanner is required by current gates | CONFIRMED / PARTIAL / FALSE / OUTDATED | CI/pre-deploy ownership | workflow/script evidence |
| VFC-05 | Files are synthetic/generated and safe to untrack | CONFIRMED / PARTIAL / FALSE / OUTDATED | Metadata, generator lineage, references; never contents | repository evidence |
| VFC-06 | No application runtime depends on tracked copies | CONFIRMED / PARTIAL / FALSE / OUTDATED | Upload storage, fixtures, deployment, restore references | `file:line` |

Inspect surrounding code. A filename containing `test` or a directory named `uploads` is not sufficient proof that deletion is safe.

## 5. REQUIRED SEARCHES

Use `git ls-files`, `git log --all --name-only`, `git cat-file` metadata, and `rg` to inspect at minimum:

- all tracked files under `uploads/statement-command/`, `attached_assets/`, `backups/`, exports, screenshots, generated evidence, and temporary upload directories;
- PDF, spreadsheet, archive, dump, raw SQL, CSV, generated text, and pasted-instruction classes;
- `.gitignore`, `.gitattributes`, `scripts/scan-tracked-files.ts`, its tests, pre-deploy, CI, and suite manifest registration;
- every writer/generator that emits statements, screenshots, backups, evidence packets, exports, or uploads;
- references from application code, tests, docs, deployment, rollback, and restore tooling;
- tracked-file allowlists and any bypass based only on extension or directory.

Use metadata only: path, Git object size/hash, commit/date, MIME identification, and references. Never print, decompress, render, copy, or attach statement or operational contents.

## 6. VERIFIED ROOT CAUSE

Verify whether the root cause remains:

1. The canonical scanner classifies known dangerous extensions but not generated statement PDFs or broad pasted-instruction artifacts.
2. The upload/generation path can write inside the repository tree.
3. Git ignore rules and required gates do not fail for every confirmed generated operational-artifact class.
4. A later commit added another test PDF after the certification inventory, proving recurrence rather than a one-time historical issue.

Include an assumption-correction table distinguishing current-tree containment, reachable Git history, deployed copies, application upload storage, and production database records.

## 7. SOURCE-OF-TRUTH CHECK

- Canonical tracked-file policy: extend `scripts/scan-tracked-files.ts`; do not create a second scanner.
- Canonical scanner tests: extend `scripts/test-scan-tracked-files.ts`.
- Canonical required-gate owners: current CI workflow, `scripts/pre-deploy.ts`, and capability manifest only where already used.
- Application uploads: preserve the current upload/storage owner; do not redesign it here.
- History rewrite and repository visibility: repository administrator/security owner, not this build task.
- Live record classification: CRO/BT classification authority, not filename heuristics.

## 8. BLAST RADIUS

### In scope

- Metadata-only artifact inventory.
- Explicit untracking/removal of confirmed generated test artifacts from the current tree.
- `.gitignore` additions narrowly covering verified generated directories/classes.
- Extension of the existing tracked-file scanner and synthetic regression tests.
- Safe generator-output relocation outside tracked source or explicit ignored runtime storage where necessary.
- A redacted handoff listing any reachable-history or deployed-copy concern.

### Out of scope

- Broad deletion of `attached_assets/`.
- Deleting legitimate brand images, product media, fixtures, migrations, evidence, or documentation by directory alone.
- Reading or deleting production statement records/files.
- Shared-history rewrite, force push, repository visibility change, credential rotation, deployment, or cache purge.
- CRM, revenue, campaign, provider, queue, or contact changes.

Expected files include `.gitignore`, `scripts/scan-tracked-files.ts`, `scripts/test-scan-tracked-files.ts`, and only explicitly verified tracked artifacts/generators. No migration is expected.

## 9. DATA, AUTHORIZATION, CONCURRENCY, AND SIDE EFFECTS

**Migration required: NO.** No database read, write, backfill, or cleanup is authorized.

| Action | Developer | Repository Admin | Security/Operations |
|---|---:|---:|---:|
| Update ignore/scanner/tests | Yes | Review | Review |
| Remove confirmed artifacts from current tree | Yes, explicit targets only | Review | Review |
| Rewrite shared history | No | Explicit authorization required | Coordinate |
| Change visibility/rotate credentials | No | Owner action | Owner action |
| Delete deployed or production files | No | No implicit authority | Explicit separate operation |

Scanner behavior must be deterministic, repeatable, rename/nesting-safe, path-normalized, and incapable of deleting anything. Generator changes must use collision-safe destinations and must not rely on unresolved environment variables or broad globs.

## 10. PREFLIGHT VERDICT

Use exactly one: `BUILD-READY`, `BUILD-READY WITH CORRECTIONS`, `PREFLIGHT REQUIRED`, `NOT BUILD-READY`, `NOT NEW TASK`, or `WATCH`.

If current main already contains equivalent scanner coverage and no confirmed prohibited artifact, return `NOT NEW TASK` with evidence. Otherwise implement every safe independent portion immediately.

## 11. CORRECTED BUILD PLAN

1. Recapture current branch/SHA/tree and certification ancestry.
2. Inventory affected artifact classes using metadata only.
3. Prove which exact files are generated/test-only and whether any runtime/test consumes them.
4. Remove only confirmed artifacts from the current tracked tree using explicit paths.
5. Add narrow ignore rules and redirect generators where needed.
6. Extend the canonical scanner with stable reason codes for verified classes/paths.
7. Extend synthetic tests for nested, renamed, uppercase, allowed-fixture, and false-positive cases.
8. Confirm required CI/pre-deploy ownership without adding a competing gate.
9. Produce a history/deployment handoff without performing remote destructive actions.

## 12. DONE LOOKS LIKE

- No confirmed generated statement/test artifact remains tracked at current HEAD.
- Legitimate assets and fixtures remain intact.
- The required scanner fails on the verified classes even when renamed or nested.
- Scanner output contains paths and reason codes only.
- Generators cannot silently recreate trackable artifacts in source directories.
- Current-tree containment is not misrepresented as history purge.
- No production data, deployment, history, or external system was mutated.

## 13. KILL LINES

- **KILL LINE:** If a confirmed generated statement, backup, export, or equivalent operational artifact can be newly committed without a required gate failing, the task has failed.
- STOP if any artifact contents, statement identity, PII, secret, or provider payload is printed or attached.
- STOP if cleanup uses broad globs, directory-wide deletion, filename-only production classification, or unresolved variables.
- STOP if shared history is rewritten without explicit owner approval and clone/deployment coordination.
- STOP if legitimate assets/fixtures are removed without consumer proof.
- STOP if current-tree cleanup is presented as proof of historical or deployed deletion.

## 14. TESTS AND REQUIRED GATES

Cover prohibited/allowed paths, renamed and nested cases, uppercase extensions, deterministic output, safe redaction, generator destination, and regression of existing allowlists. Use only temporary synthetic fixtures.

Run actual repository commands discovered during preflight, including the focused scanner test, scanner against the real tracked tree, capability manifest if changed, deterministic-static suites as affected, typecheck/build if production code changed, and `git diff --check`. Report exact command, exit code, and PASS/FAIL; do not invent results.

## 15. POST-BUILD SEARCH AND DIFF REVIEW

Prove no confirmed artifact remains tracked, no bypass/allowlist defeats the rule, no generator writes a newly prohibited tracked path, no live-data deletion exists, and no unrelated CRO/provider/CRM code changed. Run `git status`, `git diff --stat`, full `git diff`, and secret/PII-safe diff inspection.

## 16. FINAL VFC AND RESPONSE

Map every Done Looks Like item and kill line to file/evidence and a test:

| ID | Requirement | Evidence | Test/Gate | Status |
|---|---|---|---|---|
| VFC-F01 | Confirmed artifacts absent from current tree | path inventory | tracked-file scan | PASS/FAIL |
| VFC-F02 | Recurrence blocked | scanner/rules | synthetic regression | PASS/FAIL |
| VFC-F03 | Legitimate assets preserved | consumer inventory | allowed-fixture tests | PASS/FAIL |
| VFC-F04 | No destructive/external action | diff/operations log | review | PASS/FAIL |

Return verdict, starting/ending repository state, verified root cause/corrections, implementation by `file:line`, tests/gates, grep verification, kill-line verification, runtime/operations distinction, remaining risks, and final status of `SAFE TO MERGE`, `SAFE TO MERGE — RUNTIME VERIFICATION PENDING`, or `DO NOT MERGE`. Never merge, deploy, rewrite history, or mutate production without explicit authorization.

## 17. RELEVANT FILES

- `.gitignore`
- `.gitattributes`
- `scripts/scan-tracked-files.ts`
- `scripts/test-scan-tracked-files.ts`
- `scripts/pre-deploy.ts`
- `scripts/ci-suite-manifest.ts`
- `.github/workflows/ci.yml`
- `uploads/statement-command/**`
- `attached_assets/**`
- statement upload/generator services found during preflight
- `docs/VG_RUNTIME_EVIDENCE_PACKET_78ae07e8_2026-08-27.md`

## FINAL DIRECTIVE

Do not merely restate the certification finding. Verify current ownership and exact artifacts, implement safe current-tree containment immediately if valid, and leave only genuinely external/destructive history, visibility, deployment, or credential operations pending.
