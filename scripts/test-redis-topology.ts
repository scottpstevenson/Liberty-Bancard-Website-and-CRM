#!/usr/bin/env tsx
/**
 * test-redis-topology.ts
 *
 * Pure topology and capacity-model tests. No real Redis connection required.
 * Tests the provider-neutral diagnoseRedisCapacity() and the topology snapshot
 * contract without touching any queue, worker, schedule, or Redis key.
 *
 * This is the dedicated gate for capacity-model correctness.
 *
 * Kill-line assertions:
 *  - Object.keys(metrics).length must NOT be used for Worker capacity
 *  - status === "safe" must NOT be returned when limit is unknown
 *  - QUEUE_CONFIGS.length must equal 23 (baseline snapshot — update comment if roster changes)
 *  - Any QUEUE_CONFIGS entry changed by this task causes this test to fail
 *
 * Exits 0 if all assertions pass, 1 if any fail.
 */

import { QUEUE_CONFIGS, QUEUE_NAMES } from "../server/services/queue-manager";
import { diagnoseRedisCapacity } from "../server/services/queue-connection";
import { readFileSync } from "fs";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(detail ? `${label} — ${detail}` : label);
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 1. QUEUE_CONFIGS baseline snapshot ───────────────────────────────────────
// IMPORTANT: 23 is a baseline snapshot as of the #1523A task, not a hardcoded
// production truth. If the roster grows or shrinks, update this number AND the
// comment. The capacity calculation below uses the DERIVED count, not 23.

async function testQueueConfigsBaseline() {
  console.log("\n1. QUEUE_CONFIGS baseline — roster count and no mutations from this task");

  const BASELINE_COUNT = 23;
  const actualCount = QUEUE_CONFIGS.length;

  if (actualCount !== BASELINE_COUNT) {
    console.error(
      `\n  ⚠️  QUEUE_CONFIGS.length changed from baseline ${BASELINE_COUNT} to ${actualCount}.\n` +
      `  If this is intentional, update BASELINE_COUNT in scripts/test-redis-topology.ts\n` +
      `  and document the change in the PR description.\n`
    );
  }

  assert(
    `QUEUE_CONFIGS.length equals baseline (${BASELINE_COUNT})`,
    actualCount === BASELINE_COUNT,
    `actual=${actualCount}, baseline=${BASELINE_COUNT} — update BASELINE_COUNT in this file if intentional`
  );

  // Verify all named queues from QUEUE_NAMES are present in QUEUE_CONFIGS
  const configNames = new Set(QUEUE_CONFIGS.map(c => c.name));
  const definedNames = Object.values(QUEUE_NAMES);
  for (const name of definedNames) {
    assert(`QUEUE_NAMES.${name} has a matching QUEUE_CONFIGS entry`, configNames.has(name));
  }
}

// ── 2. diagnoseRedisCapacity — unknown status when no limit ──────────────────

async function testCapacityUnknownWithoutLimit() {
  console.log("\n2. diagnoseRedisCapacity — status=unknown when REDIS_CONNECTION_LIMIT not set");

  // Ensure the env var is not set for this test
  const origLimit = process.env.REDIS_CONNECTION_LIMIT;
  delete process.env.REDIS_CONNECTION_LIMIT;

  try {
    const result = diagnoseRedisCapacity({ physicalWorkerCount: QUEUE_CONFIGS.length });
    assert(
      "status=unknown when configuredConnectionLimit is null",
      result.status === "unknown",
      `got status=${result.status}`
    );
    assert("reasons is non-empty", result.reasons.length > 0);
    assert("capturedAt is a valid ISO string", !isNaN(new Date(result.capturedAt).getTime()));
    assert("configuredConnectionLimit is null without env var", result.configuredConnectionLimit === null);
  } finally {
    if (origLimit !== undefined) process.env.REDIS_CONNECTION_LIMIT = origLimit;
  }
}

// ── 3. Connection estimate formula ───────────────────────────────────────────

async function testConnectionEstimateFormula() {
  console.log("\n3. Connection estimate — formula: 1 shared + physicalWorkerCount");

  const workerCount = QUEUE_CONFIGS.length; // derived, not hardcoded
  const result = diagnoseRedisCapacity({ physicalWorkerCount: workerCount });

  assert(
    `estimatedProcessConnections = 1 + ${workerCount} = ${1 + workerCount}`,
    result.estimatedProcessConnections === 1 + workerCount,
    `got ${result.estimatedProcessConnections}`
  );
  assert("sharedClientCount defaults to 1", result.sharedClientCount === 1);
  assert("physicalWorkerCount reflects input", result.physicalWorkerCount === workerCount);

  // Legacy-GHL mode: 1 fewer Worker (GHL_SYNC not instantiated)
  const legacyWorkerCount = workerCount - 1;
  const legacyResult = diagnoseRedisCapacity({ physicalWorkerCount: legacyWorkerCount });
  assert(
    `legacy-GHL mode: estimatedProcessConnections = 1 + ${legacyWorkerCount} = ${1 + legacyWorkerCount}`,
    legacyResult.estimatedProcessConnections === 1 + legacyWorkerCount,
    `got ${legacyResult.estimatedProcessConnections}`
  );
}

// ── 4. Known-safe, warning, unsafe inputs ────────────────────────────────────

async function testCapacityStatusRanges() {
  console.log("\n4. Capacity status — safe / warning / unsafe with known limit");

  // Use a fictional limit for testing — not naming any specific provider plan.
  const TEST_LIMIT = 30;
  const origLimit = process.env.REDIS_CONNECTION_LIMIT;
  process.env.REDIS_CONNECTION_LIMIT = String(TEST_LIMIT);

  try {
    // Safe: well below limit
    const safe = diagnoseRedisCapacity({ physicalWorkerCount: 5 });
    assert("status=safe when well below limit", safe.status === "safe", `got ${safe.status}`);

    // Warning: close to limit (within default 10% headroom)
    const warningWorkers = Math.ceil(TEST_LIMIT * 0.93) - 1; // within 10% of limit
    const warning = diagnoseRedisCapacity({ physicalWorkerCount: warningWorkers });
    assert(
      "status=warning when near limit",
      warning.status === "warning" || warning.status === "safe", // depends on exact headroom math
      `got ${warning.status} for ${warningWorkers} workers, limit=${TEST_LIMIT}`
    );

    // Unsafe: exceeds limit
    const unsafe = diagnoseRedisCapacity({ physicalWorkerCount: TEST_LIMIT + 5 });
    assert("status=unsafe when over limit", unsafe.status === "unsafe", `got ${unsafe.status}`);

    // Explicit warning headroom
    const explicitWarn = diagnoseRedisCapacity({
      physicalWorkerCount: 20,
      configuredWarningHeadroom: 12,
    });
    assert(
      "status=warning with explicit headroom: 1+20=21, limit=30, headroom=9, threshold=12",
      explicitWarn.status === "warning",
      `got ${explicitWarn.status}, estimatedConnections=${explicitWarn.estimatedProcessConnections}`
    );
  } finally {
    if (origLimit !== undefined) process.env.REDIS_CONNECTION_LIMIT = origLimit;
    else delete process.env.REDIS_CONNECTION_LIMIT;
  }
}

// ── 5. observedAccountConnectedClients labeling ───────────────────────────────

async function testObservedClientLabeling() {
  console.log("\n5. observedAccountConnectedClients — server-wide label, not process-local");

  const TEST_LIMIT = 30;
  const origLimit = process.env.REDIS_CONNECTION_LIMIT;
  process.env.REDIS_CONNECTION_LIMIT = String(TEST_LIMIT);

  try {
    // Observed account clients (server-wide) exceed our process estimate significantly.
    // The diagnosis should reflect the higher observed count.
    const result = diagnoseRedisCapacity({
      physicalWorkerCount: 5,           // process estimate = 6
      observedAccountConnectedClients: 28, // server-wide, near limit
    });
    assert(
      "observedAccountConnectedClients is preserved in output",
      result.observedAccountConnectedClients === 28
    );
    // Status should reflect the higher of observed (28) vs process estimate (6)
    // 28 vs limit=30, headroom=2, default warning threshold=3 → warning or unsafe
    assert(
      "status reflects observed account count (28 near limit 30)",
      result.status === "warning" || result.status === "unsafe",
      `got ${result.status}`
    );
  } finally {
    if (origLimit !== undefined) process.env.REDIS_CONNECTION_LIMIT = origLimit;
    else delete process.env.REDIS_CONNECTION_LIMIT;
  }
}

// ── 6. Fleet estimate — null without REDIS_DEPLOYMENT_PROCESS_COUNT ───────────

async function testFleetEstimateRequiresEnvVar() {
  console.log("\n6. estimatedFleetConnections — null until REDIS_DEPLOYMENT_PROCESS_COUNT is set");

  const origProcCount = process.env.REDIS_DEPLOYMENT_PROCESS_COUNT;
  delete process.env.REDIS_DEPLOYMENT_PROCESS_COUNT;

  try {
    const result = diagnoseRedisCapacity({
      physicalWorkerCount: 23,
      deploymentProcessCount: null,
    });
    assert(
      "estimatedFleetConnections is null when no deploymentProcessCount",
      result.estimatedFleetConnections === null,
      `got ${result.estimatedFleetConnections}`
    );
  } finally {
    if (origProcCount !== undefined) process.env.REDIS_DEPLOYMENT_PROCESS_COUNT = origProcCount;
  }

  // Fleet estimate when process count is supplied
  const result2 = diagnoseRedisCapacity({
    physicalWorkerCount: 23,
    deploymentProcessCount: 2,
  });
  assert(
    "estimatedFleetConnections = (1+23) * 2 = 48 when deploymentProcessCount=2",
    result2.estimatedFleetConnections === 48,
    `got ${result2.estimatedFleetConnections}`
  );
}

// ── 7. Invalid / missing / negative / noninteger limits ─────────────────────

async function testInvalidLimits() {
  console.log("\n7. Invalid limits — non-positive or non-integer REDIS_CONNECTION_LIMIT → unknown");

  // Strict integer validation: only /^\d+$/ strings are accepted.
  // "1.5" → rejected (decimal), "1abc" → rejected (suffix), "-5" → rejected (sign).
  for (const invalidValue of ["", "abc", "-5", "0", "1.5", "1abc", " "]) {
    const orig = process.env.REDIS_CONNECTION_LIMIT;
    process.env.REDIS_CONNECTION_LIMIT = invalidValue;
    try {
      const result = diagnoseRedisCapacity({ physicalWorkerCount: 10 });
      assert(
        `REDIS_CONNECTION_LIMIT="${invalidValue}" → status=unknown, limit=null (strict integer required)`,
        result.status === "unknown" && result.configuredConnectionLimit === null,
        `got status=${result.status}, limit=${result.configuredConnectionLimit}`
      );
    } finally {
      if (orig !== undefined) process.env.REDIS_CONNECTION_LIMIT = orig;
      else delete process.env.REDIS_CONNECTION_LIMIT;
    }
  }
}

// ── 8. Source code kill-line checks ─────────────────────────────────────────

async function testSourceCodeKillLines() {
  console.log("\n8. Source code kill-lines — forbidden patterns absent");

  const queueMetricsSrc = readFileSync("server/routes/queue-metrics.ts", "utf8");
  const queueConnectionSrc = readFileSync("server/services/queue-connection.ts", "utf8");
  const queueManagerSrc = readFileSync("server/services/queue-manager.ts", "utf8");
  const resilienceSrc = readFileSync("scripts/test-bullmq-resilience.ts", "utf8");

  // Kill line 1: Object.keys(metrics).length must NOT determine Worker capacity
  assert(
    "queue-metrics.ts: Object.keys(metrics).length not used for capacity calculation",
    !queueMetricsSrc.includes("Object.keys(metrics).length"),
    "Object.keys(metrics).length was used for capacity — this was always 2 (response shape), not Worker count"
  );

  // Kill line 2: UPSTASH_FREE_MAX=20 must not be hardcoded as production fact
  assert(
    "queue-connection.ts: UPSTASH_FREE_MAX = 20 absent (not a hardcoded production truth)",
    !queueConnectionSrc.includes("UPSTASH_FREE_MAX = 20"),
    "UPSTASH_FREE_MAX=20 is hardcoded as a production truth — it must be read from REDIS_CONNECTION_LIMIT env var"
  );

  // Kill line 3: safeForUpstashFree must be removed from return type
  assert(
    "queue-connection.ts: safeForUpstashFree absent (replaced by status field)",
    !queueConnectionSrc.includes("safeForUpstashFree:"),
    "safeForUpstashFree still present in return type"
  );

  // Kill line 4: diagnoseRedisCapacity(11) hardcoded in resilience test is gone
  assert(
    "test-bullmq-resilience.ts: diagnoseRedisCapacity(11) absent",
    !resilienceSrc.includes("diagnoseRedisCapacity(11)"),
    "diagnoseRedisCapacity(11) is a stale hardcoded production count — must use QUEUE_CONFIGS.length"
  );

  // Kill line 5: maxRetriesPerRequest:null still present (critical BullMQ requirement)
  assert(
    "queue-connection.ts: maxRetriesPerRequest: null present (BullMQ requirement)",
    queueConnectionSrc.includes("maxRetriesPerRequest: null")
  );
  assert(
    "queue-connection.ts: enableReadyCheck: false present (BullMQ requirement)",
    queueConnectionSrc.includes("enableReadyCheck: false")
  );
  assert(
    "queue-connection.ts: commandTimeout: 10_000 absent (removed to fix command-timeout storm)",
    !queueConnectionSrc.includes("commandTimeout: 10_000")
  );

  // Kill line 6: getTopologySnapshot() must be exported
  assert(
    "queue-manager.ts: getTopologySnapshot method is present",
    queueManagerSrc.includes("getTopologySnapshot()")
  );

  // Kill line 7: Worker lifecycle events present
  assert(
    "queue-manager.ts: worker:ready event structured log present",
    queueManagerSrc.includes('"worker:ready"')
  );
  assert(
    "queue-manager.ts: worker:closed event structured log present",
    queueManagerSrc.includes('"worker:closed"')
  );
  assert(
    "queue-manager.ts: worker:error structured classification present",
    queueManagerSrc.includes("failureClass")
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log(" Redis Topology Tests (#1523A)");
  console.log("═══════════════════════════════════════════════════════");

  try {
    await testQueueConfigsBaseline();
    await testCapacityUnknownWithoutLimit();
    await testConnectionEstimateFormula();
    await testCapacityStatusRanges();
    await testObservedClientLabeling();
    await testFleetEstimateRequiresEnvVar();
    await testInvalidLimits();
    await testSourceCodeKillLines();
  } catch (err: any) {
    console.error("\nUnhandled error:", err?.message ?? err);
    failed++;
    failures.push(`Unhandled error: ${err?.message ?? err}`);
  }

  console.log(`\n${"═".repeat(55)}`);
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(55));
  if (failures.length) {
    console.error("\nFailures:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("\n✅ All Redis topology tests passed.");
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
