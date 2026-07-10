#!/usr/bin/env tsx
/**
 * Test script for enrichment reconciliation helpers.
 * Exercises reconcileEnrichmentState, buildSafeEnrichmentFailureProgress,
 * sanitizeEnrichmentError, and isEnrichmentRunning with injected mock storage.
 * Exits 0 on all pass, 1 on any failure.
 */

import { reconcileEnrichmentState } from "../server/services/startup-reconcile";
import {
  sanitizeEnrichmentError,
  buildSafeEnrichmentFailureProgress,
  isEnrichmentRunning,
} from "../server/services/enrichment-progress-helpers";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function mockStorage(initial: Record<string, unknown> | null) {
  let stored: unknown = initial;
  let setCallCount = 0;
  let lastSetValue: unknown = undefined;
  return {
    async getSystemSetting(_key: string) { return stored; },
    async setSystemSetting(_key: string, value: unknown) {
      stored = value;
      setCallCount++;
      lastSetValue = value;
    },
    _getStored() { return stored; },
    _getSetCallCount() { return setCallCount; },
    _getLastSetValue() { return lastSetValue; },
  };
}

// ── Reconciliation tests ──────────────────────────────────────────────────────

console.log("\n── Reconciliation: running → interrupted ──");
{
  const s = mockStorage({
    status: "running",
    total: 200,
    processed: 47,
    classified: 12,
    emailsFound: 5,
    phonesFound: 3,
    errors: 1,
    startedAt: "2026-07-10T04:02:20Z",
  });
  await reconcileEnrichmentState(s);
  const result = s._getStored() as Record<string, unknown>;
  assert(s._getSetCallCount() === 1, "setSystemSetting called once");
  assert(result.status === "interrupted", "status → interrupted");
  assert(result.interruptionReason === "server_restart", "interruptionReason set");
  assert(typeof result.interruptedAt === "string", "interruptedAt set");
  assert(result.total === 200, "total preserved");
  assert(result.processed === 47, "processed preserved");
  assert(result.classified === 12, "classified preserved");
  assert(result.emailsFound === 5, "emailsFound preserved");
  assert(result.phonesFound === 3, "phonesFound preserved");
  assert(result.errors === 1, "errors preserved");
  assert(result.startedAt === "2026-07-10T04:02:20Z", "startedAt preserved");
  assert(result.failedAt === undefined, "no failedAt in interrupted payload");
  assert(result.error === undefined, "no error in interrupted payload");
}

console.log("\n── Reconciliation: complete → no write ──");
{
  const s = mockStorage({ status: "complete", total: 200, processed: 200 });
  await reconcileEnrichmentState(s);
  assert(s._getSetCallCount() === 0, "no setSystemSetting called for complete status");
}

console.log("\n── Reconciliation: failed → no write ──");
{
  const s = mockStorage({ status: "failed", total: 200, processed: 47 });
  await reconcileEnrichmentState(s);
  assert(s._getSetCallCount() === 0, "no setSystemSetting called for failed status");
}

console.log("\n── Reconciliation: interrupted → no write ──");
{
  const s = mockStorage({ status: "interrupted", total: 200, processed: 47 });
  await reconcileEnrichmentState(s);
  assert(s._getSetCallCount() === 0, "no setSystemSetting called for already-interrupted status");
}

console.log("\n── Reconciliation: null setting → no-op ──");
{
  const s = mockStorage(null);
  let threw = false;
  try {
    await reconcileEnrichmentState(s);
  } catch {
    threw = true;
  }
  assert(!threw, "no throw on null setting");
  assert(s._getSetCallCount() === 0, "no setSystemSetting called for null");
}

console.log("\n── Reconciliation: non-object value → no throw, no write ──");
{
  const s = {
    async getSystemSetting(_key: string) { return "broken" as unknown; },
    async setSystemSetting(_key: string, _value: unknown) { throw new Error("should not be called"); },
  };
  let threw = false;
  try {
    await reconcileEnrichmentState(s);
  } catch {
    threw = true;
  }
  assert(!threw, "no throw on non-object string value");
}

console.log("\n── Reconciliation: object missing status field → no throw, no write ──");
{
  const s = {
    async getSystemSetting(_key: string) { return { total: 200 } as unknown; },
    async setSystemSetting(_key: string, _value: unknown) { throw new Error("should not be called"); },
  };
  let threw = false;
  try {
    await reconcileEnrichmentState(s);
  } catch {
    threw = true;
  }
  assert(!threw, "no throw on object missing status field");
}

console.log("\n── Reconciliation: getSystemSetting throws → no propagation, no setSystemSetting ──");
{
  let setCount = 0;
  const s = {
    async getSystemSetting(_key: string): Promise<unknown> { throw new Error("DB connection refused"); },
    async setSystemSetting(_key: string, _value: unknown) { setCount++; },
  };
  let threw = false;
  try {
    await reconcileEnrichmentState(s);
  } catch {
    threw = true;
  }
  assert(!threw, "no throw propagated from reconcileEnrichmentState when storage throws");
  assert(setCount === 0, "no setSystemSetting when getSystemSetting threw");
}

// ── buildSafeEnrichmentFailureProgress tests ──────────────────────────────────

console.log("\n── buildSafeEnrichmentFailureProgress: with current progress ──");
{
  const now = "2026-07-10T16:00:00Z";
  const err = new Error("getSunbizEntities is failing to initialize entities");
  const result = buildSafeEnrichmentFailureProgress({ total: 200, processed: 47 }, err, now);
  assert(result.status === "failed", "status is failed");
  assert(result.failedAt === now, "failedAt set correctly");
  assert(result.total === 200, "total preserved");
  assert(result.processed === 47, "processed preserved");
  assert(typeof result.error === "string" && result.error.length > 0, "error is a non-empty string");
  assert(result.interruptedAt === undefined, "no interruptedAt in failed payload");
  assert(result.interruptionReason === undefined, "no interruptionReason in failed payload");
}

console.log("\n── buildSafeEnrichmentFailureProgress: null current progress ──");
{
  const now = "2026-07-10T16:00:00Z";
  const err = new Error("some error");
  const result = buildSafeEnrichmentFailureProgress(null, err, now);
  assert(result.status === "failed", "status is failed");
  assert(result.failedAt === now, "failedAt set");
  assert(result.total === undefined, "no total when current was null");
  assert(result.processed === undefined, "no processed when current was null");
}

// ── sanitizeEnrichmentError tests ─────────────────────────────────────────────

console.log("\n── sanitizeEnrichmentError: database connection pattern ──");
{
  const result = sanitizeEnrichmentError(new Error("connect ECONNRESET 10.0.0.1:5432"));
  assert(result === "Database connection failed", `got: "${result}"`);
}

console.log("\n── sanitizeEnrichmentError: OpenAI provider pattern ──");
{
  const result = sanitizeEnrichmentError(new Error("OpenAI request failed: rate limit exceeded"));
  assert(result === "Provider request failed", `got: "${result}"`);
}

console.log("\n── sanitizeEnrichmentError: fetch timeout pattern ──");
{
  const result = sanitizeEnrichmentError(new Error("fetch timeout after 30000ms"));
  assert(result === "Provider request failed", `got: "${result}"`);
}

console.log("\n── sanitizeEnrichmentError: initialization pattern ──");
{
  const result = sanitizeEnrichmentError(new Error("getSunbizEntities returned null"));
  assert(result === "Enrichment initialization failed", `got: "${result}"`);
}

console.log("\n── sanitizeEnrichmentError: unknown pattern ──");
{
  const result = sanitizeEnrichmentError(new Error("something completely unexpected"));
  assert(result === "Unexpected batch failure", `got: "${result}"`);
}

console.log("\n── sanitizeEnrichmentError: long multi-line string → no newlines, ≤120 chars ──");
{
  const longErr = new Error("line1\nline2\rline3\ttabbed " + "x".repeat(200));
  const result = sanitizeEnrichmentError(longErr);
  assert(!/[\r\n\t]/.test(result), "no newlines/tabs in output");
  assert(result.length <= 120, `length ${result.length} ≤ 120`);
}

console.log("\n── sanitizeEnrichmentError: 401 auth pattern → Database connection failed ──");
{
  const result = sanitizeEnrichmentError(new Error("401 unauthorized access"));
  assert(result === "Database connection failed", `got: "${result}"`);
}

// ── isEnrichmentRunning tests ─────────────────────────────────────────────────

console.log("\n── isEnrichmentRunning predicates ──");
assert(isEnrichmentRunning("running") === true, 'isEnrichmentRunning("running") → true');
assert(isEnrichmentRunning("interrupted") === false, 'isEnrichmentRunning("interrupted") → false');
assert(isEnrichmentRunning("failed") === false, 'isEnrichmentRunning("failed") → false');
assert(isEnrichmentRunning("complete") === false, 'isEnrichmentRunning("complete") → false');
assert(isEnrichmentRunning(undefined) === false, "isEnrichmentRunning(undefined) → false");

// ── Fresh-run payload integrity ───────────────────────────────────────────────

console.log("\n── Fresh-run payload: failed payload has no interruptedAt/interruptionReason ──");
{
  const result = buildSafeEnrichmentFailureProgress({ total: 200, processed: 47 }, new Error("test"), "2026-07-10T00:00:00Z");
  assert(result.interruptedAt === undefined, "no interruptedAt in failed payload");
  assert(result.interruptionReason === undefined, "no interruptionReason in failed payload");
}

console.log("\n── Reconcile interrupted output: no failedAt/error ──");
{
  const s = mockStorage({
    status: "running",
    total: 200,
    processed: 100,
    startedAt: "2026-07-10T04:00:00Z",
  });
  await reconcileEnrichmentState(s);
  const result = s._getStored() as Record<string, unknown>;
  assert(result.failedAt === undefined, "no failedAt in interrupted reconcile output");
  assert(result.error === undefined, "no error in interrupted reconcile output");
}

// ── Outer catch: pre-initialization throw uses in-memory counters ─────────────

console.log("\n── Outer catch: pre-init throw produces zeroed counters (no stale prior-run data) ──");
{
  const now = "2026-07-10T16:00:00Z";
  // Simulate getSunbizEntitiesNeedingEnrichment throwing before any counters are incremented
  // Counters would be total=0, processed=0, classified=0, emailsFound=0, phonesFound=0, errors=0
  const inMemoryCounters = { total: 0, processed: 0, classified: 0, emailsFound: 0, phonesFound: 0, errors: 0 };
  const err = new Error("getSunbizEntities is failing to initialize entities");
  const result = buildSafeEnrichmentFailureProgress(inMemoryCounters, err, now);
  assert(result.status === "failed", "status is failed");
  assert(result.total === 0, "total is 0 (in-memory, not stale prior-run value)");
  assert(result.processed === 0, "processed is 0 (in-memory)");
  assert(result.classified === 0, "classified is 0 (in-memory)");
  assert(result.emailsFound === 0, "emailsFound is 0 (in-memory)");
  assert(result.phonesFound === 0, "phonesFound is 0 (in-memory)");
  assert(result.errors === 0, "errors is 0 (in-memory)");
  assert(typeof result.error === "string" && result.error.length > 0, "safe error message present");
  assert(result.interruptedAt === undefined, "no interruptedAt carried from prior run");
  assert(result.interruptionReason === undefined, "no interruptionReason carried from prior run");
}

console.log("\n── Outer catch: mid-run throw preserves actual in-memory progress ──");
{
  const now = "2026-07-10T16:00:00Z";
  // Simulate mid-run throw after 47 entities processed
  const inMemoryCounters = { total: 200, processed: 47, classified: 12, emailsFound: 5, phonesFound: 3, errors: 1 };
  const err = new Error("fetch timeout after 30000ms");
  const result = buildSafeEnrichmentFailureProgress(inMemoryCounters, err, now);
  assert(result.status === "failed", "status is failed");
  assert(result.total === 200, "total preserved from in-memory");
  assert(result.processed === 47, "processed preserved from in-memory");
  assert(result.classified === 12, "classified preserved from in-memory");
  assert(result.emailsFound === 5, "emailsFound preserved from in-memory");
  assert(result.phonesFound === 3, "phonesFound preserved from in-memory");
  assert(result.errors === 1, "errors preserved from in-memory");
  assert(result.error === "Provider request failed", "error mapped to safe provider message");
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} assertions — ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\n✗ ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\n✓ All assertions passed");
process.exit(0);
