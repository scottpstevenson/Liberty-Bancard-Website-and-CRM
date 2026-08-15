# #1523A — Redis Capacity Truth and Safe Stabilization

**Priority:** P0  
**Type:** diagnostics, observability, test correction, and operational decision gate  
**Repository baseline:** `4819cefac1478ae700c9996427174e822d97c5a5`  
**Topology mutation:** prohibited in this ticket  
**Depends on:** none  
**Runtime closure:** RV-07 and RV-08 required

## Objective

Correct the false Redis-capacity signal, derive diagnostics from the actual instantiated topology, capture enough evidence to determine the real failure mode, and choose the least-risk stabilization action without renaming, consolidating, or rescheduling a queue.

## Why this is a separate ticket

The current code has two confirmed diagnostic defects. It does not statically prove the active provider plan, connection cap, account-wide connection consumption, deployment process count, or timeout cause. Combining those corrections with a nine-queue migration would destroy the before/after evidence and introduce a second failure domain while the first remains unproven.

## Finding disposition

| ID | Finding | Verdict | Required action |
| --- | --- | --- | --- |
| A-01 | `QUEUE_CONFIGS` contains 23 physical Worker definitions | CONFIRMED | Derive topology from instantiated Workers, not a stale literal. |
| A-02 | Legacy GHL mode removes one Worker | CONFIRMED static | Report 22 only when `isLegacyGhlSyncClaimed()` is true in that process. |
| A-03 | One shared client plus one blocking duplicate per Worker is the planning formula | CONFIRMED as a process estimate | Label it estimated; do not present it as account-wide `connected_clients`. |
| A-04 | The active provider cap is 20 | NOT VERIFIED | Replace the literal operational verdict with configured/observed limit or `unknown`. |
| A-05 | The Worker timeouts were caused by connection-cap rejection | NOT VERIFIED | Capture provider error class/text, client count, process count, and timestamps. |
| A-06 | `/api/operator/queue-metrics` calculates the topology correctly | FALSE | It counts keys of `{queues, usingMock}`, producing two queues and three estimated connections. |
| A-07 | `scripts/test-bullmq-resilience.ts` validates current topology | FALSE | It hardcodes 11. |
| A-08 | Current Worker lifecycle telemetry is complete | FALSE | `error` is present; `ready` and `closed` are absent. |
| A-09 | `INFO clients` availability proves capacity safety | FALSE | It is an observation only; limit and other clients/processes remain separate. |
| A-10 | Pooling is required to close the incident | NOT PROVEN | Decide only after evidence and capacity options are reviewed. |

## Current topology truth table

| Mode | Physical Workers | Estimated process connections | Status without configured limit |
| --- | ---: | ---: | --- |
| Default | 23 | 24 | `unknown` |
| Legacy GHL claimed | 22 | 23 | `unknown` |

Formula: `estimatedProcessConnections = sharedClientCount + physicalWorkerCount`, currently using one shared client per application process. This excludes HTTP/admin Redis clients, probes, other deployments, provider-side reservations, and rolling-deploy overlap.

## Primary files

- `server/services/queue-manager.ts`
- `server/services/queue-connection.ts`
- `server/routes/queue-metrics.ts`
- `server/routes/admin.ts`
- `server/services/health-monitor.ts`
- `server/services/system-audit/probes/queues.ts`
- `scripts/test-bullmq-resilience.ts`
- new `scripts/test-redis-topology.ts`
- `package.json`
- `.github/workflows/wave12-ci.yml`

## Required data contracts

### Topology snapshot

Add a read-only method such as `QueueManager.getTopologySnapshot()` returning:

```ts
interface QueueTopologySnapshot {
  manifestConfigCount: number;
  activeConfigCount: number;
  instantiatedQueueCount: number;
  instantiatedWorkerCount: number;
  logicalJobCount: number;
  legacyGhlClaimed: boolean;
  usingMockRedis: boolean;
  processId: number;
  processIdentity: string | null;
  releaseSha: string | null;
  capturedAt: string;
}
```

Rules:

- `instantiatedWorkerCount` comes from the `workers` map after initialization, not from response-object fields.
- `instantiatedQueueCount` comes from the `queues` map.
- `activeConfigCount` comes from the runtime-effective config set.
- `logicalJobCount` equals physical count until #1523B introduces a separate manifest.
- Counts must remain available even when one queue-metrics probe fails.
- Never return credentials, Redis URLs, hostnames containing secrets, or job/contact payloads.

### Capacity diagnosis

Replace the Upstash-specific hardcoded verdict with a provider-neutral contract:

```ts
type CapacityStatus = "safe" | "warning" | "unsafe" | "unknown";

interface RedisCapacityDiagnosis {
  physicalWorkerCount: number;
  sharedClientCount: number;
  estimatedProcessConnections: number;
  observedAccountConnectedClients: number | null;
  configuredConnectionLimit: number | null;
  configuredWarningHeadroom: number | null;
  deploymentProcessCount: number | null;
  estimatedFleetConnections: number | null;
  status: CapacityStatus;
  reasons: string[];
  capturedAt: string;
}
```

Rules:

- Read `REDIS_CONNECTION_LIMIT` only if it is a finite positive integer. Otherwise set the limit to `null`.
- Do not infer provider or plan from the Redis URL.
- `unknown` is mandatory when the limit is missing, the topology is incomplete, or the observation is stale.
- `safe` requires a known limit and configured minimum headroom after the higher of the observed account count and the relevant fleet estimate.
- `warning` means the known limit is not exceeded but headroom is below policy.
- `unsafe` means the known limit is exceeded by the selected comparison count.
- `observedAccountConnectedClients` is labeled account/server observation, not attributed to this process.
- `estimatedFleetConnections` remains `null` until deployment process count is supplied by a trusted runtime signal.
- Recommendation text must identify assumptions and never include a provider plan name unless configured separately.

## Build steps

### Step 0 — Preflight and immutable evidence

Record:

- branch, HEAD, clean/dirty state, and deployment release identifier;
- migration journal head, although this task must not add a database migration;
- current `QUEUE_CONFIGS` count and the legacy-GHL exclusion rule;
- current queue-metrics response schema;
- current test output or the fact that dependencies/runtime are unavailable;
- current Redis-related environment variable names without values.

Stop on overlapping unowned changes to any primary file.

### Step 1 — Export actual topology

In `queue-manager.ts`:

1. Add a pure topology-building helper and the read-only snapshot method.
2. Count instantiated Workers from `this.workers.size` after setup.
3. Count instantiated Queues from `this.queues.size`.
4. Include runtime-effective active config count and legacy-GHL state.
5. Keep the existing 23 queue definitions unchanged.
6. Do not expose the mutable maps themselves.
7. Emit one structured startup record with release/process identity, manifest, active, Queue, Worker, estimated-process connection counts, and mock status.

### Step 2 — Correct the queue-metrics route

In `server/routes/queue-metrics.ts`:

1. Remove `Object.keys(metrics).length`.
2. Fetch the topology snapshot from `QueueManager`.
3. Continue returning `metrics.queues` and `usingMock` for compatibility.
4. Read `INFO clients` as currently attempted, but return `null` plus a diagnostic reason when unavailable or unparsable.
5. Call the revised capacity function with the topology snapshot, observed count, configured limit, and trusted process count if available.
6. Include `capturedAt`, release/process identity, observation age, and capacity reasons.
7. A failed queue probe must not become a zero count or a green status.

### Step 3 — Correct provider-limit semantics

In `queue-connection.ts`:

1. Remove `UPSTASH_FREE_MAX = 20` as the source of production truth.
2. Preserve the formula helper as a provider-neutral estimate.
3. Accept optional known limit/headroom/process inputs.
4. Return `unknown` when the limit or required topology is missing.
5. Update comments that claim 11 queues / 12 connections.
6. Do not change the shared IORedis singleton, retry behavior, `maxRetriesPerRequest`, ready check, TLS, or connection URL in this ticket.

### Step 4 — Add lifecycle and failure telemetry

For every instantiated Worker, record structured, PII-free events for:

- `ready`;
- `error` with error class/code and redacted message;
- `closed`;
- stalled job events;
- heartbeat write failure;
- consecutive failure threshold;
- queue-manager initialization failure and partial-shutdown result.

Every event includes physical queue, process identity, release SHA, timestamp, and legacy-GHL mode. Do not log job payloads, Redis credentials, lead fields, email addresses, phone numbers, or merchant-sensitive values.

Differentiate at minimum:

- provider connection rejection/limit response;
- DNS/TLS/network timeout;
- command timeout;
- authentication/configuration failure;
- Worker stall/lock renewal;
- database timeout;
- application handler error.

Unknown classifications remain unknown; string matching must not silently convert an error into a confirmed capacity incident.

### Step 5 — Replace the stale resilience test

In `scripts/test-bullmq-resilience.ts`:

1. Delete `diagnoseRedisCapacity(11)` and all 11-queue comments/assertions.
2. Import the production topology helper or manifest.
3. Assert 23 manifest configs at this audited baseline only as a temporary regression fixture; the diagnostic calculation itself must use the derived count.
4. Assert the default estimate is 24 and the legacy-GHL estimate is 23.
5. Assert status is `unknown` without a configured limit.
6. Test known-safe, warning, and unsafe inputs without naming a provider plan.
7. Test invalid/missing limits and process counts.
8. Fail if the test count diverges from the production manifest.

Prefer a dedicated `scripts/test-redis-topology.ts` for pure tests and make the existing resilience script call or import the same production contract rather than duplicating formulas.

Add a stable package command such as `test:redis-topology` that runs this suite. CI and operators must invoke the package command rather than copy its underlying command into multiple workflows.

### Step 6 — Add release-gate coverage

Add the topology test to the existing Wave 12 workflow and the protected release entrypoint from BT-06. The gate must run on the exact release SHA and fail on:

- response-object key counting;
- hardcoded stale production counts;
- known-limit safe/unsafe arithmetic errors;
- missing unknown state;
- topology manifest changes without updated budget evidence;
- accidental queue-name/schedule changes in #1523A.

### Step 7 — Deploy diagnostics only

Deploy without changing:

- `QUEUE_NAMES`;
- `QUEUE_CONFIGS` membership/order;
- Worker concurrency;
- attempts/backoff;
- repeat/cron schedules;
- startup-immediate behavior;
- queue keys or Redis data;
- automation seeds or kill switches;
- provider plan/configuration, unless handled by a separately approved operational change.

### Step 8 — Capture RV-07 and RV-08

Read-only evidence must contain:

| Evidence | Required fields |
| --- | --- |
| Provider/account | provider product, plan, documented active connection limit, evidence timestamp, owner |
| Deployment | number of application processes, rolling-deploy overlap, release SHA, process identities |
| Redis clients | `connected_clients` over time, peak, observation source, failures represented as unknown |
| Worker lifecycle | expected/ready/error/closed counts by process and queue |
| Errors | redacted exact error class/code/message, first/last timestamps, affected queues/processes |
| Queue state | waiting, active, delayed, failed, retryable, completed, repeat keys by physical queue |
| Scheduling | repeat entries, startup-immediate jobs, duplicate owners, oldest job ages |
| Headroom | steady and rolling-deploy demand plus configured operating reserve |

Do not change Redis keys, retry jobs, remove repeatables, pause queues, or call external providers while gathering this evidence.

### Step 9 — Make the stabilization decision

Use this decision table:

| Evidence result | Action |
| --- | --- |
| Known limit is below observed/required fleet peak | Prefer a separately approved provider-capacity increase sized for rolling deployment plus reserve. Observe before considering pooling. |
| Limit is adequate and errors are network/TLS/auth/configuration | Fix the evidenced configuration/network cause; do not pool. |
| Limit is unknown or evidence is stale/partial | Keep status unknown and continue evidence collection; do not pool. |
| Capacity cannot be increased and topology reduction is approved | Open #1523B after all entry gates pass. |
| Capacity is adequate but pooling has a separately approved reliability/cost objective | Open #1523B as planned architecture work, not incident hotfix. |

## VFC table

| ID | Claim | Verdict required after implementation |
| --- | --- | --- |
| VFC-A1 | Metrics use actual instantiated Worker count | Must be TRUE |
| VFC-A2 | Provider limit is known | TRUE only with dated account evidence; otherwise UNKNOWN |
| VFC-A3 | Capacity status can be green with unknown limit | Must be FALSE |
| VFC-A4 | Observed clients equal this process's clients | Must be FALSE/UNATTRIBUTED |
| VFC-A5 | Exact incident root cause is proven | TRUE only with correlated runtime evidence |
| VFC-A6 | Current queue topology changed | Must be FALSE |
| VFC-A7 | Resilience tests derive from production topology | Must be TRUE |
| VFC-A8 | Rolling-deploy headroom is included | Must be TRUE before declaring capacity safe |

## Entry gates

- Exact HEAD and clean worktree recorded.
- No overlapping queue-manager/connection/metrics work.
- No authorization to consolidate, rename, purge, retry, pause, or reschedule queues is implied.
- Logging/redaction standard approved.
- Required release test environment identified.

## Exit gates

- Queue-metrics topology equals the actual Worker map in default and legacy-GHL tests.
- Missing/invalid limit produces `unknown`, never green.
- Observed account count and process estimate are distinct fields.
- Worker ready/error/closed and initialization failure are attributable to process/release/physical queue.
- No production queue config, name, schedule, concurrency, attempts, or backoff changed.
- Exact-release CI passes.
- RV-07/RV-08 evidence and the stabilization decision are attached.
- At least 24 hours of post-deploy metrics show no new diagnostic regression; incident closure additionally requires the evidenced failure mode to stop.

## Kill lines

- Stop if any queue name, count, handler, concurrency, schedule, retry, backoff, or startup behavior changes.
- Stop if 20 remains a hardcoded production truth.
- Stop if `safe` can be returned with an unknown limit or stale/missing topology.
- Stop if `Object.keys(metrics).length` or another response-shape count determines Worker capacity.
- Stop if a test uses a literal production queue count instead of the manifest/topology helper.
- Stop if logs expose Redis URLs, credentials, job payloads, contact PII, or merchant-sensitive data.
- Stop if evidence collection mutates queues, Redis keys, provider configuration, pause flags, or jobs.
- Stop if a timeout is labeled connection-cap rejection without correlated provider/runtime evidence.
- Stop if the release artifact is not tied to its green SHA.

## Tests

### Unit

- Default 23 and legacy-GHL 22 active topology.
- One shared client formula: 24 and 23 process estimates.
- Known safe/warning/unsafe limits and exact boundary behavior.
- Unknown/zero/negative/noninteger limits.
- Known/unknown process count and fleet estimate.
- Observed count greater/less than estimate without conflating sources.
- Redaction and error classification; unknown errors stay unknown.

### Integration

- QueueManager snapshot matches instantiated Queue/Worker maps.
- Partial initialization and shutdown report accurate counts.
- Metrics route with Redis ready, unavailable, unparsable `INFO`, and mock mode.
- Worker ready/error/closed/stalled events include queue/process/release identity.
- Legacy GHL claim excludes exactly one Worker.

### Static/release

- No `Object.keys(metrics).length` capacity call.
- No `diagnoseRedisCapacity(11)`.
- No hardcoded free-tier production verdict.
- `QUEUE_CONFIGS`, schedules, attempts, backoff, concurrency, and names unchanged by this ticket.
- Exact-release workflow executes the topology tests.

### Runtime

- RV-07/RV-08 packet.
- One normal deploy and one rolling-deploy observation.
- 24-hour error/connection/Worker lifecycle observation.

## Rollback

This ticket is diagnostic-only. Roll back the application artifact if metrics or startup behavior regresses. Because no queue name, repeat schedule, or Redis key is changed, rollback must not require a queue-data migration. Preserve the evidence collected before rollback.

## Out of scope

- Provider-plan mutation or billing approval.
- Queue consolidation/pooling.
- Repeatable-job API migration.
- Schedule ownership redesign.
- Redis key deletion or job replay.
- Conditional Worker instantiation.
- Discovery/re-enrichment ownership.
- Any outbound pause or campaign change.

## Done looks like

Operators can see the actual physical topology, account observation, configured limit, deployment multiplier, headroom, and exact failure class without a false green. The incident has an evidence-backed disposition, and no queue behavior changed to obtain it.
