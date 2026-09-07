#!/usr/bin/env tsx
/**
 * scripts/test-reconciliation-performance.ts
 *
 * Performance benchmark for the reconciliation classifier.
 * REQUIRES TEST_DATABASE_URL — never runs against production.
 *
 * Generates 155K synthetic ReconciliationContactRow objects in memory
 * (no DB required for the pure-function benchmark), classifies them all,
 * and verifies throughput ≥ 100K contacts/second and heap growth < 50 MB.
 *
 * Also verifies UNCLASSIFIED lane count = 0.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) {
  console.error(
    "✗ TEST_DATABASE_URL is not set.\n" +
    "  Reconciliation performance tests require a disposable database URL.\n" +
    "  Example: TEST_DATABASE_URL=postgresql://localhost/test_recon npx tsx scripts/test-reconciliation-performance.ts"
  );
  process.exit(1);
}

import {
  classifyReconciliation,
  ALL_RECONCILIATION_LANES,
  type ReconciliationContactRow,
} from "../server/services/reconciliation-classifier";

// ──────────────────────────────────────────────────────────────────────────────
// Test harness
// ──────────────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, extra?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
    failed++;
  }
}

const RUN_ID = "00000000-0000-4000-a000-000000000002";
const CONTACT_COUNT = 155_000;
const MIN_THROUGHPUT = 100_000; // contacts/sec
const MAX_HEAP_GROWTH_MB = 50;

// ──────────────────────────────────────────────────────────────────────────────
// Synthetic data generators
// ──────────────────────────────────────────────────────────────────────────────
const RECORD_CLASSES = ["production", "production", "production", "production", "test", "demo", "synthetic", "unknown"];
const CENSUS_LANES = [
  "NEEDS_BUSINESS_MATERIALIZATION", "NEEDS_BUSINESS_MATERIALIZATION",
  "DUPLICATE_REVIEW", "NEEDS_PHONE", "NEEDS_EMAIL",
  "NON_PRODUCTION", "BLOCKED_COMPLIANCE", "INTERNAL_MATCH_AVAILABLE",
  "COMPLETE_EXISTING_DATA",
];
const VERTICALS = ["restaurant", "retail", "healthcare", null, null, null];
const EMAIL_STATUSES = ["valid", "unvalidated", "bounced", "opted_out", null];
const COMPANIES = [
  "Acme Corp", "Beta LLC", "Gamma Inc", "DELTA CO", "epsilon systems",
  null, null, "Zeta Holdings",
];
const FIRST_NAMES = ["John", "JANE", "Dr. Bob", "alice", "mr. charlie", null];
const LAST_NAMES = ["Smith", "JONES", "Lee", "brown", null];
const PHONES = [
  "(555) 123-4567", "5551234567", null, "(800) 555-1234",
  "5550001234", null, "15551234567",
];

function pickRandom<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function generateRow(i: number): ReconciliationContactRow {
  const rc = pickRandom(RECORD_CLASSES, i * 7 + 1);
  const companyName = pickRandom(COMPANIES, i * 3 + 2);
  const phone = pickRandom(PHONES, i * 5 + 3);
  const sharedCount = (i % 50 === 0) ? 3 : 0;

  return {
    id: i + 1,
    firstName: pickRandom(FIRST_NAMES, i * 11 + 4),
    lastName: pickRandom(LAST_NAMES, i * 13 + 5),
    email: i % 7 === 0 ? null : i % 11 === 0 ? "noemail@fake.com" : `contact${i}@domain.com`,
    phone,
    companyName,
    vertical: pickRandom(VERTICALS, i * 17 + 6),
    verticalSource: i % 4 === 0 ? "form" : null,
    manualVerticalOverride: i % 100 === 0 ? true : null,
    doNotContact: i % 200 === 0,
    suppressionReason: i % 300 === 0 ? "unsubscribed" : null,
    emailStatus: pickRandom(EMAIL_STATUSES, i * 19 + 7),
    bounceStatus: null,
    complaintStatus: null,
    consentTier: null,
    recordClass: rc,
    ghlContactId: i % 5 === 0 ? `ghl_${i}` : null,
    leadSource: i % 8 === 0 ? "website" : null,
    businessId: i % 4 === 0 ? (i / 4 | 0) + 1 : null,
    hasDeal: i % 10 === 0,
    censusLane: pickRandom(CENSUS_LANES, i * 23 + 8),
    normalizedPhone: phone?.trim() ?? null,
    isSharedPhone: sharedCount > 0,
    sharedPhoneCompanyCount: sharedCount,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Main benchmark
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[Perf] Generating ${CONTACT_COUNT.toLocaleString()} synthetic contacts...`);

  const rows: ReconciliationContactRow[] = [];
  for (let i = 0; i < CONTACT_COUNT; i++) {
    rows.push(generateRow(i));
  }

  console.log(`[Perf] Contacts generated. Starting classification...\n`);

  const memBefore = process.memoryUsage().heapUsed;
  const startTime = Date.now();

  const laneCounts: Record<string, number> = {};
  let unclassifiedCount = 0;

  for (const row of rows) {
    const result = classifyReconciliation(row, RUN_ID, null);
    laneCounts[result.primaryLane] = (laneCounts[result.primaryLane] ?? 0) + 1;
    if (result.primaryLane === "UNCLASSIFIED") unclassifiedCount++;
  }

  const elapsed = Date.now() - startTime;
  const memAfter = process.memoryUsage().heapUsed;
  const heapGrowthMB = (memAfter - memBefore) / 1024 / 1024;
  const throughput = Math.round(CONTACT_COUNT / (elapsed / 1000));

  console.log(`[Perf] Results:`);
  console.log(`  Elapsed:    ${elapsed}ms`);
  console.log(`  Throughput: ${throughput.toLocaleString()} contacts/sec`);
  console.log(`  Heap delta: +${heapGrowthMB.toFixed(1)} MB`);
  console.log(`\n[Perf] Lane breakdown:`);
  for (const [lane, count] of Object.entries(laneCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${lane.padEnd(40)} ${count.toLocaleString()}`);
  }
  console.log();

  // ── Assertions ────────────────────────────────────────────────────────────
  assert(elapsed < 60_000, `classification completes within 60s (took ${elapsed}ms)`);
  assert(
    throughput >= MIN_THROUGHPUT,
    `throughput ≥ ${MIN_THROUGHPUT.toLocaleString()} contacts/sec (got ${throughput.toLocaleString()})`,
  );
  assert(
    heapGrowthMB < MAX_HEAP_GROWTH_MB,
    `heap growth < ${MAX_HEAP_GROWTH_MB} MB (got +${heapGrowthMB.toFixed(1)} MB)`,
  );
  assert(unclassifiedCount === 0, `UNCLASSIFIED_REVIEW count = 0 (got ${unclassifiedCount})`);

  // Verify all defined lanes appear in results (at least some)
  const representedLanes = new Set(Object.keys(laneCounts));
  const nonProduction = laneCounts["NON_PRODUCTION"] ?? 0;
  assert(nonProduction > 0, `NON_PRODUCTION lane has contacts (synthetic records injected)`);

  const blocked = laneCounts["BLOCKED"] ?? 0;
  assert(blocked > 0, `BLOCKED lane has contacts (DNC/suppressed injected)`);

  const orgAgg = laneCounts["PENDING_ORG_AGGREGATION"] ?? 0;
  assert(orgAgg > 0, `PENDING_ORG_AGGREGATION lane populated`);

  const cleanNoAction = laneCounts["CLEAN_NO_ACTION"] ?? 0;
  assert(cleanNoAction > 0, `CLEAN_NO_ACTION lane populated (contacts with businessId + good data)`);

  const duplicate = laneCounts["PENDING_DUPLICATE_RESOLUTION"] ?? 0;
  assert(duplicate > 0, `PENDING_DUPLICATE_RESOLUTION populated (shared phone injected every 50)`);

  // Total processed equals CONTACT_COUNT
  const total = Object.values(laneCounts).reduce((a, b) => a + b, 0);
  assert(total === CONTACT_COUNT, `total classified = ${CONTACT_COUNT.toLocaleString()} (got ${total.toLocaleString()})`);

  // All lane keys are valid
  const validLanes = new Set<string>(ALL_RECONCILIATION_LANES);
  const invalidLanes = Object.keys(laneCounts).filter(l => !validLanes.has(l));
  assert(invalidLanes.length === 0, `all output lanes are valid (invalid: ${JSON.stringify(invalidLanes)})`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n── Reconciliation Performance Tests ─────────────────────────`);
  console.log(`   ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`);
  console.log(`─────────────────────────────────────────────────────────────\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("\nFatal error in reconciliation performance test:", err?.message ?? err);
  process.exit(1);
});
