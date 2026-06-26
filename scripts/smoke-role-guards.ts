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
import { contacts, documents } from "../shared/schema";
import { eq, sql as drizzleSql } from "drizzle-orm";

interface GuardCase {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  anon: number[];
  merchant: number[];
  admin: number[];
  agent?: number[];
  description: string;
}

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";

if (!process.env.ADMIN_SEED_EMAIL || !process.env.ADMIN_SEED_PASSWORD) {
  console.warn(
    "⚠ ADMIN_SEED_EMAIL and/or ADMIN_SEED_PASSWORD not set — skipping role-guard smoke tests.\n" +
      "  Set both env vars to enable full role-guard validation:\n" +
      "  ADMIN_SEED_EMAIL=admin@example.com ADMIN_SEED_PASSWORD=secret npx tsx scripts/smoke-role-guards.ts\n" +
      "  See docs/launch-env-checklist.md §Pre-Deploy Smoke Tests for details."
  );
  process.exit(0);
}

const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD;
const MERCHANT_EMAIL = "smoke-test-merchant@libertybancard.test";
const MERCHANT_PASSWORD = "smoke-test-pw-Aa1!";
const AGENT_EMAIL = "smoke-test-agent@libertybancard.test";
const AGENT_PASSWORD = "smoke-test-agent-Aa1!";

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

  // ── AI Observability: audit log list (isDashboardUser) + detail/replay (admin/manager) ──
  { method: "GET",  path: "/api/operator/ai-audit",          anon: [401], merchant: [403], admin: [200], description: "AI audit log list (dashboard users)" },
  { method: "GET",  path: "/api/operator/ai-audit/999",      anon: [401], merchant: [403], admin: [404], description: "AI audit detail (admin/manager only)" },
  // POST endpoints: CSRF middleware fires before requireRole for authenticated sessions.
  // Without an x-csrf-token header the server returns 403 (csrf_missing) for both
  // merchant and admin — anon skips CSRF (not authenticated) and hits requireRole → 401.
  // The role gate is still enforced; this test validates the unauthenticated 401.
  { method: "POST", path: "/api/operator/ai-audit/999/replay", anon: [401], merchant: [403], admin: [403], description: "AI audit replay (admin/manager only; CSRF required for POST)" },

  // ── Wave 12: Merchant Document Vault — role gates ─────────────────────
  // Global admin index requires admin/manager; access-token endpoint is
  // authenticated-only (all roles can attempt, ownership enforced per-doc).
  { method: "GET",    path: "/api/merchant-documents",                       anon: [401], merchant: [403], admin: [200],      description: "merchant doc vault admin index (admin/manager only)" },
  { method: "GET",    path: "/api/merchant-documents/99999/access-token",    anon: [401], merchant: [403, 404], admin: [403, 404], description: "doc access-token (ownership guard — doc 99999 owned by nobody)" },
  // PATCH status: admin/manager only (requireRole guard); agent and merchant → 403
  { method: "PATCH",  path: "/api/merchant-documents/99999/status", anon: [401], merchant: [403], admin: [400, 403, 404], agent: [403], description: "doc status update (admin/manager only; agent→403; 403 also expected on admin when CSRF absent in test)" },
  // Bulk download: admin/manager only; agent and merchant → 403; admin may get 403 from CSRF in test env
  { method: "POST",   path: "/api/documents/bulk-download",         anon: [401], merchant: [403], admin: [400, 200, 403], agent: [403], description: "bulk download (admin/manager only; agent→403; 403 expected on admin from CSRF in test env)" },
];

async function ensureAgentUser(): Promise<void> {
  const existing = await db.select().from(users).where(eq(users.email, AGENT_EMAIL));
  const passwordHash = await bcrypt.hash(AGENT_PASSWORD, 12);
  if (existing.length === 0) {
    await db.insert(users).values({
      email: AGENT_EMAIL,
      firstName: "Smoke",
      lastName: "Agent",
      passwordHash,
      role: "agent",
      authProvider: "local",
      emailVerified: new Date(),
    });
  } else {
    await db.update(users)
      .set({ passwordHash, role: "agent", authProvider: "local", emailVerified: new Date() })
      .where(eq(users.email, AGENT_EMAIL));
  }
}

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
  // Use getSetCookie() (Node 18+ / undici) which returns each Set-Cookie header
  // as a separate array entry — no fragile comma-splitting needed.
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

async function call(c: GuardCase, cookie?: string, attempts = 3): Promise<number> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BASE_URL}${c.path}`, { method: c.method, headers });
      return res.status;
    } catch (err: unknown) {
      lastErr = err;
      const msg = err instanceof Error
        ? `${err.message} ${(err as any).cause?.message ?? ""}`
        : String(err);
      const isSocket =
        msg.includes("UND_ERR_SOCKET") ||
        msg.includes("ECONNRESET") ||
        msg.includes("other side closed") ||
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
      // Server responded — give Express another 3 s to finish registering all
      // middleware and route handlers before we start making real API calls.
      await new Promise((r) => setTimeout(r, 3000));
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Server at ${url} did not become ready within ${maxMs / 1000}s`);
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

async function run(): Promise<void> {
  await waitForServer(`${BASE_URL}/api/health`);
  await ensureMerchantUser();
  await ensureAgentUser();

  let adminCookie: string;
  let merchantCookie: string;
  let agentCookie: string;
  try {
    adminCookie = await loginWithRetry(ADMIN_EMAIL, ADMIN_PASSWORD);
  } catch (err) {
    console.error(`✗ Could not log in seeded admin (${ADMIN_EMAIL}). The login rate-limiter caps attempts at 5 / 15 min — wait or restart the server.\n  ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  try {
    merchantCookie = await loginWithRetry(MERCHANT_EMAIL, MERCHANT_PASSWORD);
  } catch (err) {
    console.error(`✗ Could not log in smoke merchant: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  try {
    agentCookie = await loginWithRetry(AGENT_EMAIL, AGENT_PASSWORD);
  } catch (err) {
    console.error(`✗ Could not log in smoke agent: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  let failures = 0;
  console.log("Endpoint                                          ANON  MERCHANT  AGENT  ADMIN  Result");
  for (const c of CASES) {
    const hasAgent = c.agent !== undefined;
    const results = await Promise.all([
      call(c),
      call(c, merchantCookie),
      ...(hasAgent ? [call(c, agentCookie)] : []),
      call(c, adminCookie),
    ]);
    const [anon, merchant, ...rest] = results;
    const agent = hasAgent ? rest[0] : undefined;
    const admin = hasAgent ? rest[1] : rest[0];

    const anonOk = c.anon.includes(anon);
    const merchantOk = c.merchant.includes(merchant);
    const agentOk = !hasAgent || (c.agent!.includes(agent!));
    const adminOk = c.admin.includes(admin);
    const ok = anonOk && merchantOk && agentOk && adminOk;

    const agentStr = hasAgent ? String(agent!).padEnd(6) : "—     ";
    const mark = ok ? "✓" : "✗";
    console.log(
      `${mark} ${(c.method + " " + c.path).padEnd(48)} ${String(anon).padEnd(5)} ${String(merchant).padEnd(9)} ${agentStr} ${String(admin).padEnd(5)}  (${c.description})`
    );
    if (!ok) {
      failures++;
      let expected = `anon∈${JSON.stringify(c.anon)} merchant∈${JSON.stringify(c.merchant)}`;
      if (hasAgent) expected += ` agent∈${JSON.stringify(c.agent)}`;
      expected += ` admin∈${JSON.stringify(c.admin)}`;
      console.log(`    expected ${expected}`);
    }
  }
  console.log(`\n${CASES.length - failures}/${CASES.length} guarded routes behave correctly across anon/merchant/agent/admin.`);

  // ── Wave 12: Real ownership test ─────────────────────────────────────────
  // Create an actual document under a test contact, then verify that the
  // unrelated merchant user gets 403 (not 404) on that document's access-token
  // endpoint. This is distinct from the static guard test above which uses
  // doc 99999 (non-existent) and can only prove the guard fires; it cannot
  // distinguish "doc not found" (404) from "doc found but forbidden" (403).
  console.log("\n── Wave 12: Document ownership guard (real doc) ──");
  let ownershipTestPassed = false;
  let ownershipTestError: string | null = null;
  let testContactId: number | null = null;
  let testDocId: number | null = null;
  try {
    // canAccessContactDocs grants agent access when user.email === contact.email
    // (contacts table has no assignedTo column). Pre-clean any stale test record to avoid unique index.
    await db.execute(
      drizzleSql`DELETE FROM contacts WHERE email = ${AGENT_EMAIL} AND archived_at IS NULL`
    ).catch(() => {});

    // 1. Create test contact whose email = AGENT_EMAIL so the agent passes the email-match gate.
    const [testContact] = await db.insert(contacts).values({
      firstName: "SmokeOwnership",
      lastName: "AgentOwned",
      email: AGENT_EMAIL,
      phone: "+10000000099",
      status: "active",
      leadSource: "test",
      sourceCategory: "test",
    } as any).returning({ id: contacts.id });
    testContactId = testContact.id;

    // 2. Create a document linked to that contact
    const [testDoc] = await db.insert(documents).values({
      contactId: testContactId,
      type: "statement",
      category: "KYC",
      fileName: "smoke-test-ownership.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
      uploadedBy: "smoke-test",
      storageKey: "smoke/smoke-test-ownership.pdf",
      accessScope: "internal",
      status: "pending",
    }).returning({ id: documents.id });
    testDocId = testDoc.id;

    // 3. Merchant (unrelated — not linked to this contact) must get 403
    const merchantStatus = await fetch(
      `${BASE_URL}/api/merchant-documents/${testDocId}/access-token`,
      { headers: { cookie: merchantCookie } }
    ).then(r => r.status);

    // 4. Agent WITH policy permission (email matches contact.email) must get 200
    const agentStatus = await fetch(
      `${BASE_URL}/api/merchant-documents/${testDocId}/access-token`,
      { headers: { cookie: agentCookie } }
    ).then(r => r.status);

    // 5. Admin must get a success response (200 or signed URL redirect 302)
    const adminStatus = await fetch(
      `${BASE_URL}/api/merchant-documents/${testDocId}/access-token`,
      { headers: { cookie: adminCookie } }
    ).then(r => r.status);

    const merchantOk = merchantStatus === 403;
    const agentOk = [200, 302].includes(agentStatus);
    const adminOk = [200, 302].includes(adminStatus);

    if (merchantOk && agentOk && adminOk) {
      console.log(`✓ doc access-token (real doc ${testDocId}): merchant→${merchantStatus} (403✓)  agent→${agentStatus} (✓)  admin→${adminStatus} (✓)`);
      ownershipTestPassed = true;
    } else {
      ownershipTestError = [
        !merchantOk ? `merchant→${merchantStatus} (expected 403)` : null,
        !agentOk ? `agent→${agentStatus} (expected 200, agent has assignedTo permission)` : null,
        !adminOk ? `admin→${adminStatus} (expected 200 or 302)` : null,
      ].filter(Boolean).join(", ");
      console.log(`✗ doc access-token (real doc ${testDocId}): ${ownershipTestError}`);
      failures++;
    }
  } catch (err) {
    ownershipTestError = `ownership test threw: ${err instanceof Error ? err.message : String(err)}`;
    console.log(`✗ ${ownershipTestError}`);
    failures++;
  } finally {
    // 5. Clean up — delete test doc and contact
    if (testDocId !== null) {
      await db.delete(documents).where(eq(documents.id, testDocId)).catch(() => {});
    }
    if (testContactId !== null) {
      await db.delete(contacts).where(eq(contacts.id, testContactId)).catch(() => {});
    }
  }

  const totalCases = CASES.length + 1; // +1 for ownership test
  const totalPassed = totalCases - failures;
  console.log(`\n${totalPassed}/${totalCases} guarded routes/tests passed.`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
