#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

const originalPrefix = process.env.TEST_REDIS_PREFIX;
const prefix = `ci_certification_reservation_${randomUUID().replace(/-/g, "")}_`;
process.env.TEST_REDIS_PREFIX = prefix;

const first = await assertDisposableTestInfrastructure({
  operation: "Certification Redis reservation first owner",
  requireRedis: true,
  reserveRedisNamespace: true,
});
try {
  await assert.rejects(
    () =>
      assertDisposableTestInfrastructure({
        operation: "Certification Redis reservation collision",
        requireRedis: true,
        reserveRedisNamespace: true,
      }),
    /already reserved/,
  );
} finally {
  await first.releaseRedisReservation();
}

const redis = new Redis(process.env.REDIS_URL!, {
  connectTimeout: 5_000,
  maxRetriesPerRequest: 1,
  lazyConnect: true,
});
const staleKey = `${prefix}stale-job`;
try {
  await redis.connect();
  await redis.set(staleKey, "stale", "PX", 60_000);
  await assert.rejects(
    () =>
      assertDisposableTestInfrastructure({
        operation: "Certification Redis stale namespace",
        requireRedis: true,
        reserveRedisNamespace: true,
      }),
    /pre-existing keys/,
  );
  await redis.del(staleKey);
} finally {
  redis.disconnect();
  if (originalPrefix === undefined) delete process.env.TEST_REDIS_PREFIX;
  else process.env.TEST_REDIS_PREFIX = originalPrefix;
}

console.log("Certification Redis namespace collision and stale-key guards passed.");