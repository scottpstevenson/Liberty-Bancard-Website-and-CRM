/**
 * cro03-inventory-convergence.ts
 *
 * Startup convergence for the CRO-03C deployment inventory.
 *
 * WHY: `cro03c_deployment_inventories` must contain a valid, non-expired row
 * matching the current RELEASE_SHA, deployment identity, environment identity,
 * and queue topology hash for runtime attestation to succeed.  The offline
 * ceremony script (scripts/cro03d-run-ceremony.ts) historically required a
 * manual run after every deploy.  This module self-converges the inventory
 * using the CRO03D_OPERATOR_PRIVATE_KEY that is already present in the server
 * environment, ensuring production never gets stuck at DEPLOYMENT_INVENTORY_MISSING
 * after an automated deploy.
 *
 * SECURITY BOUNDARY:
 *   The deployment inventory merely *identifies* what is running (SHA, fleet).
 *   It does NOT authorize spend — that boundary belongs to the separately signed
 *   approval receipts, which are NOT produced here.  Self-signing an identity
 *   manifest from the server process is acceptable; self-signing an approval
 *   receipt would not be.
 *
 * IDEMPOTENCY: The import is idempotent by payload_hash.  A re-deploy with the
 * same SHA produces the same payload; the insert is a no-op and the existing row
 * is returned.  A new SHA produces a new row.
 *
 * WORKER WAIT: The inventory must include the actual running worker identities
 * so the attestation fleet-verification step can match them.  This function
 * polls Redis for up to `workerWaitMs` (default 60 s) before giving up.
 */

import { createPrivateKey, sign as ed25519Sign } from "node:crypto";
import { randomUUID } from "node:crypto";
import {
  CRO03C_DEPLOYMENT_INVENTORY_VERSION,
  canonicalCro03cDeploymentInventory,
  importCro03cDeploymentInventory,
  type Cro03cDeploymentInventoryPayload,
} from "./cro03/deployment-inventory";
import { stableCro03RecipeHash } from "./cro03/contracts";
import { sanitizeAuditPayload } from "./audit-sanitizer";

export type InventoryConvergenceResult =
  | { converged: true; inventoryId: string; replayed: boolean; workerCount: number }
  | { converged: false; reason: string; detail?: string };

const ISSUER_ID = "cro03d-operator";
const SHA1 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;

/**
 * Normalise the PEM key from the Replit secrets UI, which may collapse line
 * breaks to spaces.  Matches the same normalization in cro03d-run-ceremony.ts.
 */
function normalisePem(raw: string): string {
  return raw
    .replace(/-----BEGIN PRIVATE KEY----- /g, "-----BEGIN PRIVATE KEY-----\n")
    .replace(/ -----END PRIVATE KEY-----/g, "\n-----END PRIVATE KEY-----")
    .replace(
      /-----BEGIN PRIVATE KEY-----\n(\S+)\n-----END PRIVATE KEY-----/g,
      (_m, b64) => `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`,
    );
}

/**
 * Wait for at least one CRO-03C worker heartbeat to appear in Redis, bounded
 * by `maxWaitMs`.  Returns the discovered worker identities (sorted).
 */
async function waitForWorkerHeartbeats(maxWaitMs: number): Promise<string[]> {
  const { getSharedRedisClient, getBullMqTestPrefix } = await import("./queue-connection");
  const { readCro03cWorkerFleet } = await import("./cro03/runtime-heartbeat");
  const { getCro03cQueueTopologyHash } = await import("./queue-manager");

  const releaseSha = process.env.RELEASE_SHA ?? "";
  const queueTopologyHash = getCro03cQueueTopologyHash();
  const deploymentIdentity = process.env.REPL_DEPLOYMENT_ID ?? process.env.REPL_ID ?? "";
  const environmentIdentity = process.env.NODE_ENV ?? "";

  const intervalMs = 5_000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const redis = getSharedRedisClient();
    if (redis && SHA1.test(releaseSha) && SHA256.test(queueTopologyHash)) {
      try {
        const fleet = await readCro03cWorkerFleet({
          redis,
          prefix: getBullMqTestPrefix(),
          expectedReleaseSha: releaseSha,
          expectedQueueTopologyHash: queueTopologyHash,
          expectedProcessIdentities: [], // discovery mode
          expectedEnvironmentIdentity: environmentIdentity,
          expectedDeploymentIdentity: deploymentIdentity,
          now: new Date(),
        });
        if (fleet.complete && fleet.heartbeats.length > 0) {
          return fleet.heartbeats.map((h) => h.processIdentity).sort();
        }
      } catch { /* transient — retry */ }
    }
    await new Promise((r) => setTimeout(r, Math.min(intervalMs, deadline - Date.now())));
  }
  return [];
}

/**
 * Converge the CRO-03C deployment inventory for the current release.
 *
 * Called once from server startup (after BullMQ workers are initialised) and
 * from the admin converge route.  Safe to call concurrently — the DB insert
 * is idempotent by payload_hash.
 */
export async function convergeCro03cDeploymentInventory(opts: {
  actorId?: string;
  workerWaitMs?: number;
  /** If set, abort and return converged:false if observed count ≠ expected. */
  expectedWorkerCount?: number;
} = {}): Promise<InventoryConvergenceResult> {
  const { actorId = "system:inventory-convergence", workerWaitMs = 60_000 } = opts;

  // ── 1. Validate prerequisites ───────────────────────────────────────────────
  const rawKey = process.env.CRO03D_OPERATOR_PRIVATE_KEY ?? "";
  if (!rawKey.includes("BEGIN")) {
    return { converged: false, reason: "CRO03C_OPERATOR_KEY_MISSING", detail: "CRO03D_OPERATOR_PRIVATE_KEY not set or not PEM-encoded" };
  }

  let privateKey;
  try {
    privateKey = createPrivateKey(normalisePem(rawKey));
    if (privateKey.asymmetricKeyType !== "ed25519") {
      return { converged: false, reason: "CRO03C_OPERATOR_KEY_WRONG_TYPE", detail: `Expected Ed25519, got ${privateKey.asymmetricKeyType}` };
    }
  } catch (err: any) {
    return { converged: false, reason: "CRO03C_OPERATOR_KEY_PARSE_ERROR", detail: err?.message };
  }

  // Verify the public key is registered in the trust config.
  let issuersConfig: Record<string, unknown>;
  try {
    issuersConfig = JSON.parse(process.env.CRO03C_TRUSTED_DEPLOYMENT_INVENTORY_ISSUERS ?? "{}");
  } catch {
    return { converged: false, reason: "CRO03C_TRUST_CONFIG_INVALID" };
  }
  if (typeof issuersConfig[ISSUER_ID] !== "string") {
    return { converged: false, reason: "CRO03C_ISSUER_NOT_IN_TRUST_CONFIG", detail: `issuerId=${ISSUER_ID} not found in CRO03C_TRUSTED_DEPLOYMENT_INVENTORY_ISSUERS` };
  }

  const releaseSha = process.env.RELEASE_SHA ?? "";
  const deploymentIdentity = process.env.REPL_DEPLOYMENT_ID ?? process.env.REPL_ID ?? "";
  const environmentIdentity = process.env.NODE_ENV ?? "";

  if (!SHA1.test(releaseSha)) {
    return { converged: false, reason: "CRO03C_RELEASE_SHA_INVALID", detail: `RELEASE_SHA="${releaseSha}"` };
  }
  if (!deploymentIdentity) {
    return { converged: false, reason: "CRO03C_DEPLOYMENT_IDENTITY_MISSING", detail: "REPL_DEPLOYMENT_ID and REPL_ID are both unset" };
  }
  if (!environmentIdentity) {
    return { converged: false, reason: "CRO03C_ENVIRONMENT_IDENTITY_MISSING" };
  }

  // ── 2. Resolve queue topology hash ─────────────────────────────────────────
  const { getCro03cQueueTopologyHash } = await import("./queue-manager");
  const queueTopologyHash = getCro03cQueueTopologyHash();
  if (!SHA256.test(queueTopologyHash)) {
    return { converged: false, reason: "CRO03C_QUEUE_TOPOLOGY_HASH_INVALID" };
  }

  // ── 3. Wait for worker heartbeats ──────────────────────────────────────────
  console.log(`[CRO03C-Inventory] Waiting up to ${workerWaitMs / 1000}s for worker heartbeats…`);
  const workerIdentities = await waitForWorkerHeartbeats(workerWaitMs);
  if (workerIdentities.length === 0) {
    return { converged: false, reason: "CRO03C_WORKER_FLEET_EMPTY", detail: "No live worker heartbeats found after waiting" };
  }
  if (opts.expectedWorkerCount !== undefined && workerIdentities.length !== opts.expectedWorkerCount) {
    return {
      converged: false,
      reason: "CRO03C_WORKER_COUNT_MISMATCH",
      detail: `Observed ${workerIdentities.length} workers, expected ${opts.expectedWorkerCount}`,
    };
  }
  console.log(`[CRO03C-Inventory] Found ${workerIdentities.length} worker(s): ${workerIdentities.join(", ")}`);

  // ── 4. Build and sign the inventory payload ────────────────────────────────
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 24 * 3600 * 1000); // 24 h TTL

  const inventoryPayload: Cro03cDeploymentInventoryPayload = {
    artifactVersion: CRO03C_DEPLOYMENT_INVENTORY_VERSION,
    inventoryId: randomUUID(),
    issuerId: ISSUER_ID,
    deploymentIdentity,
    environmentIdentity,
    releaseSha,
    queueTopologyHash,
    identityKind: "worker",
    workerIdentities,
    expectedCount: workerIdentities.length,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const canonical = canonicalCro03cDeploymentInventory(inventoryPayload);
  const signature = ed25519Sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64");
  const artifact = { payload: inventoryPayload, signature };

  // ── 5. Import (idempotent by payload_hash) ─────────────────────────────────
  try {
    const result = await importCro03cDeploymentInventory({
      artifact,
      reason: `Startup convergence for release ${releaseSha.slice(0, 8)} (${workerIdentities.length} worker(s))`,
      actorId,
    });
    console.log(
      `[CRO03C-Inventory] ${result.replayed ? "Replayed existing" : "Created new"} inventory ` +
      `${result.inventoryId} (sha=${releaseSha.slice(0, 8)}, workers=${workerIdentities.length})`,
    );
    return { converged: true, inventoryId: result.inventoryId, replayed: result.replayed, workerCount: workerIdentities.length };
  } catch (err: any) {
    return { converged: false, reason: err?.message ?? "CRO03C_IMPORT_FAILED", detail: String(err) };
  }
}
