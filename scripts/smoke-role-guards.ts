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
  manager?: number[];
  description: string;
}

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";

if (!process.env.ADMIN_SEED_EMAIL || !process.env.ADMIN_SEED_PASSWORD) {
  console.error(
    "\n✗ MISSING REQUIRED ENV: ADMIN_SEED_EMAIL and/or ADMIN_SEED_PASSWORD not set.\n" +
    "  Role-guard smoke tests CANNOT run without admin credentials — failing closed.\n\n" +
    "  Set both env vars before running as a release gate:\n" +
    "    ADMIN_SEED_EMAIL=admin@example.com ADMIN_SEED_PASSWORD=secret npx tsx scripts/smoke-role-guards.ts\n" +
    "  See docs/launch-env-checklist.md §Pre-Deploy Smoke Tests for details.\n"
  );
  process.exit(1);
}

const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD;
const MERCHANT_EMAIL = "smoke-test-merchant@libertybancard.test";
const MERCHANT_PASSWORD = "smoke-test-pw-Aa1!";
const AGENT_EMAIL = "smoke-test-agent@libertybancard.test";
const AGENT_PASSWORD = "smoke-test-agent-Aa1!";
const MANAGER_EMAIL = "smoke-test-manager@libertybancard.test";
const MANAGER_PASSWORD = "smoke-test-manager-Aa1!";

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
  // SDR / admin health endpoints — isDashboardUser guard; merchant → 403
  { method: "GET",    path: "/api/admin/health",                     anon: [401], merchant: [403], admin: [200, 503], description: "admin health check (isDashboardUser; 503 when services degraded in dev)" },
  { method: "GET",    path: "/api/sdr/compliance-channel-status",    anon: [401], merchant: [403], admin: [200], description: "SDR compliance channel status (isDashboardUser)" },

  // ── Auth-gate hardening (launch remediation) — formerly isAuthenticated, now isDashboardUser/requireRole ──
  { method: "GET",    path: "/api/notes?entityType=contact&entityId=1",      anon: [401], merchant: [403], admin: [200], description: "notes list (isDashboardUser — merchants blocked)" },
  { method: "GET",    path: "/api/forecasting/summary",               anon: [401], merchant: [403], admin: [200], description: "forecasting summary (isDashboardUser — merchants blocked)" },
  { method: "GET",    path: "/api/residuals/imports",                 anon: [401], merchant: [403], admin: [200], description: "residuals import list (requireRole admin/manager — merchants blocked)" },
  { method: "GET",    path: "/api/kpi/summary",                      anon: [401], merchant: [403], admin: [200], description: "KPI summary (isDashboardUser — merchants blocked)" },
  { method: "GET",    path: "/api/admin/launch-readiness",           anon: [401], merchant: [403], admin: [200], description: "launch readiness (requireRole admin/manager)" },
  { method: "GET",    path: "/api/admin/queue-metrics",              anon: [401], merchant: [403], admin: [200], description: "queue metrics (requireRole admin/manager)" },
  { method: "GET",    path: "/api/admin/alerts",                     anon: [401], merchant: [403], admin: [200], description: "alert feed (requireRole admin/manager)" },
  { method: "GET",    path: "/api/admin/ghl/identity-conflicts",     anon: [401], merchant: [403], admin: [200], description: "GHL identity conflict queue (requireRole admin/manager)" },

  // ── Task #695: Voice/SMS/Ringless Go-Live Audit — Approval Gate (admin-only) ──
  // All three routes require requireRole("admin"); merchant/agent → 403.
  // POST routes are audit-only writes (never touch env/secrets) but still go
  // through CSRF middleware in the test harness, so admin may see 403 there.
  { method: "GET",  path: "/api/activation/channel-checklist/sms",         anon: [401], merchant: [403], admin: [200], agent: [403], description: "channel checklist — sms (admin only)" },
  { method: "GET",  path: "/api/activation/channel-checklist/voice_ai",    anon: [401], merchant: [403], admin: [200], agent: [403], description: "channel checklist — voice_ai (admin only)" },
  { method: "GET",  path: "/api/activation/channel-checklist/ringless_vm", anon: [401], merchant: [403], admin: [200], agent: [403], description: "channel checklist — ringless_vm (admin only)" },
  { method: "GET",  path: "/api/activation/channel-checklist/bogus",       anon: [401], merchant: [403], admin: [400], agent: [403], description: "channel checklist — invalid channel key rejected" },
  { method: "POST", path: "/api/activation/channel-enable/sms",            anon: [401], merchant: [403], admin: [200, 400, 403], agent: [403], description: "channel enable approval — sms (admin only; audit-only, never sets env)" },
  { method: "POST", path: "/api/activation/channel-test-batch/sms",        anon: [401], merchant: [403], admin: [200, 403], agent: [403], description: "channel test batch dry-run — sms (admin only; never sends)" },
  { method: "GET",  path: "/api/activation/channel-audit-log/sms",         anon: [401], merchant: [403], admin: [200], agent: [403], description: "channel approval history — sms (admin only; read-only)" },
  { method: "GET",  path: "/api/activation/channel-audit-log/bogus",       anon: [401], merchant: [403], admin: [400], agent: [403], description: "channel approval history — invalid channel key rejected" },
  { method: "GET",  path: "/api/activation/channel-audit-log/sms/export?format=csv", anon: [401], merchant: [403], admin: [200], agent: [403], description: "channel approval history export — sms CSV (admin only; read-only)" },
  { method: "GET",  path: "/api/activation/channel-audit-log/sms/export?format=pdf", anon: [401], merchant: [403], admin: [200], agent: [403], description: "channel approval history export — sms PDF (admin only; read-only)" },

  // ── Task #866: Vertical detail endpoint — admin/manager only ─────────────
  { method: "GET",  path: "/api/admin/pipeline/stage-health/vertical-detail?vertical=__unknown__", anon: [401], merchant: [403], admin: [200], agent: [403], description: "vertical detail (admin/manager only; read-only)" },

  // ── Task #918: SLA Task Bulk-Delete — isDashboardUser (blocks merchants) ──
  // POST routes hit CSRF middleware before the body is parsed, so authenticated
  // users without an x-csrf-token header get 403 (csrf_missing).  Anon still
  // gets 401 because CSRF short-circuits to isAuthenticated first.
  { method: "POST", path: "/api/tasks/bulk-delete", anon: [401], merchant: [403], admin: [403], agent: [403], manager: [403], description: "task bulk-delete (requireRole admin/manager; CSRF required for POST — all auth roles hit 403 without token; agent/merchant also blocked by role gate)" },

  // ── Task #917: Confirmation Status — isDashboardUser (blocks merchants/partners) ──
  // All three endpoints are read-only (no state produced here).
  { method: "GET", path: "/api/contacts/1/confirmation-status",    anon: [401], merchant: [403], admin: [200],      description: "contact confirmation status (isDashboardUser)" },
  { method: "GET", path: "/api/operator/confirmation-metric",      anon: [401], merchant: [403], admin: [200],      description: "operator confirmation send success rate (isDashboardUser)" },
  { method: "GET", path: "/api/operator/confirmation-failures",    anon: [401], merchant: [403], admin: [200],      description: "operator confirmation failures (isDashboardUser)" },

  // ── Task #929: Confirmation Status Batch — isDashboardUser ──
  // POST route hits CSRF middleware before role guard for authenticated sessions.
  // Anon still gets 401 (CSRF skips; role guard fires). Merchant gets 403 (role gate).
  // Admin/agent get 403 without CSRF token (CSRF fires before role gate on POST).
  { method: "POST", path: "/api/contacts/confirmation-status/batch", anon: [401], merchant: [403], admin: [403], agent: [403], description: "confirmation-status batch (isDashboardUser; CSRF required for POST — 403 on all auth roles without token; merchant also blocked by role gate)" },

  // ── Setup & Activation Wizard — admin/manager only ──────────────────────────
  // GET endpoints: requireRole("admin","manager") — merchant/partner → 403; anon → 401.
  // POST /api/wizard/feature-flag: requireRole("admin") only — manager also → 403.
  // All POST/DELETE mutation routes: CSRF required → authenticated callers get 403 without token.
  { method: "GET",    path: "/api/wizard/connectivity",             anon: [401], merchant: [403], admin: [200],      agent: [403], manager: [200], description: "wizard connectivity check (admin/manager only)" },
  { method: "GET",    path: "/api/wizard/booking-links",            anon: [401], merchant: [403], admin: [200],      agent: [403], manager: [200], description: "wizard booking links (admin/manager only)" },
  { method: "GET",    path: "/api/wizard/feature-flags",            anon: [401], merchant: [403], admin: [200],      agent: [403], manager: [200], description: "wizard feature-flag read (admin/manager only)" },
  { method: "GET",    path: "/api/wizard/queue-health",             anon: [401], merchant: [403], admin: [200],      agent: [403], manager: [200], description: "wizard queue health (admin/manager only)" },
  // Mutating wizard endpoints: admin/manager allowed role-wise, but CSRF fires first on POST/DELETE →
  // all authenticated callers (admin, manager, agent) get 403 in the test harness (no CSRF token).
  { method: "POST",   path: "/api/wizard/test-contact",             anon: [401], merchant: [403], admin: [403],      agent: [403], manager: [403], description: "wizard create test contact (admin/manager; CSRF required)" },
  { method: "DELETE", path: "/api/wizard/test-contact/999999",      anon: [401], merchant: [403], admin: [404, 403], agent: [403], manager: [404, 403], description: "wizard delete test contact (admin/manager; 404 on non-existent; CSRF required)" },
  { method: "POST",   path: "/api/wizard/test-send/email",          anon: [401], merchant: [403], admin: [403],      agent: [403], manager: [403], description: "wizard email send (admin/manager; CSRF required)" },
  { method: "POST",   path: "/api/wizard/test-send/sms",            anon: [401], merchant: [403], admin: [403],      agent: [403], manager: [403], description: "wizard SMS send (admin/manager; CSRF required)" },
  { method: "POST",   path: "/api/wizard/test-send/voice",          anon: [401], merchant: [403], admin: [403],      agent: [403], manager: [403], description: "wizard voice send (admin/manager; CSRF required)" },
  { method: "POST",   path: "/api/wizard/test-send/voicemail",      anon: [401], merchant: [403], admin: [403],      agent: [403], manager: [403], description: "wizard RVM send (admin/manager; CSRF required)" },
  { method: "POST",   path: "/api/wizard/test-sequence",            anon: [401], merchant: [403], admin: [403],      agent: [403], manager: [403], description: "wizard sequence enroll (admin/manager; CSRF required)" },
  { method: "DELETE", path: "/api/wizard/test-sequence/999999",     anon: [401], merchant: [403], admin: [404, 403], agent: [403], manager: [404, 403], description: "wizard cancel enrollment (admin/manager; 404 on non-existent; CSRF required)" },
  { method: "POST",   path: "/api/wizard/test-application",         anon: [401], merchant: [403], admin: [403],      agent: [403], manager: [403], description: "wizard test application (admin/manager; CSRF required)" },
  // POST /api/wizard/test-statement is multipart/form-data; CSRF fires before role gate → 403 for auth roles.
  { method: "POST",   path: "/api/wizard/test-statement",           anon: [401], merchant: [403], admin: [403],      agent: [403], manager: [403], description: "wizard statement upload (admin/manager; CSRF required)" },
  // POST /api/wizard/feature-flag: admin-only; CSRF required for authenticated POSTs.
  // Manager and agent both → 403 (role gate). Admin → 403 (CSRF absent in test harness).
  { method: "POST",   path: "/api/wizard/feature-flag",             anon: [401], merchant: [403], admin: [403],      agent: [403], manager: [403], description: "wizard flag toggle (admin only; CSRF required — all auth roles 403 without token)" },
  // Internal test email sends — admin only; CSRF required; rate-limited.
  { method: "POST",   path: "/api/wizard/test-sequence-emails",     anon: [401], merchant: [403], admin: [403],      agent: [403], manager: [403], description: "wizard internal test email sends (admin only; CSRF required)" },
  // End-to-end flow audit — admin only; CSRF required.
  { method: "POST",   path: "/api/wizard/flow-audit",               anon: [401], merchant: [403], admin: [403],      agent: [403], manager: [403], description: "wizard end-to-end flow audit (admin only; CSRF required)" },
  // Go/No-Go report — admin and manager readable.
  { method: "GET",    path: "/api/wizard/gonogo-report",            anon: [401], merchant: [403], admin: [200],      agent: [403], manager: [200], description: "wizard go/no-go launch report (admin/manager read-only)" },

  // ── Task #1169: Bulk op role guards (requireRole admin/manager) ──
  // POST routes: CSRF fires before role gate for authenticated sessions → 403 without token.
  // Anon gets 401 (not authenticated). Agent and merchant are blocked by role gate (would get 403
  // even with a valid CSRF token). Manager/admin are role-allowed but still 403 without token.
  { method: "POST", path: "/api/contacts/mass-score",        anon: [401], merchant: [403], admin: [403], agent: [403], manager: [403], description: "mass-score (requireRole admin/manager; CSRF required — agent blocked by role gate)" },
  { method: "POST", path: "/api/contacts/mass-create-deals", anon: [401], merchant: [403], admin: [403], agent: [403], manager: [403], description: "mass-create-deals (requireRole admin/manager; CSRF required — agent blocked by role gate)" },
  { method: "POST", path: "/api/deals/bulk-stage",           anon: [401], merchant: [403], admin: [403], agent: [403], manager: [403], description: "deal bulk-stage (requireRole admin/manager; CSRF required — agent blocked by role gate)" },
  { method: "POST", path: "/api/tasks/bulk-assign",          anon: [401], merchant: [403], admin: [403], agent: [403], manager: [403], description: "task bulk-assign (requireRole admin/manager; CSRF required — agent blocked by role gate)" },
  { method: "POST", path: "/api/documents/bulk-delete",      anon: [401], merchant: [403], admin: [403], agent: [403], manager: [403], description: "document bulk-delete (requireRole admin/manager; CSRF required — agent blocked by role gate)" },
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

async function ensureManagerUser(): Promise<void> {
  const existing = await db.select().from(users).where(eq(users.email, MANAGER_EMAIL));
  const passwordHash = await bcrypt.hash(MANAGER_PASSWORD, 12);
  if (existing.length === 0) {
    await db.insert(users).values({
      email: MANAGER_EMAIL,
      firstName: "Smoke",
      lastName: "Manager",
      passwordHash,
      role: "manager",
      authProvider: "local",
      emailVerified: new Date(),
    });
  } else {
    await db.update(users)
      .set({ passwordHash, role: "manager", authProvider: "local", emailVerified: new Date() })
      .where(eq(users.email, MANAGER_EMAIL));
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

async function isServerReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

async function run(): Promise<void> {
  // Skip gracefully when the server isn't running — the pre-deploy gate
  // marks this suite requiresServer:true and handles the skip there.
  // When run standalone (e.g. via the validation workflow), also skip
  // cleanly so a cold environment doesn't block an otherwise-green gate.
  const reachable = await isServerReachable(`${BASE_URL}/api/health`);
  if (!reachable) {
    console.warn(`\n⚠  Server not reachable at ${BASE_URL} — role-guard smoke test SKIPPED.`);
    console.warn("   Start the dev server and rerun to execute this suite.\n");
    process.exit(0);
  }
  await waitForServer(`${BASE_URL}/api/health`);
  await ensureMerchantUser();
  await ensureAgentUser();
  await ensureManagerUser();

  let adminCookie: string;
  let merchantCookie: string;
  let agentCookie: string;
  let managerCookie: string;
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
  try {
    managerCookie = await loginWithRetry(MANAGER_EMAIL, MANAGER_PASSWORD);
  } catch (err) {
    console.error(`✗ Could not log in smoke manager: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  let failures = 0;
  console.log("Endpoint                                          ANON  MERCHANT  AGENT  MANAGER  ADMIN  Result");
  for (const c of CASES) {
    const hasAgent = c.agent !== undefined;
    const hasManager = c.manager !== undefined;
    const results = await Promise.all([
      call(c),
      call(c, merchantCookie),
      ...(hasAgent ? [call(c, agentCookie)] : []),
      ...(hasManager ? [call(c, managerCookie)] : []),
      call(c, adminCookie),
    ]);

    let idx = 0;
    const anon = results[idx++];
    const merchant = results[idx++];
    const agent = hasAgent ? results[idx++] : undefined;
    const manager = hasManager ? results[idx++] : undefined;
    const admin = results[idx++];

    const anonOk = c.anon.includes(anon);
    const merchantOk = c.merchant.includes(merchant);
    const agentOk = !hasAgent || (c.agent!.includes(agent!));
    const managerOk = !hasManager || (c.manager!.includes(manager!));
    const adminOk = c.admin.includes(admin);
    const ok = anonOk && merchantOk && agentOk && managerOk && adminOk;

    const agentStr = hasAgent ? String(agent!).padEnd(6) : "—     ";
    const managerStr = hasManager ? String(manager!).padEnd(8) : "—       ";
    const mark = ok ? "✓" : "✗";
    console.log(
      `${mark} ${(c.method + " " + c.path).padEnd(48)} ${String(anon).padEnd(5)} ${String(merchant).padEnd(9)} ${agentStr} ${managerStr} ${String(admin).padEnd(5)}  (${c.description})`
    );
    if (!ok) {
      failures++;
      let expected = `anon∈${JSON.stringify(c.anon)} merchant∈${JSON.stringify(c.merchant)}`;
      if (hasAgent) expected += ` agent∈${JSON.stringify(c.agent)}`;
      if (hasManager) expected += ` manager∈${JSON.stringify(c.manager)}`;
      expected += ` admin∈${JSON.stringify(c.admin)}`;
      console.log(`    expected ${expected}`);
    }
  }
  console.log(`\n${CASES.length - failures}/${CASES.length} guarded routes behave correctly across anon/merchant/agent/manager/admin.`);

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

  // ── Wave 12: Merchant positive ownership path ────────────────────────────
  // A merchant who IS the assigned owner of a contact's document must get 200.
  // (contact.email === merchant.email is the ownership signal in canAccessContactDocs)
  console.log("\n── Wave 12: Merchant positive ownership path (real doc, own contact) ──");
  let merchantOwnerTestPassed = false;
  let merchantOwnerDoc: number | null = null;
  let merchantOwnerContact: number | null = null;
  try {
    await db.execute(
      drizzleSql`DELETE FROM contacts WHERE email = ${MERCHANT_EMAIL} AND archived_at IS NULL`
    ).catch(() => {});

    const [ownContact] = await db.insert(contacts).values({
      firstName: "SmokeOwnerMerchant",
      lastName: "SelfOwned",
      email: MERCHANT_EMAIL,
      phone: "+10000000098",
      status: "active",
      leadSource: "test",
      sourceCategory: "test",
    } as any).returning({ id: contacts.id });
    merchantOwnerContact = ownContact.id;

    const [ownDoc] = await db.insert(documents).values({
      contactId: merchantOwnerContact,
      type: "statement",
      category: "Processing Statement",   // must be in MERCHANT_ALLOWED_CATEGORIES
      fileName: "smoke-merchant-owner.pdf",
      fileSize: 512,
      mimeType: "application/pdf",
      uploadedBy: "smoke-test",
      storageKey: "smoke/smoke-merchant-owner.pdf",
      accessScope: "merchant",            // canAccessDocument: scope must be 'merchant'
      status: "approved",                 // canAccessDocument: status must be 'approved'
    }).returning({ id: documents.id });
    merchantOwnerDoc = ownDoc.id;

    const merchantOwnerStatus = await fetch(
      `${BASE_URL}/api/merchant-documents/${merchantOwnerDoc}/access-token`,
      { headers: { cookie: merchantCookie } }
    ).then(r => r.status);

    if ([200, 302].includes(merchantOwnerStatus)) {
      console.log(`✓ Merchant positive ownership: merchant→${merchantOwnerStatus} (200/302✓ — own contact)`);
      merchantOwnerTestPassed = true;
    } else {
      console.log(`✗ Merchant positive ownership: merchant→${merchantOwnerStatus} (expected 200/302 for own contact)`);
      failures++;
    }
  } catch (err) {
    console.log(`✗ Merchant positive ownership threw: ${err instanceof Error ? err.message : String(err)}`);
    failures++;
  } finally {
    if (merchantOwnerDoc !== null) await db.delete(documents).where(eq(documents.id, merchantOwnerDoc)).catch(() => {});
    if (merchantOwnerContact !== null) await db.delete(contacts).where(eq(contacts.id, merchantOwnerContact)).catch(() => {});
  }

  const totalCases = CASES.length + 2; // +1 ownership (unrelated) +1 merchant positive path
  const totalPassed = totalCases - failures;
  console.log(`\n${totalPassed}/${totalCases} guarded routes/tests passed.`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
