# Task #2001 Post-Merge Audit — Required Corrections

**Audit date:** 2026-09-25  
**Audited repository:** `Liberty-Bancard-Website-and-CRM`  
**Audited branch:** `origin/main`  
**Audited SHA:** `08e2b141a1d15b695704b89dc119ee42fbb48ba7`  
**Pre-Task-#2001 comparison SHA:** `67afe14c52f8594f517bb7ed76a2cd7000655fc4`  
**Migration head:** `0290_sfp2001_campaign_package_staging` (journal index 294)  
**Verdict:** **CORRECTIVE PATCH REQUIRED — DO NOT ACTIVATE CAMPAIGN STAGING OR PROCEED TO TASK #2002 YET**

## 1. Executive conclusion

Task #2001 is merged and it gets several architectural decisions right: it uses the corrected `ready_held` terminal state, introduces typed free/paid staging references, creates stable package keys, keeps the new worker outside the sending-capable `outreach` group, uses explicit UI selection, and does not intentionally create sequence enrollments, campaign queue membership, outbound messages, or GHL writes.

It is not complete against the corrected build contract, however. The merged recurring worker is deterministically incompatible with the staging executor and cannot successfully execute a normal batch. The configuration-convergence command cannot produce the required five correctly narrowed packages from the repository's current seeded campaign set. Exact replay is not crash-safe, the plaintext boundary defect identified before the build was copied into the new service instead of corrected, execution does not re-run or transactionally bind all required policy gates, recurring staging is backfilled on instead of defaulting off, the historical Task #2000 migration was rewritten and weakened, and the new certification does not exercise the broken worker path.

These are implementation defects, not production-verification-only items. A production canary must not be used to discover or work around them.

## 2. Verification performed

### Repository inspection

- Fetched current `origin/main` and audited a clean detached worktree at `08e2b141a1d15b695704b89dc119ee42fbb48ba7`.
- Reviewed the complete `67afe14..08e2b14` diff: 24 files, including migration 0290, package convergence, staging v2, recurring worker, routes, UI, certification, runbook, queue registration, schema, and a modification to historical migration 0289.
- Compared the merged code against every F-01 through F-18 correction and the mandatory certification matrix in `Task_2001_Final_Pre_Build_Audit_Corrections.md`.

### Commands independently run

- `node scripts/test-sfp-pipeline-correction.mjs` — **21/21 passed**.
- `node scripts/test-sfp1999-final-closeout.mjs` — **7/7 passed**.
- `git diff --check 67afe14..origin/main` — only Markdown hard-break trailing spaces in the committed audit attachment were reported.

### Runtime limitation

The detached audit worktree did not contain installed Node dependencies or a disposable PostgreSQL instance, so the TypeScript build and database-backed Task #2001 certification were not independently executed in this audit. That does not make the findings below speculative: the principal blockers are direct, deterministic contradictions between committed callers, validators, SQL, and migration behavior.

## 3. Original correction reconciliation

| Original finding | Current disposition | Post-merge result |
| --- | --- | --- |
| F-01 corrected `ready_held` boundary | **Implemented** | New v2 path ends at `ready_held`; no enrollment is created. |
| F-02 no competing launch approval | **Implemented** | Package `current` is a reference state; no CR-06 gate or launch approval is opened. |
| F-03 exact five-package mapping | **Partially implemented / functionally incomplete** | Five keys exist, but convergence does not actually narrow three reused campaigns and normally skips Med Spa. |
| F-04 stable identity/versioning | **Partially implemented** | Logical keys replace numeric IDs, but package rows are mutable and exact vertical uniqueness is not enforced. |
| F-05 free/paid one-of schema | **Implemented** | Migration 0290 adds the typed source references and one-of check. |
| F-06 atomic snapshot/replay | **Not completed** | Per-row writes exist, but crash recovery, exact concurrent replay, stage-item/counter atomicity, and deterministic snapshots are not correct. |
| F-07 dedicated mutation selector | **Partially implemented** | V2 reads eligibility rows directly, but the transaction does not bind the complete cohort/business/evidence/policy identity. |
| F-08 reuse `pipeline_origin` | **Implemented** | Existing `sfp_pipeline` discriminator is reused and its schema comment is corrected. |
| F-09 unique sequence families | **Implemented** | Each vertical receives a distinct family key. |
| F-10 explicit configuration convergence | **Not completed** | Preview/apply/verify exist, but apply is non-transactional, lacks an expected snapshot/receipt/rollback, and does not perform the required narrowing. |
| F-11 one future execution engine / no send | **Implemented for the new v2 imports** | V2 does not import the enrollment, campaign-dispatch, GHL, or outbound services. |
| F-12 all mutable safety gates | **Not completed** | Policy, consent, canonical business class, exact identity, suppression, and transaction binding remain incomplete. |
| F-13 correct plaintext boundary | **Not implemented** | The pre-existing generic escape remains and the new service copies it twice. |
| F-14 explicit selected rows | **Partially implemented** | The new UI uses eligibility IDs and max 25, but the legacy staging route remains active and the v2 preview/confirmation omits required fields. |
| F-15 isolated recurring operations | **Partially implemented / worker broken** | The queue is isolated, but command-key mismatch prevents execution; default-off, controls, telemetry, and worker certification are incomplete. |
| F-16 reconcile 18/21 baseline | **Implemented** | The dependency-free structural suite now passes 21/21. |
| F-17 exact allowlist | **Partially implemented** | Five keys form an allowlist, but duplicate current mappings for one vertical remain possible. |
| F-18 stale comments/references | **Mostly implemented** | Schema comment and manifest path are corrected; the new runbook contains incorrect API paths and overstates telemetry. |

## 4. Release-blocking findings

### PM-01 — P0: The recurring worker always supplies a command key the executor rejects

**Evidence**

- `server/services/cro03/sfp-campaign-staging-worker.ts:179-191` obtains `preview.commandKey` and calls `executeStagingV2()` with ``${preview.commandKey}:run:${runId}``.
- `server/services/cro03/sfp-campaign-staging-v2.ts:201-210` requires the key to equal exactly `sfp-stage-v2:${cohortRunId}:${snapshotHash}` and throws `SFP_STAGING_COMMAND_KEY_MISMATCH` for any suffix.
- The worker then searches for intents using the same suffixed key, so it cannot discover an intent created under the unsuffixed key either.

**Impact**

Every ordinary recurring batch fails before staging, retries, and can eventually dead-letter. The dedicated worker—the principal recurring deliverable of Task #2001—is nonfunctional.

**Required correction**

- Define one canonical server-issued command key contract used unchanged by manual and recurring execution, or explicitly add a separately validated worker run identity to the payload instead of mutating the command key.
- Query resulting intents by the exact persisted command/eligibility identity.
- Add a real disposable-database test that invokes `processSfpCampaignStagingTick()` through run creation, claim, preview, execute, item completion, and run reconciliation. A source-string assertion is not sufficient.

### PM-02 — P0: Package convergence cannot produce the required canonical five packages

**Evidence**

- Restaurant, Retail, and Auto Repair use the existing broad campaigns as both source and target names. `applyPackageConvergence()` never changes their `target_verticals`; it simply pins the existing broad campaign.
- Repository seed scopes are broader than SFP: Restaurant also contains Food Service/Bar/Cafe/Bakery/Food Truck; Retail contains E-Commerce and other retail subtypes; Auto Repair contains Service/Trades and other industries.
- Med Spa expects a renamed target `SDR-05: Medical / Medspa`. If it does not already exist, the non-split apply branch returns `skipped_needs_review`; it neither creates a safe successor nor narrows/renames the source.
- Dental creates a nominal split campaign, but no campaign steps are copied. New vertical sequences copy the W6 `total_steps` number and governance metadata but create no `sequence_steps` rows.
- `verifyPackageConvergence()` checks only that each key has a current row with draft/paused status. It does not verify exact target verticals, exact step/content completeness, package hashes, or that all five rows were produced by the requested convergence.

**Impact**

On current repository seed data, a normal apply cannot yield the promised five coherent, premium, exactly scoped campaign/sequence packages. Some rows can be held against broad campaigns; Med Spa may have no current package; newly created definitions may claim nonzero total steps while containing zero steps.

**Required correction**

- Implement preview/apply against an exact expected revision/hash for each source artifact.
- Create safe draft successors for history-bearing campaign narrowing instead of silently pinning broad rows or skipping the core Med Spa package.
- Produce exact `target_verticals` for all five target campaigns.
- Either clone reviewed steps/content into successors or set `total_steps=0` and keep the package non-current until content is deliberately supplied and reviewed. Never advertise a nonzero step count with no persisted steps.
- Make the entire five-package convergence transactional or resumable through a durable apply receipt with exact per-package terminal states.
- Strengthen verification to check five and only five verticals, exact vertical-to-key mapping, exact campaign scopes, draft/paused states, real step counts, live content hashes, and absence of SDR-10 from the allowlist.

### PM-03 — P0: The audited plaintext boundary defect was not corrected and was copied into staging

**Evidence**

- `openSfpCandidatePlaintext<T>()` still accepts a generic callback and returns arbitrary `T` (`sfp-paid-evidence-writer.ts:216-256`).
- `sfp-validation.ts` still uses `async (plaintext) => plaintext`, returning decrypted email outside the documented boundary.
- `sfp-campaign-staging-v2.ts:414-451` repeats the escape by returning `{ ..., plaintext }` and assigning it to `intentValues.plaintextEmail` outside the callback.
- The helper performs evidence reads and its audit insert through global `db`, even when called from inside `stageOneRowTransactional()`; `isCanonicallySuppressed()` likewise uses global `db`. These operations are not bound to the final transaction.

**Impact**

The exact F-13 correction was not implemented. The API does not enforce callback confinement, and the evidence check, plaintext-open audit, suppression decision, and master-lead projection can observe different database states/connections.

**Required correction**

- Replace the generic callback with purpose-specific operations that cannot return plaintext, including a transaction-bound master-lead projection operation and a validation transport operation.
- Accept and use the transaction executor for evidence resolution, frozen membership, envelope read, suppression/consent gates, audit insert, and authorized `master_leads.email` projection.
- Return only sanitized hashes, row IDs, and outcomes.
- Add compile/static guards that reject any `return plaintext`, object property containing plaintext, or assignment of plaintext from the audited boundary.
- Certify both Task #2000 validation and Task #2001 staging against the corrected API.

### PM-04 — P0: Exact replay and crash recovery are not correct

**Evidence**

- `executeStagingV2()` commits each row independently and writes the command receipt only after all rows, in a separate statement (`sfp-campaign-staging-v2.ts:238-282`).
- If the process crashes after an intent commit but before the receipt, retry finds no receipt and re-runs preview. The committed row now becomes `already_has_staging_intent`, changing the snapshot and causing `SFP_STAGING_SNAPSHOT_DRIFTED` before the code can use its same-command recovery branch.
- Two concurrent callers can both compute and return their own in-memory results. Receipt insertion uses `ON CONFLICT DO NOTHING` and does not re-read/return the winning stored receipt; `completedAt` alone can differ.
- The eligibility query has no `ORDER BY`, and `hashInputRows` is not sorted. Snapshot hashes and row ordering are therefore not guaranteed deterministic.
- The snapshot omits source kind, candidate/evidence IDs, business/cohort identity, eligibility policy ID/hash/version, consent tier, normalized hash, and other mutable inputs required by the corrected contract.

**Impact**

The same command is not guaranteed to converge after a crash or return one exact durable result under concurrency. Candidate/policy identity can drift without changing the preview hash.

**Required correction**

- Persist a command in `pending/executing/completed` state before item execution, with immutable payload/snapshot identity and durable per-item results.
- Make retries resume from that command and reconcile already-committed same-command items without reclassifying them as snapshot drift.
- On command-key conflict, lock and return the one stored canonical receipt; never return a losing local result.
- Canonicalize/reject duplicate IDs and deterministically order both preview rows and hash inputs.
- Include every admission identity and policy/package input in the snapshot.
- Add injected-crash tests before/after every durable boundary and concurrent exact-result assertions.

### PM-05 — P0: Required policy and safety gates are incomplete and not transactionally authoritative

**Evidence**

- Staging calls cached `getActiveSfpOutreachPolicy()` before the transaction and never locks or re-reads the singleton pointer inside it.
- The value stored as `policy_document_hash` is `sha256(activePolicy)`, not the authoritative persisted `activePolicy.documentHash`.
- Eligibility `policy_document_id`, `policy_document_hash`, `policy_version`, `consent_tier`, `source_kind`, business ID, and cohort ID are not selected and compared as one exact identity inside the transaction.
- The canonical `evaluateSfpMutableSafetyGates()` is not used. Existing-customer SQL is duplicated, and consent-tier policy is not re-evaluated.
- Test/demo/synthetic/internal/inactive/noncanonical business gates are absent.
- Suppression calls occur outside the transaction through the global DB helper.
- Cohort/program/package reads are not locked even though the corrected contract requires transaction-bound authority.

**Impact**

A row evaluated under a stale or different policy can be held under the current derived hash without proving it still satisfies the active document. Required compliance and business-record exclusions can drift between checks and commit.

**Required correction**

- Inside the same item transaction, lock/read the cohort, program, active policy control/document, eligibility row, exact evidence row, and package version.
- Compare the eligibility's policy ID/version/document hash and relevant inputs to the active policy; fail closed to a fresh validation/preview when they differ.
- Persist the actual policy document hash, not a second locally derived hash.
- Reuse executor-aware canonical DBPR, existing-relationship, suppression, consent-tier, record-class, active/canonical, and evidence-openability authorities.
- Bind eligibility ID to the exact cohort, business, source kind, and evidence ID in the locked query.
- Add a test for every F-12 rejection class.

### PM-06 — P0: Recurring staging is not default-off

**Evidence**

- Migration 0290 changes the schema default to `campaignStaging:10` and backfills `10` into every existing program lacking the key.
- The queue has an installed 15-minute repeat schedule.
- `capabilityIsActive()` treats the `full` background profile as active automatically.
- Therefore an already active program with `recurring_enabled=true` under a full profile gains the new recurring stage without a separate stage activation.

**Impact**

Deployment can activate a brand-new, currently broken staging consumer without the required post-publish canary and explicit operator decision.

**Required correction**

- Default and backfill `campaignStaging` to `0`, or add a distinct boolean stage-enable control defaulting to false.
- Require a deliberate operator activation receipt after package verification and one-row canary.
- Prove migration/deployment alone cannot create a new claim or run.

### PM-07 — P0: Historical migration 0289 was rewritten and its singleton guarantee was weakened

**Evidence**

- Commit `735dbba` modifies already-merged `migrations/0289_sfp2000_policy_and_lineage.sql` instead of adding a correction above it.
- The original `singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton)` became a primary key without `CHECK(singleton)`.
- The table can now hold both `singleton=true` and `singleton=false`, contradicting the singleton policy-control model.
- The repository migration-integrity script validates file/journal topology and timestamps, not historical SQL checksums, so it does not catch this rewrite.

**Impact**

Fresh installs and already-migrated environments no longer share the same migration history or schema guarantee. The active-policy control is weaker on new installs.

**Required correction**

- Restore migration 0289 byte-for-byte to its previously merged content.
- Add a new migration above 0290 that verifies no false row exists and adds/validates the singleton check for environments that may have applied the weakened form.
- Add an immutable migration checksum/baseline rule so future edits to applied migrations fail CI.

### PM-08 — P0: The certification suite does not cover the critical failed paths

**Evidence**

- The Task #2001 suite executes `previewStagingV2()`/`executeStagingV2()` directly but never calls `processSfpCampaignStagingTick()`.
- Its worker coverage is a source regex checking for configuration strings and forbidden imports. That cannot detect the command-key contradiction.
- It manually seeds a valid current package rather than exercising `previewPackageConvergence()`/`applyPackageConvergence()`/`verifyPackageConvergence()` against representative existing campaign data.
- It does not inject crashes, prove resumable receipt behavior, reconcile stage-run/item counters, exercise operator retry/cancel/pause, or cover the full F-12 rejection matrix.
- Its concurrent test checks only “both return” and one intent exists; it does not assert both callers receive the exact stored receipt.

**Impact**

The suite can report green while the recurring deliverable is unusable and several mandatory contract guarantees are absent.

**Required correction**

- Extend the disposable certification to exercise configuration convergence, manual staging, actual recurring tick, retries, expired lease reclaim, dead-letter recovery, pause, and counters.
- Add exact database delta checks for all no-send tables before/after every manual and recurring flow.
- Add the full policy/safety rejection matrix, deterministic ordering, crash injection, and canonical concurrent receipt checks.

## 5. Additional required corrections

### PM-09 — P1: The package-version authority is mutable and can be ambiguous

- There is no trigger protecting package identity/content columns from in-place updates.
- Uniqueness is only “one current row per package key,” not “one current package per exact SFP vertical.” Two different current keys can target the same vertical.
- No database check binds each allowlisted key to its one exact vertical.
- `getCurrentPackageForVertical()` uses `LIMIT 1` without a uniqueness guarantee or deterministic order.
- `applyPackageConvergence()` treats any current key as valid without verifying its vertical, live hash, campaign, sequence, or states.

**Fix:** add key-to-vertical checks, one-current-per-vertical uniqueness, immutable payload columns with controlled lifecycle transitions, deterministic lookup, and full validation before `already_current`.

### PM-10 — P1: Stage-run/item state and counters are outside the atomic item commit

- Manual v2 execution creates no `sfp_stage_runs`/`sfp_stage_items` record.
- Recurring item claims, v2 intent/master-lead/eligibility writes, item completion, and run counters are separate transactions.
- A crash can leave a held intent with a claimed/retry item or inaccurate run counters.
- Aggregate results do not provide per-row outcomes, so the worker applies the first aggregate reason to unrelated failed items.

**Fix:** give each manual/recurring command a durable run/item ledger; commit final safety decision, intent, master lead, eligibility link, item outcome, and authoritative counter delta transactionally, with one counter writer and per-item reason codes.

### PM-11 — P1: The legacy staging mutation remains production-reachable

- `POST /api/lead-ops/sfp/runs/:runId/stage-for-campaign` still calls legacy `stageForCampaign()`.
- That path does not use the package-pinned v2 state machine and can create the older staging representation alongside the new authority.

**Fix:** remove/return 410 for the legacy mutation or make it a strict adapter into v2 with the same preview, command, policy, package, and receipt contract. Update old certifications to test compatibility without preserving a bypass.

### PM-12 — P1: Preview/execute and UI do not implement the full corrected contract

- Preview does not return a client-visible `payloadHash`, package-version ID/content hash per row, validation age, or eligibility policy ID/version/hash per row.
- Execute does not require the preview payload hash or an explicit confirmation token.
- The UI confirmation shows counts and package distribution but not the exact business/masked address/source/validation/policy/package details required for operator review.
- Row-level safety rejections are folded into a 200 aggregate rather than following the specified typed 409/422 behavior.
- No visible exact `READY HELD — SENDING OFF` label was found in the panel.

**Fix:** implement the complete preview DTO, confirmation token, exact row review, typed response contract, and held-state label.

### PM-13 — P1: Recurring operations lack required operator controls and truthful telemetry

- No admin retry/cancel routes or UI controls exist for stage runs/items.
- The runbook instructs operators to edit dead-letter rows with raw SQL.
- Telemetry reports configured profile membership as capability active, not actual worker/queue health.
- It omits next run, ETA, configured schedule timing, and bounded catch-up status while the runbook claims they are shown.
- Backlog is global across all programs/cohorts, not scoped to the program displayed.

**Fix:** add governed retry/cancel/pause/resume actions with audit receipts, actual worker/queue topology health, scoped backlog, next-run/ETA data, and UI reconciliation.

### PM-14 — P1: The runbook contains incorrect and unsafe instructions

- It documents `/api/lead-ops/sfp/staging-v2/preview|execute`; the actual routes are `/api/lead-ops/sfp/campaign-staging-v2/preview|execute`.
- It claims convergence narrows campaigns when the implementation does not.
- It claims next-run telemetry that the API/UI do not provide.
- It recommends direct SQL for dead-letter recovery instead of an audited operator control.
- It says existing programs are backfilled to 10 even though the corrected contract requires default-off activation.

**Fix:** correct the route names and rewrite the runbook only after behavior and controls match it. Do not use direct SQL as the ordinary operational recovery interface.

### PM-15 — P2: Repository hygiene and migration governance need cleanup

- The merge includes a screenshot and a duplicate input audit under `attached_assets/` plus agent-memory changes. These are not required runtime artifacts.
- The migration-integrity suite cannot detect edits to previously merged migration SQL.

**Fix:** remove accidental input artifacts if repository policy does not require retaining them, and add historical migration checksum enforcement.

## 6. Corrective implementation order

1. **Keep activation off immediately.** Do not apply package convergence, enable the queue, or run a production canary.
2. **Repair migration history safely.** Restore 0289 and add a new forward correction; make campaign staging default-off.
3. **Correct the plaintext and transaction APIs.** This is shared by Task #2000 and #2001 and must be fixed before staging logic is rebuilt around it.
4. **Repair package convergence and immutability.** Produce exactly five verifiable, coherent draft/paused packages through a transactional or resumable command.
5. **Repair command/idempotency architecture.** Durable pending command, canonical receipt, deterministic snapshot, crash-safe resumption.
6. **Bind all safety gates and run/item accounting to the item transaction.** Remove the legacy bypass.
7. **Repair the recurring worker and default-off control.** Use the canonical command identity unchanged and add operator controls/telemetry.
8. **Rewrite the certification to execute the real worker and convergence flows.** Add crash/concurrency/safety/no-send matrices.
9. **Correct the UI and runbook.** Make displayed controls and claims match real behavior.
10. **Run the full locked verification set on a fresh disposable database.** Only then publish and perform the bounded production verification from the original corrected contract.

## 7. Minimum acceptance gates for the corrective patch

- All five canonical verticals resolve to exactly one immutable current package with exact vertical scope and coherent persisted steps/content.
- Manual and recurring execution both reach `ready_held` through the same authoritative command contract.
- Same command/same payload returns the one exact stored receipt before, during, and after concurrent/crash recovery.
- Every F-12 safety rejection is exercised and transactionally bound.
- Plaintext cannot escape the purpose-specific audited operation and appears only in the authorized `master_leads.email` projection.
- Migration 0289 matches its previously merged bytes; the forward singleton/default-off correction is journaled above 0290.
- Migration/deployment alone cannot activate recurring staging.
- Legacy staging mutation cannot bypass v2.
- Actual worker-tick integration, lease recovery, retry/dead-letter, operator controls, run/item counters, and no-send database deltas pass on disposable infrastructure.
- TypeScript, production build, API coverage, role guards, migration integrity/checksums, fresh/upgrade migrations, Task #1998/#1999/#2000/#2001 suites, campaign/sequence/CR-06/pause/background-profile regressions, and the complete pre-deploy gate are green.

## 8. Final decision

The merge should remain inactive while a focused Task #2001 corrective patch is built. This is not a reason to restart the roadmap or recreate Task #2001 from scratch: the schema direction, ready-held boundary, explicit selection, typed free/paid references, and isolated capability group are reusable. The correction must repair the broken execution and governance contracts before Task #2002 is allowed to depend on this handoff.

**Final status: MERGED, NOT SAFE TO ACTIVATE — CORRECTIVE PATCH AND RE-CERTIFICATION REQUIRED**
