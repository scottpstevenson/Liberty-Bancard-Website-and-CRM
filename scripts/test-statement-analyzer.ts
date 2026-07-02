/**
 * Fixture smoke test for statement-analyzer.ts
 * Run with: SKIP_AI=true npx tsx scripts/test-statement-analyzer.ts
 * Expected: EXIT 0
 *
 * Does NOT call live OpenAI (SKIP_AI=true returns fixture extraction).
 * Inserts a synthetic deal + document, runs analyzer, asserts expected DB state.
 * Uses the production storageKey pattern: "statements/<filename>"
 * (file lives at uploads/statements/<filename>)
 */

process.env.SKIP_AI = "true";
process.env.TEST_MODE = "true";
process.env.LIBERTY_TARGET_EFFECTIVE_RATE_BPS = "";

import { db } from "../server/db";
import { storage } from "../server/storage";
import { deals, contacts, documents, statementProposals } from "@shared/schema";
import { eq } from "drizzle-orm";
import { analyzeStatement } from "../server/services/statement-analyzer";
import path from "path";
import fs from "fs";

let dealId: number | null = null;
let contactId: number | null = null;
let documentId: number | null = null;
let syntheticFilePath: string | null = null;
let errors: string[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    errors.push(`FAIL: ${message}`);
    console.error(`  ✗ FAIL: ${message}`);
  } else {
    console.log(`  ✓ PASS: ${message}`);
  }
}

async function cleanup(): Promise<void> {
  if (dealId) {
    await db.delete(statementProposals).where(eq(statementProposals.dealId, dealId)).catch(() => {});
    if (documentId) {
      await db.delete(documents).where(eq(documents.id, documentId)).catch(() => {});
    }
    await db.delete(deals).where(eq(deals.id, dealId)).catch(() => {});
  }
  if (contactId) {
    await db.delete(contacts).where(eq(contacts.id, contactId)).catch(() => {});
  }
  if (syntheticFilePath && fs.existsSync(syntheticFilePath)) {
    fs.unlinkSync(syntheticFilePath);
  }
}

async function run(): Promise<void> {
  console.log("\n=== Statement Analyzer Smoke Test (SKIP_AI=true) ===\n");

  // 1 — Create synthetic contact + deal
  console.log("-- Setup: creating synthetic contact, deal, and document");
  const [contact] = await db.insert(contacts).values({
    firstName: "TestAnalyzer",
    lastName: "Smoke",
    email: `test-analyzer-${Date.now()}@smoke.test`,
    phone: "5550000000",
    businessType: "retail",
    leadStatus: "new",
  }).returning({ id: contacts.id });
  contactId = contact.id;

  const deal = await storage.createDeal({
    contactId: contactId,
    pipeline: "sales",
    stage: "Statement Received",
    analysisStatus: "pending",
  });
  dealId = deal.id;
  console.log(`  Created deal #${dealId}, contact #${contactId}`);

  // 2 — Write a synthetic statement file to uploads/statements/ (production path)
  const statementsDir = path.join(process.cwd(), "uploads", "statements");
  if (!fs.existsSync(statementsDir)) fs.mkdirSync(statementsDir, { recursive: true });

  const diskFileName = `${Date.now()}_smoke-test-statement-${dealId}.txt`;
  syntheticFilePath = path.join(statementsDir, diskFileName);
  const syntheticContent = `
MERCHANT PROCESSING STATEMENT
Merchant: Test Merchant LLC
Processor: Test Processor
Month: June 2026

Monthly Volume: $75,000.00
Total Fees: $2,250.00
Fixed Monthly Fee: $150.00
Authorization Fees: $90.00
Batch Fees: $30.00
PCI Compliance Fee: $20.00

Card Mix:
  Visa: 55%
  Mastercard: 25%
  American Express: 10%
  Debit: 10%

Top Charges:
1. Interchange Downgrades: $800
2. PCI Non-Compliance Fee: $250
3. Monthly Service Fee: $150
`;
  fs.writeFileSync(syntheticFilePath, syntheticContent, "utf-8");

  // 3 — Create document record using production storageKey format: "statements/<diskFileName>"
  const storageKey = `statements/${diskFileName}`;
  const [doc] = await db.insert(documents).values({
    contactId: contactId,
    dealId: dealId,
    type: "merchant_statement",
    category: "Statement",
    fileName: diskFileName,
    storageKey,
    mimeType: "text/plain",
    uploadedBy: "smoke-test",
    accessScope: "internal",
    status: "approved",
  }).returning({ id: documents.id });
  documentId = doc.id;
  console.log(`  Created document #${documentId} storageKey="${storageKey}"`);

  // 4 — Run analyzer (first call — should insert new row)
  console.log("\n-- Running analyzeStatement (first call — insert path)...");
  await analyzeStatement(dealId);

  // 5 — Assert statement_proposals row
  console.log("\n-- Assertions on statement_proposals (after first call):");
  const [proposal] = await db
    .select()
    .from(statementProposals)
    .where(eq(statementProposals.dealId, dealId))
    .limit(1);

  assert(!!proposal, "statement_proposals row exists for deal");
  assert(proposal?.status === "analyzed", `status = "analyzed" (got "${proposal?.status}")`);
  assert(!!proposal?.effectiveRate, `effectiveRate is set (got "${proposal?.effectiveRate}")`);
  assert(!!proposal?.savingsEstimate, `savingsEstimate is set (got "${proposal?.savingsEstimate}")`);
  assert(!!proposal?.notes, "notes field is set (contains JSON payload)");

  if (proposal?.notes) {
    try {
      const parsed = JSON.parse(proposal.notes);
      assert(typeof parsed.extraction === "object", "notes.extraction is an object");
      assert(typeof parsed.computedMetrics === "object", "notes.computedMetrics is an object");
      assert(typeof parsed.documentId === "number", "notes.documentId is a number");
      assert(parsed.extraction.processorName === "Test Processor", `extraction.processorName = "Test Processor" (got "${parsed.extraction.processorName}")`);
      assert(parsed.extraction.monthlyVolume === 75000, `extraction.monthlyVolume = 75000 (got ${parsed.extraction.monthlyVolume})`);
      assert(parsed.extraction.totalFees === 2250, `extraction.totalFees = 2250 (got ${parsed.extraction.totalFees})`);
      assert(typeof parsed.computedMetrics.effectiveRate === "number", "computedMetrics.effectiveRate is a number");
      assert(parsed.computedMetrics.effectiveRate > 0, `computedMetrics.effectiveRate > 0 (got ${parsed.computedMetrics.effectiveRate})`);
    } catch (e) {
      errors.push(`FAIL: notes is not valid JSON: ${(e as Error).message}`);
      console.error(`  ✗ FAIL: notes is not valid JSON`);
    }
  }

  assert(Array.isArray(proposal?.plans), "plans field remains an array (not overwritten)");

  // 6 — Run analyzer a second time (should UPDATE, not INSERT — idempotent)
  console.log("\n-- Running analyzeStatement (second call — update path, idempotent)...");
  await analyzeStatement(dealId);

  const allRows = await db
    .select({ id: statementProposals.id })
    .from(statementProposals)
    .where(eq(statementProposals.dealId, dealId));

  assert(allRows.length === 1, `Only 1 statement_proposals row exists after two calls (got ${allRows.length})`);

  const [proposalAfterSecond] = await db
    .select()
    .from(statementProposals)
    .where(eq(statementProposals.dealId, dealId))
    .limit(1);
  assert(proposalAfterSecond?.status === "analyzed", `status still "analyzed" after second call (got "${proposalAfterSecond?.status}")`);

  // 7 — Test corrupt-input → failed status (new deal, no document)
  console.log("\n-- Testing corrupt input (no document) → should set status='failed':");
  const emptyDeal = await storage.createDeal({
    contactId: contactId,
    pipeline: "sales",
    stage: "Statement Received",
    analysisStatus: "pending",
  });

  await analyzeStatement(emptyDeal.id);

  const [failedProposal] = await db
    .select()
    .from(statementProposals)
    .where(eq(statementProposals.dealId, emptyDeal.id))
    .limit(1);

  assert(!!failedProposal, "statement_proposals row created for no-document deal");
  assert(failedProposal?.status === "failed", `status = "failed" for no-document deal (got "${failedProposal?.status}")`);

  await db.delete(statementProposals).where(eq(statementProposals.dealId, emptyDeal.id)).catch(() => {});
  await db.delete(deals).where(eq(deals.id, emptyDeal.id)).catch(() => {});

  // 8 — Verify zero-outbound contract (source check)
  console.log("\n-- Verifying zero-outbound contract:");
  const analyzerSource = fs.readFileSync(
    path.join(process.cwd(), "server/services/statement-analyzer.ts"),
    "utf-8",
  );
  const forbiddenCalls = [
    "sendProposalEmail(",
    "sendSmtpEmail(",
    "autoGenerateProposal(",
    "autoEnrollFromTrigger(",
    "createGhlTask(",
    "sendGhlEmailForMerchant(",
    "enrollSequence(",
  ];
  for (const call of forbiddenCalls) {
    assert(
      !analyzerSource.includes(call),
      `No "${call}" call in statement-analyzer.ts`,
    );
  }

  // 9 — Verify no hardcoded rate literals
  assert(!analyzerSource.includes("0.0185"), 'No "0.0185" literal in statement-analyzer.ts');
  assert(!analyzerSource.includes("1.85"), 'No "1.85" literal in statement-analyzer.ts');

  // 10 — Cleanup
  console.log("\n-- Cleanup:");
  await cleanup();
  console.log("  Synthetic records removed.");

  console.log("\n=== Results ===");
  if (errors.length === 0) {
    console.log("ALL ASSERTIONS PASSED — EXIT 0");
    process.exit(0);
  } else {
    console.error(`\n${errors.length} assertion(s) failed:`);
    errors.forEach(e => console.error(" ", e));
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
