#!/usr/bin/env npx tsx
/**
 * Executes manifest-classified CI suites without invoking the production
 * pre-deploy gate.  The production gate has operational pause/audit side
 * effects; CI must run only on disposable infrastructure and own no release
 * state.
 */
import type { ChildProcess } from "node:child_process";
import {
  SUITE_MANIFEST,
  type SuiteCapability,
  type SuiteManifestEntry,
} from "./ci-suite-manifest";
import { spawnCertificationTsx } from "./certification-child-process";
import { assertCertificationServerReady } from "./certification-server-readiness";

const RUNNABLE_CAPABILITIES = new Set<SuiteCapability>([
  "deterministic-static",
  "deterministic-integration",
  "server-required",
]);

function parseCapabilities(): SuiteCapability[] {
  const args = process.argv.slice(2);
  const selected: SuiteCapability[] = [];

  for (let index = 0; index < args.length; index++) {
    if (args[index] !== "--capability") continue;
    const capability = args[index + 1] as SuiteCapability | undefined;
    if (!capability || !RUNNABLE_CAPABILITIES.has(capability)) {
      throw new Error(
        `--capability must be one of: ${[...RUNNABLE_CAPABILITIES].join(", ")}`,
      );
    }
    selected.push(capability);
    index++;
  }

  if (selected.length !== 1) {
    throw new Error("Provide exactly one --capability value.");
  }
  return selected;
}

function runSuite(suite: SuiteManifestEntry, capability: SuiteCapability): Promise<void> {
  const timeoutMs = Number(process.env.CI_SUITE_TIMEOUT_MS ?? 300_000);
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawnCertificationTsx(
      "scripts/run-denied-certification-suite.ts",
      [suite.script, capability],
    );
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${suite.name} exceeded the ${timeoutMs}ms CI suite timeout.`));
    }, timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`${suite.name} could not start: ${error.message}`));
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${suite.name} failed (exit=${code ?? "null"}, signal=${signal ?? "none"}).`));
    });
  });
}

async function main(): Promise<void> {
  const [capability] = parseCapabilities();
  const suites = SUITE_MANIFEST.filter((suite) => suite.capability === capability);
  if (suites.length === 0) throw new Error(`No suites registered for ${capability}.`);

  if (capability !== "deterministic-static") {
    const { assertDisposableTestInfrastructure } = await import("./test-infrastructure-guard");
    await assertDisposableTestInfrastructure({
      operation: `CI ${capability}`,
      requireRedis: true,
    });
  }
  if (capability === "server-required") {
    await assertCertificationServerReady(
      process.env.BASE_URL ?? "http://127.0.0.1:5000",
    );
  }

  console.log(`\n══ CI ${capability}: ${suites.length} required suite(s) ══`);
  for (const [index, suite] of suites.entries()) {
    console.log(`\n[${index + 1}/${suites.length}] ${suite.name} — ${suite.script}`);
    await runSuite(suite, capability);
  }
  console.log(`\n✓ CI ${capability} completed: ${suites.length}/${suites.length} suites passed.`);
}

main().catch((error) => {
  console.error(`\n✗ CI suite runner failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});