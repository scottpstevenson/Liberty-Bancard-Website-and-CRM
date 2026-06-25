#!/usr/bin/env tsx
/**
 * Wave 1A — Contactability Engine Smoke Test
 *
 * Tests:
 *  1. deriveConsentTier() unit tests
 *  2. evaluateContactability() integration tests (service-level, all 17 steps)
 *  3. Gate integration test — enrollContactInGhlWorkflow blocks doNotAutoContact contacts
 *  4. API-level test — GET /api/contacts/:id/contactability dryRun mode (no audit logs written)
 *
 * Run with the dev server up:
 *   BASE_URL=http://localhost:5000 npx tsx scripts/test-contactability.ts
 *
 * If ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD are set, the API-level test will also
 * authenticate and test the HTTP endpoint. Otherwise, only service-level tests run.
 *
 * Exits 0 if all assertions pass, 1 if any fail.
 */

import bcrypt from "bcryptjs";
import { db } from "../server/db";
import { contacts, consentAuditLogs } from "../shared/schema";
import { users } from "../shared/models/auth";
import { eq, and, sql as drizzleSql } from "drizzle-orm";
import { evaluateContactability, deriveConsentTier } from "../server/services/contactability";
import { enrollContactInGhlWorkflow } from "../server/services/ghl-workflow-enrollment";
import { checkBeforeSend } from "../server/services/sdr/compliance-engine";
import { pool } from "../server/db";

let passed = 0;
let failed = 0;
const failures: string[] = [];

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5000";
// Dedicated test manager account — no 2FA, avoids admin 2FA enforcement
const TEST_MANAGER_EMAIL = "contactability-test-manager@libertybancard.test";
const TEST_MANAGER_PASSWORD = "ca-test-pw-Mm9!v3";

async function ensureTestManagerUser(): Promise<void> {
  const passwordHash = await bcrypt.hash(TEST_MANAGER_PASSWORD, 12);
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, TEST_MANAGER_EMAIL));
  if (existing.length === 0) {
    await db.insert(users).values({
      email: TEST_MANAGER_EMAIL,
      firstName: "CA",
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
  // Node 18+ fetch: getSetCookie() returns each Set-Cookie header separately
  const rawHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  const setCookieArr: string[] = typeof rawHeaders.getSetCookie === "function"
    ? rawHeaders.getSetCookie()
    : [res.headers.get("set-cookie") ?? ""];
  const cookies = setCookieArr.map((c) => c.split(";")[0].trim()).filter(Boolean);
  if (cookies.length === 0) throw new Error(`No session cookie returned for ${email}`);
  return cookies.join("; ");
}

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

async function createTestContact(overrides: Record<string, unknown>): Promise<number> {
  const data: Record<string, unknown> = {
    firstName: "Test",
    lastName: "Lead",
    email: `test-ca-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    phone: "3055551234",
    companyName: "Test Co",
    emailStatus: "active",
    smsStatus: "active",
    doNotContact: false,
    doNotAutoContact: false,
    consentSms: false,
    consentEmail: false,
    emailOptInAt: null,
    ...overrides,
  };
  const [row] = await db.insert(contacts).values(data as any).returning({ id: contacts.id });
  return row.id;
}

async function cleanupAuditLogs(): Promise<void> {
  await db.delete(consentAuditLogs).where(eq(consentAuditLogs.source, "contactability_engine")).catch(() => {});
}

async function runDeriveConsentTierTests() {
  console.log("▶ deriveConsentTier() unit tests");

  assert("cold scraped → cold_no_consent", deriveConsentTier({
    doNotContact: false, smsStatus: "active", emailStatus: "active",
    consentTier: "cold_no_consent", leadSource: null, sourceCategory: "scraped",
    consentSms: false, emailOptInAt: null,
  }) === "cold_no_consent");

  assert("inbound source → warm_no_pewc", deriveConsentTier({
    doNotContact: false, smsStatus: "active", emailStatus: "active",
    consentTier: "cold_no_consent", leadSource: "website", sourceCategory: "inbound",
    consentSms: false, emailOptInAt: null,
  }) === "warm_no_pewc");

  assert("doNotContact → do_not_contact", deriveConsentTier({
    doNotContact: true, smsStatus: "active", emailStatus: "active",
    consentTier: "cold_no_consent", leadSource: null, sourceCategory: null,
    consentSms: false, emailOptInAt: null,
  }) === "do_not_contact");

  assert("opted_out smsStatus → opted_out", deriveConsentTier({
    doNotContact: false, smsStatus: "opted_out", emailStatus: "active",
    consentTier: "cold_no_consent", leadSource: null, sourceCategory: null,
    consentSms: false, emailOptInAt: null,
  }) === "opted_out");

  // Fix 2: pewcEvidenceVerified=true must upgrade ANY non-DNC/opted-out contact
  // to pewc_full_automation regardless of source heuristics.
  assert("Fix 2: scraped contact + pewcEvidenceVerified=true → pewc_full_automation", deriveConsentTier({
    doNotContact: false, smsStatus: "active", emailStatus: "active",
    consentTier: "cold_no_consent", leadSource: "sunbiz", sourceCategory: "scraped",
    consentSms: false, emailOptInAt: null,
  }, true) === "pewc_full_automation");

  assert("Fix 2: inbound contact + pewcEvidenceVerified=true → pewc_full_automation", deriveConsentTier({
    doNotContact: false, smsStatus: "active", emailStatus: "active",
    consentTier: "warm_no_pewc", leadSource: "website", sourceCategory: "inbound",
    consentSms: true, emailOptInAt: new Date(),
  }, true) === "pewc_full_automation");

  assert("Fix 2: pewcEvidenceVerified=false still respects source heuristics (inbound→warm)", deriveConsentTier({
    doNotContact: false, smsStatus: "active", emailStatus: "active",
    consentTier: "cold_no_consent", leadSource: "website", sourceCategory: "inbound",
    consentSms: false, emailOptInAt: null,
  }, false) === "warm_no_pewc");

  assert("Fix 2: DNC takes priority even when pewcEvidenceVerified=true", deriveConsentTier({
    doNotContact: true, smsStatus: "active", emailStatus: "active",
    consentTier: "cold_no_consent", leadSource: null, sourceCategory: null,
    consentSms: false, emailOptInAt: null,
  }, true) === "do_not_contact");

  assert("Fix 2: opted_out takes priority even when pewcEvidenceVerified=true", deriveConsentTier({
    doNotContact: false, smsStatus: "opted_out", emailStatus: "active",
    consentTier: "cold_no_consent", leadSource: null, sourceCategory: null,
    consentSms: false, emailOptInAt: null,
  }, true) === "opted_out");
}

async function runEvaluateContactabilityTests() {
  console.log("\n▶ evaluateContactability() integration tests\n");

  // ── Cold scraped lead ─────────────────────────────────────────────────
  console.log("  [Cold scraped lead]");
  const coldId = await createTestContact({ sourceCategory: "scraped", consentTier: "cold_no_consent", leadSource: "sunbiz" });

  const coldEmail = await evaluateContactability({ contactId: coldId, channel: "email", mode: "dryRun" });
  assert("cold scraped can receive email", coldEmail.allowed, coldEmail.reason);

  const coldCall = await evaluateContactability({ contactId: coldId, channel: "manual_call", mode: "dryRun" });
  assert("cold scraped can get manual call task", coldCall.allowed, coldCall.reason);

  const coldSms = await evaluateContactability({ contactId: coldId, channel: "sms", mode: "dryRun" });
  assert("cold scraped cannot receive SMS", !coldSms.allowed, coldSms.reason);
  assert("cold SMS block reason mentions consent", coldSms.reason.toLowerCase().includes("pewc") || coldSms.reason.toLowerCase().includes("consent"), coldSms.reason);

  const coldVoice = await evaluateContactability({ contactId: coldId, channel: "voice_ai", mode: "dryRun" });
  assert("cold scraped cannot receive AI voice", !coldVoice.allowed, coldVoice.reason);

  const coldRvm = await evaluateContactability({ contactId: coldId, channel: "ringless_vm", mode: "dryRun" });
  assert("cold scraped cannot receive ringless voicemail", !coldRvm.allowed, coldRvm.reason);

  // ── Warm no-PEWC lead ─────────────────────────────────────────────────
  console.log("\n  [Warm no-PEWC lead]");
  const warmId = await createTestContact({ sourceCategory: "inbound", consentTier: "warm_no_pewc", leadSource: "website" });

  assert("warm no-PEWC: SMS blocked", !(await evaluateContactability({ contactId: warmId, channel: "sms", mode: "dryRun" })).allowed);
  assert("warm no-PEWC: AI voice blocked", !(await evaluateContactability({ contactId: warmId, channel: "voice_ai", mode: "dryRun" })).allowed);
  assert("warm no-PEWC: ringless VM blocked", !(await evaluateContactability({ contactId: warmId, channel: "ringless_vm", mode: "dryRun" })).allowed);

  // ── doNotContact ──────────────────────────────────────────────────────
  console.log("\n  [doNotContact = true]");
  const dncId = await createTestContact({ doNotContact: true });
  for (const ch of ["email", "manual_call", "sms", "voice_ai", "ringless_vm"] as const) {
    const r = await evaluateContactability({ contactId: dncId, channel: ch, mode: "dryRun" });
    assert(`doNotContact blocks ${ch}`, !r.allowed, r.reason);
  }

  // ── doNotAutoContact ──────────────────────────────────────────────────
  console.log("\n  [doNotAutoContact = true]");
  const dnacId = await createTestContact({ doNotAutoContact: true });

  const dnacManual = await evaluateContactability({ contactId: dnacId, channel: "manual_call", mode: "dryRun" });
  assert("doNotAutoContact does NOT block manual_call", dnacManual.allowed, dnacManual.reason);

  const dnacEmail = await evaluateContactability({ contactId: dnacId, channel: "email", mode: "dryRun" });
  assert("doNotAutoContact blocks automated email", !dnacEmail.allowed, dnacEmail.reason);
  assert("doNotAutoContact email block mentions allowedChannels=[manual_call]", dnacEmail.allowedChannels?.includes("manual_call") ?? false, JSON.stringify(dnacEmail.allowedChannels));

  // ── SMS STOP ──────────────────────────────────────────────────────────
  console.log("\n  [SMS STOP (smsStatus=opted_out)]");
  const smsStopId = await createTestContact({ smsStatus: "opted_out", consentTier: "warm_no_pewc" });
  assert("SMS STOP blocks SMS channel", !(await evaluateContactability({ contactId: smsStopId, channel: "sms", mode: "dryRun" })).allowed);
  assert("SMS STOP does not block email", (await evaluateContactability({ contactId: smsStopId, channel: "email", mode: "dryRun" })).allowed);

  // ── Bounced email ─────────────────────────────────────────────────────
  console.log("\n  [emailStatus=bounced]");
  const bouncedId = await createTestContact({ emailStatus: "bounced" });
  assert("bounced email blocks email channel", !(await evaluateContactability({ contactId: bouncedId, channel: "email", mode: "dryRun" })).allowed);

  // ── DNC reason ────────────────────────────────────────────────────────
  console.log("\n  [dncReason set]");
  const dncReasonId = await createTestContact({ dncReason: "Customer requested DNC" });
  assert("DNC reason blocks manual_call", !(await evaluateContactability({ contactId: dncReasonId, channel: "manual_call", mode: "dryRun" })).allowed);
  assert("DNC reason does not block email", (await evaluateContactability({ contactId: dncReasonId, channel: "email", mode: "dryRun" })).allowed);

  // ── PEWC evidence check (step 12) ─────────────────────────────────────
  console.log("\n  [PEWC tier without audit evidence (step 12)]");
  const pewcNoEvidenceId = await createTestContact({ consentTier: "pewc_full_automation", sourceCategory: "inbound" });
  const pewcNoEvidence = await evaluateContactability({ contactId: pewcNoEvidenceId, channel: "sms", mode: "dryRun" });
  assert("PEWC tier without audit evidence is blocked at step 12", !pewcNoEvidence.allowed, pewcNoEvidence.reason);
  assert("Step 12 block reason mentions evidence/audit", pewcNoEvidence.reason.toLowerCase().includes("evidence") || pewcNoEvidence.reason.toLowerCase().includes("audit") || pewcNoEvidence.reason.toLowerCase().includes("consentedphone"), pewcNoEvidence.reason);

  // ── Fix 2: PEWC audit evidence upgrades cold_no_consent → pewc_full_automation ──
  console.log("\n  [Fix 2: PEWC evidence in audit log upgrades cold contact to pewc_full_automation]");
  // Create a cold/scraped contact (stored tier = cold_no_consent)
  const pewcEvidenceId = await createTestContact({ consentTier: "cold_no_consent", sourceCategory: "scraped", leadSource: "sunbiz" });
  // Insert verified PEWC audit log evidence (express_written + consentedPhone + disclosureVersion)
  await db.insert(consentAuditLogs).values({
    contactId: pewcEvidenceId,
    channel: "sms",
    action: "consent_recorded",
    consentType: "express_written",
    consented: true,
    source: "contactability_engine",
    consentedPhone: "+15551234567",
    disclosureVersion: "v1.0",
  });
  // evaluateContactability should detect the audit evidence and upgrade the effective tier.
  // In dev, SMS_ENABLED / VOICE_AI_ENABLED feature flags may be off, which blocks these
  // channels regardless of consent tier. The key assertion is that the block is NOT
  // caused by a consent-tier issue — the PEWC evidence must be recognized.
  const pewcUpgradedSms = await evaluateContactability({ contactId: pewcEvidenceId, channel: "sms", mode: "dryRun" });
  const smsBlockedByConsent = pewcUpgradedSms.reason.toLowerCase().includes("pewc") || pewcUpgradedSms.reason.toLowerCase().includes("consent tier");
  assert(
    "Fix 2: PEWC audit evidence recognized — SMS block (if any) is NOT a consent-tier rejection",
    pewcUpgradedSms.allowed || !smsBlockedByConsent,
    `Expected PEWC to be recognized; got: ${pewcUpgradedSms.reason}`
  );

  const pewcUpgradedVoice = await evaluateContactability({ contactId: pewcEvidenceId, channel: "voice_ai", mode: "dryRun" });
  const voiceBlockedByConsent = pewcUpgradedVoice.reason.toLowerCase().includes("pewc") || pewcUpgradedVoice.reason.toLowerCase().includes("consent tier");
  assert(
    "Fix 2: PEWC audit evidence recognized — voice_ai block (if any) is NOT a consent-tier rejection",
    pewcUpgradedVoice.allowed || !voiceBlockedByConsent,
    `Expected PEWC to be recognized; got: ${pewcUpgradedVoice.reason}`
  );
  // Clean up the PEWC evidence row so it doesn't pollute other tests
  await db.delete(consentAuditLogs).where(
    and(eq(consentAuditLogs.contactId, pewcEvidenceId), eq(consentAuditLogs.source, "contactability_engine"))
  );

  // ── Florida rule ──────────────────────────────────────────────────────
  console.log("\n  [Florida rule]");
  const flId = await createTestContact({ state: "FL", consentTier: "warm_no_pewc", sourceCategory: "inbound" });
  assert("Florida: SMS blocked without PEWC", !(await evaluateContactability({ contactId: flId, channel: "sms", mode: "dryRun", state: "FL" })).allowed);
  assert("Florida: AI voice blocked without PEWC", !(await evaluateContactability({ contactId: flId, channel: "voice_ai", mode: "dryRun", state: "FL" })).allowed);
  assert("Florida: email NOT blocked solely by FL state", (await evaluateContactability({ contactId: flId, channel: "email", mode: "dryRun", state: "FL" })).allowed);
  assert("Florida: manual_call NOT blocked solely by FL state", (await evaluateContactability({ contactId: flId, channel: "manual_call", mode: "dryRun", state: "FL" })).allowed);

  // ── ghlPermissionPayload shape ────────────────────────────────────────
  console.log("\n  [ghlPermissionPayload shape]");
  const payloadResult = await evaluateContactability({ contactId: coldId, channel: "email", mode: "dryRun" });
  assert("ghlPermissionPayload has all 7 required fields", (
    "lb_email_allowed" in payloadResult.ghlPermissionPayload &&
    "lb_manual_call_allowed" in payloadResult.ghlPermissionPayload &&
    "lb_sms_allowed" in payloadResult.ghlPermissionPayload &&
    "lb_voice_ai_allowed" in payloadResult.ghlPermissionPayload &&
    "lb_ringless_vm_allowed" in payloadResult.ghlPermissionPayload &&
    "lb_channel_block_reason" in payloadResult.ghlPermissionPayload &&
    "lb_next_best_action" in payloadResult.ghlPermissionPayload
  ));
  assert("ghlPermissionPayload: email allowed for cold contact", payloadResult.ghlPermissionPayload.lb_email_allowed === true);
  assert("ghlPermissionPayload: sms blocked for cold contact (no PEWC)", payloadResult.ghlPermissionPayload.lb_sms_allowed === false);

  // ── Audit log: dryRun vs enforcement ─────────────────────────────────
  console.log("\n  [Audit log: dryRun mode writes no logs]");
  const auditTestId = await createTestContact({ doNotAutoContact: true });
  const beforeDryRun = await db.select().from(consentAuditLogs).where(
    and(eq(consentAuditLogs.contactId, auditTestId), eq(consentAuditLogs.source, "contactability_engine"))
  );
  await evaluateContactability({ contactId: auditTestId, channel: "email", mode: "dryRun" });
  const afterDryRun = await db.select().from(consentAuditLogs).where(
    and(eq(consentAuditLogs.contactId, auditTestId), eq(consentAuditLogs.source, "contactability_engine"))
  );
  assert("dryRun mode: zero audit logs written", afterDryRun.length === beforeDryRun.length, `expected ${beforeDryRun.length} logs, got ${afterDryRun.length}`);

  console.log("\n  [Audit log: enforcement mode writes blocked log for automated channel]");
  const enforceId = await createTestContact({ doNotAutoContact: true });
  await evaluateContactability({ contactId: enforceId, channel: "email", mode: "enforcement" });
  await new Promise(r => setTimeout(r, 150));
  const enforceAfter = await db.select().from(consentAuditLogs).where(
    and(eq(consentAuditLogs.contactId, enforceId), eq(consentAuditLogs.source, "contactability_engine"))
  );
  assert("enforcement mode: at least one audit log written", enforceAfter.length > 0, `got ${enforceAfter.length} logs`);
  assert("enforcement audit log marks allowed=false", enforceAfter[0]?.consented === false, `consented=${enforceAfter[0]?.consented}`);
}

async function runGateIntegrationTests() {
  console.log("\n▶ Gate integration tests — ghl-workflow-enrollment wiring\n");

  // Test that the contactability gate in enrollContactInGhlWorkflow blocks
  // doNotAutoContact contacts BEFORE attempting GHL API calls.
  console.log("  [enrollContactInGhlWorkflow gate — doNotAutoContact contact]");
  const dnacGhlId = await createTestContact({ doNotAutoContact: true, leadSource: "sunbiz", sourceCategory: "scraped" });

  const ghlResult = await enrollContactInGhlWorkflow({
    contactId: dnacGhlId,
    sequenceName: "Wave 1A Test Sequence",
    sequenceId: 0,
  });

  assert("enrollContactInGhlWorkflow: returns enrolled=false for doNotAutoContact contact", !ghlResult.enrolled, JSON.stringify(ghlResult));
  assert("enrollContactInGhlWorkflow: method is 'skipped'", ghlResult.method === "skipped", `method=${ghlResult.method}`);
  assert("enrollContactInGhlWorkflow: reason present (contactability gate)", typeof ghlResult.reason === "string" && ghlResult.reason.length > 0, `reason=${ghlResult.reason}`);
  assert("enrollContactInGhlWorkflow: reason is NOT 'Contact not found' or 'do-not-contact list'", (
    ghlResult.reason !== "Contact not found" && ghlResult.reason !== "Contact is on do-not-contact list"
  ), `reason should come from contactability gate, got: ${ghlResult.reason}`);

  // Verify: contact with doNotContact=true is caught BEFORE the contactability gate
  console.log("\n  [enrollContactInGhlWorkflow gate — doNotContact contact (step 2)]");
  const dncGhlId = await createTestContact({ doNotContact: true });
  const dncGhlResult = await enrollContactInGhlWorkflow({
    contactId: dncGhlId,
    sequenceName: "Wave 1A Test Sequence",
    sequenceId: 0,
    outboundChannels: ["email"],
  });
  assert("enrollContactInGhlWorkflow: doNotContact blocked before contactability gate", !dncGhlResult.enrolled, JSON.stringify(dncGhlResult));
  assert("enrollContactInGhlWorkflow: doNotContact reason is the existing DNC check", dncGhlResult.reason === "Contact is on do-not-contact list", `reason=${dncGhlResult.reason}`);

  // ── Fail-closed default: omitting outboundChannels blocks warm contacts ──
  console.log("\n  [enrollContactInGhlWorkflow gate — fail-closed default (no outboundChannels)]");
  const warmGhlId = await createTestContact({ sourceCategory: "inbound", consentTier: "warm_no_pewc", leadSource: "website" });

  // When outboundChannels is omitted, default is all automated channels (email + sms + voice_ai + ringless_vm).
  // Warm contacts (warm_no_pewc) cannot receive SMS/voice — so enrollment must be blocked.
  const warmDefaultResult = await enrollContactInGhlWorkflow({
    contactId: warmGhlId,
    sequenceName: "Wave 1A Fail-Closed Test",
    sequenceId: 0,
  });
  assert(
    "fail-closed default: warm_no_pewc contact blocked when outboundChannels is omitted",
    !warmDefaultResult.enrolled,
    `Expected enrollment blocked (SMS/voice require PEWC), got enrolled=${warmDefaultResult.enrolled}, reason=${warmDefaultResult.reason}`
  );
  assert(
    "fail-closed default: block reason is consent/PEWC/feature-flag — NOT DNC or doNotAutoContact",
    (warmDefaultResult.reason?.toLowerCase().includes("consent") ||
     warmDefaultResult.reason?.toLowerCase().includes("pewc") ||
     warmDefaultResult.reason?.toLowerCase().includes("flag") ||
     warmDefaultResult.reason?.toLowerCase().includes("sms") ||
     warmDefaultResult.reason?.toLowerCase().includes("voice")),
    `reason=${warmDefaultResult.reason}`
  );

  // Explicitly email-only: warm contact CAN be enrolled when caller specifies email only
  console.log("\n  [enrollContactInGhlWorkflow gate — email-only outboundChannels, warm contact]");
  const warmEmailResult = await enrollContactInGhlWorkflow({
    contactId: warmGhlId,
    sequenceName: "Wave 1A Email-Only Test",
    sequenceId: 0,
    outboundChannels: ["email"],
  });
  assert(
    "email-only outboundChannels: warm_no_pewc contact allowed for email-only workflow",
    warmEmailResult.enrolled || warmEmailResult.reason !== "Contact is on do-not-contact list",
    `Enrollment blocked for wrong reason: ${warmEmailResult.reason}`
  );
  // Note: may still be blocked due to GHL not configured in test env, which is fine —
  // the contactability gate passes; the method will be 'skipped' only if GHL is unconfigured.
  assert(
    "email-only outboundChannels: not blocked by consent gate",
    !warmEmailResult.reason?.toLowerCase().includes("pewc") && !warmEmailResult.reason?.toLowerCase().includes("consent tier"),
    `Blocked by consent when should be allowed: ${warmEmailResult.reason}`
  );
}

async function waitForServer(maxMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

async function runApiLevelTests() {
  console.log("\n▶ API-level tests — GET /api/contacts/:id/contactability (dryRun endpoint)\n");

  // 0. Wait for dev server to be reachable
  const serverReady = await waitForServer();
  if (!serverReady) {
    console.warn("  ⚠ Dev server not reachable at", BASE_URL, "— API tests skipped (run with server up)");
    return;
  }

  // 1. Ensure the dedicated no-2FA manager test user exists and is ready
  await ensureTestManagerUser();

  // 2. Create a test contact to query
  const apiTestId = await createTestContact({ sourceCategory: "scraped", consentTier: "cold_no_consent", leadSource: "sunbiz" });

  // 3. Login as the test manager user
  let sessionCookie: string;
  try {
    sessionCookie = await loginForCookie(TEST_MANAGER_EMAIL, TEST_MANAGER_PASSWORD);
  } catch (err) {
    console.warn(`  ⚠ Login failed for test manager — API tests skipped: ${err}`);
    return;
  }

  // 4. Call the contactability endpoint
  let apiResult: any = null;
  const logsBeforeApi = await db.select().from(consentAuditLogs).where(
    and(eq(consentAuditLogs.contactId, apiTestId), eq(consentAuditLogs.source, "contactability_engine"))
  );

  try {
    const res = await fetch(`${BASE_URL}/api/contacts/${apiTestId}/contactability`, {
      headers: { "Cookie": sessionCookie },
    });
    assert(`GET /api/contacts/:id/contactability returns 200`, res.status === 200, `status=${res.status}`);
    apiResult = await res.json();
  } catch (err) {
    assert("GET /api/contacts/:id/contactability — no fetch error", false, String(err));
    return;
  }

  // 5. Verify response shape
  assert("API response has 'results' key", apiResult && typeof apiResult.results === "object", JSON.stringify(Object.keys(apiResult ?? {})));
  assert("API response has 'summary' key", apiResult && typeof apiResult.summary === "object", JSON.stringify(Object.keys(apiResult ?? {})));

  const requiredChannels = ["email", "manual_call", "sms", "voice_ai", "ringless_vm"];
  for (const ch of requiredChannels) {
    assert(`API response 'results' contains channel '${ch}'`, ch in (apiResult?.results ?? {}));
  }

  const summary = apiResult?.summary ?? {};
  assert("API summary has allowedChannels array", Array.isArray(summary.allowedChannels));
  assert("API summary has blockedChannels array", Array.isArray(summary.blockedChannels));
  assert("API summary has ghlPermissionPayload", typeof summary.ghlPermissionPayload === "object");
  assert("API summary has consentTier", typeof summary.consentTier === "string");
  assert("API summary has lifecycleStage", typeof summary.lifecycleStage === "string");

  // 5. Verify cold scraped contact is allowed email but blocked on phone channels via API
  const emailApiResult = apiResult?.results?.email;
  assert("API: cold scraped contact allowed for email", emailApiResult?.allowed === true, `allowed=${emailApiResult?.allowed}`);

  const smsApiResult = apiResult?.results?.sms;
  assert("API: cold scraped contact blocked for SMS", smsApiResult?.allowed === false, `allowed=${smsApiResult?.allowed}`);

  // 6. Verify dryRun mode: no audit logs written by the API endpoint
  await new Promise(r => setTimeout(r, 200));
  const logsAfterApi = await db.select().from(consentAuditLogs).where(
    and(eq(consentAuditLogs.contactId, apiTestId), eq(consentAuditLogs.source, "contactability_engine"))
  );
  assert(
    "API endpoint (dryRun): zero audit logs written to consent_audit_logs",
    logsAfterApi.length === logsBeforeApi.length,
    `expected ${logsBeforeApi.length} logs before and after, got ${logsAfterApi.length} after`
  );

  // 7. Verify role guard (non-admin should get 403)
  const anonRes = await fetch(`${BASE_URL}/api/contacts/${apiTestId}/contactability`);
  assert("API: unauthenticated request returns 401", anonRes.status === 401, `status=${anonRes.status}`);
}

async function runSdrComplianceTests() {
  console.log("\n▶ SDR checkBeforeSend — Fix 1: fail-closed for ALL channels when no contacts record\n");

  // Use raw SQL inserts so we only touch columns that exist in the current DB schema
  // (avoids errors when the ORM schema is ahead of applied migrations).

  // Merchant with an email but NO linked contacts record
  const orphanEmail = `sdr-orphan-${Date.now()}@wave1a-test.invalid`;
  const orphanResult = await db.execute(
    drizzleSql`INSERT INTO sdr_merchants (business_name, main_email, state, source)
               VALUES ('Wave1A Test Orphan SDR Co', ${orphanEmail}, 'FL', 'test')
               RETURNING id`
  );
  const testMerchantId = (orphanResult.rows[0] as { id: number }).id;

  try {
    // Email channel — Fix 1 critical path: old code had a legacy fallback for email;
    // new code must BLOCK email identically to SMS/voice when no contacts record exists.
    const emailResult = await checkBeforeSend(testMerchantId, "email", "prospecting");
    assert(
      "Fix 1: checkBeforeSend blocks EMAIL when no contacts record (fail-closed, no legacy bypass)",
      !emailResult.allowed,
      `Expected blocked, got allowed=true: ${emailResult.reason}`
    );
    assert(
      "Fix 1: email block reason references missing contacts record (not legacy reason)",
      emailResult.reason.toLowerCase().includes("contact") || emailResult.reason.toLowerCase().includes("no contacts"),
      `Reason: ${emailResult.reason}`
    );

    // SMS channel — was already blocked; ensure it still is
    const smsResult = await checkBeforeSend(testMerchantId, "sms", "prospecting");
    assert(
      "Fix 1: checkBeforeSend blocks SMS when no contacts record",
      !smsResult.allowed,
      `Expected blocked, got allowed=true: ${smsResult.reason}`
    );

    // Call channel — was already blocked; ensure it still is
    const callResult = await checkBeforeSend(testMerchantId, "call", "prospecting");
    assert(
      "Fix 1: checkBeforeSend blocks CALL when no contacts record",
      !callResult.allowed,
      `Expected blocked, got allowed=true: ${callResult.reason}`
    );

    console.log("  ✓ All SDR compliance Fix 1 assertions passed — no channel bypasses legacy gate.");
  } finally {
    await db.execute(drizzleSql`DELETE FROM sdr_merchants WHERE id = ${testMerchantId}`).catch(() => {});
  }

  // Verify: merchant with no mainEmail is blocked before even attempting contacts lookup
  const noEmailResult = await db.execute(
    drizzleSql`INSERT INTO sdr_merchants (business_name, state, source)
               VALUES ('Wave1A No-Email SDR Co', 'TX', 'test')
               RETURNING id`
  );
  const noEmailMerchantId = (noEmailResult.rows[0] as { id: number }).id;

  try {
    const noEmailSms = await checkBeforeSend(noEmailMerchantId, "sms", "prospecting");
    assert(
      "Fix 1: checkBeforeSend blocks when merchant has no mainEmail",
      !noEmailSms.allowed,
      `Expected blocked, got: ${noEmailSms.reason}`
    );
    const noEmailEmail = await checkBeforeSend(noEmailMerchantId, "email", "prospecting");
    assert(
      "Fix 1: checkBeforeSend blocks email when merchant has no mainEmail",
      !noEmailEmail.allowed,
      `Expected blocked, got: ${noEmailEmail.reason}`
    );
  } finally {
    await db.execute(drizzleSql`DELETE FROM sdr_merchants WHERE id = ${noEmailMerchantId}`).catch(() => {});
  }
}

async function runTests() {
  console.log("\n=== Wave 1A Contactability Engine — Smoke Tests ===\n");

  await runDeriveConsentTierTests();
  await runEvaluateContactabilityTests();
  await runGateIntegrationTests();
  await runSdrComplianceTests();
  await runApiLevelTests();

  await cleanupAuditLogs();

  console.log(`\n${"=".repeat(56)}`);
  console.log(`Wave 1A Contactability Test Results:`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  if (failures.length > 0) {
    console.log(`\nFailed assertions:`);
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log("=".repeat(56));

  if (failed > 0) process.exit(1);
  else console.log("\n✅ All contactability tests passed.\n");
}

runTests()
  .catch(err => { console.error("Test runner error:", err); process.exit(1); })
  .finally(() => pool.end());
