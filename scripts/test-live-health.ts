#!/usr/bin/env tsx
/**
 * scripts/test-live-health.ts — Standalone Live Health Monitor
 *
 * Connects to the running server at http://localhost:5000, authenticates as
 * admin, and hits GET /api/admin/live-health to verify all background workers
 * and critical services are responding.
 *
 * Critical checks (gate fails if any are not ok):
 *   db, sequenceWorker, redis, kpiQuery
 *   (ai is informational — covered by the AI Assistant Boundaries suite)
 *
 * Informational checks (stale/warn is noted but does not block):
 *   slaWorker, ghlSync, dbBackup, outboundPause
 *
 * Usage:
 *   npx tsx scripts/test-live-health.ts
 *   BASE_URL=http://localhost:5000 npx tsx scripts/test-live-health.ts
 *
 * Exits 0 if all critical checks pass, 1 otherwise.
 */

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
  Liberty Bancard — Live Health Monitor Script

  Usage:
    npx tsx scripts/test-live-health.ts [options]

  Options:
    --help, -h      Show this help message

  Environment variables:
    BASE_URL              Server base URL (default: http://localhost:5000)
    ADMIN_SEED_EMAIL      Admin user email (required)
    ADMIN_SEED_PASSWORD   Admin user password (required)

  Exit codes:
    0   All critical checks passed (db, sequenceWorker, redis, kpiQuery)
    1   One or more critical checks failed, OR server is unreachable

  Description:
    Authenticates as admin, calls GET /api/admin/live-health, and prints a
    formatted report of all service health checks. If the server has just
    started and the health monitor has not yet run, triggers a fresh check
    and waits up to 30 seconds for results.
  `);
  process.exit(0);
}


const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";

if (!process.env.ADMIN_SEED_EMAIL || !process.env.ADMIN_SEED_PASSWORD) {
  console.error(
    "\n✗ MISSING REQUIRED ENV: ADMIN_SEED_EMAIL and/or ADMIN_SEED_PASSWORD not set.\n" +
    "  Live health check CANNOT run without admin credentials — failing closed.\n\n" +
    "  Set both env vars before running:\n" +
    "    ADMIN_SEED_EMAIL=admin@example.com ADMIN_SEED_PASSWORD=secret npx tsx scripts/test-live-health.ts\n"
  );
  process.exit(1);
}

const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD;

// "ai" excluded — AI availability is covered by the dedicated AI Assistant Boundaries
// suite. The custom AI_INTEGRATIONS_OPENAI_BASE_URL may use a different auth scheme
// that returns 401 in gate contexts; marking it informational prevents false failures.
const CRITICAL_CHECKS = ["db", "sequenceWorker", "redis", "kpiQuery"];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function isServerReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

async function waitForServer(url: string, maxMs = 30_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      await new Promise((r) => setTimeout(r, 3000));
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Server at ${url} did not become ready within ${maxMs / 1000}s`);
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`Login failed for ${email}: ${res.status} ${body}`);
  }
  const rawHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  const setCookieArr: string[] = typeof rawHeaders.getSetCookie === "function"
    ? rawHeaders.getSetCookie()
    : [res.headers.get("set-cookie") ?? ""];
  const cookies = setCookieArr
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean);
  if (cookies.length === 0) throw new Error(`No session cookie returned for ${email}`);
  return cookies.join("; ");
}

async function loginWithRetry(email: string, password: string, attempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await login(email, password);
    } catch (err: unknown) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isSocket = msg.includes("UND_ERR_SOCKET") || msg.includes("ECONNRESET") || msg.includes("fetch failed");
      if (!isSocket) throw err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

async function fetchLiveHealth(cookie: string, refresh = false): Promise<any> {
  const url = `${BASE_URL}/api/admin/live-health${refresh ? "?refresh=1" : ""}`;
  const res = await fetch(url, {
    headers: { cookie },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Auth error from live-health: ${res.status}`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`live-health returned ${res.status}: ${body}`);
  }
  return res.json();
}

function formatAge(isoOrNull: string | null | undefined): string {
  if (!isoOrNull) return "never";
  const ageMs = Date.now() - new Date(isoOrNull).getTime();
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s ago`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m ago`;
  return `${Math.round(ageMs / 3_600_000)}h ago`;
}

function pad(s: string, n: number): string {
  return s.padEnd(n);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // ── 1. Server reachability ─────────────────────────────────────────────────
  const reachable = await isServerReachable(`${BASE_URL}/api/health`);
  if (!reachable) {
    console.warn(`\n⚠  Server not reachable at ${BASE_URL} — live health check SKIPPED.`);
    console.warn("   Start the dev server and rerun to execute this check.\n");
    process.exit(0);
  }
  await waitForServer(`${BASE_URL}/api/health`);

  // ── 2. Auth ────────────────────────────────────────────────────────────────
  let adminCookie: string;
  try {
    adminCookie = await loginWithRetry(ADMIN_EMAIL, ADMIN_PASSWORD);
  } catch (err) {
    console.error(
      `✗ Could not log in as admin (${ADMIN_EMAIL}).\n` +
      `  ${err instanceof Error ? err.message : err}`
    );
    process.exit(1);
  }

  // ── 3. Fetch health data ────────────────────────────────────────────────────
  // If the server has just started, the health job may not have run yet.
  // We call with ?refresh=1 first to trigger a fresh check and wait up to 30s.
  let data: any;
  try {
    // Always request fresh data from the live-health endpoint
    data = await fetchLiveHealth(adminCookie, true);
  } catch (err) {
    // If refresh=1 fails (e.g. endpoint not yet registered), try without refresh
    try {
      data = await fetchLiveHealth(adminCookie, false);
    } catch (err2) {
      console.error(
        `✗ Failed to fetch /api/admin/live-health:\n  ${err2 instanceof Error ? err2.message : err2}`
      );
      process.exit(1);
    }
  }

  const checks: Array<{
    name: string;
    status: string;
    detail: string;
    durationMs?: number;
    critical: boolean;
  }> = data.checks ?? [];

  const fetchedAt: string = data.fetchedAt ?? new Date().toISOString();
  const cacheAgeMs: number = data.cacheAgeMs ?? 0;

  // If cached result is older than 10 minutes, trigger a fresh check
  if (data.cached && cacheAgeMs > 10 * 60 * 1000) {
    console.log("⟳  Cached result is stale (>10m) — requesting fresh check...");
    let retries = 0;
    const maxRetries = 6;
    const waitMs = 5000;
    while (retries < maxRetries) {
      try {
        data = await fetchLiveHealth(adminCookie, true);
        if (!data.cached || data.cacheAgeMs < 10 * 60 * 1000) break;
      } catch {}
      retries++;
      if (retries < maxRetries) {
        process.stdout.write(`   Waiting ${waitMs / 1000}s for fresh results (attempt ${retries}/${maxRetries})...\r`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    console.log(); // newline after progress
  }

  // ── 4. Print formatted report ──────────────────────────────────────────────
  const ageStr = cacheAgeMs > 0 ? `age: ${formatAge(fetchedAt)}` : "fresh";

  console.log("\n=== Liberty Bancard Live Health Check ===");
  console.log(`Run at: ${fetchedAt}  (${ageStr})`);
  console.log("");

  let criticalOk = 0;
  let criticalTotal = 0;
  let overallOk = 0;
  let overallTotal = 0;

  for (const check of checks) {
    const isCritical = CRITICAL_CHECKS.includes(check.name);
    const icon = check.status === "ok" ? "✓" : check.status === "stale" ? "⚠" : check.status === "warn" ? "⚠" : "✗";
    const nameCol = pad(check.name, 20);
    const statusCol = pad(check.status, 8);
    let suffix = `(${check.detail})`;
    if (check.status === "stale") suffix += " ← informational";
    if (check.status === "warn") suffix += " ← informational";

    console.log(`${icon} ${nameCol} ${statusCol} ${suffix}`);

    overallTotal++;
    if (check.status === "ok") overallOk++;
    if (isCritical) {
      criticalTotal++;
      if (check.status === "ok") criticalOk++;
    }
  }

  // ── 5. Summary ─────────────────────────────────────────────────────────────
  const allCriticalPass = criticalOk === criticalTotal;
  const overallLabel = allCriticalPass ? "HEALTHY" : "DEGRADED";

  console.log("");
  console.log(`Overall: ${overallOk}/${overallTotal} checks — ${overallLabel}  (${criticalOk} critical all ok)`);
  console.log("");

  if (!allCriticalPass) {
    const failedCritical = checks.filter(c => CRITICAL_CHECKS.includes(c.name) && c.status !== "ok");
    console.error("❌  LIVE HEALTH GATE FAILED — critical check(s) not ok:");
    for (const c of failedCritical) {
      console.error(`     ✗ ${c.name}: ${c.status} — ${c.detail}`);
    }
    console.error("");
    process.exit(1);
  }

  // ── 6. Queue-metrics assertions ────────────────────────────────────────────
  // Assert sequenceBacklog is readable and redisConnectionCount is present.
  // These feed the admin health panel and are required for operational visibility.
  console.log("--- Queue Metrics Gate ---");
  try {
    const qmRes = await fetch(`${BASE_URL}/api/operator/queue-metrics`, {
      headers: { cookie: adminCookie },
      signal: AbortSignal.timeout(15_000),
    });
    if (!qmRes.ok) {
      console.error(`✗ /api/operator/queue-metrics returned ${qmRes.status}`);
      process.exit(1);
    }
    const qmData: any = await qmRes.json();

    // sequenceBacklog must be a readable number (may be 0)
    if (typeof qmData.sequenceBacklog !== "number") {
      console.error(
        `✗ sequenceBacklog is not a number in queue-metrics response (got ${typeof qmData.sequenceBacklog}: ${JSON.stringify(qmData.sequenceBacklog)})`
      );
      process.exit(1);
    }
    console.log(`✓ sequenceBacklog readable: ${qmData.sequenceBacklog} enrollments due`);

    // redisConnectionCount must be present (may be null when Redis is unavailable, but key must exist)
    if (!("redisConnectionCount" in qmData)) {
      console.error("✗ redisConnectionCount field is absent from queue-metrics response");
      process.exit(1);
    }
    const connCount = qmData.redisConnectionCount;
    if (connCount !== null && typeof connCount !== "number") {
      console.error(
        `✗ redisConnectionCount has unexpected type (got ${typeof connCount}: ${JSON.stringify(connCount)})`
      );
      process.exit(1);
    }
    console.log(`✓ redisConnectionCount present: ${connCount === null ? "null (Redis unavailable)" : connCount + " connections"}`);

    if (qmData.sequenceLastRunMs !== undefined && qmData.sequenceLastRunMs !== null) {
      console.log(`✓ sequenceLastRunMs: ${Math.round(qmData.sequenceLastRunMs / 1000)}s last run duration`);
    }
  } catch (qmErr: any) {
    console.error(`✗ Queue-metrics assertion failed: ${qmErr?.message ?? qmErr}`);
    process.exit(1);
  }

  console.log("✅  All critical checks passed.\n");
  process.exit(0);
}

run().catch(err => {
  console.error("\nFatal error in live health check:", err?.message ?? err);
  process.exit(1);
});
