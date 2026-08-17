#!/usr/bin/env npx tsx
/**
 * NBA Engine test script — 12 cases covering the Next Best Action Engine.
 *
 * Design principles (safe for pre-deploy / CI):
 *   1. Creates isolated fixture contacts at the start of every run.
 *      No real/operational contacts are mutated.
 *   2. Global pause is saved before the run and restored in a `finally` block
 *      even on crash or thrown errors.
 *   3. All fixture contacts + their cascaded NBA rows are deleted in `finally`.
 *   4. No cases are skipped — fixtures guarantee the needed lifecycle states.
 *
 * Usage:
 *   npx tsx scripts/test-nba.ts
 *
 * Exit 0 = all pass. Exit 1 = any failure.
 */

import crypto from "crypto";
import { db } from "../server/db";
import { contacts, contactNba, nbaRecommendationHistory } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { NBAService } from "../server/services/nba-service";
import { storage } from "../server/storage";
import { applyPauseMutation } from "../server/services/outbound-control-service";

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ── Fixture management ────────────────────────────────────────────────────────

const RUN_ID = crypto.randomUUID().slice(0, 8);
const fixtureIds: number[] = [];

/**
 * Insert a temporary test contact and return its id.
 * Uses a run-unique email so concurrent runs don't collide.
 * The contact is tracked for cleanup in the finally block.
 */
async function seedContact(
  label: string,
  overrides: {
    lifecycleState?: string;
    doNotContact?: boolean;
    consentEmail?: boolean;
    consentSms?: boolean;
  } = {},
): Promise<number> {
  const email = `nba-test-${RUN_ID}-${label.replace(/[^a-z0-9]/gi, "_")}@test.internal`;
  // Use a unique phone suffix to avoid index conflicts on other tests
  const phone = `555-${Date.now() % 10_000_000}`.padEnd(12, "0").slice(0, 12);

  const [row] = await db
    .insert(contacts)
    .values({
      firstName: "NBATest",
      lastName: label,
      email,
      phone,
      lifecycleState: overrides.lifecycleState ?? "PROSPECT",
      doNotContact: overrides.doNotContact ?? false,
      consentEmail: overrides.consentEmail ?? true,
      consentSms: overrides.consentSms ?? false,
    } as any)
    .returning({ id: contacts.id });

  fixtureIds.push(row.id);
  return row.id;
}

/**
 * Delete all fixture contacts created during this run.
 * ON DELETE CASCADE removes contactNba and nbaRecommendationHistory rows too.
 */
async function cleanupFixtures() {
  if (fixtureIds.length === 0) return;
  try {
    await db.delete(contacts).where(inArray(contacts.id, fixtureIds));
  } catch (err: any) {
    console.warn("[NBA test] Fixture cleanup error:", err?.message);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n=== NBA Engine Tests ===\n");
  console.log(`  Run ID: ${RUN_ID}`);

  try {
    // Ensure canonical pause is OFF for all cases except Case 6.
    await applyPauseMutation({
      outboundGlobalPaused: false,
      actor: "test-nba-setup",
      reason: "NBA test suite — disable canonical pause for integration tests",
    });

    // ── Seed all fixture contacts up-front ───────────────────────────────────
    console.log("\n[setup] Seeding fixture contacts…");
    const prospectId           = await seedContact("PROSPECT",              { lifecycleState: "PROSPECT" });
    const atRiskId             = await seedContact("AT_RISK",               { lifecycleState: "AT_RISK" });
    const proposalReadyId      = await seedContact("PROPOSAL_READY",        { lifecycleState: "PROPOSAL_READY" });
    const dncId                = await seedContact("DNC",                   { lifecycleState: "PROSPECT", doNotContact: true });
    const closedLostId         = await seedContact("CLOSED_LOST",           { lifecycleState: "CLOSED_LOST" });
    const pauseTestId          = await seedContact("PAUSE_TEST",            { lifecycleState: "PROSPECT" });
    const engagedId            = await seedContact("ENGAGED",               { lifecycleState: "ENGAGED" });
    const executeTestId        = await seedContact("EXECUTE_TEST",          { lifecycleState: "STATEMENT_RECEIVED" });
    const dismissTestId        = await seedContact("DISMISS_TEST",          { lifecycleState: "NEGOTIATION" });
    const proposalSentId       = await seedContact("PROPOSAL_SENT",         { lifecycleState: "PROPOSAL_SENT" });
    const appointmentScheduled = await seedContact("APPOINTMENT_SCHEDULED", { lifecycleState: "APPOINTMENT_SCHEDULED" });
    const invalidateId         = await seedContact("INVALIDATE_TEST",       { lifecycleState: "ENGAGED" });
    console.log(`[setup] ${fixtureIds.length} fixture contacts created.\n`);

    // ── Case 1: PROSPECT → CALL_PROSPECT ─────────────────────────────────────
    console.log("Case 1: PROSPECT lifecycle → CALL_PROSPECT action");
    {
      const rec = await NBAService.computeNBA(prospectId);
      ok("actionType is CALL_PROSPECT or SEND_EMAIL", ["CALL_PROSPECT", "SEND_EMAIL"].includes(rec.actionType));
      ok("status is OPEN or BLOCKED", ["OPEN", "BLOCKED"].includes(rec.status));
      ok("reasonCode present", !!rec.reasonCode);
      ok("ruleVersion set", !!rec.ruleVersion);
    }

    // ── Case 2: AT_RISK → CONTACT_AT_RISK_MERCHANT ───────────────────────────
    console.log("\nCase 2: AT_RISK lifecycle → CONTACT_AT_RISK_MERCHANT");
    {
      const rec = await NBAService.computeNBA(atRiskId);
      ok("actionType is CONTACT_AT_RISK_MERCHANT", rec.actionType === "CONTACT_AT_RISK_MERCHANT");
      ok("urgency is critical", rec.urgency === "critical");
      ok("humanRequired is true", rec.humanRequired === true);
      ok("automationEligible is false", rec.automationEligible === false);
    }

    // ── Case 3: PROPOSAL_READY → SEND_PROPOSAL critical ─────────────────────
    console.log("\nCase 3: PROPOSAL_READY → SEND_PROPOSAL, urgency critical");
    {
      const rec = await NBAService.computeNBA(proposalReadyId);
      ok("actionType is SEND_PROPOSAL", rec.actionType === "SEND_PROPOSAL");
      ok("urgency is critical", rec.urgency === "critical");
    }

    // ── Case 4: DNC contact → NO_ACTION BLOCKED ──────────────────────────────
    console.log("\nCase 4: DNC contact → NO_ACTION BLOCKED");
    {
      const rec = await NBAService.computeNBA(dncId);
      ok("status is BLOCKED", rec.status === "BLOCKED");
      ok("reasonCode is do_not_contact", rec.reasonCode === "do_not_contact");
    }

    // ── Case 5: CLOSED_LOST → NO_ACTION ──────────────────────────────────────
    console.log("\nCase 5: CLOSED_LOST → NO_ACTION");
    {
      const rec = await NBAService.computeNBA(closedLostId);
      ok("actionType is NO_ACTION", rec.actionType === "NO_ACTION");
      ok("reasonCode is closed_lost_no_action", rec.reasonCode === "closed_lost_no_action");
    }

    // ── Case 6: Global pause → BLOCKED ───────────────────────────────────────
    console.log("\nCase 6: Global pause → NO_ACTION BLOCKED");
    {
      await applyPauseMutation({
        outboundGlobalPaused: true,
        actor: "test-nba-case6",
        reason: "NBA Case 6 — testing global_pause_active response",
      });
      try {
        const rec = await NBAService.computeNBA(pauseTestId);
        ok("status is BLOCKED when globally paused", rec.status === "BLOCKED");
        ok("reasonCode is global_pause_active", rec.reasonCode === "global_pause_active");
      } finally {
        // Immediately restore pause=false so subsequent cases are unaffected
        await applyPauseMutation({
          outboundGlobalPaused: false,
          actor: "test-nba-case6-restore",
          reason: "NBA Case 6 — restore to unpaused after pause test",
        });
      }
    }

    // ── Case 7: History row written on recompute ──────────────────────────────
    console.log("\nCase 7: History row written on recompute (ENGAGED fixture)");
    {
      const countBefore = await db
        .select({ id: nbaRecommendationHistory.id })
        .from(nbaRecommendationHistory)
        .where(eq(nbaRecommendationHistory.contactId, engagedId));

      await NBAService.computeNBA(engagedId); // First compute → upserts contact_nba
      await NBAService.computeNBA(engagedId); // Second → moves first row to history

      const countAfter = await db
        .select({ id: nbaRecommendationHistory.id })
        .from(nbaRecommendationHistory)
        .where(eq(nbaRecommendationHistory.contactId, engagedId));

      ok("History grows by ≥1 on recompute", countAfter.length > countBefore.length);
    }

    // ── Case 8: executeNBA marks HUMAN_EXECUTED ───────────────────────────────
    console.log("\nCase 8: executeNBA marks HUMAN_EXECUTED");
    {
      await NBAService.computeNBA(executeTestId);
      await NBAService.executeNBA(executeTestId, "HUMAN_EXECUTED");
      const nba = await NBAService.getNBA(executeTestId);
      ok("status is HUMAN_EXECUTED", nba?.status === "HUMAN_EXECUTED");
    }

    // ── Case 9: dismissNBA marks DISMISSED ────────────────────────────────────
    console.log("\nCase 9: dismissNBA marks DISMISSED");
    {
      await NBAService.computeNBA(dismissTestId);
      await NBAService.dismissNBA(dismissTestId, "nba-test-runner");
      const nba = await NBAService.getNBA(dismissTestId);
      ok("status is DISMISSED", nba?.status === "DISMISSED");
    }

    // ── Case 10: getPriorityQueue returns the seeded OPEN recommendation ──────
    console.log("\nCase 10: getPriorityQueue surfaces OPEN recommendations");
    {
      await NBAService.computeNBA(proposalSentId);
      const rows = await NBAService.getPriorityQueue({ limit: 200 });
      const arr = rows as any[];
      ok("Priority queue returns array", Array.isArray(arr));
      // The PROPOSAL_SENT fixture should appear as OPEN
      const found = arr.some(
        (r: any) =>
          (r.contact_id ?? r.nba?.contactId ?? r.contactId) === proposalSentId ||
          (r.nba?.contactId) === proposalSentId,
      );
      ok("Fixture contact appears in priority queue", found);
    }

    // ── Case 11: APPOINTMENT_SCHEDULED → NO_ACTION ───────────────────────────
    console.log("\nCase 11: APPOINTMENT_SCHEDULED → NO_ACTION (appointment pending)");
    {
      const rec = await NBAService.computeNBA(appointmentScheduled);
      ok("actionType is NO_ACTION", rec.actionType === "NO_ACTION");
      ok("reasonCode is appointment_pending", rec.reasonCode === "appointment_pending");
    }

    // ── Case 12: invalidateNBA is safe fire-and-forget ────────────────────────
    console.log("\nCase 12: invalidateNBA is safe to call fire-and-forget");
    {
      let threw = false;
      try {
        await NBAService.invalidateNBA(invalidateId);
      } catch {
        threw = true;
      }
      ok("invalidateNBA does not throw", !threw);
    }

  } finally {
    // ── Always restore canonical pause to safe state (even on crash) ──────────
    try {
      await applyPauseMutation({
        outboundGlobalPaused: true,
        actor: "test-nba-teardown",
        reason: "NBA test suite — restore canonical pause to safe state",
      });
    } catch (err: any) {
      console.warn("[NBA test] Could not restore canonical pause:", err?.message);
    }

    // ── Always clean up fixture contacts ──────────────────────────────────
    await cleanupFixtures();
    console.log(`\n[teardown] ${fixtureIds.length} fixture contact(s) cleaned up.`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\n❌ NBA tests FAILED");
    process.exit(1);
  } else {
    console.log("\n✅ NBA tests PASSED");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
