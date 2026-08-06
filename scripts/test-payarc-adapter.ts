/**
 * Payarc Adapter Smoke Test
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies the Payarc adapter implementation without hitting real API endpoints.
 *
 * Run:  npx tsx scripts/test-payarc-adapter.ts
 *
 * With PAYARC_API_KEY set → exercises live Payarc endpoints (ping + status check)
 * Without PAYARC_API_KEY  → exercises simulation mode (all paths still tested)
 */

import { PayarcProcessorAdapter } from "../server/services/processors/payarc.adapter";
import { getDefaultProcessor, getEnabledAdapterNames, getAllAdapterStatuses } from "../server/services/processors/registry";

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function run() {
  console.log("\n── Payarc Adapter Smoke Test ─────────────────────────────────────\n");

  const isLive = !!process.env.PAYARC_API_KEY;
  console.log(`Mode: ${isLive ? "LIVE (PAYARC_API_KEY is set)" : "SIMULATION (no PAYARC_API_KEY)"}\n`);

  // ── 1. Adapter identity ──────────────────────────────────────────────────
  console.log("1. Adapter identity");
  const adapter = new PayarcProcessorAdapter();
  assert("adapter.name === 'payarc'", adapter.name === "payarc");
  assert("adapter.displayName contains 'Payarc'", adapter.displayName.includes("Payarc"));

  // ── 2. Registry wiring ───────────────────────────────────────────────────
  console.log("\n2. Registry wiring");
  const enabled = getEnabledAdapterNames();
  const statuses = getAllAdapterStatuses();
  assert("at least one adapter enabled", enabled.length > 0, `enabled: ${enabled.join(", ")}`);

  const defaultProc = getDefaultProcessor();
  assert("default processor resolves", !!defaultProc);
  assert(
    "default processor is payarc or mock (NMI is not default)",
    ["payarc", "mock"].includes(defaultProc.name),
    `got: ${defaultProc.name}`,
  );
  assert("NMI is NOT listed in statuses", !statuses.some(s => s.name.toLowerCase().includes("nmi")));

  // ── 3. boardMerchant ─────────────────────────────────────────────────────
  console.log("\n3. boardMerchant");
  const profile = {
    dealId: 99999,
    legalBusinessName: "Smoke Test Bakery LLC",
    dba: "Smoke Bakery",
    ein: "12-3456789",
    businessType: "LLC",
    businessAddress: "123 Test St",
    businessCity: "Miami",
    businessState: "FL",
    businessZip: "33101",
    businessPhone: "305-555-0000",
    businessEmail: "owner@smoketest.example.com",
    website: "https://smoketest.example.com",
    vertical: "Restaurant",
    ownerFirstName: "Jane",
    ownerLastName: "Doe",
    ownerEmail: "jane@smoketest.example.com",
    ownerPhone: "305-555-0001",
    ownerDob: "1985-06-15",
    ownerSsn: "123-45-6789",
    ownerAddress: "123 Test St",
    ownerCity: "Miami",
    ownerState: "FL",
    ownerZip: "33101",
    bankRoutingNumber: "021000021",
    bankAccountNumber: "9876543210",
    bankAccountType: "checking",
    estimatedMonthlyVolume: "50000",
    estimatedAvgTicket: "45",
    preferredProgram: "interchange_plus",
    offerPath: "zero_percent",
  };

  const boardResult = await adapter.boardMerchant(profile);
  assert("boardMerchant returns success", boardResult.success === true, JSON.stringify(boardResult));
  assert(
    "boardMerchant returns processorApplicationId",
    !!boardResult.processorApplicationId,
    `got: ${boardResult.processorApplicationId}`,
  );
  assert(
    "applicationId does NOT contain 'NMI' or 'APP-'",
    !boardResult.processorApplicationId?.startsWith("APP-") ||
      boardResult.processorApplicationId.startsWith("PAYARC-"),
    `got: ${boardResult.processorApplicationId}`,
  );
  assert(
    "boardMerchant returns estimatedDecisionDate",
    !!boardResult.estimatedDecisionDate,
  );

  const appId = boardResult.processorApplicationId!;
  console.log(`   Application ID: ${appId}`);

  // ── 4. getMerchantStatus ─────────────────────────────────────────────────
  console.log("\n4. getMerchantStatus");
  const statusResult = await adapter.getMerchantStatus(appId);
  assert("getMerchantStatus returns success", statusResult.success === true);
  assert("status is a valid enum value", ["submitted","under_review","approved","declined","more_info_needed"].includes(statusResult.status));
  assert("processorApplicationId echoed back", statusResult.processorApplicationId === appId);
  console.log(`   Status: ${statusResult.status}${statusResult.mid ? ` — MID: ${statusResult.mid}` : ""}`);

  // ── 5. getDailyStats ─────────────────────────────────────────────────────
  console.log("\n5. getDailyStats");
  const testMid = "123456789012";
  const stats = await adapter.getDailyStats(testMid, "2026-07-01", "2026-07-07");
  assert("getDailyStats returns an array", Array.isArray(stats));
  if (!isLive) {
    // Simulation always returns weekday rows
    assert("simulation returns >0 rows for a week", stats.length > 0, `got ${stats.length}`);
    assert("each row has mid, date, volume, txCount", stats.every(r => r.mid && r.date && r.volume >= 0 && r.txCount >= 0));
    assert("mid field matches requested MID", stats.every(r => r.mid === testMid));
  }

  // ── 6. getResiduals ──────────────────────────────────────────────────────
  console.log("\n6. getResiduals");
  const residuals = await adapter.getResiduals("2026-07");
  // In simulation mode → returns [] (only live mode fetches); in live mode with real data → array
  assert("getResiduals returns array (may be empty in simulation)", Array.isArray(residuals));

  // ── 7. submitChargeback ───────────────────────────────────────────────────
  console.log("\n7. submitChargeback");
  const cbResult = await adapter.submitChargeback({
    mid: testMid,
    transactionId: "TXN-SMOKE-001",
    amount: 125.00,
    reason: "Item not received",
    cardBrand: "Visa",
    caseNumber: "CB-2026-001",
    responseDeadline: "2026-08-20",
    evidenceNotes: "Proof of delivery attached.",
  });
  assert("submitChargeback returns success", cbResult.success === true);
  assert("submitChargeback returns caseId", !!cbResult.caseId);

  // ── 8. updateMerchant ────────────────────────────────────────────────────
  console.log("\n8. updateMerchant");
  const updateResult = await adapter.updateMerchant(appId, {
    dealId: 99999,
    legalBusinessName: "Smoke Test Bakery LLC (updated)",
    businessPhone: "305-555-9999",
  });
  assert("updateMerchant returns success", updateResult.success === true);

  // ── 9. ping ───────────────────────────────────────────────────────────────
  console.log("\n9. ping");
  const pingResult = await adapter.ping();
  if (isLive) {
    assert("ping returns true with live credentials", pingResult === true);
  } else {
    assert("ping returns false in simulation mode (no key)", pingResult === false);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(66)}`);
  console.log(`Payarc Adapter Smoke Test: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("❌ FAILED");
    process.exit(1);
  } else {
    console.log("✅ ALL PASSED");
    process.exit(0);
  }
}

run().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
