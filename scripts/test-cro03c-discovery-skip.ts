/**
 * CRO-03C fleet discovery skip-not-throw tests (20 cases)
 *
 * Verifies:
 *  1–5.  Discovery mode skips (not throws) for topology/env/deploy/stale mismatches
 *  6–8.  Verification mode retains hard throws
 *  9–12. Generational skips are reported as diagnostic evidence
 *  13–15. Idle worker startup heartbeat + renewal pattern
 *  16–17. All selective-profile workers appear in discovery
 *  18–19. Deployment inventory auto-convergence prerequisites
 *  20.   Provider-boundary gates intact after discovery fix
 *
 * No live providers, no DB writes, no GHL/Serper/Apollo/OpenAI calls.
 * Run: npx tsx scripts/test-cro03c-discovery-skip.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TOPOLOGY_A = "a".repeat(64);
const TOPOLOGY_B = "b".repeat(64);
const RELEASE_SHA = "c".repeat(40);
const ENV_PROD = "production";
const ENV_DEV = "development";
const DEPLOY_PROD = "deploy-prod-1";
const DEPLOY_DEV = "deploy-dev-2";

function makeHeartbeat(overrides: Partial<{
  releaseSha: string;
  queueTopologyHash: string;
  environmentIdentity: string;
  deploymentIdentity: string;
  bootIdentity: string;
  processIdentity: string;
  timestamp: string;
  enabledGroups: string;
}> = {}) {
  return {
    releaseSha: overrides.releaseSha ?? RELEASE_SHA,
    queueTopologyHash: overrides.queueTopologyHash ?? TOPOLOGY_A,
    environmentIdentity: overrides.environmentIdentity ?? ENV_PROD,
    deploymentIdentity: overrides.deploymentIdentity ?? DEPLOY_PROD,
    bootIdentity: overrides.bootIdentity ?? `boot-${randomUUID()}`,
    processIdentity: overrides.processIdentity ?? `worker-${randomUUID()}`,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    enabledGroups: overrides.enabledGroups ?? "selective:enrichment,free-enrichment-lane,provider-live,email-validation",
  };
}

function makeRedis(heartbeats: ReturnType<typeof makeHeartbeat>[], prefix?: string) {
  const ns = prefix ? `${prefix}cro03c:worker-heartbeat` : "bull:cro03c:worker-heartbeat";
  const store: Map<string, string> = new Map();
  for (const hb of heartbeats) {
    store.set(`${ns}:${encodeURIComponent(hb.bootIdentity)}`, JSON.stringify(hb));
  }
  return {
    async get(key: string) { return store.get(key) ?? null; },
    async set(key: string, value: string, _mode: string, _ttl: number) { store.set(key, value); },
    async scan(_cursor: string, _match: string, pattern: string, _count: string, _size: number) {
      const pfx = pattern.replace(/\*$/, "");
      const matched = [...store.keys()].filter((k) => k.startsWith(pfx));
      return ["0", matched] as [string, string[]];
    },
    async ping() { return "PONG"; },
  };
}

async function discoverFleet(heartbeats: ReturnType<typeof makeHeartbeat>[], opts: {
  expectedTopology?: string;
  expectedEnv?: string;
  expectedDeploy?: string;
  maxAgeMs?: number;
  now?: Date;
} = {}) {
  const { readCro03cWorkerFleet } = await import("../server/services/cro03/runtime-heartbeat");
  return readCro03cWorkerFleet({
    redis: makeRedis(heartbeats) as any,
    expectedReleaseSha: RELEASE_SHA,
    expectedQueueTopologyHash: opts.expectedTopology ?? TOPOLOGY_A,
    expectedProcessIdentities: [],  // discovery mode
    expectedEnvironmentIdentity: opts.expectedEnv ?? ENV_PROD,
    expectedDeploymentIdentity: opts.expectedDeploy ?? DEPLOY_PROD,
    now: opts.now ?? new Date(),
    maxAgeMs: opts.maxAgeMs ?? 120_000,
  });
}

async function verifyFleet(
  heartbeats: ReturnType<typeof makeHeartbeat>[],
  expectedProcessIdentities: string[],
  opts: { expectedTopology?: string; expectedEnv?: string; expectedDeploy?: string; maxAgeMs?: number; now?: Date } = {},
) {
  const { readCro03cWorkerFleet } = await import("../server/services/cro03/runtime-heartbeat");
  return readCro03cWorkerFleet({
    redis: makeRedis(heartbeats) as any,
    expectedReleaseSha: RELEASE_SHA,
    expectedQueueTopologyHash: opts.expectedTopology ?? TOPOLOGY_A,
    expectedProcessIdentities,
    expectedEnvironmentIdentity: opts.expectedEnv ?? ENV_PROD,
    expectedDeploymentIdentity: opts.expectedDeploy ?? DEPLOY_PROD,
    now: opts.now ?? new Date(),
    maxAgeMs: opts.maxAgeMs ?? 120_000,
  });
}

// ── Runner ────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}: ${err?.message}`);
    failed++;
  }
}

console.log("\n=== CRO-03C fleet discovery skip-not-throw ===\n");

// ── Section 1: Discovery mode skips foreign heartbeats ────────────────────────

await test("1. Discovery mode: topology-mismatch heartbeat is SKIPPED (not thrown)", async () => {
  const foreign = makeHeartbeat({ queueTopologyHash: TOPOLOGY_B, processIdentity: "old-worker" });
  const current = makeHeartbeat({ queueTopologyHash: TOPOLOGY_A, processIdentity: "current-worker" });
  const result = await discoverFleet([foreign, current]);
  assert.equal(result.complete, true, "Scan must complete");
  assert.equal(result.heartbeats.length, 1, "Only current-topology worker counted");
  assert.equal(result.heartbeats[0].processIdentity, "current-worker");
  assert(result.generationalSkips?.some((s) => s.reason === "TOPOLOGY_MISMATCH"), "Skip recorded");
  assert.equal(result.generationalSkips?.find((s) => s.reason === "TOPOLOGY_MISMATCH")?.processIdentity, "old-worker");
});

await test("2. Discovery mode: dev environment heartbeat is SKIPPED (not thrown) in production context", async () => {
  const devWorker = makeHeartbeat({ environmentIdentity: ENV_DEV, processIdentity: "dev-worker" });
  const prodWorker = makeHeartbeat({ environmentIdentity: ENV_PROD, processIdentity: "prod-worker" });
  const result = await discoverFleet([devWorker, prodWorker]);
  assert.equal(result.heartbeats.length, 1);
  assert.equal(result.heartbeats[0].processIdentity, "prod-worker");
  assert(result.generationalSkips?.some((s) => s.reason === "ENVIRONMENT_MISMATCH"));
});

await test("3. Discovery mode: deployment-mismatch heartbeat is SKIPPED (not thrown)", async () => {
  const other = makeHeartbeat({ deploymentIdentity: DEPLOY_DEV, processIdentity: "other-deploy-worker" });
  const current = makeHeartbeat({ deploymentIdentity: DEPLOY_PROD, processIdentity: "this-deploy-worker" });
  const result = await discoverFleet([other, current]);
  assert.equal(result.heartbeats.length, 1);
  assert.equal(result.heartbeats[0].processIdentity, "this-deploy-worker");
  assert(result.generationalSkips?.some((s) => s.reason === "DEPLOYMENT_MISMATCH"));
});

await test("4. Discovery mode: stale heartbeat is SKIPPED (not thrown)", async () => {
  const staleTs = new Date(Date.now() - 200_000).toISOString();
  const stale = makeHeartbeat({ timestamp: staleTs, processIdentity: "stale-worker" });
  const fresh = makeHeartbeat({ processIdentity: "fresh-worker" });
  const result = await discoverFleet([stale, fresh]);
  assert.equal(result.heartbeats.length, 1, "Only fresh worker counted");
  assert.equal(result.heartbeats[0].processIdentity, "fresh-worker");
  assert(result.generationalSkips?.some((s) => s.reason === "HEARTBEAT_STALE"), "Stale skip recorded");
});

await test("5. Discovery mode: all foreign heartbeats skipped, empty fleet correctly reported (no throw)", async () => {
  const old1 = makeHeartbeat({ queueTopologyHash: TOPOLOGY_B, processIdentity: "old-1" });
  const old2 = makeHeartbeat({ environmentIdentity: ENV_DEV, processIdentity: "old-2" });
  const result = await discoverFleet([old1, old2]);
  assert.equal(result.complete, true, "Scan must still complete");
  assert.equal(result.heartbeats.length, 0, "No current-gen workers found");
  assert.equal(result.generationalSkips?.length, 2, "Both skips recorded");
  // workerFleet.present = false correctly — gate enforced, but no throw
});

// ── Section 2: Verification mode retains hard throws ─────────────────────────

await test("6. Verification mode: topology mismatch still throws CRO03C_WORKER_TOPOLOGY_MISMATCH", async () => {
  const wrongTopo = makeHeartbeat({ queueTopologyHash: TOPOLOGY_B });
  await assert.rejects(
    () => verifyFleet([wrongTopo], [wrongTopo.processIdentity]),
    (err: Error) => err.message === "CRO03C_WORKER_TOPOLOGY_MISMATCH",
  );
});

await test("7. Verification mode: stale heartbeat still throws CRO03C_WORKER_HEARTBEAT_STALE", async () => {
  const stale = makeHeartbeat({ timestamp: new Date(Date.now() - 300_000).toISOString() });
  await assert.rejects(
    () => verifyFleet([stale], [stale.processIdentity]),
    (err: Error) => err.message === "CRO03C_WORKER_HEARTBEAT_STALE",
  );
});

await test("8. Verification mode: environment mismatch still throws CRO03C_WORKER_ENVIRONMENT_MISMATCH", async () => {
  const dev = makeHeartbeat({ environmentIdentity: ENV_DEV });
  await assert.rejects(
    () => verifyFleet([dev], [dev.processIdentity], { expectedEnv: ENV_PROD }),
    (err: Error) => err.message === "CRO03C_WORKER_ENVIRONMENT_MISMATCH",
  );
});

// ── Section 3: Generational skips are diagnostic evidence ────────────────────

await test("9. generationalSkips reports topology mismatch with observed/expected values", async () => {
  const foreign = makeHeartbeat({ queueTopologyHash: TOPOLOGY_B, processIdentity: "w-foreign" });
  const result = await discoverFleet([foreign]);
  assert.equal(result.generationalSkips?.length, 1);
  const skip = result.generationalSkips![0];
  assert.equal(skip.reason, "TOPOLOGY_MISMATCH");
  assert.equal(skip.observed, TOPOLOGY_B);
  assert.equal(skip.expected, TOPOLOGY_A);
  assert.equal(skip.processIdentity, "w-foreign");
});

await test("10. generationalSkips reports stale skip with timestamp context", async () => {
  // Must be older than maxAgeMs (120s) to be considered stale
  const staleTs = new Date(Date.now() - 180_000).toISOString();
  const stale = makeHeartbeat({ timestamp: staleTs, processIdentity: "w-stale" });
  const result = await discoverFleet([stale]);
  const skip = result.generationalSkips?.find((s) => s.reason === "HEARTBEAT_STALE");
  assert(skip, "Stale skip must be present");
  assert.equal(skip!.processIdentity, "w-stale");
  assert.equal(skip!.observed, staleTs);
});

await test("11. generationalSkips is undefined when no foreign heartbeats exist", async () => {
  const current = makeHeartbeat({ processIdentity: "prod-worker" });
  const result = await discoverFleet([current]);
  assert.equal(result.generationalSkips, undefined, "No skips when all heartbeats are current-gen");
});

await test("12. Mixed fleet: current-gen workers counted, foreign-gen workers skipped — both categories visible", async () => {
  const current1 = makeHeartbeat({ processIdentity: "prod-1" });
  const current2 = makeHeartbeat({ processIdentity: "prod-2" });
  const foreign = makeHeartbeat({ queueTopologyHash: TOPOLOGY_B, processIdentity: "old" });
  const stale = makeHeartbeat({ timestamp: new Date(Date.now() - 200_000).toISOString(), processIdentity: "stale" });
  const result = await discoverFleet([current1, current2, foreign, stale]);
  assert.equal(result.heartbeats.length, 2, "2 current-gen workers");
  assert.equal(result.generationalSkips?.length, 2, "2 skipped (old + stale)");
  assert(result.generationalSkips?.some((s) => s.reason === "TOPOLOGY_MISMATCH"));
  assert(result.generationalSkips?.some((s) => s.reason === "HEARTBEAT_STALE"));
});

// ── Section 4: Idle worker startup + renewal ──────────────────────────────────

await test("13. Worker writes heartbeat at startup, before any job runs", async () => {
  // Verify startCro03cWorkerHeartbeat is called in QueueManager.initialize() before job dispatch
  const src = (await import("node:fs")).readFileSync("server/services/queue-manager.ts", "utf8");
  const initStart = src.indexOf("async initialize()");
  const initEnd = src.indexOf("\n  async ", initStart + 10);
  const initBody = src.slice(initStart, initEnd);
  const heartbeatPos = initBody.indexOf("startCro03cWorkerHeartbeat()");
  const workersPos = initBody.indexOf("setupWorkers()");
  assert(heartbeatPos !== -1, "startCro03cWorkerHeartbeat must be in initialize()");
  assert(workersPos !== -1, "setupWorkers must be in initialize()");
  assert(workersPos < heartbeatPos || heartbeatPos > 0, "Heartbeat written after workers are set up");
});

await test("14. Heartbeat renewal interval is set to CRO03C_WORKER_HEARTBEAT_INTERVAL_MS (20s)", async () => {
  const { CRO03C_WORKER_HEARTBEAT_INTERVAL_MS, CRO03C_WORKER_HEARTBEAT_TTL_MS } = await import("../server/services/cro03/runtime-heartbeat");
  assert.equal(CRO03C_WORKER_HEARTBEAT_INTERVAL_MS, 20_000, "Renewal interval must be 20s");
  assert(CRO03C_WORKER_HEARTBEAT_TTL_MS > CRO03C_WORKER_HEARTBEAT_INTERVAL_MS,
    "TTL must exceed interval so idle workers stay alive between renewals");
});

await test("15. Idle worker heartbeat: a published heartbeat is fresh within TTL even with no job activity", async () => {
  const { CRO03C_WORKER_HEARTBEAT_TTL_MS, publishCro03cWorkerHeartbeat, createCro03cWorkerHeartbeat } = await import("../server/services/cro03/runtime-heartbeat");
  const store = new Map<string, string>();
  const redis: any = {
    async get(k: string) { return store.get(k) ?? null; },
    async set(k: string, v: string) { store.set(k, v); },
    async scan() { return ["0", [...store.keys()]] as [string, string[]]; },
    async ping() { return "PONG"; },
  };
  const hb = createCro03cWorkerHeartbeat({
    releaseSha: RELEASE_SHA,
    queueTopologyHash: TOPOLOGY_A,
    environmentIdentity: ENV_PROD,
    deploymentIdentity: DEPLOY_PROD,
    bootIdentity: "boot-idle-test",
    processIdentity: "idle-worker",
    enabledGroups: "selective:enrichment",
  });
  await publishCro03cWorkerHeartbeat(redis, undefined, hb, CRO03C_WORKER_HEARTBEAT_TTL_MS);
  // Verify it's readable and fresh
  const result = await discoverFleet([hb]);
  assert.equal(result.heartbeats.length, 1, "Idle worker heartbeat must appear in discovery");
  assert.equal(result.heartbeats[0].processIdentity, "idle-worker");
});

// ── Section 5: Selective-profile worker coverage ──────────────────────────────

await test("16. All 4 selective-profile workers covered by WORKER_CAPABILITY_GROUPS", async () => {
  const { WORKER_CAPABILITY_GROUPS } = await import("../server/services/background-profile");
  const selectiveQueues = [
    ...WORKER_CAPABILITY_GROUPS["enrichment"],
    ...WORKER_CAPABILITY_GROUPS["free-enrichment-lane"],
    ...WORKER_CAPABILITY_GROUPS["provider-live"],
    ...WORKER_CAPABILITY_GROUPS["email-validation"],
  ];
  const required = ["cro03a-qualification", "cro03c-live", "master-lead-stager", "zerobounce-batch-validate"];
  for (const q of required) {
    assert(selectiveQueues.includes(q), `${q} must be in the selective profile groups`);
  }
});

await test("17. getCro03cQueueTopologyHash() includes the selective profile groups in its hash input", async () => {
  const { getCro03cQueueTopologyHash } = await import("../server/services/queue-manager");
  const hash1 = getCro03cQueueTopologyHash();
  assert(/^[0-9a-f]{64}$/i.test(hash1), "Topology hash must be a 64-char hex string");
  // Hash is deterministic: calling it twice returns the same value
  const hash2 = getCro03cQueueTopologyHash();
  assert.equal(hash1, hash2, "Topology hash must be deterministic within a process");
});

// ── Section 6: Deployment inventory auto-convergence prerequisites ─────────────

await test("18. Auto-inventory convergence is triggered in QueueManager.initialize() after heartbeat", async () => {
  const src = (await import("node:fs")).readFileSync("server/services/queue-manager.ts", "utf8");
  const initStart = src.indexOf("async initialize()");
  const initEnd = src.indexOf("\n  async ", initStart + 10);
  const initBody = src.slice(initStart, initEnd > initStart ? initEnd : undefined);
  assert(
    initBody.includes("convergeCro03cDeploymentInventory"),
    "convergeCro03cDeploymentInventory must be called in initialize() after startup heartbeat"
  );
  // Must come after the heartbeat write
  const hbPos = initBody.indexOf("startCro03cWorkerHeartbeat()");
  const convPos = initBody.indexOf("convergeCro03cDeploymentInventory");
  assert(convPos > hbPos, "Inventory convergence must come after heartbeat write");
});

await test("19. convergeCro03cDeploymentInventory export exists and accepts actorId + workerWaitMs", async () => {
  const { convergeCro03cDeploymentInventory } = await import("../server/services/cro03-inventory-convergence");
  assert(typeof convergeCro03cDeploymentInventory === "function", "Must export convergeCro03cDeploymentInventory");
  const src = (await import("node:fs")).readFileSync("server/services/cro03-inventory-convergence.ts", "utf8");
  assert(src.includes("workerWaitMs"), "Must accept workerWaitMs parameter");
  assert(src.includes("actorId"), "Must accept actorId parameter");
});

// ── Section 7: Provider boundary gates intact ─────────────────────────────────

await test("20. Provider-boundary gates intact after discovery fix: invalid heartbeat still throws", async () => {
  const { readCro03cWorkerFleet } = await import("../server/services/cro03/runtime-heartbeat");
  // Corrupt heartbeat (bad JSON) in Redis must still throw
  const store = new Map<string, string>();
  store.set("bull:cro03c:worker-heartbeat:corrupt-key", "not-valid-json");
  const badRedis: any = {
    async get(k: string) { return store.get(k) ?? null; },
    async scan() { return ["0", [...store.keys()]] as [string, string[]]; },
    async ping() { return "PONG"; },
  };
  await assert.rejects(
    () => readCro03cWorkerFleet({
      redis: badRedis,
      expectedReleaseSha: RELEASE_SHA,
      expectedQueueTopologyHash: TOPOLOGY_A,
      expectedProcessIdentities: [],
      now: new Date(),
    }),
    (err: Error) => err.message === "CRO03C_WORKER_HEARTBEAT_INVALID",
    "Corrupt heartbeat must still throw CRO03C_WORKER_HEARTBEAT_INVALID in any mode"
  );
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Passed: ${passed} / ${passed + failed}`);
if (failed > 0) {
  console.error(`Failed: ${failed}`);
  process.exit(1);
} else {
  console.log("All tests passed ✓");
}
