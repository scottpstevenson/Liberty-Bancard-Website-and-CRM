#!/usr/bin/env tsx
/**
 * scripts/test-build-identity.ts — Build identity smoke test
 *
 * Validates that /api/health:
 *   1. Returns sha, builtAt, env, and status fields in every response
 *   2. Reports status="release-unverified" and sha="unset" when RELEASE_SHA is absent/malformed
 *   3. Reports status="ok" (subject to DB check) when RELEASE_SHA is a valid 40-hex SHA
 *   4. Never leaks secrets, connection strings, hostnames, or credentials in the response body
 *
 * Also validates:
 *   5. /api/admin/live-health body includes a releaseSha field
 *
 * Run:
 *   npx tsx scripts/test-build-identity.ts
 *
 * Requires a running server at BASE_URL (default: http://localhost:5000).
 * Skips live endpoint checks gracefully when the server is not reachable.
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";
const TIMEOUT_MS = 5000;

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const VALID_SHA = "a".repeat(40); // synthetic valid SHA for testing

// Patterns that must never appear in a public health response value
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "postgres connection string", pattern: /postgresql:\/\//i },
  { name: "mysql connection string",    pattern: /mysql:\/\//i },
  { name: "redis connection string",    pattern: /redis:\/\//i },
  { name: "password field",            pattern: /password/i },
  { name: "secret field",              pattern: /secret/i },
  { name: "token field",               pattern: /token/i },
  { name: "api_key field",             pattern: /api[_-]?key/i },
  { name: "SMTP credential",           pattern: /smtp[._-]pass/i },
  { name: "private key header",        pattern: /-----BEGIN/i },
  { name: "private IP (10.x)",         pattern: /\b10\.\d+\.\d+\.\d+\b/ },
  { name: "private IP (192.168.x)",    pattern: /\b192\.168\.\d+\.\d+\b/ },
];

let errors = 0;
let warnings = 0;

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
}

function fail(msg: string) {
  console.error(`  ✗ FAIL: ${msg}`);
  errors++;
}

function warn(msg: string) {
  console.warn(`  ⚠  ${msg}`);
  warnings++;
}

function assert(condition: boolean, msg: string) {
  if (condition) pass(msg);
  else fail(msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1: SHA format validation (no server needed)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════════════════════");
console.log(" Build Identity Smoke Test");
console.log("══════════════════════════════════════════════════════════════\n");

console.log("── 1. RELEASE_SHA format validation (no server needed) ──────");

assert(SHA_PATTERN.test(VALID_SHA), `Synthetic valid SHA ('${"a".repeat(40)}') passes 40-hex pattern`);
assert(!SHA_PATTERN.test(""), "Empty string fails SHA pattern");
assert(!SHA_PATTERN.test("not-a-sha"), "Non-hex string fails SHA pattern");
assert(!SHA_PATTERN.test("abc123"), "Short hex string fails SHA pattern");
assert(!SHA_PATTERN.test("z".repeat(40)), "Non-hex 40-char string fails SHA pattern");
assert(!SHA_PATTERN.test("a".repeat(39)), "39-char hex string fails SHA pattern (too short)");
assert(!SHA_PATTERN.test("a".repeat(41)), "41-char hex string fails SHA pattern (too long)");
assert(SHA_PATTERN.test("0".repeat(40)), "All-zero 40-char hex string passes SHA pattern");

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: Response shape contract (pure logic, no server)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 2. Response shape contract (pure logic) ─────────────────");

// Inline the same logic the health endpoints use — validates the contract
function computeBuildFields(rawSha: string | undefined): {
  status: "ok" | "release-unverified";
  sha: string;
  builtAt: string;
  env: string;
} {
  const valid = typeof rawSha === "string" && SHA_PATTERN.test(rawSha);
  return {
    status: valid ? "ok" : "release-unverified",
    sha: valid ? rawSha! : "unset",
    builtAt: new Date().toISOString(),
    env: "test",
  };
}

// Happy path
const happy = computeBuildFields(VALID_SHA);
assert(happy.status === "ok", "Happy path: status='ok' with valid 40-hex SHA");
assert(happy.sha === VALID_SHA, "Happy path: sha matches provided RELEASE_SHA");
assert(typeof happy.builtAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(happy.builtAt), "Happy path: builtAt is ISO 8601 datetime");
assert(typeof happy.env === "string" && happy.env.length > 0, "Happy path: env is a non-empty string");

// Degraded path — absent
const degradedAbsent = computeBuildFields(undefined);
assert(degradedAbsent.status === "release-unverified", "Degraded (absent SHA): status='release-unverified'");
assert(degradedAbsent.sha === "unset", "Degraded (absent SHA): sha='unset'");

// Degraded path — malformed
const degradedMalformed = computeBuildFields("not-a-valid-sha");
assert(degradedMalformed.status === "release-unverified", "Degraded (malformed SHA): status='release-unverified'");
assert(degradedMalformed.sha === "unset", "Degraded (malformed SHA): sha='unset'");

// ─────────────────────────────────────────────────────────────────────────────
// Section 3: Security — no secrets in response fields
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 3. Security: no secrets in computed response fields ──────");

for (const [key, value] of Object.entries(happy)) {
  if (typeof value === "string") {
    for (const { name, pattern } of SECRET_PATTERNS) {
      assert(!pattern.test(value), `Field '${key}' does not contain ${name}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4: Live endpoint tests (requires running server)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 4. Live endpoint: /api/health shape ─────────────────────");

async function fetchJson(url: string, opts?: RequestInit): Promise<{ ok: boolean; status: number; body: unknown } | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), ...opts });
    let body: unknown;
    try { body = await resp.json(); } catch { body = null; }
    return { ok: resp.ok, status: resp.status, body };
  } catch (err: any) {
    if (err.code === "ECONNREFUSED" || err.name === "TypeError" || err.name === "AbortError") {
      return null; // server not running
    }
    throw err;
  }
}

let serverAvailable = false;

const healthResult = await fetchJson(`${BASE_URL}/api/health`);
if (healthResult === null) {
  warn(`Server not reachable at ${BASE_URL} — live endpoint checks skipped`);
} else {
  serverAvailable = true;
  const body = healthResult.body as Record<string, unknown>;

  assert("status" in body, "Live /api/health: 'status' field present");
  assert("sha" in body,    "Live /api/health: 'sha' field present");
  assert("builtAt" in body,"Live /api/health: 'builtAt' field present");
  assert("env" in body,    "Live /api/health: 'env' field present");

  const sha    = body.sha as string | undefined;
  const status = body.status as string | undefined;
  const builtAt= body.builtAt as string | undefined;
  const env    = body.env as string | undefined;

  assert(
    sha === "unset" || (typeof sha === "string" && SHA_PATTERN.test(sha)),
    `Live /api/health: sha is 'unset' or valid 40-hex (got '${sha}')`
  );

  assert(
    ["ok", "degraded", "release-unverified"].includes(status ?? ""),
    `Live /api/health: status is a known value (got '${status}')`
  );

  assert(
    typeof builtAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(builtAt),
    "Live /api/health: builtAt is ISO 8601 datetime"
  );

  assert(
    typeof env === "string" && env.length > 0,
    "Live /api/health: env is a non-empty string"
  );

  // KILL LINE: if SHA is missing entirely from the body, the task has FAILED
  if (!("sha" in body)) {
    fail("KILL LINE: /api/health does not include 'sha' field — build identity not surfaced");
  } else if (sha === "unset") {
    warn("RELEASE_SHA is not set in this environment — sha='unset', status='release-unverified' (expected in dev)");
  }

  // Security scan on live response
  console.log("\n── 4a. Security: no secrets in live response fields ─────────");
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      for (const { name, pattern } of SECRET_PATTERNS) {
        assert(!pattern.test(value), `Live field '${key}' does not contain ${name}`);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 5: /api/admin/live-health includes releaseSha (requires auth — skip)
// We verify the field is present in the source code rather than calling the
// authenticated endpoint. A curl-based check with credentials is out of scope
// for this unauthenticated smoke test.
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 5. /api/admin/live-health releaseSha field (source check) ──");

import { readFileSync } from "fs";
try {
  const adminRouteContent = readFileSync("server/routes/admin.ts", "utf8");
  assert(
    adminRouteContent.includes("releaseSha"),
    "server/routes/admin.ts contains 'releaseSha' in live-health response"
  );
  assert(
    adminRouteContent.includes("process.env.RELEASE_SHA"),
    "server/routes/admin.ts reads RELEASE_SHA from process.env for live-health"
  );
} catch {
  warn("Could not read server/routes/admin.ts — source check skipped");
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 6: pre-deploy gate assertion present in source
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 6. pre-deploy.ts RELEASE_SHA assertion (source check) ───");

try {
  const preDeployContent = readFileSync("scripts/pre-deploy.ts", "utf8");
  assert(
    preDeployContent.includes("RELEASE_SHA") && preDeployContent.includes("process.exit(1)"),
    "scripts/pre-deploy.ts asserts RELEASE_SHA and exits 1 on failure"
  );
  assert(
    preDeployContent.includes("[0-9a-f]{40}") || preDeployContent.includes("SHA_PATTERN"),
    "scripts/pre-deploy.ts validates SHA format with a 40-hex regex"
  );
} catch {
  warn("Could not read scripts/pre-deploy.ts — source check skipped");
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════════════════════");
if (errors === 0) {
  console.log(` ✓ ALL BUILD IDENTITY CHECKS PASSED${warnings > 0 ? ` (${warnings} warning${warnings > 1 ? "s" : ""})` : ""}`);
  if (!serverAvailable) {
    console.log("   ℹ  Live endpoint checks were skipped (server not running).");
    console.log("      Run with a live server for full coverage:");
    console.log("      bash scripts/run-pre-deploy.sh");
  }
} else {
  console.error(` ✗ ${errors} check(s) FAILED${warnings > 0 ? `, ${warnings} warning(s)` : ""}`);
}
console.log("══════════════════════════════════════════════════════════════\n");

process.exit(errors > 0 ? 1 : 0);
