/**
 * runtime-fleet-snapshot.ts
 *
 * ONE authoritative runtime-fleet evaluator shared by:
 *  - GET /api/admin/cro03c/gate-diagnostics
 *  - POST /api/cro03c/runtime-attestations
 *
 * Both routes call `evaluateCro03cRuntimeFleet()` and receive one typed
 * `Cro03cRuntimeFleetSnapshot`.  The attestation route issues against that
 * exact snapshot; it never performs a second topology comparison.
 *
 * Topology normalization contract:
 *  1. Discovery scan first (discovery mode) — foreign heartbeats are skipped,
 *     not counted and not thrown.
 *  2. Inventory lookup — the signed deployment inventory defines the expected
 *     worker set; unknown heartbeats in Redis are ignored.
 *  3. Workers are sorted, queues/capabilities deduplicated and sorted.
 *  4. The topology hash excludes timestamps and volatile metadata; it is
 *     identical everywhere for the same logical configuration.
 */

import { createHash } from "node:crypto";
import type { Cro03cWorkerHeartbeat } from "./runtime-heartbeat";

// ── Types ─────────────────────────────────────────────────────────────────────

export type FleetBlockingReason =
  | "RELEASE_SHA_MISSING_OR_INVALID"
  | "REDIS_UNAVAILABLE"
  | "DB_UNAVAILABLE"
  | "INVENTORY_MISSING"
  | "INVENTORY_EXPIRED"
  | "INVENTORY_AMBIGUOUS"
  | "INVENTORY_ENVIRONMENT_MISMATCH"
  | "WORKER_FLEET_EMPTY"
  | "WORKER_FLEET_SCAN_INCOMPLETE"
  | "WORKER_FLEET_MISSING_MEMBERS"
  | "NO_ATTESTATION";

export interface Cro03cRuntimeFleetSnapshot {
  /** Stable env label (NODE_ENV) */
  environmentIdentity: string;
  /** REPL_DEPLOYMENT_ID ?? REPL_ID */
  deploymentIdentity: string;
  /** Sorted list of logical worker processIdentities found in the discovery scan */
  logicalWorkers: string[];
  /** Full heartbeat objects (sorted by processIdentity) */
  heartbeats: Cro03cWorkerHeartbeat[];
  /** Queues declared in the topology, sorted by name */
  requiredQueues: string[];
  /** Capability groups active in the worker profile */
  requiredCapabilities: string[];
  /** Whether the Redis scan completed within bounds */
  fleetComplete: boolean;
  /** True when every worker's heartbeat is within the freshness window */
  workerFresh: boolean;
  /** Age (ms) of the oldest heartbeat; undefined when fleet is empty */
  oldestHeartbeatAgeMs?: number;
  /** Current release SHA (from RELEASE_SHA env var) */
  releaseSha: string;
  /** Topology hash computed by getCro03cQueueTopologyHash() */
  queueTopologyHash: string;
  /** Topology hash from the matched deployment inventory, or null when no inventory */
  inventoryTopologyHash: string | null;
  /** Worker identities declared in the signed inventory */
  inventoryWorkerIdentities: string[];
  /** Deployment inventory ID, or null */
  inventoryId: string | null;
  /** Whether the deployment inventory is present, non-expired, and non-ambiguous */
  inventoryValid: boolean;
  /** Whether the current live fleet matches the inventory's declared workers exactly */
  fleetMatchesInventory: boolean;
  /** Workers present in Redis but not in the inventory */
  unexpectedWorkers: string[];
  /** Workers declared in the inventory but absent from the Redis fleet */
  missingWorkers: string[];
  /** Heartbeats skipped because they belong to a different generation */
  generationalSkips: Array<{ reason: string; processIdentity: string; observed: string; expected: string }>;
  /** SHA mismatch warnings (non-blocking) */
  releaseShaWarnings: Array<{ apiSha: string; workerSha: string; processIdentity: string }>;
  /** True when any live worker carries a different release SHA than the API */
  hasShaWarning: boolean;
  /** Redis ping healthy */
  redisHealthy: boolean;
  /** DB SELECT 1 healthy */
  dbHealthy: boolean;
  /** Ordered list of blocking reason codes; empty = gate open */
  blockingReasons: FleetBlockingReason[];
  /** First (primary) blocking reason, or null when gate is open */
  primaryBlockingReason: FleetBlockingReason | null;
  /** Non-blocking warnings (informational) */
  warnings: string[];
  /** Active attestation ID, or null */
  activeAttestationId: string | null;
  /** Active attestation expiry ISO string, or null */
  activeAttestationExpiresAt: string | null;
  /** Whether a live non-expired attestation exists */
  hasAttestation: boolean;
  /** Captured at (UTC ISO) */
  capturedAt: string;
}

// ── Evaluator ─────────────────────────────────────────────────────────────────

export async function evaluateCro03cRuntimeFleet(opts: {
  now?: Date;
  maxHeartbeatAgeMs?: number;
} = {}): Promise<Cro03cRuntimeFleetSnapshot> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const capturedAt = now.toISOString();

  const releaseSha = process.env.RELEASE_SHA ?? "";
  const deploymentIdentity = process.env.REPL_DEPLOYMENT_ID ?? process.env.REPL_ID ?? "";
  const environmentIdentity = process.env.NODE_ENV ?? "";

  const { getCro03cQueueTopologyHash, QUEUE_CONFIGS } =
    await import("../queue-manager");
  const queueTopologyHash = getCro03cQueueTopologyHash();

  const { getSharedRedisClient, getBullMqTestPrefix } = await import("../queue-connection");
  const { readCro03cWorkerFleet } = await import("./runtime-heartbeat");
  const { db } = await import("../../db");
  const { sql } = await import("drizzle-orm");

  const rows = (r: any): any[] => r?.rows ?? r ?? [];

  // ── 1. DB health ────────────────────────────────────────────────────────────
  let dbHealthy = false;
  try {
    const probe = rows(await db.execute(sql`SELECT 1 AS ok`))[0];
    dbHealthy = Number(probe?.ok) === 1;
  } catch { dbHealthy = false; }

  // ── 2. Redis health + discovery fleet scan ──────────────────────────────────
  let redisHealthy = false;
  let fleetComplete = false;
  let discoveredHeartbeats: Cro03cWorkerHeartbeat[] = [];
  let generationalSkips: Cro03cRuntimeFleetSnapshot["generationalSkips"] = [];
  let releaseShaWarnings: Cro03cRuntimeFleetSnapshot["releaseShaWarnings"] = [];

  const redis = getSharedRedisClient();
  if (redis) {
    try {
      redisHealthy = (await redis.ping()) === "PONG";
    } catch { redisHealthy = false; }

    if (redisHealthy && /^[0-9a-f]{40}$/i.test(releaseSha)) {
      try {
        const fleet = await readCro03cWorkerFleet({
          redis,
          prefix: getBullMqTestPrefix(),
          expectedReleaseSha: releaseSha,
          expectedQueueTopologyHash: queueTopologyHash,
          expectedProcessIdentities: [], // discovery mode: skip foreign, never throw
          expectedEnvironmentIdentity: environmentIdentity || undefined,
          expectedDeploymentIdentity: deploymentIdentity || undefined,
          now,
          maxAgeMs: opts.maxHeartbeatAgeMs,
        });
        fleetComplete = fleet.complete;
        discoveredHeartbeats = fleet.heartbeats;
        generationalSkips = fleet.generationalSkips ?? [];
        releaseShaWarnings = fleet.releaseShaWarnings ?? [];
      } catch { fleetComplete = false; }
    }
  }

  // Normalize: sort workers by processIdentity, deduplicate
  const seenIdentities = new Set<string>();
  const dedupedHeartbeats = discoveredHeartbeats
    .sort((a, b) => a.processIdentity.localeCompare(b.processIdentity))
    .filter((h) => {
      if (seenIdentities.has(h.processIdentity)) return false;
      seenIdentities.add(h.processIdentity);
      return true;
    });

  const logicalWorkers = dedupedHeartbeats.map((h) => h.processIdentity);

  // ── 3. Freshness ────────────────────────────────────────────────────────────
  let oldestHeartbeatAgeMs: number | undefined;
  let workerFresh = true;
  const maxAge = opts.maxHeartbeatAgeMs ?? 60_000;
  if (dedupedHeartbeats.length > 0) {
    const ages = dedupedHeartbeats.map((h) => nowMs - new Date(h.timestamp).getTime());
    oldestHeartbeatAgeMs = Math.max(...ages);
    workerFresh = ages.every((a) => a <= maxAge && a >= -5_000);
  }

  // ── 4. Queues and capabilities from topology ────────────────────────────────
  const { getBackgroundProfile, getSelectiveGroups } = await import("../background-profile");
  const profile = getBackgroundProfile();
  const _activeGroups = profile === "selective" ? getSelectiveGroups() : [];
  // requiredQueues: queue names declared in the active topology (for UI display)
  const requiredQueues: string[] = Array.isArray(QUEUE_CONFIGS)
    ? QUEUE_CONFIGS.map((c: { name: string }) => c.name).sort()
    : [];
  const requiredCapabilities: string[] = dedupedHeartbeats.length > 0
    ? [...new Set(dedupedHeartbeats.flatMap((h) => (h.enabledGroups ?? "").split(",").map((s) => s.trim()).filter(Boolean)))].sort()
    : [];

  // ── 5. Deployment inventory ─────────────────────────────────────────────────
  let inventoryId: string | null = null;
  let inventoryTopologyHash: string | null = null;
  let inventoryWorkerIdentities: string[] = [];
  let inventoryValid = false;
  const warnings: string[] = [];

  if (/^[0-9a-f]{40}$/i.test(releaseSha) && deploymentIdentity && environmentIdentity) {
    try {
      const invRows = rows(await db.execute(sql`
        SELECT i.id::text, i.queue_topology_hash, i.worker_identities, i.expires_at::text
          FROM cro03c_deployment_inventories i
          LEFT JOIN cro03c_deployment_inventory_revocations r ON r.inventory_id=i.id
         WHERE r.inventory_id IS NULL AND i.expires_at > ${now}::timestamptz
           AND i.deployment_identity  = ${deploymentIdentity}
           AND i.environment_identity = ${environmentIdentity}
           AND i.release_sha          = ${releaseSha}
           AND i.queue_topology_hash  = ${queueTopologyHash}
         ORDER BY i.issued_at DESC LIMIT 2
      `));
      if (invRows.length === 1) {
        const row = invRows[0];
        inventoryId = String(row.id);
        inventoryTopologyHash = String(row.queue_topology_hash);
        const rawIds = row.worker_identities;
        inventoryWorkerIdentities = (
          typeof rawIds === "string" ? JSON.parse(rawIds) : Array.isArray(rawIds) ? rawIds : []
        ) as string[];
        inventoryValid = true;
      } else if (invRows.length > 1) {
        warnings.push("INVENTORY_AMBIGUOUS: multiple valid inventory rows — convergence needed");
      }
    } catch (err: any) {
      warnings.push(`INVENTORY_QUERY_ERROR: ${err?.message?.slice(0, 80)}`);
    }
  }

  // ── 6. Fleet vs inventory cross-check ──────────────────────────────────────
  const inventorySet = new Set(inventoryWorkerIdentities);
  const liveSet = new Set(logicalWorkers);
  const missingWorkers = inventoryWorkerIdentities.filter((id) => !liveSet.has(id)).sort();
  const unexpectedWorkers = logicalWorkers.filter((id) => !inventorySet.has(id)).sort();
  const fleetMatchesInventory =
    inventoryValid &&
    missingWorkers.length === 0 &&
    unexpectedWorkers.length === 0 &&
    logicalWorkers.length === inventoryWorkerIdentities.length;

  // ── 7. Active attestation ───────────────────────────────────────────────────
  let activeAttestationId: string | null = null;
  let activeAttestationExpiresAt: string | null = null;
  let hasAttestation = false;
  try {
    const attRow = rows(await db.execute(sql`
      SELECT id::text, expires_at::text
        FROM cro03c_runtime_attestations
       WHERE expires_at > ${now}::timestamptz
       ORDER BY captured_at DESC LIMIT 1
    `))[0];
    if (attRow) {
      activeAttestationId = String(attRow.id);
      activeAttestationExpiresAt = String(attRow.expires_at);
      hasAttestation = true;
    }
  } catch { /* attestation query error — treat as no attestation */ }

  // ── 8. Blocking reasons (ordered) ──────────────────────────────────────────
  const blockingReasons: FleetBlockingReason[] = [];
  if (!/^[0-9a-f]{40}$/i.test(releaseSha)) blockingReasons.push("RELEASE_SHA_MISSING_OR_INVALID");
  if (!dbHealthy) blockingReasons.push("DB_UNAVAILABLE");
  if (!redisHealthy) blockingReasons.push("REDIS_UNAVAILABLE");
  if (!inventoryValid) {
    // Distinguish ambiguous vs missing (warnings already populated)
    blockingReasons.push(
      warnings.some((w) => w.startsWith("INVENTORY_AMBIGUOUS"))
        ? "INVENTORY_AMBIGUOUS"
        : "INVENTORY_MISSING",
    );
  }
  if (logicalWorkers.length === 0) blockingReasons.push("WORKER_FLEET_EMPTY");
  else if (!fleetComplete) blockingReasons.push("WORKER_FLEET_SCAN_INCOMPLETE");
  if (inventoryValid && missingWorkers.length > 0) blockingReasons.push("WORKER_FLEET_MISSING_MEMBERS");
  if (!hasAttestation) blockingReasons.push("NO_ATTESTATION");

  const primaryBlockingReason = blockingReasons[0] ?? null;
  const hasShaWarning = releaseShaWarnings.length > 0;

  return {
    environmentIdentity,
    deploymentIdentity,
    logicalWorkers,
    heartbeats: dedupedHeartbeats,
    requiredQueues,
    requiredCapabilities,
    fleetComplete,
    workerFresh,
    oldestHeartbeatAgeMs,
    releaseSha,
    queueTopologyHash,
    inventoryTopologyHash,
    inventoryWorkerIdentities,
    inventoryId,
    inventoryValid,
    fleetMatchesInventory,
    unexpectedWorkers,
    missingWorkers,
    generationalSkips,
    releaseShaWarnings,
    hasShaWarning,
    redisHealthy,
    dbHealthy,
    blockingReasons,
    primaryBlockingReason,
    warnings,
    activeAttestationId,
    activeAttestationExpiresAt,
    hasAttestation,
    capturedAt,
  };
}

/** Canonical topology-hash serialization: sorted, volatile fields excluded. */
export function canonicalTopologyHash(
  effectiveProfile: string,
  selectedGroups: string[],
  queues: Array<{ name: string; concurrency?: number; attempts?: number }>,
  namedSchedules: Array<{ queueName: string; jobName: string; jobId: string; repeatEveryMs?: number; cronPattern?: string | null }>,
): string {
  const topology = {
    effectiveProfile,
    selectedGroups: [...selectedGroups].sort(),
    queues: queues
      .map(({ name, concurrency, attempts }) => ({ name, concurrency: concurrency ?? 1, attempts: attempts ?? 1 }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    namedSchedules: namedSchedules
      .map(({ queueName, jobName, jobId, repeatEveryMs, cronPattern }) => ({
        queueName, jobName, jobId,
        repeatEveryMs: repeatEveryMs ?? null,
        cronPattern: cronPattern ?? null,
      }))
      .sort((a, b) => a.jobId.localeCompare(b.jobId)),
  };
  return createHash("sha256").update(JSON.stringify(topology)).digest("hex");
}
