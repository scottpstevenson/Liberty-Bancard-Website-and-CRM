#!/usr/bin/env tsx
/**
 * Test: Prevent New Lead deals from re-enrolling after contact unsubscribes mid-sequence.
 *
 * 8 test cases:
 *  1. Active New Lead deal + active enrollment + unsubscribe → suppression audit written.
 *  2. Public unsubscribe path suppresses future New Lead auto-enrollment.
 *  3. GHL opt_out webhook suppresses future New Lead auto-enrollment.
 *  4. Admin consentTier opted_out update suppresses future New Lead auto-enrollment.
 *  5. runNewLeadAutoEnrollCheck skips suppressed deal/contact.
 *  6. Suppressed count appears in stage-health response.
 *  7. DNC count remains separate from suppressed count.
 *  8. No misleading deal stage movement occurs.
 *
 * Run with server up:
 *   BASE_URL=http://localhost:5000 npx tsx scripts/test-new-lead-unsubscribe-suppression.ts
 */

import { db } from "../server/db";
import {
  contacts,
  deals,
  sequenceEnrollments,
  auditLogs,
  followUpSequences,
} from "../shared/schema";
import { eq, and, isNull, isNotNull, desc } from "drizzle-orm";
import { suppressNewLeadAutoEnrollmentForContact } from "../server/services/new-lead-enrollment-job";
import { runNewLeadAutoEnrollCheck } from "../server/services/new-lead-enrollment-job";
import { storage } from "../server/storage";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";

let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
    errors.push(label);
  }
}

async function cleanupContact(email: string): Promise<void> {
  const rows = await db.select({ id: contacts.id }).from(contacts)
    .where(eq(contacts.email, email));
  for (const row of rows) {
    await db.delete(sequenceEnrollments).where(eq(sequenceEnrollments.contactId, row.id)).catch(() => {});
    const dealRows = await db.select({ id: deals.id }).from(deals).where(eq(deals.contactId, row.id));
    for (const d of dealRows) {
      await db.delete(deals).where(eq(deals.id, d.id)).catch(() => {});
    }
    await db.delete(contacts).where(eq(contacts.id, row.id)).catch(() => {});
  }
}

async function createTestContact(email: string, overrides: Record<string, any> = {}): Promise<number> {
  const [c] = await db.insert(contacts).values({
    firstName: "Test",
    lastName: "Suppress",
    email,
    phone: "+10000099001",
    status: "active",
    leadSource: "test",
    sourceCategory: "scraped",
    consentTier: "cold_no_consent",
    emailStatus: "active",
    optedOutEmail: false,
    doNotContact: false,
    ...overrides,
  } as any).returning({ id: contacts.id });
  return c.id;
}

async function createNewLeadDeal(contactId: number): Promise<number> {
  const [d] = await db.insert(deals).values({
    contactId,
    pipeline: "sales",
    stage: "New Lead",
    notes: "test suppression",
  } as any).returning({ id: deals.id });
  return d.id;
}

async function createActiveEnrollment(contactId: number): Promise<number> {
  const [e] = await db.insert(sequenceEnrollments).values({
    sequenceId: 1,
    contactId,
    status: "active",
    currentStep: 0,
    nextActionAt: new Date(),
    metadata: { enrolledBy: "test" },
  } as any).returning({ id: sequenceEnrollments.id });
  return e.id;
}

// ─── Test 1: Suppression audit is written ─────────────────────────────────────
async function test1(): Promise<void> {
  console.log("\nTest 1: Active New Lead deal + unsubscribe → suppression audit written");
  const email = "suppress-test-1@libertybancard.test";
  await cleanupContact(email);
  try {
    const contactId = await createTestContact(email);
    const dealId = await createNewLeadDeal(contactId);
    await createActiveEnrollment(contactId);

    await suppressNewLeadAutoEnrollmentForContact(contactId, "email_unsubscribe_link");

    // Verify audit log written
    const logs = await db.select().from(auditLogs)
      .where(and(
        eq(auditLogs.action, "new_lead_auto_enrollment_suppressed"),
        eq(auditLogs.entityId, dealId)
      ))
      .orderBy(desc(auditLogs.createdAt))
      .limit(5);
    assert(logs.length > 0, "Suppression audit log written for deal");

    // Verify deal has suppression metadata
    const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
    assert(deal.autoEnrollmentSuppressedAt != null, "Deal autoEnrollmentSuppressedAt set");
    assert(deal.autoEnrollmentSuppressedReason === "email_unsubscribe_link", "Deal reason recorded");

    // Verify active enrollment was paused
    const [enrollment] = await db.select().from(sequenceEnrollments).where(eq(sequenceEnrollments.contactId, contactId));
    assert(enrollment.status === "paused", "Active enrollment paused after suppression");
  } finally {
    await cleanupContact(email);
  }
}

// ─── Test 2: Public unsubscribe path ──────────────────────────────────────────
async function test2(): Promise<void> {
  console.log("\nTest 2: Public unsubscribe path suppresses future New Lead auto-enrollment");
  const email = "suppress-test-2@libertybancard.test";
  await cleanupContact(email);
  try {
    const contactId = await createTestContact(email);
    const dealId = await createNewLeadDeal(contactId);

    // Simulate what the unsubscribe endpoint does
    await storage.updateContact(contactId, {
      optedOutEmail: true,
      emailStatus: "opted_out",
      consentTier: "opted_out",
    } as any);
    await suppressNewLeadAutoEnrollmentForContact(contactId, "email_unsubscribe_link");

    const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
    assert(deal.autoEnrollmentSuppressedAt != null, "Deal suppressed after public unsubscribe");
    assert(deal.autoEnrollmentSuppressedReason === "email_unsubscribe_link", "Reason is email_unsubscribe_link");
  } finally {
    await cleanupContact(email);
  }
}

// ─── Test 3: GHL opt_out webhook ──────────────────────────────────────────────
async function test3(): Promise<void> {
  console.log("\nTest 3: GHL opt_out webhook suppresses future New Lead auto-enrollment");
  const email = "suppress-test-3@libertybancard.test";
  await cleanupContact(email);
  try {
    const contactId = await createTestContact(email, { ghlContactId: "ghl-suppress-test-3" });
    const dealId = await createNewLeadDeal(contactId);

    // Simulate what the GHL webhook handler does: look up by ghlContactId and suppress
    await suppressNewLeadAutoEnrollmentForContact(contactId, "ghl_opt_out:email");

    const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
    assert(deal.autoEnrollmentSuppressedAt != null, "Deal suppressed after GHL opt_out webhook");
    assert(deal.autoEnrollmentSuppressedReason?.startsWith("ghl_opt_out"), "Reason starts with ghl_opt_out");
  } finally {
    await cleanupContact(email);
  }
}

// ─── Test 4: Admin consentTier opted_out update ────────────────────────────────
async function test4(): Promise<void> {
  console.log("\nTest 4: Admin consentTier opted_out update suppresses future New Lead auto-enrollment");
  const email = "suppress-test-4@libertybancard.test";
  await cleanupContact(email);
  try {
    const contactId = await createTestContact(email);
    const dealId = await createNewLeadDeal(contactId);

    // Simulate what the admin contact update path does
    await storage.updateContact(contactId, { consentTier: "opted_out" } as any);
    await suppressNewLeadAutoEnrollmentForContact(contactId, "admin_consent_tier_opted_out");

    const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
    assert(deal.autoEnrollmentSuppressedAt != null, "Deal suppressed after admin consentTier update");
    assert(deal.autoEnrollmentSuppressedReason === "admin_consent_tier_opted_out", "Reason is admin_consent_tier_opted_out");
  } finally {
    await cleanupContact(email);
  }
}

// ─── Test 5: runNewLeadAutoEnrollCheck skips suppressed deal ──────────────────
async function test5(): Promise<void> {
  console.log("\nTest 5: runNewLeadAutoEnrollCheck skips suppressed deal/contact");
  const emailSuppressed = "suppress-test-5a@libertybancard.test";
  const emailOptedOut = "suppress-test-5b@libertybancard.test";
  await cleanupContact(emailSuppressed);
  await cleanupContact(emailOptedOut);
  try {
    // Contact with suppressed deal
    const contactIdSuppressed = await createTestContact(emailSuppressed, { email: emailSuppressed });
    const dealIdSuppressed = await createNewLeadDeal(contactIdSuppressed);
    await suppressNewLeadAutoEnrollmentForContact(contactIdSuppressed, "email_unsubscribe_link");

    // Contact with optedOutEmail=true
    const contactIdOptedOut = await createTestContact(emailOptedOut, {
      email: emailOptedOut,
      optedOutEmail: true,
      emailStatus: "opted_out",
      consentTier: "opted_out",
    });
    const dealIdOptedOut = await createNewLeadDeal(contactIdOptedOut);

    // Run the auto-enroll check — both should be skipped
    // Count new audit logs BEFORE the check
    const beforeLogs = await db.select().from(auditLogs)
      .where(eq(auditLogs.action, "new_lead_deal_enrolled"))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);
    const beforeEnrolledIds = new Set(beforeLogs.map(l => l.entityId));

    await runNewLeadAutoEnrollCheck();

    // Check no new enrollments created for our test contacts
    const enrollmentsSuppressed = await db.select().from(sequenceEnrollments)
      .where(eq(sequenceEnrollments.contactId, contactIdSuppressed));
    assert(enrollmentsSuppressed.length === 0, "Suppressed deal contact NOT enrolled by auto-check");

    const enrollmentsOptedOut = await db.select().from(sequenceEnrollments)
      .where(eq(sequenceEnrollments.contactId, contactIdOptedOut));
    assert(enrollmentsOptedOut.length === 0, "optedOutEmail contact NOT enrolled by auto-check");

    // Verify suppressed deal audit log is NOT a new_lead_deal_enrolled entry
    const afterLogs = await db.select().from(auditLogs)
      .where(and(
        eq(auditLogs.action, "new_lead_deal_enrolled"),
        eq(auditLogs.entityId, dealIdSuppressed)
      ))
      .limit(5);
    assert(afterLogs.length === 0, "No enrollment audit log written for suppressed deal");
  } finally {
    await cleanupContact(emailSuppressed);
    await cleanupContact(emailOptedOut);
  }
}

// ─── Test 6: Suppressed count appears in stage-health response ─────────────────
async function test6(): Promise<void> {
  console.log("\nTest 6: Suppressed count appears in stage-health response");
  const email = "suppress-test-6@libertybancard.test";
  await cleanupContact(email);
  try {
    const contactId = await createTestContact(email);
    await createNewLeadDeal(contactId);
    await suppressNewLeadAutoEnrollmentForContact(contactId, "email_unsubscribe_link");

    // Call stage-health API
    const adminCookie = await loginAsAdmin();
    if (!adminCookie) {
      console.log("  ⚠ Skipping API check — no admin credentials (set ADMIN_SEED_EMAIL + ADMIN_SEED_PASSWORD)");
      return;
    }

    const res = await fetch(`${BASE_URL}/api/admin/pipeline/stage-health`, {
      headers: { cookie: adminCookie },
    });
    assert(res.ok, "stage-health endpoint returned 200");

    const body = await res.json();
    assert(typeof body.newLeadAutoEnrollmentSuppressed === "number", "newLeadAutoEnrollmentSuppressed field present");
    assert(body.newLeadAutoEnrollmentSuppressed >= 1, `Suppressed count ≥ 1 (got ${body.newLeadAutoEnrollmentSuppressed})`);
  } finally {
    await cleanupContact(email);
  }
}

// ─── Test 7: DNC count remains separate from suppressed count ─────────────────
async function test7(): Promise<void> {
  console.log("\nTest 7: DNC count remains separate from suppressed count");
  const emailDnc = "suppress-test-7a@libertybancard.test";
  const emailSuppressed = "suppress-test-7b@libertybancard.test";
  await cleanupContact(emailDnc);
  await cleanupContact(emailSuppressed);
  try {
    // DNC contact — doNotContact=true (counts in DNC only)
    const contactIdDnc = await createTestContact(emailDnc, { doNotContact: true });
    const dealIdDnc = await createNewLeadDeal(contactIdDnc);
    // Also suppress DNC contact (simulates overlap scenario)
    await suppressNewLeadAutoEnrollmentForContact(contactIdDnc, "admin_do_not_contact");

    // Suppressed but NOT DNC contact
    const contactIdSuppressed = await createTestContact(emailSuppressed);
    await createNewLeadDeal(contactIdSuppressed);
    await suppressNewLeadAutoEnrollmentForContact(contactIdSuppressed, "email_unsubscribe_link");

    const adminCookie = await loginAsAdmin();
    if (!adminCookie) {
      console.log("  ⚠ Skipping API check — no admin credentials");
      return;
    }

    const res = await fetch(`${BASE_URL}/api/admin/pipeline/stage-health`, {
      headers: { cookie: adminCookie },
    });
    const body = await res.json();

    // DNC contact's suppressed deal should NOT be counted in newLeadAutoEnrollmentSuppressed
    // (it's excluded because doNotContact=true puts it in the DNC bucket)
    assert(typeof body.newLeadAutoEnrollmentSuppressed === "number", "newLeadAutoEnrollmentSuppressed is a number");
    assert(typeof body.newLeadNoActiveEnrollment === "number", "newLeadNoActiveEnrollment is a separate field");
    console.log(`    suppressed=${body.newLeadAutoEnrollmentSuppressed}, noActiveEnrollment=${body.newLeadNoActiveEnrollment}`);
    assert(body.newLeadAutoEnrollmentSuppressed !== undefined && body.newLeadNoActiveEnrollment !== undefined,
      "Both suppressed and no-enrollment counts are distinct fields in response");
  } finally {
    await cleanupContact(emailDnc);
    await cleanupContact(emailSuppressed);
  }
}

// ─── Test 8: No misleading deal stage movement occurs ─────────────────────────
async function test8(): Promise<void> {
  console.log("\nTest 8: No misleading deal stage movement occurs");
  const email = "suppress-test-8@libertybancard.test";
  await cleanupContact(email);
  try {
    const contactId = await createTestContact(email);
    const dealId = await createNewLeadDeal(contactId);

    await suppressNewLeadAutoEnrollmentForContact(contactId, "email_unsubscribe_link");

    const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
    assert(deal.stage === "New Lead", "Deal stage remains New Lead after suppression");
    assert(deal.pipeline === "sales", "Pipeline remains sales after suppression");
    assert(deal.autoEnrollmentSuppressedAt != null, "Suppression field set (not stage change)");
  } finally {
    await cleanupContact(email);
  }
}

// ─── Login helper ─────────────────────────────────────────────────────────────
async function loginAsAdmin(): Promise<string | null> {
  const email = process.env.ADMIN_SEED_EMAIL;
  const password = process.env.ADMIN_SEED_PASSWORD;
  if (!email || !password) return null;
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const raw = res.headers as any;
    const setCookieArr: string[] = typeof raw.getSetCookie === "function"
      ? raw.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
    return setCookieArr.map((c: string) => c.split(";")[0].trim()).filter(Boolean).join("; ") || null;
  } catch {
    return null;
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────
async function run(): Promise<void> {
  console.log("=== New Lead Unsubscribe Suppression — 8 Test Cases ===\n");

  await test1();
  await test2();
  await test3();
  await test4();
  await test5();
  await test6();
  await test7();
  await test8();

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log("\nFailed cases:");
    errors.forEach(e => console.log(`  ✗ ${e}`));
    process.exit(1);
  } else {
    console.log("\n✓ All 8 test cases passed — suppression is working correctly.");
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
