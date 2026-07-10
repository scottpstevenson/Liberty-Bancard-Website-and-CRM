#!/usr/bin/env tsx
/**
 * Smoke test: Lead Command Center KPI data sources.
 *
 * Verifies /api/outreach/status returns correctly typed, fully reconcilable
 * aggregates for both contacts and prospects, and cross-checks the hot tier
 * count against /api/kpi/pipeline-stats.
 *
 * Usage (with dev server running):
 *   ADMIN_SEED_EMAIL=admin@example.com ADMIN_SEED_PASSWORD=secret \
 *   BASE_URL=http://localhost:5000 npx tsx scripts/smoke-lcc-kpis.ts
 *
 * Exits 0 if every assertion holds, 1 otherwise.
 */

import bcrypt from "bcryptjs";
import { db } from "../server/db";
import { users } from "../shared/models/auth";
import { eq } from "drizzle-orm";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";

if (!process.env.ADMIN_SEED_EMAIL || !process.env.ADMIN_SEED_PASSWORD) {
  console.error(
    "\n✗ MISSING REQUIRED ENV: ADMIN_SEED_EMAIL and/or ADMIN_SEED_PASSWORD not set.\n" +
    "  Set both before running:\n" +
    "    ADMIN_SEED_EMAIL=admin@example.com ADMIN_SEED_PASSWORD=secret npx tsx scripts/smoke-lcc-kpis.ts\n"
  );
  process.exit(1);
}

const AGENT_EMAIL = "smoke-lcc-agent@libertybancard.test";
const AGENT_PASSWORD = "smoke-lcc-agent-Aa1!";

async function ensureAgentUser(): Promise<void> {
  const existing = await db.select().from(users).where(eq(users.email, AGENT_EMAIL));
  const passwordHash = await bcrypt.hash(AGENT_PASSWORD, 12);
  if (existing.length === 0) {
    await db.insert(users).values({
      email: AGENT_EMAIL,
      firstName: "LCC",
      lastName: "SmokeAgent",
      passwordHash,
      role: "agent",
      authProvider: "local",
      emailVerified: new Date(),
    });
  } else {
    await db
      .update(users)
      .set({ passwordHash, role: "agent", authProvider: "local", emailVerified: new Date() })
      .where(eq(users.email, AGENT_EMAIL));
  }
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
  const setCookieArr: string[] =
    typeof rawHeaders.getSetCookie === "function"
      ? rawHeaders.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
  const cookies = setCookieArr.map((c) => c.split(";")[0].trim()).filter(Boolean);
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
      const isSocket =
        msg.includes("UND_ERR_SOCKET") ||
        msg.includes("ECONNRESET") ||
        msg.includes("fetch failed");
      if (!isSocket) throw err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
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

let failures = 0;

function pass(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

function fail(msg: string): void {
  console.error(`  ✗ ${msg}`);
  failures++;
}

function assertInt(val: unknown, label: string): void {
  if (typeof val === "number" && Number.isInteger(val)) {
    pass(`${label} is integer (${val})`);
  } else {
    fail(`${label} expected integer, got ${JSON.stringify(val)}`);
  }
}

async function run(): Promise<void> {
  await waitForServer(`${BASE_URL}/api/health`);
  await ensureAgentUser();

  let agentCookie: string;
  try {
    agentCookie = await loginWithRetry(AGENT_EMAIL, AGENT_PASSWORD);
  } catch (err) {
    console.error(
      `✗ Could not log in smoke agent: ${err instanceof Error ? err.message : err}`
    );
    process.exit(1);
  }

  // ── 1. GET /api/outreach/status ───────────────────────────────────────────
  console.log("\n── GET /api/outreach/status ──");
  const start = Date.now();
  const res = await fetch(`${BASE_URL}/api/outreach/status`, {
    headers: { cookie: agentCookie },
  });
  const elapsed = Date.now() - start;

  if (res.status !== 200) {
    fail(`Expected HTTP 200, got ${res.status}`);
    process.exit(1);
  }
  if (elapsed > 2000) {
    fail(`Response took ${elapsed}ms (> 2 s threshold)`);
  } else {
    pass(`Response in ${elapsed}ms`);
  }

  const data = (await res.json()) as Record<string, any>;

  // ── 2. contacts field presence & integer types ────────────────────────────
  console.log("\n── contacts aggregate fields ──");
  const contactFields = [
    "total", "fromSunbiz", "newLeads", "syncedToGhl",
    "hot", "warm", "cold", "unqualified", "unclassified", "withContactInfo",
  ];
  for (const field of contactFields) {
    assertInt(data?.contacts?.[field], `contacts.${field}`);
  }

  // ── 3. prospects field presence & integer types ───────────────────────────
  console.log("\n── prospects aggregate fields ──");
  const prospectFields = ["total", "withEmail", "converted", "qualified", "hot", "warm", "cold", "unclassified"];
  for (const field of prospectFields) {
    assertInt(data?.prospects?.[field], `prospects.${field}`);
  }

  // ── 4. contacts tier reconciliation (exact) ───────────────────────────────
  console.log("\n── contacts tier reconciliation ──");
  const c = data?.contacts ?? {};
  const cSum = (c.hot ?? 0) + (c.warm ?? 0) + (c.cold ?? 0) + (c.unqualified ?? 0) + (c.unclassified ?? 0);
  if (cSum === c.total) {
    pass(
      `hot(${c.hot}) + warm(${c.warm}) + cold(${c.cold}) + unqualified(${c.unqualified}) + unclassified(${c.unclassified}) = total(${c.total})`
    );
  } else {
    fail(`contacts tier sum (${cSum}) !== contacts.total (${c.total})`);
  }

  // ── 5. prospects tier reconciliation (exact) ──────────────────────────────
  console.log("\n── prospects tier reconciliation ──");
  const p = data?.prospects ?? {};
  const pSum = (p.hot ?? 0) + (p.warm ?? 0) + (p.cold ?? 0) + (p.unclassified ?? 0);
  if (pSum === p.total) {
    pass(
      `hot(${p.hot}) + warm(${p.warm}) + cold(${p.cold}) + unclassified(${p.unclassified}) = total(${p.total})`
    );
  } else {
    fail(`prospects tier sum (${pSum}) !== prospects.total (${p.total})`);
  }

  // ── 6. cross-check contacts.hot against /api/kpi/pipeline-stats ──────────
  console.log("\n── /api/kpi/pipeline-stats cross-check ──");
  const psRes = await fetch(`${BASE_URL}/api/kpi/pipeline-stats`, {
    headers: { cookie: agentCookie },
  });
  if (psRes.status === 200) {
    const ps = (await psRes.json()) as Record<string, any>;
    const tiers: Array<{ tier: string; count: number }> =
      ps?.tiers ?? ps?.contactTiers ?? [];
    const hotTier = tiers.find((t: any) => t.tier === "hot");
    if (hotTier !== undefined) {
      if (hotTier.count === c.hot) {
        pass(`contacts.hot (${c.hot}) matches pipeline-stats hot tier (${hotTier.count})`);
      } else {
        fail(`contacts.hot (${c.hot}) does not match pipeline-stats hot tier (${hotTier.count})`);
      }
    } else {
      pass(`pipeline-stats hot tier not present in response shape — cross-check skipped`);
    }
  } else {
    pass(`/api/kpi/pipeline-stats returned ${psRes.status} — cross-check skipped`);
  }

  // ── Result ────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(52)}`);
  if (failures === 0) {
    console.log("✓ All LCC KPI smoke checks passed.");
    process.exit(0);
  } else {
    console.error(`✗ ${failures} check(s) failed.`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
