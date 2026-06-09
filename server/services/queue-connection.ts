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
