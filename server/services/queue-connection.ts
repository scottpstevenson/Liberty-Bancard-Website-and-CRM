import type { ConnectionOptions } from "bullmq";
import Redis from "ioredis";

/**
 * Singleton IORedis client shared across ALL BullMQ Queue and Worker instances.
 *
 * Connection-count math (BullMQ v5):
 *   • Queue instances:  when passed an IORedis instance BullMQ marks it "shared"
 *                       and creates NO new connection → all N Queues = 0 new connections.
 *   • Worker instances: non-blocking parent connection → "shared" → 0 new connections.
 *                       blocking connection → always .duplicate()'d internally → 1 new connection per Worker.
 *
 * Net result for 11 queues: 1 (shared) + 11 (blocking duplicates) = 12 connections.
 * Upstash free tier allows 20 → well within limits, zero timeout storms.
 *
 * Before this fix: passing ConnectionOptions (plain object) caused BullMQ to create a
 * fresh ioredis instance per Queue AND per Worker, totalling 33 connections and tripping
 * Upstash's 20-connection cap — the resulting rejected connections sent commands into
 * ioredis's offline queue where commandTimeout:10_000 fired every 10 s ("Command timed out").
 */
let _sharedClient: Redis | null = null;
let _usingMock = false;

export function isUsingMockRedis(): boolean {
  return _usingMock;
}

/**
 * Returns the already-initialised singleton IORedis client, or null if BullMQ
 * has not yet been initialised (e.g. REDIS_URL not set / startup not complete).
 *
 * Use this for lightweight probe calls (PING, GET) rather than creating a new
 * Redis connection — every extra connection counts against Upstash's 20-connection
 * free-tier cap and can cause ETIMEDOUT for the actual BullMQ workers.
 */
export function getSharedRedisClient(): Redis | null {
  return _sharedClient;
}

/**
 * Returns a singleton IORedis client for use with BullMQ.
 *
 * The return type is `ConnectionOptions` (which is `IORedisOptions | Redis | Cluster`
 * in BullMQ) so it can be passed directly to Queue/Worker constructors without casting.
 *
 * Critical BullMQ ioredis settings applied here:
 *   • maxRetriesPerRequest: null — retry commands indefinitely on reconnect (required by BullMQ)
 *   • enableReadyCheck: false    — avoid false "ready check failed" on BLPOP/WAIT commands
 *   • NO commandTimeout          — removed: with maxRetriesPerRequest:null this option fights
 *                                  the reconnect model. A command timed out during reconnect
 *                                  was the direct cause of the "Command timed out" storm.
 *                                  BullMQ's own BLMOVE has a 5 s server-side timeout, so
 *                                  commands never legitimately hang >5 s in steady state.
 */
export async function getRedisConnection(): Promise<ConnectionOptions> {
  if (_sharedClient) return _sharedClient as unknown as ConnectionOptions;

  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error(
      "REDIS_URL is not set. BullMQ requires a real Redis connection. " +
      "Falling back to setInterval workers. Set REDIS_URL for durable job queues."
    );
  }

  console.log("[Queue] Connecting to Redis:", redisUrl.replace(/:\/\/.*@/, "://***@"));
  const url = new URL(redisUrl);
  const forceTls = url.protocol === "rediss:" || url.hostname.includes("upstash.io");

  // ── Smoke-test probe ───────────────────────────────────────────────────────
  // A separate short-lived Redis instance that we connect, ping, and discard.
  // This validates credentials/reachability before we commit the shared singleton.
  // The probe uses maxRetriesPerRequest:1 so it fails fast instead of hanging.
  const probe = new Redis({
    host: url.hostname,
    port: parseInt(url.port || "6379", 10),
    password: url.password || undefined,
    username: url.username || undefined,
    tls: forceTls ? {} : undefined,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableReadyCheck: false,
  });

  try {
    await probe.connect();
    await probe.ping();
    console.log("[Queue] Redis smoke-test passed — creating shared BullMQ client");
  } catch (err: any) {
    probe.disconnect();
    throw new Error(
      `Redis connection smoke-test failed (${err.message}). ` +
      `Falling back to setInterval workers. Check REDIS_URL credentials.`
    );
  } finally {
    probe.disconnect();
  }

  // ── Shared singleton client ────────────────────────────────────────────────
  // This instance is handed to every BullMQ Queue and Worker constructor.
  // BullMQ detects it as an existing IORedis instance (isRedisInstance check)
  // and marks the connection as "shared" — meaning:
  //   • Queue:  uses this connection directly, creates NO duplicate
  //   • Worker: uses this for non-blocking ops; internally .duplicate()'s it
  //             for the blocking BLMOVE/BRPOP connection (1 per Worker, unavoidable)
  const client = new Redis({
    host: url.hostname,
    port: parseInt(url.port || "6379", 10),
    password: url.password || undefined,
    username: url.username || undefined,
    tls: forceTls ? {} : undefined,

    // ── BullMQ REQUIRED ────────────────────────────────────────────────────
    maxRetriesPerRequest: null,   // retry commands indefinitely on reconnect
    enableReadyCheck: false,      // skip ready-check that trips on WAIT/LISTEN

    // ── Connection stability ───────────────────────────────────────────────
    keepAlive: 30_000,
    reconnectOnError: (err: Error) => {
      const msg = err.message.toLowerCase();
      return (
        msg.includes("econnreset") ||
        msg.includes("etimedout") ||
        msg.includes("econnrefused") ||
        msg.includes("epipe")
      );
    },
    retryStrategy: (times: number) => Math.min(times * 500, 5000),
    enableOfflineQueue: true,

    // NOTE: commandTimeout intentionally OMITTED.
    // With maxRetriesPerRequest:null, ioredis retries commands indefinitely
    // on reconnect. Adding commandTimeout:N fights that — commands that sit in
    // the offline queue for >N ms are hard-rejected with "Command timed out"
    // even though they would succeed once the connection is re-established.
    // This was the direct cause of the production "Command timed out" storm.
    //
    // BullMQ's own blocking BLMOVE has a 5 s server-side timeout, so in normal
    // operation no command ever waits longer than ~5 s. connectTimeout below
    // covers the initial TCP handshake deadline separately.

    connectTimeout: 10_000,
    lazyConnect: true,
    connectionName: "bullmq-shared",
  });

  try {
    await client.connect();
  } catch (err: any) {
    throw new Error(
      `Failed to connect shared BullMQ Redis client (${err.message}). ` +
      `Falling back to setInterval workers.`
    );
  }

  _sharedClient = client;
  _usingMock = false;

  return _sharedClient as unknown as ConnectionOptions;
}

/**
 * Expose the raw Redis instance for diagnostics (e.g. connection-count checks).
 * Returns null until getRedisConnection() has been called successfully.
 */
export function getSharedRedisClientIfReady(): Redis | null {
  return _sharedClient;
}

// ── Redis connection-capacity diagnostic ───────────────────────────────────────
//
// Connection-count model (BullMQ v5 + shared-client architecture):
//   • 1 shared IORedis client for ALL Queue non-blocking ops AND Worker non-blocking ops
//   • 1 blocking connection per instantiated Worker (internal .duplicate() — unavoidable)
//
// Formula for this process:
//   estimatedProcessConnections = sharedClientCount + physicalWorkerCount
//
// With 23 instantiated Workers: 1 + 23 = 24 connections from this process.
// When legacy GHL sync is claimed (GHL_SYNC Worker not instantiated): 1 + 22 = 23.
//
// Fleet estimate (optional, requires REDIS_DEPLOYMENT_PROCESS_COUNT env var):
//   estimatedFleetConnections = estimatedProcessConnections × deploymentProcessCount
//
// Capacity status requires a known limit (REDIS_CONNECTION_LIMIT env var).
// Without it, status is always "unknown" — we never assert "safe" on guesswork.
//
// NOTE: observedAccountConnectedClients comes from Redis INFO clients and reflects
// ALL clients on the Redis server/account, not just this process. Label it accordingly.

export type CapacityStatus = "safe" | "warning" | "unsafe" | "unknown";

export interface RedisCapacityDiagnosis {
  physicalWorkerCount: number;
  sharedClientCount: number;
  estimatedProcessConnections: number;
  observedAccountConnectedClients: number | null;
  configuredConnectionLimit: number | null;
  configuredWarningHeadroom: number | null;
  deploymentProcessCount: number | null;
  estimatedFleetConnections: number | null;
  status: CapacityStatus;
  reasons: string[];
  capturedAt: string;
}

export interface DiagnoseRedisCapacityOpts {
  physicalWorkerCount: number;
  sharedClientCount?: number;                          // default 1
  observedAccountConnectedClients?: number | null;
  configuredConnectionLimit?: number | null;
  configuredWarningHeadroom?: number | null;
  deploymentProcessCount?: number | null;
}

export function diagnoseRedisCapacity(opts: DiagnoseRedisCapacityOpts): RedisCapacityDiagnosis {
  const {
    physicalWorkerCount,
    sharedClientCount = 1,
    observedAccountConnectedClients = null,
    configuredWarningHeadroom = null,
  } = opts;

  // Read connection limit from env var only — never hardcode a provider plan value.
  // Strict integer validation: only accept strings matching /^\d+$/ (no decimals,
  // no negative signs, no leading non-digit characters). "1.5" → rejected, "1abc" → rejected.
  const rawLimitStr = (process.env.REDIS_CONNECTION_LIMIT ?? "").trim();
  const rawLimit = /^\d+$/.test(rawLimitStr) ? parseInt(rawLimitStr, 10) : NaN;
  const configuredConnectionLimit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : (opts.configuredConnectionLimit ?? null);

  // Read fleet process count from env var — null until explicitly supplied.
  const rawProcCount = parseInt(process.env.REDIS_DEPLOYMENT_PROCESS_COUNT ?? "", 10);
  const deploymentProcessCount =
    Number.isFinite(rawProcCount) && rawProcCount > 0
      ? rawProcCount
      : (opts.deploymentProcessCount ?? null);

  const estimatedProcessConnections = sharedClientCount + physicalWorkerCount;
  const estimatedFleetConnections =
    deploymentProcessCount !== null ? estimatedProcessConnections * deploymentProcessCount : null;

  const capturedAt = new Date().toISOString();
  const reasons: string[] = [];
  let status: CapacityStatus = "unknown";

  if (configuredConnectionLimit === null) {
    reasons.push(
      "REDIS_CONNECTION_LIMIT env var not set — cannot determine capacity status. " +
      "Set it to the documented limit for your Redis provider/plan to enable capacity monitoring."
    );
    status = "unknown";
  } else {
    // Use the higher of observed account clients and the fleet estimate as the comparison point.
    const comparisonCount = Math.max(
      observedAccountConnectedClients ?? 0,
      estimatedFleetConnections ?? estimatedProcessConnections
    );

    const headroom = configuredConnectionLimit - comparisonCount;
    const warningThreshold =
      configuredWarningHeadroom !== null
        ? configuredWarningHeadroom
        : Math.ceil(configuredConnectionLimit * 0.1); // default 10% headroom

    if (comparisonCount > configuredConnectionLimit) {
      status = "unsafe";
      reasons.push(
        `Comparison count (${comparisonCount}) exceeds configured limit (${configuredConnectionLimit}) ` +
        `by ${comparisonCount - configuredConnectionLimit}.`
      );
    } else if (headroom < warningThreshold) {
      status = "warning";
      reasons.push(
        `Headroom (${headroom}) is below warning threshold (${warningThreshold}) ` +
        `against configured limit (${configuredConnectionLimit}).`
      );
    } else {
      status = "safe";
      reasons.push(
        `Estimated process connections: ${estimatedProcessConnections}. ` +
        (estimatedFleetConnections !== null
          ? `Fleet estimate: ${estimatedFleetConnections}. `
          : "") +
        `Configured limit: ${configuredConnectionLimit}. Headroom: ${headroom}.`
      );
    }

    if (observedAccountConnectedClients !== null) {
      reasons.push(
        `Observed connected_clients (server-wide, not process-local): ${observedAccountConnectedClients}.`
      );
    }
  }

  return {
    physicalWorkerCount,
    sharedClientCount,
    estimatedProcessConnections,
    observedAccountConnectedClients,
    configuredConnectionLimit,
    configuredWarningHeadroom,
    deploymentProcessCount,
    estimatedFleetConnections,
    status,
    reasons,
    capturedAt,
  };
}
