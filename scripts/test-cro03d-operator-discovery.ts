/**
 * Genuinely static tests for the CRO-03D operator discovery tool.
 *
 * Every dependency (git, db, pause authority) is injected as a deterministic
 * mock — this test never touches a live database, git checkout, or network,
 * so it is safe and reliable in CI and cannot itself perform provider I/O.
 *
 * Proves:
 *  1. Structural no-provider-I/O: the module source never imports fetch/undici
 *     or any provider client.
 *  2. No secret VALUE (only presence booleans) ever appears in the report.
 *  3. Readiness/gate derivation is correct across clean, dirty, migration
 *     hash absent/present-among-many-unrelated-rows, unpaused, and
 *     existing-singleton scenarios (fail-closed).
 *  4. Singleton section never leaks membership/command internals.
 *  5. An unhandled dependency failure fails closed AND is redacted (no raw
 *     driver/exception text reaches the report).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  runCro03dDiscovery,
  requiredMigrationHash,
  type Cro03dDiscoveryDeps,
} from "./cro03d-operator-discovery";

const FAKE_SECRET_VALUE = "sk-test-live-secret-should-never-leak-9f81c2";
const SENSITIVE_ERROR_TEXT = "connection refused to postgres://admin:hunter2@internal-db-host:5432/prod";

function baseDeps(overrides: Partial<Cro03dDiscoveryDeps> = {}): Cro03dDiscoveryDeps {
  const expectedHash = requiredMigrationHash();
  // Simulate a ledger with many unrelated rows (baseline/guarded/duplicate-like
  // hashes) that must NOT satisfy the check on their own — only an exact
  // content-hash match may.
  const unrelatedLedgerHashes = new Set([
    "0".repeat(64), "1".repeat(64), "2".repeat(64), "3".repeat(64), "4".repeat(64),
  ]);
  return {
    getReleaseIdentity: () => ({ sha: "a".repeat(40), tree: "b".repeat(40), dirty: false }),
    getEnv: () => ({
      SERPER_API_KEY: FAKE_SECRET_VALUE,
      OUTSCRAPER_API_KEY: FAKE_SECRET_VALUE,
      AI_INTEGRATIONS_OPENAI_API_KEY: FAKE_SECRET_VALUE,
      APOLLO_API_KEY: FAKE_SECRET_VALUE,
      ZEROBOUNCE_API_KEY: FAKE_SECRET_VALUE,
    }) as unknown as NodeJS.ProcessEnv,
    hasMigrationHash: async (hash: string) => hash === expectedHash || unrelatedLedgerHashes.has(hash),
    getPauseState: async () => ({ state: "paused", source: "database" }),
    getSingletonRow: async () => null,
    ...overrides,
  };
}

async function testStructuralNoProviderIO() {
  const source = readFileSync(new URL("./cro03d-operator-discovery.ts", import.meta.url), "utf8");
  const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line) || /await\s+import\(/.test(line));
  assert.ok(!/from\s+["']undici["']/.test(source), "must not import undici");
  assert.ok(!/\bfetch\(/.test(source), "must not call fetch directly");
  const forbiddenModulePattern = /live-provider-executors|sdr\/apollo|sdr\/outscraper|serper-gateway|zerobounce-campaign-worker|sdr\/zerobounce/i;
  for (const line of importLines) {
    assert.ok(!forbiddenModulePattern.test(line), `must not import any provider client module (found: ${line.trim()})`);
  }
}

async function testHappyPathAllClear() {
  const report = await runCro03dDiscovery(baseDeps());
  assert.equal(report.noLiveIO, true);
  assert.equal(report.ready.cleanTree, true);
  assert.equal(report.ready.migrationReadable, true);
  assert.equal(report.ready.migrationHeadMatches, true);
  assert.equal(report.ready.pausedAsRequired, true);
  assert.equal(report.ready.singletonAbsent, true);
  assert.equal(report.ready.noMissingSecrets, true);
}

async function testDirtyTreeBlocks() {
  const report = await runCro03dDiscovery(baseDeps({
    getReleaseIdentity: () => ({ sha: "a".repeat(40), tree: "b".repeat(40), dirty: true }),
  }));
  assert.equal(report.ready.cleanTree, false, "dirty tree must not read as clean");
}

async function testMigrationHashAbsentAmongManyUnrelatedRowsBlocks() {
  // A ledger with a large row count, baseline-consolidated rows, and guarded
  // hashes — but crucially, NOT the exact CRO-03C head hash — must block.
  // This is exactly the false-positive the earlier count/position heuristic
  // was vulnerable to.
  const report = await runCro03dDiscovery(baseDeps({
    hasMigrationHash: async (hash: string) => {
      const unrelated = new Set(Array.from({ length: 500 }, (_, i) => String(i).padStart(64, "0")));
      return unrelated.has(hash); // never true for the real expected hash
    },
  }));
  assert.equal(report.migration.readable, true, "read succeeded");
  assert.equal(report.migration.matches, false);
  assert.equal(report.ready.migrationHeadMatches, false, "a ledger missing the exact CRO-03C hash must block, regardless of row count");
}

async function testMigrationHashPresentMatches() {
  const report = await runCro03dDiscovery(baseDeps());
  assert.equal(report.migration.expectedHash, requiredMigrationHash());
  assert.equal(report.migration.matches, true, "the exact expected hash being present must pass");
}

async function testUnpausedBlocks() {
  const report = await runCro03dDiscovery(baseDeps({
    getPauseState: async () => ({ state: "unpaused", source: "database" }),
  }));
  assert.equal(report.ready.pausedAsRequired, false, "non-paused state must block readiness");
}

async function testExistingSingletonBlocks() {
  const report = await runCro03dDiscovery(baseDeps({
    getSingletonRow: async () => ({ state: "consumed" }),
  }));
  assert.equal(report.singleton.exists, true);
  assert.equal(report.ready.singletonAbsent, false, "an existing singleton row must block readiness");
  assert.ok(
    !("members" in report.singleton) && !("commandId" in report.singleton) && !("membershipHash" in report.singleton),
    "singleton section must never expose membership/command internals",
  );
}

async function testMissingSecretSurfacedNotLeaked() {
  const report = await runCro03dDiscovery(baseDeps({
    getEnv: () => ({}) as unknown as NodeJS.ProcessEnv,
  }));
  assert.equal(report.ready.noMissingSecrets, false);
  assert.ok(report.missingSecretsByProvider.some((m) => m.provider === "apollo" && m.missing.includes("APOLLO_API_KEY")));
}

async function testNoSecretValueLeak() {
  const report = await runCro03dDiscovery(baseDeps());
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes(FAKE_SECRET_VALUE), "secret value must never appear in the discovery report");
  assert.ok(!/["']?(sk-|Bearer\s)/i.test(serialized), "report must not contain raw credential-shaped strings");
}

async function testDependencyFailureFailsClosedAndRedacted() {
  const report = await runCro03dDiscovery(baseDeps({
    hasMigrationHash: async () => { throw new Error(SENSITIVE_ERROR_TEXT); },
    getPauseState: async () => { throw new Error(SENSITIVE_ERROR_TEXT); },
    getSingletonRow: async () => { throw new Error(SENSITIVE_ERROR_TEXT); },
  }));
  // Must fail closed (never silently report success)...
  assert.equal(report.migration.readable, false);
  assert.equal(report.ready.migrationHeadMatches, false);
  assert.equal(report.pause.readable, false);
  assert.equal(report.ready.pausedAsRequired, false);
  assert.equal(report.singleton.readable, false);
  assert.equal(report.ready.singletonAbsent, false);
  // ...and must never leak the raw exception text anywhere in the report.
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes(SENSITIVE_ERROR_TEXT), "raw exception text (which can carry connection strings/hostnames) must never appear in the report");
  assert.ok(!serialized.includes("hunter2"), "credential fragments from a caught error must never leak");
}

async function main() {
  await testStructuralNoProviderIO();
  await testHappyPathAllClear();
  await testDirtyTreeBlocks();
  await testMigrationHashAbsentAmongManyUnrelatedRowsBlocks();
  await testMigrationHashPresentMatches();
  await testUnpausedBlocks();
  await testExistingSingletonBlocks();
  await testMissingSecretSurfacedNotLeaked();
  await testNoSecretValueLeak();
  await testDependencyFailureFailsClosedAndRedacted();
  console.log("CRO03D_DISCOVERY_TEST: PASS (10/10 static, deterministic, no live I/O)");
}

main().catch((err) => {
  console.error("CRO03D_DISCOVERY_TEST: FAIL", err);
  process.exitCode = 1;
});
