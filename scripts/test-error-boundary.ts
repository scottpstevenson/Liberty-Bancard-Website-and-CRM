#!/usr/bin/env tsx
/**
 * ErrorBoundary chunk-reload guard logic tests
 *
 * Tests all 6 required cases for the auto-reload-on-chunk-error feature:
 *   1. First chunk error → guard written + reload triggered
 *   2. Chunk error with recent guard → no reload, fallback would render
 *   3. Expired guard → reload may fire again
 *   4. Non-chunk error → no reload triggered
 *   5. sessionStorage.getItem throws → no reload (can't safely guard)
 *   6. sessionStorage.setItem throws → no reload (guard not persisted)
 *
 * Exit code: 0 = all pass, 1 = any fail
 *
 * Run: npx tsx scripts/test-error-boundary.ts
 */

const CHUNK_RELOAD_KEY = "chunk_reload_attempted";
const CHUNK_RELOAD_EXPIRY_MS = 60_000;

function isChunkLoadError(error: { name: string; message: string }): boolean {
  return (
    error.name === "ChunkLoadError" ||
    /loading chunk \d+ failed/i.test(error.message) ||
    /failed to fetch dynamically imported module/i.test(error.message) ||
    /importing a module script failed/i.test(error.message)
  );
}

type GuardStatus =
  | { ok: true; isRecent: true }
  | { ok: true; isRecent: false }
  | { ok: false };

type MockStorage = {
  data: Record<string, string>;
  getThrows?: boolean;
  setThrows?: boolean;
};

function readReloadGuardWith(storage: MockStorage, now: number): GuardStatus {
  try {
    if (storage.getThrows) throw new Error("Storage restricted");
    const raw = storage.data[CHUNK_RELOAD_KEY] ?? null;
    if (!raw) return { ok: true, isRecent: false };
    const parsed = JSON.parse(raw) as { attemptedAt?: unknown };
    if (typeof parsed.attemptedAt !== "number") return { ok: true, isRecent: false };
    const isRecent = now - parsed.attemptedAt < CHUNK_RELOAD_EXPIRY_MS;
    return { ok: true, isRecent };
  } catch {
    return { ok: false };
  }
}

function writeReloadGuardWith(storage: MockStorage, now: number): boolean {
  try {
    if (storage.setThrows) throw new Error("Storage full");
    storage.data[CHUNK_RELOAD_KEY] = JSON.stringify({ attemptedAt: now });
    return true;
  } catch {
    return false;
  }
}

type DecisionResult = {
  reloaded: boolean;
  guardWritten: boolean;
};

function simulateComponentDidCatch(
  error: { name: string; message: string },
  storage: MockStorage,
  now: number
): DecisionResult {
  if (!isChunkLoadError(error)) {
    return { reloaded: false, guardWritten: false };
  }

  const guard = readReloadGuardWith(storage, now);

  if (!guard.ok) return { reloaded: false, guardWritten: false };
  if (guard.isRecent) return { reloaded: false, guardWritten: false };

  const wrote = writeReloadGuardWith(storage, now);
  if (!wrote) return { reloaded: false, guardWritten: false };

  return { reloaded: true, guardWritten: true };
}

const CHUNK_ERROR = { name: "ChunkLoadError", message: "loading chunk 42 failed." };
const FETCH_ERROR = { name: "TypeError", message: "Failed to fetch dynamically imported module: /assets/chunk-abc.js" };
const REGULAR_ERROR = { name: "TypeError", message: "Cannot read property 'foo' of undefined" };

const results: { name: string; pass: boolean; detail: string }[] = [];

function assert(name: string, condition: boolean, detail: string) {
  results.push({ name, pass: condition, detail });
  const icon = condition ? "✓" : "✗";
  console.log(`  ${icon} ${name}${condition ? "" : `\n      FAIL: ${detail}`}`);
}

const now = Date.now();

console.log("\n── ErrorBoundary chunk-reload guard tests ─────────────────────────────\n");

console.log("Case 1: First chunk error → guard written + reload triggered");
{
  const storage: MockStorage = { data: {} };
  const result = simulateComponentDidCatch(CHUNK_ERROR, storage, now);
  assert("Case 1a: reload triggered", result.reloaded, "expected reloaded=true");
  assert("Case 1b: guard written to storage", result.guardWritten, "expected guardWritten=true");
  const raw = storage.data[CHUNK_RELOAD_KEY];
  const parsed = raw ? (JSON.parse(raw) as { attemptedAt?: number }) : null;
  assert("Case 1c: guard has correct shape", typeof parsed?.attemptedAt === "number", "guard shape invalid");
}

console.log("\nCase 2: Chunk error with recent guard → no reload");
{
  const storage: MockStorage = {
    data: {
      [CHUNK_RELOAD_KEY]: JSON.stringify({ attemptedAt: now - 5_000 }),
    },
  };
  const result = simulateComponentDidCatch(CHUNK_ERROR, storage, now);
  assert("Case 2a: no reload", !result.reloaded, "expected reloaded=false");
  assert("Case 2b: guard not overwritten", !result.guardWritten, "expected guardWritten=false");
}

console.log("\nCase 3: Expired guard (>60s old) → reload fires again");
{
  const storage: MockStorage = {
    data: {
      [CHUNK_RELOAD_KEY]: JSON.stringify({ attemptedAt: now - 90_000 }),
    },
  };
  const result = simulateComponentDidCatch(CHUNK_ERROR, storage, now);
  assert("Case 3a: reload triggered", result.reloaded, "expected reloaded=true");
  assert("Case 3b: new guard written", result.guardWritten, "expected guardWritten=true");
  const raw = storage.data[CHUNK_RELOAD_KEY];
  const parsed = raw ? (JSON.parse(raw) as { attemptedAt?: number }) : null;
  assert(
    "Case 3c: new guard is recent",
    typeof parsed?.attemptedAt === "number" && now - parsed.attemptedAt < CHUNK_RELOAD_EXPIRY_MS,
    "new guard timestamp not recent"
  );
}

console.log("\nCase 4: Non-chunk error → no reload");
{
  const storage: MockStorage = { data: {} };
  const resultTypical = simulateComponentDidCatch(REGULAR_ERROR, storage, now);
  assert("Case 4a: no reload for generic error", !resultTypical.reloaded, "expected reloaded=false");
  const resultFetch = simulateComponentDidCatch(
    { name: "TypeError", message: "network error" },
    storage,
    now
  );
  assert("Case 4b: no reload for network error", !resultFetch.reloaded, "expected reloaded=false");
  assert("Case 4c: guard not written for non-chunk errors", Object.keys(storage.data).length === 0, "expected empty storage");
}

console.log("\nCase 5: sessionStorage.getItem throws → no reload, no loop");
{
  const storage: MockStorage = { data: {}, getThrows: true };
  const result = simulateComponentDidCatch(CHUNK_ERROR, storage, now);
  assert("Case 5a: no reload when getItem throws", !result.reloaded, "expected reloaded=false");
  assert("Case 5b: guard not written when getItem throws", !result.guardWritten, "expected guardWritten=false");
}

console.log("\nCase 6: sessionStorage.setItem throws → no reload");
{
  const storage: MockStorage = { data: {}, setThrows: true };
  const result = simulateComponentDidCatch(CHUNK_ERROR, storage, now);
  assert("Case 6a: no reload when setItem throws", !result.reloaded, "expected reloaded=false");
  assert("Case 6b: guard not in storage", !storage.data[CHUNK_RELOAD_KEY], "expected no guard key");
}

console.log("\nBonus: isChunkLoadError detector covers all patterns");
{
  assert(
    "ChunkLoadError name",
    isChunkLoadError({ name: "ChunkLoadError", message: "" }),
    "should detect ChunkLoadError by name"
  );
  assert(
    "loading chunk N failed",
    isChunkLoadError({ name: "Error", message: "loading chunk 5 failed." }),
    "should detect 'loading chunk N failed'"
  );
  assert(
    "failed to fetch dynamically imported module",
    isChunkLoadError(FETCH_ERROR),
    "should detect dynamic import failure"
  );
  assert(
    "importing a module script failed",
    isChunkLoadError({ name: "Error", message: "importing a module script failed." }),
    "should detect module script failure"
  );
  assert(
    "regular error is NOT chunk error",
    !isChunkLoadError(REGULAR_ERROR),
    "should NOT classify generic TypeError as chunk error"
  );
}

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
const total = results.length;

console.log(`\n── Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ""} ─────────────────────────────────\n`);

if (failed > 0) {
  console.error("FAILED cases:");
  results.filter((r) => !r.pass).forEach((r) => console.error(`  ✗ ${r.name}: ${r.detail}`));
  process.exit(1);
}

process.exit(0);
