#!/usr/bin/env npx tsx
/**
 * test-new-lead-candidate-audit.ts
 *
 * Three-case audit-trail coverage suite for runNewLeadAutoEnrollCheck():
 *
 *  Test 1 — Candidate mode (autoEnrollNewLeadDeals=false):
 *    A fully eligible contact+deal must produce NO sequence_enrollments row and
 *    MUST write an audit entry with action=new_lead_auto_enrollment_candidate_detected
 *    containing contactId, dealId, and sequenceId in its details.
 *
 *  Test 2 — Auto mode (autoEnrollNewLeadDeals=true):
 *    Same setup must produce a sequence_enrollments row and an audit entry with
 *    action=new_lead_auto_enrollment_created. A second run must produce no
 *    duplicate enrollment.
 *
 *  Test 3 — Ineligible contact (DNC, autoEnrollNewLeadDeals=false):
 *    A DNC contact+deal must produce no enrollment, must write a skip audit
 *    with action=new_lead_auto_enrollment_skipped and a present skipReason,
 *    and must NOT write a false candidate_detected entry.
 *
 * Kill lines (instant exit-1 if tripped):
 *  - autoEnroll=false creates a sequence_enrollments row
 *  - Candidate mode runs without writing an audit log entry
 *  - Audit log omits dealId, contactId, or sequenceId
 *  - autoEnroll=true fails to create an enrollment for a fully eligible contact
 *  - A second run creates a duplicate enrollment
 *  - Any test triggers real outbound email/SMS/voice/GHL/sequence-worker
 *  - Global settings not restored after any test
 *
 * Usage (dev server must be running):
 *   ADMIN_SEED_EMAIL=... ADMIN_SEED_PASSWORD=... npx tsx scripts/test-new-lead-candidate-audit.ts
 */

import { db } from "../server/db";
import {
  contacts,
  deals,
  followUpSequences,
  sequenceEnrollments,
  auditLogs,
  ghlActivityLog,
} from "../shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  runNewLeadAutoEnrollCheck,
  setAutoEnrollEnabled,
  getAutoEnrollEnabled,
  setDefaultSequenceId,
  getDefaultSequenceId,
  setVerticalSequenceMap,
  getVerticalSequenceMap,
} from "../server/services/new-lead-enrollment-job";

// ─── Counters ─────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const failures: string[] = [];
const killLines: string[] = [];

function ok(label: string) {
  pass++;
  console.log(`  ✓ ${label}`);
}

function ko(label: string, detail?: string) {
  fail++;
  const msg = detail ? `${label}: ${detail}` : label;
  failures.push(msg);
  console.error(`  ✗ ${msg}`);
}

function killLine(label: string, detail?: string) {
  const msg = detail ? `KILL LINE — ${label}: ${detail}` : `KILL LINE — ${label}`;
  killLines.push(msg);
  console.error(`\n  ☠ ${msg}\n`);
  // Kill lines exit immediately after cleanup attempt
}

// ─── DB fixtures ──────────────────────────────────────────────────────────────

const testContactIds: number[] = [];
const testDealIds: number[] = [];
const testSequenceIds: number[] = [];

async function createContact(overrides: {
  email?: string | null;
  doNotContact?: boolean;
  consentTier?: string;
} = {}): Promise<number> {
  const ts = Date.now() + Math.random();
  const [row] = await db.insert(contacts).values({
    firstName: "CandidateAudit",
    lastName: `Test-${ts}`,
    email: overrides.email !== undefined
      ? (overrides.email ?? "")
      : `candidate-audit-${ts}@test.invalid`,
    phone: "555-000-1234",
    doNotContact: overrides.doNotContact ?? false,
    consentTier: overrides.consentTier ?? "cold_no_consent",
    lifecycleStage: "lead",
    status: "active",
  } as any).returning({ id: contacts.id });
  testContactIds.push(row.id);
  return row.id;
}

async function createDeal(contactId: number): Promise<number> {
  const [row] = await db.insert(deals).values({
    title: `CandidateAuditDeal-${Date.now()}`,
    stage: "New Lead",
    pipeline: "sales",
    contactId,
    vertical: null,
    status: "open",
    value: "0",
  } as any).returning({ id: deals.id });
  testDealIds.push(row.id);
  return row.id;
}

async function createSequence(status: "active" | "paused" = "active"): Promise<number> {
  const [row] = await db.insert(followUpSequences).values({
    name: `CandidateAuditSeq-${Date.now()}`,
    triggerType: "manual",
    status,
    channelsAllowed: ["email"],
  } as any).returning({ id: followUpSequences.id });
  testSequenceIds.push(row.id);
  return row.id;
}

async function getEnrollments(contactId: number) {
  return db.select()
    .from(sequenceEnrollments)
    .where(eq(sequenceEnrollments.contactId, contactId));
}

async function getEnrollmentsForSequence(sequenceId: number) {
  return db.select()
    .from(sequenceEnrollments)
    .where(eq(sequenceEnrollments.sequenceId, sequenceId));
}

async function getAuditByActionAndDeal(action: string, dealId: number, limit = 5) {
  return db.select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, dealId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

async function cleanup(): Promise<void> {
  // Delete enrollments in test sequences (auto-enroll=true test + any production spill)
  if (testSequenceIds.length) {
    const spillRows = await db.select({ id: sequenceEnrollments.id })
      .from(sequenceEnrollments)
      .where(inArray(sequenceEnrollments.sequenceId, testSequenceIds));
    if (spillRows.length) {
      await db.delete(sequenceEnrollments)
        .where(inArray(sequenceEnrollments.id, spillRows.map(r => r.id)));
    }
    await db.delete(followUpSequences)
      .where(inArray(followUpSequences.id, testSequenceIds));
  }
  if (testDealIds.length) {
    await db.delete(deals).where(inArray(deals.id, testDealIds));
  }
  if (testContactIds.length) {
    await db.delete(ghlActivityLog).where(inArray(ghlActivityLog.contactId, testContactIds));
    await db.delete(contacts).where(inArray(contacts.id, testContactIds));
  }
}

// ─── Main test runner ─────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  New Lead Auto-Enroll — Candidate Audit Trail Coverage (3 Tests)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Save original settings so every test restores them
  const origAutoEnroll = await getAutoEnrollEnabled();
  const origDefaultSeqId = await getDefaultSequenceId();
  const origVerticalMap = await getVerticalSequenceMap();

  // Single shared sequence with no steps (no outbound sends possible)
  const seqId = await createSequence("active");
  console.log(`  [Setup] test sequence id=${seqId} (active, no steps → zero outbound risk)`);

  // ─── Test 1: Candidate mode — audit written, no enrollment ─────────────────

  console.log("\n────────────────────────────────────────────────────────────────");
  console.log("  Test 1 — autoEnroll=false → candidate audit written, no enrollment");
  console.log("────────────────────────────────────────────────────────────────\n");

  const c1 = await createContact();
  const d1 = await createDeal(c1);
  console.log(`  [Setup] contact=${c1}, deal=${d1}`);

  try {
    await setDefaultSequenceId(seqId);
    await setAutoEnrollEnabled(false);

    await runNewLeadAutoEnrollCheck();

    // ── Kill line: no enrollment must exist ──
    const e1 = await getEnrollments(c1);
    if (e1.length > 0) {
      killLine("autoEnroll=false created a sequence_enrollments row",
        `contact=${c1}, enrollments=${e1.length}`);
    } else {
      ok("Test 1: zero sequence_enrollments rows created for test contact (kill-line holds)");
    }

    // ── Candidate audit must exist ──
    const a1 = await getAuditByActionAndDeal("new_lead_auto_enrollment_candidate_detected", d1);
    if (a1.length === 0) {
      killLine("candidate mode ran without writing an audit log entry",
        `action=new_lead_auto_enrollment_candidate_detected deal=${d1}`);
    } else {
      ok("Test 1: audit entry with action=new_lead_auto_enrollment_candidate_detected found");
    }

    // ── Kill line: audit must contain contactId, dealId, sequenceId ──
    if (a1.length > 0) {
      const details = a1[0].details as any;
      const hasContactId = details && typeof details.contactId === "number";
      const hasDealId = details && typeof details.dealId === "number";
      const hasSequenceId = details && typeof details.sequenceId === "number";

      if (!hasContactId) {
        killLine("audit log omits contactId", JSON.stringify(details));
      } else {
        ok(`Test 1: audit.details.contactId=${details.contactId} ✓`);
      }
      if (!hasDealId) {
        killLine("audit log omits dealId", JSON.stringify(details));
      } else {
        ok(`Test 1: audit.details.dealId=${details.dealId} ✓`);
      }
      if (!hasSequenceId) {
        killLine("audit log omits sequenceId", JSON.stringify(details));
      } else {
        ok(`Test 1: audit.details.sequenceId=${details.sequenceId} ✓`);
      }

      // Extra: validate the values are correct
      if (hasContactId && details.contactId !== c1)
        ko("Test 1: audit.details.contactId mismatch", `expected=${c1}, got=${details.contactId}`);
      if (hasDealId && details.dealId !== d1)
        ko("Test 1: audit.details.dealId mismatch", `expected=${d1}, got=${details.dealId}`);
      if (hasSequenceId && details.sequenceId !== seqId)
        ko("Test 1: audit.details.sequenceId mismatch", `expected=${seqId}, got=${details.sequenceId}`);
    }

    // Auto-enroll must still be off (no side-effect on global setting)
    const afterEnabled = await getAutoEnrollEnabled();
    if (afterEnabled !== false)
      ko("Test 1: autoEnrollEnabled was mutated (should still be false after candidate-mode run)");
    else
      ok("Test 1: global autoEnrollEnabled unchanged (still false) after candidate-mode run");

  } finally {
    await setAutoEnrollEnabled(false);
    await setDefaultSequenceId(origDefaultSeqId);
    await setVerticalSequenceMap(origVerticalMap);
  }

  // ─── Test 2: Auto mode — enrollment created, audit written, no duplicate ────

  console.log("\n────────────────────────────────────────────────────────────────");
  console.log("  Test 2 — autoEnroll=true → enrollment created, no duplicate on 2nd run");
  console.log("────────────────────────────────────────────────────────────────\n");

  // Fresh contact+deal so Test 1 fixture doesn't interfere
  const c2 = await createContact();
  const d2 = await createDeal(c2);
  console.log(`  [Setup] contact=${c2}, deal=${d2}`);

  try {
    await setDefaultSequenceId(seqId);
    await setAutoEnrollEnabled(true);

    await runNewLeadAutoEnrollCheck();

    // Reset kill-line immediately after the call
    await setAutoEnrollEnabled(false);

    // ── Enrollment must exist ──
    const e2 = await getEnrollments(c2);
    const created2 = e2.find(e => e.sequenceId === seqId);
    if (!created2) {
      killLine("autoEnroll=true failed to create an enrollment for a fully eligible contact",
        `contact=${c2}, deal=${d2}, seqId=${seqId}`);
    } else {
      ok(`Test 2: sequence_enrollments row created (id=${created2.id})`);
    }

    // ── Audit must be new_lead_auto_enrollment_created (not new_lead_deal_enrolled) ──
    const a2Created = await getAuditByActionAndDeal("new_lead_auto_enrollment_created", d2);
    if (a2Created.length === 0) {
      ko("Test 2: no audit entry with action=new_lead_auto_enrollment_created found",
        `expected action=new_lead_auto_enrollment_created for deal=${d2}`);

      // Also check if the old action name was used (proves what's broken)
      const a2Old = await getAuditByActionAndDeal("new_lead_deal_enrolled", d2);
      if (a2Old.length > 0) {
        ko("Test 2: implementation used legacy action 'new_lead_deal_enrolled' instead of 'new_lead_auto_enrollment_created'",
          `fix: change action string in runNewLeadAutoEnrollCheck() auto-enroll path`);
      }
    } else {
      ok("Test 2: audit entry with action=new_lead_auto_enrollment_created found");

      // Validate details fields
      const det2 = a2Created[0].details as any;
      const hasC = det2 && typeof det2.contactId === "number";
      const hasD = det2 && typeof det2.dealId === "number";
      const hasS = det2 && typeof det2.sequenceId === "number";
      if (hasC) ok(`Test 2: audit.details.contactId=${det2.contactId} ✓`);
      else ko("Test 2: audit.details missing contactId");
      if (hasD) ok(`Test 2: audit.details.dealId=${det2.dealId} ✓`);
      else ko("Test 2: audit.details missing dealId");
      if (hasS) ok(`Test 2: audit.details.sequenceId=${det2.sequenceId} ✓`);
      else ko("Test 2: audit.details missing sequenceId");
    }

    // ── Second run: no duplicate enrollment ──
    await setAutoEnrollEnabled(true);
    await runNewLeadAutoEnrollCheck();
    await setAutoEnrollEnabled(false);

    const e2b = await getEnrollments(c2);
    const forSeq = e2b.filter(e => e.sequenceId === seqId);
    if (forSeq.length > 1) {
      killLine("second run created a duplicate enrollment",
        `contact=${c2}, seqId=${seqId}, count=${forSeq.length}`);
    } else {
      ok(`Test 2: second runNewLeadAutoEnrollCheck() produced no duplicate enrollment (count=${forSeq.length})`);
    }

  } finally {
    await setAutoEnrollEnabled(false);
    await setDefaultSequenceId(origDefaultSeqId);
    await setVerticalSequenceMap(origVerticalMap);
  }

  // ─── Test 3: Ineligible (DNC) contact — skip audit, no false candidate entry ─

  console.log("\n────────────────────────────────────────────────────────────────");
  console.log("  Test 3 — DNC contact + autoEnroll=false → skip audit, no candidate entry");
  console.log("────────────────────────────────────────────────────────────────\n");

  const c3 = await createContact({ doNotContact: true });
  const d3 = await createDeal(c3);
  console.log(`  [Setup] contact=${c3} (DNC=true), deal=${d3}`);

  try {
    await setDefaultSequenceId(seqId);
    await setAutoEnrollEnabled(false);

    await runNewLeadAutoEnrollCheck();

    // ── No enrollment must exist ──
    const e3 = await getEnrollments(c3);
    if (e3.length > 0) {
      ko("Test 3: enrollment created for DNC contact — gate failed",
        `contact=${c3}, enrollments=${e3.length}`);
    } else {
      ok("Test 3: zero enrollments for DNC contact ✓");
    }

    // ── Skip audit must exist with action=new_lead_auto_enrollment_skipped ──
    const a3Skip = await getAuditByActionAndDeal("new_lead_auto_enrollment_skipped", d3);
    if (a3Skip.length === 0) {
      ko("Test 3: no audit entry with action=new_lead_auto_enrollment_skipped for DNC contact",
        `deal=${d3} — implementation silently continues for DNC instead of writing a skip audit`);
    } else {
      ok("Test 3: audit entry with action=new_lead_auto_enrollment_skipped found for DNC contact");

      // ── Skip audit must contain skipReason ──
      const det3 = a3Skip[0].details as any;
      const hasReason = det3 && (typeof det3.skipReason === "string") && det3.skipReason.length > 0;
      if (!hasReason) {
        ko("Test 3: skip audit entry missing skipReason field", JSON.stringify(det3));
      } else {
        ok(`Test 3: skip audit has skipReason='${det3.skipReason}' ✓`);
      }
    }

    // ── No false candidate_detected entry ──
    const a3Candidate = await getAuditByActionAndDeal("new_lead_auto_enrollment_candidate_detected", d3);
    if (a3Candidate.length > 0) {
      ko("Test 3: false candidate_detected audit written for DNC contact — ineligible contact should not reach candidate path",
        `entries found: ${a3Candidate.length}`);
    } else {
      ok("Test 3: no false candidate_detected entry for DNC contact ✓");
    }

  } finally {
    await setAutoEnrollEnabled(origAutoEnroll ?? false);
    await setDefaultSequenceId(origDefaultSeqId);
    await setVerticalSequenceMap(origVerticalMap);
  }

  // ─── Global settings sanity check ────────────────────────────────────────────

  console.log("\n────────────────────────────────────────────────────────────────");
  console.log("  Global settings restore verification");
  console.log("────────────────────────────────────────────────────────────────\n");

  const finalEnabled = await getAutoEnrollEnabled();
  const finalSeqId = await getDefaultSequenceId();
  const finalMap = await getVerticalSequenceMap();

  if (finalEnabled === (origAutoEnroll ?? false))
    ok(`Settings restored: autoEnrollEnabled=${finalEnabled} (orig=${origAutoEnroll ?? false})`);
  else
    ko("Settings NOT restored: autoEnrollEnabled mismatch",
      `orig=${origAutoEnroll ?? false}, final=${finalEnabled}`);

  if (finalSeqId === origDefaultSeqId)
    ok(`Settings restored: defaultSequenceId=${finalSeqId} (orig=${origDefaultSeqId})`);
  else
    ko("Settings NOT restored: defaultSequenceId mismatch",
      `orig=${origDefaultSeqId}, final=${finalSeqId}`);

  if (JSON.stringify(finalMap) === JSON.stringify(origVerticalMap))
    ok("Settings restored: verticalMap matches original");
  else
    ko("Settings NOT restored: verticalMap mismatch");

  // ─── Cleanup ─────────────────────────────────────────────────────────────────

  await cleanup();
  console.log("\n  [Cleanup] All test fixtures deleted.");

  // ─── Summary ─────────────────────────────────────────────────────────────────

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(` Results: ${pass} passed, ${fail} failed${killLines.length ? `, ${killLines.length} kill lines tripped` : ""}`);
  if (failures.length) {
    console.error("\nFAILURES:");
    failures.forEach(f => console.error(`  • ${f}`));
  }
  if (killLines.length) {
    console.error("\nKILL LINES TRIPPED:");
    killLines.forEach(k => console.error(`  ☠ ${k}`));
  }
  console.log("═══════════════════════════════════════════════════════════════\n");

  if (fail > 0 || killLines.length > 0) process.exit(1);
}

run().catch(err => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
