# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD

First verify this task against the current codebase and repository state. If it remains materially valid and safe after corrections, continue directly into implementation in the same run. Do not stop after another plan unless a genuine blocker exists.

Do not blindly trust old claims, paths, line numbers, or counts. Do not redesign architecture, create competing sources of truth, perform speculative refactors, clean unrelated code, expand scope silently, use `db push`, weaken tests, expose secrets/PII, or make production-data mutations merely to satisfy a test.

Stop before a blocked portion only if the finding is false, the proposed owner is wrong, a prerequisite is missing, destructive/external authority is unavailable, safe work depends on unavailable runtime evidence, scope must genuinely be split, or a kill line is reached. Complete every independent safe portion that is not blocked.

Required sequence:

Repository baseline → VFC → targeted searches → verified root cause → source-of-truth check → blast radius → data/auth/concurrency/external-side-effect checks where relevant → preflight verdict → corrected build plan → kill lines → implementation → tests/gates → post-build searches → diff review → final VFC → merge verdict.

## 1. REPOSITORY BASELINE

Capture before making claims:

- current branch and HEAD SHA;
- `git status --short` and whether unrelated changes already exist;
- origin URL/visibility evidence available from the current environment;
- relevant GitHub workflow and branch-protection visibility;
- migration head only if implementation unexpectedly touches schema.

Do not overwrite unrelated work. Never print credentials, database contents, backup contents, or lead-export contents.

## 2. VERIFIED FROM CODE — PREFLIGHT

Produce a concise table before implementation:

| ID | Task Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | ... | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` or repository evidence |

Verify root cause, repository ownership, every tracked artifact class, `.gitignore`, existing scanners, CI enforcement, scripts that generate artifacts, deployment/rollback references, and any documentation that treats test/demo data as production data. Inspect surrounding code; grep hits are not proof.

## 3. REQUIRED SEARCH / GREP CHECKS

Use `rg`/Git inventory to inspect at minimum:

- tracked files under `backups/`, `attached_assets/`, export/upload/generated directories, and likely `*.sql`, `*.dump`, `*.gz`, `*.zip`, `*.csv`, `*.xlsx` artifacts;
- `.gitignore`, `.gitattributes`, secret/data scanners, pre-deploy checks, GitHub Actions, and artifact-generation scripts;
- references to backups/exports in deployment, restore, documentation, tests, and release scripts;
- test/demo/synthetic identifiers and existing `record_class` or equivalent fields;
- secrets or credential *names* in config and history without printing secret values.

Use safe metadata inspection only: paths, object sizes, hashes, commit dates, and configuration. Do not decompress, print, attach, or copy sensitive contents.

## 4. VERIFIED ROOT CAUSE

State:

- original task assumption;
- what is currently tracked/reachable and why existing ignore/scanner rules did not prevent it;
- whether repository visibility is currently public/private/unknown;
- whether current-tree cleanup, history cleanup, secret rotation, and live-data cleanup are separate concerns.

Include:

| Original Assumption | Verified Reality | Correction |
|---|---|---|
| ... | ... | ... |

If no material correction exists, say so.

## 5. SOURCE-OF-TRUTH CHECK

Identify relevant owners:

- repository visibility/access owner;
- Git-history and protected-branch owner;
- generated-artifact/backup owner;
- credential-rotation owner;
- test/demo data classification owner.

Do not create a second classification system. BT-06 owns canonical `record_class`; this task may add a handoff, guardrail, or evidence inventory but must not implement a competing classifier.

## 6. BLAST RADIUS

### In scope

- current-tree containment;
- `.gitignore` and scanner/CI prevention;
- safe artifact metadata inventory;
- removal of confirmed generated artifacts from the current Git tree when safe;
- documented, coordinated history-rewrite runbook;
- exposure-window and credential-rotation checklist without secret values;
- explicit handoff to BT-06 for data classification.

### Out of scope

- deleting production database rows;
- classifying live records by filename/prefix alone;
- automatically rewriting shared Git history;
- automatically changing repository visibility or rotating credentials unless the environment provides explicit authorized controls;
- implementing BT-06's `record_class` schema.

List exact files expected to change and files explicitly not expected to change. Keep the diff minimal.

## 7. DATA / SCHEMA CHECK

Migration required: NO, unless preflight proves a repository-side schema change is indispensable—which would be a material scope correction and must be explained before coding.

No production data deletion or historical backfill is authorized. Treat file cleanup and database cleanup as different operations.

## 8. AUTHORIZATION CHECK

State who can perform each operation:

| Action | Developer | Repository Admin/Owner | Security/Operations |
|---|---:|---:|---:|
| Add ignore/scanner rules | ... | ... | ... |
| Remove current-tree generated artifacts | ... | ... | ... |
| Change repository visibility | ... | ... | ... |
| Rewrite shared history/force-update refs | ... | ... | ... |
| Rotate credentials | ... | ... | ... |

Do not infer authorization from local Git access.

## 9. CONCURRENCY / IDEMPOTENCY CHECK

For cleanup/scanner scripts, verify repeatability, deterministic findings, safe handling of renamed files, and no deletion outside explicit targets. A history rewrite must have a coordinated clone/deploy/rollback plan and is never an automatic test action.

## 10. EXTERNAL SIDE-EFFECT CHECK

Document ordering for any repository-host or secret-rotation operation. Code changes may prepare the repository; do not claim a GitHub visibility change, credential rotation, cache invalidation, deployment replacement, or remote-history purge occurred without direct evidence.

## 11. PREFLIGHT VERDICT

Use exactly one:

- BUILD-READY
- BUILD-READY WITH CORRECTIONS
- PREFLIGHT REQUIRED
- NOT BUILD-READY
- NOT NEW TASK
- WATCH

If build-ready, implement immediately. A destructive history rewrite or credential rotation may remain an explicitly blocked operations step while safe containment code proceeds.

## 12. CORRECTED BUILD PLAN

Before editing, state the verified What & Why, exact Done Looks Like, and minimal implementation steps with current files/functions. Separate:

- **BLOCKING CORRECTION** — required for safe implementation;
- **FOLLOW-UP HARDENING** — useful later but not required to merge.

## 13. KILL LINES

- KILL LINE: If database backups, lead exports, or equivalent sensitive generated artifacts can still be newly committed without a required check failing, the task has FAILED.
- STOP if any backup/export contents, secrets, tokens, or PII are printed or attached.
- STOP if shared Git history is rewritten without explicit owner approval and clone/deployment/rollback coordination.
- STOP if cleanup uses broad globs, unresolved variables, or filename/prefix assumptions that could remove production data or unrelated files.
- STOP if this task introduces a competing `record_class` implementation.
- STOP if current-tree deletion is presented as proof that sensitive objects disappeared from reachable history.

## 14. IMPLEMENTATION RULES

Use the smallest safe diff and current project patterns. No unrelated cleanup, broad renames, dependency changes, formatting sweeps, production config mutations, or automatic destructive remote actions. If root cause changes materially, update the corrected plan and proceed only if still safe.

## 15. TEST REQUIREMENTS

Tests must cover applicable happy, negative, boundary, replay, and regression cases:

- prohibited artifact paths/types are rejected;
- approved fixtures and ordinary assets remain allowed;
- renamed/nested prohibited artifacts are detected;
- scanner output contains paths/reason codes but no sensitive content;
- repeated scans are deterministic;
- no unrelated source or lockfile is modified.

## 16. SMOKE / INTEGRATION TEST

Extend the existing compliance/pre-deploy suite if it owns repository scanning. Otherwise add one focused test script, named consistently with repository conventions, that creates only temporary safe fixtures and proves blocked/allowed behavior. Never stage real sensitive files.

## 17. POST-BUILD GREP CHECKS

Re-run the inventory and prove:

- no confirmed prohibited artifact remains in the current tree;
- ignore and scanner rules cover all verified artifact classes;
- generation scripts cannot silently write tracked sensitive outputs;
- old allowlists/exemptions do not bypass the new rule;
- no live-data deletion logic was added.

## 18. REQUIRED GATES

Run actual repository commands for targeted tests, related compliance/pre-deploy tests, typecheck/build where affected, and `git diff --check`. Do not invent commands. Report command and PASS/FAIL. Fix task-caused failures; identify unrelated failures honestly.

## 19. DIFF REVIEW

Run `git status`, `git diff --stat`, and `git diff`. Confirm only intended files changed, with no secret, PII, debug output, generated junk, lockfile drift, unrelated formatting, or production configuration mutation.

## 20. FINAL VFC TABLE

Map every Done Looks Like requirement and kill line to file/evidence and a test/gate:

| ID | Requirement | Evidence | Test / Gate | Status |
|---|---|---|---|---|
| VFC-F01 | ... | `file:line` | ... | PASS / FAIL |

## 21. FINAL RESPONSE FORMAT

Return:

- **VERDICT:** COMPLETE / VERIFIED, PARTIALLY COMPLETE, or DO NOT MERGE
- **Repository State:** starting SHA, ending SHA/working tree, migration head if relevant
- **Verified Root Cause**
- **Preflight Corrections**
- **Implementation:** `file:line — change`
- **Tests / Gates:** command and result
- **Grep Verification**
- **Kill-Line Verification**
- **Runtime/Operations Verification:** distinguish code/tests from repository-host, secret-rotation, deployment, or history-rewrite proof
- **Remaining Risks**
- **Final Status:** SAFE TO MERGE, SAFE TO MERGE — RUNTIME VERIFICATION PENDING, or DO NOT MERGE

Do not call local/mock evidence production verification.

## LIBERTY-SPECIFIC SAFETY RULES

- Database: no `db push`, production-row cleanup, broad deletion, or filename/prefix-based disposition.
- Contacts/test data: BT-06 owns canonical classification; this task may quarantine repository artifacts but must not invent a live-data classifier.
- External systems: distinguish local Git changes from GitHub visibility, remote-history purge, deployment replacement, and credential rotation.
- Evidence: retain paths/counts/hashes and reason codes only; never expose record contents or credentials.

## PRACTICAL REVIEW STANDARD

Block implementation for realistic risk of data exposure, data loss, unauthorized history rewrite, broken deployments, or irreversible cleanup. Do not block safe current-tree guards merely because the ideal history rewrite or organization-wide secret rotation requires a later owner action. Separate blocking correction from follow-up hardening.

---

# TASK TO PREFLIGHT + BUILD

## BT-01 — Repository Exposure & History Containment

**Primary findings:** `SEC-01`, `DAT-10`

### What & Why

The original audits found that the repository may be publicly accessible and may contain tracked database backups, bulk lead exports, spreadsheets, screenshots, or other generated operational artifacts. Ignoring those patterns now does not remove already tracked objects or reachable Git history. Exposure creates credential, PII, legal, and operational risk. Test/demo cleanup is related but must not be performed through filename-pattern deletion; canonical classification belongs to BT-06.

First verify the current repository rather than assuming the historical finding is still true. Treat repository visibility, current-tree containment, historical object removal, credential rotation, and production-data classification as separate workstreams.

### Done Looks Like

- Current visibility and access posture are evidenced.
- Confirmed backup/export/generated artifact classes are inventoried using metadata only.
- Confirmed prohibited artifacts are absent from the current tracked tree.
- `.gitignore` and a required scanner/CI check prevent recurrence.
- Exposure window and potentially affected credential categories are documented without values.
- A safe, owner-approved history-rewrite runbook exists if reachable history still contains prohibited objects.
- No production row is deleted or classified using filename/prefix heuristics.
- BT-06 owns later `record_class` and test/demo data disposition.

### Out of Scope

- Performing the destructive shared-history rewrite without explicit owner authorization.
- Rotating secrets through ad hoc commands or exposing their values.
- Deleting or backfilling production data.
- Implementing the commercial/test classification schema.

### Proposed Implementation Steps

1. Inventory current tracked and reachable artifact metadata; classify confirmed versus false-positive paths.
2. Verify visibility, remote branches/tags, deployment references, and existing prevention controls.
3. Remove only confirmed generated artifacts from the current tree using explicit targets; preserve required fixtures and evidence.
4. Update `.gitignore` and the existing compliance/pre-deploy/CI scanner using the repository’s current owner.
5. Add focused scanner regression tests with synthetic temporary fixtures.
6. Produce an exposure/rotation/history-cleanup runbook that lists required owner actions and rollback coordination without secret/PII content.
7. Record BT-06 as the sole owner for live test/demo/unknown record classification.

### Relevant Files and Areas to Verify

- `.gitignore`, `.gitattributes`
- `.github/workflows/**`
- `scripts/pre-deploy.ts` and existing repository/compliance scanners
- `backups/**`, `attached_assets/**`, upload/export/generated directories
- scripts that create database backups, exports, spreadsheets, screenshots, or lead files
- deployment and restore documentation/configuration
- GitHub repository settings and reachable refs, where access exists

Do not assume these paths still exist; locate current owners first.

### Existing Kill Line

KILL LINE: If prohibited sensitive artifacts can still be newly committed without a required gate failing—or if the task destroys shared history/data without explicit authorization—the task has FAILED.

## FINAL DIRECTIVE

Do not implement this task exactly as written merely because it was provided. Verify it first. Then perform the full sequence in this prompt. If safe code-side containment is build-ready, complete it now; isolate only the genuinely blocked external/destructive operations. Do not create another planning loop without a real blocker.
