#!/usr/bin/env npx tsx
/**
 * BT-06 cleanup guard regression test.
 * Verifies that both destructive utility scripts refuse to run unless a
 * declared test database is the active connection.
 */
import { spawnSync } from "child_process";

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
  const guarded = result.status !== 0 && output.includes("BT-06 KILL LINE");
  if (guarded) {
    console.log(`  PASS ${script} refuses a non-test invocation`);
  } else {
    failed++;
    console.error(`  FAIL ${script} did not refuse a non-test invocation`);
  }
}

if (failed) process.exit(1);
console.log("\n✓ BT-06 cleanup guard regression tests passed.");