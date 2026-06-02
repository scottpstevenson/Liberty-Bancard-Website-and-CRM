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
    _connection = {
      host: url.hostname,
      port: parseInt(url.port || "6379", 10),
      password: url.password || undefined,
      username: url.username || undefined,
      tls: url.protocol === "rediss:" ? {} : undefined,
    };
    _usingMock = false;
  } else {
    console.warn(
      "[WARN] REDIS_URL not set — using ioredis-mock (jobs are ephemeral and will be lost on restart). " +
      "Set REDIS_URL to a real Redis connection string for production durability."
    );
    const { default: RedisMock } = await import("ioredis-mock");
    const mockClient = new RedisMock();
    _connection = mockClient as unknown as ConnectionOptions;
    _usingMock = true;
  }

  return _connection;
}
