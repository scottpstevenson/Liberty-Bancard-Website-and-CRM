/**
 * Shared pre-import safety boundary for stateful tests and destructive cleanup.
 *
 * This module intentionally imports only `pg`; callers must await the assertion
 * before importing `server/db`, storage, workers, or any service that can open
 * the configured application database.
 */
import { Pool } from "pg";
import Redis from "ioredis";
import { randomUUID } from "node:crypto";

export interface DisposableInfrastructureOptions {
  operation: string;
  requireRedis?: boolean;
  reserveRedisNamespace?: boolean;
}

export interface DisposableInfrastructureAssertion {
  databaseName: string;
  releaseRedisReservation: () => Promise<void>;
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

function assertReservationEntropy(prefix: string, operation: string): void {
  if (!/[a-f0-9]{24,}/i.test(prefix)) {
    throw new Error(
      `[${operation}] refused: reserved TEST_REDIS_PREFIX must contain a per-run high-entropy nonce.`,
    );
  }
}

function createRedisClient(redisUrl = process.env.REDIS_URL!): Redis {
  return new Redis(redisUrl, {
    connectTimeout: 5_000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
}

async function releaseRedisReservation(
  redisUrl: string,
  reservationKey: string,
  reservationToken: string,
): Promise<void> {
  const redis = createRedisClient(redisUrl);
  try {
    await redis.connect();
    await redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then
         return redis.call("del", KEYS[1])
       end
       return 0`,
      1,
      reservationKey,
      reservationToken,
    );
  } finally {
    redis.disconnect();
  }
}

/**
 * Proves this process is intentionally pointed at a disposable database before
 * an application module can initialize its normal connection pool.
 */
export async function assertDisposableTestInfrastructure(
  options: DisposableInfrastructureOptions,
): Promise<DisposableInfrastructureAssertion> {
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
  if (options.reserveRedisNamespace && !options.requireRedis) {
    throw new Error(`${prefix} refused: Redis reservation requires requireRedis=true.`);
  }
  if (options.reserveRedisNamespace && redisPrefix) {
    assertReservationEntropy(redisPrefix, options.operation);
  }
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
  let releaseReservation = async (): Promise<void> => {};
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
      const redis = createRedisClient();
      const key = `${redisPrefix}infrastructure_guard:${process.pid}:${Date.now()}`;
      try {
        await redis.connect();
        if (options.reserveRedisNamespace) {
          const redisUrl = process.env.REDIS_URL!;
          const reservationKey = `${redisPrefix}__certification_namespace_reservation`;
          const reservationToken = randomUUID();
          const acquired = await redis.set(
            reservationKey,
            reservationToken,
            "PX",
            2 * 60 * 60 * 1000,
            "NX",
          );
          if (acquired !== "OK") {
            throw new Error(
              `${prefix} refused: Redis namespace is already reserved by another certification process.`,
            );
          }
          releaseReservation = () =>
            releaseRedisReservation(redisUrl, reservationKey, reservationToken);

          let cursor = "0";
          const staleKeys: string[] = [];
          do {
            const [nextCursor, keys] = await redis.scan(
              cursor,
              "MATCH",
              `${redisPrefix}*`,
              "COUNT",
              100,
            );
            cursor = nextCursor;
            staleKeys.push(...keys.filter((candidate) => candidate !== reservationKey));
          } while (cursor !== "0" && staleKeys.length === 0);
          if (staleKeys.length > 0) {
            await releaseReservation();
            releaseReservation = async () => {};
            throw new Error(
              `${prefix} refused: Redis namespace contains pre-existing keys and may be reused.`,
            );
          }
        }
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
    return {
      databaseName: actualName,
      releaseRedisReservation: releaseReservation,
    };
  } catch (error) {
    await releaseReservation().catch(() => undefined);
    throw error;
  } finally {
    await probe.end().catch(() => undefined);
  }
}