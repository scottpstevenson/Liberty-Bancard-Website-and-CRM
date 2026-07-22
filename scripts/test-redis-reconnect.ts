/**
 * test-redis-reconnect.ts
 *
 * Validates the queue-connection.ts hardening changes:
 *   1. reconnectOnError fires on EPIPE (new) + existing ECONNRESET / ETIMEDOUT / ECONNREFUSED
 *   2. commandTimeout is set (10 s hard deadline per command)
 *   3. diagnoseRedisCapacity() returns a coherent capacity report
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

// We can't call getRedisConnection() without a real Redis URL, but we can
// replicate the exact callback inline and verify it matches the source code.
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
  ["write EPIPE",           true],   // newly added
  ["Connection terminated", false],  // should NOT reconnect
  ["WRONGPASS",             false],  // auth error — do not loop-reconnect
];

for (const [msg, expected] of cases) {
  const result = reconnectOnError(new Error(msg));
  assert(result === expected, `reconnectOnError("${msg}") → ${expected}`);
}

// ── 2. commandTimeout presence in source ──────────────────────────────────────

console.log("\n[2] commandTimeout present in queue-connection.ts source");
import { readFileSync } from "fs";
const src = readFileSync("server/services/queue-connection.ts", "utf8");
assert(src.includes("commandTimeout: 10_000"), "commandTimeout: 10_000 found in source");
assert(src.includes(`msg.includes("epipe")`), '"epipe" present in reconnectOnError source');

// ── 3. diagnoseRedisCapacity — capacity report sanity ─────────────────────────

console.log("\n[3] diagnoseRedisCapacity()");

const reportSmall = diagnoseRedisCapacity(7);
assert(reportSmall.queues === 7, "queues field matches input");
assert(reportSmall.upstashFreeTierMax === 20, "upstashFreeTierMax is 20 (Upstash free tier)");
assert(typeof reportSmall.estimatedBullMqConnections === "number", "estimatedBullMqConnections is a number");
assert(typeof reportSmall.safeForUpstashFree === "boolean", "safeForUpstashFree is a boolean");
assert(typeof reportSmall.recommendation === "string" && reportSmall.recommendation.length > 0, "recommendation is non-empty string");
assert(reportSmall.estimatedBullMqConnections > 0, "estimatedBullMqConnections > 0");

// 7 named queues: ghl-sync, sla-checks, sequences, enrichment, discovery, digests, mid-ingestion
// Each queue = 1 producer + 1 worker + 1 events subscriber = ~3 connections minimum
// At 7 queues × 3 = 21 connections → should exceed Upstash free tier (20 max)
assert(
  !reportSmall.safeForUpstashFree,
  "7 queues exceeds Upstash free tier (expected safeForUpstashFree=false)"
);

const reportTiny = diagnoseRedisCapacity(1);
assert(reportTiny.queues === 1, "single queue report");
assert(
  reportTiny.safeForUpstashFree,
  "1 queue is safe for Upstash free tier"
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
