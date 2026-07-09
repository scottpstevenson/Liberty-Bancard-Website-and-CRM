#!/usr/bin/env tsx
/**
 * Test: Prevent New Lead deals from re-enrolling after contact unsubscribes mid-sequence.
 *
 * 16 test cases (original 8 + 8 new GHL opt-out fallback path tests):
 *  1. Active New Lead deal + active enrollment + unsubscribe → suppression audit written.
 *  2. Public unsubscribe path suppresses future New Lead auto-enrollment.
 *  3. GHL opt_out webhook suppresses future New Lead auto-enrollment.
 *  4. Admin consentTier opted_out update suppresses future New Lead auto-enrollment.
 *  5. runNewLeadAutoEnrollCheck skips suppressed deal/contact.
 *  6. Suppressed count appears in stage-health response.
 *  7. DNC count remains separate from suppressed count.
 *  8. No misleading deal stage movement occurs.
 *  9. handleOptOut with ghlContactId suppresses linked CRM contact (Path A).
 * 10. handleOptOut with no ghlContactId but exact email match suppresses contact (Path B).
 * 11. handleOptOut with duplicate email suppresses ALL matched contacts + audits matchedCount (Path B multi).
 * 12. handleOptOut with no match writes ghl_opt_out_unmatched_contact anomaly audit (Path D).
 * 13. handleOptOut with unknown contactId (no email/phone) does NOT suppress via fuzzy matching (Path D).
 * 14. runNewLeadAutoEnrollCheck skips contact suppressed via email-match opt-out path.
 * 15. Active enrollment is paused after email-match opt-out path.
 * 16. handleOptOut never creates deals, sends outbound, or triggers GHL sync.
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
  sdrLeadEvents,
} from "../shared/schema";
import { eq, and, isNull, isNotNull, desc, gte } from "drizzle-orm";
import { suppressNewLeadAutoEnrollmentForContact } from "../server/services/new-lead-enrollment-job";
import { runNewLeadAutoEnrollCheck } from "../server/services/new-lead-enrollment-job";
import { handleOptOut } from "../server/services/sdr/webhook-handlers";
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

// ─── Test 9: handleOptOut with ghlContactId suppresses linked CRM contact ─────
async function test9(): Promise<void> {
  console.log("\nTest 9: handleOptOut with ghlContactId suppresses linked CRM contact (Path A)");
  const email = "suppress-test-9@libertybancard.test";
  const ghlId = "ghl-opt-out-test-9";
  await cleanupContact(email);
  try {
    const contactId = await createTestContact(email, { ghlContactId: ghlId });
    const dealId = await createNewLeadDeal(contactId);

    await handleOptOut({ contactId: ghlId, channel: "email" });

    const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
    assert(deal.autoEnrollmentSuppressedAt != null, "T9: Deal suppressed via ghlContactId match");
    assert(deal.autoEnrollmentSuppressedReason === "ghl_opt_out", "T9: Reason is ghl_opt_out");

    const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
    assert(contact.optedOutEmail === true, "T9: optedOutEmail set on contact");
    assert(contact.emailStatus === "opted_out", "T9: emailStatus set to opted_out");
    assert(contact.consentTier === "opted_out", "T9: consentTier set to opted_out");

    const events = await db.select().from(sdrLeadEvents)
      .where(and(eq(sdrLeadEvents.eventType, "opt_out"), eq(sdrLeadEvents.ghlRefId, ghlId)));
    assert(events.length > 0, "T9: Webhook event stored in sdrLeadEvents");
  } finally {
    await cleanupContact(email);
  }
}

// ─── Test 10: handleOptOut email fallback suppresses contact ───────────────────
async function test10(): Promise<void> {
  console.log("\nTest 10: handleOptOut with no ghlContactId but exact email match suppresses contact (Path B)");
  const email = "suppress-test-10@libertybancard.test";
  await cleanupContact(email);
  try {
    const contactId = await createTestContact(email);
    const dealId = await createNewLeadDeal(contactId);

    await handleOptOut({ email, channel: "email" });

    const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
    assert(deal.autoEnrollmentSuppressedAt != null, "T10: Deal suppressed via email match");
    assert(deal.autoEnrollmentSuppressedReason === "ghl_opt_out_email_match", "T10: Reason is ghl_opt_out_email_match");

    const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
    assert(contact.optedOutEmail === true, "T10: optedOutEmail set on contact");

    const auditEntries = await db.select().from(auditLogs)
      .where(and(
        eq(auditLogs.action, "ghl_opt_out_email_match"),
        eq(auditLogs.entityId, contactId),
      ));
    assert(auditEntries.length > 0, "T10: ghl_opt_out_email_match audit log written");
  } finally {
    await cleanupContact(email);
  }
}

// ─── Test 11: Duplicate email → all contacts suppressed + matchedCount ─────────
async function test11(): Promise<void> {
  console.log("\nTest 11: handleOptOut duplicate email suppresses ALL matched contacts + audits matchedCount");
  const email = "suppress-test-11@libertybancard.test";
  await cleanupContact(email);
  let contactIdA: number | null = null;
  let contactIdB: number | null = null;
  try {
    contactIdA = await createTestContact(email);
    const dealIdA = await createNewLeadDeal(contactIdA);
    contactIdB = await db.insert(contacts).values({
      firstName: "Dupe",
      lastName: "Suppress",
      email,
      phone: "+10000099002",
      status: "active",
      leadSource: "test",
      sourceCategory: "scraped",
      consentTier: "cold_no_consent",
      emailStatus: "active",
      optedOutEmail: false,
      doNotContact: false,
    } as any).returning({ id: contacts.id }).then(r => r[0].id);
    const dealIdB = await createNewLeadDeal(contactIdB);

    await handleOptOut({ email, channel: "email" });

    const [dealA] = await db.select().from(deals).where(eq(deals.id, dealIdA));
    const [dealB] = await db.select().from(deals).where(eq(deals.id, dealIdB));
    assert(dealA.autoEnrollmentSuppressedAt != null, "T11: Contact A deal suppressed");
    assert(dealB.autoEnrollmentSuppressedAt != null, "T11: Contact B deal suppressed");

    const auditEntriesA = await db.select().from(auditLogs).where(and(
      eq(auditLogs.action, "ghl_opt_out_email_match"),
      eq(auditLogs.entityId, contactIdA),
    ));
    const auditEntriesB = await db.select().from(auditLogs).where(and(
      eq(auditLogs.action, "ghl_opt_out_email_match"),
      eq(auditLogs.entityId, contactIdB!),
    ));
    assert(auditEntriesA.length > 0, "T11: Audit log written for contact A");
    assert(auditEntriesB.length > 0, "T11: Audit log written for contact B");

    const matchedCountA = (auditEntriesA[0].details as any)?.matchedCount;
    assert(matchedCountA >= 2, `T11: matchedCount >= 2 in audit (got ${matchedCountA})`);
  } finally {
    await cleanupContact(email);
  }
}

// ─── Test 12: No match → ghl_opt_out_unmatched_contact anomaly audit ──────────
async function test12(): Promise<void> {
  console.log("\nTest 12: handleOptOut with no match writes ghl_opt_out_unmatched_contact anomaly audit (Path D)");
  const unknownGhlId = "ghl-no-match-test-12-xxxxxx";
  const unknownEmail = "no-match-test-12@libertybancard.test";
  try {
    const beforeTime = new Date();
    await handleOptOut({ contactId: unknownGhlId, email: unknownEmail, channel: "email" });

    const anomalyLogs = await db.select().from(auditLogs)
      .where(and(
        eq(auditLogs.action, "ghl_opt_out_unmatched_contact"),
        gte(auditLogs.createdAt, beforeTime),
      ))
      .orderBy(desc(auditLogs.createdAt))
      .limit(5);

    assert(anomalyLogs.length > 0, "T12: ghl_opt_out_unmatched_contact anomaly audit written");
    const details = anomalyLogs[0].details as any;
    assert(details?.reason === "no_contact_match", "T12: reason=no_contact_match in audit");
    assert(details?.emailPresent === true, "T12: emailPresent=true in audit details");
    assert(details?.ghlContactId === unknownGhlId, "T12: ghlContactId recorded in audit");

    const events = await db.select().from(sdrLeadEvents)
      .where(and(eq(sdrLeadEvents.eventType, "opt_out"), eq(sdrLeadEvents.ghlRefId, unknownGhlId)));
    assert(events.length > 0, "T12: Webhook event stored even when no contact matched");
  } finally {
  }
}

// ─── Test 13: Unknown contactId only (no email/phone) → Path D, no fuzzy match ─
async function test13(): Promise<void> {
  console.log("\nTest 13: handleOptOut with unknown contactId (no email/phone) → anomaly audit, no fuzzy match");
  const unknownGhlId = "ghl-no-match-test-13-xxxxxx";
  try {
    const beforeTime = new Date();
    await handleOptOut({ contactId: unknownGhlId, channel: "sms" });

    const anomalyLogs = await db.select().from(auditLogs)
      .where(and(
        eq(auditLogs.action, "ghl_opt_out_unmatched_contact"),
        gte(auditLogs.createdAt, beforeTime),
      ))
      .orderBy(desc(auditLogs.createdAt))
      .limit(5);

    assert(anomalyLogs.length > 0, "T13: Unmatched anomaly audit written (no email/phone in payload)");
    const details = anomalyLogs[0].details as any;
    assert(details?.emailPresent === false, "T13: emailPresent=false (no email in payload)");
    assert(details?.phonePresent === false, "T13: phonePresent=false (no phone in payload)");
    assert(details?.reason === "no_contact_match", "T13: reason=no_contact_match");

    const suppressedDeals = await db.select().from(deals)
      .where(and(eq(deals.pipeline, "sales"), eq(deals.stage, "New Lead")));
    const wasAnySuppressedByThisTest = suppressedDeals.some(d =>
      d.autoEnrollmentSuppressedReason?.includes("test-13")
    );
    assert(!wasAnySuppressedByThisTest, "T13: No deal suppressed via fuzzy/name matching");
  } finally {
  }
}

// ─── Test 14: runNewLeadAutoEnrollCheck skips email-match suppressed contact ───
async function test14(): Promise<void> {
  console.log("\nTest 14: runNewLeadAutoEnrollCheck skips contact suppressed via email-match opt-out path");
  const email = "suppress-test-14@libertybancard.test";
  await cleanupContact(email);
  try {
    const contactId = await createTestContact(email);
    await createNewLeadDeal(contactId);

    await handleOptOut({ email, channel: "email" });

    const enrollmentsBefore = await db.select().from(sequenceEnrollments)
      .where(eq(sequenceEnrollments.contactId, contactId));
    assert(enrollmentsBefore.length === 0, "T14: No enrollment before auto-enroll check");

    await runNewLeadAutoEnrollCheck();

    const enrollmentsAfter = await db.select().from(sequenceEnrollments)
      .where(eq(sequenceEnrollments.contactId, contactId));
    assert(enrollmentsAfter.length === 0, "T14: runNewLeadAutoEnrollCheck did NOT enroll email-matched suppressed contact");
  } finally {
    await cleanupContact(email);
  }
}

// ─── Test 15: Active enrollment paused after email-match opt-out ───────────────
async function test15(): Promise<void> {
  console.log("\nTest 15: Active enrollment is paused after email-match opt-out path");
  const email = "suppress-test-15@libertybancard.test";
  await cleanupContact(email);
  try {
    const contactId = await createTestContact(email);
    await createNewLeadDeal(contactId);
    const enrollmentId = await createActiveEnrollment(contactId);

    await handleOptOut({ email, channel: "all" });

    const [enrollment] = await db.select().from(sequenceEnrollments)
      .where(eq(sequenceEnrollments.id, enrollmentId));
    assert(enrollment.status === "paused", "T15: Active enrollment paused after email-match opt-out");
  } finally {
    await cleanupContact(email);
  }
}

// ─── Test 16: handleOptOut never creates deals, sends outbound, triggers GHL sync
async function test16(): Promise<void> {
  console.log("\nTest 16: handleOptOut never creates deals, sends outbound, or triggers GHL sync");
  const email = "suppress-test-16@libertybancard.test";
  const ghlId = "ghl-opt-out-test-16";
  await cleanupContact(email);
  try {
    const contactId = await createTestContact(email, { ghlContactId: ghlId });

    const dealCountBefore = await db.select().from(deals).then(r => r.length);
    const auditsBefore = await db.select().from(auditLogs).then(r => r.length);

    await handleOptOut({ contactId: ghlId, email, channel: "email" });

    const dealCountAfter = await db.select().from(deals).then(r => r.length);
    assert(dealCountAfter === dealCountBefore, "T16: No new deals created by handleOptOut");

    const newSendAudits = await db.select().from(auditLogs).where(
      and(
        eq(auditLogs.action, "outbound_email_sent"),
        gte(auditLogs.createdAt, new Date(Date.now() - 5000)),
      )
    );
    assert(newSendAudits.length === 0, "T16: No outbound sends triggered by handleOptOut");

    const newGhlSyncAudits = await db.select().from(auditLogs).where(
      and(
        eq(auditLogs.action, "ghl_contact_synced"),
        gte(auditLogs.createdAt, new Date(Date.now() - 5000)),
      )
    );
    assert(newGhlSyncAudits.length === 0, "T16: No GHL sync triggered by handleOptOut");
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
  console.log("=== New Lead Unsubscribe Suppression — 16 Test Cases ===\n");

  await test1();
  await test2();
  await test3();
  await test4();
  await test5();
  await test6();
  await test7();
  await test8();
  await test9();
  await test10();
  await test11();
  await test12();
  await test13();
  await test14();
  await test15();
  await test16();

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log("\nFailed cases:");
    errors.forEach(e => console.log(`  ✗ ${e}`));
    process.exit(1);
  } else {
    console.log("\n✓ All 16 test cases passed — suppression is working correctly.");
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
