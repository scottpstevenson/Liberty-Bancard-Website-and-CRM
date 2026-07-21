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
    // Re-connect automatically on ECONNRESET / ETIMEDOUT.
    reconnectOnError: (err: Error) => {
      const msg = err.message.toLowerCase();
      return msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("econnrefused");
    },
    // How long to wait between reconnect attempts (capped at 5 s).
    retryStrategy: (times: number) => Math.min(times * 500, 5000),
    // Queue commands during brief disconnects so in-flight BullMQ operations
    // survive transient Redis blips without needing a full job re-queue.
    enableOfflineQueue: true,
    // Give up waiting for a command after 10 s when offline queue is disabled
    // for non-BullMQ callers (probe below).
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
