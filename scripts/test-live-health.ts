#!/usr/bin/env tsx
/**
 * scripts/test-live-health.ts — Standalone Live Health Monitor
 *
 * Authenticates against the server's live-health endpoint and verifies the
 * health report against its own critical-check metadata. In the bounded
 * provider-deny/selective test profile, it verifies the intentionally
 * uninitialized worker/queue state without pretending it is live-ready.
 *
 * Usage:
 *   npx tsx scripts/test-live-health.ts
 *   BASE_URL=http://localhost:5000 npx tsx scripts/test-live-health.ts
 *
 * Exits 0 if the live checks pass or the isolated disabled test posture is
 * reported truthfully; exits 1 on unreachable or inconsistent health data.
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
    0   Critical checks pass, or an isolated disabled test posture is verified
    1   Health data is degraded/inconsistent, OR server is unreachable

  Description:
    Authenticates as admin, calls GET /api/admin/live-health, and prints a
    formatted report using the server's critical-check flags. AI availability
    is configuration-only and remains unprobed. Provider-deny/selective test
    mode verifies paused/uninitialized states and does not claim live readiness.
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

// Keep this in sync with the live-health endpoint's declared critical metadata.
// AI is deliberately informational: the endpoint checks only configuration and
// does not probe a provider, so its "ok" status is not evidence of availability.
const REQUIRED_CRITICAL_CHECKS = [
  "db",
  "sequenceWorker",
  "redis",
  "kpiQuery",
  "productionSeedConvergence",
] as const;
const isLoopbackBaseUrl = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?$/.test(BASE_URL);
const isProviderDeniedSelectiveTestProfile =
  process.env.NODE_ENV === "test" &&
  process.env.VG_PROVIDER_DENY_MODE === "1" &&
  process.env.BACKGROUND_JOB_PROFILE?.startsWith("selective:") === true &&
  isLoopbackBaseUrl;

function requireEvidence(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Live health assertion failed: ${message}`);
}

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
    throw new Error(`Server not reachable at ${BASE_URL}; refusing to report the live-health suite as passed or skipped.`);
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
  requireEvidence(Array.isArray(checks), "live-health response must contain a checks array");
  const criticalChecks = checks.filter(check => check.critical);
  const reportedCriticalNames = criticalChecks.map(check => check.name).sort();
  requireEvidence(
    JSON.stringify(reportedCriticalNames) === JSON.stringify([...REQUIRED_CRITICAL_CHECKS].sort()),
    `critical-check metadata differs from the contract (got ${reportedCriticalNames.join(", ")})`,
  );
  const sourceCriticalOk = criticalChecks.every(check => check.status === "ok");
  requireEvidence(typeof data.ok === "boolean", "live-health response must include its computed ok flag");
  requireEvidence(data.ok === sourceCriticalOk, "response ok flag must match the checks marked critical");
  requireEvidence(
    data.summary?.critical === criticalChecks.length &&
      data.summary?.criticalOk === criticalChecks.filter(check => check.status === "ok").length,
    "response critical summary must match its per-check statuses",
  );

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

  let overallOk = 0;
  let overallTotal = 0;

  for (const check of checks) {
    const isUnprobedAi = check.name === "ai" && /not probed/i.test(check.detail);
    const isIntentionallyIdleWorker =
      check.name === "sequenceWorker" && /worker intentionally idle/i.test(check.detail);
    const displayStatus = isUnprobedAi
      ? "unprobed"
      : isIntentionallyIdleWorker
        ? "idle (disabled)"
        : check.status;
    const icon = isUnprobedAi || isIntentionallyIdleWorker
      ? "○"
      : check.status === "ok" ? "✓" : check.status === "stale" ? "⚠" : check.status === "warn" ? "⚠" : "✗";
    const nameCol = pad(check.name, 20);
    const statusCol = pad(displayStatus, 12);
    let suffix = `(${check.detail})`;
    if (check.status === "stale") suffix += " ← informational";
    if (check.status === "warn") suffix += " ← informational";

    console.log(`${icon} ${nameCol} ${statusCol} ${suffix}`);

    overallTotal++;
    if (check.status === "ok" && !isUnprobedAi && !isIntentionallyIdleWorker) overallOk++;
  }

  // ── 5. Summary ─────────────────────────────────────────────────────────────
  const intentionallyIdleCriticalCount = criticalChecks.filter(check =>
    check.name === "sequenceWorker" && /worker intentionally idle/i.test(check.detail),
  ).length;
  const operationalCriticalOk = criticalChecks.filter(check =>
    check.status === "ok" && !(check.name === "sequenceWorker" && /worker intentionally idle/i.test(check.detail)),
  ).length;
  const overallLabel = isProviderDeniedSelectiveTestProfile
    ? "EXPECTED PROVIDER-DENY TEST POSTURE"
    : sourceCriticalOk
      ? "CRITICAL CHECKS OK — PROVIDER PROBES UNVERIFIED"
      : "DEGRADED";

  console.log("");
  console.log(
    `Overall: ${overallOk}/${overallTotal} verified checks — ${overallLabel}  ` +
    `(${operationalCriticalOk}/${criticalChecks.length} critical checks operational; ${intentionallyIdleCriticalCount} intentionally idle)`,
  );
  console.log("");

  if (isProviderDeniedSelectiveTestProfile) {
    const checkByName = new Map(checks.map(check => [check.name, check]));
    const db = checkByName.get("db");
    const sequenceWorker = checkByName.get("sequenceWorker");
    const redis = checkByName.get("redis");
    const kpiQuery = checkByName.get("kpiQuery");
    const seeds = checkByName.get("productionSeedConvergence");
    const outboundPause = checkByName.get("outboundPause");
    const slaWorker = checkByName.get("slaWorker");
    const ai = checkByName.get("ai");

    requireEvidence(db?.status === "ok", `private database connectivity must be ok (got ${db?.status})`);
    requireEvidence(
      sequenceWorker?.status === "ok" && /worker intentionally idle/i.test(sequenceWorker.detail),
      `disabled sequence worker must be described as intentionally idle (got ${sequenceWorker?.status}: ${sequenceWorker?.detail})`,
    );
    requireEvidence(
      redis?.status === "error" && /not connected/i.test(redis.detail),
      `provider-deny startup must not claim Redis workers are connected (got ${redis?.status}: ${redis?.detail})`,
    );
    requireEvidence(
      kpiQuery?.status === "error" && /contacts or deals has no rows/i.test(kpiQuery.detail),
      `fresh isolated DB must report its empty KPI fixture honestly (got ${kpiQuery?.status}: ${kpiQuery?.detail})`,
    );
    requireEvidence(
      seeds?.status === "ok" && /^\d+\/\d+ seed targets converged$/.test(seeds.detail),
      `fresh DB seed convergence must be verified (got ${seeds?.status}: ${seeds?.detail})`,
    );
    requireEvidence(
      outboundPause?.status === "ok" && /state=paused source=database\b/i.test(outboundPause.detail),
      `outbound authority must remain database-paused (got ${outboundPause?.status}: ${outboundPause?.detail})`,
    );
    requireEvidence(
      slaWorker?.status === "error" && /never \(worker has not run\)/i.test(slaWorker.detail),
      `unstarted SLA worker must not be represented as live (got ${slaWorker?.status}: ${slaWorker?.detail})`,
    );
    requireEvidence(ai && !ai.critical && /not probed/i.test(ai.detail), "AI must remain informational and explicitly unprobed");
    requireEvidence(data.ok === false, "a disabled worker profile with unavailable critical checks must not report overall ok");
    console.log("✓ Disabled worker, empty-fixture, provider-deny, and outbound-pause states are reported without a healthy claim.");
  } else if (!sourceCriticalOk) {
    const failedCritical = criticalChecks.filter(check => check.status !== "ok");
    throw new Error(`LIVE HEALTH CHECKS DEGRADED — ${failedCritical.map(check => `${check.name}: ${check.status} — ${check.detail}`).join("; ")}`);
  }

  // ── 6. Queue-metrics assertions ────────────────────────────────────────────
  console.log("--- Queue Metrics Gate ---");
  try {
    const qmRes = await fetch(`${BASE_URL}/api/operator/queue-metrics`, {
      headers: { cookie: adminCookie },
      signal: AbortSignal.timeout(15_000),
    });
    const qmData: any = await qmRes.json();

    if (isProviderDeniedSelectiveTestProfile) {
      const profileRes = await fetch(`${BASE_URL}/api/admin/pool-status`, {
        headers: { cookie: adminCookie },
        signal: AbortSignal.timeout(15_000),
      });
      const profileData: any = await profileRes.json();
      requireEvidence(
        profileRes.ok && profileData.backgroundProfile === "selective",
        `server must report the selected worker profile (HTTP ${profileRes.status}, profile=${profileData.backgroundProfile})`,
      );
      console.log("✓ Server reports the selective background profile.");

      requireEvidence(
        qmRes.status === 503 && qmData.status === "not_initialized" && Array.isArray(qmData.queues) && qmData.queues.length === 0,
        `QueueManager must report not_initialized with no queue telemetry in the provider-deny profile (HTTP ${qmRes.status}, ${JSON.stringify(qmData)})`,
      );
      requireEvidence(!("sequenceBacklog" in qmData) && !("redisConnectionCount" in qmData), "uninitialized QueueManager must not expose fabricated queue metrics");
      console.log("✓ QueueManager reports not_initialized; no backlog or Redis metrics were fabricated.");
    } else {
      if (!qmRes.ok) throw new Error(`/api/operator/queue-metrics returned ${qmRes.status}: ${JSON.stringify(qmData)}`);
      requireEvidence(typeof qmData.sequenceBacklog === "number", `sequenceBacklog must be numeric (got ${typeof qmData.sequenceBacklog})`);
      console.log(`✓ sequenceBacklog readable: ${qmData.sequenceBacklog} enrollments due`);

      requireEvidence("redisConnectionCount" in qmData, "redisConnectionCount must be present in queue-metrics response");
      const connCount = qmData.redisConnectionCount;
      requireEvidence(connCount === null || typeof connCount === "number", `redisConnectionCount has unexpected type (${typeof connCount})`);
      console.log(`✓ redisConnectionCount present: ${connCount === null ? "null (Redis unavailable)" : connCount + " connections"}`);

      if (qmData.sequenceLastRunMs !== undefined && qmData.sequenceLastRunMs !== null) {
        console.log(`✓ sequenceLastRunMs: ${Math.round(qmData.sequenceLastRunMs / 1000)}s last run duration`);
      }
    }
  } catch (qmErr: unknown) {
    throw new Error(`Queue-metrics assertion failed: ${qmErr instanceof Error ? qmErr.message : qmErr}`);
  }

  if (isProviderDeniedSelectiveTestProfile) {
    console.log("✅  Truthful isolated provider-deny health posture verified; this is not a live-worker readiness claim.\n");
  } else {
    console.log("✅  All server-declared critical checks passed; AI/provider availability remains unprobed.\n");
  }
  process.exit(0);
}

run().catch(err => {
  console.error("\nFatal error in live health check:", err?.message ?? err);
  process.exit(1);
});
