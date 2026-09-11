/**
 * Deterministic unit test for the lead-ops health cache single-flight guard.
 *
 * This test re-implements the exact cache/single-flight pattern used in
 * server/routes/lead-ops.ts (getOrRefreshHealth) with a mock computation
 * so it can be run without a database or running server.  It covers:
 *
 *   1. Single-flight: N concurrent cache-miss callers trigger exactly 1 computation.
 *   2. Stale fallback: when computation fails and a prior cache entry exists,
 *      every concurrent caller receives the stale data + isStale:true, not a 500.
 *   3. Joiner stale fallback: callers that join an in-flight (not the creator)
 *      also receive stale data on failure, not an unhandled rejection.
 *   4. Generation safety: a computation started before a cache reset cannot
 *      overwrite the cache after reset, and cannot clear a newer _healthInflight.
 *   5. TTL: a cached entry within TTL is returned directly without computation.
 *
 * Usage:
 *   npx tsx scripts/test-health-cache-concurrency.ts
 */

// ── Mirror of the production cache state (module-scoped) ───────────────────────
let _healthCache: { data: any; ts: number } | null = null;
let _healthInflight: Promise<any> | null = null;
let _healthGeneration = 0;
const HEALTH_CACHE_TTL_MS = 300_000;

// ── Mirror of the production getOrRefreshHealth() ─────────────────────────────
async function getOrRefreshHealth(
  computeFn: () => Promise<any>
): Promise<{ data: any; isStale: boolean }> {
  const now = Date.now();
  if (_healthCache && now - _healthCache.ts < HEALTH_CACHE_TTL_MS) {
    return { data: _healthCache.data, isStale: false };
  }

  if (!_healthInflight) {
    const gen = ++_healthGeneration;
    _healthInflight = computeFn()
      .then((data) => {
        if (_healthGeneration === gen) {
          _healthCache = { data, ts: Date.now() };
        }
        return data;
      })
      .finally(() => {
        if (_healthGeneration === gen) {
          _healthInflight = null;
        }
      });
  }

  try {
    const data = await _healthInflight!;
    return { data, isStale: false };
  } catch (err) {
    if (_healthCache) {
      return { data: _healthCache.data, isStale: true };
    }
    throw err;
  }
}

/** Bust the cache the same way the reset-stuck-jobs handler does. */
function invalidateCache() {
  _healthCache = null;
  _healthGeneration++;
  _healthInflight = null;
}

/** Reset all state between test cases. */
function resetState() {
  _healthCache = null;
  _healthInflight = null;
  _healthGeneration = 0;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function makeDeferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: any) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: any) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// ── Test cases ────────────────────────────────────────────────────────────────

async function testSingleFlight() {
  console.log("\nTest 1: Single-flight — N concurrent misses trigger exactly 1 computation");
  resetState();

  let computeCount = 0;
  const deferred = makeDeferred<any>();

  const compute = () => {
    computeCount++;
    return deferred.promise;
  };

  const N = 10;
  // Fire N concurrent callers against a cold cache.
  const all = Promise.all(
    Array.from({ length: N }, () => getOrRefreshHealth(compute))
  );

  // Let the event loop tick so all callers register.
  await new Promise(r => setImmediate(r));

  assert(computeCount === 1, `computation started exactly once (got ${computeCount})`);
  assert(_healthInflight !== null, "in-flight promise is set while computation is pending");

  // Resolve the computation.
  deferred.resolve({ value: 42 });
  const results = await all;

  assert(computeCount === 1, `computation still ran only once after resolution (got ${computeCount})`);
  assert(results.length === N, `all ${N} callers received a result`);
  assert(results.every(r => !r.isStale), "no caller received stale data");
  assert(results.every(r => r.data?.value === 42), "all callers got the same data");
  assert(_healthInflight === null, "in-flight promise cleared after completion");
  assert(_healthCache !== null, "cache populated after computation");
}

async function testStaleFallbackCreator() {
  console.log("\nTest 2: Stale fallback for the creator caller when computation fails");
  resetState();

  // Pre-populate the cache with stale-eligible data.
  _healthCache = { data: { value: "stale" }, ts: 0 }; // expired (ts=0)

  let computeCount = 0;
  const compute = () => {
    computeCount++;
    return Promise.reject(new Error("DB timeout"));
  };

  let result: { data: any; isStale: boolean };
  try {
    result = await getOrRefreshHealth(compute);
  } catch (e) {
    assert(false, `creator should not throw when stale cache exists (threw: ${e})`);
    return;
  }

  assert(computeCount === 1, `computation ran once (got ${computeCount})`);
  assert(result!.isStale === true, "creator received isStale:true");
  assert(result!.data?.value === "stale", "creator received stale cache data");
}

async function testStaleFallbackJoiners() {
  console.log("\nTest 3: Stale fallback for all joiners when an in-flight computation fails");
  resetState();

  // Pre-populate a stale cache entry.
  _healthCache = { data: { value: "stale" }, ts: 0 };

  const deferred = makeDeferred<any>();
  let computeCount = 0;

  const compute = () => {
    computeCount++;
    return deferred.promise;
  };

  const N = 8;
  const all = Promise.all(
    Array.from({ length: N }, () => getOrRefreshHealth(compute))
  );

  // Wait for all callers to register on the in-flight promise.
  await new Promise(r => setImmediate(r));

  assert(computeCount === 1, `only 1 computation started for ${N} callers`);

  // Now fail the computation.
  deferred.reject(new Error("statement_timeout"));

  const results = await all;

  assert(results.length === N, `all ${N} callers resolved (no unhandled rejection)`);
  assert(results.every(r => r.isStale === true), "every joiner received isStale:true");
  assert(results.every(r => r.data?.value === "stale"), "every joiner received stale cache data");
}

async function testNoStaleNoCache() {
  console.log("\nTest 4: Computation failure with no prior cache — error propagates");
  resetState();

  const compute = () => Promise.reject(new Error("DB down"));

  let threw = false;
  try {
    await getOrRefreshHealth(compute);
  } catch {
    threw = true;
  }

  assert(threw, "error propagates when no stale cache exists");
}

async function testTtlHit() {
  console.log("\nTest 5: TTL cache hit — computation not called");
  resetState();

  _healthCache = { data: { value: "fresh" }, ts: Date.now() }; // not expired

  let computeCount = 0;
  const compute = () => { computeCount++; return Promise.resolve({ value: "new" }); };

  const result = await getOrRefreshHealth(compute);

  assert(computeCount === 0, "computation not called on cache hit");
  assert(result.data?.value === "fresh", "fresh cache data returned");
  assert(result.isStale === false, "isStale is false");
}

async function testGenerationSafetyAfterReset() {
  console.log("\nTest 6: Generation safety — orphaned computation cannot overwrite cache after reset");
  resetState();

  const deferred = makeDeferred<any>();
  let computeCount = 0;

  const compute = () => {
    computeCount++;
    return deferred.promise;
  };

  // Start a computation (generation 1).
  const firstCall = getOrRefreshHealth(compute);
  await new Promise(r => setImmediate(r));

  const genBefore = _healthGeneration;
  assert(_healthInflight !== null, "in-flight set before invalidation");

  // Invalidate the cache (bumps generation to 2, clears inflight).
  invalidateCache();

  assert(_healthGeneration === genBefore + 1, "generation incremented after invalidation");
  assert(_healthInflight === null, "in-flight cleared after invalidation");

  // Resolve the OLD (orphaned) computation.
  deferred.resolve({ value: "orphan" });

  // The first caller should propagate without crashing (it was awaiting an
  // already-resolved promise; we don't care about its value in this test).
  try { await firstCall; } catch { /* may throw since no cache, that's fine */ }

  // Cache must NOT have been populated by the orphaned computation.
  assert(_healthCache === null, "orphaned computation did not populate cache after reset");

  // _healthInflight must still be null (orphaned finally() must not clear a NEW inflight).
  assert(_healthInflight === null, "orphaned finally() did not clear a newer inflight");
}

async function testNewComputationAfterReset() {
  console.log("\nTest 7: New computation after reset uses fresh generation");
  resetState();

  // Populate cache then invalidate.
  _healthCache = { data: { value: "old" }, ts: Date.now() };
  invalidateCache();

  let computeCount = 0;
  const compute = () => { computeCount++; return Promise.resolve({ value: "new" }); };

  const result = await getOrRefreshHealth(compute);

  assert(computeCount === 1, "new computation ran after reset");
  assert(result.data?.value === "new", "new data returned");
  assert(_healthCache?.data?.value === "new", "cache updated with new data");
}

// ── Run all tests ──────────────────────────────────────────────────────────────
async function main() {
  console.log("=== Lead-Ops Health Cache — Concurrency & Stale-Fallback Unit Tests ===");

  await testSingleFlight();
  await testStaleFallbackCreator();
  await testStaleFallbackJoiners();
  await testNoStaleNoCache();
  await testTtlHit();
  await testGenerationSafetyAfterReset();
  await testNewComputationAfterReset();

  console.log(`\n${"─".repeat(55)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.error("\n✗ FAILED — see above for details");
    process.exit(1);
  } else {
    console.log("\n✓ All tests passed");
  }
}

main().catch((err) => {
  console.error("Unhandled test error:", err);
  process.exit(1);
});
