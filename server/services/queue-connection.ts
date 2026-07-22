import type { ConnectionOptions } from "bullmq";
import Redis from "ioredis";

let _connection: ConnectionOptions | null = null;
let _usingMock = false;

export function isUsingMockRedis(): boolean {
  return _usingMock;
}

export async function getRedisConnection(): Promise<ConnectionOptions> {
  if (_connection) return _connection;

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

  const opts: ConnectionOptions = {
    host: url.hostname,
    port: parseInt(url.port || "6379", 10),
    password: url.password || undefined,
    username: url.username || undefined,
    tls: forceTls ? {} : undefined,

    // ── BullMQ REQUIRED settings ──────────────────────────────────────────
    // BullMQ's ioredis clients MUST have maxRetriesPerRequest=null. Without it,
    // ioredis throws after a fixed number of retries on a single command, causing
    // BullMQ's lock-renewal commands to throw instead of waiting for reconnect —
    // which manifests as "could not renew lock" / "Missing lock" errors.
    maxRetriesPerRequest: null,
    // BullMQ calls WAIT/LISTEN, which trigger the ready-check timeout in some
    // Redis providers. Disabling avoids false "ready check failed" disconnects.
    enableReadyCheck: false,

    // ── Connection stability settings ─────────────────────────────────────
    // Send TCP keepalive probes so the OS doesn't silently drop idle
    // connections (root cause of ECONNRESET on lock renewal commands).
    keepAlive: 30_000,
    // Re-connect automatically on ECONNRESET / ETIMEDOUT / EPIPE.
    // EPIPE (broken-pipe) fires when the TCP write buffer is flushed to a
    // server that already closed its socket — common on Upstash when an idle
    // connection is culled server-side without a FIN. Without "epipe" here
    // ioredis would surface the error to callers instead of reconnecting.
    reconnectOnError: (err: Error) => {
      const msg = err.message.toLowerCase();
      return (
        msg.includes("econnreset") ||
        msg.includes("etimedout") ||
        msg.includes("econnrefused") ||
        msg.includes("epipe")
      );
    },
    // How long to wait between reconnect attempts (capped at 5 s).
    retryStrategy: (times: number) => Math.min(times * 500, 5000),
    // Queue commands during brief disconnects so in-flight BullMQ operations
    // survive transient Redis blips without needing a full job re-queue.
    enableOfflineQueue: true,
    // Hard deadline for any single Redis command.  Without this, a stalled
    // command (e.g. a BullMQ WAIT on a freed-but-not-yet-reconnected socket)
    // can hang indefinitely and block the Node.js event loop.
    commandTimeout: 10_000,
    // Give up waiting for the initial TCP connection after 10 s.
    connectTimeout: 10_000,
    lazyConnect: true,
  };

  // Smoke-test the connection before handing it to BullMQ.
  // If Redis rejects authentication (WRONGPASS) or is unreachable, we throw here
  // so server/index.ts can cleanly fall back to setInterval workers.
  // Without this check, BullMQ holds the bad connection and logs WRONGPASS on every
  // queue operation forever — the fallback never triggers.
  const probe = new Redis({
    host: opts.host as string,
    port: opts.port as number,
    password: opts.password,
    username: opts.username,
    tls: forceTls ? {} : undefined,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableReadyCheck: false,
  });

  try {
    await probe.connect();
    await probe.ping();
    console.log("[Queue] Redis smoke-test passed — handing connection to BullMQ");
  } catch (err: any) {
    probe.disconnect();
    throw new Error(
      `Redis connection smoke-test failed (${err.message}). ` +
      `Falling back to setInterval workers. Check REDIS_URL credentials.`
    );
  } finally {
    probe.disconnect();
  }

  _connection = opts;
  _usingMock = false;

  return _connection;
}

// ── Redis connection-capacity diagnostic ───────────────────────────────────────

export interface RedisCapacityDiagnosis {
  /** Maximum concurrent connections on the Upstash free tier. */
  upstashFreeTierMax: number;
  /** Number of BullMQ queues being diagnosed. */
  queues: number;
  /**
   * Estimated ioredis connections BullMQ will open.
   *
   * BullMQ opens connections per queue as follows:
   *   • 1 producer  connection per Queue instance
   *   • 1 worker    connection per Worker instance
   *   • 1 events    connection per QueueEvents instance (optional but common)
   *   • 1 scheduler connection shared across all repeat-job queues
   *
   * Minimum estimate: queues × 3 + 1 scheduler.
   * Upstash free tier cap: 20 simultaneous connections.
   * With 7 named queues (ghl-sync, sla-checks, sequences, enrichment,
   * discovery, digests, mid-ingestion): 7 × 3 + 1 = 22 connections →
   * EXCEEDS the free tier limit.  Upgrade to Upstash Pay-As-You-Go or
   * reduce queue count by consolidating low-frequency queues.
   */
  estimatedBullMqConnections: number;
  /** Whether the estimated connection count fits within the Upstash free tier. */
  safeForUpstashFree: boolean;
  /** Human-readable recommendation. */
  recommendation: string;
}

/**
 * Explain the expected BullMQ ioredis connection fan-out for a given number
 * of queues.  Used by the Operator Dashboard and pre-deploy diagnostics to
 * surface capacity issues before they cause ETIMEDOUT / EPIPE loops.
 *
 * The system fails closed when capacity is insufficient: if the Redis
 * connection smoke-test fails (wrong password, connection limit exceeded,
 * unreachable host), getRedisConnection() throws and server/index.ts falls
 * back to setInterval workers — no BullMQ queue processing occurs and all
 * outbound sends remain paused by the channel-gate flags.
 *
 * @param queueCount  Number of BullMQ named queues to account for.
 */
export function diagnoseRedisCapacity(queueCount: number): RedisCapacityDiagnosis {
  const UPSTASH_FREE_MAX = 20;
  // Per-queue: 1 producer + 1 worker + 1 events listener = 3 connections.
  // +1 for the shared repeat-job scheduler connection.
  const estimated = queueCount * 3 + 1;
  const safe = estimated <= UPSTASH_FREE_MAX;

  let recommendation: string;
  if (safe) {
    recommendation =
      `${queueCount} queue(s) × 3 connections + 1 scheduler = ${estimated} connections — ` +
      `within Upstash free-tier limit (${UPSTASH_FREE_MAX}).`;
  } else {
    const overage = estimated - UPSTASH_FREE_MAX;
    recommendation =
      `${queueCount} queue(s) × 3 connections + 1 scheduler = ${estimated} connections — ` +
      `EXCEEDS Upstash free-tier limit (${UPSTASH_FREE_MAX}) by ${overage}. ` +
      `Options: (1) upgrade to Upstash Pay-As-You-Go or Pro, ` +
      `(2) consolidate low-frequency queues (discovery + mid-ingestion share one queue), ` +
      `(3) use a self-hosted Redis instance with no connection cap.`;
  }

  return {
    upstashFreeTierMax: UPSTASH_FREE_MAX,
    queues: queueCount,
    estimatedBullMqConnections: estimated,
    safeForUpstashFree: safe,
    recommendation,
  };
}
