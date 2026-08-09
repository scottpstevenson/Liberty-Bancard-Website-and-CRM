#!/usr/bin/env tsx
/**
 * test-statement-acquisition.ts
 *
 * Validates the full statement-chase automation loop:
 *
 *  1. "Statement Chase (Auto)" sequence exists in DB and is active
 *  2. Sequence has correct consent/eligibility metadata
 *  3. system_settings contains statement_acquisition_config with all 4 numeric keys
 *  4. syncStatementChaseSteps() writes config-derived delays to sequence step DB rows
 *  5. Custom cadence (e.g. sms=12h, rep=24h, edu=36h) produces correct DB step delays
 *  6. Transitioning to STATEMENT_REQUESTED creates an active enrollment within 5s,
 *     and the enrollment's sequence uses the synced step delays
 *  7. onStatementReceived() marks the enrollment "completed" and advances lifecycle
 *     to STATEMENT_RECEIVED
 *  8. onStatementAnalyzed() advances lifecycle to STATEMENT_ANALYZED
 *  9. checkStatementAcquisitionStalls() returns { escalated: number } without throwing
 * 10. validateAcquisitionConfig() rejects invalid values
 *
 * Run: npx tsx scripts/test-statement-acquisition.ts
 * Exits 0 if all pass, 1 if any fail.
 */

import { db, pool } from "../server/db";
import {
  contacts,
  deals,
  sequenceEnrollments,
  sequenceSteps,
  followUpSequences,
  contactLifecycleHistory,
} from "../shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { storage } from "../server/storage";
import {
  onStatementRequested,
  onStatementReceived,
  onStatementAnalyzed,
  checkStatementAcquisitionStalls,
  syncStatementChaseSteps,
  validateAcquisitionConfig,
  getAcquisitionConfig,
  DEFAULT_CONFIG,
  type AcquisitionConfig,
} from "../server/services/statement-acquisition";
import { LifecycleService } from "../server/services/lifecycle-service";

// ─── Bookkeeping ──────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const failures: string[] = [];
const testContactIds: number[] = [];
const testDealIds: number[] = [];

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
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) ok(label); else ko(label, detail);
}

// ─── Unique phone to avoid conflicts ─────────────────────────────────────────

let phoneCounter = 0;
function uniquePhone() {
  return `+1555${String(Date.now()).slice(-4)}${String(++phoneCounter).padStart(4, "0")}`;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function createTestContact(): Promise<number> {
  const phone = uniquePhone();
  const [row] = await db.insert(contacts).values({
    firstName: "StatementTest",
    lastName: "AcqUser",
    email: `stmt-acq-test-${Date.now()}-${phoneCounter}@test-internal.invalid`,
    phone,
    companyName: "Test Corp",
    lifecycleState: "APPOINTMENT_COMPLETED",
    consentSms: true,
    consentEmail: true,
  }).returning({ id: contacts.id });
  testContactIds.push(row.id);
  return row.id;
}

async function createTestDeal(contactId: number): Promise<number> {
  const deal = await storage.createDeal({
    contactId,
    pipeline: "sales",
    stage: "Appointment Completed",
  });
  testDealIds.push(deal.id);
  return deal.id;
}

async function getActiveEnrollmentsForContact(contactId: number) {
  return db.select()
    .from(sequenceEnrollments)
    .where(and(
      eq(sequenceEnrollments.contactId, contactId),
      inArray(sequenceEnrollments.status, ["active", "paused"]),
    ));
}

async function getChaseSequence() {
  const [seq] = await db
    .select()
    .from(followUpSequences)
    .where(eq(followUpSequences.name, "Statement Chase (Auto)"))
    .limit(1);
  return seq ?? null;
}

async function getChaseSteps(seqId: number) {
  const steps = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.sequenceId, seqId));
  steps.sort((a, b) => (a.stepOrder ?? 0) - (b.stepOrder ?? 0));
  return steps;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log("\n════════════════════════════════════════════════════════");
  console.log("  Statement Acquisition Automation — Pre-Deploy Gate");
  console.log("════════════════════════════════════════════════════════\n");

  // ── Test 1: Sequence exists, is active, and has eligibility metadata ────────
  console.log("── 1. Sequence presence + eligibility metadata ──────────");
  let seqId: number | null = null;
  try {
    const seq = await getChaseSequence();
    assert(
      '"Statement Chase (Auto)" sequence exists in DB',
      !!seq,
      "sequence missing — run seed-sequences or restart server to seed",
    );
    if (seq) {
      seqId = seq.id;
      assert('"Statement Chase (Auto)" is active', seq.status === "active", `status="${seq.status}"`);

      const steps = await getChaseSteps(seq.id);
      assert(
        '"Statement Chase (Auto)" has at least 4 steps',
        steps.length >= 4,
        `only ${steps.length} step(s) found`,
      );
      assert("Step 1 is email (upload link)", steps[0]?.actionType === "email");
      assert("Step 2 is SMS nudge", steps[1]?.actionType === "sms");
      assert("Step 3 is rep task", steps[2]?.actionType === "task");
      assert("Step 4 is educational email", steps[3]?.actionType === "email");
    }
  } catch (err: any) {
    ko("Sequence presence check threw", err.message);
  }

  // ── Test 2: system_settings cadence config ─────────────────────────────────
  console.log("\n── 2. system_settings cadence config ───────────────────");
  let originalConfig: AcquisitionConfig = DEFAULT_CONFIG;
  try {
    const cfg = await storage.getSystemSetting("statement_acquisition_config");
    assert(
      "statement_acquisition_config exists in system_settings",
      cfg !== null && cfg !== undefined,
      "not found — restart server to seed",
    );
    if (cfg && typeof cfg === "object") {
      const c = cfg as Record<string, unknown>;
      assert("upload_nudge_sms_hours is a finite number ≥1", typeof c.upload_nudge_sms_hours === "number" && Number.isFinite(c.upload_nudge_sms_hours) && (c.upload_nudge_sms_hours as number) >= 1);
      assert("rep_task_hours is a finite number", typeof c.rep_task_hours === "number" && Number.isFinite(c.rep_task_hours));
      assert("educational_email_hours is a finite number", typeof c.educational_email_hours === "number" && Number.isFinite(c.educational_email_hours));
      assert("stall_escalation_days is a finite number", typeof c.stall_escalation_days === "number" && Number.isFinite(c.stall_escalation_days));
      originalConfig = await getAcquisitionConfig();
    }
  } catch (err: any) {
    ko("system_settings cadence config check threw", err.message);
  }

  // ── Test 3: validateAcquisitionConfig rejects invalid values ──────────────
  console.log("\n── 3. validateAcquisitionConfig() rejects bad values ───");
  const badCases: Array<[string, Partial<AcquisitionConfig>]> = [
    ["sms_hours < 1",          { upload_nudge_sms_hours: 0, rep_task_hours: 48, educational_email_hours: 72, stall_escalation_days: 5 }],
    ["rep ≤ sms",              { upload_nudge_sms_hours: 24, rep_task_hours: 24, educational_email_hours: 72, stall_escalation_days: 5 }],
    ["edu ≤ rep",              { upload_nudge_sms_hours: 24, rep_task_hours: 48, educational_email_hours: 48, stall_escalation_days: 5 }],
    ["NaN value",              { upload_nudge_sms_hours: NaN, rep_task_hours: 48, educational_email_hours: 72, stall_escalation_days: 5 }],
    ["Infinity",               { upload_nudge_sms_hours: Infinity, rep_task_hours: 48, educational_email_hours: 72, stall_escalation_days: 5 }],
    ["fractional sms_hours",   { upload_nudge_sms_hours: 12.5, rep_task_hours: 48, educational_email_hours: 72, stall_escalation_days: 5 }],
    ["fractional rep_hours",   { upload_nudge_sms_hours: 24, rep_task_hours: 48.5, educational_email_hours: 72, stall_escalation_days: 5 }],
  ];
  for (const [label, cfg] of badCases) {
    try {
      validateAcquisitionConfig(cfg);
      ko(`validateAcquisitionConfig rejects ${label}`, "expected to throw but did not");
    } catch {
      ok(`validateAcquisitionConfig rejects ${label}`);
    }
  }
  try {
    const good = validateAcquisitionConfig(DEFAULT_CONFIG);
    assert("validateAcquisitionConfig accepts valid defaults", good.upload_nudge_sms_hours === 24);
  } catch (err: any) {
    ko("validateAcquisitionConfig rejects valid defaults", err.message);
  }

  // ── Test 4: syncStatementChaseSteps writes config-derived delays to DB ─────
  console.log("\n── 4. Custom cadence → DB step delays ──────────────────");
  const customConfig: AcquisitionConfig = {
    upload_nudge_sms_hours: 12,
    rep_task_hours: 36,
    educational_email_hours: 60,
    stall_escalation_days: 3,
  };
  if (seqId !== null) {
    try {
      await syncStatementChaseSteps(customConfig);
      const steps = await getChaseSteps(seqId);

      // Step 1: 0/0
      assert("Step 1 delay = 0d 0h (immediate)", steps[0]?.delayDays === 0 && steps[0]?.delayHours === 0, `got ${steps[0]?.delayDays}d ${steps[0]?.delayHours}h`);

      // Step 2: SMS at 12h → 0d 12h relative to step 1
      const smsDelayHrs = customConfig.upload_nudge_sms_hours; // 12
      const expectedSmsD = Math.floor(smsDelayHrs / 24); // 0
      const expectedSmsH = smsDelayHrs % 24; // 12
      assert(
        `Step 2 delay = ${expectedSmsD}d ${expectedSmsH}h (SMS at ${smsDelayHrs}h from enrollment)`,
        steps[1]?.delayDays === expectedSmsD && steps[1]?.delayHours === expectedSmsH,
        `got ${steps[1]?.delayDays}d ${steps[1]?.delayHours}h`,
      );

      // Step 3: rep task at 36h, relative to step2 = 36-12=24h → 1d 0h
      const repRelHrs = customConfig.rep_task_hours - customConfig.upload_nudge_sms_hours; // 24
      const expectedRepD = Math.floor(repRelHrs / 24); // 1
      const expectedRepH = repRelHrs % 24; // 0
      assert(
        `Step 3 delay = ${expectedRepD}d ${expectedRepH}h (rep task ${repRelHrs}h after SMS)`,
        steps[2]?.delayDays === expectedRepD && steps[2]?.delayHours === expectedRepH,
        `got ${steps[2]?.delayDays}d ${steps[2]?.delayHours}h`,
      );

      // Step 4: edu email at 60h, relative to step3 = 60-36=24h → 1d 0h
      const eduRelHrs = customConfig.educational_email_hours - customConfig.rep_task_hours; // 24
      const expectedEduD = Math.floor(eduRelHrs / 24); // 1
      const expectedEduH = eduRelHrs % 24; // 0
      assert(
        `Step 4 delay = ${expectedEduD}d ${expectedEduH}h (edu email ${eduRelHrs}h after rep task)`,
        steps[3]?.delayDays === expectedEduD && steps[3]?.delayHours === expectedEduH,
        `got ${steps[3]?.delayDays}d ${steps[3]?.delayHours}h`,
      );

    } catch (err: any) {
      ko("Custom cadence sync threw", err.message);
    }

    // Restore default delays before enrollment test
    try {
      await syncStatementChaseSteps(originalConfig);
      ok("Restored original step delays after cadence test");
    } catch (err: any) {
      ko("Could not restore original step delays", err.message);
    }
  } else {
    ko("Custom cadence test — skipped (sequence not found)");
    ko("Step delay assertions — skipped");
    ko("Step delay assertions — skipped");
    ko("Step delay assertions — skipped");
    ko("Step delay assertions — skipped");
    ko("Restore original delays — skipped");
  }

  // ── Test 5: Consent/eligibility metadata — seed file and DB row ──────────
  console.log("\n── 5. Sequence eligibility metadata ────────────────────");

  // 5a: seed file carries the metadata (does not require a DB call)
  try {
    const seedData = await import("../server/data/seeds/sequences.json", { assert: { type: "json" } });
    const seedSeq = (seedData.default as any[]).find((s: any) => s.name === "Statement Chase (Auto)");
    assert(
      "Seed file: eligibleConsentTiers present",
      Array.isArray(seedSeq?.eligibleConsentTiers) && seedSeq.eligibleConsentTiers.length > 0,
      `got ${JSON.stringify(seedSeq?.eligibleConsentTiers)}`,
    );
    assert(
      "Seed file: channelsAllowed present",
      Array.isArray(seedSeq?.channelsAllowed) && seedSeq.channelsAllowed.length > 0,
      `got ${JSON.stringify(seedSeq?.channelsAllowed)}`,
    );
    assert(
      "Seed file: lifecycleStagesAllowed includes STATEMENT_REQUESTED",
      Array.isArray(seedSeq?.lifecycleStagesAllowed) && seedSeq.lifecycleStagesAllowed.includes("STATEMENT_REQUESTED"),
      `got ${JSON.stringify(seedSeq?.lifecycleStagesAllowed)}`,
    );
    assert(
      "Seed file: sequenceFamily = statement_acquisition",
      seedSeq?.sequenceFamily === "statement_acquisition",
      `got "${seedSeq?.sequenceFamily}"`,
    );
  } catch (err: any) {
    ko("Seed metadata check threw", err.message);
  }

  // 5b: DB row reflects the metadata (set by syncStatementChaseSteps called in test 4)
  if (seqId !== null) {
    try {
      const [seq] = await db.select().from(followUpSequences).where(eq(followUpSequences.id, seqId)).limit(1);
      assert(
        "DB: eligibleConsentTiers is set",
        Array.isArray(seq?.eligibleConsentTiers) && (seq?.eligibleConsentTiers?.length ?? 0) > 0,
        `got ${JSON.stringify(seq?.eligibleConsentTiers)}`,
      );
      assert(
        "DB: channelsAllowed includes email + sms",
        Array.isArray(seq?.channelsAllowed) &&
          (seq?.channelsAllowed ?? []).includes("email") &&
          (seq?.channelsAllowed ?? []).includes("sms"),
        `got ${JSON.stringify(seq?.channelsAllowed)}`,
      );
      assert(
        "DB: lifecycleStagesAllowed includes STATEMENT_REQUESTED",
        Array.isArray(seq?.lifecycleStagesAllowed) && (seq?.lifecycleStagesAllowed ?? []).includes("STATEMENT_REQUESTED"),
        `got ${JSON.stringify(seq?.lifecycleStagesAllowed)}`,
      );
    } catch (err: any) {
      ko("DB metadata check threw", err.message);
    }
  } else {
    ko("DB eligibility metadata check — skipped (sequence not found)");
  }

  // ── Test 6: STATEMENT_REQUESTED → active enrollment within 5s ─────────────
  console.log("\n── 6. STATEMENT_REQUESTED → sequence enrollment ────────");
  let testContactId: number | null = null;
  let testDealId: number | null = null;
  try {
    testContactId = await createTestContact();
    testDealId = await createTestDeal(testContactId);

    await LifecycleService.transition(testContactId, "STATEMENT_REQUESTED", {
      trigger: "test_harness",
      actorType: "system",
    });

    // onStatementRequested fires fire-and-forget — wait up to 5 seconds
    let enrollments: any[] = [];
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      enrollments = await getActiveEnrollmentsForContact(testContactId);
      if (enrollments.length > 0) break;
      await new Promise(r => setTimeout(r, 200));
    }

    assert(
      "Active sequence enrollment created within 5s of STATEMENT_REQUESTED",
      enrollments.length > 0,
      `0 active enrollments found after waiting 5s for contact ${testContactId}`,
    );

    if (enrollments.length > 0 && seqId !== null) {
      // Verify enrollment cadenceConfig metadata matches original config
      const meta = (enrollments[0].metadata ?? {}) as Record<string, any>;
      assert(
        "Enrollment metadata contains cadenceConfig",
        !!meta.cadenceConfig,
        `metadata: ${JSON.stringify(meta)}`,
      );
      if (meta.cadenceConfig) {
        assert(
          "cadenceConfig.upload_nudge_sms_hours matches live config",
          meta.cadenceConfig.upload_nudge_sms_hours === originalConfig.upload_nudge_sms_hours,
          `got ${meta.cadenceConfig.upload_nudge_sms_hours}, expected ${originalConfig.upload_nudge_sms_hours}`,
        );
      }

      // Verify the step delays now match the restored original config
      const steps = await getChaseSteps(seqId);
      const expectedSmsD = Math.floor(originalConfig.upload_nudge_sms_hours / 24);
      const expectedSmsH = originalConfig.upload_nudge_sms_hours % 24;
      assert(
        `Step 2 delay matches live config (${originalConfig.upload_nudge_sms_hours}h SMS)`,
        steps[1]?.delayDays === expectedSmsD && steps[1]?.delayHours === expectedSmsH,
        `got ${steps[1]?.delayDays}d ${steps[1]?.delayHours}h, expected ${expectedSmsD}d ${expectedSmsH}h`,
      );
    }

    // ── Test 7: Statement received → enrollment stopped + deal advanced ───
    console.log("\n── 7. Statement received → stopped + deal advanced ─────");
    if (enrollments.length > 0) {
      await onStatementReceived(testContactId, testDealId ?? undefined);

      const completed = await db
        .select()
        .from(sequenceEnrollments)
        .where(and(
          eq(sequenceEnrollments.contactId, testContactId),
          eq(sequenceEnrollments.status, "completed"),
        ));
      assert("Statement-chase enrollment marked completed", completed.length > 0, "no completed enrollment found");

      const stillActive = await getActiveEnrollmentsForContact(testContactId);
      assert("No active statement-chase enrollment remains", stillActive.length === 0, `${stillActive.length} still active`);

      const contactRow = await storage.getContact(testContactId);
      const validState = ["STATEMENT_RECEIVED", "STATEMENT_ANALYZED"].includes(contactRow?.lifecycleState ?? "");
      assert("Lifecycle is STATEMENT_RECEIVED (or further) after upload", validState, `lifecycle="${contactRow?.lifecycleState}"`);

      // Deal stage must advance so the stall worker (queries by stage "Statement Requested") cannot pick it up
      if (testDealId !== null) {
        const updatedDeal = await storage.getDeal(testDealId);
        assert(
          "Deal stage advanced out of 'Statement Requested' after upload",
          updatedDeal?.stage !== "Statement Requested",
          `deal stage is still "${updatedDeal?.stage}" — stall worker will keep escalating`,
        );
      }

      // Prove: checkStatementAcquisitionStalls does NOT escalate this deal now that the stage is no longer "Statement Requested"
      const stallBefore = await checkStatementAcquisitionStalls(0 /* 0 days = any age */);
      const auditRows = await storage.getAuditLogs({ entityType: "deal", entityId: testDealId!, limit: 20 }).catch(() => [] as any[]);
      const stalled = auditRows.some((l: any) => l.action === "statement_stall_escalated");
      assert(
        "Deal is NOT stall-escalated after statement received (even with 0-day threshold)",
        !stalled,
        `stall_escalated audit found for deal ${testDealId} — deal stage may still be 'Statement Requested'`,
      );
    } else {
      ko("onStatementReceived test — skipped (no enrollment found)");
      ko("No active enrollment after upload — skipped");
      ko("Lifecycle STATEMENT_RECEIVED — skipped");
      ko("Deal stage advancement — skipped");
      ko("No stall-escalation after upload — skipped");
    }

    // ── Test 8: onStatementAnalyzed → STATEMENT_ANALYZED ──────────────────
    console.log("\n── 8. onStatementAnalyzed → STATEMENT_ANALYZED ─────────");
    await onStatementAnalyzed(testContactId, testDealId!);
    const final = await storage.getContact(testContactId);
    assert(
      "Lifecycle is STATEMENT_ANALYZED after analysis",
      final?.lifecycleState === "STATEMENT_ANALYZED",
      `lifecycle="${final?.lifecycleState}"`,
    );

  } catch (err: any) {
    ko("Enrollment/lifecycle flow threw", err.message);
  }

  // ── Test 9: Stall check does not throw ────────────────────────────────────
  console.log("\n── 9. Stall escalation check (no-throw) ────────────────");
  try {
    const result = await checkStatementAcquisitionStalls();
    assert("checkStatementAcquisitionStalls returns { escalated: number }", typeof result?.escalated === "number", JSON.stringify(result));
    ok(`Stall check clean — ${result.escalated} escalation(s) this run`);
  } catch (err: any) {
    ko("checkStatementAcquisitionStalls threw", err.message);
  }

  // ── Test 10: Admin GET/PUT /api/admin/settings/statement-acquisition-config ─
  // Tests the service layer directly (not via HTTP) to avoid importing server/index
  // which would try to listen on port 5000 and crash with EADDRINUSE when the
  // dev server is already running (e.g. during the pre-deploy gate).
  console.log("\n── 10. Admin config API ─────────────────────────────────");
  try {
    {
      // Always use the direct service approach — avoids server startup collision
      const { getAcquisitionConfig, validateAcquisitionConfig, syncStatementChaseSteps: _sync } =
        await import("../server/services/statement-acquisition");

      // Simulate GET: config is readable
      const currentCfg = await getAcquisitionConfig();
      assert(
        "Admin GET: getAcquisitionConfig() returns a valid config",
        typeof currentCfg.upload_nudge_sms_hours === "number",
        JSON.stringify(currentCfg),
      );

      // Simulate PUT validation path: bad payload is rejected
      try {
        validateAcquisitionConfig({ upload_nudge_sms_hours: 0.5, rep_task_hours: 48, educational_email_hours: 72, stall_escalation_days: 5 });
        ko("Admin PUT validation: fractional hours rejected by validateAcquisitionConfig", "expected throw");
      } catch {
        ok("Admin PUT validation: fractional hours correctly rejected");
      }

      // Simulate PUT happy path: valid payload is saved and syncs steps
      const testCfg = { upload_nudge_sms_hours: 18, rep_task_hours: 42, educational_email_hours: 66, stall_escalation_days: 7 };
      const validated = validateAcquisitionConfig(testCfg);
      await storage.setSystemSetting("statement_acquisition_config", validated);
      await _sync(validated);

      // Verify the steps were updated
      const seq = await getChaseSequence();
      if (seq) {
        const updatedSteps = await getChaseSteps(seq.id);
        const expectedSmsH = 18 % 24; // 18
        const expectedSmsD = Math.floor(18 / 24); // 0
        assert(
          "Admin PUT: step 2 delay reflects updated config (18h SMS)",
          updatedSteps[1]?.delayDays === expectedSmsD && updatedSteps[1]?.delayHours === expectedSmsH,
          `got ${updatedSteps[1]?.delayDays}d ${updatedSteps[1]?.delayHours}h`,
        );
      } else {
        ko("Admin PUT step sync check — skipped (sequence not found)");
      }

      // Restore to original config
      await storage.setSystemSetting("statement_acquisition_config", originalConfig);
      await _sync(originalConfig).catch(() => {});
      ok("Admin PUT: config restored to original after test");
    }
  } catch (err: any) {
    ko("Admin config API test threw", err.message);
  }

  // ── Test 11: Race — upload advances deal before enrollment handler writes ──
  // Simulates: upload chain sets deal to "Statement Received" concurrently while
  // onStatementRequested is in flight (after its initial deal read but before
  // it would write "Statement Requested"). The handler must NOT overwrite the
  // deal stage back to "Statement Requested".
  console.log("\n── 11. Race: deal advanced before enrollment handler writes ─");
  try {
    const raceContactId = await createTestContact();
    testContactIds.push(raceContactId);

    // Create a deal already at "Statement Received" — simulating the concurrent upload
    const raceDeal = await storage.createDeal({
      contactId: raceContactId,
      pipeline: "sales",
      stage: "Statement Received",
    });
    testDealIds.push(raceDeal.id);

    // Advance contact lifecycle past STATEMENT_REQUESTED (simulating upload having
    // already advanced it before onStatementRequested re-reads)
    await db.update(contacts)
      .set({ lifecycleState: "STATEMENT_RECEIVED" })
      .where(eq(contacts.id, raceContactId));

    // Now call onStatementRequested — this is what the fire-and-forget would do
    await onStatementRequested(raceContactId);

    // Enrollment must be skipped
    const enrollmentsAfterRace = await getActiveEnrollmentsForContact(raceContactId);
    assert(
      "Race: no enrollment created when lifecycle already past STATEMENT_REQUESTED",
      enrollmentsAfterRace.length === 0,
      `${enrollmentsAfterRace.length} active enrollment(s) found — handler did not respect advanced lifecycle`,
    );

    // Critically: deal stage must not be regressed to "Statement Requested"
    const dealAfterRace = await storage.getDeal(raceDeal.id);
    assert(
      "Race: deal stage 'Statement Received' not overwritten by onStatementRequested",
      dealAfterRace?.stage !== "Statement Requested",
      `deal stage regressed to "${dealAfterRace?.stage}" — race condition allowed stale write`,
    );

    // Stall worker must not escalate this deal (stage is no longer "Statement Requested")
    await checkStatementAcquisitionStalls(0);
    const raceAudit = await storage.getAuditLogs({ entityType: "deal", entityId: raceDeal.id, limit: 10 }).catch(() => [] as any[]);
    const raceStalled = raceAudit.some((l: any) => l.action === "statement_stall_escalated");
    assert(
      "Race: deal not stall-escalated after upload raced the enrollment handler",
      !raceStalled,
      `stall_escalated audit found for deal ${raceDeal.id}`,
    );
  } catch (err: any) {
    ko("Race test threw", err.message);
  }

  // ── Test 12: Re-upload against progressed deal must not regress stage ───────
  // Simulates: a deal is at "Proposal Sent" (past statement receipt). A late or
  // duplicate upload fires onStatementReceived — the deal stage must NOT go back
  // to "Statement Received".
  console.log("\n── 12. Re-upload: closed deal stage not regressed ───────");
  try {
    const regressionContactId = await createTestContact();
    testContactIds.push(regressionContactId);
    const regressionDeal = await storage.createDeal({
      contactId: regressionContactId,
      pipeline: "sales",
      stage: "Proposal Sent",  // already past statement receipt
    });
    testDealIds.push(regressionDeal.id);

    await onStatementReceived(regressionContactId, regressionDeal.id);

    const dealAfter = await storage.getDeal(regressionDeal.id);
    assert(
      "Re-upload: 'Proposal Sent' deal stage not regressed to 'Statement Received'",
      dealAfter?.stage === "Proposal Sent",
      `deal stage is now "${dealAfter?.stage}" — upload regression occurred`,
    );

    // Also test with a Closed Won deal
    const closedDeal = await storage.createDeal({
      contactId: regressionContactId,
      pipeline: "sales",
      stage: "Closed Won",
    });
    testDealIds.push(closedDeal.id);

    await onStatementReceived(regressionContactId, closedDeal.id);

    const closedAfter = await storage.getDeal(closedDeal.id);
    assert(
      "Re-upload: 'Closed Won' deal stage not regressed",
      closedAfter?.stage === "Closed Won",
      `deal stage is now "${closedAfter?.stage}" — upload regression occurred on closed deal`,
    );
  } catch (err: any) {
    ko("Regression test threw", err.message);
  }

  // ── Test 13: runStatementUploadChain() stops the chase (integration) ───────
  // Proves that ALL upload entry points (dashboard, merchant portal, public)
  // reliably stop the statement-chase enrollment because the chain itself
  // calls onStatementReceived() in STEP 5b, not just the public route.
  console.log("\n── 13. Upload chain integration → chase stopped ─────────");
  let chainContactId: number | null = null;
  let chainDealId: number | null = null;
  try {
    const { runStatementUploadChain } = await import("../server/services/statement-upload-chain");

    chainContactId = await createTestContact();
    // Enroll the contact in the statement-chase sequence
    await LifecycleService.transition(chainContactId, "STATEMENT_REQUESTED", {
      trigger: "test_harness",
      actorType: "system",
    });

    // Wait for onStatementRequested to fire (fire-and-forget from LifecycleService)
    let preChainEnrollments: any[] = [];
    const enrollDeadline = Date.now() + 5000;
    while (Date.now() < enrollDeadline) {
      preChainEnrollments = await getActiveEnrollmentsForContact(chainContactId);
      if (preChainEnrollments.length > 0) break;
      await new Promise(r => setTimeout(r, 200));
    }
    assert(
      "Chain test: contact enrolled before upload",
      preChainEnrollments.length > 0,
      `no active enrollment found for contact ${chainContactId} before chain run`,
    );

    // Run the upload chain without a file buffer (skips disk I/O and AI) —
    // enough to exercise STEP 3 (deal creation) and STEP 5b (onStatementReceived)
    const chainResult = await runStatementUploadChain({
      contactId: chainContactId,
      dealId: null,
      fileBuffer: null as any,
      fileName: null as any,
      source: "dashboard" as any,
      businessName: "Chain Test Corp",
    });

    // Record the deal created by the chain for cleanup
    const chainDealStep = chainResult.steps.find((s: any) => s.step === 3 && s.success);
    if (chainDealStep?.data?.dealId) {
      chainDealId = chainDealStep.data.dealId;
      testDealIds.push(chainDealId);
    }

    // Give onStatementReceived (fire-and-forget inside chain) time to complete
    let postChainEnrollments: any[] = [];
    const stopDeadline = Date.now() + 5000;
    while (Date.now() < stopDeadline) {
      postChainEnrollments = await getActiveEnrollmentsForContact(chainContactId);
      if (postChainEnrollments.length === 0) break;
      await new Promise(r => setTimeout(r, 300));
    }

    assert(
      "Chain test: chase enrollment stopped after runStatementUploadChain()",
      postChainEnrollments.length === 0,
      `${postChainEnrollments.length} active enrollment(s) still present after chain completed`,
    );

    const chainContact = await storage.getContact(chainContactId);
    const chainValidState = ["STATEMENT_RECEIVED", "STATEMENT_ANALYZED"].includes(chainContact?.lifecycleState ?? "");
    assert(
      "Chain test: lifecycle advanced to STATEMENT_RECEIVED (or further) by chain",
      chainValidState,
      `lifecycle="${chainContact?.lifecycleState}"`,
    );
  } catch (err: any) {
    ko("Upload chain integration test threw", err.message);
  } finally {
    if (chainContactId !== null) testContactIds.push(chainContactId);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  console.log("\n── Cleanup ─────────────────────────────────────────────");
  try {
    if (testContactIds.length) {
      await db.delete(sequenceEnrollments).where(inArray(sequenceEnrollments.contactId, testContactIds)).catch(() => {});
      await db.delete(contactLifecycleHistory).where(inArray(contactLifecycleHistory.contactId, testContactIds)).catch(() => {});
      if (testDealIds.length) {
        await db.delete(deals).where(inArray(deals.id, testDealIds)).catch(() => {});
      }
      await db.delete(contacts).where(inArray(contacts.id, testContactIds)).catch(() => {});
    }
    console.log("  ✓ Test data cleaned up");
  } catch (err: any) {
    console.warn("  ⚠ Cleanup error (non-fatal):", err.message);
  }

  // ── Results ────────────────────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════════════════════");
  console.log(`  Results: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.error("\n  Failures:");
    failures.forEach(f => console.error(`    • ${f}`));
  }
  console.log("════════════════════════════════════════════════════════\n");

  await pool.end().catch(() => {});
  process.exit(fail > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error("Fatal error:", err);
  pool.end().catch(() => {});
  process.exit(1);
});
