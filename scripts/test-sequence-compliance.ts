#!/usr/bin/env tsx
/**
 * Wave 12 — Sequence Compliance Tests
 *
 * Uses evaluateContactability(dryRun) and sequence-eligibility.ts directly.
 * No real messages are sent (all in dryRun mode).
 * All test contacts use prefix: qa-release-test-sequence@libertybancard.test
 *
 * 8 test cases (per Wave 12 spec):
 *   1. Cold scraped lead enrolled in PEWC-required sequence → blocked
 *   2. smsStatus: "opted_out" → SMS sequence step blocked
 *   3. doNotContact: true → all channels blocked
 *   4. doNotAutoContact: true → auto-enrollment blocked, manual task allowed
 *   5. DNC contact (dncReason set) → blocked
 *   6. Florida (state: "FL") without PEWC → SMS step blocked
 *   7. Opt-out simulation mid-sequence: PEWC → eligible → update to opted_out → blocked
 *   8. Valid PEWC + all channel flags enabled (env override) → eligible in dryRun
 *
 * Exit codes: 0 = all pass, 1 = any fail
 *
 * Run:
 *   npx tsx scripts/test-sequence-compliance.ts
 */

import { db } from "../server/db";
import { contacts, consentAuditLogs } from "../shared/schema";
import { pool } from "../server/db";
import { eq, and, inArray } from "drizzle-orm";
import { evaluateContactability } from "../server/services/contactability";
import { canEnrollContactInSequence } from "../server/services/sequence-eligibility";

let passed = 0;
let failed = 0;
const failures: string[] = [];
const testContactIds: number[] = [];
const testConsentLogIds: number[] = [];

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

type ContactOverrides = Partial<{
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName: string;
  doNotContact: boolean;
  doNotAutoContact: boolean;
  dncReason: string;
  emailStatus: string;
  smsStatus: string;
  consentTier: string;
  lifecycleStage: string;
  state: string;
  phoneType: string;
  sourceCategory: string;
}>;

async function makeContact(overrides: ContactOverrides = {}): Promise<number> {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [row] = await db
    .insert(contacts)
    .values({
      firstName: "SeqTest",
      lastName: "QALead",
      email: `qa-release-test-sequence-${tag}@libertybancard.test`,
      phone: "3055559900",
      companyName: `QA_RELEASE_TEST SeqTest Co ${tag}`,
      emailStatus: "active",
      smsStatus: "active",
      doNotContact: false,
      doNotAutoContact: false,
      consentTier: "cold_no_consent",
      lifecycleStage: "prospect",
      sourceCategory: "outbound",
      ...overrides,
    } as any)
    .returning({ id: contacts.id });
  testContactIds.push(row.id);
  return row.id;
}

async function insertPewcEvidence(contactId: number): Promise<void> {
  const [row] = await db
    .insert(consentAuditLogs)
    .values({
      contactId,
      channel: "sms",
      action: "consent_recorded",
      consentType: "express_written",
      consented: true,
      source: "wave12_test",
      consentedPhone: "+15555550101",
      disclosureVersion: "v1.0",
      disclosureText: "By checking this box you consent to automated marketing calls and texts.",
      ipAddress: "127.0.0.1",
      userAgent: "qa-test/1.0",
    } as any)
    .returning({ id: consentAuditLogs.id });
  testConsentLogIds.push(row.id);
}

async function cleanup(): Promise<void> {
  // Clean consent_audit_logs first (FK → contacts)
  if (testConsentLogIds.length > 0) {
    for (const id of testConsentLogIds) {
      await db.delete(consentAuditLogs).where(eq(consentAuditLogs.id, id)).catch(() => {});
    }
  }
  // Also clean any consent logs tied to test contacts by source
  if (testContactIds.length > 0) {
    for (const id of testContactIds) {
      await db.delete(consentAuditLogs).where(
        and(eq(consentAuditLogs.contactId, id), eq(consentAuditLogs.source, "wave12_test"))
      ).catch(() => {});
    }
    for (const id of testContactIds) {
      await db.delete(contacts).where(eq(contacts.id, id)).catch(() => {});
    }
  }
}

// Minimal sequence object helper
function seqSpec(overrides: Record<string, unknown> = {}) {
  return {
    id: 0,
    name: "Wave12 Test Sequence",
    status: "active" as const,
    sequenceFamily: null,
    eligibleConsentTiers: null,
    lifecycleStagesAllowed: null,
    ...overrides,
  };
}

// ── Case 1: Cold scraped lead enrolled in PEWC-required sequence → blocked ──
async function testCase1(): Promise<void> {
  console.log("Case 1: Cold scraped lead in PEWC-required sequence → blocked");
  const id = await makeContact({ consentTier: "cold_no_consent", sourceCategory: "outbound" });
  const result = await canEnrollContactInSequence(id, seqSpec({
    eligibleConsentTiers: ["pewc_full_automation"],
  }));
  assert("Cold lead blocked by PEWC-required sequence", !result.allowed, result.reason);
  assert("Block reason references consent tier", (
    result.reason?.toLowerCase().includes("tier") ||
    result.reason?.toLowerCase().includes("consent") ||
    result.reason?.toLowerCase().includes("pewc")
  ) ?? false, result.reason);
}

// ── Case 2: smsStatus: "opted_out" → SMS sequence step blocked ───────────────
async function testCase2(): Promise<void> {
  console.log("\nCase 2: smsStatus opted_out → SMS step blocked by evaluateContactability");
  const id = await makeContact({ smsStatus: "opted_out", consentTier: "warm_no_pewc" });
  const result = await evaluateContactability({ contactId: id, channel: "sms", mode: "dryRun" });
  assert("Opted-out SMS blocked", !result.allowed, result.reason);
  assert("Block reason references SMS opt-out", (
    result.reason.toLowerCase().includes("stop") ||
    result.reason.toLowerCase().includes("opt") ||
    result.reason.toLowerCase().includes("sms")
  ), result.reason);
}

// ── Case 3: doNotContact: true → all channels blocked ────────────────────────
async function testCase3(): Promise<void> {
  console.log("\nCase 3: doNotContact true → all 5 channels blocked");
  const id = await makeContact({ doNotContact: true });
  for (const ch of ["email", "manual_call", "sms", "voice_ai", "ringless_vm"] as const) {
    const r = await evaluateContactability({ contactId: id, channel: ch, mode: "dryRun" });
    assert(`doNotContact blocks ${ch}`, !r.allowed, r.reason);
  }
}

// ── Case 4: doNotAutoContact: true → auto blocked, manual_call allowed ────────
async function testCase4(): Promise<void> {
  console.log("\nCase 4: doNotAutoContact → automated blocked, manual_call allowed");
  const id = await makeContact({ doNotAutoContact: true, consentTier: "warm_no_pewc" });

  // Automated channels blocked
  for (const ch of ["email", "sms", "voice_ai", "ringless_vm"] as const) {
    const r = await evaluateContactability({ contactId: id, channel: ch, mode: "dryRun" });
    assert(`doNotAutoContact blocks automated channel: ${ch}`, !r.allowed, r.reason);
    assert(`doNotAutoContact block reason mentions manual call task`, (
      r.reason.toLowerCase().includes("manual") || r.reason.toLowerCase().includes("auto")
    ), r.reason);
  }

  // manual_call is NOT blocked by doNotAutoContact — force a business-hours time so the
  // TCPA quiet-hours check doesn't flap based on when this test runs (e.g. nights/weekends).
  // Tuesday 2025-06-24 10:00 AM ET (14:00 UTC, EDT = UTC-4).
  const businessHoursTime = new Date("2025-06-24T14:00:00.000Z");
  const manualR = await evaluateContactability({ contactId: id, channel: "manual_call", mode: "dryRun", currentTime: businessHoursTime });
  assert("doNotAutoContact: manual_call is allowed (forced business-hours time)", manualR.allowed, manualR.reason);
  assert("allowed channels includes manual_call", (manualR.allowedChannels ?? []).includes("manual_call"), JSON.stringify(manualR.allowedChannels));
}

// ── Case 5: DNC contact (dncReason set) → blocked ─────────────────────────
async function testCase5(): Promise<void> {
  console.log("\nCase 5: DNC contact with dncReason → blocked");
  const id = await makeContact({
    doNotContact: true,
    dncReason: "manually_opted_out",
    consentTier: "do_not_contact",
  });
  const emailR = await evaluateContactability({ contactId: id, channel: "email", mode: "dryRun" });
  assert("DNC contact (dncReason set) email blocked", !emailR.allowed, emailR.reason);

  const smsR = await evaluateContactability({ contactId: id, channel: "sms", mode: "dryRun" });
  assert("DNC contact (dncReason set) SMS blocked", !smsR.allowed, smsR.reason);

  const enrollResult = await canEnrollContactInSequence(id, seqSpec());
  assert("DNC contact blocked from sequence enrollment", !enrollResult.allowed, enrollResult.reason);
}

// ── Case 6: Florida without PEWC → SMS step blocked ──────────────────────────
async function testCase6(): Promise<void> {
  console.log("\nCase 6: Florida contact without PEWC → SMS blocked (PEWC required before FL TCPA step)");
  const savedSmsEnabled = process.env.SMS_ENABLED;
  process.env.SMS_ENABLED = "true"; // Bypass SMS_ENABLED flag to reach PEWC check
  try {
    const id = await makeContact({
      state: "FL",
      consentTier: "warm_no_pewc",
      smsStatus: "active",
      phoneType: "mobile",
    });
    const result = await evaluateContactability({ contactId: id, channel: "sms", mode: "dryRun" });
    assert("Florida warm contact: SMS blocked (missing PEWC evidence)", !result.allowed, result.reason);
    assert("Block reason references consent tier or PEWC", (
      result.reason.toLowerCase().includes("pewc") ||
      result.reason.toLowerCase().includes("consent") ||
      result.reason.toLowerCase().includes("tier")
    ), result.reason);
  } finally {
    if (savedSmsEnabled === undefined) delete process.env.SMS_ENABLED;
    else process.env.SMS_ENABLED = savedSmsEnabled;
  }
}

// ── Case 7: Opt-out simulation mid-sequence ────────────────────────────────
async function testCase7(): Promise<void> {
  console.log("\nCase 7: Mid-sequence opt-out — PEWC contact → eligible → opt out → blocked");
  const id = await makeContact({
    consentTier: "pewc_full_automation",
    emailStatus: "active",
    smsStatus: "active",
  });
  await insertPewcEvidence(id);

  // Before opt-out: email should be allowed
  const beforeResult = await evaluateContactability({ contactId: id, channel: "email", mode: "dryRun" });
  assert("PEWC contact email allowed before opt-out", beforeResult.allowed, beforeResult.reason);

  // Simulate opt-out (update emailStatus to opted_out)
  await db.update(contacts)
    .set({ emailStatus: "opted_out", consentTier: "opted_out" })
    .where(eq(contacts.id, id));

  // After opt-out: email must be blocked
  const afterResult = await evaluateContactability({ contactId: id, channel: "email", mode: "dryRun" });
  assert("After email opt-out: email blocked", !afterResult.allowed, afterResult.reason);
  assert("After opt-out: reason references unsubscribed/opted_out", (
    afterResult.reason.toLowerCase().includes("unsubscrib") ||
    afterResult.reason.toLowerCase().includes("opt") ||
    afterResult.reason.toLowerCase().includes("opted")
  ), afterResult.reason);
}

// ── Case 8: Valid PEWC + all channel flags enabled → eligible in dryRun ───────
async function testCase8(): Promise<void> {
  console.log("\nCase 8: Valid PEWC + SMS_ENABLED=true + VOICE_AI_ENABLED=true → SMS/email allowed in dryRun");

  // Save original env
  const savedSms = process.env.SMS_ENABLED;
  const savedVoice = process.env.VOICE_AI_ENABLED;
  const savedRvm = process.env.RINGLESS_VM_ENABLED;

  process.env.SMS_ENABLED = "true";
  process.env.VOICE_AI_ENABLED = "true";
  process.env.RINGLESS_VM_ENABLED = "true";

  try {
    const id = await makeContact({
      consentTier: "pewc_full_automation",
      emailStatus: "active",
      smsStatus: "active",
      phoneType: "mobile",
      state: "TX", // Non-FL to avoid FL TCPA annotation path
    });
    await insertPewcEvidence(id);

    const emailR = await evaluateContactability({ contactId: id, channel: "email", mode: "dryRun" });
    assert("PEWC contact: email allowed (flags on)", emailR.allowed, emailR.reason);
    assert("email ghlPermissionPayload.lb_email_allowed=true", emailR.ghlPermissionPayload?.lb_email_allowed === true, JSON.stringify(emailR.ghlPermissionPayload));

    const smsR = await evaluateContactability({ contactId: id, channel: "sms", mode: "dryRun" });
    // SMS may be blocked by TCPA quiet hours even when PEWC+SMS_ENABLED=true — that is correct
    // real-time enforcement. Assert lb_sms_allowed=true OR the only block is quiet hours.
    const smsQuietHoursOnly = !smsR.ghlPermissionPayload?.lb_sms_allowed &&
      (smsR.reason.toLowerCase().includes("quiet hours") ||
       smsR.reason.toLowerCase().includes("business hours") ||
       smsR.reason.toLowerCase().includes("tcpa"));
    assert("PEWC contact: lb_sms_allowed=true when SMS_ENABLED=true (or only TCPA quiet hours blocks)",
      smsR.ghlPermissionPayload?.lb_sms_allowed === true || smsQuietHoursOnly,
      JSON.stringify(smsR.ghlPermissionPayload));
    if (!smsR.allowed) {
      // Only acceptable block reason at this point is quiet hours
      assert("If SMS not allowed, only acceptable reason is quiet hours", (
        smsR.reason.toLowerCase().includes("quiet hours") ||
        smsR.reason.toLowerCase().includes("business hours") ||
        smsR.reason.toLowerCase().includes("tcpa")
      ), `SMS reason: ${smsR.reason}`);
    } else {
      assert("PEWC contact: SMS allowed when all flags on + business hours", true);
    }

    // canEnrollContactInSequence should allow
    const enrollResult = await canEnrollContactInSequence(id, seqSpec({
      eligibleConsentTiers: ["pewc_full_automation", "warm_no_pewc"],
    }));
    assert("PEWC contact: sequence enrollment allowed", enrollResult.allowed, enrollResult.reason);

  } finally {
    // Restore env
    if (savedSms === undefined) delete process.env.SMS_ENABLED;
    else process.env.SMS_ENABLED = savedSms;
    if (savedVoice === undefined) delete process.env.VOICE_AI_ENABLED;
    else process.env.VOICE_AI_ENABLED = savedVoice;
    if (savedRvm === undefined) delete process.env.RINGLESS_VM_ENABLED;
    else process.env.RINGLESS_VM_ENABLED = savedRvm;
  }
}

async function runTests(): Promise<void> {
  console.log("=== Wave 12 Sequence Compliance Tests ===\n");
  console.log("Mode: dryRun — no real messages sent, no audit logs written\n");

  try {
    await testCase1();
    await testCase2();
    await testCase3();
    await testCase4();
    await testCase5();
    await testCase6();
    await testCase7();
    await testCase8();
  } finally {
    console.log("\n── Cleanup ─────────────────────────────────────────────────");
    await cleanup();
    console.log(`  Deleted ${testContactIds.length} test contact(s) and ${testConsentLogIds.length} consent log(s).`);
  }

  console.log(`\n${"=".repeat(56)}`);
  console.log("Sequence Compliance Results:");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFailed assertions:");
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log("=".repeat(56));

  if (failed > 0) {
    console.error("\n✗ Sequence compliance tests FAILED.\n");
    process.exit(1);
  } else {
    console.log(`\n✅ All ${passed} sequence compliance assertions passed.\n`);
  }
}

runTests()
  .catch(err => { console.error("Test runner error:", err); process.exit(1); })
  .finally(() => pool.end());
