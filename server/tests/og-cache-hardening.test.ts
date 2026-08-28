/**
 * OG disk-cache filesystem-boundary regression test.
 *
 * Run with:
 *   npx tsx server/tests/og-cache-hardening.test.ts
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ogCacheTestHooks } from "../routes/og";

let failed = 0;
let testRoot = "";

function assert(condition: boolean, label: string): void {
  if (condition) console.log(`  ✓  ${label}`);
  else {
    console.error(`  ✗  ${label}`);
    failed++;
  }
}

function tempArtifacts(key: string): string[] {
  return fs.readdirSync(testRoot).filter(name => name.startsWith(`.${key}.`) && name.endsWith(".tmp"));
}

function run(): void {
  console.log("\n=== OG Cache Hardening Tests ===\n");
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "og-cache-hardening-"));
  fs.chmodSync(testRoot, 0o700);
  ogCacheTestHooks.setCacheDirForTest(testRoot);

  const key = ogCacheTestHooks.cacheKey("default", `og-cache-test-${crypto.randomUUID()}`, "test");
  assert(/^[a-f0-9]{64}$/.test(key), "cache keys use the complete SHA-256 digest");
  assert(
    ogCacheTestHooks.cacheKey("default", "a|b", "c") !==
      ogCacheTestHooks.cacheKey("default", "a", "b|c"),
    "structured key inputs contain delimiter collisions",
  );
  assert(ogCacheTestHooks.writeCached(key, "svg", Buffer.from("complete-cache-entry")), "writes cache entry");
  assert(ogCacheTestHooks.readCached(key, "svg")?.toString() === "complete-cache-entry", "reads regular cache entries");
  assert(ogCacheTestHooks.readCached("../not-a-cache-key", "svg") === null, "rejects traversal keys");
  assert(!ogCacheTestHooks.writeCached(key, "tmp" as "svg", Buffer.from("x")), "rejects non-allowlisted extensions");

  const external = path.join(testRoot, "external-content");
  const hardKey = ogCacheTestHooks.cacheKey("default", `hard-link-${crypto.randomUUID()}`);
  const hardPath = path.join(testRoot, `${hardKey}.svg`);
  fs.writeFileSync(external, "outside-cache", { mode: 0o600 });
  fs.linkSync(external, hardPath);
  assert(ogCacheTestHooks.readCached(hardKey, "svg") === null, "rejects hard-linked cache files");
  assert(!ogCacheTestHooks.writeCached(hardKey, "svg", Buffer.from("replacement")), "does not overwrite existing hard links");
  assert(fs.readFileSync(external, "utf8") === "outside-cache", "preserves external hard-link content");
  assert(tempArtifacts(hardKey).length === 0, "cleans temp file after failed publication");

  const concurrentKey = ogCacheTestHooks.cacheKey("default", `concurrent-${crypto.randomUUID()}`);
  const attempts = Array.from({ length: 12 }, (_, i) => ({
    payload: Buffer.from(`writer-${i}`),
    wrote: false,
  }));
  // These operations model competing event-loop callers. link publication
  // permits exactly one writer and readers only observe a complete artifact.
  for (const attempt of attempts) {
    attempt.wrote = ogCacheTestHooks.writeCached(concurrentKey, "png", attempt.payload);
    const read = ogCacheTestHooks.readCached(concurrentKey, "png");
    assert(read === null || attempts.some(item => item.payload.equals(read)), "concurrent reader sees only complete writer data");
  }
  assert(attempts.filter(attempt => attempt.wrote).length === 1, "concurrent publication has one winner");
  assert(tempArtifacts(concurrentKey).length === 0, "concurrent publication cleans all temp files");

  const realRoot = testRoot;
  const symlinkRoot = `${testRoot}-symlink`;
  fs.symlinkSync(realRoot, symlinkRoot);
  ogCacheTestHooks.setCacheDirForTest(symlinkRoot);
  assert(ogCacheTestHooks.readCached(key, "svg") === null, "rejects a symlink cache root");
  assert(!ogCacheTestHooks.writeCached(key, "svg", Buffer.from("x")), "does not write through a symlink cache root");
  ogCacheTestHooks.setCacheDirForTest(realRoot);

  console.log(`\nPassed: ${failed === 0 ? "all" : "with failures"}`);
  if (failed) process.exitCode = 1;
}

try {
  run();
} finally {
  if (testRoot) fs.rmSync(testRoot, { recursive: true, force: true });
  if (testRoot) fs.rmSync(`${testRoot}-symlink`, { force: true });
}