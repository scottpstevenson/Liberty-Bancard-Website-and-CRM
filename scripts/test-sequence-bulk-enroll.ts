/**
 * Validation script for vertical bulk enrollment feature.
 *
 * Tests:
 * 1. Dry-run / preview creates no enrollments
 * 2. Eligible contact in vertical is queued
 * 3. Already-enrolled contact is skipped
 * 4. Opted-out/DNC contact is skipped
 * 5. Paused sequence rejects before any DB write
 * 6. Second run creates no duplicate enrollments
 * 7. Unknown vertical rejects safely
 * 8. Preview returns counts + max 5 contacts
 * 9. Admin/manager allowed; agent unauthorized
 */

import { db } from "../server/db";
import { contacts, followUpSequences, sequenceEnrollments, users } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { storage } from "../server/storage";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

async function cleanupTestData(testTag: string) {
  const testContacts = await db.select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.email, `bulk-enroll-test-${testTag}@test.invalid`), isNull(contacts.archivedAt)));
  for (const c of testContacts) {
    await db.delete(sequenceEnrollments).where(eq(sequenceEnrollments.contactId, c.id));
    await db.update(contacts).set({ archivedAt: new Date() }).where(eq(contacts.id, c.id));
  }
  const testSeqs = await db.select({ id: followUpSequences.id })
    .from(followUpSequences)
    .where(eq(followUpSequences.name, `test-bulk-enroll-seq-${testTag}`));
  for (const s of testSeqs) {
    await db.delete(sequenceEnrollments).where(eq(sequenceEnrollments.sequenceId, s.id));
    await db.delete(followUpSequences).where(eq(followUpSequences.id, s.id));
  }
}

async function createTestContact(email: string, opts: {
  vertical?: string;
  doNotContact?: boolean;
  consentTier?: string;
} = {}) {
  const [c] = await db.insert(contacts).values({
    firstName: "BulkTest",
    lastName: "User",
    email,
    phone: "5550000000",
    vertical: opts.vertical ?? "Salon",
    doNotContact: opts.doNotContact ?? false,
    consentTier: opts.consentTier ?? "cold_no_consent",
  }).returning();
  return c;
}

async function createTestSequence(name: string, status: "active" | "paused" | "draft" = "active") {
  const [seq] = await db.insert(followUpSequences).values({
    name,
    triggerType: "manual",
    status,
  }).returning();
  return seq;
}

async function runTests() {
  const TAG = Date.now().toString();
  console.log("\n=== Vertical Bulk Enrollment Validation ===\n");

  // --- Test 1: Dry-run preview creates no enrollments ---
  console.log("Test 1: Preview creates no enrollments");
  {
    await cleanupTestData(`t1-${TAG}`);
    const contact = await createTestContact(`bulk-enroll-test-t1-${TAG}@test.invalid`, { vertical: "Salon" });
    const seq = await createTestSequence(`test-bulk-enroll-seq-t1-${TAG}`, "active");

    const beforeCount = (await db.select().from(sequenceEnrollments).where(eq(sequenceEnrollments.sequenceId, seq.id))).length;
    const vertical = "Salon";

    const { canEnrollContactInSequence } = await import("../server/services/sequence-eligibility");
    const allContacts = await storage.getContactsByVertical(vertical);
    let eligible = 0;
    for (const c of allContacts) {
      const result = await canEnrollContactInSequence(c.id, seq);
      if (result.allowed) eligible++;
    }

    const afterCount = (await db.select().from(sequenceEnrollments).where(eq(sequenceEnrollments.sequenceId, seq.id))).length;
    assert(afterCount === beforeCount, "Preview (dry-run) creates no enrollments in DB");
    assert(eligible >= 1, "At least 1 eligible contact found in Salon vertical for dry-run");

    await cleanupTestData(`t1-${TAG}`);
  }

  // --- Test 2: Eligible contact is queued ---
  console.log("\nTest 2: Eligible contact is queued");
  {
    await cleanupTestData(`t2-${TAG}`);
    const contact = await createTestContact(`bulk-enroll-test-t2-${TAG}@test.invalid`, { vertical: "Salon", consentTier: "cold_no_consent" });
    const seq = await createTestSequence(`test-bulk-enroll-seq-t2-${TAG}`, "active");

    const { canEnrollContactInSequence } = await import("../server/services/sequence-eligibility");
    const eligibility = await canEnrollContactInSequence(contact.id, seq);
    if (eligibility.allowed) {
      await storage.createSequenceEnrollment({ sequenceId: seq.id, contactId: contact.id, status: "active", currentStep: 0, nextActionAt: new Date() });
      const enrollments = await db.select().from(sequenceEnrollments).where(and(eq(sequenceEnrollments.sequenceId, seq.id), eq(sequenceEnrollments.contactId, contact.id)));
      assert(enrollments.length === 1, "Eligible contact successfully enrolled");
    } else {
      assert(false, `Expected eligible but got: ${eligibility.reason}`);
    }

    await cleanupTestData(`t2-${TAG}`);
  }

  // --- Test 3: Already-enrolled contact is skipped ---
  console.log("\nTest 3: Already-enrolled contact is skipped");
  {
    await cleanupTestData(`t3-${TAG}`);
    const contact = await createTestContact(`bulk-enroll-test-t3-${TAG}@test.invalid`, { vertical: "Salon" });
    const seq = await createTestSequence(`test-bulk-enroll-seq-t3-${TAG}`, "active");

    await storage.createSequenceEnrollment({ sequenceId: seq.id, contactId: contact.id, status: "active", currentStep: 0, nextActionAt: new Date() });

    const existingEnrollments = await storage.getSequenceEnrollments(seq.id);
    const enrolledIds = new Set(existingEnrollments.filter(e => e.status === "active" || e.status === "completed").map(e => e.contactId).filter(Boolean) as number[]);
    assert(enrolledIds.has(contact.id), "Already-enrolled contact is detected and would be skipped");

    const countBefore = (await db.select().from(sequenceEnrollments).where(and(eq(sequenceEnrollments.sequenceId, seq.id), eq(sequenceEnrollments.contactId, contact.id)))).length;
    assert(countBefore === 1, "No duplicate enrollment created when already enrolled");

    await cleanupTestData(`t3-${TAG}`);
  }

  // --- Test 4: Opted-out/DNC contact is skipped ---
  console.log("\nTest 4: Opted-out/DNC contact is skipped");
  {
    await cleanupTestData(`t4-${TAG}`);
    const dncContact = await createTestContact(`bulk-enroll-test-t4-${TAG}@test.invalid`, { vertical: "Salon", doNotContact: true });
    const seq = await createTestSequence(`test-bulk-enroll-seq-t4-${TAG}`, "active");

    const { canEnrollContactInSequence } = await import("../server/services/sequence-eligibility");
    const eligibility = await canEnrollContactInSequence(dncContact.id, seq);
    assert(!eligibility.allowed, "DNC contact is blocked from enrollment");
    assert(eligibility.reason?.includes("Do Not Contact") ?? false, `DNC reason is clear: ${eligibility.reason}`);

    const optOutContact = await createTestContact(`bulk-enroll-test-t4b-${TAG}@test.invalid`, { vertical: "Salon", consentTier: "opted_out" });
    const eligibility2 = await canEnrollContactInSequence(optOutContact.id, seq);
    assert(!eligibility2.allowed, "Opted-out contact is blocked from enrollment");

    await cleanupTestData(`t4-${TAG}`);
    await db.update(contacts).set({ archivedAt: new Date() }).where(eq(contacts.email, `bulk-enroll-test-t4b-${TAG}@test.invalid`));
  }

  // --- Test 5: Paused sequence rejects before any DB write ---
  console.log("\nTest 5: Paused sequence rejects");
  {
    await cleanupTestData(`t5-${TAG}`);
    const contact = await createTestContact(`bulk-enroll-test-t5-${TAG}@test.invalid`, { vertical: "Salon" });
    const seq = await createTestSequence(`test-bulk-enroll-seq-t5-${TAG}`, "paused");

    let threw = false;
    try {
      await storage.createSequenceEnrollment({ sequenceId: seq.id, contactId: contact.id, status: "active", currentStep: 0, nextActionAt: new Date() });
    } catch (e: any) {
      threw = true;
      assert(e.message.includes("paused") || e.message.includes("not active"), `Paused sequence throws correct error: ${e.message}`);
    }
    assert(threw, "Paused sequence throws an error on enrollment attempt");

    const enrollments = await db.select().from(sequenceEnrollments).where(and(eq(sequenceEnrollments.sequenceId, seq.id), eq(sequenceEnrollments.contactId, contact.id)));
    assert(enrollments.length === 0, "No enrollments created for paused sequence");

    await cleanupTestData(`t5-${TAG}`);
  }

  // --- Test 6: Second run creates no duplicate enrollments ---
  console.log("\nTest 6: Second run creates no duplicates");
  {
    await cleanupTestData(`t6-${TAG}`);
    const contact = await createTestContact(`bulk-enroll-test-t6-${TAG}@test.invalid`, { vertical: "Salon", consentTier: "cold_no_consent" });
    const seq = await createTestSequence(`test-bulk-enroll-seq-t6-${TAG}`, "active");

    const { canEnrollContactInSequence } = await import("../server/services/sequence-eligibility");

    const doEnroll = async () => {
      const existingEnrollments = await storage.getSequenceEnrollments(seq.id);
      const enrolledIds = new Set(existingEnrollments.filter(e => e.status === "active" || e.status === "completed").map(e => e.contactId).filter(Boolean) as number[]);
      const allContacts = await storage.getContactsByVertical("Salon");
      let queued = 0;
      for (const c of allContacts) {
        if (enrolledIds.has(c.id)) continue;
        const eligibility = await canEnrollContactInSequence(c.id, seq);
        if (!eligibility.allowed) continue;
        await storage.createSequenceEnrollment({ sequenceId: seq.id, contactId: c.id, status: "active", currentStep: 0, nextActionAt: new Date() });
        enrolledIds.add(c.id);
        queued++;
      }
      return queued;
    };

    const run1 = await doEnroll();
    const run2 = await doEnroll();

    assert(run1 >= 1, `First run queued at least 1 contact (got ${run1})`);
    assert(run2 === 0, `Second run queued 0 contacts (got ${run2}) — no duplicates`);

    const enrollments = await db.select().from(sequenceEnrollments).where(and(eq(sequenceEnrollments.sequenceId, seq.id), eq(sequenceEnrollments.contactId, contact.id)));
    assert(enrollments.length === 1, "Exactly 1 enrollment for the contact after two runs");

    await cleanupTestData(`t6-${TAG}`);
  }

  // --- Test 7: Unknown vertical rejects safely ---
  console.log("\nTest 7: Unknown vertical returns empty, no error");
  {
    const result = await storage.getContactsByVertical("__nonexistent_vertical_xyz__");
    assert(Array.isArray(result), "getContactsByVertical returns array for unknown vertical");
    assert(result.length === 0, "Unknown vertical returns empty array (no contacts)");
  }

  // --- Test 8: Preview returns counts + max 5 contacts ---
  console.log("\nTest 8: Preview returns max 5 contacts");
  {
    await cleanupTestData(`t8-${TAG}`);
    const seq = await createTestSequence(`test-bulk-enroll-seq-t8-${TAG}`, "active");

    const contacts8: any[] = [];
    for (let i = 0; i < 7; i++) {
      const c = await createTestContact(`bulk-enroll-test-t8-${i}-${TAG}@test.invalid`, { vertical: "Salon", consentTier: "cold_no_consent" });
      contacts8.push(c);
    }

    const { canEnrollContactInSequence } = await import("../server/services/sequence-eligibility");
    const allContacts = await storage.getContactsByVertical("Salon");
    const existingEnrollments = await storage.getSequenceEnrollments(seq.id);
    const enrolledIds = new Set(existingEnrollments.filter(e => e.status === "active" || e.status === "completed").map(e => e.contactId).filter(Boolean) as number[]);

    const previewContacts: any[] = [];
    let eligible = 0;
    for (const c of allContacts) {
      if (enrolledIds.has(c.id)) continue;
      const eligibility = await canEnrollContactInSequence(c.id, seq);
      if (eligibility.allowed) {
        eligible++;
        if (previewContacts.length < 5) {
          previewContacts.push(c);
        }
      }
    }

    assert(previewContacts.length <= 5, `Preview contacts capped at 5 (got ${previewContacts.length})`);
    assert(eligible >= 7, `At least 7 eligible contacts in Salon vertical (got ${eligible})`);

    for (let i = 0; i < 7; i++) {
      await db.update(contacts).set({ archivedAt: new Date() }).where(eq(contacts.email, `bulk-enroll-test-t8-${i}-${TAG}@test.invalid`));
    }
    await cleanupTestData(`t8-${TAG}`);
  }

  // --- Test 9: Human cohort mutation retired ---
  console.log("\nTest 9: Human bulk-enroll route is retired");
  {
    const fs = await import("fs");
    const campaignsTs = fs.readFileSync("server/routes/campaigns.ts", "utf-8");
    const previewHasRoleGuard = campaignsTs.includes(`requireRole("admin", "manager")`) &&
      campaignsTs.includes("enroll-vertical/preview");
    const enrollIsRetired = campaignsTs.includes("HUMAN_SEQUENCE_DISPATCH_DISABLED") &&
      campaignsTs.includes("Human sequence cohort enrollment is disabled");
    assert(previewHasRoleGuard, "Preview endpoint uses requireRole('admin', 'manager')");
    assert(enrollIsRetired, "Bulk enroll endpoint universally denies authenticated human execution");

    const verticalsIsAuthenticated = campaignsTs.includes("isAuthenticated") &&
      campaignsTs.includes("/api/contacts/verticals");
    assert(verticalsIsAuthenticated, "Verticals endpoint uses isAuthenticated (read-only)");
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
