/**
 * cro03-startup-ceremony.ts
 *
 * Two-phase ceremony that runs automatically on every production startup.
 * Reads the durable signing key from CRO03D_OPERATOR_PRIVATE_KEY (env secret).
 * All steps are idempotent — safe to re-run on every boot.
 *
 * Phase 1 (runs immediately at startup):
 *   - Import 4 approval artifacts (operator / data / finance / legal)
 *
 * Phase 2 (runs 90 s after startup, by which time BullMQ workers have
 *           registered heartbeats in Redis):
 *   - Discover live workers by scanning Redis heartbeat keys
 *   - Sign + import deployment inventory (reflects live worker identities)
 *   - Create runtime attestation (internally verifies inventory + heartbeats)
 *   - Create activation policy
 */

import { createPrivateKey, sign as ed25519Sign } from "node:crypto";
import { randomUUID } from "node:crypto";
import {
  CRO03C_APPROVAL_ARTIFACT_VERSION,
  CRO03C_APPROVAL_DIMENSIONS,
  canonicalCro03cApprovalPayload,
} from "./cro03/approval-artifact";
import {
  CRO03C_RECIPE_VERSION,
  CRO03C_RECIPE_HASH,
  CRO03C_MIGRATION_HEAD,
  assertCro03cPriceSchedules,
  cro03cStagePlanHash,
  importCro03cApprovalArtifact,
  createCro03cRuntimeAttestation,
  createCro03cActivationPolicy,
} from "./cro03/live-execution";
import {
  CRO03C_DEPLOYMENT_INVENTORY_VERSION,
  canonicalCro03cDeploymentInventory,
  importCro03cDeploymentInventory,
  type Cro03cDeploymentInventoryPayload,
} from "./cro03/deployment-inventory";
import { stableCro03RecipeHash } from "./cro03/contracts";
import { CRO03C_WORKER_HEARTBEAT_TTL_MS } from "./cro03/runtime-heartbeat";

const PRICING = {
  internal_source: { version: 1, unitType: "none",    currency: "USD", amountMicros: 0,      billingSemantics: "not_billable" },
  jsonld:          { version: 1, unitType: "parse",   currency: "USD", amountMicros: 0,      billingSemantics: "not_billable" },
  first_party_web: { version: 1, unitType: "page",    currency: "USD", amountMicros: 1,      billingSemantics: "per_unit_no_result_free" },
  rdap:            { version: 1, unitType: "request", currency: "USD", amountMicros: 1,      billingSemantics: "per_unit_no_result_free" },
  serper:          { version: 1, unitType: "request", currency: "USD", amountMicros: 1000,   billingSemantics: "per_unit_no_result_billable" },
  outscraper:      { version: 1, unitType: "result",  currency: "USD", amountMicros: 3000,   billingSemantics: "per_unit_no_result_free" },
  apollo:          { version: 1, unitType: "result",  currency: "USD", amountMicros: 350000, billingSemantics: "per_unit_no_result_free" },
  openai:          { version: 1, unitType: "token",   currency: "USD", amountMicros: 30,     billingSemantics: "per_unit_no_result_billable" },
  zerobounce:      { version: 1, unitType: "request", currency: "USD", amountMicros: 8000,   billingSemantics: "per_unit_no_result_billable" },
} as const;

const PHASE2_DELAY_MS = 90_000;
const HEARTBEAT_NAMESPACE = "cro03c:worker-heartbeat";

function normalizePem(raw: string): string {
  return raw
    .replace(/-----BEGIN PRIVATE KEY----- /g, "-----BEGIN PRIVATE KEY-----\n")
    .replace(/ -----END PRIVATE KEY-----/g, "\n-----END PRIVATE KEY-----");
}

function loadPrivateKey() {
  const rawKey = process.env.CRO03D_OPERATOR_PRIVATE_KEY;
  if (!rawKey?.includes("BEGIN")) throw new Error("CRO03D_OPERATOR_PRIVATE_KEY missing or not PEM");
  const key = createPrivateKey(normalizePem(rawKey));
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`Expected Ed25519, got ${key.asymmetricKeyType}`);
  return key;
}

/** Scan Redis for live worker heartbeats and return their process identities. */
async function discoverWorkerIdentities(
  redis: { scan: (...args: any[]) => Promise<[string, string[]]>; get: (key: string) => Promise<string | null> },
  prefix: string,
  releaseSha: string,
  queueTopologyHash: string,
): Promise<string[]> {
  const pattern = prefix
    ? `${prefix}${HEARTBEAT_NAMESPACE}:*`
    : `bull:${HEARTBEAT_NAMESPACE}:*`;

  const keys: string[] = [];
  let cursor = "0";
  do {
    const page = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = page[0];
    keys.push(...page[1]);
  } while (cursor !== "0");

  const nowMs = Date.now();
  const identities: string[] = [];
  for (const key of [...new Set(keys)].sort()) {
    const raw = await redis.get(key);
    if (!raw) continue;
    const hb = JSON.parse(raw) as {
      processIdentity: string; releaseSha: string; queueTopologyHash: string; timestamp: string;
    };
    if (hb.releaseSha !== releaseSha || hb.queueTopologyHash !== queueTopologyHash) continue;
    const age = nowMs - new Date(hb.timestamp).getTime();
    if (age < 0 || age > CRO03C_WORKER_HEARTBEAT_TTL_MS) continue;
    identities.push(hb.processIdentity);
  }
  return identities.sort();
}

async function phase1ApprovalArtifacts(
  privateKey: ReturnType<typeof createPrivateKey>,
  releaseSha: string,
  runTag: string,
): Promise<string[]> {
  assertCro03cPriceSchedules(PRICING as Parameters<typeof assertCro03cPriceSchedules>[0]);
  const scope = {
    policyKey:      "cro03c_live_activation",
    recipeVersion:  CRO03C_RECIPE_VERSION,
    recipeHash:     CRO03C_RECIPE_HASH,
    stagePlanHash:  cro03cStagePlanHash(),
    migrationHead:  CRO03C_MIGRATION_HEAD,
    releaseSha,
    priceSchedules: PRICING,
  };
  const scopeHash = stableCro03RecipeHash(scope);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 24 * 3600 * 1000);
  const reason = `Auto-ceremony on startup for SHA ${releaseSha}`;

  const receiptIds: string[] = [];
  for (const dimension of CRO03C_APPROVAL_DIMENSIONS) {
    const idemKey = `${runTag}-${dimension}`;
    const payload = {
      artifactVersion: CRO03C_APPROVAL_ARTIFACT_VERSION,
      receiptId:       randomUUID(),
      idempotencyKey:  idemKey,
      issuerId:        "cro03d-operator",
      dimension,
      scope:           scope as unknown as Record<string, unknown>,
      scopeHash,
      issuedAt:        issuedAt.toISOString(),
      expiresAt:       expiresAt.toISOString(),
    };
    const sig = ed25519Sign(
      null,
      Buffer.from(canonicalCro03cApprovalPayload(payload as Parameters<typeof canonicalCro03cApprovalPayload>[0]), "utf8"),
      privateKey,
    );
    const result = await importCro03cApprovalArtifact({
      artifact: { payload, signature: sig.toString("base64") } as any,
      idempotencyKey: idemKey,
      reason,
      actorId: "cro03d-startup",
    });
    receiptIds.push(result.receiptId);
    console.log(`[CRO03D]   ${result.replayed ? "~" : "+"} ${dimension}: ${result.receiptId}`);
  }
  return receiptIds;
}

async function phase2AttestAndActivate(
  privateKey: ReturnType<typeof createPrivateKey>,
  releaseSha: string,
  runTag: string,
  receiptIds: string[],
): Promise<void> {
  const { getCro03cQueueTopologyHash } = await import("./queue-manager");
  const { getBullMqTestPrefix, getSharedRedisClient } = await import("./queue-connection");

  const queueTopologyHash = getCro03cQueueTopologyHash();
  const deploymentIdentity = process.env.REPL_DEPLOYMENT_ID ?? process.env.REPL_ID ?? "";
  const environmentIdentity = process.env.NODE_ENV ?? "";

  if (!deploymentIdentity || !environmentIdentity) {
    throw new Error("REPL_DEPLOYMENT_ID or NODE_ENV not set — cannot create deployment inventory");
  }

  const redis = getSharedRedisClient();
  if (!redis) throw new Error("Redis not available");
  if (await redis.ping() !== "PONG") throw new Error("Redis unhealthy");

  // Discover live worker identities by scanning heartbeat keys directly
  const prefix = getBullMqTestPrefix();
  const workerIdentities = await discoverWorkerIdentities(redis, prefix, releaseSha, queueTopologyHash);
  if (workerIdentities.length === 0) {
    throw new Error("No live worker heartbeats found — workers may not have started yet");
  }
  console.log(`[CRO03D]   Workers: ${workerIdentities.join(", ")}`);

  // Sign + import deployment inventory built from live worker identities
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 24 * 3600 * 1000);
  const inventoryPayload: Cro03cDeploymentInventoryPayload = {
    artifactVersion:    CRO03C_DEPLOYMENT_INVENTORY_VERSION,
    inventoryId:        randomUUID(),
    issuerId:           "cro03d-operator",
    deploymentIdentity,
    environmentIdentity,
    releaseSha,
    queueTopologyHash,
    identityKind:       "ordinal",
    workerIdentities,
    expectedCount:      workerIdentities.length,
    issuedAt:           issuedAt.toISOString(),
    expiresAt:          expiresAt.toISOString(),
  };
  const inventorySig = ed25519Sign(
    null,
    Buffer.from(canonicalCro03cDeploymentInventory(inventoryPayload), "utf8"),
    privateKey,
  );
  const inv = await importCro03cDeploymentInventory({
    artifact: { payload: inventoryPayload, signature: inventorySig.toString("base64") },
    reason: `Auto-ceremony on startup for SHA ${releaseSha}`,
    actorId: "cro03d-startup",
  });
  console.log(`[CRO03D]   ${inv.replayed ? "~" : "+"} inventory: ${inv.inventoryId}`);

  // Runtime attestation — internally re-reads worker heartbeats and matches against inventory
  const att = await createCro03cRuntimeAttestation({
    idempotencyKey: `${runTag}-attestation`,
    actorId: "cro03d-startup",
  });
  console.log(`[CRO03D]   ${att.replayed ? "~" : "+"} attestation: ${att.id}`);

  // Activation policy
  const pol = await createCro03cActivationPolicy({
    idempotencyKey: `${runTag}-policy`,
    reason: `Auto-ceremony on startup for SHA ${releaseSha}`,
    actorId: "cro03d-startup",
    receiptIds,
  });
  console.log(`[CRO03D]   ${pol.replayed ? "~" : "+"} policy revision=${pol.revision}`);
  console.log("[CRO03D] Ceremony complete.");
}

export async function runStartupCeremony(): Promise<void> {
  const releaseSha = process.env.RELEASE_SHA ?? "";
  if (!releaseSha || releaseSha === "unset") {
    console.log("[CRO03D] RELEASE_SHA not set — skipping ceremony (dev/local)");
    return;
  }

  let privateKey: ReturnType<typeof createPrivateKey>;
  try {
    privateKey = loadPrivateKey();
  } catch {
    console.log("[CRO03D] CRO03D_OPERATOR_PRIVATE_KEY not configured — skipping ceremony");
    return;
  }

  const runTag = `startup-${releaseSha.slice(0, 8)}`;
  console.log(`[CRO03D] Phase 1: importing approval artifacts for SHA ${releaseSha.slice(0, 8)}...`);

  let receiptIds: string[];
  try {
    receiptIds = await phase1ApprovalArtifacts(privateKey, releaseSha, runTag);
    console.log(`[CRO03D] Phase 1 complete (${receiptIds.length} receipts). Phase 2 in ${PHASE2_DELAY_MS / 1000}s...`);
  } catch (err: unknown) {
    console.error("[CRO03D] Phase 1 failed (non-fatal):", (err as Error).message);
    return;
  }

  // Phase 2 delayed so BullMQ workers have time to boot and register heartbeats
  setTimeout(async () => {
    console.log("[CRO03D] Phase 2: deployment inventory + attestation + policy...");
    try {
      await phase2AttestAndActivate(privateKey, releaseSha, runTag, receiptIds);
    } catch (err: unknown) {
      console.error("[CRO03D] Phase 2 failed (non-fatal):", (err as Error).message);
    }
  }, PHASE2_DELAY_MS);
}
