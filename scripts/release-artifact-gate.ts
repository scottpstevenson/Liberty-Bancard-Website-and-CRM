#!/usr/bin/env tsx
/**
 * Release artifact gate: typecheck, make a fresh production build, then scan
 * its server and public artifacts without ever logging matched secret values.
 */
import { spawnSync } from "node:child_process";

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status ?? "with a signal"}`);
  }
}

try {
  run("npx", ["tsc", "--noEmit"]);
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]);
  run("npx", ["tsx", "scripts/inventory-artifact-dependencies.ts", "--output", "dist/dependency-inventory.json"]);
  run("npx", ["tsx", "scripts/scan-build-artifacts.ts"]);
  console.log("release-artifact-gate: PASS — typecheck, production build, dependency inventory, and redacting artifact scan completed");
} catch (error) {
  console.error(
    `release-artifact-gate: FAIL — ${error instanceof Error ? error.message : "release artifact gate failed"}`,
  );
  process.exitCode = 1;
}