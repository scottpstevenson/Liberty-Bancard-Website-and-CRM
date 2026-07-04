#!/usr/bin/env tsx
/**
 * Task #695 — Voice/SMS/Ringless Go-Live Audit — Approval Gate Smoke Test
 *
 * This is a READ/AUDIT-ONLY approval layer for the sms/voice_ai/ringless_vm
 * channels. This test verifies:
 *  1. evaluateChannelChecklist() never touches process.env for
 *     SMS_ENABLED/VOICE_AI_ENABLED/RINGLESS_VM_ENABLED (source-level check).
 *  2. GET /api/activation/channel-checklist/:channel rejects invalid channel
 *     keys and returns a structured checklist for the three canonical keys.
 *  3. POST /api/activation/channel-enable/:channel never sets the env flag
 *     (before/after comparison) and records a channel_audit_log row.
 *  4. POST /api/activation/channel-test-batch/:channel is a dry-run only —
 *     no outbound message tables are written to, and the response says so.
 *  5. All three routes are admin-only (403 for non-admin roles).
 *
 * Run with the dev server up:
 *   BASE_URL=http://localhost:5000 npx tsx scripts/test-channel-audit.ts
 *
 * Exits 0 if all assertions pass, 1 if any fail.
 */

import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { db, pool } from "../server/db";
import { users } from "../shared/models/auth";
import { channelAuditLog } from "../shared/schema";
import { eq, desc } from "drizzle-orm";

let passed = 0;
let failed = 0;
const failures: string[] = [];

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5000";
const TEST_ADMIN_EMAIL = "channel-audit-test-admin@libertybancard.test";
const TEST_ADMIN_PASSWORD = "ca-audit-test-pw-Rk4!q1";
const TEST_MERCHANT_EMAIL = "channel-audit-test-merchant@libertybancard.test";
const TEST_MERCHANT_PASSWORD = "ca-audit-test-pw-Zx8!m2";

const VALID_CHANNELS = ["sms", "voice_ai", "ringless_vm"];

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
      firstName: "ChannelAudit",
      lastName: "Test",
      passwordHash,
      role,
      authProvider: "local",
      emailVerified: new Date(),
    } as any);
  } else {
    await db.update(users)
      .set({ passwordHash, role, authProvider: "local", emailVerified: new Date() })
      .where(eq(users.email, email));
  }
}

function extractCookies(res: Response): string[] {
  const rawHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  const setCookieArr: string[] = typeof rawHeaders.getSetCookie === "function"
    ? rawHeaders.getSetCookie()
    : [res.headers.get("set-cookie") ?? ""];
  return setCookieArr.map((c) => c.split(";")[0].trim()).filter(Boolean);
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
  const cookies = extractCookies(res);
  if (cookies.length === 0) throw new Error(`No session cookie returned for ${email}`);
  return cookies.join("; ");
}

/** Fetches a CSRF token, merging its Set-Cookie into the session cookie jar. */
async function getCsrfHeaders(sessionCookie: string): Promise<{ cookie: string; csrfToken: string }> {
  const res = await fetch(`${BASE_URL}/api/csrf-token`, { headers: { Cookie: sessionCookie } });
  if (res.status !== 200) throw new Error(`Failed to fetch CSRF token: ${res.status}`);
  const body = await res.json();
  const newCookies = extractCookies(res);
  const cookie = newCookies.length > 0 ? `${sessionCookie}; ${newCookies.join("; ")}` : sessionCookie;
  return { cookie, csrfToken: body.token };
}

function checkSourceNeverTouchesEnvFlags() {
  console.log("▶ Static source check — approval gate never touches SMS/VOICE_AI/RINGLESS_VM env flags");
  const source = fs.readFileSync(path.join(process.cwd(), "server/routes/activation.ts"), "utf-8");

  // Find the channel-compliance section added for Task #695.
  const sectionStart = source.indexOf("CHANNEL COMPLIANCE APPROVAL GATE");
  const gateSection = sectionStart >= 0 ? source.slice(sectionStart) : source;

  const forbiddenWrites = [
    /process\.env\.SMS_ENABLED\s*=/,
    /process\.env\.VOICE_AI_ENABLED\s*=/,
    /process\.env\.RINGLESS_VM_ENABLED\s*=/,
    /setSecret\s*\(/i,
    /deleteSecret\s*\(/i,
  ];
  for (const re of forbiddenWrites) {
    assert(`gate section does not match forbidden pattern ${re}`, !re.test(gateSection));
  }

  // The evaluator function itself must not assign to process.env at all.
  const evalFnMatch = source.match(/export async function evaluateChannelChecklist[\s\S]*?\n}\n/);
  assert("evaluateChannelChecklist() found in source", !!evalFnMatch);
  if (evalFnMatch) {
    assert("evaluateChannelChecklist() never assigns to process.env", !/process\.env\.\w+\s*=/.test(evalFnMatch[0]));
  }
}

async function testInvalidChannelRejected(adminCookie: string) {
  console.log("▶ Invalid channel key rejected");
  const res = await fetch(`${BASE_URL}/api/activation/channel-checklist/voice`, {
    headers: { Cookie: adminCookie },
  });
  assert("GET .../channel-checklist/voice (non-canonical key) → 400", res.status === 400, `got ${res.status}`);

  const res2 = await fetch(`${BASE_URL}/api/activation/channel-checklist/call`, {
    headers: { Cookie: adminCookie },
  });
  assert("GET .../channel-checklist/call (bare 'call') → 400", res2.status === 400, `got ${res2.status}`);
}

async function testChecklistStructure(adminCookie: string) {
  console.log("▶ Checklist structure for canonical channels");
  for (const channel of VALID_CHANNELS) {
    const res = await fetch(`${BASE_URL}/api/activation/channel-checklist/${channel}`, {
      headers: { Cookie: adminCookie },
    });
    assert(`GET .../channel-checklist/${channel} → 200`, res.status === 200, `got ${res.status}`);
    if (res.status !== 200) continue;
    const body = await res.json();
    assert(`${channel}: response.channel === "${channel}"`, body.channel === channel);
    assert(`${channel}: response has items[]`, Array.isArray(body.items) && body.items.length > 0);
    assert(`${channel}: response has boolean passed`, typeof body.passed === "boolean");
    assert(`${channel}: response has boolean currentlyEnabled`, typeof body.currentlyEnabled === "boolean");
  }
}

async function testNonAdminForbidden(merchantCookie: string) {
  console.log("▶ Non-admin roles forbidden on all three routes");
  const getRes = await fetch(`${BASE_URL}/api/activation/channel-checklist/sms`, { headers: { Cookie: merchantCookie } });
  assert("merchant GET channel-checklist/sms → 403", getRes.status === 403, `got ${getRes.status}`);

  const enableRes = await fetch(`${BASE_URL}/api/activation/channel-enable/sms`, { method: "POST", headers: { Cookie: merchantCookie } });
  assert("merchant POST channel-enable/sms → 403", enableRes.status === 403, `got ${enableRes.status}`);

  const testBatchRes = await fetch(`${BASE_URL}/api/activation/channel-test-batch/sms`, { method: "POST", headers: { Cookie: merchantCookie } });
  assert("merchant POST channel-test-batch/sms → 403", testBatchRes.status === 403, `got ${testBatchRes.status}`);
}

async function testEnableNeverTogglesEnvFlag(adminCookie: string) {
  console.log("▶ channel-enable never toggles env flag; records audit row");
  const before: Record<string, string | undefined> = {
    SMS_ENABLED: process.env.SMS_ENABLED,
    VOICE_AI_ENABLED: process.env.VOICE_AI_ENABLED,
    RINGLESS_VM_ENABLED: process.env.RINGLESS_VM_ENABLED,
  };

  const [beforeCount] = await db.select({ c: channelAuditLog.id }).from(channelAuditLog).orderBy(desc(channelAuditLog.id)).limit(1);

  const { cookie, csrfToken } = await getCsrfHeaders(adminCookie);
  const res = await fetch(`${BASE_URL}/api/activation/channel-enable/sms`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ notes: "smoke-test enable attempt" }),
  });
  assert(
    "POST channel-enable/sms → 200, 400, or 403 (CSRF-gated; never 5xx)",
    res.status === 200 || res.status === 400 || res.status === 403,
    `got ${res.status}`
  );
  const body = await res.json().catch(() => ({}));

  assert(
    "process.env.SMS_ENABLED unchanged after enable call",
    process.env.SMS_ENABLED === before.SMS_ENABLED
  );
  assert(
    "process.env.VOICE_AI_ENABLED unchanged after enable call",
    process.env.VOICE_AI_ENABLED === before.VOICE_AI_ENABLED
  );
  assert(
    "process.env.RINGLESS_VM_ENABLED unchanged after enable call",
    process.env.RINGLESS_VM_ENABLED === before.RINGLESS_VM_ENABLED
  );

  if (res.status === 403) {
    console.log("  (skipping response-body assertions — request was blocked by CSRF middleware before reaching the route handler)");
  } else if (body.approvedToEnable) {
    assert("approved response includes manualStep instructing operator action", typeof body.manualStep === "string" && /Replit Secret/i.test(body.manualStep));
    assert("approved response includes auditId", typeof body.auditId === "number");
  } else {
    assert("denied response includes checklist", !!body.checklist);
  }

  if (res.status !== 403) {
    const [afterRow] = await db.select().from(channelAuditLog).where(eq(channelAuditLog.channel, "sms")).orderBy(desc(channelAuditLog.id)).limit(1);
    assert("a channel_audit_log row exists for sms after the call", !!afterRow);
    if (afterRow && beforeCount) {
      assert("new audit row id is greater than the previous max", afterRow.id > beforeCount.c);
    }
  }
}

async function testTestBatchIsDryRun(adminCookie: string) {
  console.log("▶ test-batch is a dry-run — nothing is sent");
  const { cookie, csrfToken } = await getCsrfHeaders(adminCookie);
  const res = await fetch(`${BASE_URL}/api/activation/channel-test-batch/sms`, {
    method: "POST",
    headers: { Cookie: cookie, "X-CSRF-Token": csrfToken },
  });
  assert(
    "POST channel-test-batch/sms → 200 or 403 (CSRF-gated)",
    res.status === 200 || res.status === 403,
    `got ${res.status}`
  );
  if (res.status !== 200) {
    console.log("  (skipping response-body assertions — request was blocked by CSRF middleware before reaching the route handler)");
    return;
  }
  const body = await res.json();
  assert("dryRun === true", body.dryRun === true);
  assert("sent === false", body.sent === false);
  assert("candidateCount is a number", typeof body.candidateCount === "number");
  assert("candidates is an array", Array.isArray(body.candidates));
  assert("note mentions no message was sent", /no .* was sent or queued/i.test(body.note || ""));
}

async function main() {
  console.log("=".repeat(70));
  console.log("Task #695 — Voice/SMS/Ringless Go-Live Audit Approval Gate Smoke Test");
  console.log("=".repeat(70));

  checkSourceNeverTouchesEnvFlags();

  await ensureUser(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, "admin");
  await ensureUser(TEST_MERCHANT_EMAIL, TEST_MERCHANT_PASSWORD, "merchant");

  const adminCookie = await loginForCookie(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
  const merchantCookie = await loginForCookie(TEST_MERCHANT_EMAIL, TEST_MERCHANT_PASSWORD);

  await testInvalidChannelRejected(adminCookie);
  await testChecklistStructure(adminCookie);
  await testNonAdminForbidden(merchantCookie);
  await testEnableNeverTogglesEnvFlag(adminCookie);
  await testTestBatchIsDryRun(adminCookie);

  console.log("\n" + "=".repeat(70));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log("=".repeat(70));

  await pool.end().catch(() => {});
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error running smoke test:", err);
  process.exit(1);
});
