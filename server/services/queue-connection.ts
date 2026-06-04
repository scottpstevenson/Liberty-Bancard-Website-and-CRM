import type { ConnectionOptions } from "bullmq";

let _connection: ConnectionOptions | null = null;
let _usingMock = false;

export function isUsingMockRedis(): boolean {
  return _usingMock;
}

export async function getRedisConnection(): Promise<ConnectionOptions> {
  if (_connection) return _connection;

  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    console.log("[Queue] Connecting to Redis:", redisUrl.replace(/:\/\/.*@/, "://***@"));
    const url = new URL(redisUrl);
    // Force TLS for Upstash (and any rediss:// URL). Upstash only accepts TLS
    // connections but sometimes the URL is copied with redis:// instead of rediss://.
    const forceTls = url.protocol === "rediss:" || url.hostname.includes("upstash.io");
    _connection = {
      host: url.hostname,
      port: parseInt(url.port || "6379", 10),
      password: url.password || undefined,
      username: url.username || undefined,
      tls: forceTls ? {} : undefined,
    };
    _usingMock = false;
  } else {
    throw new Error(
      "REDIS_URL is not set. BullMQ requires a real Redis connection. " +
      "Falling back to setInterval workers. Set REDIS_URL for durable job queues."
    );
  }

  return _connection;
}
