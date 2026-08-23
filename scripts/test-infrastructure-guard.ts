/**
 * Shared pre-import safety boundary for stateful tests and destructive cleanup.
 *
 * This module intentionally imports only `pg`; callers must await the assertion
 * before importing `server/db`, storage, workers, or any service that can open
 * the configured application database.
 */
import { Pool } from "pg";
import Redis from "ioredis";

export interface DisposableInfrastructureOptions {
  operation: string;
  requireRedis?: boolean;
}

function databaseName(connectionString: string): string {
  try {
    return decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
}

function isClearlyDisposableName(name: string): boolean {
  const normalized = name.toLowerCase();
  if (/(prod|production|live)/.test(normalized)) return false;
  return /(^|[_-])(test|ci)([_-]|$)|^(test|ci)[a-z0-9_-]*$/.test(normalized);
}

function testRedisPrefix(prefix: string | undefined, operation: string): string {
  if (!prefix) {
    throw new Error(`[${operation}] refused: TEST_REDIS_PREFIX is required for Redis isolation.`);
  }
  const normalized = prefix.trim();
  if (
    !/^(?:test|ci)[a-z0-9_-]*[_:]$/i.test(normalized) ||
    /(prod|production|live|bull)/i.test(normalized)
  ) {
    throw new Error(
      `[${operation}] refused: TEST_REDIS_PREFIX must be an isolated test/CI namespace ending in "_" or ":".`,
    );
  }
  return normalized;
}

/**
 * Proves this process is intentionally pointed at a disposable database before
 * an application module can initialize its normal connection pool.
 */
export async function assertDisposableTestInfrastructure(
  options: DisposableInfrastructureOptions,
): Promise<{ databaseName: string }> {
  const prefix = `[${options.operation}]`;
  const activeUrl = process.env.DATABASE_URL;
  const testUrl = process.env.TEST_DATABASE_URL;

  if (process.env.NODE_ENV !== "test") {
    throw new Error(`${prefix} refused: NODE_ENV must be "test".`);
  }
  if (!activeUrl || !testUrl || activeUrl !== testUrl) {
    throw new Error(
      `${prefix} refused: DATABASE_URL and TEST_DATABASE_URL must both be set and exactly equal.`,
    );
  }
  if (
    process.env.PRODUCTION_DATABASE_URL &&
    process.env.PRODUCTION_DATABASE_URL === testUrl
  ) {
    throw new Error(`${prefix} refused: TEST_DATABASE_URL matches PRODUCTION_DATABASE_URL.`);
  }

  const expectedName = databaseName(testUrl);
  if (!isClearlyDisposableName(expectedName)) {
    throw new Error(
      `${prefix} refused: database "${expectedName}" is not clearly named as a test or CI database.`,
    );
  }

  const redisPrefix = options.requireRedis
    ? testRedisPrefix(process.env.TEST_REDIS_PREFIX, options.operation)
    : undefined;
  if (options.requireRedis) {
    if (!process.env.REDIS_URL) {
      throw new Error(`${prefix} refused: REDIS_URL is required for this stateful test.`);
    }
    if (
      process.env.PRODUCTION_REDIS_URL &&
      process.env.PRODUCTION_REDIS_URL === process.env.REDIS_URL
    ) {
      throw new Error(`${prefix} refused: REDIS_URL matches PRODUCTION_REDIS_URL.`);
    }
  }

  const probe = new Pool({ connectionString: testUrl, max: 1 });
  try {
    const result = await probe.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    const actualName = result.rows[0]?.database_name ?? "";
    if (actualName !== expectedName || !isClearlyDisposableName(actualName)) {
      throw new Error(
        `${prefix} refused: connected database "${actualName}" does not match the verified disposable target.`,
      );
    }
    if (options.requireRedis && redisPrefix) {
      // Exercise the exact namespace CI/tests will give BullMQ. This is safe on
      // a shared Redis endpoint because the guard refuses generic/live prefixes.
      const redis = new Redis(process.env.REDIS_URL!, {
        connectTimeout: 5_000,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      });
      const key = `${redisPrefix}infrastructure_guard:${process.pid}:${Date.now()}`;
      try {
        await redis.connect();
        await redis.set(key, "verified", "PX", 30_000);
        if (await redis.get(key) !== "verified") {
          throw new Error(`${prefix} refused: Redis namespace probe did not round-trip.`);
        }
        await redis.del(key);
      } finally {
        redis.disconnect();
      }
      console.log(`${prefix} disposable Redis namespace confirmed: ${redisPrefix}`);
    }
    console.log(`${prefix} disposable database confirmed: ${actualName}`);
    return { databaseName: actualName };
  } finally {
    await probe.end().catch(() => undefined);
  }
}