# Task #1725 — CRO-03 Private-404 Body Consumption

## Live Repository Audit and Controlling Build Addendum

**Audit date:** 2026-08-29  
**Repository:** `scottpstevenson/Liberty-Bancard-Website-and-CRM`  
**Verified default branch:** `main`  
**Verified live `origin/main` SHA:** `2273f80b0bb4f3f9b628c8a2316d9d445865b1bc`  
**Migration head:** `0181_cr05_task_ticket_authority`  
**Audit mode:** Read-only source and certification-contract audit  
**Implementation authorization:** None  

---

## 1. Executive Verdict

**BUILD-READY WITH REQUIRED CORRECTIONS.**

Task #1725 identifies a real deterministic test defect. It is correctly separated from Task #1723 and does not require an application-route, database, provider, queue, or production change.

The submitted task is directionally correct, but its acceptance contract is incomplete in three material ways:

1. The defect does not affect only the foreign private-404 assertion. The same helper consumes the successful admin-create `202` body before the later `create.json()` call. A patch limited to the first 404 check will only move the crash later in the suite.
2. The canonical proof is not a direct unwrapped invocation of the test file. The suite must pass through the denied-provider certification runner, produce its valid terminal receipt, and allow the sequential `server-required` capability to advance beyond suite 5 of 16.
3. The suite currently swallows fixture-user deletion failures while the wrapper certifies `cleanup: "complete"`. Because two consecutive clean runs are part of this task's evidence, cleanup must fail closed rather than produce a false terminal receipt.

No P0 architectural blocker exists. The task can proceed after the controlling corrections below are inserted.

---

## 2. Task Intent

Repair the response-reading contract in `scripts/test-cro03-http-authorization.ts` so the CRO-03 ownership/privacy certification:

- reads each relevant HTTP response payload exactly once;
- preserves exact private-404 assertions;
- preserves useful failure diagnostics;
- continues through the successful admin-create response;
- passes under the existing disposable, denied-provider certification boundary; and
- no longer prevents later `server-required` suites from executing.

---

## 3. Repository Baseline

The audit fetched the live default branch before inspection.

| Item | Verified state |
|---|---|
| Live default branch | `origin/main` |
| SHA | `2273f80b0bb4f3f9b628c8a2316d9d445865b1bc` |
| Task #1723 correction | Merged at `6e4a29f278a229288b6e394e02324d232fc7f0f3` |
| Latest live change | CSV provider classification/certification coverage at `2273f80b…` |
| Migration journal head | `0181_cr05_task_ticket_authority` |
| Mandatory suite registry | 85 entries |
| Capability manifest | 85 entries |
| `server-required` suites | 16 |
| CRO-03 HTTP suite position | 5 of 16 |

The relevant CRO-03 HTTP file is unchanged by the commits after `59b54e3a48c4b0c35adce5daabb1e6ffeaa1a6d7`.

---

## 4. Verification-Findings-and-Corrections Table

| ID | Task claim | Verdict | Live evidence | Required correction |
|---|---|---|---|---|
| VFC-01 | `expectStatus` consumes the response body | **CONFIRMED** | `scripts/test-cro03-http-authorization.ts:78-80` interpolates `await response.text()` into the `assert.equal` message | Replace the helper contract with a single-read capture that returns the captured payload |
| VFC-02 | Consumption occurs even when status matches | **CONFIRMED** | Function arguments are evaluated before `assert.equal`; a native `Response` reproduction produced `bodyUsed: true` after a matching 404 | Do not condition body capture on assertion failure after evaluating an eager message |
| VFC-03 | Foreign private-404 JSON assertion crashes | **CONFIRMED** | Lines 157-159 call `expectStatus(response, 404, ...)`, then `response.json()` | Parse and compare the already captured body; never read the `Response` again |
| VFC-04 | Only the private-404 path is affected | **DISPROVED** | Lines 166-172 repeat the same pattern for admin create: `expectStatus(create, 202)` then `create.json()` | Correct both post-status body consumers and scan the file for any remaining double-read sequence |
| VFC-05 | The application returned the expected private 404 | **SUPPORTED BY ROUTE CONTRACT** | `server/routes/cro03.ts` returns exact `{ code: "not_found", message: "Not found" }` for unauthorized, absent, malformed, and caught batch lookups | Preserve exact shape equality for both foreign GET and foreign cancel |
| VFC-06 | The denied-provider wrapper caused the crash | **DISPROVED** | The wrapper imports the suite after disposable-infrastructure and transport-denial gates; it does not consume HTTP response bodies | Do not weaken or bypass `run-denied-certification-suite.ts` |
| VFC-07 | The failure blocks later server-required suites | **CONFIRMED** | `run-ci-suites.ts:233-237` executes sequentially and aborts on the first rejected suite; CRO-03 HTTP is suite 5 of 16 | Prove suite 6 begins after CRO-03 passes; preferably complete all 16 when no unrelated failure exists |
| VFC-08 | Registry changes are needed | **DISPROVED** | The suite is already present in both `scripts/pre-deploy.ts:401-405` and `scripts/ci-suite-manifest.ts:484-488` | Leave registry identity and capability unchanged |
| VFC-09 | A migration or production remediation is needed | **DISPROVED** | The fault is test-local response consumption | No schema, production data, provider, queue, route, or deployment mutation |
| VFC-10 | A successful process proves fixture cleanup completed | **DISPROVED** | `scripts/test-cro03-http-authorization.ts:182` catches and discards every fixture-user deletion failure, while `run-denied-certification-suite.ts:39-40` records `cleanup: "complete"` on successful exit | Remove the swallowed cleanup failure; any cleanup error must make the suite and receipt fail |

---

## 5. Confirmed Root Cause

Current helper:

```ts
async function expectStatus(response: Response, status: number, label: string): Promise<void> {
  assert.equal(
    response.status,
    status,
    `${label}: expected ${status}, got ${response.status}: ${await response.text()}`,
  );
}
```

The assertion message is evaluated before `assert.equal` executes. Therefore `response.text()` runs on both passing and failing status comparisons. After a matching response:

- `response.bodyUsed` is `true`; and
- a later `response.json()` throws `TypeError: Body is unusable: Body has already been read`.

This is deterministic JavaScript evaluation behavior, not timing flakiness and not a CRO-03 route race.

---

## 6. Complete Affected-Call Census

Two live call sequences require the original body after the status assertion:

| Sequence | Current lines | Expected status | Later body use | Current result |
|---|---:|---:|---|---|
| Foreign manager GET/cancel | 157-159 | 404 | `response.json()` for exact privacy shape | Crashes at first foreign GET |
| Admin batch create | 166-172 | 202 | `create.json()` for `batchId` cleanup ownership | Would crash after the 404 path is repaired locally |

All other `expectStatus` calls currently discard the body. They still perform an unnecessary eager body read, but do not make a second read.

The `login()` helper at line 55 also eagerly reads its body for the assertion message. It does not later need the body, so it is not the blocker, but the implementation may align it with the same captured-diagnostic pattern if done locally without changing authentication semantics.

---

## 7. Privacy-Safe 404 Contract

The correction must preserve, not weaken, all of the following:

1. A manager requesting an existing foreign batch gets HTTP 404.
2. Foreign GET and foreign cancel return exactly:

   ```json
   { "code": "not_found", "message": "Not found" }
   ```

3. The body contains no batch ID, owner ID, actor ID, existence flag, internal error, SQL detail, stack, or correlation data that differs from the minimal contract.
4. The malformed/absent and unauthorized-existing cases remain non-enumerating.
5. The comparison remains exact deep equality; checking only `code`, only `message`, or status alone is insufficient.

---

## 8. Correct Single-Read Response Contract

Use one of these equivalent implementations:

### Preferred form

Have the status helper read the body exactly once and return the captured raw payload:

```ts
async function expectStatus(
  response: Response,
  status: number,
  label: string,
): Promise<string> {
  const body = await response.text();
  assert.equal(
    response.status,
    status,
    `${label}: expected ${status}, got ${response.status}: ${body}`,
  );
  return body;
}
```

Then parse only the returned string for assertions that require JSON:

```ts
const body = await expectStatus(response, 404, label);
assert.deepEqual(JSON.parse(body), NOT_FOUND, "foreign batch response must be privacy-safe");
```

Use the same captured-body path for admin create and validate that the parsed `batchId` is a non-empty string before adding it to cleanup ownership.

### Also acceptable

A typed `expectJsonStatus<T>()` may read once, preserve the raw text for mismatch/parse diagnostics, assert JSON content type, parse exactly once, and return `T`.

---

## 9. Prohibited Implementation Shortcuts

Do not:

- use `response.clone()` so the same network payload is consumed through two response objects;
- catch and ignore `Body is unusable`;
- remove the JSON shape assertion;
- change the expected 404 to 403;
- replace exact deep equality with a partial check;
- reorder the test to avoid the foreign-owner branch;
- remove or skip admin creation;
- bypass the denied-provider wrapper;
- exempt the suite from terminal-receipt validation;
- move the suite to `server-optional`;
- alter `server/routes/cro03.ts` to accommodate the test;
- introduce a provider/network allowlist; or
- claim success from an unwrapped direct invocation alone.

---

## 10. `run-denied-certification-suite.ts` Disposition

**No source correction is currently justified in this file.**

Its relevant behavior is correct:

- it invokes the disposable infrastructure guard for `server-required` suites;
- it installs the certification provider-denial boundary;
- it imports the suite only after those gates;
- it rejects any blocked provider-network attempt; and
- it writes the suite-owned terminal receipt only after successful terminal execution with assertion evidence.

Treat this file as a verification boundary. Modify it only if the focused rerun proves an independent runner defect, and stop for re-audit before expanding #1725 to such a change.

---

## 11. Authorization and Safety Boundary

Task #1725 authorizes only deterministic test-code correction and disposable certification execution.

It does not authorize:

- production database access or mutation;
- live-provider calls or paid operations;
- GHL contact/task/workflow mutation;
- outbound sends or pause changes;
- application route behavior changes;
- schema or migration changes;
- Redis plan/capacity changes;
- production deployment; or
- cleanup outside suite-owned disposable fixtures.

---

## 12. Corrected Implementation Scope

### Required file

- `scripts/test-cro03-http-authorization.ts`

### Verification-only files

- `scripts/run-denied-certification-suite.ts`
- `scripts/run-ci-suites.ts`
- `scripts/ci-suite-manifest.ts`
- `scripts/pre-deploy.ts`
- `.github/workflows/ci.yml`

### Application contract inspected but not to be changed

- `server/routes/cro03.ts`

No other file should change unless a concrete, independently evidenced blocker is found and reported before expansion.

---

## 13. Required Code Changes

1. Replace the eager diagnostic-body read in `expectStatus` with a single-read captured-body contract.
2. Update both foreign-manager response assertions to parse the returned captured payload.
3. Update admin-create handling to parse the returned captured payload.
4. Validate the admin-create payload contains a non-empty `batchId` before recording it for cleanup.
5. Search the entire file and prove no response is read through both `text()` and `json()`.
6. Remove the catch-and-ignore behavior from fixture-user deletion; a failed cleanup must reject `main()` and prevent a passing receipt.
7. Preserve the final success message so the certification wrapper records non-zero assertion evidence.

---

## 14. Assertion Matrix

| Caller | Endpoint class | Required status | Required body assertion |
|---|---|---:|---|
| Anonymous | Batch/reconciliation/policy/create | 401 | Status contract retained |
| Agent | Batch/reconciliation/policy/create | 403 | Status contract retained |
| Owning manager | Own batch GET | 200 | Existing success contract retained |
| Owning manager | Malformed GET/cancel | 404 | Non-enumerating status retained |
| Foreign manager | Existing foreign GET | 404 | Exact `NOT_FOUND` payload |
| Foreign manager | Existing foreign cancel | 404 | Exact `NOT_FOUND` payload |
| Manager | Reconciliation/policy | 403 | Privileged read remains denied |
| Owning manager | Own cancel | 202 | Durable cancellation accepted |
| Admin | Create | 202 | Parsed non-empty `batchId` |
| Admin | Foreign GET | 200 | Global admin authority retained |
| Admin | Cancel | 202 | Global admin authority retained |
| Admin | Malformed GET/cancel | 404 | Non-enumerating status retained |
| Admin | Reconciliation/policy | 200 | Aggregate/policy authority retained |

---

## 15. Focused Regression Proof

The focused proof must run the suite through the actual denied certification wrapper with:

- `NODE_ENV=test`;
- `DATABASE_URL === TEST_DATABASE_URL`;
- a disposable database whose name satisfies the guard;
- disposable Redis with the required reserved namespace;
- the isolated loopback server started through `run-denied-certification-server.ts`;
- seeded disposable admin credentials;
- external provider transport denied; and
- receipt environment supplied by `run-ci-suites.ts`.

Passing the file directly with `npx tsx scripts/test-cro03-http-authorization.ts` is useful for diagnosis but is not sufficient closure evidence.

---

## 16. Terminal Receipt Requirements

The focused run must produce a receipt accepted by `run-ci-suites.ts` with:

- matching `runId`;
- matching suite ID `scripts/test-cro03-http-authorization.ts`;
- `outcome: "executed_pass"`;
- `coreAssertions >= 1`;
- `fixtureGroups >= 1`; and
- `cleanup: "complete"`.

No manually fabricated receipt, runner-owned substitute, or copied receipt from an earlier SHA is valid.

---

## 17. Full Capability Progression Gate

The current server-required order contains 16 suites. CRO-03 HTTP authorization is number 5; `CRM Operator Experience` is number 6.

Minimum task gate:

- the full `server-required` run logs CRO-03 HTTP as executed/pass; and
- execution visibly begins suite 6 after it.

Preferred release gate:

- all 16 server-required suites pass at the implementation SHA.

If a later unrelated suite fails, #1725 may report that separately only after proving suite 5 passed and suite 6 or later began. It must not modify unrelated suites under this task merely to make the aggregate green.

---

## 18. Repetition Gate

Because the root cause is deterministic rather than a race, excessive repetition is unnecessary.

Required:

1. Two consecutive focused denied-wrapper executions of CRO-03 HTTP authorization.
2. One full `server-required` capability execution that proceeds beyond CRO-03.

Any recurrence of `Body is unusable`, a second response-body read, an invalid receipt, provider-denial activity, or fixture cleanup failure fails the task.

---

## 19. Static Kill-Line Checks

At completion, source inspection must show:

- no `await response.text()` embedded in `expectStatus`'s assertion-message expression;
- no call path that invokes `response.json()` after `expectStatus(response, ...)` on the same response;
- no `Response.clone()` workaround;
- unchanged `NOT_FOUND` constant and exact deep-equality assertion;
- unchanged suite registration and `server-required` classification;
- unchanged provider-denial policy; and
- no new external network allowlist.

---

## 20. Failure Semantics

The corrected helper must fail with useful bounded diagnostics:

- wrong status: include label, expected status, actual status, and captured body;
- malformed JSON where JSON is required: fail explicitly with the assertion label and captured bounded body;
- missing/empty admin `batchId`: fail before adding an invalid cleanup ID;
- provider attempt: fail through the existing wrapper;
- missing disposable infrastructure: fail before suite import;
- receipt mismatch or missing receipt: fail the suite runner; and
- cleanup failure: fail the suite rather than claim a valid pass.

Do not include cookies, passwords, session tokens, CSRF tokens, database URLs, or provider credentials in failure output.

---

## 21. Cleanup and Idempotency

Preserve the existing suite-owned cleanup boundary:

- every inserted CRO-03 batch ID is recorded exactly once;
- the created admin batch is recorded only after a valid response payload is parsed;
- the three fixed test users are removed from the disposable database;
- deletion errors are not swallowed;
- the pool is closed; and
- repeated focused executions leave no fixture rows that change later outcomes.

This task does not authorize cleanup in any non-disposable database.

---

## 22. Required Evidence Packet

The implementation report must include:

1. exact implementation SHA;
2. exact changed-file list;
3. before/after explanation of the eager body-read defect;
4. complete affected-call census showing both the foreign 404 and admin 202 paths;
5. static double-read/clone kill-line results;
6. two focused denied-wrapper pass results;
7. terminal receipt validation result for each focused run;
8. provider/network blocked-attempt count of zero;
9. fixture cleanup result, including proof that no cleanup exception was swallowed;
10. full server-required progression evidence showing suite 6 began after suite 5 passed;
11. final server-required result, including any later unrelated failure without concealing it; and
12. confirmation that no route, migration, production data, provider, GHL, outbound, or deployment change occurred.

---

## 23. Corrected Done-Looks-Like

Task #1725 is complete only when:

- one captured response body supplies both status diagnostics and any JSON assertion;
- foreign GET and foreign cancel each prove the exact private-404 body;
- admin create parses its captured `202` body and yields a valid batch ID;
- no response is consumed twice;
- fixture cleanup fails closed and cannot yield a false `cleanup: "complete"` receipt;
- the CRO-03 HTTP suite passes twice through the disposable denied-provider wrapper;
- both terminal receipts validate;
- no provider/network attempt occurs;
- cleanup completes;
- the full server-required capability passes CRO-03 and begins the next suite; and
- all scope and kill-line checks remain satisfied.

---

## 24. Corrected Relevant Files

### Change

- `scripts/test-cro03-http-authorization.ts`

### Verify; do not change absent independent evidence

- `scripts/run-denied-certification-suite.ts`
- `scripts/run-ci-suites.ts`
- `scripts/ci-suite-manifest.ts`
- `scripts/pre-deploy.ts`
- `.github/workflows/ci.yml`
- `server/routes/cro03.ts`

---

## 25. Paste-Ready Controlling Addendum

Paste the following into Task #1725 before implementation:

> **CONTROLLING ADDENDUM — LIVE REPOSITORY AUDIT AT `2273f80b0bb4f3f9b628c8a2316d9d445865b1bc`**
>
> The reported defect is confirmed and is deterministic. `expectStatus` eagerly evaluates `await response.text()` in the assertion message even when the status matches, consuming the response body.
>
> Correct the helper by capturing each response body exactly once and returning that captured payload for any later JSON assertion. Do not use `Response.clone()`, catch/ignore `Body is unusable`, weaken exact private-404 equality, remove checks, or alter the CRO-03 route.
>
> The correction must cover both affected post-status body consumers:
>
> 1. Foreign-manager GET and cancel: parse the captured body and retain exact deep equality with `{ code: "not_found", message: "Not found" }`.
> 2. Admin create: parse the captured `202` body, require a non-empty `batchId`, and record it for cleanup.
>
> `scripts/run-denied-certification-suite.ts` is a verification boundary, not a known defect. Do not change or bypass its disposable-infrastructure guard, provider-denial boundary, blocked-attempt check, or terminal-receipt requirements.
>
> In the suite, remove the catch-and-ignore behavior around fixture-user deletion. The wrapper records `cleanup: "complete"` when the suite exits successfully, so any cleanup failure must reject the suite and prevent a passing receipt.
>
> Required verification:
>
> - source scan proves no double read and no clone workaround;
> - two consecutive focused passes through the denied certification wrapper;
> - valid terminal receipt for each pass;
> - zero blocked provider/network attempts;
> - successful disposable fixture cleanup; and
> - one full `server-required` capability run proving CRO-03 HTTP (suite 5 of 16) passes and suite 6 begins. Prefer all 16 green, but report any later unrelated failure without expanding this task.
>
> No route, schema, migration, production data, provider, GHL, outbound, Redis-plan, deployment, or application behavior change is authorized.

---

## 26. Audit Evidence Limitations

The live source tree and runner contracts were verified, and the response-consumption failure was reproduced with Node's native `Response` implementation. This audit environment did not expose the disposable PostgreSQL, Redis, seeded-admin, or installed dependency context required to execute the canonical server-required capability. Runtime pass evidence must therefore be produced by the implementation agent in the repository's disposable CI/Replit certification environment.

---

## 27. Final Audit Disposition

Task #1725 should remain one narrow correction task.

**Disposition:** `BUILD-READY WITH REQUIRED CORRECTIONS`  
**P0 findings:** 0  
**P1 corrections:** 4

1. Cover both post-status body consumers, not only the first private 404.
2. Enforce a true single-read captured-payload contract; no clone or weakened assertion.
3. Require canonical denied-wrapper receipts and full-capability progression evidence.
4. Make disposable fixture cleanup fail closed so the receipt's cleanup claim is truthful.

**P2 hardening requirements:** bounded diagnostics, explicit admin `batchId` validation, static double-read kill lines, and two focused repetitions.

No repository code, migrations, database rows, provider operations, GHL state, outbound state, production data, deployment state, or external system was modified during this audit.
