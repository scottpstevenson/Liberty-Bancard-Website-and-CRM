#!/usr/bin/env tsx
/**
 * Task #767 — Truthful-State Follow-ups: Call Follow-Up SMS Result Regression Test
 *
 * Verifies /api/call-follow-ups/send returns the correct truthful
 * sent/skipped/not_configured/failed smsResult for each contact eligibility
 * scenario, and that the shared computeSmsEligibility() helper used by the
 * Call Outcome UI agrees with the backend's own gating decisions.
 *
 * No real SMS/email/GHL sends occur: GHL is not configured in this
 * environment by default, and the "no phone" / "no consent" cases never
 * reach the provider call at all. If GHL happens to be configured
 * (GHL_PRIVATE_INTEGRATION_TOKEN set to a real-looking token), the script
 * aborts unless the target server reports the fail-fast GHL test transport
 * (ghlTransportFailFast=true on /api/health), mirroring scripts/test-forms.ts.
 * There is no acknowledgment flag: isolation is server-verified transport
 * interception (GHL_TRANSPORT_FAILFAST=true at server startup) or nothing.
 *
 * Run with the dev server up:
 *   BASE_URL=http://localhost:5000 npx tsx scripts/test-call-follow-ups.ts
 *
 * Exits 0 if all assertions pass, 1 if any fail, 2 if environment unsuitable.
 */

import bcrypt from "bcryptjs";
import { db, pool } from "../server/db";
import { contacts } from "../shared/schema";
import { users } from "../shared/models/auth";
import { eq } from "drizzle-orm";
import { computeSmsEligibility } from "../shared/sms-eligibility";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5000";
const TEST_MANAGER_EMAIL = "call-followups-test-manager@libertybancard.test";
const TEST_MANAGER_PASSWORD = "cf-test-pw-Qz7!k2";

const GHL_TOKEN = process.env.GHL_PRIVATE_INTEGRATION_TOKEN ?? "";
const TOKEN_LOOKS_REAL =
  GHL_TOKEN.length > 20 &&
  !GHL_TOKEN.startsWith("test_") &&
  !GHL_TOKEN.startsWith("placeholder") &&
  !GHL_TOKEN.startsWith("CHANGE_ME");

// ── C-03 (#1626): server-verified fail-fast transport, never an env flag ────
// When a real-looking GHL token is present, the TARGET SERVER must report the
// fail-fast GHL test transport on /api/health. An env flag on this child
// process proves nothing about the server actually handling the send.
if (TOKEN_LOOKS_REAL) {
  let failFastInstalled = false;
  try {
    const healthResp = await fetch(`${BASE_URL}/api/health`);
    const health: any = await healthResp.json().catch(() => ({}));
    failFastInstalled = health?.ghlTransportFailFast === true;
  } catch {
    failFastInstalled = false;
  }
  if (!failFastInstalled) {
    console.error(
      "\nKILL LINE: GHL_PRIVATE_INTEGRATION_TOKEN is set and the target server does NOT\n" +
      "report the fail-fast GHL test transport (ghlTransportFailFast=true on /api/health).\n" +
      "This test could trigger a real SMS/email send.\n\n" +
      "  Options:\n" +
      "    1. Unset GHL_PRIVATE_INTEGRATION_TOKEN before running (safest)\n" +
      "    2. Restart the server with GHL_TRANSPORT_FAILFAST=true (run-pre-deploy.sh does this)\n"
    );
    process.exit(2);
  }
  console.log("🔒 GHL isolation: server-verified fail-fast transport (ghlTransportFailFast=true)");
} else {
  console.log("🔒 GHL isolation: GHL_PRIVATE_INTEGRATION_TOKEN absent or sentinel — provider calls fail at the API layer");
}

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

async function ensureTestManagerUser(): Promise<void> {
  const passwordHash = await bcrypt.hash(TEST_MANAGER_PASSWORD, 12);
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, TEST_MANAGER_EMAIL));
  if (existing.length === 0) {
    await db.insert(users).values({
      email: TEST_MANAGER_EMAIL,
      firstName: "CF",
      lastName: "TestMgr",
      passwordHash,
      role: "manager",
      authProvider: "local",
      emailVerified: new Date(),
    });
  } else {
    await db.update(users)
      .set({ passwordHash, role: "manager", authProvider: "local", emailVerified: new Date() })
      .where(eq(users.email, TEST_MANAGER_EMAIL));
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

async function createTestContact(overrides: Record<string, unknown>): Promise<number> {
  const data: Record<string, unknown> = {
    firstName: "CF",
    lastName: "Test",
    email: `test-cf-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    companyName: "Test Co",
    emailStatus: "active",
    smsStatus: "active",
    doNotContact: false,
    doNotAutoContact: false,
    consentSms: false,
    consentEmail: false,
    ...overrides,
  };
  const [row] = await db.insert(contacts).values(data as any).returning({ id: contacts.id });
  return row.id;
}

async function cleanupContact(id: number) {
  await db.delete(contacts).where(eq(contacts.id, id)).catch(() => {});
}

async function getCsrfToken(cookie: string): Promise<{ token: string; cookie: string }> {
  const res = await fetch(`${BASE_URL}/api/csrf-token`, { headers: { Cookie: cookie } });
  const body = await res.json();
  const rawHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  const setCookieArr: string[] = typeof rawHeaders.getSetCookie === "function"
    ? rawHeaders.getSetCookie()
    : [res.headers.get("set-cookie") ?? ""];
  const newCookies = setCookieArr.map((c) => c.split(";")[0].trim()).filter(Boolean);
  const mergedCookie = newCookies.length > 0 ? newCookies.join("; ") : cookie;
  return { token: body.token, cookie: mergedCookie };
}

async function sendFollowUp(cookie: string, contactId: number, smsBody: string | undefined) {
  const { token: csrfToken, cookie: cookieWithCsrf } = await getCsrfToken(cookie);
  const res = await fetch(`${BASE_URL}/api/call-follow-ups/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieWithCsrf, "x-csrf-token": csrfToken },
    body: JSON.stringify({
      contactId,
      outcome: "Connected - Not a Fit",
      sendEmail: false,
      sendSms: true,
      smsBody,
    }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function main() {
  console.log(`▶ Testing /api/call-follow-ups/send truthful smsResult enum against ${BASE_URL}\n`);

  await ensureTestManagerUser();
  const cookie = await loginForCookie(TEST_MANAGER_EMAIL, TEST_MANAGER_PASSWORD);

  const cleanupIds: number[] = [];

  try {
    // 1. No phone number → skipped
    const noPhoneId = await createTestContact({ phone: "", consentSms: true });
    cleanupIds.push(noPhoneId);
    const noPhoneResult = await sendFollowUp(cookie, noPhoneId, "Hey there, following up!");
    assert(
      "No phone number → smsResult=skipped",
      noPhoneResult.body.smsResult === "skipped" && noPhoneResult.body.smsSent === false,
      JSON.stringify(noPhoneResult.body)
    );
    assert(
      "No phone number → smsMessage mentions phone",
      /phone number/i.test(noPhoneResult.body.smsMessage || "")
    );

    // 2. No consent → skipped
    const noConsentId = await createTestContact({ phone: "3055559999", consentSms: false });
    cleanupIds.push(noConsentId);
    const noConsentResult = await sendFollowUp(cookie, noConsentId, "Hey there, following up!");
    assert(
      "No SMS consent → smsResult=skipped",
      noConsentResult.body.smsResult === "skipped" && noConsentResult.body.smsSent === false,
      JSON.stringify(noConsentResult.body)
    );
    assert(
      "No SMS consent → smsMessage mentions consent",
      /consent/i.test(noConsentResult.body.smsMessage || "")
    );

    // 3. No SMS body provided → skipped
    const noBodyId = await createTestContact({ phone: "3055558888", consentSms: true });
    cleanupIds.push(noBodyId);
    const noBodyResult = await sendFollowUp(cookie, noBodyId, undefined);
    assert(
      "No SMS body → smsResult=skipped",
      noBodyResult.body.smsResult === "skipped" && noBodyResult.body.smsSent === false,
      JSON.stringify(noBodyResult.body)
    );

    // 4. Eligible contact, GHL not configured (default in this environment) → not_configured
    const eligibleId = await createTestContact({ phone: "3055557777", consentSms: true });
    cleanupIds.push(eligibleId);
    const eligibleResult = await sendFollowUp(cookie, eligibleId, "Hey there, following up!");
    if (!TOKEN_LOOKS_REAL) {
      assert(
        "Eligible contact + GHL not configured → smsResult=not_configured",
        eligibleResult.body.smsResult === "not_configured" && eligibleResult.body.smsSent === false,
        JSON.stringify(eligibleResult.body)
      );
    } else {
      assert(
        "Eligible contact + GHL configured (test mode) → smsResult is sent or failed, never a silent success",
        eligibleResult.body.smsResult === "sent" || eligibleResult.body.smsResult === "failed",
        JSON.stringify(eligibleResult.body)
      );
    }

    // 5. Cross-check: shared computeSmsEligibility() helper used by the UI
    //    agrees with the backend's block decisions for the same contacts.
    const noPhoneElig = computeSmsEligibility({
      selectedContactId: String(noPhoneId),
      contactsLoading: false,
      contact: { phone: "", consentSms: true },
    });
    assert("Shared eligibility helper: no phone → not eligible", noPhoneElig.eligible === false);

    const noConsentElig = computeSmsEligibility({
      selectedContactId: String(noConsentId),
      contactsLoading: false,
      contact: { phone: "3055559999", consentSms: false },
    });
    assert("Shared eligibility helper: no consent → not eligible", noConsentElig.eligible === false);

    const eligibleElig = computeSmsEligibility({
      selectedContactId: String(eligibleId),
      contactsLoading: false,
      contact: { phone: "3055557777", consentSms: true },
    });
    assert("Shared eligibility helper: phone + consent → eligible", eligibleElig.eligible === true);

    const checkingElig = computeSmsEligibility({
      selectedContactId: String(eligibleId),
      contactsLoading: true,
      contact: undefined,
    });
    assert("Shared eligibility helper: contacts loading → checking state, not eligible", checkingElig.checking === true && checkingElig.eligible === false);
  } finally {
    for (const id of cleanupIds) await cleanupContact(id);
  }

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
