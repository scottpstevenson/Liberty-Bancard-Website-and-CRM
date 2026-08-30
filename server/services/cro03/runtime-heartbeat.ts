import { randomUUID } from "node:crypto";

export const CRO03C_WORKER_HEARTBEAT_TTL_MS = 60_000;
export const CRO03C_WORKER_HEARTBEAT_INTERVAL_MS = 20_000;
const CRO03C_HEARTBEAT_NAMESPACE = "cro03c:worker-heartbeat";
export const CRO03C_FLEET_SCAN_MAX_KEYS = 1_000;
export const CRO03C_FLEET_SCAN_MAX_ITERATIONS = 20;
export const CRO03C_FLEET_SCAN_MAX_MS = 2_000;

export interface Cro03cWorkerHeartbeat {
  releaseSha: string;
  processIdentity: string;
  bootIdentity: string;
  queueTopologyHash: string;
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
  now?: Date;
}): Cro03cWorkerHeartbeat {
  return {
    releaseSha: input.releaseSha,
    processIdentity: input.processIdentity?.trim() || `process:${process.pid}`,
    bootIdentity: input.bootIdentity?.trim() || `boot:${process.pid}:${randomUUID()}`,
    queueTopologyHash: input.queueTopologyHash,
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
}

export async function readCro03cWorkerFleet(input: {
  redis: Cro03cHeartbeatRedis;
  prefix?: string;
  expectedReleaseSha: string;
  expectedQueueTopologyHash: string;
  expectedProcessIdentities: readonly string[];
  now?: Date;
  maxAgeMs?: number;
  maxKeys?: number;
  maxIterations?: number;
  maxScanMs?: number;
}): Promise<Cro03cWorkerFleetRead> {
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
        return { complete: false, heartbeats: [] };
      }
      const page = await input.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = page[0];
      keys.push(...page[1]);
      if (keys.length > maxKeys) return { complete: false, heartbeats: [] };
    } while (cursor !== "0");
  } catch {
    return { complete: false, heartbeats: [] };
  }

  const nowMs = (input.now ?? new Date()).getTime();
  const maxAgeMs = input.maxAgeMs ?? CRO03C_WORKER_HEARTBEAT_TTL_MS;
  const observed: Cro03cWorkerHeartbeat[] = [];
  for (const key of [...new Set(keys)].sort()) {
    let raw: string | null;
    try {
      raw = await input.redis.get(key);
    } catch {
      return { complete: false, heartbeats: [] };
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
    observed.push(heartbeat);
  }

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
  return { complete: true, heartbeats: observed };
}