/**
 * test-sunbiz-bounded-batch.ts
 *
 * Regression tests for the Sunbiz enrichment bounded-batch fix.
 *
 * Root cause that was fixed: both processSunbizEnrichmentBatch() and
 * processSunbizEnrichmentQueue() called storage.getSunbizEntitiesByStatus("pending")
 * WITHOUT forwarding the limit parameter, causing an unbounded scan of all
 * 968 k pending rows and a PG statement-timeout (57014).
 *
 * What these tests verify:
 *   1. The source no longer contains any call to getSunbizEntitiesByStatus
 *      with only one argument (i.e. no unbounded pending-record fetch).
 *   2. Both call sites pass a numeric limit as the second argument.
 *   3. The storage function getSunbizEntitiesByStatus applies a LIMIT clause
 *      when the limit param is provided.
 *
 * Exit 0 = all checks pass. Exit 1 = at least one failure.
 */

import { readFileSync } from "fs";

let failures = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failures++;
  }
}

// ── 1. Source-level: no unbounded getSunbizEntitiesByStatus("pending") call ──

console.log("\n[1] No unbounded getSunbizEntitiesByStatus('pending') call in sunbiz-enrichment.ts");
const enrichmentSrc = readFileSync("server/services/sunbiz-enrichment.ts", "utf8");

// The fixed pattern is getSunbizEntitiesByStatus("pending", <something>).
// The broken pattern is getSunbizEntitiesByStatus("pending") with nothing after.
// Match: call followed by closing paren with no second argument.
const unboundedPattern = /getSunbizEntitiesByStatus\(\s*["']pending["']\s*\)/g;
const unboundedMatches = enrichmentSrc.match(unboundedPattern) || [];

assert(
  unboundedMatches.length === 0,
  `No unbounded getSunbizEntitiesByStatus("pending") calls found (found ${unboundedMatches.length})`
);

// ── 2. Both call sites pass a limit ──────────────────────────────────────────

console.log("\n[2] Both call sites in sunbiz-enrichment.ts pass a limit argument");

// Match: getSunbizEntitiesByStatus("pending", <non-whitespace second arg>)
const boundedPattern = /getSunbizEntitiesByStatus\(\s*["']pending["']\s*,\s*\w+\s*\)/g;
const boundedMatches = enrichmentSrc.match(boundedPattern) || [];

assert(
  boundedMatches.length >= 2,
  `At least 2 bounded calls found (processSunbizEnrichmentBatch + processSunbizEnrichmentQueue) — found ${boundedMatches.length}`
);

// ── 3. processSunbizEnrichmentBatch does NOT slice after the bounded fetch ────

console.log("\n[3] processSunbizEnrichmentBatch does not call .slice() after the bounded fetch");

// Find the function body by extracting text between the function signature and the
// closing of the try block.
const batchFnIdx = enrichmentSrc.indexOf("async function processSunbizEnrichmentBatch");
const queueFnIdx = enrichmentSrc.indexOf("async function processSunbizEnrichmentQueue");

assert(batchFnIdx !== -1, "processSunbizEnrichmentBatch function found");
assert(queueFnIdx !== -1, "processSunbizEnrichmentQueue function found");

if (batchFnIdx !== -1 && queueFnIdx !== -1) {
  const batchBody = enrichmentSrc.slice(batchFnIdx, queueFnIdx);
  const hasSliceAfterFetch = /getSunbizEntitiesByStatus[\s\S]{0,200}\.slice\(/.test(batchBody);
  assert(!hasSliceAfterFetch, "processSunbizEnrichmentBatch does not .slice() after bounded fetch");
}

// ── 4. processSunbizEnrichmentQueue does NOT slice after the bounded fetch ────

console.log("\n[4] processSunbizEnrichmentQueue does not call .slice() after the bounded fetch");

if (queueFnIdx !== -1) {
  // Find next function boundary after processSunbizEnrichmentQueue
  const nextFnIdx = enrichmentSrc.indexOf("\nexport ", queueFnIdx + 10);
  const queueBody = nextFnIdx !== -1
    ? enrichmentSrc.slice(queueFnIdx, nextFnIdx)
    : enrichmentSrc.slice(queueFnIdx, queueFnIdx + 500);
  const hasSliceAfterFetch = /getSunbizEntitiesByStatus[\s\S]{0,200}\.slice\(/.test(queueBody);
  assert(!hasSliceAfterFetch, "processSunbizEnrichmentQueue does not .slice() after bounded fetch");
}

// ── 5. getSunbizEntitiesByStatus in storage applies LIMIT when param present ──

console.log("\n[5] storage.getSunbizEntitiesByStatus applies LIMIT clause when limit is provided");
const storageSrc = readFileSync("server/storage/sunbiz.ts", "utf8");

const fnIdx = storageSrc.indexOf("async getSunbizEntitiesByStatus");
assert(fnIdx !== -1, "getSunbizEntitiesByStatus found in storage/sunbiz.ts");

if (fnIdx !== -1) {
  const fnBody = storageSrc.slice(fnIdx, fnIdx + 600);
  assert(fnBody.includes(".limit(limit)"), "Storage function applies .limit(limit) when provided");
  assert(fnBody.includes("if (limit)"), "Storage function checks if limit is truthy before applying LIMIT");
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
if (failures === 0) {
  console.log("✓ All Sunbiz bounded-batch regression checks passed.");
  process.exit(0);
} else {
  console.error(`✗ ${failures} check(s) failed.`);
  process.exit(1);
}
