# LIBERTY BANCARD — PREFLIGHT + BUILD MODE

## MODE

PREFLIGHT + BUILD. Verify every claim against current code, correct stale assumptions, and implement immediately when safe. Do not stop at a plan without a genuine blocker.

Do not blindly trust old paths/line numbers, redesign the system, create a second outbound authority, perform unrelated cleanup, use `db push`, weaken tests, make real sends, or turn an exemption into proof of safety. Stop only for a false finding, wrong owner, missing prerequisite, materially different architecture, unavailable required evidence, necessary scope split, or kill line.

Required sequence: repository baseline → VFC → searches → root cause → ownership → blast radius → schema/auth/concurrency/external checks → verdict → corrected plan → kill lines → implementation → tests/gates → post-build searches → diff → final VFC → merge verdict.

## 1. REPOSITORY BASELINE

Capture branch, HEAD SHA, working tree, and migration head if schema is implicated. Preserve unrelated modifications. Record current global/channel pause posture only through safe existing diagnostics; do not mutate it.

## 2. VERIFIED FROM CODE — PREFLIGHT

Provide:

| ID | Task Claim | Verdict | Verified Reality | Evidence |
|---|---|---|---|---|
| VFC-01 | ... | CONFIRMED / PARTIAL / FALSE / OUTDATED | ... | `file:line` |

Verify the actual provider mutation boundary, `OutboundPauseAuthority`, channel/contactability owner, in-flight/epoch behavior, adapters/transports, scanner rules/exemptions, every caller/writer, webhook/read-only path, queue/worker path, audit/log owner, and existing tests. Inspect code around each hit.

## 3. REQUIRED SEARCH / GREP CHECKS

Search current code for:

- `OutboundPauseAuthority`, `authorize`, `canExecute`, pause epoch/in-flight registration/final recheck;
- raw GHL client/fetch calls, contact/opportunity/task/workflow/DND/email/SMS mutations;
- `sendEmail`, `sendSms`, GHL/SMTP/SendGrid/Gmail providers;
- `ghl-form-sync`, GHL services/routes/webhooks and current exemptions/allowlists;
- `enqueuePromotionalEnrollment`, sequence/enrollment/outbound queues/workers;
- consent/contactability/suppression checks at caller and boundary;
- audit/log payloads containing contact IDs, recipient addresses/numbers, subject/body, tokens, provider responses;
- tests for pause denial, stale epoch, in-flight drain, retry/idempotency and partial failure.

Classify each relevant call as read, inbound webhook, transactional mutation, promotional mutation, test-only fake, or dead code. Grep is inventory, not proof.

## 4. VERIFIED ROOT CAUSE

State the original claim, the current bypass/exemption behavior, and whether any transports already enforce canonical authority internally. Include:

| Original Assumption | Verified Reality | Correction |
|---|---|---|
| ... | ... | ... |

## 5. SOURCE-OF-TRUTH CHECK

Identify:

- canonical outbound authorization owner;
- canonical contactability/suppression owner;
- canonical GHL identity/sync owner;
- canonical durable enrollment/job owner;
- canonical provider adapter/transport owner;
- canonical audit/log owner.

Do not create caller-specific pause checks as a substitute for enforcing the mutation boundary. Do not create a second GHL synchronization system.

## 6. BLAST RADIUS

### In scope

- inventory/classification of every production-reachable GHL/provider mutation;
- removal of verified unsafe exemptions;
- routing mutations through approved adapters;
- mandatory pause authority, final epoch recheck, in-flight registration and structured outcome at mutation boundaries;
- retry/idempotency preservation;
- PII/secret/message-content redaction;
- scanner and fake-transport regression coverage.

### Out of scope

- changing business workflow semantics unrelated to transport safety;
- reworking GHL inbound/read-only sync unnecessarily;
- enabling outbound, SMS, or provider traffic;
- broad contactability vocabulary redesign (BT-04 owns it);
- real provider calls in tests.

List expected and explicitly untouched files. Keep the diff minimal.

## 7. DATA / SCHEMA CHECK

Verify audit/idempotency/in-flight tables if used. Migration required: NO unless preflight proves the canonical boundary needs durable state not already available. Any migration must use the next valid migration and journal entry; never `db push` or unrelated backfill.

## 8. AUTHORIZATION CHECK

If operator/API actions can trigger provider mutations, verify server-side roles:

| Action | Public | Agent | Manager | Admin | Worker/System |
|---|---:|---:|---:|---:|---:|
| Trigger relevant mutation | ... | ... | ... | ... | ... |

Client hiding is not authorization. Admin/manual paths must pass the same safety boundary.

## 9. CONCURRENCY / IDEMPOTENCY CHECK

For each mutation family, verify stable idempotency key, atomic/local claim, concurrent triggers, retry, partial success, crash recovery, in-flight registration/removal, pause epoch changes between authorization and external call, and duplicate external side effects. `SELECT` then `INSERT` is not sufficient when concurrency matters.

## 10. EXTERNAL SIDE-EFFECT CHECK

Document actual ordering for each adapter, for example:

local eligibility/identity lookup → pause authorization → durable claim/idempotency → final epoch check/in-flight registration → external call → durable outcome → audit → in-flight release.

Verify external success/DB failure, DB success/external failure, retry/replay, provider timeout, and unknown outcome. Never claim external writes are atomic with PostgreSQL.

## 11. PREFLIGHT VERDICT

Choose BUILD-READY, BUILD-READY WITH CORRECTIONS, PREFLIGHT REQUIRED, NOT BUILD-READY, NOT NEW TASK, or WATCH. Continue immediately for build-ready verdicts.

## 12. CORRECTED BUILD PLAN

State verified What & Why, exact Done Looks Like, and current-file implementation steps. Separate **BLOCKING CORRECTION** from **FOLLOW-UP HARDENING**. If the inventory proves the scope is too large for one atomic safe change, split by mutation family only with explicit shared-boundary acceptance criteria; do not leave a known bypass silently in scope.

## 13. KILL LINES

- KILL LINE: If any production-reachable automated provider mutation can occur without the canonical pause authority and final boundary recheck, the task has FAILED.
- STOP if an exemption or caller-local check substitutes for enforcement at the actual mutation boundary.
- STOP if paused or stale-epoch work can still cause an external write.
- STOP if rejected work causes enqueue, audit-as-success, or other downstream mutation.
- STOP if retry/concurrency can duplicate provider side effects without an explicit idempotency strategy.
- STOP if logs/audits expose recipient data, message content, tokens, or raw provider payloads beyond approved sanitized fields.
- STOP if tests invoke real providers or weaken existing pause/contactability protections.

## 14. IMPLEMENTATION RULES

Use the smallest safe diff and existing adapters/authority. No unrelated refactor, broad rename, formatting sweep, dependency change, or production config mutation. Preserve read/webhook behavior unless it is part of the verified bypass.

## 15. TEST REQUIREMENTS

Map tests directly to Done Looks Like and kill lines:

- allowed fake mutation succeeds;
- paused mutation is denied before transport;
- stale epoch after initial authorization is denied;
- missing/unreadable authority fails closed;
- concurrent/replayed triggers do not duplicate transport;
- external success/local failure and timeout have recoverable outcomes;
- unauthorized operator routes fail;
- logs/audits are sanitized;
- read-only/inbound behavior remains intact.

Tests must exercise production adapter paths, not only helper functions.

## 16. SMOKE / INTEGRATION TEST

Extend the existing outbound/pause/compliance suite. If no suite proves every changed mutation family, add `scripts/test-bt03-outbound-boundary.ts` (or repository-consistent equivalent) with fake transports and no live network calls.

## 17. POST-BUILD GREP CHECKS

Re-run the full mutation inventory. Prove the old direct/exempt path is gone or unreachable, every caller uses the canonical boundary, no stale allowlist remains, all response/status consumers were handled, and no legacy transport owner conflicts.

## 18. REQUIRED GATES

Run actual targeted adapter tests, sequence/outbound/pause/coordinator tests, compliance scanners, typecheck, production build if affected, contract/invariant tests, and `git diff --check`. Report command and PASS/FAIL. Do not claim complete while a task-owned gate is red.

## 19. DIFF REVIEW

Run `git status`, `git diff --stat`, and `git diff`. Confirm only intended files, no secrets/PII/debug junk/generated files/lockfile drift/unrelated formatting/production config changes.

## 20. FINAL VFC TABLE

| ID | Requirement | Evidence | Test / Gate | Status |
|---|---|---|---|---|
| VFC-F01 | ... | `file:line` | ... | PASS / FAIL |

Represent every material Done Looks Like requirement and kill line.

## 21. FINAL RESPONSE FORMAT

Return VERDICT, repository state, migration head if relevant, verified root cause, corrections, `file:line` implementation, gate table, grep proof, kill-line proof, runtime/production distinction, realistic risks, and SAFE TO MERGE / SAFE TO MERGE — RUNTIME VERIFICATION PENDING / DO NOT MERGE.

## LIBERTY-SPECIFIC SAFETY RULES

- Outreach: data readiness, lead score, consent, contactability and promotional eligibility remain separate; passing one never implies another.
- GHL: verify ownership, ordering, retries, duplicate IDs, field protection and partial failures as distributed state.
- Email/sequences: never bypass durable enrollment/sending architecture or suppression/unsubscribe/contactability.
- Jobs: no process-memory-only recovery or swallowed provider error on revenue-critical work.
- Tests: fake transports only; no real provider send, workflow mutation, task creation, DND change or GHL write.

## PRACTICAL REVIEW STANDARD

Block for realistic duplicate sends, compliance bypass, wrong-contact/provider mutation, unauthorized behavior, or unrecoverable outbound state. Do not expand the task into a full GHL redesign when the verified residual is a bounded adapter/caller migration.

---

# TASK TO PREFLIGHT + BUILD

## BT-03 — Canonical Outbound/GHL Boundary & Log Redaction

**Primary findings:** `OUT-01`, `OUT-02`, `OUT-03`, `OUT-04`, `OUT-09`, `OUT-10`, `OUT-12`
**Dependency:** BT-05 scanner additions may land in the same release

### What & Why

The original audits found production-reachable GHL/provider mutation paths and exemptions that could bypass the intended global pause/contactability boundary. More recent work hardened fail-closed startup, pause authority, and several transports, so the current task must first distinguish already-correct paths from residual bypasses. Operational logs may also disclose recipient identifiers, message metadata/content, tokens, or raw provider details.

### Done Looks Like

- Every production-reachable opportunity, contact, task, workflow, DND, email, SMS, and related provider mutation is classified and owned.
- Every mutation crosses the approved boundary with pause authorization, final epoch recheck, in-flight registration, structured outcome, and safe idempotency/retry behavior as applicable.
- `server/services/ghl-form-sync.ts` or its current replacement has no unsafe exemption.
- Static scanners find no unapproved provider mutation or caller bypass.
- Fake-transport tests prove paused and stale-epoch denial for every changed adapter family.
- Logs and audits retain correlation/reason/outcome evidence without sensitive recipient/message/token content.
- Existing inbound/read-only GHL behavior remains functional.

### Out of Scope

- Enabling live outbound or SMS.
- Redesigning GHL identity reconciliation.
- Replacing the BT-04 consent vocabulary/projection.
- Unrelated provider or UI cleanup.

### Proposed Implementation Steps

1. Build a complete call-site classification table from current code.
2. Confirm the canonical pause/contactability/transport/idempotency owners.
3. Remove the verified unsafe exemption and migrate each residual mutation to the approved adapter.
4. Enforce final epoch/in-flight behavior at the last local boundary before external I/O.
5. Preserve or add stable idempotency and recoverable outcome handling.
6. Sanitize logs/audit payloads through the existing logging owner.
7. Update the scanner/allowlist so only justified read/webhook/test paths remain.
8. Extend fake-transport production-path tests and all related gates.

### Relevant Files and Areas to Verify

- `server/services/outbound-pause-authority.ts` or current authority owner
- `server/services/channel-orchestrator.ts` or current channel owner
- `server/services/ghl.ts` and GHL adapter/client modules
- `server/services/ghl-form-sync.ts`
- GHL workflow enrollment, workflow executor, campaign/proposal/SLA/SDR services and relevant routes
- queue/sequence worker and enrollment services
- audit/logging/redaction utilities
- `scripts/pre-deploy.ts`, compliance scanners and outbound test suites

Locate current owners; historical paths are starting points only.

### Existing Kill Line

KILL LINE: If any production-reachable external mutation can still occur after a denied/unreadable pause decision or stale epoch—or through an exemption that bypasses the canonical boundary—the task has FAILED.

## FINAL DIRECTIVE

Verify first, correct the inventory and plan, then build in the same run if safe. Do not confuse a green static scan with proof of the production mutation path, and do not ask for another approval unless the verified scope genuinely requires a controlled split.
