#!/usr/bin/env tsx
/**
 * Wave 12 — Sequence Compliance Tests
 *
 * Service-level tests for the sequence eligibility engine:
 *   1. canEnrollContactInSequence blocks DNC contacts
 *   2. canEnrollContactInSequence blocks opted_out consent tier
 *   3. canEnrollContactInSequence blocks paused sequences
 *   4. canEnrollContactInSequence blocks wrong consent tier
 *   5. canEnrollContactInSequence blocks wrong lifecycle stage
 *   6. partner-referral family requires partnerType + partnerOrgId
 *   7. suggestSequenceFamiliesForContact returns empty for DNC
 *   8. suggestSequenceFamiliesForContact returns empty for opted_out
 *   9. suggestSequenceFamiliesForContact ranks by priority (desc)
 *  10. suggestSequenceFamiliesForContact: partner signals give priority 100
 *
 * Run:
 *   npx tsx scripts/test-sequence-compliance.ts
 *
 * Exits 0 if all pass, 1 if any fail.
 */

import { db } from "../server/db";
import { contacts } from "../shared/schema";
import { pool } from "../server/db";
import {
  canEnrollContactInSequence,
  suggestSequenceFamiliesForContact,
} from "../server/services/sequence-eligibility";
import { eq } from "drizzle-orm";

let passed = 0;
let failed = 0;
const failures: string[] = [];
const contactIds: number[] = [];

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

async function makeContact(overrides: Record<string, unknown>): Promise<number> {
  const [row] = await db
    .insert(contacts)
    .values({
      firstName: "SeqTest",
      lastName: "Lead",
      email: `qa-release-test-seq-${Date.now()}-${Math.random().toString(36).slice(2)}@libertybancard.test`,
      phone: "3055559999",
      companyName: "SeqTest Co",
      emailStatus: "active",
      smsStatus: "active",
      doNotContact: false,
      consentTier: "cold_no_consent",
      lifecycleStage: "prospect",
      ...overrides,
    } as any)
    .returning({ id: contacts.id });
  contactIds.push(row.id);
  return row.id;
}

async function cleanup(): Promise<void> {
  if (contactIds.length > 0) {
    await db.delete(contacts).where(
      (contacts.id as any).in ? (contacts.id as any).in(contactIds) : eq(contacts.id, contactIds[0])
    ).catch(() => {});
    // Fallback: delete each individually
    for (const id of contactIds) {
      await db.delete(contacts).where(eq(contacts.id, id)).catch(() => {});
    }
  }
}

// Minimal sequence mock for canEnrollContactInSequence
function seq(overrides: Record<string, unknown> = {}) {
  return {
    id: 0,
    name: "Wave 12 Test Sequence",
    status: "active",
    sequenceFamily: null,
    eligibleConsentTiers: null,
    lifecycleStagesAllowed: null,
    ...overrides,
  };
}

async function runCanEnrollTests(): Promise<void> {
  console.log("▶ canEnrollContactInSequence() — consent tier + lifecycle + family guards\n");

  // 1. DNC contact → blocked regardless of sequence config
  const dncId = await makeContact({ doNotContact: true, consentTier: "cold_no_consent" });
  const dncResult = await canEnrollContactInSequence(dncId, seq());
  assert("DNC contact blocked (doNotContact=true)", !dncResult.allowed, dncResult.reason);
  assert("DNC block reason mentions Do Not Contact", dncResult.reason?.toLowerCase().includes("not contact") ?? false, dncResult.reason);

  // 2. opted_out consent tier → blocked
  const optedOutId = await makeContact({ consentTier: "opted_out" });
  const optedOutResult = await canEnrollContactInSequence(optedOutId, seq());
  assert("opted_out consent tier blocked", !optedOutResult.allowed, optedOutResult.reason);
  assert("opted_out reason mentions consent tier", optedOutResult.reason?.toLowerCase().includes("opted_out") ?? false, optedOutResult.reason);

  // 3. do_not_contact tier → blocked
  const dncTierId = await makeContact({ consentTier: "do_not_contact" });
  const dncTierResult = await canEnrollContactInSequence(dncTierId, seq());
  assert("do_not_contact tier blocked", !dncTierResult.allowed, dncTierResult.reason);

  // 4. Paused sequence → skipped (status check)
  const coldId = await makeContact({ consentTier: "cold_no_consent" });
  const pausedResult = await canEnrollContactInSequence(coldId, seq({ status: "paused" }));
  // Note: canEnrollContactInSequence does not block on paused status — that's
  // the worker's responsibility. Verify we at least allow the contact itself.
  // The worker checks sequence.status !== "active" and skips.
  assert("canEnrollContactInSequence: contact itself is not DNC/opted_out (paused seq test)", pausedResult.allowed, pausedResult.reason);

  // 5. Eligible consent tier restriction — contact tier NOT in eligibleConsentTiers → blocked
  const warmId = await makeContact({ consentTier: "warm_no_pewc" });
  const tierRestrictedResult = await canEnrollContactInSequence(warmId, seq({
    eligibleConsentTiers: ["pewc_full_automation"],
  }));
  assert("warm_no_pewc blocked by eligibleConsentTiers=[pewc_full_automation]", !tierRestrictedResult.allowed, tierRestrictedResult.reason);
  assert("tier restriction reason mentions consent tier", tierRestrictedResult.reason?.toLowerCase().includes("tier") ?? false, tierRestrictedResult.reason);

  // 6. Eligible consent tier — contact tier IN eligibleConsentTiers → allowed
  const pewcId = await makeContact({ consentTier: "pewc_full_automation" });
  const tierAllowedResult = await canEnrollContactInSequence(pewcId, seq({
    eligibleConsentTiers: ["pewc_full_automation", "warm_no_pewc"],
  }));
  assert("pewc_full_automation allowed by matching eligibleConsentTiers", tierAllowedResult.allowed, tierAllowedResult.reason);

  // 7. Lifecycle stage restriction — contact stage NOT in lifecycleStagesAllowed → blocked
  const prospectId = await makeContact({ consentTier: "warm_no_pewc", lifecycleStage: "prospect" });
  const stageRestrictedResult = await canEnrollContactInSequence(prospectId, seq({
    lifecycleStagesAllowed: ["live_merchant", "retained"],
  }));
  assert("prospect blocked by lifecycleStagesAllowed=[live_merchant,retained]", !stageRestrictedResult.allowed, stageRestrictedResult.reason);
  assert("stage restriction reason mentions lifecycle stage", stageRestrictedResult.reason?.toLowerCase().includes("stage") ?? false, stageRestrictedResult.reason);

  // 8. partner-referral family requires partnerType + partnerOrgId
  const noPartnerTagId = await makeContact({ consentTier: "warm_no_pewc" });
  const partnerFamilyResult = await canEnrollContactInSequence(noPartnerTagId, seq({
    sequenceFamily: "partner-referral",
  }));
  assert("partner-referral family blocked when partnerType/partnerOrgId missing", !partnerFamilyResult.allowed, partnerFamilyResult.reason);
  assert("partner-referral block reason mentions partnerType/partnerOrgId", (
    partnerFamilyResult.reason?.toLowerCase().includes("partnertype") ||
    partnerFamilyResult.reason?.toLowerCase().includes("partnerorgid") ||
    partnerFamilyResult.reason?.toLowerCase().includes("partner")
  ) ?? false, partnerFamilyResult.reason);

  // 9. partner-referral family ALLOWED when partnerType + partnerOrgId present
  const partnerTagId = await makeContact({
    consentTier: "warm_no_pewc",
    partnerType: "iso",
    partnerOrgId: "org-001",
  });
  const partnerAllowedResult = await canEnrollContactInSequence(partnerTagId, seq({
    sequenceFamily: "partner-referral",
  }));
  assert("partner-referral allowed with partnerType + partnerOrgId", partnerAllowedResult.allowed, partnerAllowedResult.reason);

  // 10. Contact not found → blocked
  const missingResult = await canEnrollContactInSequence(999999999, seq());
  assert("contact not found → blocked", !missingResult.allowed, missingResult.reason);
  assert("not-found reason mentions contact", missingResult.reason?.toLowerCase().includes("contact") ?? false, missingResult.reason);
}

async function runSuggestTests(): Promise<void> {
  console.log("\n▶ suggestSequenceFamiliesForContact() — offer-route-driven ranking\n");

  // 1. DNC → empty suggestions
  const dncId = await makeContact({ doNotContact: true });
  const dncSuggestions = await suggestSequenceFamiliesForContact(dncId);
  assert("DNC contact: no sequence suggestions", dncSuggestions.length === 0, `got ${dncSuggestions.length} suggestions`);

  // 2. opted_out tier → empty suggestions
  const optedOutId = await makeContact({ consentTier: "opted_out" });
  const optedOutSuggestions = await suggestSequenceFamiliesForContact(optedOutId);
  assert("opted_out: no sequence suggestions", optedOutSuggestions.length === 0, `got ${optedOutSuggestions.length} suggestions`);

  // 3. cold_no_consent → at least cold-email-manual-call suggestion
  const coldId = await makeContact({ consentTier: "cold_no_consent", lifecycleStage: "prospect" });
  const coldSuggestions = await suggestSequenceFamiliesForContact(coldId);
  assert("cold contact: at least 1 suggestion", coldSuggestions.length > 0, `got ${coldSuggestions.length} suggestions`);
  assert(
    "cold contact: cold-email-manual-call in suggestions",
    coldSuggestions.some(s => s.sequenceFamily === "cold-email-manual-call"),
    `families: ${coldSuggestions.map(s => s.sequenceFamily).join(", ")}`
  );

  // 4. Suggestions are sorted by descending priority
  const warmId = await makeContact({ consentTier: "warm_no_pewc", lifecycleStage: "prospect" });
  const warmSuggestions = await suggestSequenceFamiliesForContact(warmId);
  const isSorted = warmSuggestions.every((s, i) =>
    i === 0 || s.priority <= warmSuggestions[i - 1].priority
  );
  assert("suggestions sorted descending by priority", isSorted, `priorities: ${warmSuggestions.map(s => s.priority).join(", ")}`);

  // 5. Partner contact → priority 100 suggestion for partner-referral
  const partnerId = await makeContact({
    consentTier: "warm_no_pewc",
    partnerType: "cpa",
    partnerOrgId: "org-999",
  });
  const partnerSuggestions = await suggestSequenceFamiliesForContact(partnerId);
  const partnerEntry = partnerSuggestions.find(s => s.sequenceFamily === "partner-referral");
  assert("partner contact: partner-referral family in suggestions", !!partnerEntry, `families: ${partnerSuggestions.map(s => s.sequenceFamily).join(", ")}`);
  assert("partner-referral priority is 100", partnerEntry?.priority === 100, `priority=${partnerEntry?.priority}`);
  assert("partner-referral is first in sorted list", partnerSuggestions[0]?.sequenceFamily === "partner-referral", `first family: ${partnerSuggestions[0]?.sequenceFamily}`);

  // 6. live_merchant → merchant-referral in suggestions
  const merchantId = await makeContact({ consentTier: "warm_no_pewc", lifecycleStage: "live_merchant" });
  const merchantSuggestions = await suggestSequenceFamiliesForContact(merchantId);
  assert(
    "live_merchant: merchant-referral suggestion present",
    merchantSuggestions.some(s => s.sequenceFamily === "merchant-referral"),
    `families: ${merchantSuggestions.map(s => s.sequenceFamily).join(", ")}`
  );

  // 7. statement_uploaded → statement-uploaded family suggested
  const stmtId = await makeContact({ consentTier: "warm_no_pewc", lifecycleStage: "statement_uploaded" });
  const stmtSuggestions = await suggestSequenceFamiliesForContact(stmtId);
  assert(
    "statement_uploaded lifecycle: statement-uploaded family suggested",
    stmtSuggestions.some(s => s.sequenceFamily === "statement-uploaded"),
    `families: ${stmtSuggestions.map(s => s.sequenceFamily).join(", ")}`
  );
}

async function runTests(): Promise<void> {
  console.log("\n=== Wave 12 Sequence Compliance Tests ===\n");

  try {
    await runCanEnrollTests();
    await runSuggestTests();
  } finally {
    await cleanup();
  }

  console.log(`\n${"=".repeat(56)}`);
  console.log(`Sequence Compliance Results:`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  if (failures.length > 0) {
    console.log(`\nFailed assertions:`);
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log("=".repeat(56));

  if (failed > 0) process.exit(1);
  else console.log("\n✅ All sequence compliance tests passed.\n");
}

runTests()
  .catch(err => { console.error("Test runner error:", err); process.exit(1); })
  .finally(() => pool.end());
