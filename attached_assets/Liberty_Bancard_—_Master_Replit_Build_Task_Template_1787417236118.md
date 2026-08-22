# LIBERTY BANCARD — MASTER BUILD TASK

## TASK

**Task ID:** `[TASK_ID]`  
**Title:** `[TASK_TITLE]`  
**Mode:** BUILD  
**Risk:** `[LOW / MEDIUM / HIGH]`  
**Schema Change:** `[YES / NO]`  
**Runtime Verification Required:** `[YES / NO]`

---

# 1. VERIFIED CONTEXT

This task has already been preflighted.

Build from the **verified/corrected plan below**, not from older assumptions or prior task wording.

Before editing, quickly confirm:

- current branch;
- current HEAD SHA;
- working tree status;
- referenced files/functions still exist;
- no material repository drift invalidates the plan.

If material drift is found, stop and report it rather than blindly implementing stale instructions.

Minor line-number drift is not a blocker.

---

# 2. WHAT & WHY

[PASTE THE VERIFIED PROBLEM STATEMENT]

### Business / Product Impact

[WHY THIS MATTERS TO LIBERTY]

### Verified Root Cause

[PASTE THE CONFIRMED ROOT CAUSE]

---

# 3. DONE LOOKS LIKE

The task is complete only when all applicable requirements below are true:

- [ ] `[REQUIREMENT 1]`
- [ ] `[REQUIREMENT 2]`
- [ ] `[REQUIREMENT 3]`
- [ ] `[REQUIREMENT 4]`
- [ ] `[REQUIREMENT 5]`

Do not substitute “code added” for verified behavior.

---

# 4. IN SCOPE

### Files expected to change

```text
[path] — [reason]
[path] — [reason]
[path] — [reason]
```

### Behaviors in scope

- `[behavior]`
- `[behavior]`
- `[behavior]`

---

# 5. OUT OF SCOPE

Do not change:

- `[behavior/system]`
- `[behavior/system]`
- `[behavior/system]`

### Files explicitly not to touch

```text
[path] — [reason]
[path] — [reason]
```

Do not expand scope for cleanup, refactoring, or unrelated hardening.

---

# 6. SOURCE-OF-TRUTH RULES

Use the existing canonical owner.

For this task:

- **Canonical data owner:** `[table/service]`
- **Canonical mutation owner:** `[service/function]`
- **Canonical queue/job owner:** `[if applicable]`
- **Canonical external integration owner:** `[if applicable]`

Do not create a parallel writer, queue, resolver, sync path, or policy engine if an existing canonical implementation already owns the behavior.

---

# 7. IMPLEMENTATION PLAN

## Step 1 — `[STEP NAME]`

**File:** `[path]`

Implement:

[EXACT REQUIRED CHANGE]

Expected behavior:

[EXPECTED RESULT]

---

## Step 2 — `[STEP NAME]`

**File:** `[path]`

Implement:

[EXACT REQUIRED CHANGE]

Expected behavior:

[EXPECTED RESULT]

---

## Step 3 — `[STEP NAME]`

**File:** `[path]`

Implement:

[EXACT REQUIRED CHANGE]

Expected behavior:

[EXPECTED RESULT]

---

## Step 4 — `[OPTIONAL]`

Continue only as required by the verified plan.

Keep the implementation focused.

---

# 8. DATABASE / MIGRATION REQUIREMENTS

## If Schema Change = NO

Do not create a migration.

Do not use `db push`.

## If Schema Change = YES

Before creating the migration:

- verify the current migration high-water mark;
- use the next valid migration number;
- update the canonical Drizzle migration journal/metadata;
- do not use `db push`;
- do not perform unrelated backfills;
- preserve existing rows unless the task explicitly requires data migration.

Required schema:

```text
TABLE:
COLUMN/INDEX/CONSTRAINT:
TYPE:
NULLABILITY:
DEFAULT:
PURPOSE:
```

After migration, verify the actual resulting schema.

---

# 9. AUTHORIZATION REQUIREMENTS

If the task affects an authenticated action, preserve the verified role contract.

Required permissions:

| Action | Public | Agent | Manager | Admin |
|---|---:|---:|---:|---:|
| `[action]` | `[deny]` | `[allow/deny]` | `[allow/deny]` | `[allow]` |

Do not weaken existing authorization.

Admin-only overrides must remain admin-only.

---

# 10. CONCURRENCY / IDEMPOTENCY REQUIREMENTS

If the task creates, converts, enrolls, imports, sends, merges, or processes jobs, implement the verified concurrency contract.

Required protections may include:

- database unique constraint;
- atomic conditional update;
- durable claim;
- stable idempotency key;
- generation/version;
- transaction;
- retry-safe reconciliation.

State the task-specific contract here:

```text
[PASTE VERIFIED CONCURRENCY / IDEMPOTENCY CONTRACT]
```

A simple read-before-write check is not sufficient when duplicate execution has material impact.

---

# 11. EXTERNAL SIDE-EFFECT REQUIREMENTS

If this task interacts with:

- GHL;
- SendGrid;
- SMS;
- BullMQ/Redis;
- enrichment providers;
- webhooks;
- external APIs;

follow the verified ordering.

```text
[LOCAL AUTHORITY CHECK]
→ [LOCAL WRITE]
→ [EXTERNAL CALL]
→ [QUEUE/AUDIT/RECONCILIATION]
```

or the exact verified sequence for this task.

Handle:

- external success + DB failure;
- DB success + external failure;
- retry;
- replay;
- partial completion.

Do not hold a DB transaction open across slow external network calls unless the verified architecture specifically requires it.

---

# 12. LIBERTY SAFETY RULES

Apply only where relevant.

## Contacts

Use canonical contact writers.

Do not introduce direct contact mutations that bypass provenance, readiness, scoring, or GHL ownership rules.

## Prospects

Preserve:

- identity safety;
- conversion idempotency;
- deal deduplication;
- concurrency safety.

## Outreach

Keep separate:

- readiness;
- lead score;
- consent;
- contactability;
- promotional eligibility.

Passing one does not automatically authorize another.

## Consent

Do not silently re-enable opted-out channels.

Email and SMS remain channel-specific unless a confirmed global DNC rule applies.

## GHL

Treat GHL/local state as distributed state.

Protect canonical local-owned fields and handle partial failures.

## Sequences / Email

Use the canonical durable enrollment and outbound paths.

Do not introduce direct-send shortcuts.

## Jobs

Do not replace durable work with:

- `setImmediate`;
- process-memory-only retry;
- swallowed promise failures;
- untracked fire-and-forget execution.

## Imports / Enrichment

Preserve provenance, confidence, replay safety, and manual authority.

---

# 13. KILL LINE

## Primary Kill Line

> **If `[UNSAFE / BROKEN BEHAVIOR]` is still possible after this task, the task has FAILED regardless of all other work.**

Additional kill lines:

- STOP if `[condition]`.
- STOP if `[condition]`.
- STOP if `[condition]`.
- STOP if `[condition]`.

Every kill line must have a corresponding validation step.

---

# 14. TEST REQUIREMENTS

Add or update tests that prove the real production behavior.

Required coverage:

### Happy Path
`[EXPECTED SUCCESS]`

### Negative Path
`[UNSAFE / INVALID ACTION IS BLOCKED]`

### Boundary / Edge
`[NULL / EXACT THRESHOLD / STATUS EDGE]`

### Replay / Idempotency
`[IF APPLICABLE]`

### Concurrency
`[IF APPLICABLE]`

### Authorization
`[IF APPLICABLE]`

### Partial Failure
`[IF EXTERNAL OR MULTI-STEP]`

### Regression
`[ADJACENT EXISTING BEHAVIOR REMAINS CORRECT]`

Do not write only a helper-level test when the task changes a route, service, worker, or integration path.

---

# 15. TARGETED SMOKE TEST

Create or update:

```text
scripts/test-[TASK-SLUG].ts
```

if that matches repository convention.

Required assertions:

1. `[ASSERTION]`
2. `[ASSERTION]`
3. `[ASSERTION]`
4. `[ASSERTION]`
5. `[ASSERTION]`
6. `[ASSERTION]`

The smoke test must prove the primary kill line.

---

# 16. GREP / STATIC VERIFICATION

After implementation, run targeted greps for:

```bash
grep -R "[OLD_UNSAFE_PATTERN]" server shared client scripts
grep -R "[NEW_CANONICAL_PATH]" server shared client scripts
grep -R "[RELEVANT_STATUS_OR_FIELD]" server shared client
```

Verify:

- old unsafe behavior is removed or unreachable;
- all relevant callers use the corrected path;
- no bypass remains;
- no stale consumer was missed.

Document exact results.

---

# 17. REQUIRED GATES

Run the actual repository commands for all relevant gates.

Minimum expected:

| Gate | Command | Required Result |
|---|---|---|
| Targeted task test | `[command]` | PASS |
| Related subsystem tests | `[command]` | PASS |
| Typecheck | `[command]` | PASS |
| Contract / invariant tests | `[if applicable]` | PASS |
| Migration/schema verification | `[if applicable]` | PASS |

Do not invent commands.

If a required gate fails because of this task, fix it before completion.

If a failure is pre-existing and unrelated, provide evidence.

---

# 18. RUNTIME VERIFICATION

If Runtime Verification Required = YES:

Clearly separate:

### Static proof

What code/tests prove.

### Runtime proof

What must be observed in a running environment.

Do not claim local mocks prove production behavior.

Do not send real emails/SMS, enroll real contacts, create live GHL records, or mutate production data unless explicitly authorized.

---

# 19. DIFF REVIEW

Before completion run:

```bash
git status
git diff --stat
git diff
```

Verify:

- only intended files changed;
- no unrelated refactors;
- no debug logging;
- no secrets;
- no temporary artifacts;
- no accidental package/lock changes;
- no production config changes;
- no generated junk.

---

# 20. COMPLETION EVIDENCE

Create a final VFC table:

| Requirement | Evidence | Test / Gate | Status |
|---|---|---|---|
| `[Done Looks Like item]` | `file:line` | `[test]` | PASS |
| ... | ... | ... | PASS |

Every material requirement must be represented.

---

# 21. FINAL RESPONSE FORMAT

Return exactly:

# VERDICT

**COMPLETE / VERIFIED**

or

**PARTIALLY COMPLETE**

or

**DO NOT MERGE**

## Repository State

- Starting SHA:
- Ending SHA / working tree:
- Migration head:

## Implementation Summary

- `file:line` — change
- `file:line` — change
- `file:line` — change

## Tests / Gates

| Gate | Result |
|---|---|
| ... | PASS |

## Grep / Static Checks

- `[check]` — PASS
- `[check]` — PASS

## Kill-Line Verification

- **PASS** — `[kill line]`: `[evidence]`
- **PASS** — `[kill line]`: `[evidence]`

## Runtime Verification

**Verified:**  
[what was proven]

**Still required:**  
[only if applicable]

## Remaining Risks

Only realistic task-specific risks.

Do not create theoretical follow-up work simply for completeness.

## Final Status

One of:

**SAFE TO MERGE**

**SAFE TO MERGE — RUNTIME VERIFICATION PENDING**

**DO NOT MERGE**

---

# PRACTICAL STANDARD

This is a build task, not a new architecture exercise.

Do not restart the entire preflight unless repository drift invalidates the verified plan.

Do not block a safe implementation for theoretical hardening.

A blocking issue is something that leaves a realistic path to:

- duplicate sends;
- compliance bypass;
- incorrect merchant/contact mutation;
- duplicate records with material impact;
- data loss;
- unauthorized behavior;
- broken revenue workflow;
- unrecoverable operational failure.

Everything else should be classified as non-blocking follow-up hardening.

---

# BUILD TASK

## `[TASK_ID] — [TASK_TITLE]`

### Verified What & Why

[PASTE]

### Done Looks Like

[PASTE]

### Out of Scope

[PASTE]

### Verified Implementation Steps

[PASTE]

### Relevant Files

[PASTE]

### Kill Lines

[PASTE]

### Required Tests / Gates

[PASTE]

---

# FINAL DIRECTIVE

Implement the verified task exactly to its intended product behavior.

Keep the diff minimal.

Use canonical owners.

Prove the kill line.

Run the tests and gates.

Review the final diff.

Then return evidence sufficient for a skeptical senior reviewer to determine whether the task is safe to merge.