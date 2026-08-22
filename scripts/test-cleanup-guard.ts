#!/usr/bin/env npx tsx
/**
 * BT-06 cleanup guard regression test.
 * Verifies that destructive utility scripts all rely on the shared pre-import
 * guard and refuse before their application database module can be loaded.
 */
import { spawnSync } from "child_process";
import { readFileSync } from "fs";

let failed = 0;
for (const script of [
  "scripts/cleanup-demo-data.ts",
  "scripts/purge-test-contacts.ts",
  "scripts/cleanup-test-data.ts",
  "scripts/cleanup-smoke-contacts.ts",
]) {
  const result = spawnSync("npx", ["tsx", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
      TEST_DATABASE_URL: "",
    },
  });
  const output = `${result.stdout}\n${result.stderr}`;
  const source = readFileSync(script, "utf8");
  const importsSharedGuard =
    source.includes('from "./test-infrastructure-guard"') &&
    source.indexOf("assertDisposableTestInfrastructure") <
      Math.min(
        ...["../server/db", "drizzle-orm"].map((needle) => {
          const index = source.indexOf(needle);
          return index === -1 ? Number.MAX_SAFE_INTEGER : index;
        }),
      );
  const guarded = result.status !== 0 && output.includes("refused") && importsSharedGuard;
  if (guarded) {
    console.log(`  PASS ${script} uses the pre-import guard and refuses a non-test invocation`);
  } else {
    failed++;
    console.error(`  FAIL ${script} did not enforce the shared pre-import guard`);
  }
}

const infrastructureGuard = readFileSync("scripts/test-infrastructure-guard.ts", "utf8");
const queueConnection = readFileSync("server/services/queue-connection.ts", "utf8");
const queueManager = readFileSync("server/services/queue-manager.ts", "utf8");
if (
  infrastructureGuard.includes("await redis.set(key, \"verified\"") &&
  infrastructureGuard.includes("TEST_REDIS_PREFIX must be an isolated test/CI namespace") &&
  queueConnection.includes("getBullMqTestPrefix") &&
  queueManager.includes("prefix: this.redisKeyPrefix")
) {
  console.log("  PASS stateful tests verify and enforce an isolated BullMQ Redis namespace");
} else {
  failed++;
  console.error("  FAIL stateful test Redis namespace isolation is incomplete");
}

if (failed) process.exit(1);
console.log("\n✓ BT-06 cleanup guard regression tests passed.");