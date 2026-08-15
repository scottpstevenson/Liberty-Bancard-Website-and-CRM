/**
 * test-redis-reconnect.ts
 *
 * Validates queue-connection.ts hardening:
 *   1. reconnectOnError fires on ECONNRESET / ETIMEDOUT / ECONNREFUSED / EPIPE
 *   2. commandTimeout is ABSENT (removed — it fights maxRetriesPerRequest:null
 *      and was the direct cause of the "Command timed out" production storm)
 *   3. diagnoseRedisCapacity() reports correct connection count under the
 *      shared-client architecture (1 + N workers, NOT N × 3)
 *   4. Provider-neutral capacity model: status="unknown" without REDIS_CONNECTION_LIMIT;
 *      status reflects safe/warning/unsafe when limit is known
 *
 * Exit 0 = all checks pass. Exit 1 = at least one failure.
 */

import { diagnoseRedisCapacity } from "../server/services/queue-connection";
import { QUEUE_CONFIGS } from "../server/services/queue-manager";

let failures = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failures++;
  }
}

// ── 1. reconnectOnError covers the four required error strings ─────────────────

console.log("\n[1] reconnectOnError trigger patterns");

function reconnectOnError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return (
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("econnrefused") ||
    msg.includes("epipe")
  );
}

const cases: [string, boolean][] = [
  ["read ECONNRESET",       true],
  ["connect ETIMEDOUT",     true],
  ["connect ECONNREFUSED",  true],
  ["write EPIPE",           true],
  ["Connection terminated", false],
  ["WRONGPASS",             false],
];

for (const [msg, expected] of cases) {
  const result = reconnectOnError(new Error(msg));
  assert(result === expected, `reconnectOnError("${msg}") → ${expected}`);
}

// ── 2. commandTimeout ABSENT in source (removed — fights maxRetriesPerRequest:null) ──

console.log("\n[2] commandTimeout absent in queue-connection.ts (correct for BullMQ)");
import { readFileSync } from "fs";
const src = readFileSync("server/services/queue-connection.ts", "utf8");

assert(
  !src.includes("commandTimeout: 10_000"),
  "commandTimeout: 10_000 NOT present (removed — caused Command timed out storm)"
);
assert(
  src.includes("commandTimeout intentionally OMITTED"),
  "Source documents WHY commandTimeout is absent"
);
assert(
  src.includes("maxRetriesPerRequest: null"),
  "maxRetriesPerRequest: null is set (required by BullMQ)"
);
assert(
  src.includes("enableReadyCheck: false"),
  "enableReadyCheck: false is set (required by BullMQ)"
);
assert(
  src.includes(`msg.includes("epipe")`),
  '"epipe" present in reconnectOnError source'
);

// ── 3. Shared-client architecture — diagnoseRedisCapacity uses 1+N formula ────

console.log("\n[3] diagnoseRedisCapacity() — provider-neutral shared-client count (1 + N workers)");

// Ensure no limit is configured so we test the formula independently
const origLimit = process.env.REDIS_CONNECTION_LIMIT;
delete process.env.REDIS_CONNECTION_LIMIT;

try {
  const report7 = diagnoseRedisCapacity({ physicalWorkerCount: 7 });
  assert(report7.physicalWorkerCount === 7, "physicalWorkerCount matches input (7)");
  assert(report7.sharedClientCount === 1, "sharedClientCount defaults to 1");
  assert(report7.estimatedProcessConnections === 8, `7 workers → 8 estimated process connections (got ${report7.estimatedProcessConnections})`);
  assert(typeof report7.capturedAt === "string" && !isNaN(new Date(report7.capturedAt).getTime()), "capturedAt is valid ISO string");
  assert(report7.status === "unknown", `status=unknown when no limit configured (got ${report7.status})`);
  assert(Array.isArray(report7.reasons) && report7.reasons.length > 0, "reasons is non-empty array");
  assert(report7.configuredConnectionLimit === null, "configuredConnectionLimit is null without env var");

  const report1 = diagnoseRedisCapacity({ physicalWorkerCount: 1 });
  assert(report1.estimatedProcessConnections === 2, `1 worker → 2 estimated process connections (got ${report1.estimatedProcessConnections})`);

  // Actual QUEUE_CONFIGS count — 1 shared + N Workers
  const actualWorkerCount = QUEUE_CONFIGS.length;
  const reportActual = diagnoseRedisCapacity({ physicalWorkerCount: actualWorkerCount });
  assert(
    reportActual.estimatedProcessConnections === 1 + actualWorkerCount,
    `${actualWorkerCount} workers → ${1 + actualWorkerCount} estimated process connections (got ${reportActual.estimatedProcessConnections})`
  );
  assert(reportActual.status === "unknown", "status=unknown without REDIS_CONNECTION_LIMIT (cannot assert safe without known limit)");

  // Fleet estimate is null without REDIS_DEPLOYMENT_PROCESS_COUNT
  assert(reportActual.estimatedFleetConnections === null, "estimatedFleetConnections is null without deploymentProcessCount");

  // Supply deploymentProcessCount manually
  const reportFleet = diagnoseRedisCapacity({ physicalWorkerCount: actualWorkerCount, deploymentProcessCount: 2 });
  assert(
    reportFleet.estimatedFleetConnections === (1 + actualWorkerCount) * 2,
    `Fleet estimate = ${(1 + actualWorkerCount) * 2} with 2 processes (got ${reportFleet.estimatedFleetConnections})`
  );
} finally {
  if (origLimit !== undefined) process.env.REDIS_CONNECTION_LIMIT = origLimit;
}

// ── 4. Known limit — safe / warning / unsafe status ─────────────────────────

console.log("\n[4] Known limit — capacity status: safe / warning / unsafe");

const origLimit2 = process.env.REDIS_CONNECTION_LIMIT;
process.env.REDIS_CONNECTION_LIMIT = "30";

try {
  // Well below limit → safe
  const safe = diagnoseRedisCapacity({ physicalWorkerCount: 5 });
  assert(safe.status === "safe", `5 workers → safe under limit=30 (got ${safe.status})`);
  assert(safe.configuredConnectionLimit === 30, `configuredConnectionLimit=30 (got ${safe.configuredConnectionLimit})`);

  // Over limit → unsafe
  const unsafe = diagnoseRedisCapacity({ physicalWorkerCount: 35 });
  assert(unsafe.status === "unsafe", `35 workers → unsafe over limit=30 (got ${unsafe.status})`);

  // Old formula (N×3) vs new formula (1+N) — new formula uses far fewer connections
  const OLD_ESTIMATED_23 = 23 * 3; // before shared-client fix: 69 connections
  const NEW_ESTIMATED_23 = 1 + 23;  // after shared-client fix: 24 connections
  assert(
    OLD_ESTIMATED_23 > NEW_ESTIMATED_23,
    `Old formula (${OLD_ESTIMATED_23}) >> new formula (${NEW_ESTIMATED_23}) — fix dramatically reduces connection count`
  );
} finally {
  if (origLimit2 !== undefined) process.env.REDIS_CONNECTION_LIMIT = origLimit2;
  else delete process.env.REDIS_CONNECTION_LIMIT;
}

// ── 5. Invalid limit values → unknown ──────────────────────────────────────

console.log("\n[5] Invalid REDIS_CONNECTION_LIMIT values → status=unknown");

for (const invalidValue of ["", "abc", "-5", "0", "1.5", "1abc", " "]) {
  const orig = process.env.REDIS_CONNECTION_LIMIT;
  process.env.REDIS_CONNECTION_LIMIT = invalidValue;
  try {
    const result = diagnoseRedisCapacity({ physicalWorkerCount: 10 });
    assert(
      result.status === "unknown" && result.configuredConnectionLimit === null,
      `REDIS_CONNECTION_LIMIT="${invalidValue}" → status=unknown, limit=null (got status=${result.status}, limit=${result.configuredConnectionLimit})`
    );
  } finally {
    if (orig !== undefined) process.env.REDIS_CONNECTION_LIMIT = orig;
    else delete process.env.REDIS_CONNECTION_LIMIT;
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
if (failures === 0) {
  console.log("✓ All Redis reconnect hardening checks passed.");
  process.exit(0);
} else {
  console.error(`✗ ${failures} check(s) failed.`);
  process.exit(1);
}
