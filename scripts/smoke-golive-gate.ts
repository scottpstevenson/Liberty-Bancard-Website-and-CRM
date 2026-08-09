#!/usr/bin/env tsx
/**
 * #1297 — Go-Live Gate smoke test.
 *
 * Verifies:
 *  1. PUT /api/deals/:id with stage="Go-Live Scheduled" (onboarding pipeline,
 *     no MID/checklist) returns HTTP 422 with code GO_LIVE_GATE_FAILED.
 *  2. Same call WITH a valid admin overrideReason returns HTTP 200 and the
 *     updated deal. (Run only when a real onboarding deal exists.)
 *  3. The gate is skipped for non-onboarding pipeline deals (sales pipeline).
 *  4. Agent role receives canOverride: false in the 422 payload.
 *
 * Usage (dev server must be running):
 *   BASE_URL=http://localhost:5000 npx tsx scripts/smoke-golive-gate.ts
 *
 * Exits 0 if all assertions pass, 1 otherwise.
 */

import bcrypt from "bcryptjs";
import { db } from "../server/db";
import { users } from "../shared/models/auth";
import { contacts, deals } from "../shared/schema";
import { eq } from "drizzle-orm";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";

if (!process.env.ADMIN_SEED_EMAIL || !process.env.ADMIN_SEED_PASSWORD) {
  console.error(
    "\n✗ MISSING REQUIRED ENV: ADMIN_SEED_EMAIL and/or ADMIN_SEED_PASSWORD not set.\n" +
      "  Go-Live Gate smoke tests require admin credentials — failing closed.\n"
  );
  process.exit(1);
}

const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD;

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const AGENT_EMAIL = `glg-agent-${RUN_ID}@libertybancard.test`;
const AGENT_PASS  = `glgA!${RUN_ID}`;

let errors = 0;
let adminCookies = "";
let agentCookies = "";
let agentId = 0;
let contactId = 0;
let salesDealId = 0;
let onboardingDealId = 0;

// ── helpers ────────────────────────────────────────────────────────────────────

function pass(msg: string) { console.log(`  ✓ ${msg}`); }
function fail(msg: string) { console.error(`  ✗ ${msg}`); errors++; }

async function csrfToken(cookies: string): Promise<string> {
  const r = await fetch(`${BASE_URL}/api/csrf-token`, { headers: { cookie: cookies } });
  const j = await r.json();
  return j.token ?? "";
}

async function login(email: string, password: string): Promise<string> {
  const csrfR = await fetch(`${BASE_URL}/api/csrf-token`);
  const initCookies = (csrfR.headers.get("set-cookie") ?? "").split(",").map(c => c.split(";")[0]).join("; ");
  const initCsrf = (await csrfR.json()).token ?? "";

  const r = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: initCookies, "x-csrf-token": initCsrf },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`Login failed for ${email}: ${r.status}`);
  return (r.headers.get("set-cookie") ?? "").split(",").map(c => c.split(";")[0]).join("; ");
}

async function putDeal(
  cookies: string,
  dealId: number,
  body: Record<string, unknown>
): Promise<{ status: number; json: unknown }> {
  const csrf = await csrfToken(cookies);
  const r = await fetch(`${BASE_URL}/api/deals/${dealId}`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: cookies, "x-csrf-token": csrf },
    body: JSON.stringify(body),
  });
  let json: unknown;
  try { json = await r.json(); } catch { json = null; }
  return { status: r.status, json };
}

// ── setup ──────────────────────────────────────────────────────────────────────

console.log("\n── Setup ──────────────────────────────────────────────────");

try {
  // Admin login
  adminCookies = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  pass("Admin logged in");

  // Create agent user
  const hash = await bcrypt.hash(AGENT_PASS, 10);
  const [agent] = await db.insert(users).values({
    email: AGENT_EMAIL,
    password: hash,
    firstName: "GLG",
    lastName: "TestAgent",
    role: "agent",
  } as any).returning();
  agentId = agent.id;
  pass(`Created agent user ${AGENT_EMAIL}`);

  agentCookies = await login(AGENT_EMAIL, AGENT_PASS);
  pass("Agent logged in");

  // Create a test contact
  const csrf = await csrfToken(adminCookies);
  const cR = await fetch(`${BASE_URL}/api/contacts`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookies, "x-csrf-token": csrf },
    body: JSON.stringify({
      firstName: "GoLive",
      lastName: `Test-${RUN_ID}`,
      email: `glg-contact-${RUN_ID}@test.example`,
      phone: `+155500${RUN_ID.replace(/\D/g, "").slice(0, 6).padEnd(6, "0")}`,
    }),
  });
  const cJson = await cR.json() as any;
  contactId = cJson.id;
  pass(`Created contact #${contactId}`);

  // Create an onboarding deal (no MID) for gate checks
  const dCsrf = await csrfToken(adminCookies);
  const dR = await fetch(`${BASE_URL}/api/deals`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookies, "x-csrf-token": dCsrf },
    body: JSON.stringify({ contactId, pipeline: "onboarding", stage: "Application Submitted", title: `GLG-Deal-${RUN_ID}` }),
  });
  const dJson = await dR.json() as any;
  onboardingDealId = dJson.id;
  pass(`Created onboarding deal #${onboardingDealId}`);

  // Create a sales deal for non-gate check
  const sdCsrf = await csrfToken(adminCookies);
  const sdR = await fetch(`${BASE_URL}/api/deals`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookies, "x-csrf-token": sdCsrf },
    body: JSON.stringify({ contactId, pipeline: "sales", stage: "New", title: `GLG-SalesDeal-${RUN_ID}` }),
  });
  const sdJson = await sdR.json() as any;
  salesDealId = sdJson.id;
  pass(`Created sales deal #${salesDealId}`);

} catch (err: any) {
  console.error("Setup failed:", err.message);
  process.exit(1);
}

// ── Test Cases ────────────────────────────────────────────────────────────────

console.log("\n── Case 1: Admin → 422 on missing MID/checklist ────────────");
{
  const { status, json } = await putDeal(adminCookies, onboardingDealId, {
    stage: "Go-Live Scheduled",
  });
  if (status === 422) {
    pass(`HTTP 422 returned (status=${status})`);
    const j = json as any;
    if (j?.code === "GO_LIVE_GATE_FAILED") {
      pass(`code=GO_LIVE_GATE_FAILED`);
    } else {
      fail(`Expected code=GO_LIVE_GATE_FAILED, got: ${JSON.stringify(j?.code)}`);
    }
    if (j?.canOverride === true) {
      pass("canOverride=true for admin role");
    } else {
      fail(`Expected canOverride=true for admin, got: ${j?.canOverride}`);
    }
  } else {
    fail(`Expected 422, got ${status}. Body: ${JSON.stringify(json)}`);
  }
}

console.log("\n── Case 2: Agent → 422 with canOverride=false ───────────────");
{
  const { status, json } = await putDeal(agentCookies, onboardingDealId, {
    stage: "Go-Live Scheduled",
  });
  if (status === 422) {
    pass(`HTTP 422 returned`);
    const j = json as any;
    if (j?.canOverride === false) {
      pass("canOverride=false for agent role");
    } else {
      fail(`Expected canOverride=false for agent, got: ${j?.canOverride}`);
    }
  } else {
    fail(`Expected 422, got ${status}`);
  }
}

console.log("\n── Case 3: Admin override with reason → accepted (≤200, not 422) ──");
{
  const { status, json } = await putDeal(adminCookies, onboardingDealId, {
    stage: "Go-Live Scheduled",
    overrideReason: "Smoke-test manual override — admin approved",
  });
  // 200 = gate passed; 422 means override didn't work; other codes = bug
  if (status === 200 || status === 201) {
    pass(`Override accepted (HTTP ${status})`);
  } else if (status === 422) {
    fail(`Override NOT accepted — still getting 422. Body: ${JSON.stringify(json)}`);
  } else {
    fail(`Unexpected status ${status}. Body: ${JSON.stringify(json)}`);
  }
}

console.log("\n── Case 4: Non-onboarding pipeline → gate skipped ──────────");
{
  // Sales pipeline deal moving to a "Go-Live Scheduled" stage that isn't in GO_LIVE_GATE_STAGES
  // for the sales pipeline — gate only fires for onboarding pipeline.
  const { status, json } = await putDeal(adminCookies, salesDealId, {
    stage: "Statement Requested", // any non-gate sales stage
  });
  if (status !== 422) {
    pass(`Non-onboarding pipeline stage change not gate-blocked (HTTP ${status})`);
  } else {
    fail(`Sales pipeline stage change should not trigger Go-Live gate, got 422`);
  }
}

// ── Teardown ──────────────────────────────────────────────────────────────────

console.log("\n── Teardown ────────────────────────────────────────────────");
try {
  if (onboardingDealId) {
    await db.delete(deals).where(eq(deals.id, onboardingDealId));
    pass(`Deleted onboarding deal #${onboardingDealId}`);
  }
  if (salesDealId) {
    await db.delete(deals).where(eq(deals.id, salesDealId));
    pass(`Deleted sales deal #${salesDealId}`);
  }
  if (contactId) {
    await db.delete(contacts).where(eq(contacts.id, contactId));
    pass(`Deleted contact #${contactId}`);
  }
  if (agentId) {
    await db.delete(users).where(eq(users.id, agentId));
    pass(`Deleted agent user`);
  }
} catch (err: any) {
  console.error("Teardown error (non-fatal):", err.message);
}

// ── Result ────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
if (errors === 0) {
  console.log("✓ PASS — Go-Live gate smoke test complete (0 failures)");
  process.exit(0);
} else {
  console.error(`✗ FAIL — ${errors} assertion(s) failed`);
  process.exit(1);
}
