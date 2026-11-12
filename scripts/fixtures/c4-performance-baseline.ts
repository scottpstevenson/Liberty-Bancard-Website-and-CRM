import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Recorded reference commit for the C4 matched-performance and bundled-rollback
 * baselines: the last commit before the C4 client changes. The baseline build is
 * produced from it by scripts/build-c4-performance-baseline.ts. */
export const C4_PERFORMANCE_BASELINE_COMMIT = "85296699ec8d11f22750657dfe5ac34a8fd2577d";

export const C4_PERFORMANCE_BASELINE_BUILD_COMMAND = "npx tsx scripts/build-c4-performance-baseline.ts";

/** Inside the workspace, so it survives a restart; /generated-artifacts/ is ignored by Git and by deployment.
 * The certification runner passes suites a filtered environment, so the location is fixed, not configurable. */
export function c4PerformanceBaselineRoot(): string {
  return path.resolve("generated-artifacts/c4-performance-baseline");
}

export type C4BaselineIdentity = {
  sourceHead: string;
  outputs: Array<{ file: string; sha256: string }>;
  outputHash: string;
};

/** The reference commit's receipt records no build mode, so check the emitted client itself. React's
 * development build, and Vite's development JSX transform, only appear when the compile did not run in
 * production mode; a production build contains neither. */
const DEVELOPMENT_CLIENT_MARKERS = ["Download the React DevTools for a better development experience", "jsxDEV"];

async function assertProductionClient(root: string, hint: string): Promise<void> {
  const assets = path.join(root, "dist/public/assets");
  let scripts: string[];
  try {
    scripts = (await readdir(assets)).filter(file => file.endsWith(".js"));
  } catch {
    throw new Error(`${hint}: ${assets} is missing`);
  }
  assert.ok(scripts.length > 0, `${hint}: no client scripts were emitted`);
  for (const file of scripts) {
    const source = await readFile(path.join(assets, file), "utf8");
    for (const marker of DEVELOPMENT_CLIENT_MARKERS) {
      assert.ok(!source.includes(marker), `${hint}: ${file} is a development-mode client (found "${marker}"), not production`);
    }
  }
}

/** Reads the baseline receipt and verifies it names the recorded commit, that every emitted output still
 * has the recorded hash, and that the client was compiled in production mode. Fails with the command
 * that rebuilds it. */
export async function verifyC4PerformanceBaseline(root = c4PerformanceBaselineRoot()): Promise<C4BaselineIdentity> {
  const hint = `Baseline build ${root} is missing or stale. Rebuild it with: ${C4_PERFORMANCE_BASELINE_BUILD_COMMAND}`;
  let identity: C4BaselineIdentity;
  try {
    identity = JSON.parse(await readFile(path.join(root, "dist/candidate-integrity.json"), "utf8"));
  } catch (error) {
    throw new Error(`${hint} (${error instanceof Error ? error.message : String(error)})`);
  }
  assert.equal(identity.sourceHead, C4_PERFORMANCE_BASELINE_COMMIT, `${hint}: receipt names a different commit`);
  for (const output of identity.outputs) {
    let bytes: Buffer;
    try {
      bytes = await readFile(path.join(root, output.file));
    } catch {
      throw new Error(`${hint}: emitted output ${output.file} is missing`);
    }
    assert.equal(createHash("sha256").update(bytes).digest("hex"), output.sha256, `${hint}: ${output.file} changed`);
  }
  await assertProductionClient(root, hint);
  return identity;
}
