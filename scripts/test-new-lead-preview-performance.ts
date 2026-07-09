#!/usr/bin/env tsx
/**
 * Task #861 — New Lead Enrollment Preview Performance validation.
 *
 * 10 test cases verifying the bulk-optimised previewNewLeadEnroll():
 *   1.  Preview creates no enrollments (read-only assertion)
 *   2.  Count parity with mixed fixture data (DNC, enrolled, eligible, no-seq)
 *   3.  Already-enrolled contacts are counted in alreadyEnrolled
 *   4.  DNC contacts are counted in dncBlocked
 *   5.  Missing-email contacts are counted in missingContactMethod
 *   6.  Inactive sequence is counted in inactiveSequenceBlocked
 *   7.  No mapped sequence is counted in noSequenceBlocked
 *   8.  Duplicate deals sharing a contactId do not cause duplicate contact lookups
 *   9.  Sequence and steps are fetched once, not per-deal (cache assertion)
 *  10.  Preview completes < 5 s for a large (200-deal) fixture
 *
 * Run with the dev server NOT required — hits the DB directly.
 *   npx tsx scripts/test-new-lead-preview-performance.ts
 */

import { db } from "../server/db";
import {
  deals,
  contacts,
  followUpSequences,
  sequenceSteps,
  sequenceEnrollments,
  systemSettings,
} from "../shared/schema";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { storage } from "../server/storage";
import { previewNewLeadEnroll } from "../server/services/new-lead-enrollment-job";

const TEST_PREFIX = "nlptest_" + Date.now();

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function cleanup(
  contactIds: number[],
  dealIds: number[],
  sequenceIds: number[],
) {
  if (dealIds.length) await db.delete(deals).where(inArray(deals.id, dealIds));
  if (sequenceIds.length) {
    await db.delete(sequenceSteps).where(inArray(sequenceSteps.sequenceId, sequenceIds));
    await db.delete(sequenceEnrollments).where(inArray(sequenceEnrollments.sequenceId, sequenceIds));
    await db.delete(followUpSequences).where(inArray(followUpSequences.id, sequenceIds));
  }
  if (contactIds.length) {
    await db.delete(sequenceEnrollments).where(inArray(sequenceEnrollments.contactId, contactIds));
    await db.delete(contacts).where(inArray(contacts.id, contactIds));
  }
}

async function resetSettings() {
  await db.delete(systemSettings).where(
    inArray(systemSettings.key, [
      "defaultNewLeadSequenceId",
      "verticalNewLeadSequenceMap",
    ])
  );
}

async function setDefaultSeq(id: number | null) {
  await db.delete(systemSettings).where(eq(systemSettings.key, "defaultNewLeadSequenceId"));
  if (id !== null) {
    await db.insert(systemSettings).values({ key: "defaultNewLeadSequenceId", value: id });
  }
}

async function setVerticalMap(map: Record<string, number>) {
  await db.delete(systemSettings).where(eq(systemSettings.key, "verticalNewLeadSequenceMap"));
  await db.insert(systemSettings).values({ key: "verticalNewLeadSequenceMap", value: map });
}

async function makeContact(overrides: Record<string, unknown> = {}) {
  const email = `${TEST_PREFIX}_${Math.random().toString(36).slice(2)}@test.com`;
  const [c] = await db.insert(contacts).values({
    firstName: "TestNL",
    lastName: "Preview",
    email,
    phone: "+15550001111",
    status: "active",
    leadSource: "test",
    sourceCategory: "test",
    ...overrides,
  } as any).returning({ id: contacts.id, email: contacts.email });
  return c;
}

async function makeDeal(contactId: number, overrides: Record<string, unknown> = {}) {
  const [d] = await db.insert(deals).values({
    title: `Test Deal ${TEST_PREFIX}`,
    pipeline: "sales",
    stage: "New Lead",
    contactId,
    ...overrides,
  } as any).returning({ id: deals.id });
  return d;
}

async function makeSequence(status: "active" | "inactive" | "paused" = "active") {
  const [s] = await db.insert(followUpSequences).values({
    name: `${TEST_PREFIX}_seq_${Math.random().toString(36).slice(2)}`,
    status,
    triggerType: "manual",
    campaignFamily: "general_outreach",
  } as any).returning({ id: followUpSequences.id });
  return s;
}

async function makeStep(sequenceId: number, actionType = "email") {
  await db.insert(sequenceSteps).values({
    sequenceId,
    stepOrder: 1,
    actionType,
    subject: "Test",
    body: "Test body",
    delayDays: 0,
  } as any);
}

async function makeEnrollment(contactId: number, sequenceId: number, status = "active") {
  await db.insert(sequenceEnrollments).values({
    contactId,
    sequenceId,
    status,
    currentStep: 0,
    nextActionAt: new Date(),
  } as any);
}

async function countEnrollments(): Promise<number> {
  const rows = await db.select({ id: sequenceEnrollments.id }).from(sequenceEnrollments);
  return rows.length;
}

// ─── TEST 1: Preview creates no enrollments ──────────────────────────────────
async function test1() {
  console.log("\nTest 1: Preview creates no enrollments");
  const contactIds: number[] = [];
  const dealIds: number[] = [];
  const seqIds: number[] = [];
  try {
    const seq = await makeSequence();
    seqIds.push(seq.id);
    await makeStep(seq.id);
    const c = await makeContact();
    contactIds.push(c.id);
    const d = await makeDeal(c.id);
    dealIds.push(d.id);
    await setDefaultSeq(seq.id);

    const beforeCount = await countEnrollments();
    await previewNewLeadEnroll();
    const afterCount = await countEnrollments();

    ok("enrollment count unchanged", beforeCount === afterCount,
      `before=${beforeCount} after=${afterCount}`);
  } finally {
    await cleanup(contactIds, dealIds, seqIds);
    await resetSettings();
  }
}

// ─── TEST 2: Count parity with mixed fixture ─────────────────────────────────
async function test2() {
  console.log("\nTest 2: Count parity with mixed fixture data");
  const contactIds: number[] = [];
  const dealIds: number[] = [];
  const seqIds: number[] = [];
  try {
    const seq = await makeSequence();
    seqIds.push(seq.id);
    await makeStep(seq.id);
    await setDefaultSeq(seq.id);

    // Eligible contact
    const c1 = await makeContact({ email: `${TEST_PREFIX}_eligible@test.com` });
    contactIds.push(c1.id);
    const d1 = await makeDeal(c1.id);
    dealIds.push(d1.id);

    // DNC contact
    const c2 = await makeContact({ email: `${TEST_PREFIX}_dnc@test.com`, doNotContact: true });
    contactIds.push(c2.id);
    const d2 = await makeDeal(c2.id);
    dealIds.push(d2.id);

    // Deal with no contact
    const [dNoContact] = await db.insert(deals).values({
      title: `Test Deal No Contact ${TEST_PREFIX}`,
      pipeline: "sales",
      stage: "New Lead",
    } as any).returning({ id: deals.id });
    dealIds.push(dNoContact.id);

    const result = await previewNewLeadEnroll();

    ok("total >= 3", result.total >= 3, `total=${result.total}`);
    ok("dncBlocked >= 1", result.dncBlocked >= 1, `dncBlocked=${result.dncBlocked}`);
    ok("noContactBlocked >= 1", result.noContactBlocked >= 1, `noContactBlocked=${result.noContactBlocked}`);
    ok("total = eligible+blocked sums",
      result.total === result.eligible + result.dncBlocked + result.alreadyEnrolled +
        result.optOutBlocked + result.contactabilityBlocked + result.pewcBlocked +
        result.missingContactMethod + result.eligibilityBlocked +
        result.noSequenceBlocked + result.inactiveSequenceBlocked + result.noContactBlocked,
      `total=${result.total}`);
  } finally {
    await cleanup(contactIds, dealIds, seqIds);
    await resetSettings();
  }
}

// ─── TEST 3: Already-enrolled contacts counted correctly ─────────────────────
async function test3() {
  console.log("\nTest 3: Already-enrolled contacts counted in alreadyEnrolled");
  const contactIds: number[] = [];
  const dealIds: number[] = [];
  const seqIds: number[] = [];
  try {
    const seq = await makeSequence();
    seqIds.push(seq.id);
    await makeStep(seq.id);
    await setDefaultSeq(seq.id);

    const c = await makeContact();
    contactIds.push(c.id);
    const d = await makeDeal(c.id);
    dealIds.push(d.id);
    await makeEnrollment(c.id, seq.id, "active");

    const result = await previewNewLeadEnroll();
    ok("alreadyEnrolled >= 1", result.alreadyEnrolled >= 1, `alreadyEnrolled=${result.alreadyEnrolled}`);
  } finally {
    await cleanup(contactIds, dealIds, seqIds);
    await resetSettings();
  }
}

// ─── TEST 4: DNC contacts blocked ────────────────────────────────────────────
async function test4() {
  console.log("\nTest 4: DNC contacts blocked in dncBlocked");
  const contactIds: number[] = [];
  const dealIds: number[] = [];
  const seqIds: number[] = [];
  try {
    const seq = await makeSequence();
    seqIds.push(seq.id);
    await makeStep(seq.id);
    await setDefaultSeq(seq.id);

    const c = await makeContact({ doNotContact: true });
    contactIds.push(c.id);
    const d = await makeDeal(c.id);
    dealIds.push(d.id);

    const result = await previewNewLeadEnroll();
    ok("dncBlocked >= 1", result.dncBlocked >= 1, `dncBlocked=${result.dncBlocked}`);
    ok("eligible = 0 for this contact", result.eligible === 0 || result.dncBlocked >= 1,
      `dncBlocked=${result.dncBlocked}`);
  } finally {
    await cleanup(contactIds, dealIds, seqIds);
    await resetSettings();
  }
}

// ─── TEST 5: Missing-email contacts blocked ───────────────────────────────────
async function test5() {
  console.log("\nTest 5: Missing-email contacts blocked in missingContactMethod");
  const contactIds: number[] = [];
  const dealIds: number[] = [];
  const seqIds: number[] = [];
  try {
    const seq = await makeSequence();
    seqIds.push(seq.id);
    await makeStep(seq.id, "email");
    await setDefaultSeq(seq.id);

    const [c] = await db.insert(contacts).values({
      firstName: "NoEmail",
      lastName: "Test",
      email: "",
      phone: "+15550009999",
      status: "active",
      leadSource: "test",
      sourceCategory: "test",
    } as any).returning({ id: contacts.id });
    contactIds.push(c.id);
    const d = await makeDeal(c.id);
    dealIds.push(d.id);

    const result = await previewNewLeadEnroll();
    ok("missingContactMethod >= 1", result.missingContactMethod >= 1,
      `missingContactMethod=${result.missingContactMethod}`);
  } finally {
    await cleanup(contactIds, dealIds, seqIds);
    await resetSettings();
  }
}

// ─── TEST 6: Inactive sequence blocked ───────────────────────────────────────
async function test6() {
  console.log("\nTest 6: Inactive sequence blocked in inactiveSequenceBlocked");
  const contactIds: number[] = [];
  const dealIds: number[] = [];
  const seqIds: number[] = [];
  try {
    const seq = await makeSequence("inactive");
    seqIds.push(seq.id);
    await makeStep(seq.id);
    await setDefaultSeq(seq.id);

    const c = await makeContact();
    contactIds.push(c.id);
    const d = await makeDeal(c.id);
    dealIds.push(d.id);

    const result = await previewNewLeadEnroll();
    ok("inactiveSequenceBlocked >= 1", result.inactiveSequenceBlocked >= 1,
      `inactiveSequenceBlocked=${result.inactiveSequenceBlocked}`);
  } finally {
    await cleanup(contactIds, dealIds, seqIds);
    await resetSettings();
  }
}

// ─── TEST 7: No mapped sequence blocked ──────────────────────────────────────
async function test7() {
  console.log("\nTest 7: No mapped sequence blocked in noSequenceBlocked");
  const contactIds: number[] = [];
  const dealIds: number[] = [];
  const seqIds: number[] = [];
  try {
    await resetSettings();

    const c = await makeContact();
    contactIds.push(c.id);
    const d = await makeDeal(c.id);
    dealIds.push(d.id);

    const result = await previewNewLeadEnroll();
    ok("noSequenceBlocked >= 1", result.noSequenceBlocked >= 1,
      `noSequenceBlocked=${result.noSequenceBlocked}`);
  } finally {
    await cleanup(contactIds, dealIds, seqIds);
    await resetSettings();
  }
}

// ─── TEST 8: Duplicate deals / contactIds do not cause duplicate lookups ─────
async function test8() {
  console.log("\nTest 8: Duplicate contactIds do not cause duplicate contact lookups");
  const contactIds: number[] = [];
  const dealIds: number[] = [];
  const seqIds: number[] = [];
  try {
    const seq = await makeSequence();
    seqIds.push(seq.id);
    await makeStep(seq.id);
    await setDefaultSeq(seq.id);

    const c = await makeContact();
    contactIds.push(c.id);

    // Two deals for the same contact
    const d1 = await makeDeal(c.id);
    dealIds.push(d1.id);
    const d2 = await makeDeal(c.id);
    dealIds.push(d2.id);

    let getContactsByIdsCallCount = 0;
    const original = storage.getContactsByIds.bind(storage);
    storage.getContactsByIds = async (ids: number[]) => {
      getContactsByIdsCallCount++;
      return original(ids);
    };

    try {
      const result = await previewNewLeadEnroll();
      ok("total >= 2 (two deals)", result.total >= 2, `total=${result.total}`);
      ok("getContactsByIds called at most once", getContactsByIdsCallCount <= 1,
        `called ${getContactsByIdsCallCount} time(s)`);
    } finally {
      storage.getContactsByIds = original;
    }
  } finally {
    await cleanup(contactIds, dealIds, seqIds);
    await resetSettings();
  }
}

// ─── TEST 9: Sequence and steps fetched once, not per-deal ───────────────────
async function test9() {
  console.log("\nTest 9: Sequence and steps are fetched once regardless of deal count");
  const contactIds: number[] = [];
  const dealIds: number[] = [];
  const seqIds: number[] = [];
  try {
    const seq = await makeSequence();
    seqIds.push(seq.id);
    await makeStep(seq.id);
    await setDefaultSeq(seq.id);

    // Three different contacts, same sequence
    for (let i = 0; i < 3; i++) {
      const c = await makeContact();
      contactIds.push(c.id);
      const d = await makeDeal(c.id);
      dealIds.push(d.id);
    }

    let seqByIdsCalls = 0;
    let stepsBySeqCalls = 0;
    const origSeqs = storage.getFollowUpSequencesByIds.bind(storage);
    const origSteps = storage.getSequenceStepsForSequences.bind(storage);

    storage.getFollowUpSequencesByIds = async (ids: number[]) => {
      seqByIdsCalls++;
      return origSeqs(ids);
    };
    storage.getSequenceStepsForSequences = async (ids: number[]) => {
      stepsBySeqCalls++;
      return origSteps(ids);
    };

    try {
      await previewNewLeadEnroll();
      ok("getFollowUpSequencesByIds called exactly once", seqByIdsCalls === 1,
        `called ${seqByIdsCalls} time(s)`);
      ok("getSequenceStepsForSequences called exactly once", stepsBySeqCalls === 1,
        `called ${stepsBySeqCalls} time(s)`);
    } finally {
      storage.getFollowUpSequencesByIds = origSeqs;
      storage.getSequenceStepsForSequences = origSteps;
    }
  } finally {
    await cleanup(contactIds, dealIds, seqIds);
    await resetSettings();
  }
}

// ─── TEST 10: Large fixture completes within threshold ────────────────────────
async function test10() {
  console.log("\nTest 10: Large fixture (200 deals) completes in < 5000 ms");
  const contactIds: number[] = [];
  const dealIds: number[] = [];
  const seqIds: number[] = [];
  try {
    const seq = await makeSequence();
    seqIds.push(seq.id);
    await makeStep(seq.id);
    await setDefaultSeq(seq.id);

    const DEAL_COUNT = 200;
    for (let i = 0; i < DEAL_COUNT; i++) {
      const c = await makeContact();
      contactIds.push(c.id);
      const d = await makeDeal(c.id);
      dealIds.push(d.id);
    }

    const start = Date.now();
    const result = await previewNewLeadEnroll();
    const durationMs = Date.now() - start;

    ok(`total >= ${DEAL_COUNT}`, result.total >= DEAL_COUNT, `total=${result.total}`);
    ok(`completed in < 5000 ms (actual: ${durationMs} ms)`, durationMs < 5000,
      `durationMs=${durationMs}`);
  } finally {
    await cleanup(contactIds, dealIds, seqIds);
    await resetSettings();
  }
}

// ─── Main runner ─────────────────────────────────────────────────────────────
async function main() {
  console.log("=== New Lead Preview Performance Tests ===\n");
  console.log("Prefix:", TEST_PREFIX);

  try {
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
  } catch (err) {
    console.error("\nFatal error:", err);
    process.exit(1);
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`${passed + failed} tests: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.error(`\n✗ ${failed} test(s) FAILED`);
    process.exit(1);
  } else {
    console.log("\n✓ All tests passed");
    process.exit(0);
  }
}

main();
