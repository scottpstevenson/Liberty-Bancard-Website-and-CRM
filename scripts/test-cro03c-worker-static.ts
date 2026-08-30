import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CRO03C_MAX_INITIAL_HANDOFFS,
  assertCro03cLiveContext,
  assertCro03cRuntimeAttestation,
  planCro03cEvidenceStages,
} from "../server/services/cro03/live-execution";
import { SafeEgress } from "../server/services/cro03/safe-egress";
import {
  createCro03cWorkerHeartbeat,
  publishCro03cWorkerHeartbeat,
  readCro03cWorkerFleet,
  type Cro03cHeartbeatRedis,
} from "../server/services/cro03/runtime-heartbeat";

const source = (path: string) => readFileSync(path, "utf8");
const mustReject = async (operation: Promise<unknown>, code: string) => {
  await assert.rejects(operation, (error: any) => error?.message === code);
};
const mustThrow = (operation: () => unknown, code: string) => {
  assert.throws(operation, (error: any) => error?.message === code);
};

class InjectedRedis implements Cro03cHeartbeatRedis {
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string, mode: "PX", ttlMs: number): Promise<void> {
    assert.equal(mode, "PX");
    this.values.set(key, value);
    this.ttls.set(key, ttlMs);
  }
  async scan(): Promise<[string, string[]]> {
    return ["0", [...this.values.keys()]];
  }
  async ping(): Promise<string> {
    return "PONG";
  }
}

async function assertObservedWorkerFleet(): Promise<void> {
  const now = new Date("2026-08-30T12:00:00.000Z");
  const redis = new InjectedRedis();
  const first = createCro03cWorkerHeartbeat({
    releaseSha: "a".repeat(40), queueTopologyHash: "b".repeat(64),
    processIdentity: "worker-a", bootIdentity: "boot-a", now,
  });
  const second = createCro03cWorkerHeartbeat({
    releaseSha: "a".repeat(40), queueTopologyHash: "b".repeat(64),
    processIdentity: "worker-b", bootIdentity: "boot-b", now,
  });
  await publishCro03cWorkerHeartbeat(redis, "ci:", first);
  await publishCro03cWorkerHeartbeat(redis, "ci:", second);
  assert.deepEqual([...redis.ttls.values()], [60_000, 60_000], "heartbeat keys must expire");
  const fleet = await readCro03cWorkerFleet({
    redis, prefix: "ci:", expectedReleaseSha: "a".repeat(40),
    expectedQueueTopologyHash: "b".repeat(64),
    expectedProcessIdentities: ["worker-a", "worker-b"], now,
  });
  assert.equal(fleet.complete, true);
  assert.deepEqual(fleet.heartbeats.map((entry) => entry.bootIdentity).sort(), ["boot-a", "boot-b"]);
  await mustReject(readCro03cWorkerFleet({
    redis, prefix: "ci:", expectedReleaseSha: "c".repeat(40),
    expectedQueueTopologyHash: "b".repeat(64), expectedProcessIdentities: ["worker-a", "worker-b"], now,
  }), "CRO03C_WORKER_RELEASE_MISMATCH");
  await mustReject(readCro03cWorkerFleet({
    redis, prefix: "ci:", expectedReleaseSha: "a".repeat(40),
    expectedQueueTopologyHash: "d".repeat(64), expectedProcessIdentities: ["worker-a", "worker-b"], now,
  }), "CRO03C_WORKER_TOPOLOGY_MISMATCH");
  await mustReject(readCro03cWorkerFleet({
    redis, prefix: "ci:", expectedReleaseSha: "a".repeat(40),
    expectedQueueTopologyHash: "b".repeat(64), expectedProcessIdentities: ["worker-a"], now,
  }), "CRO03C_WORKER_FLEET_SIZE_MISMATCH");

  let scans = 0;
  const exhausted: Cro03cHeartbeatRedis = {
    get: async () => null,
    set: async () => undefined,
    ping: async () => "PONG",
    scan: async () => [String(++scans), []],
  };
  assert.deepEqual(await readCro03cWorkerFleet({
    redis: exhausted, expectedReleaseSha: "a".repeat(40),
    expectedQueueTopologyHash: "b".repeat(64), expectedProcessIdentities: ["worker-a"],
    now, maxIterations: 2,
  }), { complete: false, heartbeats: [] });

  const failing: Cro03cHeartbeatRedis = {
    get: async () => null,
    set: async () => undefined,
    ping: async () => "PONG",
    scan: async () => { throw new Error("redis unavailable"); },
  };
  assert.deepEqual(await readCro03cWorkerFleet({
    redis: failing, expectedReleaseSha: "a".repeat(40),
    expectedQueueTopologyHash: "b".repeat(64), expectedProcessIdentities: ["worker-a"], now,
  }), { complete: false, heartbeats: [] });
}

async function assertSafeEgressBounds(): Promise<void> {
  const requests: string[] = [];
  const receiptHops: number[] = [];
  const bounded = new SafeEgress(
    async (url) => {
      requests.push(url);
      return new Response("four", { headers: { "content-type": "text/plain" } });
    },
    async () => ["93.184.216.34"],
    undefined,
    undefined,
    undefined,
    async (receipt) => receiptHops.push(receiptHops.length),
  );
  await mustReject(
    bounded.get({ url: "https://example.com/page", purpose: "test", callSite: "test", maxBytes: 3 }),
    "CRO03_EGRESS_RESPONSE_TOO_LARGE",
  );
  assert.deepEqual(requests, ["https://example.com/page"]);
  assert.deepEqual(receiptHops, [0], "rejected bodies must receive a zero-byte accounting receipt");

  let redirects = 0;
  const redirecting = new SafeEgress(
    async (url) => {
      redirects++;
      const step = new URL(url).pathname.match(/\d+$/)?.[0] ?? "0";
      return new Response("", {
        status: 302,
        headers: { location: `https://example.com/${Number(step) + 1}` },
      });
    },
    async () => ["93.184.216.34"],
  );
  await mustReject(
    redirecting.get({ url: "https://example.com/0", purpose: "test", callSite: "test" }),
    "CRO03_EGRESS_REDIRECT_LIMIT",
  );
  assert.equal(redirects, 4, "SafeEgress permits exactly three redirects (four pinned requests)");

  // Private answers are rejected before an adapter can observe a request.
  let ssrfRequests = 0;
  const ssrf = new SafeEgress(async () => {
    ssrfRequests++;
    return new Response("unexpected");
  }, async () => ["127.0.0.1"]);
  await mustReject(
    ssrf.get({ url: "https://attacker.example/", purpose: "test", callSite: "test" }),
    "CRO03_EGRESS_ADDRESS_DENIED",
  );
  assert.equal(ssrfRequests, 0, "SSRF DNS answers must fail before I/O");

  // A DNS answer is handed to the transport as the pinned connection. The
  // adapter has no hostname-only escape hatch that could re-resolve after
  // validation (the common DNS-rebinding failure mode).
  let pinned: readonly string[] | undefined;
  const rebinding = new SafeEgress(async (_url, _init, connection) => {
    pinned = connection.pinnedAddresses;
    return new Response("ok", { headers: { "content-type": "text/plain" } });
  }, async () => ["93.184.216.34"]);
  await rebinding.get({ url: "https://rebind.example/", purpose: "test", callSite: "test" });
  assert.deepEqual(pinned, ["93.184.216.34"]);

  const crossDomainRequests: string[] = [];
  const crossDomain = new SafeEgress(async (url) => {
    crossDomainRequests.push(url);
    return new Response("", { status: 302, headers: { location: "https://other.example/x" } });
  }, async () => ["93.184.216.34"]);
  await mustReject(
    crossDomain.get({
      url: "https://example.com/", purpose: "test", callSite: "test",
      sameRegistrableDomainAs: "example.com",
    }),
    "CRO03_EGRESS_REGISTRABLE_DOMAIN_DENIED",
  );
  assert.deepEqual(crossDomainRequests, ["https://example.com/"]);
}

async function main(): Promise<void> {
  await assertSafeEgressBounds();
  await assertObservedWorkerFleet();

  // Planning is pure: it uses frozen observation facts plus the command cap,
  // rather than treating recipe order as provider authority.  This fixture
  // also proves a skipped stage cannot become dispatchable merely because an
  // earlier stage appears in the recipe.
  const planningPrices = Object.fromEntries(Object.entries({
    internal_source: { unitType: "none", billingSemantics: "not_billable" },
    first_party_web: { unitType: "page", billingSemantics: "per_unit_no_result_free" },
    rdap: { unitType: "request", billingSemantics: "per_unit_no_result_free" },
    jsonld: { unitType: "parse", billingSemantics: "not_billable" },
    serper: { unitType: "request", billingSemantics: "per_unit_no_result_billable" },
    outscraper: { unitType: "result", billingSemantics: "per_unit_no_result_free" },
    openai: { unitType: "token", billingSemantics: "per_unit_no_result_billable" },
    apollo: { unitType: "result", billingSemantics: "per_unit_no_result_free" },
    zerobounce: { unitType: "request", billingSemantics: "per_unit_no_result_billable" },
  }).map(([provider, contract]) => [provider, {
    version: 1, ...contract, currency: "USD", amountMicros: contract.billingSemantics === "not_billable" ? 0 : 1,
  }])) as any;
  const plan = planCro03cEvidenceStages({
    payload: { businessName: "Fixture", website: "https://fixture.example", city: "Miami", state: "FL" },
    commandType: "micro_canary", caps: { provider: "first_party_web", maxUnits: 50, maxAmountMicros: 50 },
    pricing: planningPrices, source: { observation_id: "opaque-observation-ref", payload_hash: "e".repeat(64) },
  });
  assert.equal(plan.find((stage) => stage.stageKey === "public-web")?.disposition, "eligible");
  assert.equal(plan.find((stage) => stage.stageKey === "serper")?.disposition, "blocked_authority");
  assert.equal(plan.find((stage) => stage.stageKey === "openai")?.disposition, "skipped_sufficient_evidence");
  assert.equal(plan.filter((stage) => stage.disposition === "eligible").length, 1,
    "one command cap authorizes only one applicable provider stage");

  const now = new Date("2026-08-30T12:00:00.000Z");
  const attestation = {
    artifactSha: "a".repeat(40),
    migrationHead: "0196_cro03c_dispatch_reconciliation",
    deploymentIdentity: "production",
    environmentIdentity: "production",
    webBootIdentity: "web-1",
    workerBootIdentity: "worker-1",
    queueTopologyHash: "b".repeat(64),
    workerHeartbeatAt: now,
    capturedAt: now,
    dbHealthy: true,
    redisHealthy: true,
    expiresAt: new Date(now.getTime() + 60_000),
  };
  assertCro03cRuntimeAttestation(attestation, now, "capture");
  mustThrow(
    () => assertCro03cRuntimeAttestation({ ...attestation, workerHeartbeatAt: new Date(now.getTime() - 60_001) }, now, "capture"),
    "CRO03C_WORKER_HEARTBEAT_STALE",
  );
  assertCro03cRuntimeAttestation(
    { ...attestation, workerHeartbeatAt: new Date(now.getTime() - 60_001) },
    now,
    "later",
  );
  const context = {
    kind: "cro03c_live" as const, provider: "apollo" as const, activationRevision: 1,
    generationId: "generation", commandId: "command", runId: "run", stageKey: "apollo",
    claimToken: "claim", executionFence: 1, runtimeAttestationId: "attestation",
    expiresAt: new Date(Date.now() + 60_000), noOutboundSnapshotHash: "c".repeat(64),
    caller: "server/services/cro03/live-execution.ts",
  };
  assertCro03cLiveContext(context);
  mustThrow(() => assertCro03cLiveContext({ ...context, executionFence: 0 }), "CRO03C_CONTEXT_FENCE_INVALID");
  mustThrow(() => assertCro03cLiveContext({ ...context, caller: "server/routes/cro03.ts" }), "CRO03C_CONTEXT_INVALID");

  const live = source("server/services/cro03/live-execution.ts");
  const worker = source("server/services/cro03/live-worker.ts");
  const liveEgress = source("server/services/cro03/live-safe-egress.ts");
  const effectFence = source("server/services/cro03/cro03c-effect-fence.ts");
  const migration = source("migrations/0195_cro03c_live_activation_authority.sql");
  const opaqueInputMigration = source("migrations/0199_cro03c_opaque_stage_inputs.sql");
  const queues = source("server/services/queue-manager.ts");

  // CRO-03C has exactly one event-owned queue and a bounded recovery schedule.
  // Command creation can only obtain a producer; it cannot start a worker.
  assert.match(live, /transportEnabled: false/);
  assert.match(live, /getQueueManagerProducers\(\)\?\.getQueue\(QUEUE_NAMES\.CRO03C_LIVE\)/);
  assert.match(queues, /CRO03C_LIVE: "cro03c-live"/);
  assert.match(queues, /name: QUEUE_NAMES\.CRO03C_LIVE,\s*concurrency: 1, attempts: 3,[\s\S]*?repeatEveryMs: 0, jobName: "dispatch"/);
  assert.match(queues, /queueName: QUEUE_NAMES\.CRO03C_LIVE,\s*jobName: "recover"[\s\S]*?jobId: "cro03c-live-recovery-repeatable"/);
  assert.match(queues, /case QUEUE_NAMES\.CRO03C_LIVE:[\s\S]*?dispatchCro03cLive[\s\S]*?recoverCro03cLiveDispatches/);
  const manifest = source("server/services/logical-job-manifest.ts");
  assert.match(manifest, /logicalKey: "cro03c-live-dispatch"[\s\S]*?jobNamePattern: "dispatch"[\s\S]*?owner: "cro03\/live-worker\.dispatchCro03cLive"/);
  assert.match(manifest, /logicalKey: "cro03c-live-recovery"[\s\S]*?jobNamePattern: "recover"[\s\S]*?owner: "cro03\/live-worker\.recoverCro03cLiveDispatches"/);
  assert.match(queues, /startCro03cWorkerHeartbeat/);
  assert.match(live, /getSharedRedisClient\(\)/);
  assert.doesNotMatch(live, /new IORedis|from "ioredis"/);

  // Database selection is the ownership authority. A recovery/event race skips
  // locked rows and may only reclaim an expired running lease.
  assert.match(worker, /FOR UPDATE OF g,r,c SKIP LOCKED/);
  assert.match(worker, /g\.state='queued' OR \(g\.state='running' AND g\.lease_expires_at < NOW\(\)\)/);
  assert.match(worker, /SET state='running',claim_token=\$\{claimToken\}::uuid,[\s\S]*?lease_expires_at=NOW\(\)\+\(\$\{LEASE_SECONDS\} \* INTERVAL '1 second'\),[\s\S]*?execution_fence=g\.execution_fence\+1/);
  assert.match(worker, /UPDATE cro03c_runs r[\s\S]*?claim_token=\$\{claimToken\}::uuid,[\s\S]*?execution_fence=g\.execution_fence/);
  assert.match(worker, /NOT EXISTS \([\s\S]*?owned\.run_id=g\.run_id[\s\S]*?owned\.state='running'/);

  // Both lifecycle completion writes fence their claim token and generation.
  for (const table of ["cro03c_runs", "cro03c_generations"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}[\\s\\S]*?claim_token UUID[\\s\\S]*?execution_fence INTEGER NOT NULL DEFAULT 0[\\s\\S]*?lease_expires_at TIMESTAMPTZ`));
  }
  assert.match(worker, /claim_token=\$\{claim\.claim_token\}::uuid AND execution_fence=\$\{claim\.execution_fence\}/);
  assert.match(worker, /CRO03C_GENERATION_FENCE_LOST/);
  assert.match(worker, /CRO03C_RUN_FENCE_LOST/);
  assert.match(live, /String\(authority\.claim_token\) !== context\.claimToken/);
  assert.match(live, /Number\(authority\.execution_fence\) !== context\.executionFence/);

  // Request PII remains solely in the canonical source observation. Planning
  // stores an opaque reference and hashes; dispatch resolves it under lock.
  assert.doesNotMatch(live, /reason_code,frozen_input/);
  assert.doesNotMatch(worker, /stage\.frozen_input/);
  assert.match(worker, /JOIN cro03_source_observations o ON o\.id=r\.source_observation_id/);
  assert.match(worker, /FOR UPDATE OF o,g,d,r/);
  assert.match(worker, /hashCro03Evidence\(resolved\.payload\) !== resolved\.payload_hash/);
  assert.match(worker, /deriveCro03cProviderInput\(provider, resolved\.payload, schedule/);
  assert.match(opaqueInputMigration, /CHECK \(frozen_input = '\{\}'::jsonb\)/);
  assert.match(opaqueInputMigration, /source_observation_id UUID NOT NULL REFERENCES cro03_source_observations/);
  assert.doesNotMatch(opaqueInputMigration, /\b(?:website|address|email|phone|query)\b/);

  // Recovery is bounded and dispatch itself never schedules a successor job.
  assert.match(worker, /export const CRO03C_LIVE_RECOVERY_LIMIT = 25/);
  assert.match(worker, /while \(processed < limit\)[\s\S]*?await dispatchCro03cLive\(\)/);
  assert.doesNotMatch(worker, /\.(?:add|addBulk|repeat)\s*\(/);

  // An ineligible/skipped disposition fails before reserve can construct an
  // operation. Ambiguous dispatch/billing remains quarantined, never completed.
  assert.match(live, /await assertCro03cStageEligible\(input\.generationId, input\.stageKey\);[\s\S]*?INSERT INTO cro03c_stage_operations/);
  assert.match(live, /billingCertainty === "ambiguous" \|\| input\.billingCertainty === "unknown"\s*\?\s*"ambiguous"/);
  assert.match(live, /state=\$\{disposition === "ambiguous" \? "quarantined" : "completed"\}/);
  assert.match(live, /CRO03C_STAGE_NOT_ELIGIBLE/);

  // A reservation is not a transport fact. The worker can release only its
  // own fenced attempt if authority/control fails before the durable transport
  // marker; a throw after that marker is quarantined and cannot replay.
  const dispatchMigration = source("migrations/0202_cro03c_transport_invocation_checkpoint.sql");
  assert.match(worker, /transportMayHaveBeenInvoked = false/);
  assert.match(worker, /SET dispatch_state='dispatched',dispatched_at=NOW\(\),[\s\S]*?transport_may_have_been_invoked=TRUE/);
  assert.match(worker, /'transport_started'/);
  assert.match(worker, /if \(!durableDispatchUncertain\) \{[\s\S]*?confirmCro03cNotDispatched\(claim/);
  assert.match(worker, /dispatch_state='confirmed_not_dispatched',state='completed',[\s\S]*?terminal_disposition='released'/);
  assert.match(worker, /claim_token=\$\{claim\.claim_token\}::uuid AND execution_fence=\$\{claim\.execution_fence\}/);
  assert.match(worker, /SET dispatch_state='ambiguous',state='quarantined',reconciliation_required=TRUE/);
  assert.match(dispatchMigration, /transport_may_have_been_invoked BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(dispatchMigration, /'transport_started'/);
  assert.match(liveEgress, /await this\.options\.beforeTransportInvocation\?\.\(\);[\s\S]*?return await pinnedTransport/);

  // The initial cohort is a single, bounded membership: exactly ordinals 0..99.
  assert.equal(CRO03C_MAX_INITIAL_HANDOFFS, 100);
  assert.match(migration, /rollout_key TEXT PRIMARY KEY/);
  assert.match(migration, /PRIMARY KEY \(rollout_key, ordinal\)/);
  assert.match(migration, /ordinal BETWEEN 0 AND 99/);
  assert.match(live, /CRO03C_INITIAL_BATCH_SCOPE_INVALID/);

  // Initial continuation runs under an async-safe process-local deny fence.
  // Micro-canaries take the unfenced branch and cannot acquire an exception.
  assert.match(effectFence, /import \{ AsyncLocalStorage \} from "node:async_hooks"/);
  assert.match(effectFence, /const storage = new AsyncLocalStorage<Cro03cEffectFenceContext>\(\)/);
  assert.match(effectFence, /return storage\.run\(Object\.freeze\(\{ \.\.\.context \}\), work\)/);
  assert.match(worker, /if \(claim\.command_type === "initial_batch"\) \{[\s\S]*?progression = await withCro03cInitialBatchEffectFence\(\{[\s\S]*?commandId: claim\.command_id, runId: claim\.run_id,[\s\S]*?correlationId: claim\.effect_correlation_id, commandType: "initial_batch",[\s\S]*?\}, \(\) => dispatchClaim\(claim\)\);[\s\S]*?\} else \{\s*progression = await dispatchClaim\(claim\);/);
  assert.match(worker, /if \(progression !== "completed"\) return progression/);

  // Every linked attempt/effect is durably counted. Attempted effects fail even
  // when the boundary prevented the effect from becoming effective.
  assert.match(effectFence, /INSERT INTO cro03c_forbidden_effects[\s\S]*?\(command_id,run_id,effect_kind,correlation_id,attempted_count,effective_count,disposition,evidence_hash\)[\s\S]*?1,0,\$\{disposition\}/);
  assert.match(effectFence, /UPDATE cro03c_runs SET state='failed',stop_reason='cro03c_forbidden_effect_attempt',completed_at=NOW\(\)/);
  assert.match(effectFence, /throw new Error\(`CRO03C_FORBIDDEN_EFFECT_DENIED:\$\{effectKind\}`\)/);
  assert.match(worker, /SELECT COUNT\(\*\)::int AS n FROM cro03c_forbidden_effects[\s\S]*?WHERE command_id=\$\{claim\.command_id\}::uuid[\s\S]*?AND correlation_id=\$\{claim\.effect_correlation_id\}[\s\S]*?AND \(attempted_count > 0 OR effective_count > 0\)/);
  assert.match(live, /const disposition = linked && input\.attemptedCount > 0 \? "failed_run"[\s\S]*?input\.globalAnomaly \? "inconclusive"/);
  assert.match(live, /INSERT INTO cro03c_forbidden_effects[\s\S]*?\$\{input\.attemptedCount\},\$\{input\.effectiveCount\},\$\{disposition\}/);

  // Pre/post evidence is made from real global durable counters, not synthetic
  // zeros or a pause toggle.
  assert.match(effectFence, /invalidatePauseStateCache\(\);[\s\S]*?const pause = await getPauseState\(\)/);
  for (const counterSource of [
    /FROM contacts WHERE ghl_contact_id IS NOT NULL/,
    /FROM campaigns/,
    /FROM sequence_enrollments/,
    /FROM outbound_messages WHERE channel='email'/,
    /FROM outbound_messages WHERE channel='sms'/,
    /FROM outbound_messages WHERE channel IN \('rvm','voice','voicemail'\)/,
    /FROM email_logs/,
  ]) {
    assert.match(effectFence, counterSource);
  }
  assert.match(live, /const counters = await readCro03cGlobalNoOutboundCounters\(\);[\s\S]*?INSERT INTO cro03c_no_outbound_snapshots[\s\S]*?'pre_run'/);
  assert.match(worker, /const post = await readCro03cGlobalNoOutboundCounters\(\);[\s\S]*?classifyCro03cNoOutboundSnapshots\(pre, post, Number\(linked\?\.n \?\? 0\) > 0\)/);
  assert.match(worker, /createCro03cNoOutboundSnapshot\(\{[\s\S]*?phase: "post_run",[\s\S]*?counters: post/);

  // Linked activity fails; unrelated global movement is inconclusive. Neither
  // disposition can be represented or terminalized as a clean completion.
  assert.match(worker, /if \(snapshotDisposition === "failed"\) throw new Error\("CRO03C_LINKED_FORBIDDEN_EFFECT"\)/);
  assert.match(worker, /if \(snapshotDisposition === "inconclusive"\) throw new Error\("CRO03C_GLOBAL_OUTBOUND_MOVEMENT_INCONCLUSIVE"\)/);
  assert.match(live, /UPDATE cro03c_runs SET state=\$\{disposition === "failed_run" \? "failed" : "inconclusive_pending_reconciliation"\}/);
  assert.match(live, /WHERE id=\$\{input\.runId \?\? null\}::uuid AND state IN \('queued','claimed','running'\)/);
  assert.match(worker, /const terminal = reconciliation \? "inconclusive_pending_reconciliation" : summary\?\.failed \? "failed" : "completed"/);

  // The live crawl admits an explicitly approved homepage plus at most four
  // additional same-site pages. Every actual pinned transport hop rechecks
  // authority and has a durable operation ownership proof.
  assert.match(liveEgress, /const MAX_ADDITIONAL_PAGES = 4/);
  assert.match(liveEgress, /if \(request\.approvedPageUrls\.length > MAX_ADDITIONAL_PAGES\)/);
  assert.match(liveEgress, /if \(canonicalAdditional\.length > MAX_ADDITIONAL_PAGES\)/);
  assert.match(liveEgress, /CRO03C_CRAWL_INPUT_NOT_FROZEN/);
  assert.match(liveEgress, /sameRegistrableDomainAs: homepage\.hostname, respectRobots: true,[\s\S]*?maxBytes: 512 \* 1024/);
  assert.match(liveEgress, /await assertCro03cAuthorityBeforeIo\(this\.options\.context\);[\s\S]*?await this\.options\.limiter\.consume/);
  assert.match(liveEgress, /INSERT INTO cro03c_domain_request_limits/);
  assert.match(liveEgress, /CRO03C_CRAWL_RATE_LIMITED/);
  assert.match(liveEgress, /catch \(error\) \{[\s\S]*?this\.receipts\.record\(\{ url, hostname: connection\.hostname, pinnedAddresses: connection\.pinnedAddresses \}\)/);
  assert.match(liveEgress, /WHERE id=\$\{operationId\}::uuid AND generation_id=\$\{options\.context\.generationId\}::uuid[\s\S]*?provider='first_party_web'/);

  console.log("CRO-03C worker/egress deterministic contract: PASS");
}

await main();