#!/usr/bin/env tsx
/**
 * Task #767 — Truthful-State Follow-ups: Digest Availability/Health Role Split
 *
 * Verifies:
 *  1. GET /api/notifications/digest-availability (any authenticated user)
 *     returns the scoped { deliveryAvailable, status, message } payload for
 *     a regular agent — never the full admin health shape, never a 403.
 *  2. GET /api/notifications/digest-health (admin/manager only) still returns
 *     the fuller payload for a manager, and still 403s for a regular agent.
 *  3. The scoped payload never leaks which provider (GHL/SMTP) is configured
 *     or raw scheduler/queue internals.
 *
 * No real digest email is sent — these are GET requests with no side effects.
 *
 * Run with the dev server up:
 *   BASE_URL=http://localhost:5000 npx tsx scripts/test-digest-availability.ts
 *
 * Exits 0 if all assertions pass, 1 if any fail.
 */

import bcrypt from "bcryptjs";
import { db, pool } from "../server/db";
import { users } from "../shared/models/auth";
import { eq } from "drizzle-orm";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5000";
const TEST_AGENT_EMAIL = "digest-test-agent@libertybancard.test";
const TEST_AGENT_PASSWORD = "dg-test-pw-Xr4!p9";
const TEST_MANAGER_EMAIL = "digest-test-manager@libertybancard.test";
const TEST_MANAGER_PASSWORD = "dg-test-pw-Ym2!q7";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
    failures.push(label);
  }
}

async function ensureUser(email: string, password: string, role: string): Promise<void> {
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing.length === 0) {
    await db.insert(users).values({
      email,
      firstName: "DG",
      lastName: role === "manager" ? "TestMgr" : "TestAgent",
      passwordHash,
      role,
      authProvider: "local",
      emailVerified: new Date(),
    });
  } else {
    await db.update(users)
      .set({ passwordHash, role, authProvider: "local", emailVerified: new Date() })
      .where(eq(users.email, email));
  }
}

async function loginForCookie(email: string, password: string): Promise<string> {
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
  const cookies = setCookieArr.map((c) => c.split(";")[0].trim()).filter(Boolean);
  if (cookies.length === 0) throw new Error(`No session cookie returned for ${email}`);
  return cookies.join("; ");
}

async function main() {
  console.log(`▶ Testing digest-availability/digest-health role split against ${BASE_URL}\n`);

  await ensureUser(TEST_AGENT_EMAIL, TEST_AGENT_PASSWORD, "agent");
  await ensureUser(TEST_MANAGER_EMAIL, TEST_MANAGER_PASSWORD, "manager");

  const agentCookie = await loginForCookie(TEST_AGENT_EMAIL, TEST_AGENT_PASSWORD);
  const managerCookie = await loginForCookie(TEST_MANAGER_EMAIL, TEST_MANAGER_PASSWORD);

  // 1. Agent hitting the scoped availability endpoint gets a 200 with the
  //    minimal shape, never a 403.
  const agentAvailRes = await fetch(`${BASE_URL}/api/notifications/digest-availability`, {
    headers: { Cookie: agentCookie },
  });
  const agentAvailBody = await agentAvailRes.json();
  assert("Agent digest-availability → 200 (not 403)", agentAvailRes.status === 200, `status=${agentAvailRes.status}`);
  assert(
    "Agent digest-availability → has deliveryAvailable boolean",
    typeof agentAvailBody.deliveryAvailable === "boolean",
    JSON.stringify(agentAvailBody)
  );
  assert(
    "Agent digest-availability → has status enum",
    ["active", "not_configured", "inactive", "unknown"].includes(agentAvailBody.status),
    JSON.stringify(agentAvailBody)
  );
  assert(
    "Agent digest-availability → has message string",
    typeof agentAvailBody.message === "string" && agentAvailBody.message.length > 0,
    JSON.stringify(agentAvailBody)
  );
  assert(
    "Agent digest-availability → never leaks which provider is configured",
    !("ghlConfigured" in agentAvailBody) && !("smtpConfigured" in agentAvailBody),
    JSON.stringify(agentAvailBody)
  );
  assert(
    "Agent digest-availability → never leaks scheduler internals",
    !("schedulerActive" in agentAvailBody),
    JSON.stringify(agentAvailBody)
  );
  // Truthful-state guard: it must never claim deliveryAvailable=true while
  // simultaneously reporting a non-"active" status (that would be exactly
  // the false "looks enabled" signal this task must prevent).
  if (agentAvailBody.deliveryAvailable === true) {
    assert("Agent digest-availability → deliveryAvailable=true implies status=active", agentAvailBody.status === "active", JSON.stringify(agentAvailBody));
  } else {
    assert("Agent digest-availability → deliveryAvailable=false implies status!=active", agentAvailBody.status !== "active", JSON.stringify(agentAvailBody));
  }

  // 2. Agent hitting the full admin health endpoint must be blocked (403),
  //    not silently downgraded.
  const agentHealthRes = await fetch(`${BASE_URL}/api/notifications/digest-health`, {
    headers: { Cookie: agentCookie },
  });
  assert("Agent digest-health → 403 (blocked from full admin payload)", agentHealthRes.status === 403, `status=${agentHealthRes.status}`);

  // 3. Manager hitting the full admin health endpoint still gets the fuller
  //    payload (this task must not regress existing admin/manager behavior).
  const managerHealthRes = await fetch(`${BASE_URL}/api/notifications/digest-health`, {
    headers: { Cookie: managerCookie },
  });
  const managerHealthBody = await managerHealthRes.json();
  assert("Manager digest-health → 200", managerHealthRes.status === 200, `status=${managerHealthRes.status}`);
  assert(
    "Manager digest-health → still exposes emailProviderConfigured/ghlConfigured/smtpConfigured",
    typeof managerHealthBody.emailProviderConfigured === "boolean" &&
      "ghlConfigured" in managerHealthBody &&
      "smtpConfigured" in managerHealthBody,
    JSON.stringify(managerHealthBody)
  );
  assert(
    "Manager digest-health → still exposes schedulerActive",
    "schedulerActive" in managerHealthBody,
    JSON.stringify(managerHealthBody)
  );

  // 4. Manager can also hit the scoped availability endpoint (any
  //    authenticated user), and it agrees with the fuller health payload.
  const managerAvailRes = await fetch(`${BASE_URL}/api/notifications/digest-availability`, {
    headers: { Cookie: managerCookie },
  });
  const managerAvailBody = await managerAvailRes.json();
  assert("Manager digest-availability → 200", managerAvailRes.status === 200, `status=${managerAvailRes.status}`);
  const expectedDeliverable = managerHealthBody.emailProviderConfigured && managerHealthBody.schedulerActive === true;
  assert(
    "Manager digest-availability deliveryAvailable agrees with digest-health inputs",
    managerAvailBody.deliveryAvailable === expectedDeliverable,
    `avail=${managerAvailBody.deliveryAvailable} expected=${expectedDeliverable}`
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFailures:", failures.join(", "));
  }
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  process.exit(1);
});
