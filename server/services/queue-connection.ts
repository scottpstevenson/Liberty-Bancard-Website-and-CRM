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

export interface RedisCapacityDiagnosis {
  upstashFreeTierMax: number;
  queues: number;
  /**
   * Estimated ioredis connections with the shared-client architecture:
   *   • 1 shared client (all Queue instances + all Worker non-blocking ops)
   *   • 1 blocking connection per Worker (internal .duplicate() — unavoidable)
   *
   * Formula: 1 + queueCount
   *
   * With 11 named queues: 1 + 11 = 12 connections — well within the free tier.
   *
   * BEFORE the shared-client fix, BullMQ created connections per-Queue and
   * per-Worker (plain ConnectionOptions object): queueCount × 3 = 33 connections
   * for 11 queues, which exceeded the Upstash free-tier limit of 20 and caused
   * the "Command timed out" storm.
   */
  estimatedBullMqConnections: number;
  safeForUpstashFree: boolean;
  recommendation: string;
}

export function diagnoseRedisCapacity(queueCount: number): RedisCapacityDiagnosis {
  const UPSTASH_FREE_MAX = 20;
  // 1 shared client + 1 blocking connection per Worker (via internal .duplicate())
  const estimated = 1 + queueCount;
  const safe = estimated <= UPSTASH_FREE_MAX;

  let recommendation: string;
  if (safe) {
    recommendation =
      `Shared-client architecture: 1 shared connection + ${queueCount} Worker blocking connections = ` +
      `${estimated} total — within Upstash free-tier limit (${UPSTASH_FREE_MAX}). ✓`;
  } else {
    const overage = estimated - UPSTASH_FREE_MAX;
    recommendation =
      `Shared-client architecture: 1 shared + ${queueCount} Worker blocking = ` +
      `${estimated} connections — EXCEEDS free-tier limit (${UPSTASH_FREE_MAX}) by ${overage}. ` +
      `Options: (1) upgrade to Upstash Pay-As-You-Go, ` +
      `(2) reduce Worker count by consolidating low-frequency queues.`;
  }

  return {
    upstashFreeTierMax: UPSTASH_FREE_MAX,
    queues: queueCount,
    estimatedBullMqConnections: estimated,
    safeForUpstashFree: safe,
    recommendation,
  };
}
