#!/usr/bin/env npx tsx
/**
 * Smoke test for A-Lead Queue processor evidence surfacing (Task #734).
 * Zero live HTTP calls — exercises storage.getALeadQueue() directly against a real DB.
 * Exit 0 = pass, Exit 1 = fail.
 */

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

async function main() {
  const { db } = await import("../server/db");
  const { businesses, sdrMerchants, sdrLeadState, processorSignals } = await import("@shared/schema");
  const { storage } = await import("../server/storage");
  const { sql } = await import("drizzle-orm");

  const ts = Date.now();
  const createdBusinessIds: number[] = [];
  const createdMerchantIds: number[] = [];
  const createdLeadIds: number[] = [];
  const createdSignalIds: number[] = [];

  try {
    // ---------------------------------------------------------------------
    // Case A: lead's merchant has a businessId with a processorSignals row
    // ---------------------------------------------------------------------
    const [bizA] = await db.insert(businesses).values({
      canonicalName: `SmokeTest_ProcessorA_${ts}`,
      normalizedName: `smoketest_processora_${ts}`,
      city: "Miami",
      state: "FL",
    }).returning();
    createdBusinessIds.push(bizA.id);

    await db.insert(processorSignals).values({
      businessId: bizA.id,
      signalType: "checkout_widget",
      vendorName: "Square",
      detectionMethod: "html_fingerprint",
      confidenceScore: 0.92,
      evidence: "sq-payment-form class detected",
    }).returning().then(rows => createdSignalIds.push(rows[0].id));

    const [merchantA] = await db.insert(sdrMerchants).values({
      businessName: `SmokeTest_ProcessorA_${ts}`,
      businessId: bizA.id,
      source: "smoke_test",
      city: "Miami",
      state: "FL",
    }).returning();
    createdMerchantIds.push(merchantA.id);

    const [leadA] = await db.insert(sdrLeadState).values({
      merchantId: merchantA.id,
      stage: "NEW",
      currentStage: "NEW",
      priorityBucket: "A",
      priorityScore: 90,
      companyName: `SmokeTest_ProcessorA_${ts}`,
    }).returning();
    createdLeadIds.push(leadA.id);

    // ---------------------------------------------------------------------
    // Case B: no processorSignals row, but lead.enrichmentData carries a
    // processorSignals[] fallback array (pre-canonical-linking enrichment).
    // ---------------------------------------------------------------------
    const [merchantB] = await db.insert(sdrMerchants).values({
      businessName: `SmokeTest_ProcessorB_${ts}`,
      source: "smoke_test",
      city: "Tampa",
      state: "FL",
    }).returning();
    createdMerchantIds.push(merchantB.id);

    const [leadB] = await db.insert(sdrLeadState).values({
      merchantId: merchantB.id,
      stage: "NEW",
      currentStage: "NEW",
      priorityBucket: "A",
      priorityScore: 85,
      companyName: `SmokeTest_ProcessorB_${ts}`,
      enrichmentData: {
        processorSignals: [
          { vendor: "Clover", confidence: 0.4, detectionMethod: "html_fingerprint" },
          { vendor: "Toast", confidence: 0.77, detectionMethod: "html_fingerprint" },
        ],
      },
    }).returning();
    createdLeadIds.push(leadB.id);

    // ---------------------------------------------------------------------
    // Case C: no evidence anywhere — must resolve to "none" / vendor null.
    // ---------------------------------------------------------------------
    const [merchantC] = await db.insert(sdrMerchants).values({
      businessName: `SmokeTest_ProcessorC_${ts}`,
      source: "smoke_test",
      city: "Orlando",
      state: "FL",
    }).returning();
    createdMerchantIds.push(merchantC.id);

    const [leadC] = await db.insert(sdrLeadState).values({
      merchantId: merchantC.id,
      stage: "NEW",
      currentStage: "NEW",
      priorityBucket: "A",
      priorityScore: 80,
      companyName: `SmokeTest_ProcessorC_${ts}`,
    }).returning();
    createdLeadIds.push(leadC.id);

    // ---------------------------------------------------------------------
    // Run getALeadQueue() and assert against all 3 fixtures
    // ---------------------------------------------------------------------
    console.log("\n[1] getALeadQueue() returns processorEvidence for every lead");
    const queue = await storage.getALeadQueue();
    const byId = new Map(queue.map(l => [l.id, l]));

    const resA = byId.get(leadA.id);
    assert(!!resA, "Case A lead present in queue");
    assert(resA?.processorEvidence?.vendor === "Square", "Case A: vendor resolved from processorSignals table", JSON.stringify(resA?.processorEvidence));
    assert(resA?.processorEvidence?.source === "processorSignals", "Case A: source flagged as processorSignals");
    assert(resA?.processorEvidence?.confidence === 0.92, "Case A: confidence carried through");

    const resB = byId.get(leadB.id);
    assert(!!resB, "Case B lead present in queue");
    assert(resB?.processorEvidence?.vendor === "Toast", "Case B: fallback picks highest-confidence enrichmentData entry", JSON.stringify(resB?.processorEvidence));
    assert(resB?.processorEvidence?.source === "enrichmentData", "Case B: source flagged as enrichmentData fallback");

    const resC = byId.get(leadC.id);
    assert(!!resC, "Case C lead present in queue");
    assert(resC?.processorEvidence?.vendor === null, "Case C: no fabricated vendor when no evidence exists");
    assert(resC?.processorEvidence?.source === "none", "Case C: source flagged as none");

    console.log("\n[2] No detection logic side effects — processor-detector untouched by this query");
    const { readFileSync } = await import("fs");
    const src = readFileSync("server/services/sdr/processor-detector.ts", "utf8");
    assert(!src.includes("getALeadQueue"), "processor-detector.ts has no coupling to getALeadQueue (read-only consumption)");
  } finally {
    // Cleanup fixtures regardless of pass/fail
    for (const id of createdLeadIds) {
      await db.delete(sdrLeadState).where(sql`${sdrLeadState.id} = ${id}`);
    }
    for (const id of createdMerchantIds) {
      await db.delete(sdrMerchants).where(sql`${sdrMerchants.id} = ${id}`);
    }
    for (const id of createdSignalIds) {
      await db.delete(processorSignals).where(sql`${processorSignals.id} = ${id}`);
    }
    for (const id of createdBusinessIds) {
      await db.delete(businesses).where(sql`${businesses.id} = ${id}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
