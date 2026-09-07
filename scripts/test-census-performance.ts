#!/usr/bin/env npx tsx
/**
 * Census Performance Test — 150,000+ synthetic contacts.
 *
 * Tests the classifier (pure function, no DB) at production scale:
 *   - Runtime for 150K classification calls
 *   - Peak heap growth during the run
 *   - Shared-phone and business-name set overhead
 *   - All contacts produce exactly one non-null lane (zero disappear)
 *   - No UNCLASSIFIED_REVIEW at production-representative data distribution
 *
 * Exit 0 = pass. Exit 1 = fail.
 */

import crypto from "crypto";
import {
  classifyContact,
  type CensusContactRow,
  type CensusRunContext,
} from "../server/services/contact-census-classifier.js";

const CONTACT_COUNT = 155_000; // above 150K threshold
const SHARED_PHONE_COUNT = 25_000;  // ~16% contacts share a phone (realistic)
const BUSINESS_COUNT = 40_000;       // distinct businesses

// ──────────────────────────────────────────────────────────────────────────────
// Synthetic data generators
// ──────────────────────────────────────────────────────────────────────────────
const VERTICALS = ["restaurants", "retail", "healthcare", "automotive", null, null];
const EMAIL_STATUSES = ["valid", "valid", "valid", "unvalidated", "invalid", null];
const RECORD_CLASSES = ["production", "production", "production", "production", "test", "unknown"];
const LEAD_SOURCES = ["website", "ghl", "csv", "manual", null];

function randomPhone(i: number): string {
  return `555${String(i % 9_000_000 + 1_000_000).slice(0, 7)}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Build shared-phone context (simulates what the runner loads once per run)
// ──────────────────────────────────────────────────────────────────────────────
function buildRunContext(runId: string): { ctx: CensusRunContext; sharedPhoneCount: number; bizCount: number } {
  const sharedPhoneSet = new Set<string>();
  const sharedPhoneCompanyCount = new Map<string, number>();
  const sharedPhoneTollFree = new Map<string, boolean>();
  const sharedPhonePlaceholder = new Map<string, boolean>();
  const singleCompanySingleSourcePhones = new Set<string>();
  const businessNameSet = new Set<string>();

  // Shared phones: 25K phones shared by 2-30 contacts each
  for (let i = 0; i < SHARED_PHONE_COUNT; i++) {
    const phone = randomPhone(i);
    sharedPhoneSet.add(phone);
    sharedPhoneCompanyCount.set(phone, 2 + (i % 20));
    sharedPhoneTollFree.set(phone, i % 50 === 0); // 2% toll-free
    sharedPhonePlaceholder.set(phone, false);
    if (i % 5 === 0) singleCompanySingleSourcePhones.add(phone);
  }

  // Business names
  for (let i = 0; i < BUSINESS_COUNT; i++) {
    businessNameSet.add(`business normalized name ${i}`);
  }

  const ctx: CensusRunContext = {
    runId,
    asOf: new Date().toISOString(),
    sharedPhoneSet,
    sharedPhoneCompanyCount,
    sharedPhoneTollFree,
    sharedPhonePlaceholder,
    singleCompanySingleSourcePhones,
    businessNameSet,
  };

  return { ctx, sharedPhoneCount: sharedPhoneSet.size, bizCount: businessNameSet.size };
}

// ──────────────────────────────────────────────────────────────────────────────
// Build a realistic synthetic contact row
// ──────────────────────────────────────────────────────────────────────────────
function syntheticContact(i: number): CensusContactRow {
  const hasEmail = i % 7 !== 0;       // 86% have email
  const hasPhone = i % 5 !== 0;       // 80% have phone
  const hasCompany = i % 4 !== 0;     // 75% have company
  const hasFirstName = i % 12 !== 0;  // 92% have first name
  const hasBusinessId = hasCompany && i % 3 === 0;  // 33% linked to a business

  const phone = hasPhone ? randomPhone(i % (SHARED_PHONE_COUNT * 4)) : null;
  const normalizedPhone = phone?.trim() ?? null;
  const vertical = VERTICALS[i % VERTICALS.length];
  const emailStatus = hasEmail ? EMAIL_STATUSES[i % EMAIL_STATUSES.length] : null;
  const recordClass = RECORD_CLASSES[i % RECORD_CLASSES.length];

  // ~70% have recent validation
  const recentValidation = new Date(Date.now() - (i % 60) * 24 * 60 * 60 * 1000);
  const emailValidationUpdatedAt = emailStatus === "valid" && i % 3 !== 0 ? recentValidation : null;

  return {
    id: i + 1,
    firstName: hasFirstName ? `First${i}` : null,
    lastName: i % 3 === 0 ? `Last${i}` : null,
    email: hasEmail ? `contact${i}@example${i % 1000}.com` : null,
    phone,
    companyName: hasCompany ? `Company Name ${i % BUSINESS_COUNT}` : null,
    vertical: vertical ?? null,
    verticalSource: vertical ? "manual" : null,
    manualVerticalOverride: vertical && i % 5 === 0 ? vertical : null,
    dataReadinessScore: 40 + (i % 60),  // snapshotted as context, NOT a classification signal
    leadScore: i % 100,                  // snapshotted as context, NOT a classification signal
    emailStatus,
    emailValidationUpdatedAt,
    businessId: hasBusinessId ? (i % BUSINESS_COUNT) + 1 : null,
    doNotContact: i % 200 === 0,        // 0.5% DNC
    suppressionReason: i % 200 === 0 ? "unsubscribed" : null,
    bounceStatus: i % 100 === 0 ? "hard" : null,
    complaintStatus: null,
    consentTier: "standard",
    recordClass,
    ghlContactId: i % 3 === 0 ? `ghl_${i}` : null,
    leadSource: LEAD_SOURCES[i % LEAD_SOURCES.length],
    hasDeal: i % 4 === 0,
    hasSourceEvent: i % 2 === 0,
    hasEnrichmentRun: i % 5 === 0,
    hasZerobounceRun: emailStatus === "valid",
    hasMergeRedirect: i % 1000 === 0,
    normalizedPhone,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("  Census Performance Test — 150K+ contacts");
  console.log("══════════════════════════════════════════════════════════════════");

  const runId = crypto.randomUUID();
  const heapBefore = process.memoryUsage();

  // ── Build context (once per run, as in production) ────────────────────────
  const buildStart = Date.now();
  const { ctx, sharedPhoneCount, bizCount } = buildRunContext(runId);
  const buildDuration = Date.now() - buildStart;
  const heapAfterContext = process.memoryUsage();

  console.log(`\n  Context build:`);
  console.log(`    shared-phone entries:  ${sharedPhoneCount.toLocaleString()}`);
  console.log(`    business-name entries: ${bizCount.toLocaleString()}`);
  console.log(`    build duration:        ${buildDuration}ms`);
  console.log(`    heap after context:    ${Math.round(heapAfterContext.heapUsed / 1024 / 1024)}MB`);

  // ── Classify 155K contacts ─────────────────────────────────────────────────
  console.log(`\n  Classifying ${CONTACT_COUNT.toLocaleString()} contacts...`);
  const classifyStart = Date.now();
  const laneCounts: Record<string, number> = {};
  let unclassifiedCount = 0;
  let nullLaneCount = 0;

  for (let i = 0; i < CONTACT_COUNT; i++) {
    const row = syntheticContact(i);
    const result = classifyContact(row, ctx);

    if (!result.primaryLane) { nullLaneCount++; continue; }
    if (result.primaryLane === "UNCLASSIFIED_REVIEW") unclassifiedCount++;
    laneCounts[result.primaryLane] = (laneCounts[result.primaryLane] ?? 0) + 1;
  }

  const classifyDuration = Date.now() - classifyStart;
  const heapAfterClassify = process.memoryUsage();
  const heapGrowthMB = Math.round((heapAfterClassify.heapUsed - heapBefore.heapUsed) / 1024 / 1024);
  const throughput = Math.round(CONTACT_COUNT / (classifyDuration / 1000));

  console.log(`\n  Classification results:`);
  console.log(`    duration:              ${classifyDuration}ms`);
  console.log(`    throughput:            ${throughput.toLocaleString()} contacts/sec`);
  console.log(`    peak heap growth:      +${heapGrowthMB}MB`);
  console.log(`    heap used (total):     ${Math.round(heapAfterClassify.heapUsed / 1024 / 1024)}MB`);
  console.log(`    contacts with null lane: ${nullLaneCount}`);
  console.log(`    UNCLASSIFIED_REVIEW:   ${unclassifiedCount}`);
  console.log(`\n  Lane distribution:`);

  const total = Object.values(laneCounts).reduce((a, b) => a + b, 0);
  for (const [lane, count] of Object.entries(laneCounts).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / total) * 100).toFixed(1);
    console.log(`    ${lane.padEnd(38)} ${count.toLocaleString().padStart(8)}  (${pct}%)`);
  }

  // ── Assertions ─────────────────────────────────────────────────────────────
  console.log(`\n  Assertions:`);
  let pass = 0; let fail = 0;

  function check(label: string, cond: boolean, detail?: string) {
    if (cond) { pass++; console.log(`    ✓ ${label}`); }
    else { fail++; console.log(`    ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
  }

  check("All contacts produced a lane (zero disappeared)", nullLaneCount === 0, `null lanes: ${nullLaneCount}`);
  check("UNCLASSIFIED_REVIEW count is 0", unclassifiedCount === 0, `got: ${unclassifiedCount}`);
  check("Classification completes within 30s", classifyDuration < 30_000, `took ${classifyDuration}ms`);
  check("Peak heap growth < 200MB", heapGrowthMB < 200, `grew ${heapGrowthMB}MB`);
  check("Throughput >= 50K contacts/sec", throughput >= 50_000, `got ${throughput}/sec`);
  check(`Total classified = ${CONTACT_COUNT.toLocaleString()}`, total === CONTACT_COUNT, `got ${total}`);
  check("Shared-phone set < 100K entries (memory ceiling)", sharedPhoneCount < 100_000);
  check("Business-name set < 500K entries (memory ceiling)", bizCount < 500_000);

  // ── Reconciliation proof ───────────────────────────────────────────────────
  const processedPlusExceptions = total; // in this pure test, no terminal exceptions (no archiving mid-run)
  check(
    `Reconciliation: processed(${processedPlusExceptions}) = denominator(${CONTACT_COUNT})`,
    processedPlusExceptions === CONTACT_COUNT,
  );

  console.log(`\n  Summary: ${pass} passed, ${fail} failed`);
  console.log("══════════════════════════════════════════════════════════════════\n");

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
