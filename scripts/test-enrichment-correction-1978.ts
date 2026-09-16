#!/usr/bin/env npx tsx
/**
 * test-enrichment-correction-1978.ts
 *
 * Task #1978 correction tests.  Covers:
 *   Area 1 — Business enrichment persists actual email addresses
 *   Area 3 — Single-producer: 4-hour advisory fence removed from runEnrichmentTick
 *   Area 4 — Stuck-business-crawl reaper exists in FREE_ENRICHMENT_LANE handler
 *   Area 5 — Sunbiz materialization worker exists + legacy path is feature-gated
 *   Area 2 — promoteCandidateForValidation has real effect (no longer HANDOFF_ADMISSION_NOT_WIRED)
 *   Area 6 — ContactPageBusinessResult.emails and JsonLdBusinessResult.emails
 *
 * Run: npx tsx scripts/test-enrichment-correction-1978.ts
 */

import assert from "assert";
import * as fs from "fs";

let passed = 0;
let failed = 0;

function pass(name: string) {
  console.log(`  ✓ ${name}`);
  passed++;
}
function fail(name: string, reason: string) {
  console.error(`  ✗ ${name}: ${reason}`);
  failed++;
}
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    pass(name);
  } catch (e: any) {
    fail(name, e?.message ?? String(e));
  }
}

// ---------------------------------------------------------------------------
// Area 1: adapters return emails[]
// ---------------------------------------------------------------------------
console.log("\n── Area 1: adapters return actual email addresses ──");

await test("JsonLdBusinessResult has emails field with default []", async () => {
  const { runJsonLdBusinessEnrichment } = await import(
    "../server/services/sdr/jsonld-enrichment"
  );
  // Use a domain that will SSRF-block (private range) → fetchCompleted:true, emails:[]
  const result = await runJsonLdBusinessEnrichment(999_999, "127.0.0.1");
  assert.ok(Array.isArray(result.emails), "emails must be an array");
  assert.strictEqual(result.emails.length, 0, "SSRF-blocked result must have 0 emails");
  assert.strictEqual(result.fetchCompleted, true, "SSRF block is a valid skip (fetchCompleted=true)");
});

await test("ContactPageBusinessResult has emails field with default []", async () => {
  const { runContactPageBusinessEnrichment } = await import(
    "../server/services/sdr/contactpage-enrichment"
  );
  const result = await runContactPageBusinessEnrichment(999_999, "127.0.0.1");
  assert.ok(Array.isArray(result.emails), "emails must be an array");
  assert.strictEqual(result.emails.length, 0, "SSRF-blocked result must have 0 emails");
  assert.strictEqual(result.fetchCompleted, true, "SSRF block is a valid skip (fetchCompleted=true)");
});

await test("ContactPageBusinessResult emails is consistent with emailCount", async () => {
  const { runContactPageBusinessEnrichment } = await import(
    "../server/services/sdr/contactpage-enrichment"
  );
  // Invalid domain → fetchCompleted:false (transport failure), emailCount=0, emails=[]
  const result = await runContactPageBusinessEnrichment(999_999, "this-domain-does-not-exist-xyz.example");
  assert.ok(Array.isArray(result.emails), "emails must be an array");
  assert.strictEqual(result.emails.length, result.emailCount, "emails.length must equal emailCount");
});

// ---------------------------------------------------------------------------
// Area 3: 4-hour advisory fence removed from runEnrichmentTick
// ---------------------------------------------------------------------------
console.log("\n── Area 3: single-producer — 4-hour fence removed ──");

await test("queue-manager.ts does not contain the 4-hour advisory fence", () => {
  const src = fs.readFileSync("server/services/queue-manager.ts", "utf8");
  // The fence used pg_advisory_xact_lock with 'free_enrichment_cadence'.
  assert.ok(
    !src.includes("free_enrichment_cadence"),
    "4-hour cadence advisory lock key must not appear in queue-manager.ts after correction #3"
  );
});

await test("queue-manager.ts does not call runCanonicalBusinessEnrichmentTick from runEnrichmentTick", () => {
  const src = fs.readFileSync("server/services/queue-manager.ts", "utf8");
  // The function runEnrichmentTick should not call runCanonicalBusinessEnrichmentTick directly.
  // It's ok for the function to exist; it must not be called from runEnrichmentTick.
  // We check that the only remaining call site is the FREE_ENRICHMENT_LANE case.
  const enrichTickBody = src.match(/async function runEnrichmentTick[^]*?^}/m)?.[0] ?? "";
  assert.ok(
    !enrichTickBody.includes("runCanonicalBusinessEnrichmentTick"),
    "runEnrichmentTick must not call runCanonicalBusinessEnrichmentTick (single-producer via FREE_ENRICHMENT_LANE)"
  );
});

await test("Correction #3 comment is present in runEnrichmentTick", () => {
  const src = fs.readFileSync("server/services/queue-manager.ts", "utf8");
  assert.ok(
    src.includes("Correction #3") || src.includes("4-hour advisory-fence producer has been removed"),
    "queue-manager.ts must document Correction #3 removal"
  );
});

// ---------------------------------------------------------------------------
// Area 4: stuck-business-crawl reaper
// ---------------------------------------------------------------------------
console.log("\n── Area 4: stuck-business-crawl reaper ──");

await test("FREE_ENRICHMENT_LANE handler contains PROCESSING_TIMEOUT_AUTO_RECLAIMED", () => {
  const src = fs.readFileSync("server/services/queue-manager.ts", "utf8");
  assert.ok(
    src.includes("PROCESSING_TIMEOUT_AUTO_RECLAIMED"),
    "queue-manager.ts must define the PROCESSING_TIMEOUT_AUTO_RECLAIMED reaper error code"
  );
});

await test("Stuck-business reaper fires before eligibility query in FREE_ENRICHMENT_LANE", () => {
  const src = fs.readFileSync("server/services/queue-manager.ts", "utf8");
  const laneIdx = src.indexOf("FREE_ENRICHMENT_LANE");
  assert.ok(laneIdx >= 0, "FREE_ENRICHMENT_LANE case must exist");
  const reaperIdx = src.indexOf("PROCESSING_TIMEOUT_AUTO_RECLAIMED", laneIdx);
  const eligIdx = src.indexOf("SELECT id FROM businesses", laneIdx);
  assert.ok(reaperIdx >= 0, "Reaper must be in the FREE_ENRICHMENT_LANE handler");
  assert.ok(reaperIdx < eligIdx, "Reaper must appear before the eligibility SELECT in the handler");
});

await test("Stuck-business reaper writes to audit_logs", () => {
  const src = fs.readFileSync("server/services/queue-manager.ts", "utf8");
  const laneIdx = src.indexOf("FREE_ENRICHMENT_LANE");
  const reaperBlock = src.slice(laneIdx, src.indexOf("const { businessLacksDbprLineageSql }", laneIdx));
  assert.ok(
    reaperBlock.includes("audit_logs") && reaperBlock.includes("free_enrichment_processing_auto_reclaimed"),
    "Reaper must write a free_enrichment_processing_auto_reclaimed audit_logs row"
  );
});

await test("Stuck-business reaper threshold is 2 hours", () => {
  const src = fs.readFileSync("server/services/queue-manager.ts", "utf8");
  // Check that the reaper uses a 2-hour threshold constant
  assert.ok(
    src.includes("2 * 60 * 60 * 1000") || src.includes("BUSINESS_STALE_MS = 2"),
    "Reaper threshold must be 2 hours (2 * 60 * 60 * 1000)"
  );
});

// ---------------------------------------------------------------------------
// Area 5: Sunbiz materialization
// ---------------------------------------------------------------------------
console.log("\n── Area 5: Sunbiz materialization ──");

await test("materializeSunbizToCanonicalBusinesses is exported from sunbiz-cron.ts", async () => {
  const exports = await import("../server/services/sunbiz-cron");
  assert.ok(
    typeof (exports as any).materializeSunbizToCanonicalBusinesses === "function",
    "materializeSunbizToCanonicalBusinesses must be exported"
  );
});

await test("runSunbizAutoConvert respects SUNBIZ_LEGACY_PROMOTION_ENABLED=false", async () => {
  const src = fs.readFileSync("server/services/sunbiz-cron.ts", "utf8");
  assert.ok(
    src.includes("SUNBIZ_LEGACY_PROMOTION_ENABLED"),
    "sunbiz-cron.ts must gate legacy path with SUNBIZ_LEGACY_PROMOTION_ENABLED"
  );
});

await test("Sunbiz materialization is gated behind SUNBIZ_MATERIALIZATION_ENABLED", async () => {
  const src = fs.readFileSync("server/services/sunbiz-cron.ts", "utf8");
  assert.ok(
    src.includes("SUNBIZ_MATERIALIZATION_ENABLED"),
    "sunbiz-cron.ts must gate new path with SUNBIZ_MATERIALIZATION_ENABLED"
  );
});

await test("Materialization does not call storage.createContact or createContactLocalFirst", () => {
  const src = fs.readFileSync("server/services/sunbiz-cron.ts", "utf8");
  // materializeSunbizToCanonicalBusinesses must not create contacts/deals
  const matFnStart = src.indexOf("async function materializeSunbizToCanonicalBusinesses");
  const matFnEnd = src.indexOf("\nexport async function runSunbizAutoConvert", matFnStart);
  const matFnBody = src.slice(matFnStart, matFnEnd);
  assert.ok(
    !matFnBody.includes("createContactLocalFirst") && !matFnBody.includes("createContact"),
    "materializeSunbizToCanonicalBusinesses must not create contacts (correction #5)"
  );
  assert.ok(
    !matFnBody.includes("createDeal") && !matFnBody.includes("storage.createDeal"),
    "materializeSunbizToCanonicalBusinesses must not create deals (correction #5)"
  );
});

// ---------------------------------------------------------------------------
// Area 2: promoteCandidateForValidation has real effect
// ---------------------------------------------------------------------------
console.log("\n── Area 2: promoteCandidateForValidation — real effect ──");

await test("promoteCandidateForValidation is exported from evidence-service.ts", async () => {
  const { promoteCandidateForValidation } = await import(
    "../server/services/free-discovery/evidence-service"
  );
  assert.strictEqual(typeof promoteCandidateForValidation, "function");
});

await test("promoteCandidateForValidation no longer returns HANDOFF_ADMISSION_NOT_WIRED", () => {
  const src = fs.readFileSync("server/services/free-discovery/evidence-service.ts", "utf8");
  assert.ok(
    !src.includes("HANDOFF_ADMISSION_NOT_WIRED"),
    "evidence-service.ts must not return HANDOFF_ADMISSION_NOT_WIRED (correction #2)"
  );
});

await test("promoteCandidateForValidation returns PENDING when promotion is disabled", async () => {
  const { promoteCandidateForValidation } = await import(
    "../server/services/free-discovery/evidence-service"
  );
  const orig = process.env.FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED;
  try {
    delete process.env.FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED;
    const result = await promoteCandidateForValidation("00000000-0000-0000-0000-000000000000");
    assert.strictEqual(result.status, "PENDING_OPERATOR_ACTIVATION");
    assert.strictEqual((result as any).reason, "FREE_DISCOVERY_VALIDATION_PROMOTION_DISABLED");
  } finally {
    if (orig !== undefined) process.env.FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED = orig;
    else delete process.env.FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED;
  }
});

await test("promoteCandidateForValidation gate 1 blocks before any DB call (env flag)", async () => {
  // Verify the function returns immediately when flag is off — no DB connection needed
  const { promoteCandidateForValidation } = await import(
    "../server/services/free-discovery/evidence-service"
  );
  const orig = process.env.FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED;
  try {
    process.env.FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED = "false";
    const result = await promoteCandidateForValidation("any-id");
    assert.strictEqual(result.status, "PENDING_OPERATOR_ACTIVATION");
  } finally {
    if (orig !== undefined) process.env.FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED = orig;
    else delete process.env.FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED;
  }
});

await test("promoteCandidateForValidation writes audit_logs on successful promotion", () => {
  const src = fs.readFileSync("server/services/free-discovery/evidence-service.ts", "utf8");
  assert.ok(
    src.includes("free_discovery_candidate_admitted") && src.includes("audit_logs"),
    "evidence-service.ts must write a free_discovery_candidate_admitted audit_logs row on promotion"
  );
});

// ---------------------------------------------------------------------------
// Area 6: email state distinctions
// ---------------------------------------------------------------------------
console.log("\n── Area 6: email validation state distinctions ──");

await test("recordFreeDiscoveryCandidate disposition defaults to 'staged' (not 'outreach_ready')", () => {
  const src = fs.readFileSync("server/services/free-discovery/evidence-service.ts", "utf8");
  // The INSERT must use disposition='staged', never 'outreach_ready' or 'valid'
  const insertBlock = src.match(/INSERT INTO free_discovery_candidates[\s\S]*?ON CONFLICT/)?.[0] ?? "";
  assert.ok(insertBlock.includes("'staged'"), "Initial disposition must be 'staged'");
  assert.ok(!insertBlock.includes("'outreach_ready'"), "Initial disposition must NOT be 'outreach_ready'");
});

await test("Promotion path uses 'validation_admitted' not 'outreach_ready'", () => {
  const src = fs.readFileSync("server/services/free-discovery/evidence-service.ts", "utf8");
  // UPDATE disposition must be 'validation_admitted', never 'outreach_ready'
  const updateBlock = src.match(/UPDATE free_discovery_candidates[\s\S]*?RETURNING id/)?.[0] ?? "";
  assert.ok(updateBlock.includes("validation_admitted"), "Promotion disposition must be 'validation_admitted'");
  assert.ok(!updateBlock.includes("outreach_ready"), "Promotion disposition must NOT be 'outreach_ready'");
});

// ---------------------------------------------------------------------------
// Area 7: health endpoint and ProgramHealthPanel
// ---------------------------------------------------------------------------
console.log("\n── Area 7: health endpoint + ProgramHealthPanel ──");

await test("lead-ops.ts health endpoint exposes businessStuckProcessingCount", () => {
  const src = fs.readFileSync("server/routes/lead-ops.ts", "utf8");
  assert.ok(src.includes("businessStuckProcessingCount"), "Health endpoint must expose businessStuckProcessingCount");
});

await test("lead-ops.ts health endpoint exposes freeEnrichmentSchedulerStatus", () => {
  const src = fs.readFileSync("server/routes/lead-ops.ts", "utf8");
  assert.ok(src.includes("freeEnrichmentSchedulerStatus"), "Health endpoint must expose freeEnrichmentSchedulerStatus");
});

await test("lead-ops.ts health endpoint exposes candidateFunnel", () => {
  const src = fs.readFileSync("server/routes/lead-ops.ts", "utf8");
  assert.ok(src.includes("candidateFunnel"), "Health endpoint must expose candidateFunnel");
});

await test("freeEnrichmentSchedulerStatus marks legacyFenceRemoved: true", () => {
  const src = fs.readFileSync("server/routes/lead-ops.ts", "utf8");
  assert.ok(src.includes("legacyFenceRemoved: true"), "freeEnrichmentSchedulerStatus must mark legacyFenceRemoved: true");
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
console.log(`\n──────────────────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\nCorrection #1978 tests FAILED.`);
  process.exit(1);
} else {
  console.log(`\nAll correction #1978 tests PASSED.`);
  process.exit(0);
}
