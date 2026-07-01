/**
 * Idempotent migration: promote processor signals from sdrLeadState.enrichmentData JSONB
 * into the processorSignals table, but only for merchants that have a linked businessId.
 *
 * Safe to run multiple times — uses select-before-insert to avoid duplicates.
 *
 * Usage:
 *   npx tsx scripts/migrate-sdr-processor-signals.ts
 */

import { db } from "../server/db";
import { sdrLeadState, sdrMerchants, processorSignals } from "../shared/schema";
import { eq, isNotNull, and, sql } from "drizzle-orm";

async function main() {
  console.log("=== SDR Processor Signals Migration ===");

  const dupCheck = await db.execute(sql`
    SELECT business_id, vendor_name, COUNT(*) as cnt
    FROM processor_signals
    GROUP BY business_id, vendor_name
    HAVING COUNT(*) > 1
  `);
  if ((dupCheck.rows as any[]).length > 0) {
    console.warn(`WARNING: ${(dupCheck.rows as any[]).length} duplicate (businessId, vendorName) pairs already exist in processor_signals. These may corrupt getConversionByProcessor() counts.`);
  }

  const leadStates = await db.select({
    id: sdrLeadState.id,
    merchantId: sdrLeadState.merchantId,
    enrichmentData: sdrLeadState.enrichmentData,
  }).from(sdrLeadState).where(isNotNull(sdrLeadState.enrichmentData));

  let migrated = 0;
  let skipped = 0;
  let noBusinessId = 0;
  let noSignals = 0;

  for (const ls of leadStates) {
    const enrichment = ls.enrichmentData as Record<string, any> | null;
    if (!enrichment || !Array.isArray(enrichment.processorSignals) || enrichment.processorSignals.length === 0) {
      noSignals++;
      continue;
    }

    if (!ls.merchantId) {
      noBusinessId++;
      continue;
    }

    const [merchant] = await db.select({ businessId: sdrMerchants.businessId })
      .from(sdrMerchants)
      .where(eq(sdrMerchants.id, ls.merchantId))
      .limit(1);

    if (!merchant?.businessId) {
      noBusinessId++;
      continue;
    }

    const businessId = merchant.businessId;

    for (const signal of enrichment.processorSignals) {
      const vendorName = signal.vendorName || signal.vendor || "unknown";
      const signalType = signal.signalType || signal.type || "processor";
      const detectionMethod = signal.detectionMethod || signal.method || "enrichment_data";
      const confidenceScore = typeof signal.confidenceScore === "number" ? signal.confidenceScore : 0;
      const evidence = signal.evidence || null;

      const [existing] = await db.select({ id: processorSignals.id })
        .from(processorSignals)
        .where(and(
          eq(processorSignals.businessId, businessId),
          eq(processorSignals.vendorName, vendorName),
        ))
        .limit(1);

      if (existing) {
        skipped++;
        continue;
      }

      await db.insert(processorSignals).values({
        businessId,
        signalType,
        vendorName,
        detectionMethod,
        confidenceScore,
        evidence,
      });
      migrated++;
    }
  }

  console.log("");
  console.log("=== Summary ===");
  console.log(`Migrated:      ${migrated}`);
  console.log(`Skipped (dup): ${skipped}`);
  console.log(`No businessId: ${noBusinessId}`);
  console.log(`No signals:    ${noSignals}`);
  console.log("Done. Safe to run again — no duplicates will be created.");

  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
