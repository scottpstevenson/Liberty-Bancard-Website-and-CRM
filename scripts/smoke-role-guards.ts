#!/usr/bin/env tsx
/**
 * Task #169 + #201 — Role-guard smoke test.
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
  // ── Pre-existing admin routes (task #169) ──
  { method: "GET", path: "/api/users",                       anon: [401], merchant: [403], admin: [200], description: "admin user list" },
  { method: "GET", path: "/api/merchants",                   anon: [401], merchant: [403], admin: [200], description: "admin/manager merchants" },
  { method: "GET", path: "/api/dashboard/stats",             anon: [401], merchant: [403], admin: [200], description: "dashboard KPIs" },
  { method: "GET", path: "/api/admin/route-permissions",     anon: [401], merchant: [403], admin: [200], description: "permissions audit" },
  { method: "GET", path: "/api/admin/users",                 anon: [401], merchant: [403], admin: [200],      description: "admin users" },
  { method: "GET", path: "/api/admin/mfa-settings",          anon: [401], merchant: [403], admin: [200],      description: "admin mfa settings" },
  { method: "GET", path: "/api/agents",                      anon: [401], merchant: [403], admin: [200],      description: "admin/manager agents" },
  { method: "GET", path: "/api/audit-logs",                  anon: [401], merchant: [403], admin: [200, 500], description: "audit logs" },
  { method: "GET", path: "/api/admin/round-robin",           anon: [401], merchant: [403], admin: [200],      description: "round-robin pool" },
  { method: "GET", path: "/api/admin/round-robin/log",       anon: [401], merchant: [403], admin: [200],      description: "round-robin log" },
  { method: "GET", path: "/api/admin/seo-coverage",          anon: [401], merchant: [403], admin: [200, 500], description: "seo coverage" },

  // ── Task #201: CRM routes upgraded to isDashboardUser ──
  // deals.ts
  { method: "GET",  path: "/api/deals",                      anon: [401], merchant: [403], admin: [200], description: "deals list" },
  { method: "GET",  path: "/api/deals/1",                    anon: [401], merchant: [403], admin: [200, 404], description: "deal by id" },
  { method: "GET",  path: "/api/deal-competitors",           anon: [401], merchant: [403], admin: [200], description: "deal competitors" },
  { method: "GET",  path: "/api/stage-rules",                anon: [401], merchant: [403], admin: [200], description: "stage rules" },
  { method: "GET",  path: "/api/pipeline-stages",            anon: [401], merchant: [403], admin: [200], description: "pipeline stages" },

  // contacts.ts
  { method: "GET",  path: "/api/contacts",                   anon: [401], merchant: [403], admin: [200], description: "contacts list" },
  { method: "GET",  path: "/api/contacts/1",                 anon: [401], merchant: [403], admin: [200, 404], description: "contact by id" },
  { method: "GET",  path: "/api/companies",                  anon: [401], merchant: [403], admin: [200], description: "companies list" },
  { method: "GET",  path: "/api/serper/status",              anon: [401], merchant: [403], admin: [200], description: "serper status" },
  { method: "GET",  path: "/api/proxycurl/status",           anon: [401], merchant: [403], admin: [200], description: "proxycurl status" },

  // tickets-tasks.ts
  { method: "GET",  path: "/api/tickets",                    anon: [401], merchant: [403], admin: [200], description: "tickets list" },
  { method: "GET",  path: "/api/tasks",                      anon: [401], merchant: [403], admin: [200], description: "tasks list" },

  // chargebacks.ts
  { method: "GET",  path: "/api/chargebacks",                anon: [401], merchant: [403], admin: [200], description: "chargebacks list" },
  { method: "GET",  path: "/api/chargebacks/stats",          anon: [401], merchant: [403], admin: [200], description: "chargeback stats" },
  { method: "GET",  path: "/api/chargebacks/overdue",        anon: [401], merchant: [403], admin: [200], description: "chargebacks overdue" },

  // boarding.ts
  { method: "GET",  path: "/api/boarding/submissions",       anon: [401], merchant: [403], admin: [200], description: "boarding submissions" },
  { method: "GET",  path: "/api/mid-stats/summary",          anon: [401], merchant: [403], admin: [200], description: "MID stats summary" },
  { method: "GET",  path: "/api/mid-stats/pipeline-summary", anon: [401], merchant: [403], admin: [200], description: "MID pipeline summary" },

  // documents.ts (legacy + collateral + knowledge base)
  { method: "GET",  path: "/api/documents",                  anon: [401], merchant: [403], admin: [200], description: "legacy documents" },
  { method: "GET",  path: "/api/collateral-packets",         anon: [401], merchant: [403], admin: [200], description: "collateral packets" },
  { method: "GET",  path: "/api/knowledge-base",             anon: [401], merchant: [403], admin: [200], description: "knowledge base" },

  // merchants.ts (CRM-managed)
  { method: "GET",  path: "/api/equipment-orders",           anon: [401], merchant: [403], admin: [200], description: "equipment orders" },
  { method: "GET",  path: "/api/onboarding-steps/deal/1",    anon: [401], merchant: [403], admin: [200], description: "onboarding steps" },

  // partners.ts (CRM partner management)
  { method: "GET",  path: "/api/partners",                   anon: [401], merchant: [403], admin: [200], description: "partners list" },
  { method: "GET",  path: "/api/referrals",                  anon: [401], merchant: [403], admin: [200], description: "referrals list" },
  { method: "GET",  path: "/api/commission-tiers",           anon: [401], merchant: [403], admin: [200], description: "commission tiers" },
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
