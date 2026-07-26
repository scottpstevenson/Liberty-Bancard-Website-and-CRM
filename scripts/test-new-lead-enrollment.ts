#!/usr/bin/env tsx
/**
 * scripts/test-new-lead-enrollment.ts
 *
 * End-to-end smoke test for the New Lead backlog enrollment system.
 *
 * Confirms:
 *  T1 — A contact with no blockers gets enrolled after startNewLeadEnroll()
 *  T2 — A DNC contact is skipped and dncBlocked counter increments
 *  T3 — Running twice does NOT double-enroll (idempotency); alreadyEnrolled increments
 *  T4 — progress.enrolled matches the exact row delta in sequence_enrollments
 *
 * Isolation strategy:
 *  - Creates a dedicated test sequence (active, email-only) and sets it as the
 *    ONLY sequence routing during the test:
 *      • defaultNewLeadSequenceId → test sequence
 *      • verticalNewLeadSequenceMap  → {} (empty, so no vertical bypasses the default)
 *    Both are restored in the finally block.
 *  - Snapshots the sequence_enrollments row count for the test sequence before
 *    each run so T4 can assert exact delta === progress.enrolled.
 *  - Cleans up all created rows in the finally block.
 *
 * Usage:
 *   npx tsx scripts/test-new-lead-enrollment.ts
 *
 * Exits 0 if all assertions pass, 1 if any fail.
 */

import { db } from "../server/db";
import {
  contacts,
  deals,
  followUpSequences,
  sequenceSteps,
  sequenceEnrollments,
} from "../shared/schema";
import { eq, and, inArray, count as drizzleCount } from "drizzle-orm";
import { storage } from "../server/storage";
import {
  startNewLeadEnroll,
  getNewLeadEnrollProgress,
  isNewLeadEnrollJobRunning,
  setDefaultSequenceId,
  getDefaultSequenceId,
  setVerticalSequenceMap,
  getVerticalSequenceMap,
} from "../server/services/new-lead-enrollment-job";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(label: string) {
  console.log(`  ✅ PASS  ${label}`);
  passed++;
}

function fail(label: string, detail?: string) {
  const msg = detail ? `${label} — ${detail}` : label;
  console.error(`  ❌ FAIL  ${msg}`);
  failures.push(msg);
  failed++;
}

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) ok(label);
  else fail(label, detail);
}

/** Unique tag used in all test fixture identifiers to allow reliable cleanup. */
const TAG = `nle-test-${Date.now()}`;

/** Poll until the enrollment job is no longer running (max ~90 s). */
async function waitForJobComplete(timeoutMs = 90_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const prog = await getNewLeadEnrollProgress();
    if (!isNewLeadEnrollJobRunning() && prog.status !== "running") {
      return prog.status;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Enrollment job did not complete within timeout");
}

// ─── Fixture creation ─────────────────────────────────────────────────────────

interface Fixtures {
  sequenceId: number;
  cleanContactId: number;
  cleanDealId: number;
  dncContactId: number;
  dncDealId: number;
}

async function createFixtures(): Promise<Fixtures> {
  // 1. Create an active email-only sequence.
  const [seq] = await db
    .insert(followUpSequences)
    .values({
      name: `${TAG}-seq`,
      status: "active",
      triggerType: "manual",
      totalSteps: 1,
    })
    .returning({ id: followUpSequences.id });

  // 2. Add an email step so it's treated as email-only (no PEWC requirement).
  await db.insert(sequenceSteps).values({
    sequenceId: seq.id,
    stepOrder: 1,
    actionType: "email",
    delayDays: 0,
    delayHours: 0,
    subject: `${TAG} step 1`,
    body: "Test body",
  });

  // 3. Clean contact — no blockers, valid email, not DNC.
  const cleanEmail = `${TAG}-clean@example.test`;
  const [cleanContact] = await db
    .insert(contacts)
    .values({
      firstName: "NleClean",
      lastName: "Test",
      email: cleanEmail,
      phone: "3055550001",
      emailStatus: "active",
      doNotContact: false,
      doNotAutoContact: false,
      consentTier: "cold_no_consent",
      companyName: `${TAG} Clean Co`,
    } as any)
    .returning({ id: contacts.id });

  // 4. Deal for the clean contact — New Lead, sales pipeline, not archived.
  const [cleanDeal] = await db
    .insert(deals)
    .values({
      contactId: cleanContact.id,
      pipeline: "sales",
      stage: "New Lead",
      title: `${TAG}-clean-deal`,
    } as any)
    .returning({ id: deals.id });

  // 5. DNC contact — doNotContact: true.
  const dncEmail = `${TAG}-dnc@example.test`;
  const [dncContact] = await db
    .insert(contacts)
    .values({
      firstName: "NleDnc",
      lastName: "Test",
      email: dncEmail,
      phone: "3055550002",
      emailStatus: "active",
      doNotContact: true,
      doNotAutoContact: false,
      consentTier: "cold_no_consent",
      companyName: `${TAG} Dnc Co`,
    } as any)
    .returning({ id: contacts.id });

  // 6. Deal for the DNC contact.
  const [dncDeal] = await db
    .insert(deals)
    .values({
      contactId: dncContact.id,
      pipeline: "sales",
      stage: "New Lead",
      title: `${TAG}-dnc-deal`,
    } as any)
    .returning({ id: deals.id });

  return {
    sequenceId: seq.id,
    cleanContactId: cleanContact.id,
    cleanDealId: cleanDeal.id,
    dncContactId: dncContact.id,
    dncDealId: dncDeal.id,
  };
}

async function cleanupFixtures(f: Fixtures): Promise<void> {
  // Remove ALL enrollments for the test sequence first (FK constraint).
  await db
    .delete(sequenceEnrollments)
    .where(eq(sequenceEnrollments.sequenceId, f.sequenceId));

  // Remove deals.
  await db
    .delete(deals)
    .where(inArray(deals.id, [f.cleanDealId, f.dncDealId]));

  // Remove contacts.
  await db
    .delete(contacts)
    .where(inArray(contacts.id, [f.cleanContactId, f.dncContactId]));

  // Remove sequence steps, then the sequence.
  await db
    .delete(sequenceSteps)
    .where(eq(sequenceSteps.sequenceId, f.sequenceId));
  await db
    .delete(followUpSequences)
    .where(eq(followUpSequences.id, f.sequenceId));
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/** Count active/paused enrollments for a specific contact. */
async function activeEnrollmentCount(contactId: number): Promise<number> {
  const rows = await db
    .select({ id: sequenceEnrollments.id })
    .from(sequenceEnrollments)
    .where(
      and(
        eq(sequenceEnrollments.contactId, contactId),
        inArray(sequenceEnrollments.status, ["active", "paused"])
      )
    );
  return rows.length;
}

/**
 * Count ALL enrollments (any status) for the test sequence.
 * Used to snapshot before/after a run so T4 can compare exact delta vs progress.enrolled.
 */
async function enrollmentCountForSequence(sequenceId: number): Promise<number> {
  const [row] = await db
    .select({ n: drizzleCount() })
    .from(sequenceEnrollments)
    .where(eq(sequenceEnrollments.sequenceId, sequenceId));
  return Number(row?.n ?? 0);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== New Lead Enrollment E2E Tests (tag: ${TAG}) ===\n`);

  // Abort early if a job is already running.
  if (isNewLeadEnrollJobRunning()) {
    console.error(
      "❌ Aborting: a new-lead enrollment job is already running. Wait for it to finish first."
    );
    process.exit(1);
  }

  let fixtures: Fixtures | null = null;
  const originalDefaultSeqId = await getDefaultSequenceId();
  const originalVerticalMap = await getVerticalSequenceMap();

  try {
    // ── Set up fixtures ─────────────────────────────────────────────────────
    console.log("▶ Creating test fixtures …");
    fixtures = await createFixtures();
    console.log(
      `  sequence=${fixtures.sequenceId}  cleanContact=${fixtures.cleanContactId}  dncContact=${fixtures.dncContactId}\n`
    );

    // ── Route ALL contacts through the test sequence ────────────────────────
    // Clear the vertical map so no existing vertical mapping bypasses the default,
    // then point the default at our test sequence.
    await setVerticalSequenceMap({});
    await setDefaultSequenceId(fixtures.sequenceId);
    console.log(
      `  Vertical map cleared. Default sequence → ${fixtures.sequenceId}\n`
    );

    // ── RUN 1 ───────────────────────────────────────────────────────────────
    console.log("▶ Run 1: startNewLeadEnroll()");

    // Snapshot enrollment count BEFORE the run so we can compute an exact delta.
    const enrollCountBefore1 = await enrollmentCountForSequence(fixtures.sequenceId);

    await startNewLeadEnroll();
    const finalStatus1 = await waitForJobComplete();
    const prog1 = await getNewLeadEnrollProgress();

    const enrollCountAfter1 = await enrollmentCountForSequence(fixtures.sequenceId);
    const enrollDelta1 = enrollCountAfter1 - enrollCountBefore1;

    console.log(
      `  status=${finalStatus1}  total=${prog1.total}  enrolled=${prog1.enrolled}  ` +
        `dncBlocked=${prog1.dncBlocked}  alreadyEnrolled=${prog1.alreadyEnrolled}  ` +
        `dbDelta=${enrollDelta1}\n`
    );

    // T1 — Clean contact must be enrolled.
    const cleanEnroll1 = await activeEnrollmentCount(fixtures.cleanContactId);
    assert(
      "T1a: clean contact has ≥1 active/paused enrollment after run 1",
      cleanEnroll1 >= 1,
      `found ${cleanEnroll1}`
    );
    assert(
      "T1b: job status is 'complete'",
      finalStatus1 === "complete",
      `got ${finalStatus1}`
    );
    assert(
      "T1c: progress.enrolled ≥ 1",
      prog1.enrolled >= 1,
      `got ${prog1.enrolled}`
    );

    // T2 — DNC contact must NOT be enrolled.
    const dncEnroll1 = await activeEnrollmentCount(fixtures.dncContactId);
    assert(
      "T2a: DNC contact has 0 active/paused enrollments after run 1",
      dncEnroll1 === 0,
      `found ${dncEnroll1}`
    );
    assert(
      "T2b: progress.dncBlocked ≥ 1",
      prog1.dncBlocked >= 1,
      `got ${prog1.dncBlocked}`
    );

    // T4 — Exact counter equivalence.
    // With vertical map empty and the default pointing at our test sequence, every
    // enrollment the job creates lands in that sequence, so the DB row delta must
    // equal progress.enrolled exactly.
    assert(
      "T4a: sequence_enrollments delta === progress.enrolled (exact match)",
      enrollDelta1 === prog1.enrolled,
      `dbDelta=${enrollDelta1}  progress.enrolled=${prog1.enrolled}`
    );
    assert(
      "T4b: at least 1 new row was created in sequence_enrollments",
      enrollDelta1 >= 1,
      `dbDelta=${enrollDelta1}`
    );

    // ── RUN 2 (idempotency) ─────────────────────────────────────────────────
    console.log("\n▶ Run 2: startNewLeadEnroll() (idempotency check)");

    const enrollCountBefore2 = await enrollmentCountForSequence(fixtures.sequenceId);

    await startNewLeadEnroll();
    const finalStatus2 = await waitForJobComplete();
    const prog2 = await getNewLeadEnrollProgress();

    const enrollCountAfter2 = await enrollmentCountForSequence(fixtures.sequenceId);
    const enrollDelta2 = enrollCountAfter2 - enrollCountBefore2;

    console.log(
      `  status=${finalStatus2}  total=${prog2.total}  enrolled=${prog2.enrolled}  ` +
        `dncBlocked=${prog2.dncBlocked}  alreadyEnrolled=${prog2.alreadyEnrolled}  ` +
        `dbDelta=${enrollDelta2}\n`
    );

    // T3 — No double-enrollment.
    const cleanEnroll2 = await activeEnrollmentCount(fixtures.cleanContactId);
    assert(
      "T3a: clean contact still has exactly 1 active/paused enrollment after run 2",
      cleanEnroll2 === 1,
      `found ${cleanEnroll2}`
    );
    assert(
      "T3b: progress.alreadyEnrolled ≥ 1 on run 2",
      prog2.alreadyEnrolled >= 1,
      `got ${prog2.alreadyEnrolled}`
    );
    assert(
      "T3c: progress.enrolled = 0 on run 2 (no new enrollments)",
      prog2.enrolled === 0,
      `got ${prog2.enrolled}`
    );
    assert(
      "T3d: job status is 'complete' on run 2",
      finalStatus2 === "complete",
      `got ${finalStatus2}`
    );
    assert(
      "T3e: DNC contact still has 0 active/paused enrollments after run 2",
      (await activeEnrollmentCount(fixtures.dncContactId)) === 0
    );

    // T4 idempotency corollary: DB delta on run 2 must also equal progress.enrolled (= 0).
    assert(
      "T4c: sequence_enrollments delta on run 2 === progress.enrolled (both 0)",
      enrollDelta2 === prog2.enrolled,
      `dbDelta=${enrollDelta2}  progress.enrolled=${prog2.enrolled}`
    );
  } finally {
    // ── Restore original routing config ──────────────────────────────────────
    await setDefaultSequenceId(originalDefaultSeqId);
    await setVerticalSequenceMap(originalVerticalMap);
    console.log(
      `\n  Restored: defaultSeqId=${originalDefaultSeqId ?? "null"}  verticalMap keys=[${Object.keys(originalVerticalMap).join(", ") || "none"}]`
    );

    // ── Clean up test data ────────────────────────────────────────────────────
    if (fixtures) {
      await cleanupFixtures(fixtures);
      console.log("  Test fixtures cleaned up.\n");
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log("─".repeat(56));
  console.log(`test-new-lead-enrollment — SUMMARY`);
  console.log("─".repeat(56));
  console.log(`  Passed : ${passed} / ${total}`);
  console.log(`  Failed : ${failed}`);
  if (failures.length > 0) {
    console.log("\n  Failed assertions:");
    for (const f of failures) console.log(`    ✗ ${f}`);
  }
  console.log("─".repeat(56));

  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error("[test-new-lead-enrollment] Fatal error:", err);
  process.exit(1);
});
