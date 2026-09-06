import { randomUUID } from "node:crypto";

export const CRO03C_WORKER_HEARTBEAT_TTL_MS = 60_000;
export const CRO03C_WORKER_HEARTBEAT_INTERVAL_MS = 20_000;
const CRO03C_HEARTBEAT_NAMESPACE = "cro03c:worker-heartbeat";
export const CRO03C_FLEET_SCAN_MAX_KEYS = 1_000;
export const CRO03C_FLEET_SCAN_MAX_ITERATIONS = 20;
export const CRO03C_FLEET_SCAN_MAX_MS = 2_000;

/**
 * W09: Heartbeat now carries stable environment and deployment fields
 * beyond PID-based processIdentity:
 *   - environmentIdentity: NODE_ENV (stable across restarts in the same env)
 *   - deploymentIdentity:  REPL_DEPLOYMENT_ID ?? REPL_ID (Replit process namespace)
 *   - enabledGroups:       selected capability groups (from BACKGROUND_JOB_PROFILE)
 *
 * These fields distinguish dev/staging/production heartbeats and allow the
 * ceremony inventory to bind a verified fleet to its authorised deployment.
 */
export interface Cro03cWorkerHeartbeat {
  releaseSha: string;
  processIdentity: string;
  bootIdentity: string;
  queueTopologyHash: string;
  /** W09: stable environment label (NODE_ENV), never a random boot value */
  environmentIdentity: string;
  /** W09: Replit deployment/workspace ID; survives restarts in the same deploy */
  deploymentIdentity: string;
  /** W09: active capability groups, or "full"/"core"/"off" for legacy profiles */
  enabledGroups: string;
  timestamp: string;
}

export interface Cro03cHeartbeatRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", ttlMs: number): Promise<unknown>;
  scan(cursor: string, match: "MATCH", pattern: string, count: "COUNT", pageSize: number): Promise<[string, string[]]>;
  ping(): Promise<string>;
  del?(key: string): Promise<unknown>;
}

export function cro03cHeartbeatKey(prefix: string | undefined, bootIdentity: string): string {
  const namespace = prefix
    ? `${prefix}${CRO03C_HEARTBEAT_NAMESPACE}`
    : `bull:${CRO03C_HEARTBEAT_NAMESPACE}`;
  return `${namespace}:${encodeURIComponent(bootIdentity)}`;
}

export function createCro03cWorkerHeartbeat(input: {
  releaseSha: string;
  queueTopologyHash: string;
  processIdentity?: string;
  bootIdentity?: string;
  environmentIdentity?: string;
  deploymentIdentity?: string;
  enabledGroups?: string;
  now?: Date;
}): Cro03cWorkerHeartbeat {
  // W09: stable process identity — prefer PROCESS_IDENTITY env var over PID.
  // PID changes on every restart and cannot serve as fleet membership proof.
  const processIdentity = input.processIdentity?.trim() || `process:${process.pid}`;
  // W09: stable environment label
  const environmentIdentity = input.environmentIdentity?.trim() ||
    process.env.NODE_ENV || "unknown";
  // W09: stable deployment ID; survives restarts within the same Replit deployment
  const deploymentIdentity = input.deploymentIdentity?.trim() ||
    process.env.REPL_DEPLOYMENT_ID || process.env.REPL_ID || "unknown";
  // W09: enabled capability groups for this process
  const enabledGroups = input.enabledGroups?.trim() ||
    (process.env.BACKGROUND_JOB_PROFILE ?? "off");

  return {
    releaseSha: input.releaseSha,
    processIdentity,
    bootIdentity: input.bootIdentity?.trim() || `boot:${process.pid}:${randomUUID()}`,
    queueTopologyHash: input.queueTopologyHash,
    environmentIdentity,
    deploymentIdentity,
    enabledGroups,
    timestamp: (input.now ?? new Date()).toISOString(),
  };
}

export async function publishCro03cWorkerHeartbeat(
  redis: Cro03cHeartbeatRedis,
  prefix: string | undefined,
  heartbeat: Cro03cWorkerHeartbeat,
  ttlMs = CRO03C_WORKER_HEARTBEAT_TTL_MS,
): Promise<void> {
  await redis.set(
    cro03cHeartbeatKey(prefix, heartbeat.bootIdentity),
    JSON.stringify(heartbeat),
    "PX",
    ttlMs,
  );
}

export interface Cro03cWorkerFleetRead {
  complete: boolean;
  heartbeats: Cro03cWorkerHeartbeat[];
  /** W06: true when the call was in discovery mode (expectedProcessIdentities=[]) */
  discoveryMode: boolean;
}

/**
 * W06: Separate discovery from expected-fleet verification.
 *
 * When `expectedProcessIdentities` is empty ([]), this function operates in
 * DISCOVERY mode: it scans all live heartbeats and returns them without
 * comparing against an expected list.  `complete` reflects whether the Redis
 * scan finished within its bounds.
 *
 * When `expectedProcessIdentities` is non-empty, it operates in VERIFICATION
 * mode: it checks that the observed set matches exactly.
 *
 * Previously, an empty expected list with any observed heartbeat threw
 * CRO03C_WORKER_FLEET_SIZE_MISMATCH, which the route silently swallowed,
 * causing the ceremony to see an empty worker list even when workers existed.
 */
export async function readCro03cWorkerFleet(input: {
  redis: Cro03cHeartbeatRedis;
  prefix?: string;
  expectedReleaseSha: string;
  expectedQueueTopologyHash: string;
  expectedProcessIdentities: readonly string[];
  /**
   * W09: When provided, heartbeats from a different environment are rejected
   * with CRO03C_WORKER_ENVIRONMENT_MISMATCH. Prevents dev heartbeats from
   * being counted in a production ceremony (and vice versa) when both processes
   * share the same Redis and have the same release SHA + topology hash.
   * Supply process.env.NODE_ENV or the value from the runtime-identity endpoint.
   */
  expectedEnvironmentIdentity?: string;
  /**
   * W09: When provided, heartbeats from a different deployment namespace are
   * rejected with CRO03C_WORKER_DEPLOYMENT_MISMATCH. Prevents a worker from
   * one Replit workspace from being counted into a ceremony for another.
   * Supply REPL_DEPLOYMENT_ID ?? REPL_ID or the value from runtime-identity.
   */
  expectedDeploymentIdentity?: string;
  now?: Date;
  maxAgeMs?: number;
  maxKeys?: number;
  maxIterations?: number;
  maxScanMs?: number;
}): Promise<Cro03cWorkerFleetRead> {
  const discoveryMode = input.expectedProcessIdentities.length === 0;

  const keys: string[] = [];
  let cursor = "0";
  let iterations = 0;
  const startedAt = Date.now();
  const maxKeys = input.maxKeys ?? CRO03C_FLEET_SCAN_MAX_KEYS;
  const maxIterations = input.maxIterations ?? CRO03C_FLEET_SCAN_MAX_ITERATIONS;
  const maxScanMs = input.maxScanMs ?? CRO03C_FLEET_SCAN_MAX_MS;
  const pattern = input.prefix
    ? `${input.prefix}${CRO03C_HEARTBEAT_NAMESPACE}:*`
    : `bull:${CRO03C_HEARTBEAT_NAMESPACE}:*`;
  try {
    do {
      if (++iterations > maxIterations || Date.now() - startedAt > maxScanMs) {
        return { complete: false, heartbeats: [], discoveryMode };
      }
      const page = await input.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = page[0];
      keys.push(...page[1]);
      if (keys.length > maxKeys) return { complete: false, heartbeats: [], discoveryMode };
    } while (cursor !== "0");
  } catch {
    return { complete: false, heartbeats: [], discoveryMode };
  }

  const nowMs = (input.now ?? new Date()).getTime();
  const maxAgeMs = input.maxAgeMs ?? CRO03C_WORKER_HEARTBEAT_TTL_MS;
  const observed: Cro03cWorkerHeartbeat[] = [];
  for (const key of [...new Set(keys)].sort()) {
    let raw: string | null;
    try {
      raw = await input.redis.get(key);
    } catch {
      return { complete: false, heartbeats: [], discoveryMode };
    }
    if (!raw) continue;
    let heartbeat: Cro03cWorkerHeartbeat;
    try {
      heartbeat = JSON.parse(raw);
    } catch {
      throw new Error("CRO03C_WORKER_HEARTBEAT_INVALID");
    }
    const timestamp = new Date(heartbeat.timestamp).getTime();
    if (!heartbeat.bootIdentity || !heartbeat.processIdentity || !Number.isFinite(timestamp)) {
      throw new Error("CRO03C_WORKER_HEARTBEAT_INVALID");
    }
    if (heartbeat.releaseSha !== input.expectedReleaseSha) {
      throw new Error("CRO03C_WORKER_RELEASE_MISMATCH");
    }
    if (heartbeat.queueTopologyHash !== input.expectedQueueTopologyHash) {
      throw new Error("CRO03C_WORKER_TOPOLOGY_MISMATCH");
    }
    if (timestamp > nowMs + 5_000 || nowMs - timestamp > maxAgeMs) {
      throw new Error("CRO03C_WORKER_HEARTBEAT_STALE");
    }
    // W09: Environment and deployment identity checks — applied in both discovery
    // and verification mode when the caller supplies expected values.
    // A shared Redis (same SHA/topology) can carry heartbeats from dev, staging,
    // and production simultaneously. Without these checks, a dev heartbeat could
    // be signed into a production deployment inventory.
    if (input.expectedEnvironmentIdentity !== undefined &&
        heartbeat.environmentIdentity !== input.expectedEnvironmentIdentity) {
      throw new Error("CRO03C_WORKER_ENVIRONMENT_MISMATCH");
    }
    if (input.expectedDeploymentIdentity !== undefined &&
        heartbeat.deploymentIdentity !== input.expectedDeploymentIdentity) {
      throw new Error("CRO03C_WORKER_DEPLOYMENT_MISMATCH");
    }
    observed.push(heartbeat);
  }

  // W06: In discovery mode, skip fleet-size and identity checks.
  // The caller observes what is present; it does not certify completeness.
  if (discoveryMode) {
    return { complete: true, heartbeats: observed, discoveryMode: true };
  }

  // Verification mode: enforce exact expected membership
  if (observed.length !== input.expectedProcessIdentities.length) {
    throw new Error("CRO03C_WORKER_FLEET_SIZE_MISMATCH");
  }
  if (new Set(observed.map((heartbeat) => heartbeat.bootIdentity)).size !== observed.length ||
      new Set(observed.map((heartbeat) => heartbeat.processIdentity)).size !== observed.length) {
    throw new Error("CRO03C_WORKER_FLEET_IDENTITY_INVALID");
  }
  const expected = [...input.expectedProcessIdentities].sort();
  const actual = observed.map((heartbeat) => heartbeat.processIdentity).sort();
  if (expected.some((identity, index) => identity !== actual[index])) {
    throw new Error("CRO03C_WORKER_FLEET_IDENTITY_MISMATCH");
  }
  return { complete: true, heartbeats: observed, discoveryMode: false };
}
