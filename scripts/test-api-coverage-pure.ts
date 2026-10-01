#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeApiCoverage, endpointMatches, type ApiEndpoint } from "./check-api-coverage";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkScript = path.join(repoRoot, "scripts", "check-api-coverage.ts");
const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");

function createFixture(clientSource: string, serverPath: string, serverMethod = "get"): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "api-coverage-source-"));
  mkdirSync(path.join(root, "client", "src"), { recursive: true });
  mkdirSync(path.join(root, "server", "routes"), { recursive: true });
  writeFileSync(path.join(root, "client", "src", "fixture.ts"), clientSource);
  writeFileSync(
    path.join(root, "server", "routes.ts"),
    `import { registerFixtureRoutes } from "./routes/fixture";\n` +
      `export function registerRoutes(server: unknown, app: unknown) {\n` +
      `  registerFixtureRoutes(app);\n` +
      `}\n`,
  );
  writeFileSync(
    path.join(root, "server", "routes", "fixture.ts"),
    `const FIXTURE_PATH = ${JSON.stringify(serverPath)};\n` +
      `export function registerFixtureRoutes(app: any) {\n` +
      `  app\n` +
      `    .${serverMethod}(\n` +
      `      FIXTURE_PATH,\n` +
      `      (_req: unknown, _res: unknown) => undefined,\n` +
      `    );\n` +
      `}\n`,
  );
  return root;
}

function runCoverageFrom(cwd: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [tsxCli, checkScript], {
    cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function scannedCounts(output: string): [number, number] {
  const match = output.match(/Scanned (\d+) client API endpoints against (\d+) server handlers\./);
  assert.ok(match, `coverage output did not include a positive scan summary:\n${output}`);
  return [Number(match[1]), Number(match[2])];
}

function mustBeMissing(client: ApiEndpoint, serverPath: string, serverMethod = "GET"): void {
  const server: ApiEndpoint = { method: serverMethod, path: serverPath };
  assert.equal(endpointMatches(client, server), false, `${client.method} ${client.path} must not match ${server.method} ${server.path}`);
}

// Exact method and path-shape matching: parameters are supported, but neither
// a parent nor descendant route (nor a different method) covers an endpoint.
assert.equal(
  endpointMatches(
    { method: "GET", path: "/api/items/:param" },
    { method: "GET", path: "/api/items/:itemId" },
  ),
  true,
  "a parameterized client route should match the equivalent parameterized handler",
);
assert.equal(
  endpointMatches(
    { method: "GET", path: "/api/items/42" },
    { method: "GET", path: "/api/items/:itemId" },
  ),
  true,
  "a server parameter route should cover a concrete client segment",
);
mustBeMissing({ method: "GET", path: "/api/items" }, "/api/items/:id");
mustBeMissing({ method: "GET", path: "/api/items/:id/child" }, "/api/items");
mustBeMissing({ method: "POST", path: "/api/items" }, "/api/items", "GET");

const parameterizedRoot = createFixture(
  "fetch(`/api/items/${itemId}`);\n",
  "/api/items/:routeItemId",
);
try {
  const analysis = analyzeApiCoverage(parameterizedRoot);
  assert.equal(analysis.clientEndpoints.length, 1);
  assert.equal(analysis.serverEndpoints.length, 1);
  assert.equal(analysis.clientEndpoints[0].path, "/api/items/:param");
  assert.equal(analysis.serverEndpoints[0].path, "/api/items/:param");
  assert.deepEqual(analysis.missingEndpoints, [], "mounted route module, multiline registration, path constant, and parameter route must resolve");
} finally {
  rmSync(parameterizedRoot, { recursive: true, force: true });
}

for (const [clientSource, serverPath, method, label] of [
  ["fetch('/api/items');\n", "/api/items/:id", "get", "parent route"],
  ["fetch(`/api/items/${itemId}/child`);\n", "/api/items", "get", "descendant route"],
  ["fetch('/api/items', { method: 'POST' });\n", "/api/items", "get", "wrong method"],
] as const) {
  const root = createFixture(clientSource, serverPath, method);
  try {
    const analysis = analyzeApiCoverage(root);
    assert.equal(analysis.missingEndpoints.length, 1, `${label} must be reported as uncovered`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const missingRoot = mkdtempSync(path.join(os.tmpdir(), "api-coverage-missing-"));
try {
  assert.throws(
    () => analyzeApiCoverage(missingRoot),
    /API_COVERAGE_SOURCE_DIRECTORY_MISSING|API_COVERAGE_SOURCE_DISCOVERY/,
    "missing source copy must fail closed",
  );
} finally {
  rmSync(missingRoot, { recursive: true, force: true });
}

const brokenRoot = mkdtempSync(path.join(os.tmpdir(), "api-coverage-broken-"));
try {
  mkdirSync(path.join(brokenRoot, "client", "src"), { recursive: true });
  mkdirSync(path.join(brokenRoot, "server"), { recursive: true });
  writeFileSync(path.join(brokenRoot, "client", "src", "fixture.ts"), "fetch('/api/items');\n");
  writeFileSync(
    path.join(brokenRoot, "server", "routes.ts"),
    "export function registerRoutes(_server: unknown, _app: unknown) {}\n",
  );
  assert.throws(
    () => analyzeApiCoverage(brokenRoot),
    /API_COVERAGE_SERVER_DISCOVERY_EMPTY/,
    "a present but broken/incomplete source copy with zero handlers must fail closed",
  );
} finally {
  rmSync(brokenRoot, { recursive: true, force: true });
}

// The executable derives its repository root from its own source location.
// Running it from /tmp must discover exactly the same nonzero source counts
// and produce the same coverage status as running it from the repository root.
const analysis = analyzeApiCoverage(repoRoot);
const rootRun = runCoverageFrom(repoRoot);
const temporaryCwd = mkdtempSync(path.join(os.tmpdir(), "api-coverage-cwd-"));
try {
  const tempRun = runCoverageFrom(temporaryCwd);
  const rootCounts = scannedCounts(rootRun.output);
  const tempCounts = scannedCounts(tempRun.output);
  assert.deepEqual(rootCounts, tempCounts, "running the scanner from /tmp must use the same repository source root");
  assert.ok(rootCounts[0] > 0 && rootCounts[1] > 0, "root invocation must discover positive client and mounted-server counts");
  assert.deepEqual(rootCounts, [analysis.clientEndpoints.length, analysis.serverEndpoints.length]);
  assert.equal(tempRun.status, rootRun.status, "working directory must not change the coverage result");
  console.log(
    `Root and /tmp scans agree: ${rootCounts[0]} client endpoints, ${rootCounts[1]} mounted handlers (coverage exit ${rootRun.status}).`,
  );
} finally {
  rmSync(temporaryCwd, { recursive: true, force: true });
}

console.log("API coverage pure regressions: PASS");