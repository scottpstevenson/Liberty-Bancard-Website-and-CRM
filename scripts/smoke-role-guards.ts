#!/usr/bin/env tsx
/**
 * Task #169 — Role-guard smoke test.
 *
 * Replit/this project does not ship Playwright. This Node smoke test
 * exercises the auth boundary on every endpoint touched by the audit:
 *   - anonymous callers MUST get 401
 *   - non-privileged authenticated callers (role: "merchant") MUST get 403
 *   - admin callers MUST get 200 (or another non-401/403 success code)
 *
 * Run with the dev server up, then:
 *   BASE_URL=http://localhost:5000 npx tsx scripts/smoke-role-guards.ts
 *
 * Exits 0 if every assertion holds, 1 otherwise. Suitable as a CI gate.
 * Pairs with scripts/check-api-coverage.ts.
 */

import bcrypt from "bcryptjs";
import { db } from "../server/db";
import { users } from "../shared/models/auth";
import { eq } from "drizzle-orm";

interface GuardCase {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  anon: number[];
  merchant: number[];
  admin: number[];
  description: string;
}

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";
const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL ?? "scott@libertybancard.com";
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? "miami33137!";
const MERCHANT_EMAIL = "smoke-test-merchant@libertybancard.test";
const MERCHANT_PASSWORD = "smoke-test-pw-Aa1!";

const CASES: GuardCase[] = [
  // New endpoints from this task
  { method: "GET", path: "/api/users",                       anon: [401], merchant: [403], admin: [200], description: "admin user list" },
  { method: "GET", path: "/api/merchants",                   anon: [401], merchant: [403], admin: [200], description: "admin/manager merchants" },
  { method: "GET", path: "/api/dashboard/stats",             anon: [401], merchant: [403], admin: [200], description: "dashboard KPIs" },
  { method: "GET", path: "/api/admin/route-permissions",     anon: [401], merchant: [403], admin: [200], description: "permissions audit" },

  // Pre-existing admin routes that were tagged with requireRole in this task
  { method: "GET", path: "/api/admin/users",                 anon: [401], merchant: [403], admin: [200],      description: "admin users" },
  { method: "GET", path: "/api/admin/mfa-settings",          anon: [401], merchant: [403], admin: [200],      description: "admin mfa settings" },
  { method: "GET", path: "/api/agents",                      anon: [401], merchant: [403], admin: [200],      description: "admin/manager agents" },
  { method: "GET", path: "/api/audit-logs",                  anon: [401], merchant: [403], admin: [200, 500], description: "audit logs" },
  { method: "GET", path: "/api/admin/round-robin",           anon: [401], merchant: [403], admin: [200],      description: "round-robin pool" },
  { method: "GET", path: "/api/admin/round-robin/log",       anon: [401], merchant: [403], admin: [200],      description: "round-robin log" },
  { method: "GET", path: "/api/admin/seo-coverage",          anon: [401], merchant: [403], admin: [200, 500], description: "seo coverage" },
];

async function ensureMerchantUser(): Promise<void> {
  const existing = await db.select().from(users).where(eq(users.email, MERCHANT_EMAIL));
  const passwordHash = await bcrypt.hash(MERCHANT_PASSWORD, 12);
  if (existing.length === 0) {
    await db.insert(users).values({
      email: MERCHANT_EMAIL,
      firstName: "Smoke",
      lastName: "Merchant",
      passwordHash,
      role: "merchant",
      authProvider: "local",
      emailVerified: new Date(),
    });
  } else {
    await db.update(users)
      .set({ passwordHash, role: "merchant", authProvider: "local", emailVerified: new Date() })
      .where(eq(users.email, MERCHANT_EMAIL));
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
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error(`No session cookie returned for ${email}`);
  // Take the first cookie (connect.sid=...) value before any attribute.
  const cookie = setCookie.split(",")[0].split(";")[0];
  return cookie;
}

async function call(c: GuardCase, cookie?: string): Promise<number> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${BASE_URL}${c.path}`, { method: c.method, headers });
  return res.status;
}

async function run(): Promise<void> {
  await ensureMerchantUser();

  let adminCookie: string;
  let merchantCookie: string;
  try {
    adminCookie = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  } catch (err) {
    console.error(`✗ Could not log in seeded admin (${ADMIN_EMAIL}). The login rate-limiter caps attempts at 5 / 15 min — wait or restart the server.\n  ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  try {
    merchantCookie = await login(MERCHANT_EMAIL, MERCHANT_PASSWORD);
  } catch (err) {
    console.error(`✗ Could not log in smoke merchant: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  let failures = 0;
  console.log("Endpoint                                          ANON  MERCHANT  ADMIN  Result");
  for (const c of CASES) {
    const [anon, merchant, admin] = await Promise.all([
      call(c),
      call(c, merchantCookie),
      call(c, adminCookie),
    ]);
    const ok =
      c.anon.includes(anon) &&
      c.merchant.includes(merchant) &&
      c.admin.includes(admin);
    const mark = ok ? "✓" : "✗";
    console.log(
      `${mark} ${(c.method + " " + c.path).padEnd(48)} ${String(anon).padEnd(5)} ${String(merchant).padEnd(8)} ${String(admin).padEnd(5)}  (${c.description})`
    );
    if (!ok) {
      failures++;
      console.log(`    expected anon∈${JSON.stringify(c.anon)} merchant∈${JSON.stringify(c.merchant)} admin∈${JSON.stringify(c.admin)}`);
    }
  }
  console.log(`\n${CASES.length - failures}/${CASES.length} guarded routes behave correctly across anon/merchant/admin.`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
