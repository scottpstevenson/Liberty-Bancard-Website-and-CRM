#!/usr/bin/env npx tsx
/**
 * NBA Engine test script — 12 cases covering the Next Best Action Engine.
 *
 * Usage:
 *   npx tsx scripts/test-nba.ts
 *
 * Exit 0 = all pass. Exit 1 = failures.
 */

import { db } from "../server/db";
import { contacts, contactNba, nbaRecommendationHistory } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { NBAService } from "../server/services/nba-service";
import { storage } from "../server/storage";

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

async function findTestContact(lifecycleState: string) {
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.lifecycleState, lifecycleState))
    .limit(1);
  return contact?.id ?? null;
}

async function findAnyContact() {
  const [contact] = await db
    .select({ id: contacts.id, doNotContact: contacts.doNotContact })
    .from(contacts)
    .limit(1);
  return contact ?? null;
}

async function main() {
  console.log("\n=== NBA Engine Tests ===\n");

  // Ensure global pause is OFF for all cases except Case 6 (which tests it explicitly).
  // This mirrors the production state where tests run against a DB that may have pause=true.
  const prevPause = await storage.getSystemSetting("outboundGlobalPaused");
  await storage.setSystemSetting("outboundGlobalPaused", "false");

  // ── Case 1: PROSPECT → CALL_PROSPECT ─────────────────────────────────────
  console.log("Case 1: PROSPECT lifecycle → CALL_PROSPECT action");
  {
    const contactId = await findTestContact("PROSPECT");
    if (!contactId) {
      console.log("  ⚠ No PROSPECT contact found — skipping");
    } else {
      const rec = await NBAService.computeNBA(contactId);
      ok("actionType is CALL_PROSPECT or SEND_EMAIL", ["CALL_PROSPECT", "SEND_EMAIL"].includes(rec.actionType));
      ok("status is OPEN or BLOCKED", ["OPEN", "BLOCKED"].includes(rec.status));
      ok("reasonCode present", !!rec.reasonCode);
      ok("ruleVersion set", !!rec.ruleVersion);
    }
  }

  // ── Case 2: AT_RISK → CONTACT_AT_RISK_MERCHANT ───────────────────────────
  console.log("\nCase 2: AT_RISK lifecycle → CONTACT_AT_RISK_MERCHANT");
  {
    const contactId = await findTestContact("AT_RISK");
    if (!contactId) {
      console.log("  ⚠ No AT_RISK contact found — skipping");
    } else {
      const rec = await NBAService.computeNBA(contactId);
      ok("actionType is CONTACT_AT_RISK_MERCHANT", rec.actionType === "CONTACT_AT_RISK_MERCHANT");
      ok("urgency is critical", rec.urgency === "critical");
      ok("humanRequired is true", rec.humanRequired === true);
      ok("automationEligible is false", rec.automationEligible === false);
    }
  }

  // ── Case 3: PROPOSAL_READY → SEND_PROPOSAL critical ─────────────────────
  console.log("\nCase 3: PROPOSAL_READY → SEND_PROPOSAL, urgency critical");
  {
    const contactId = await findTestContact("PROPOSAL_READY");
    if (!contactId) {
      console.log("  ⚠ No PROPOSAL_READY contact found — skipping");
    } else {
      const rec = await NBAService.computeNBA(contactId);
      ok("actionType is SEND_PROPOSAL", rec.actionType === "SEND_PROPOSAL");
      ok("urgency is critical", rec.urgency === "critical");
    }
  }

  // ── Case 4: DNC contact → NO_ACTION BLOCKED ──────────────────────────────
  console.log("\nCase 4: DNC contact → NO_ACTION BLOCKED");
  {
    const [dncContact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.doNotContact, true))
      .limit(1);

    if (!dncContact) {
      console.log("  ⚠ No DNC contact found — skipping");
    } else {
      const rec = await NBAService.computeNBA(dncContact.id);
      ok("status is BLOCKED", rec.status === "BLOCKED");
      ok("reasonCode is do_not_contact", rec.reasonCode === "do_not_contact");
    }
  }

  // ── Case 5: CLOSED_LOST → NO_ACTION ──────────────────────────────────────
  console.log("\nCase 5: CLOSED_LOST → NO_ACTION");
  {
    const contactId = await findTestContact("CLOSED_LOST");
    if (!contactId) {
      console.log("  ⚠ No CLOSED_LOST contact found — skipping");
    } else {
      const rec = await NBAService.computeNBA(contactId);
      ok("actionType is NO_ACTION", rec.actionType === "NO_ACTION");
    }
  }

  // ── Case 6: Global pause → all contacts BLOCKED ──────────────────────────
  console.log("\nCase 6: Global pause → NO_ACTION BLOCKED");
  {
    const contact = await findAnyContact();
    if (!contact) {
      console.log("  ⚠ No contacts found — skipping");
    } else {
      // Enable global pause
      await storage.setSystemSetting("outboundGlobalPaused", "true");
      try {
        const rec = await NBAService.computeNBA(contact.id);
        ok("status is BLOCKED when globally paused", rec.status === "BLOCKED");
        ok("reasonCode is global_pause_active", rec.reasonCode === "global_pause_active");
      } finally {
        await storage.setSystemSetting("outboundGlobalPaused", "false");
      }
    }
  }

  // ── Case 7: History row written on recompute ──────────────────────────────
  console.log("\nCase 7: History row written on recompute");
  {
    const contactId = await findTestContact("ENGAGED");
    if (!contactId) {
      console.log("  ⚠ No ENGAGED contact found — skipping");
    } else {
      const countBefore = await db
        .select({ id: nbaRecommendationHistory.id })
        .from(nbaRecommendationHistory)
        .where(eq(nbaRecommendationHistory.contactId, contactId));

      await NBAService.computeNBA(contactId); // First compute
      await NBAService.computeNBA(contactId); // Second — should move first to history

      const countAfter = await db
        .select({ id: nbaRecommendationHistory.id })
        .from(nbaRecommendationHistory)
        .where(eq(nbaRecommendationHistory.contactId, contactId));

      ok("History grows by ≥1 on recompute", countAfter.length > countBefore.length);
    }
  }

  // ── Case 8: executeNBA marks HUMAN_EXECUTED ───────────────────────────────
  console.log("\nCase 8: executeNBA marks HUMAN_EXECUTED");
  {
    const contact = await findAnyContact();
    if (!contact) {
      console.log("  ⚠ No contacts found — skipping");
    } else {
      await NBAService.computeNBA(contact.id);
      await NBAService.executeNBA(contact.id, "HUMAN_EXECUTED");
      const nba = await NBAService.getNBA(contact.id);
      ok("status is HUMAN_EXECUTED", nba?.status === "HUMAN_EXECUTED");
    }
  }

  // ── Case 9: dismissNBA marks DISMISSED ───────────────────────────────────
  console.log("\nCase 9: dismissNBA marks DISMISSED");
  {
    const contact = await findAnyContact();
    if (!contact) {
      console.log("  ⚠ No contacts found — skipping");
    } else {
      await NBAService.computeNBA(contact.id);
      await NBAService.dismissNBA(contact.id, 1); // user ID 1
      const nba = await NBAService.getNBA(contact.id);
      ok("status is DISMISSED", nba?.status === "DISMISSED");
    }
  }

  // ── Case 10: getPriorityQueue returns results ─────────────────────────────
  console.log("\nCase 10: getPriorityQueue returns results");
  {
    // Seed a fresh OPEN recommendation
    const contactId = await findTestContact("PROPOSAL_SENT");
    if (!contactId) {
      console.log("  ⚠ No PROPOSAL_SENT contact found — skipping");
    } else {
      await NBAService.computeNBA(contactId);
      const rows = await NBAService.getPriorityQueue({ limit: 10 });
      ok("Priority queue returns array", Array.isArray(rows));
      ok("Priority queue not empty", (rows as any[]).length > 0);
    }
  }

  // ── Case 11: APPOINTMENT_SCHEDULED → NO_ACTION ───────────────────────────
  console.log("\nCase 11: APPOINTMENT_SCHEDULED → NO_ACTION (wait)");
  {
    const contactId = await findTestContact("APPOINTMENT_SCHEDULED");
    if (!contactId) {
      console.log("  ⚠ No APPOINTMENT_SCHEDULED contact found — skipping");
    } else {
      const rec = await NBAService.computeNBA(contactId);
      ok("actionType is NO_ACTION", rec.actionType === "NO_ACTION");
      ok("reasonCode is appointment_pending", rec.reasonCode === "appointment_pending");
    }
  }

  // ── Case 12: invalidateNBA doesn't throw ─────────────────────────────────
  console.log("\nCase 12: invalidateNBA is safe to call fire-and-forget");
  {
    const contact = await findAnyContact();
    if (!contact) {
      console.log("  ⚠ No contacts found — skipping");
    } else {
      let threw = false;
      try {
        await NBAService.invalidateNBA(contact.id);
      } catch {
        threw = true;
      }
      ok("invalidateNBA does not throw", !threw);
    }
  }

  // Restore global pause to whatever it was before the test.
  await storage.setSystemSetting("outboundGlobalPaused", prevPause ?? "false");

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
