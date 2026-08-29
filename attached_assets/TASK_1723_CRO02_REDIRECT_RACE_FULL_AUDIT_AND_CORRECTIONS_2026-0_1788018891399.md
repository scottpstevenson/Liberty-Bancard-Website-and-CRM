# Liberty Bancard — Task #1723 CRO-02 Redirect Race Audit and Controlling Corrections

**Audit date:** 2026-08-29 UTC  
**Audited repository:** `scottpstevenson/Liberty-Bancard-Website-and-CRM`  
**Audited `origin/main`:** `59b54e3a48c4b0c35adce5daabb1e6ffeaa1a6d7`  
**Migration head:** `0178_cr04_channel_cohort_authority`  
**CI manifest:** 83 registered suites  
**Submitted task:** `#1723 - Prevent clean certification runs from failing on the CRO-02 redirect race`  
**Audit mode:** read-only live-repository task-plan audit; no application, database, provider, GHL, or production mutation

## 1. Verdict

**NOT BUILD-READY AS WRITTEN. KEEP TASK #1723, BUT REPLACE ITS FOUR-LINE IMPLEMENTATION CONTRACT WITH THE CONTROLLING ADDENDUM IN SECTION 12.**

The task is a valid, narrow correction and is correctly separated from RVR-04 orchestration. The failure is not merely a flaky assertion. Current code contains a real post-merge authority window:

1. `executeContactMerge()` commits an active redirect, archives the deprecated contact, and records the operation as `committed` inside its local transaction.
2. That transaction releases the CRO-02 advisory locks.
3. The restrictive consent handoff and final `completed`/`reconciliation_pending` status update occur afterward.
4. CRO-02 redirect discovery ignores operations in `committed` status.
5. A resolver queued behind the merge can therefore rediscover no redirect and persist a snapshot against the deprecated contact after the redirect is already active.

The existing task wording allows the implementer to “fix … the flaky assertion,” which could conceal this real defect. The implementation must correct the redirect state contract and then make the race proof deterministic.

The relevant-file list is incomplete. At minimum, the shared live redirect authority in `server/services/contact-identity.ts`, the merge state transition in `server/services/contact-merge.ts`, graph-lock ownership, disposable runner registration, and affected live consumers must be audited. This does not require a new task or a schema migration by default.

## 2. Repository recapture

| Item | Verified state |
|---|---|
| Branch | `main` |
| `origin/main` | `59b54e3a48c4b0c35adce5daabb1e6ffeaa1a6d7` |
| Latest commit | `Require suite-owned terminal certification receipts` |
| Worktree | Clean and equal to `origin/main` |
| Migration head | `0178_cr04_channel_cohort_authority` |
| CI manifest | 83 suites; self-check passes |
| CRO-02 integration capability | Registered as `deterministic-integration` |
| Test infrastructure | Disposable PostgreSQL/Redis and provider-denied runner already exist |
| Current separate static-gate defect | `scan-tracked-files` fails on one new tracked `Pasted-*` artifact; #1723 must not grandfather or inspect it |

The executor must recapture all of these values at build start. The unrelated tracked-file failure must be resolved by its repository-artifact owner before a fully green exact-SHA certification claim; it is not permission to expand #1723 into artifact cleanup.

## 3. Verified-from-code table

| ID | Submitted or implied claim | Verdict | Current repository reality |
|---|---|---|---|
| VFC-01 | The disposable integration failure concerns the CRO-02 redirect race | **CONFIRMED** | The failing assertion is in the merge/redirect concurrency section of `scripts/test-cro02-integration.ts`. |
| VFC-02 | This is only test flakiness | **FALSE** | The active redirect is committed while its operation remains `committed`; both CRO-02 redirect discovery queries exclude that status. |
| VFC-03 | The resolver already retries discovery drift | **CONFIRMED, INCOMPLETE** | `resolveCommercialGraph()` retries `CRO02_GRAPH_DISCOVERY_DRIFT` and SQLSTATE `40001` up to three transactions. The committed-state redirect is invisible to both discovery passes, so no drift is detected in the critical window. |
| VFC-04 | The current race test proves the exact ordering | **PARTIAL** | It counts all advisory waiters in the current database whose query text contains the lock function. It does not bind the evidence to the exact lock key, backend PID, or committed-before-finalization state. |
| VFC-05 | Only `test-cro02-integration.ts` and `commercial-resolution.ts` are relevant | **FALSE** | `contact-merge.ts` creates the status window; `contact-identity.ts` independently defines live redirect eligibility; queue/statement/sequence consumers call the live resolver. |
| VFC-06 | The redirect is not authoritative until `completed` | **FALSE as a local identity claim** | At local commit, the redirect is active and the deprecated contact is archived. Continuing to treat the deprecated ID as effective is inconsistent with committed local state. |
| VFC-07 | A migration is required | **NOT INDICATED** | Existing status values, redirect rows, locks, and indexes are sufficient for a code/test correction unless implementation discovers a new durable state requirement. |
| VFC-08 | RVR-04 should own the fix | **FALSE** | RVR-04 correctly exposes the failure; CRO-02 merge/redirect authority owns the behavior. |

## 4. Verified root cause

### 4.1 Merge state sequence

`server/services/contact-merge.ts` performs the local merge in this order:

- locks the survivor and deprecated contact graph;
- transfers or terminalizes dependent work;
- inserts `contact_merge_redirects` with `active = true`;
- archives the deprecated contact;
- changes the operation to `committed`;
- commits and releases graph/advisory locks;
- runs `carryRestrictiveConsentForContactMerge()` outside that transaction;
- changes the operation to `completed` or `reconciliation_pending`.

The local identity change is real at `committed`. The later handoff determines whether downstream activity is safe, but it does not undo the active redirect.

### 4.2 Resolver visibility defect

Both `discoverContactRedirect()` and `discoverCommittedContactRedirect()` in `server/services/commercial-resolution.ts` use:

```sql
o.status IN ('completed', 'reconciliation_pending')
```

They exclude `committed`. When a queued resolver acquires the advisory lock immediately after the local merge transaction commits, it can see:

- deprecated contact archived;
- active redirect present;
- operation status still `committed`;
- no redirect according to the resolver's status filter.

Because the transaction-local discovery and separate committed-state reread both use the same incomplete status filter, `graphDiscoveryDrift` remains false. The resolver can then persist a deprecated-subject snapshot rather than retry.

### 4.3 Parallel live-reader defect

`resolveLiveContactRedirect()` in `server/services/contact-identity.ts` also excludes `committed`. Its queue-manager, abandoned-statement, and sequence-worker consumers can therefore receive the deprecated ID during the same window.

The correct behavior is not to treat an archived deprecated contact as live. However, blindly treating `committed` as fully safe is also wrong because restrictive consent carry-forward may still be in progress. The state contract must distinguish **effective identity** from **effect eligibility**.

### 4.4 Test nondeterminism

The current fixture does useful lock ordering, but it assumes that two global advisory waiters establish the exact merge/resolver phase. It does not deliberately hold the merge in the post-local-commit `committed` window. Depending on scheduling and consent handoff speed, the operation may reach `completed` before the resolver performs its committed-state reread, causing the test to pass or fail without isolating the intended boundary.

## 5. P0-01 — Freeze the redirect state contract

Before changing code, define and test these semantics:

| Operation/redirect state | Effective identity | External-effect posture |
|---|---|---|
| No active redirect; previewed/approved/executing | Requested contact | Existing normal gates |
| Active redirect + `committed` | Survivor is canonical | Fail closed/defer effectful work until consent handoff terminalizes |
| Active redirect + `completed` | Survivor is canonical | Normal consent/contactability/purpose gates apply |
| Active redirect + `reconciliation_pending`, GHL-only pending | Survivor is canonical | Local work may proceed through normal gates; external reconciliation remains pending |
| Active redirect + consent-handoff retry required | Survivor is canonical | Marketing/outbound/provider effects defer/fail closed |
| Redirect inactive/operation `undone` | Deprecated contact restored | Normal gates after undo commit |

Do not make `committed` equivalent to “no redirect.” Do not make it equivalent to unconditional send eligibility.

The implementation should centralize or share this state interpretation so commercial resolution and live identity resolution cannot drift again.

## 6. P0-02 — Correct commercial resolution without weakening drift protection

The corrected resolver must:

1. recognize an active locally committed redirect as identity-authoritative;
2. include the same authoritative status semantics in transaction-local discovery and the separate committed-state reread;
3. after acquiring the ordered graph locks, detect any difference between pre-lock discovery and committed state;
4. abort the first serializable transaction on drift;
5. retry from a fresh transaction and rebuild the complete graph from the survivor;
6. persist no snapshot or dependencies from the stale attempt;
7. return the survivor as `effectiveSubjectId` after retry;
8. add a stable unresolved/hold reason for effect purposes that require identity/consent completion while the operation is `committed` or consent-retry-pending;
9. retain the bounded retry ceiling and return `CRO02_GRAPH_RETRY_EXHAUSTED` with no snapshot when churn does not converge;
10. preserve merge-undo drift behavior.

Do not fix this by increasing timeouts, increasing retry counts, swallowing `40001`, accepting `STALE_GRAPH`, or changing the assertion to allow the deprecated ID.

## 7. P0-03 — Align the live redirect boundary and consumers

Audit and correct `server/services/contact-identity.ts` so live work never silently continues on an archived deprecated contact during `committed` or consent-retry state.

The safest compatible contract is:

- resolve canonical identity to the survivor once the active redirect is locally committed;
- return or throw a stable retryable hold when restrictive consent handoff is incomplete;
- allow current queue/worker consumers to defer/retry without sending, mutating a provider, or losing work;
- preserve the existing behavior for completed and GHL-only reconciliation-pending redirects;
- reject cycles, multiple active redirects, invalid state, and depth overflow.

Inventory and test these current consumers:

- `server/services/queue-manager.ts`;
- `server/services/abandoned-statement-worker.ts`;
- `server/services/sequence-worker.ts`;
- any newer callers found at build start.

This is not an outbound redesign. It is the minimum correction needed to prevent the same identity race outside the CRO-02 snapshot test.

## 8. P1 corrections

### P1-01 — Make the race proof deterministic

Replace the global waiter-count assumption with exact coordination. The test must prove:

- the blocker owns the exact deprecated-contact advisory key;
- the merge is the first waiter for that exact key;
- the resolver discovers the pre-redirect graph and becomes the next waiter;
- the local merge commits the active redirect while final handoff remains deliberately blocked;
- the resolver observes committed-state drift, aborts its stale attempt, and retries;
- no stale snapshot or dependency rows are inserted;
- final resolution uses the survivor.

Use exact advisory-lock identity/backend evidence or a narrow injected test seam. Do not use production sleeps or a broad test-only bypass.

### P1-02 — Cover merge, undo, pending handoff, and exhaustion

Required cases:

1. merge races a resolver that discovered no redirect;
2. undo races a resolver that discovered an active redirect;
3. resolver begins during local `committed` state;
4. consent handoff fails and operation becomes retry-pending;
5. GHL-only reconciliation-pending remains correctly distinguished;
6. completed redirect resolves normally;
7. inactive/undone redirect restores the deprecated contact;
8. repeated drift exhausts the bounded retry budget and persists no snapshot;
9. two concurrent resolvers converge on the same post-merge effective graph;
10. no provider/network transport is constructed.

### P1-03 — Expand the relevant-file and gate inventory

The build preflight must include at least:

- `scripts/test-cro02-integration.ts`;
- `server/services/commercial-resolution.ts`;
- `server/services/contact-merge.ts`;
- `server/services/contact-identity.ts`;
- `server/services/commercial-graph-locks.ts`;
- the live resolver consumers listed above;
- `scripts/ci-suite-manifest.ts`, `scripts/pre-deploy.ts`, `scripts/run-ci-suites.ts`, and `.github/workflows/ci.yml` as read-only registration/evidence unless a proven registration change is necessary;
- migrations `0151`, `0166`, `0169`, and `0173` plus `shared/schema.ts` as read-only contract evidence.

No schema or migration change is expected. If the agent concludes one is required, it must stop, recapture the journal, explain the new durable invariant, and coordinate the next migration number before editing.

## 9. Required verification

At the implementation SHA:

1. Run the focused CRO-02 integration suite on a newly provisioned disposable PostgreSQL database.
2. Run the focused race proof at least 10 times with fresh fixture/database isolation and zero flaky passes/failures.
3. Run the full `deterministic-integration` capability at least twice on fresh disposable infrastructure.
4. Run the canonical identity merge integration suite.
5. Run CRO-02 static/authority checks, migration integrity, suite-manifest validation, provider-denial verification, typecheck, and relevant compliance scans.
6. Confirm the runner receives a valid terminal certification receipt with substantive assertions and complete cleanup.
7. Confirm zero external/provider/GHL/email/SMS calls.
8. Confirm all created contacts, merge rows, snapshots, dependencies, consent fixtures, and advisory blockers are cleaned or destroyed with the disposable database.

The exact-SHA GitHub Actions result controls the final certification claim. Local repetitions are supporting evidence.

## 10. Kill lines

- Do not weaken the survivor-ID assertion.
- Do not accept a `STALE_GRAPH` snapshot.
- Do not treat the deprecated archived contact as live after local redirect commit.
- Do not treat incomplete consent handoff as outreach eligibility.
- Do not add `committed` to one redirect reader while leaving another reader inconsistent.
- Do not replace exact synchronization with longer sleeps or timeouts.
- Do not make retries unbounded.
- Do not change graph-lock ordering or namespace without proving every writer and reader.
- Do not add a migration unless a newly discovered durable invariant requires it and ownership is coordinated.
- Do not use production/shared PostgreSQL or Redis.
- Do not call providers, GHL, email, SMS, campaigns, sequences, or production data.
- Do not modify or grandfather the unrelated tracked `Pasted-*` artifact in this task.

## 11. Acceptance/VFC required from the executor

| ID | Requirement | Required evidence |
|---|---|---|
| VFC-F01 | Exact current branch/SHA and clean starting tree | full SHA, merge-base, status |
| VFC-F02 | Committed-window root cause reproduced | deterministic phase evidence |
| VFC-F03 | Redirect state contract centralized/aligned | file:line evidence and tests |
| VFC-F04 | First stale attempt persists nothing | snapshot/dependency counts |
| VFC-F05 | Retry resolves survivor | exact IDs and reason/status assertions |
| VFC-F06 | Pending consent fails closed | live-reader and consumer tests |
| VFC-F07 | Undo drift converges | deterministic undo race test |
| VFC-F08 | Retry exhaustion fails closed | no snapshot plus stable error |
| VFC-F09 | All current live consumers handled | caller census and tests |
| VFC-F10 | No migration/schema drift | journal and diff evidence |
| VFC-F11 | Repetition and full capability green | exact commands, run counts, receipts |
| VFC-F12 | No external effects | provider-denial evidence |
| VFC-F13 | Exact-SHA required CI green | workflow URL/run ID and head SHA |

## 12. Controlling addendum — paste into Task #1723

> ### TASK #1723 CONTROLLING ADDENDUM — LIVE-REPOSITORY AUDIT 2026-08-29
>
> **Mode:** PREFLIGHT + BUILD  
> **Audited baseline:** `origin/main = 59b54e3a48c4b0c35adce5daabb1e6ffeaa1a6d7`, migration head `0178_cr04_channel_cohort_authority`, 83 registered CI suites. Recapture all three at build start.
>
> The failure is a real redirect-authority race, not permission to loosen a flaky assertion. `executeContactMerge()` commits an active redirect and archives the deprecated contact while the operation is still `committed`, then releases graph locks before the restrictive consent handoff advances the operation to `completed` or `reconciliation_pending`. Both CRO-02 redirect discovery queries currently ignore `committed`, so a queued resolver can miss an already active redirect and persist a deprecated-contact snapshot.
>
> Freeze one redirect state contract: an active locally committed redirect makes the survivor the canonical identity immediately, while `committed` or consent-handoff-retry state remains fail-closed for effectful work until restrictive consent is complete. Completed and GHL-only reconciliation-pending redirects retain normal downstream gates; inactive/undone redirects restore the deprecated identity.
>
> Correct `server/services/commercial-resolution.ts` so transaction-local discovery and committed-state reread use the same authoritative status semantics. A pre-lock/post-lock redirect change must abort the stale serializable transaction, persist no snapshot/dependencies, retry from a fresh transaction, and resolve the survivor. Preserve bounded retries, merge-undo drift handling, and `CRO02_GRAPH_RETRY_EXHAUSTED` with no snapshot on non-convergence. Never accept `STALE_GRAPH` or the deprecated ID.
>
> Audit and align `server/services/contact-identity.ts` and all current live redirect consumers so they never silently operate on the archived deprecated contact during `committed` or consent-retry state. Use a stable retryable hold/defer contract for incomplete restrictive handoff. Do not convert pending handoff into send/provider eligibility.
>
> Make `scripts/test-cro02-integration.ts` deterministic. Bind coordination to the exact advisory key/backend or a narrow injected seam; deliberately hold the post-local-commit/final-handoff window; prove that the first resolver attempt discovered the old graph, persisted nothing, retried, and produced only a survivor snapshot. Cover merge, undo, committed, consent-retry, GHL-only reconciliation-pending, completed, inactive/undone, concurrent resolvers, and bounded retry exhaustion.
>
> Expected changed files are the CRO-02 resolver, shared live redirect authority, focused integration tests, and only the consumer changes required to truthfully defer the new hold outcome. `contact-merge.ts`, graph-lock owner, CI/manifest/pre-deploy files, schema, and migrations are audit/read-only unless code evidence proves a required narrow change. No migration is expected; stop and coordinate before creating one.
>
> Verification requires at least 10 fresh-isolation focused race runs, two full fresh-infrastructure `deterministic-integration` capability runs, canonical identity merge coverage, CRO-02 static checks, migration integrity, manifest validation, typecheck, provider denial, substantive terminal receipts, complete cleanup, and exact-SHA GitHub CI. No production/shared state or external/provider/GHL/email/SMS/campaign/sequence activity is authorized.
>
> The current unrelated tracked-file scanner failure belongs to repository-artifact ownership. Do not inspect, grandfather, or clean it in #1723, but do not claim a fully green exact-SHA certification until the owning correction also lands.

## 13. Final audit disposition

**Task disposition:** valid existing task; do not split.  
**Plan disposition:** not build-ready until Section 12 is incorporated.  
**Expected migration:** none.  
**Expected external effects:** none.  
**Implementation owner:** CRO-02 merge/redirect authority, not RVR-04.  
**Final merge verdict available now:** **DO NOT MERGE FROM THE SUBMITTED PLAN ALONE.**

