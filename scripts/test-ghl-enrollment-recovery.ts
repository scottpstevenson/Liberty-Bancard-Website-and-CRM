#!/usr/bin/env tsx
/**
 * test-ghl-enrollment-recovery.ts
 *
 * Verifies that the mutex in ghl-enrollment-recovery.ts correctly serialises
 * concurrent load-modify-save operations so no deferred enrollment is silently
 * dropped or duplicated.
 *
 * Scenarios exercised:
 *  1. Two simultaneous deferGhlEnrollment() calls for DIFFERENT pairs
 *     → both entries must appear in the queue (no silent drop)
 *  2. Two simultaneous deferGhlEnrollment() calls for the SAME pair
 *     → exactly one entry must exist (idempotent, no duplicate)
 *  3. retryDeferredEnrollments() concurrent with deferGhlEnrollment()
 *     → neither call overwrites the other's data
 *
 * Uses an in-memory storage stub — no real DB or Redis connection required.
 * Exits 0 if all assertions pass, 1 if any fail.
 */

import { storage } from "../server/storage";

// ── In-memory storage stub ────────────────────────────────────────────────────
// We patch storage.getSystemSetting / setSystemSetting so the recovery module
// operates against a simple Map without needing a database.

const memStore = new Map<string, unknown>();

// Track raw save calls to verify mutex ordering
let saveCalls = 0;
let concurrentSaveHighWaterMark = 0;
let activeSaves = 0;

// Artificial async delay to widen the race window
const DELAY_MS = 5;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const origGet = storage.getSystemSetting.bind(storage);
const origSet = storage.setSystemSetting.bind(storage);

function installMemoryStubs() {
  (storage as any).getSystemSetting = async (key: string) => {
    await sleep(DELAY_MS); // simulate async latency
    return memStore.get(key) ?? null;
  };
  (storage as any).setSystemSetting = async (key: string, value: unknown) => {
    activeSaves++;
    if (activeSaves > concurrentSaveHighWaterMark) {
      concurrentSaveHighWaterMark = activeSaves;
    }
    await sleep(DELAY_MS); // simulate async latency
    memStore.set(key, value);
    saveCalls++;
    activeSaves--;
  };
}

function restoreStubs() {
  (storage as any).getSystemSetting = origGet;
  (storage as any).setSystemSetting = origSet;
}

function resetStore() {
  memStore.clear();
  saveCalls = 0;
  concurrentSaveHighWaterMark = 0;
  activeSaves = 0;
}

// ── Assertion helpers ─────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = detail ? `${label} — ${detail}` : label;
    failures.push(msg);
    console.error(`  ✗ ${msg}`);
  }
}

async function readQueue(): Promise<any[]> {
  const raw = memStore.get("deferred_ghl_enrollments");
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as any[];
  if (typeof raw === "string") return JSON.parse(raw);
  return [];
}

// ── Test 1: Two different pairs simultaneously ────────────────────────────────

async function testTwoDifferentPairsSimultaneously() {
  console.log("\n1. Two simultaneous deferrals for DIFFERENT contact/workflow pairs");
  console.log("   (both must survive — no silent drop from last-write-wins)");

  resetStore();

  // Import fresh to ensure the module-level mutex is in a resolved state.
  // Since Node caches modules, we re-use the cached import; the mutex starts
  // resolved at module load time.
  const { deferGhlEnrollment } = await import(
    "../server/services/ghl-enrollment-recovery"
  );

  // Fire both concurrently — intentionally not awaiting individually
  await Promise.all([
    deferGhlEnrollment({
      ghlContactId: "contact-A",
      workflowKey: "workflow-X",
      error: new Error("timeout"),
    }),
    deferGhlEnrollment({
      ghlContactId: "contact-B",
      workflowKey: "workflow-Y",
      error: new Error("502 Bad Gateway"),
    }),
  ]);

  const queue = await readQueue();
  const idA = "contact-A::workflow-X";
  const idB = "contact-B::workflow-Y";

  assert(
    "Queue has exactly 2 entries (not 1 from last-write-wins)",
    queue.length === 2,
    `actual length = ${queue.length}`
  );
  assert(
    "Entry for contact-A::workflow-X is present",
    queue.some(e => e.id === idA),
    `ids = ${JSON.stringify(queue.map(e => e.id))}`
  );
  assert(
    "Entry for contact-B::workflow-Y is present",
    queue.some(e => e.id === idB),
    `ids = ${JSON.stringify(queue.map(e => e.id))}`
  );
  assert(
    "Saves were serialised (concurrent save high-water mark = 1)",
    concurrentSaveHighWaterMark <= 1,
    `high-water mark = ${concurrentSaveHighWaterMark}`
  );
}

// ── Test 2: Same pair simultaneously (idempotent) ─────────────────────────────

async function testSamePairIdempotent() {
  console.log("\n2. Two simultaneous deferrals for the SAME contact/workflow pair");
  console.log("   (exactly one entry must exist — no duplicate)");

  resetStore();

  const { deferGhlEnrollment } = await import(
    "../server/services/ghl-enrollment-recovery"
  );

  await Promise.all([
    deferGhlEnrollment({
      ghlContactId: "contact-C",
      workflowKey: "workflow-Z",
      error: new Error("first failure"),
    }),
    deferGhlEnrollment({
      ghlContactId: "contact-C",
      workflowKey: "workflow-Z",
      error: new Error("second failure"),
    }),
  ]);

  const queue = await readQueue();
  const id = "contact-C::workflow-Z";
  const entries = queue.filter(e => e.id === id);

  assert(
    "Exactly one entry exists for the same contact+workflow pair",
    entries.length === 1,
    `found ${entries.length} entries`
  );
  assert(
    "Entry retryCount is 0 (new record, not incremented by update path)",
    entries.length === 1 && entries[0].retryCount === 0,
    `retryCount = ${entries[0]?.retryCount}`
  );
  assert(
    "lastError reflects one of the two concurrent failures",
    entries.length === 1 &&
      (entries[0].lastError === "first failure" ||
        entries[0].lastError === "second failure"),
    `lastError = ${entries[0]?.lastError}`
  );
}

// ── Test 3: retryDeferredEnrollments concurrent with deferGhlEnrollment ───────

async function testRetryConcurrentWithDefer() {
  console.log("\n3. retryDeferredEnrollments() concurrent with deferGhlEnrollment()");
  console.log("   (neither must overwrite the other's queue state)");

  resetStore();

  const { deferGhlEnrollment, retryDeferredEnrollments } = await import(
    "../server/services/ghl-enrollment-recovery"
  );

  // Pre-seed the queue with one entry that is NOT due yet (far-future nextRetryAt)
  // so retryDeferredEnrollments() will load, find nothing due, and save unchanged.
  const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  memStore.set("deferred_ghl_enrollments", [
    {
      id: "existing-contact::existing-workflow",
      ghlContactId: "existing-contact",
      workflowKey: "existing-workflow",
      metadata: {},
      enqueuedAt: new Date().toISOString(),
      retryCount: 0,
      nextRetryAt: futureDate,
      lastError: "pre-seeded failure",
    },
  ]);

  // Fire retry and a new deferral concurrently
  await Promise.all([
    retryDeferredEnrollments(),
    deferGhlEnrollment({
      ghlContactId: "new-contact",
      workflowKey: "new-workflow",
      error: new Error("concurrent failure"),
    }),
  ]);

  const queue = await readQueue();

  assert(
    "Pre-existing entry is still in queue after concurrent retry+defer",
    queue.some(e => e.id === "existing-contact::existing-workflow"),
    `ids = ${JSON.stringify(queue.map(e => e.id))}`
  );
  assert(
    "New entry added by concurrent deferGhlEnrollment is present",
    queue.some(e => e.id === "new-contact::new-workflow"),
    `ids = ${JSON.stringify(queue.map(e => e.id))}`
  );
  assert(
    "Queue has exactly 2 entries (no overwrite, no loss)",
    queue.length === 2,
    `actual length = ${queue.length}`
  );
}

// ── Test 4: Sequential idempotency — update path preserves enqueue time ───────

async function testSequentialIdempotency() {
  console.log("\n4. Sequential duplicate deferrals — update path preserves enqueuedAt");

  resetStore();

  const { deferGhlEnrollment } = await import(
    "../server/services/ghl-enrollment-recovery"
  );

  await deferGhlEnrollment({
    ghlContactId: "contact-D",
    workflowKey: "workflow-W",
    error: new Error("first attempt"),
  });

  const queueAfterFirst = await readQueue();
  const firstEnqueuedAt = queueAfterFirst[0]?.enqueuedAt;

  await sleep(10); // ensure clock ticks

  await deferGhlEnrollment({
    ghlContactId: "contact-D",
    workflowKey: "workflow-W",
    error: new Error("second attempt"),
  });

  const queueAfterSecond = await readQueue();
  const entry = queueAfterSecond.find(e => e.id === "contact-D::workflow-W");

  assert(
    "Still exactly one entry after second deferral of same pair",
    queueAfterSecond.length === 1,
    `length = ${queueAfterSecond.length}`
  );
  assert(
    "enqueuedAt is preserved (not reset on update)",
    entry?.enqueuedAt === firstEnqueuedAt,
    `first=${firstEnqueuedAt} updated=${entry?.enqueuedAt}`
  );
  assert(
    "lastError updated to second attempt message",
    entry?.lastError === "second attempt",
    `lastError = ${entry?.lastError}`
  );
}

// ── Test 5: isTransientGhlError classification ────────────────────────────────

async function testIsTransientGhlError() {
  console.log("\n5. isTransientGhlError() — classifies retryable vs non-retryable errors");

  const { isTransientGhlError } = await import(
    "../server/services/ghl-enrollment-recovery"
  );

  const transientCases = [
    new Error("Request timed out after 20000ms"),
    new Error("ECONNRESET"),
    new Error("ECONNREFUSED"),
    new Error("ETIMEDOUT"),
    new Error("ENOTFOUND api.msgsndr.com"),
    new Error("socket hang up"),
    new Error("500 Internal Server Error"),
    new Error("502 Bad Gateway"),
    new Error("503 Service Unavailable"),
    new Error("504 Gateway Timeout"),
    new Error("circuit breaker is open"),
    new Error("network error"),
    new Error("fetch failed"),
    new Error("429 Too Many Requests"),
  ];

  const nonTransientCases = [
    new Error("Workflow UNKNOWN_KEY not configured"),
    new Error("Contact not found"),
    new Error("Invalid API key"),
    new Error("400 Bad Request"),
  ];

  for (const err of transientCases) {
    assert(
      `isTransientGhlError("${err.message}") → true`,
      isTransientGhlError(err),
      `expected transient`
    );
  }

  for (const err of nonTransientCases) {
    assert(
      `isTransientGhlError("${err.message}") → false`,
      !isTransientGhlError(err),
      `expected non-transient`
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log(" GHL Enrollment Recovery — Mutex Correctness Tests");
  console.log("═══════════════════════════════════════════════════════");

  installMemoryStubs();

  try {
    await testTwoDifferentPairsSimultaneously();
    await testSamePairIdempotent();
    await testRetryConcurrentWithDefer();
    await testSequentialIdempotency();
    await testIsTransientGhlError();
  } catch (err: any) {
    console.error("\nUnhandled error during tests:", err?.message ?? err);
    failed++;
    failures.push(`Unhandled error: ${err?.message ?? err}`);
  } finally {
    restoreStubs();
  }

  console.log(`\n${"═".repeat(55)}`);
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(55));

  if (failures.length) {
    console.error("\nFailures:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }

  console.log("\n✅ All GHL enrollment recovery mutex tests passed.");
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
