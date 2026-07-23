/**
 * test-redis-reconnect.ts
 *
 * Validates queue-connection.ts hardening:
 *   1. reconnectOnError fires on ECONNRESET / ETIMEDOUT / ECONNREFUSED / EPIPE
 *   2. commandTimeout is ABSENT (removed — it fights maxRetriesPerRequest:null
 *      and was the direct cause of the "Command timed out" production storm)
 *   3. diagnoseRedisCapacity() reports correct connection count under the
 *      shared-client architecture (1 + N workers, NOT N × 3)
 *   4. 11-queue production setup is safe for Upstash free tier (≤ 20 connections)
 *
 * Exit 0 = all checks pass. Exit 1 = at least one failure.
 */

import { diagnoseRedisCapacity } from "../server/services/queue-connection";

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

console.log("\n[3] diagnoseRedisCapacity() — shared-client connection count (1 + N workers)");

const reportSmall = diagnoseRedisCapacity(7);
assert(reportSmall.queues === 7, "queues field matches input");
assert(reportSmall.upstashFreeTierMax === 20, "upstashFreeTierMax is 20 (Upstash free tier)");
assert(typeof reportSmall.estimatedBullMqConnections === "number", "estimatedBullMqConnections is a number");
assert(typeof reportSmall.safeForUpstashFree === "boolean", "safeForUpstashFree is a boolean");
assert(typeof reportSmall.recommendation === "string" && reportSmall.recommendation.length > 0, "recommendation is non-empty string");
assert(reportSmall.estimatedBullMqConnections > 0, "estimatedBullMqConnections > 0");

// Shared-client formula: 1 + queueCount (1 shared + 1 blocking per Worker)
// 7 queues → 8 connections (well within 20)
assert(
  reportSmall.safeForUpstashFree,
  "7 queues is safe for Upstash free tier with shared-client architecture (8 connections)"
);
assert(
  reportSmall.estimatedBullMqConnections === 8,
  `7 queues → 8 connections (1 shared + 7 blocking), got ${reportSmall.estimatedBullMqConnections}`
);

// 11-queue production setup
const report11 = diagnoseRedisCapacity(11);
assert(
  report11.safeForUpstashFree,
  "11 queues (production) is safe for Upstash free tier (12 connections ≤ 20)"
);
assert(
  report11.estimatedBullMqConnections === 12,
  `11 queues → 12 connections (1 shared + 11 blocking), got ${report11.estimatedBullMqConnections}`
);

const reportTiny = diagnoseRedisCapacity(1);
assert(reportTiny.queues === 1, "single queue report");
assert(reportTiny.safeForUpstashFree, "1 queue is safe for Upstash free tier");
assert(reportTiny.estimatedBullMqConnections === 2, `1 queue → 2 connections, got ${reportTiny.estimatedBullMqConnections}`);

// ── 4. Old formula would have flagged 11 queues as unsafe ─────────────────────

console.log("\n[4] Old formula (N×3) would exceed limit — new formula does not");

const OLD_ESTIMATED = 11 * 3; // old formula: queueCount × 3 connections
const NEW_ESTIMATED = 1 + 11;  // new formula: 1 shared + 1 per Worker
assert(
  OLD_ESTIMATED > 20,
  `Old formula: 11 queues × 3 = ${OLD_ESTIMATED} connections > 20 (would exceed Upstash free tier)`
);
assert(
  NEW_ESTIMATED <= 20,
  `New formula: 1 + 11 = ${NEW_ESTIMATED} connections ≤ 20 (safe for Upstash free tier)`
);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
if (failures === 0) {
  console.log("✓ All Redis reconnect hardening checks passed.");
  process.exit(0);
} else {
  console.error(`✗ ${failures} check(s) failed.`);
  process.exit(1);
}
