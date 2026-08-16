# Task #1548 Repository Audit

**Task audited:** `#1548 - Pause Cycle Test, Intent Recovery Worker, and Backlog Preview`  
**Repository:** `liberty-buildspec-audit`  
**Authoritative ref:** `origin/main`  
**Verified SHA:** `5811398d7f4d9039d5f5b1709738219902a68c4d`  
**Audit mode:** read-only static inspection of the pushed repository, the supplied task, and the eight supplied audit/reference documents  
**Verdict:** **REJECT AS WRITTEN; REWRITE AND SPLIT BEFORE BUILD**

## 1. Executive verdict

The task correctly identifies three real gaps:

1. there is no full behavioral pause-cycle test;
2. `post_enrichment_enrollment_intents` has a producer but no consumer;
3. there is no domain-aware backlog-preview endpoint or UI.

It is not safe or implementation-ready as written. The most important defects are:

- The proposed mandatory pause-cycle test can mutate a shared database's global pause state, unpause real workers, restore all legacy paused enrollments, and clear real `release_pending` holds. A `finally` block does not make that safe.
- The current producer is not a transactional outbox. It stamps `deals.post_enrichment_automation_at` before writing the intent. A crash or insert failure between those steps permanently loses the enrollment request.
- The current intent row does not store the chosen `sequence_id` or an immutable enrollment payload. Recovery cannot reproduce the original decision.
- The proposed recovery target, `enrollContactInGhlWorkflow()`, does not create a Liberty `sequence_enrollments` row. The function deliberately performs GHL contact/tag/note synchronization and returns `enrolled: false` for locally orchestrated sequences.
- A unique intent key does not provide exactly-once execution. There is no processing lease, claim token, stale-processing recovery, or atomic linkage between the external/local effect and intent completion.
- The backlog SQL names nonexistent fields: `sequence_enrollments.next_send_at` and `sequence_enrollments.channel`. The actual field is `next_action_at`; channel is derived from the current `sequence_steps.action_type`.
- There is no existing queue-holds client page. The task cannot simply add a card to it.
- The existing queue-holds GET route directly serializes nested `bigint` values and can fail whenever active holds are returned.
- The existing queue-compliance gate is broken at the audited SHA: it reads `result.valid`, while `validateManifest()` returns `result.ok`; its paused-status scanner also flags many unrelated, legitimate pause writes.

Recommendation: split #1548 into four ordered tasks and do not start recovery or preview work until the baseline repair and isolated test harness are accepted.

## 2. Repository and document controls

- The audit used `git show origin/main:<path>` so local working-tree differences did not affect evidence.
- Existing user changes to the terminal image and merchant video were not touched.
- No repository file, database row, Redis key, queue, worker, pause control, or provider was mutated.
- No network provider call or runtime worker was started.
- The older audit documents were treated as architectural constraints, not as proof of the current SHA.

The supplied audits add two important constraints that #1548 currently violates:

- `CODEX_ENRICHMENT_CRAWLER_RUNTIME_AUDIT` calls post-enrichment commercial mutation unsafe and recommends separating qualification/NBA from opportunity/enrollment mutation.
- `CODEX_CRM_DATA_AND_CANONICAL_SOURCE_AUDIT` states that every promotional enrollment initiator must use one canonical idempotent eligibility/enrollment service and persist the eligibility decision.

The recovery design must therefore route through the canonical promotional enrollment boundary or introduce a narrowly defined canonical post-enrichment enrollment command. It must not replay the current GHL synchronization helper as if that helper creates an enrollment.

## 3. Corrected VFC table

| ID | Claim | Verdict | Verified reality |
|---|---|---:|---|
| VFC-01 | #1532 coordinator, hold ledger, and VFC-22 code landed | Confirmed, static only | Coordinator and migration 0137 exist; VFC-22 sweep is in `outbound-control-service.ts:450-517`. Runtime migration state is unverified. |
| VFC-02 | Pause API is `PATCH /api/system/outbound-settings` | Confirmed | `server/routes/activation.ts:1477-1510`; response contains `control.state`. |
| VFC-03 | Release-approval route exists and is admin-only | Confirmed | `server/routes/admin.ts:2688-2703`. Input lacks a Zod schema, but role protection exists. |
| VFC-04 | Pre-deploy wrapper starts a development server | Confirmed | `scripts/run-pre-deploy.sh:49-92`. It inherits the configured database and Redis environment. |
| VFC-05 | No full pause-cycle test exists | Confirmed | Existing pause tests do not execute the complete state transition. |
| VFC-06 | `_holdDeferred` does not change enrollment status | Confirmed | `sequence-worker.ts:180-243`; identical reason + step is idempotent. |
| VFC-07 | VFC-22 restores legacy `_globalPauseBlockReason` rows | Confirmed with safety note | It updates every matching paused enrollment, not a test-scoped row. Running this in a shared pre-deploy test is unsafe. |
| VFC-08 | Intent table exists | Confirmed | Migration 0137 and `shared/schema.ts:5664-5682`. It lacks target sequence/payload and claim-lease fields. |
| VFC-09 | Intent consumer is absent | Confirmed | No code consumes pending post-enrichment intents. |
| VFC-10 | Existing `ENROLLMENT_RECOVERY` queue is the wrong handler | Confirmed | It owns cap-deferred sequence enrollment recovery. |
| VFC-11 | Manifest has `post-enrichment-enrollment` | Confirmed with defect | It uses wildcard job matching and incorrectly declares `backlogSource: "promotional_enrollment_jobs"`. |
| VFC-12 | No backlog-preview route exists | Confirmed | No matching server route. |
| VFC-13 | Four domain stores exist | Confirmed statically | Deferred GHL table is SQL-only; runtime relation presence is unverified. |
| VFC-14 | `getStatus()` does not return domain counts | Confirmed | Actual fields are `desiredLogicalHolds`, `physicalQueueStates`, `ledgerEpoch`, and `reconciledAt`; the task's evidence text names fields that do not exist. |
| VFC-15 | `approveRelease()` does not trigger recovery | Confirmed | It only clears matching `release_pending` rows and commits. |
| VFC-16 | Manifest has 41 logical keys | False | The audited SHA has **42** manifest entries. A new recovery entry would make 43. |
| VFC-17 | Current post-enrichment path enrolls a sequence | False | `enrollContactInGhlWorkflow()` explicitly does not trigger a GHL workflow or create `sequence_enrollments`; it returns `enrolled: false` for Replit orchestration. |
| VFC-18 | Intent idempotency key proves exactly-once recovery | False | It deduplicates intent creation only. It does not atomically fence the effect or recover a crashed `processing` claim. |
| VFC-19 | Proposed sequence backlog query uses real columns | False | `next_send_at` and enrollment `channel` do not exist. Use `next_action_at` and derive channel from the current sequence step. |
| VFC-20 | Existing queue-holds UI page exists | False | No client code calls `/api/admin/queue-holds`; there is no hold-ledger page to extend. |
| VFC-21 | `qm.getQueueStats()` exists | False | QueueManager exposes `getAllQueueMetrics()`, `getQueue()`, and `requireQueueManagerReady()`. |
| VFC-22 | Existing queue-holds GET is JSON-safe | False | Nested `HoldEntry.sourceEpoch`, `ledgerEpoch`, and reconciliation epochs are `bigint` and are passed directly to `res.json()`. |
| VFC-23 | Current QueueManager schedule model supports a second named schedule on the same physical queue | False | One `QUEUE_CONFIGS` row owns each physical queue, and startup removes all repeatable jobs for that queue before installing one configured schedule. |
| VFC-24 | Queue compliance gate is healthy at baseline | False | `check-queue-compliance.ts:212` reads `result.valid`; the manifest validator returns `ok`. The status scanner also flags unrelated `status: "paused"` lines. |

## 4. Findings by priority

### P0-1 — Mandatory pause-cycle test can release production work

`run-pre-deploy.sh` starts the ordinary development server with the caller's configured environment. The proposed test then changes global pause state through the real admin API, invokes the broad VFC-22 sweep, transitions every outbound logical key to `release_pending`, and approves release.

A `finally` restoration is insufficient because:

- restoring an originally unpaused state can release real queued work;
- an operator can change state concurrently and the test can overwrite that newer intent;
- unpause restores every row with `_globalPauseBlockReason`, not only the fixture;
- release approval clears real release-pending holds for the selected keys;
- provider-boundary protection does not prevent queue/enrollment mutations;
- process termination can occur before cleanup;
- the test requires authenticated admin state but the task does not define a safe authentication fixture.

**Required correction:** the mandatory test must run only against an isolated test database and fake Redis namespace, with provider functions replaced by throwing fakes. The ordinary pre-deploy suite may run a unit/state-machine test; a destructive integration test needs an explicit isolated-environment guard and must refuse to start otherwise.

### P0-2 — The existing producer can permanently lose intents

`post-enrichment-worker.ts` writes `post_enrichment_automation_at` at lines 116-123 before it resolves and writes the enrollment intent at lines 209-219. The insert error handler suppresses a missing-relation error, and the job then returns. A retry sees the deal stamp and exits at lines 111-114.

Crash windows:

1. after the deal stamp but before sequence selection;
2. after selection but before intent insert;
3. during intent insert;
4. when migration 0137 is not applied.

All can leave the deal permanently stamped with no recoverable enrollment intent.

**Required correction:** write the safe deal transition marker and durable enrollment command in one database transaction, or split stage completion and enrollment-intent completion into independently retryable state fields. Intent persistence failure must fail the job; it must not be swallowed.

### P0-3 — Recovery would replay the wrong effect

The task says the recovery worker should call "the enrollment path" using the stored key. The current producer's path is `enrollContactInGhlWorkflow()`. That function:

- evaluates contactability;
- upserts/synchronizes a GHL contact;
- adds tags and a note;
- deliberately does not trigger outbound GHL workflow orchestration;
- does not create a `sequence_enrollments` row;
- returns `enrolled: false`, `method: "replit_direct"` on the intended path.

Therefore, completing an intent after calling this helper would still leave no local sequence enrollment.

**Required correction:** recovery must call the canonical eligibility/enrollment command that creates the durable local enrollment, using the partial unique index on `(contact_id, sequence_id)` as an idempotency backstop. GHL sync can be a subordinate step, not the definition of success.

### P0-4 — Intent rows cannot reproduce the original decision

The schema stores only deal, contact, entity, key, status, attempts, error, timestamps, and eligibility time. It does not persist:

- chosen `sequence_id`;
- sequence version or selection policy version;
- vertical/selection input snapshot;
- requested channels;
- enrollment purpose;
- eligibility snapshot/reason codes.

The producer chooses a sequence before writing the intent, but only writes the chosen sequence to an audit log. A recovery worker must either re-resolve from current mutable state or guess.

**Required correction:** add migration 0138 rather than editing 0137. Persist the immutable command: target sequence ID, purpose, channel set, selection policy/version, and a compact eligibility/input snapshot. Decide explicitly whether recovery preserves the original target or re-evaluates and records supersession.

### P0-5 — Exactly-once claim is not achieved

`status='processing'` plus a CAS prevents simultaneous claims only before a crash. It does not handle:

- worker death after claim;
- worker death after enrollment commit but before marking the intent complete;
- retry of a partially completed GHL metadata operation;
- indefinite retry loops.

**Required correction:** implement at-least-once processing with idempotent effect semantics. Add claim token, claimed timestamp/lease expiry, next attempt, maximum attempts, terminal error class, and worker identity. Claim with `FOR UPDATE SKIP LOCKED` or one atomic `UPDATE ... RETURNING`. Replay after lease expiry must converge through the enrollment uniqueness constraint and durable result lookup.

### P1-1 — Queue scheduling instructions do not match QueueManager

The POST_ENRICHMENT queue is event-driven (`repeatEveryMs: 0`). Queue startup removes every existing repeatable job for a queue before adding the one schedule represented by that queue's config. Adding a second `QUEUE_CONFIGS` entry with the same queue name risks duplicate queue/worker setup and repeatable-job deletion.

**Required correction:** change QueueManager's schedule model to support multiple named schedules per physical queue, or add an explicit idempotent named schedule installer that removes/replaces only its own scheduler key. Dispatch on `_job.name`; do not send a recovery payload into `processPostEnrichmentJob()`.

### P1-2 — Approval nudge needs scope and post-commit rules

The nudge is useful but must occur only when approval actually clears `post-enrichment-enrollment`'s `release_pending` hold. It must be enqueued after commit through `getQueueManagerProducers()` and must not lazily initialize workers. Enqueue failure should be audited as degraded while periodic recovery remains the guarantee.

The job ID should include the committed ledger epoch. `approveRelease()` currently uses one epoch for all released rows; return that epoch and the released keys so callers/tests can prove the nudge's scope.

### P1-3 — Backlog query names invalid columns and cannot group exactly as proposed

Correct model:

- due enrollment timestamp: `sequence_enrollments.next_action_at`;
- current channel/action: derived from `sequence_steps.action_type` for the enrollment's current step;
- an enrollment has no `channel` column;
- contact has `sms_status`, not `smsOptedOut` in the main contact schema;
- DNC/contactability is composite and cannot be truthfully reduced to three fields.

BullMQ count APIs provide physical queue totals. Exact per-job-name grouping requires bounded job scanning/pagination. Shared queues and wildcard manifest entries can map one physical job to multiple logical phases, so logical totals must not be fabricated or duplicated.

### P1-4 — Preview must not present overlapping stores as one additive total

`sequence_enrollments`, `outbound_messages`, GHL deferrals, and post-enrichment intents are different stages and can represent the same future communication. Summing them as "total units" double-counts work. `outbound_messages.status='sending'` is in-flight, not ordinary backlog, and should be aged separately for stall detection.

Return per-source counts with units and overlap warnings. The UI must label the result as a risk preview, not a send forecast.

### P1-5 — Timeout and partial-result contract is underspecified

`SET LOCAL statement_timeout` only has transaction-local effect inside a transaction. Existing coordinator reads issue it outside `BEGIN`, so copying that pattern does not establish the promised bound.

Each source query must have an independent result envelope and error handler. A single `Promise.all` rejection cannot discard successful source results. A missing table is `unknown/schema_missing`, not zero; an existing empty table is zero.

### P1-6 — Existing hold route and UI prerequisites are missing

There is no queue-holds client page. Choose and name a real destination, preferably a dedicated admin page linked from `OperatorDashboard`, rather than burying the card in a queue-metrics panel available to managers.

Before adding UI, serialize nested coordinator epochs to strings. Otherwise `/api/admin/queue-holds` can fail with active holds because JSON cannot serialize `bigint`.

### P1-7 — Baseline compliance gate needs repair first

The task requires `scripts/check-queue-compliance.ts` to pass, but at the audited SHA:

- manifest validation tests `result.valid`; the function returns `result.ok`;
- the scanner rejects any production `status: "paused"` assignment on a line that does not literally contain an exception marker, so it flags many contactability, validation, error, and cap pauses unrelated to global-hold handling.

Fix the gate semantically before using it as acceptance evidence.

## 5. Required build split and shared files

| Order | Corrected task | Purpose | Shared files |
|---:|---|---|---|
| 1 | **1548A — Baseline hold-route and compliance-gate repair** | Make current hold API JSON-safe; fix manifest/check contract and semantic pause scan | `outbound-queue-coordinator.ts`, `admin.ts`, `logical-job-manifest.ts`, `check-queue-compliance.ts` |
| 2 | **1548B — Isolated pause state-machine test** | Test hold semantics without changing any shared/live state | new pause-cycle test/harness, `outbound-control-service.ts`, `outbound-queue-coordinator.ts`, extracted hold-deferral helper, test DB/Redis configuration, `pre-deploy.ts` |
| 3 | **1548C — Transactional post-enrichment command and recovery** | Eliminate lost intents and deliver idempotent local enrollment recovery | new migration 0138, `shared/schema.ts`, `post-enrichment-worker.ts`, canonical promotional enrollment service, `queue-manager.ts`, `logical-job-manifest.ts`, `outbound-queue-coordinator.ts` |
| 4 | **1548D — Bounded domain backlog preview and admin page** | Show non-additive, source-specific risk counts with partial/unknown semantics | new backlog-preview service, `admin.ts`, `queue-manager.ts`, `logical-job-manifest.ts`, dedicated admin UI/page and navigation |

Do not combine all four in one PR. The pause harness and recovery schema each need independent rollback and safety review.

## 6. Corrected implementation contract

### 1548A — Baseline repair

1. Add a JSON DTO conversion for coordinator status; convert every nested epoch to a decimal string.
2. Make `getStatus()` return an explicit source health field such as `status: "ok" | "degraded"`; do not turn DB failure into an indistinguishable empty hold set.
3. Fix `check-queue-compliance.ts` to read `result.ok`.
4. Replace the line-token paused-status scanner with a targeted check of the global/coordinator hold branch or an AST-based rule.
5. Correct the existing manifest entry's backlog source by adding `post_enrichment_enrollment_intents` to `BacklogSource`.
6. Validate release-approval input with Zod, reject unknown logical keys, and return released keys plus ledger epoch.

### 1548B — Isolated pause-cycle test

1. Extract a pure or dependency-injected hold-deferral function from `sequence-worker.ts`.
2. Unit-test marker idempotency and metadata cleanup without running the full sequence worker.
3. Test pause, unpause, reason-scoped isolation, release-pending, and approval using an isolated database fixture and fake coordinator queue actuator.
4. Use unique test source keys and correlation IDs.
5. Install provider fakes that throw if email, SMS, GHL workflow, SMTP, Gmail, RVM, voice, or contact upsert is invoked.
6. The test runner must refuse to run unless all isolation checks pass: `NODE_ENV=test`, dedicated database fingerprint, unique Redis prefix, and explicit integration-test opt-in.
7. Do not restore an old unpaused value automatically. Destroy the isolated database/namespace after the test. If cleanup cannot prove isolation, leave the authority paused and fail.
8. Mandatory pre-deploy should run the pure/isolated suite only. Never run this state mutation against the ordinary development environment.

### 1548C — Transactional recovery

1. Add migration 0138 with at least:
   - `sequence_id NOT NULL`;
   - `purpose` and `channels`/payload JSON;
   - `selection_policy_version` and selection snapshot;
   - `claim_token`, `claimed_at`, `lease_expires_at`, `claimed_by`;
   - `max_attempts` or policy-owned cap;
   - `last_error_code`, `last_error_class`, `completed_enrollment_id`;
   - an index supporting pending/expired-lease claims.
2. Make the producer transactional with its phase marker. Do not suppress relation/insert failures.
3. Replace nondeterministic "any active sequence" fallback with deterministic ordering and record the selected target.
4. Define a canonical `executePostEnrichmentEnrollmentIntent()` that:
   - rechecks pause authority and coordinator immediately before the effect;
   - re-evaluates current DNC, consent, validation, eligibility, sequence state, and deal policy;
   - creates or resolves the local `sequence_enrollments` row idempotently;
   - treats an existing active/paused enrollment as successful convergence;
   - performs optional GHL synchronization as a subordinate, separately auditable operation;
   - records an eligibility snapshot and terminal reason codes.
5. Claim batches atomically and recover expired processing leases.
6. Use bounded exponential backoff with jitter and a terminal attempt cap.
7. Add exact named dispatch for `post-enrichment-intent-recovery`; keep the event job `post-enrichment-automation` distinct.
8. Support multiple named schedules safely without deleting unrelated repeatable jobs.
9. Recheck both `authorize()` and `canExecute("post-enrichment-enrollment")` before each row's enrollment effect, not only once per batch.
10. On a mid-batch hold, stop and release/reset untouched claims safely.
11. After a scoped release commit, enqueue an immediate named nudge only if that logical key was actually released; periodic schedule remains authoritative.

### 1548D — Backlog preview

Create a dedicated read service so SQL, timeout behavior, and response shape are testable without Express.

Recommended response:

```ts
type SourceResult<T> =
  | { status: "ok"; data: T; capturedAt: string }
  | { status: "timeout" | "unavailable" | "schema_missing"; data: null; errorCode: string; capturedAt: string };

interface BacklogPreview {
  partial: boolean;
  nonAdditive: true;
  bullmq: SourceResult<{
    queues: Record<string, { waiting: number; delayed: number; active: number; failed: number }>;
    namedJobs?: Array<{ queue: string; jobName: string; state: string; count: number }>;
    scanTruncated: boolean;
  }>;
  sequenceEnrollments: SourceResult<{
    due: number;
    byActionType: Record<string, number>;
    bySequence: Array<{ sequenceId: number; count: number; oldestDueAt: string | null }>;
    byAge: { under1h: number; h1to24: number; over24h: number };
    eligibilityIndicators: { missingEndpoint: number; knownSuppressed: number; requiresEmailValidation: number };
  }>;
  outboundMessages: SourceResult<{ queued: number; sending: number; staleSending: number }>;
  deferredGhlEnrollments: SourceResult<{ pending: number; dueNow: number; terminalFailed: number }>;
  postEnrichmentIntents: SourceResult<{ pending: number; eligibleNow: number; processing: number; expiredLease: number; failed: number }>;
  generatedAt: string;
}
```

Query rules:

- Due enrollment: `status='active' AND next_action_at IS NOT NULL AND next_action_at <= NOW()`.
- Derive current action via the sorted current sequence step; verify the zero-based `current_step` to one-based `step_order` mapping with fixtures.
- Separate `queued`, `sending`, and stale `sending` messages with an explicit age threshold.
- Query deferred GHL with raw SQL, but report missing relation as unknown/schema missing.
- Run each source with an independently bounded transaction/query timeout and independent catch.
- Use `requireQueueManagerReady()`; a route must never initialize workers.
- Physical queue totals are exact. Named-job totals must be bounded, paginated, and marked truncated when incomplete.
- Do not map wildcard/shared-queue counts into duplicated logical totals.
- Do not calculate an additive grand total.
- Build a new admin-only page or explicitly add an admin-only section to a named existing page. Poll only while visible and stop polling on unmount/background.

## 7. Acceptance tests

### Baseline/API

- Active hold response serializes all epochs as strings and returns 200.
- DB failure returns degraded/unknown, never a false empty-success state.
- Manifest validation uses `ok` and detects an intentionally missing queue entry.
- Compliance scanner allows contactability/cap pauses but rejects reintroduction of global-hold status mutation.
- Release approval rejects unknown keys and returns exact released keys/epoch.

### Pause-cycle safety

- Test refuses an ordinary development or production database.
- Test refuses a non-namespaced Redis connection.
- Every provider fake records zero calls; unexpected call throws.
- Pause creates global holds.
- Repeated hold deferral leaves status active and preserves original `_holdDeferredAt`.
- Manual hold survives pause/unpause/release approval.
- Legacy fixture restoration affects only the isolated fixture database.
- Crash/failure leaves no external or shared test state.

### Intent producer/recovery

- Fault between deal update and intent insert rolls back both.
- Missing intent relation fails the job instead of marking completion.
- Intent stores the exact selected sequence and policy version.
- Two concurrent workers claim a row once.
- Worker crash before effect is recovered after lease expiry.
- Worker crash after enrollment commit replays to the same enrollment and completes the intent without a duplicate.
- Pause activation after batch load but before effect blocks the row.
- Manual/channel/global/release-pending holds remain authoritative.
- DNC, opt-out, invalid email, missing endpoint, inactive sequence, ineligible deal, and already-enrolled outcomes are separately classified.
- Retryable failures back off and stop at max attempts; permanent failures do not retry.
- Recovery job dispatch is by exact name and never calls `processPostEnrichmentJob()` with the wrong payload.
- Repeated startup installs one periodic recovery scheduler and preserves unrelated repeatable jobs.
- Approval nudge occurs only for a committed release of the post-enrichment key.

### Backlog preview

- Uses `next_action_at`, not `next_send_at`.
- Derives action type from sequence steps and tests the step-index mapping.
- Returns independent source envelopes and `partial: true` when any source times out.
- Existing empty table returns zero; missing table returns `schema_missing`.
- Redis unavailable does not trigger QueueManager initialization.
- Named-job scan reports truncation.
- Counts are not summed across overlapping stores.
- Admin returns 200; unauthenticated 401; manager 403.
- UI error state does not crash the containing admin page and does not leak PII.

## 8. Kill lines

- **STOP** if any mandatory test mutates global pause/holds on a shared development, staging, or production database.
- **STOP** if cleanup can restore the system to unpaused based only on a stale pre-test read.
- **STOP** if the test can approve or clear a hold it did not create in an isolated fixture.
- **STOP** if any provider/contact-upsert call is possible during tests.
- **STOP** if `post_enrichment_automation_at` can commit without a durable enrollment command or explicit terminal no-enrollment outcome.
- **STOP** if intent-insert errors are swallowed.
- **STOP** if recovery re-resolves a target without recording that the original target was superseded.
- **STOP** if recovery uses `enrollContactInGhlWorkflow()` as proof that a local sequence enrollment was created.
- **STOP** if exactly-once is claimed without a durable idempotent effect and crash recovery after `processing`.
- **STOP** if the worker checks authority/coordinator only once per batch.
- **STOP** if a `processing` row can remain stranded indefinitely.
- **STOP** if the new repeatable schedule removes another job's scheduler.
- **STOP** if a route calls `getQueueManager()` and can lazily start workers.
- **STOP** if preview SQL references `next_send_at` or enrollment `channel`.
- **STOP** if a missing table is reported as zero.
- **STOP** if overlapping domain stores are summed into one release count.
- **STOP** if nested `bigint` values reach Express JSON serialization.
- **STOP** if #1548 is used to declare post-enrichment commercial enrollment safe without resolving the prior audit's canonical ownership and eligibility requirements.

## 9. Gate checks

Run in an isolated CI environment after implementation:

```bash
npm run check
npm run build
npx tsx scripts/check-queue-compliance.ts
npx tsx scripts/test-pause-cycle-unit.ts
npx tsx scripts/test-post-enrichment-intent-recovery.ts
npx tsx scripts/test-backlog-preview.ts
npx tsx scripts/pre-deploy.ts
```

Additional static gates:

```bash
rg -n "next_send_at" server client scripts
rg -n "getQueueManager\(\)" server/routes server/services/system-audit
rg -n "post_enrichment_enrollment_intents" server shared migrations scripts
rg -n "enrollContactInGhlWorkflow" server/services/post-enrichment-worker.ts
rg -n "outboundGlobalPaused" server/services server/routes
```

Expected outcomes:

- no new `next_send_at` reference;
- no lazy QueueManager initialization from the preview route;
- producer and consumer both reference the intent table;
- post-enrichment success is tied to a durable local enrollment result, not GHL sync;
- no new raw pause-setting execution gate.

## 10. Runtime verification packet — not statically verified

The following must remain open until checked in the target environment with read-only queries and fake/no-send controls:

1. Migration 0137 is actually applied on every deployment database.
2. Current counts and oldest ages for pending/processing/failed intent rows.
3. Whether any stamped post-enrichment deal has no intent and no local enrollment—the lost-intent orphan cohort.
4. Whether active intent rows reference contacts/deals that still exist and are eligible.
5. BullMQ POST_ENRICHMENT queue presence, last success/failure, scheduler registration, and worker heartbeat.
6. Redis multi-replica behavior and named repeatable-job deduplication.
7. Query plans and latency for due enrollments, current-step join, outbound messages, GHL deferrals, and intent counts at production cardinality.
8. Whether the sequence due-work index is present and used.
9. Whether `/api/admin/queue-holds` currently fails with active holds because of nested BigInt serialization.
10. Current global/channel/manual/release-pending holds. Do not change them during verification.
11. The actual canonical business decision: should enrichment automatically create a promotional enrollment, or only create an NBA/manual-review recommendation?
12. Exact transport-call count under the isolated recovery test: required result is zero.

## 11. Final recommendation

Do not implement #1548 in its current combined form. First merge 1548A, then build the isolated 1548B test. Only after product/compliance confirms post-enrichment auto-enrollment ownership should 1548C be implemented through the canonical enrollment boundary. Build 1548D last, using corrected schema fields and non-additive/partial semantics.

This ordering prevents a test from releasing real work, prevents recovery from completing rows without creating enrollments, and prevents the UI from presenting incorrect backlog totals as operational truth.
