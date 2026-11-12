#!/usr/bin/env npx tsx
/**
 * Builds the matched-performance / bundled-rollback baseline used by
 * scripts/test-stage3-c4-browser.ts (fixtures stage3-c4-matched-performance.ts
 * and stage3-c4-bundled-rollback.ts).
 *
 * The baseline is the production build of the recorded reference commit
 * (C4_PERFORMANCE_BASELINE_COMMIT in scripts/fixtures/c4-performance-baseline.ts),
 * checked out as a detached Git worktree and compiled with the same locked
 * node_modules as the candidate. It is written to
 * generated-artifacts/c4-performance-baseline, inside the workspace, so it
 * survives a restart; that directory is ignored by Git and by deployment.
 *
 * Usage:
 *   npx tsx scripts/build-c4-performance-baseline.ts [--force]
 *
 * Without --force, an existing baseline whose receipt names the reference commit
 * and whose emitted outputs still hash as recorded is kept. Otherwise it is
 * removed and rebuilt.
 *
 * The compile always runs in production mode. CI runs this same script (ci.yml, c4-acceptance.yml); under
 * VG_PROVIDER_DENY_MODE=1 the compile also runs with the compiler-only certification deny preload. A kept
 * baseline is accepted only if its emitted client is a production build.
 *
 * Run this before the browser suite; the suite itself never compiles, because the
 * disposable certification runner denies production compilation:
 *   npx tsx scripts/build-c4-performance-baseline.ts
 *   npx tsx scripts/run-sfp2060-predeploy-disposable.ts --only scripts/test-stage3-c4-browser.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { readFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import {
  C4_PERFORMANCE_BASELINE_COMMIT,
  c4PerformanceBaselineRoot,
  verifyC4PerformanceBaseline,
} from "./fixtures/c4-performance-baseline";

const git = (args: string[], cwd = process.cwd()) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

async function main() {
  const root = c4PerformanceBaselineRoot();
  const workspace = process.cwd();
  if (root === workspace || workspace.startsWith(root + path.sep)) {
    throw new Error(`Refusing to use ${root} as the baseline directory: it contains the workspace`);
  }

  if (!process.argv.includes("--force")) {
    try {
      const identity = await verifyC4PerformanceBaseline(root);
      console.log(`C4 baseline already built at ${root} from ${identity.sourceHead} (${identity.outputs.length} outputs verified)`);
      return;
    } catch (error) {
      console.log(`Rebuilding C4 baseline: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    git(["cat-file", "-e", `${C4_PERFORMANCE_BASELINE_COMMIT}^{commit}`]);
  } catch {
    console.log(`Fetching ${C4_PERFORMANCE_BASELINE_COMMIT} from origin`);
    git(["fetch", "origin", C4_PERFORMANCE_BASELINE_COMMIT]);
  }

  // Drop any previous checkout (the node_modules link is removed, not followed), then let Git forget
  // its registration whether or not the directory still existed.
  if (existsSync(root)) await rm(root, { recursive: true, force: true });
  git(["worktree", "prune"]);

  git(["worktree", "add", "--detach", root, C4_PERFORMANCE_BASELINE_COMMIT]);
  await symlink(realpathSync(path.join(workspace, "node_modules")), path.join(root, "node_modules"), "dir");

  console.log(`Compiling ${C4_PERFORMANCE_BASELINE_COMMIT} in ${root}`);
  // The reference commit's script/build.ts does not set NODE_ENV itself, so production mode must come from
  // here: a test-mode compile would emit React's development build and make the speed comparison meaningless.
  // `npm run build` is `tsx script/build.ts`; run that script through tsx's loader instead of its CLI because
  // the compiler-only deny preload blocks the CLI's own IPC socket in a production-mode process.
  const buildScript = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).scripts?.build;
  assert.equal(buildScript, "tsx script/build.ts", "The reference commit's build script changed; update this builder");
  const denyMode = process.env.VG_PROVIDER_DENY_MODE === "1";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    ...(denyMode ? {
      CERTIFICATION_COMPILER_ONLY: "1",
      CERTIFICATION_ALLOWED_NETWORK_ORIGINS: "",
      CERTIFICATION_ALLOW_LOOPBACK: "0",
    } : {}),
  };
  const nodeArgs = [
    ...(denyMode ? ["--require", path.join(workspace, "scripts/certification-provider-deny-preload.cjs")] : []),
    "--import", "tsx", "script/build.ts",
  ];
  execFileSync(process.execPath, nodeArgs, { cwd: root, stdio: "inherit", env });

  const identity = await verifyC4PerformanceBaseline(root);
  console.log(`C4 baseline built at ${root} from ${identity.sourceHead} (${identity.outputs.length} outputs verified)`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
