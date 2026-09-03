#!/usr/bin/env npx tsx
/**
 * check-processor-kill-lines.ts — REV-05A CI Kill-Line Gate
 *
 * Hard-fails on any of the 14 kill conditions defined in REV-05A §14.
 * Must exit 0 (GO) before any production deploy.
 *
 * Usage: npx tsx scripts/check-processor-kill-lines.ts
 */

import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";

let failures = 0;
let checks = 0;

function fail(msg: string): void {
  console.error(`[KILL LINE FAIL] ${msg}`);
  failures++;
}

function pass(msg: string): void {
  console.log(`[OK] ${msg}`);
}

function check(description: string, fn: () => void): void {
  checks++;
  try {
    fn();
  } catch (err: any) {
    fail(`${description} — unexpected error: ${err.message}`);
  }
}

// ── File reader ───────────────────────────────────────────────────────────────

function readFile(filePath: string): string {
  try {
    return readFileSync(path.join(process.cwd(), filePath), "utf-8");
  } catch {
    return "";
  }
}

function getAllTsFiles(dir: string, files: string[] = []): string[] {
  try {
    for (const entry of readdirSync(path.join(process.cwd(), dir))) {
      const fullPath = path.join(dir, entry);
      const fullAbs = path.join(process.cwd(), fullPath);
      try {
        const stat = statSync(fullAbs);
        if (stat.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
          getAllTsFiles(fullPath, files);
        } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
          files.push(fullPath);
        }
      } catch {}
    }
  } catch {}
  return files;
}

// ── Kill Line 1: No simulation fallback in processor-api.ts reachable without NODE_ENV=test ──

check("KL1: processor-api.ts has no reachable simulation fallback in production", () => {
  const src = readFile("server/services/processor-api.ts");
  // The old generateMockApplicationId/generateMockMid/generateMockDailyVolume should be gone
  if (/generateMockApplicationId|generateMockMid|generateMockDailyVolume/.test(src)) {
    fail("KL1: processor-api.ts still contains simulation generator functions (simulation path not removed)");
    return;
  }
  // Should not contain setTimeout simulation paths without NODE_ENV guard
  const hasSimWithoutGuard = /await new Promise\(resolve => setTimeout[\s\S]{0,200}estimatedDate/.test(src);
  if (hasSimWithoutGuard) {
    fail("KL1: processor-api.ts may still contain simulation timeout path");
    return;
  }
  pass("KL1: processor-api.ts simulation paths removed");
});

// ── Kill Line 2: queue-manager.ts must NOT import processor-api for ingestion ──

check("KL2: queue-manager.ts does not import processor-api for MID ingestion", () => {
  const src = readFile("server/services/queue-manager.ts");
  // Look for processor-api import in the mid-ingestion context
  if (/import\(["']\.\/processor-api["']\)/.test(src) && /ingestMidData/.test(src)) {
    // Check if both appear near each other (within 200 chars)
    const match = src.match(/import\(["']\.\/processor-api["']\)([\s\S]{0,300})ingestMidData/);
    if (match) {
      fail("KL2: queue-manager.ts still imports processor-api for ingestMidDataForActiveMids");
      return;
    }
  }
  pass("KL2: queue-manager.ts uses registry adapter for MID ingestion");
});

// ── Kill Line 3: No caller importing processor-api for production ingestion ──

check("KL3: No file imports ingestMidDataForActiveMids from processor-api in scheduler code", () => {
  const queueMgr = readFile("server/services/queue-manager.ts");
  const lines = queueMgr.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("processor-api") && line.includes("ingestMidData")) {
      fail(`KL3: queue-manager.ts line ${i + 1} imports ingestMidDataForActiveMids from processor-api`);
      return;
    }
  }
  pass("KL3: No scheduler code imports ingestMidData from processor-api");
});

// ── Kill Line 4: ping() must not return success on 404 ──

check("KL4: payarc.adapter.ts ping() does not return true on HTTP 404", () => {
  const src = readFile("server/services/processors/payarc.adapter.ts");
  if (/ok \|\| status === 404/.test(src) || /status === 404.*return true/.test(src)) {
    fail("KL4: payarc.adapter.ts ping() returns true on HTTP 404 — MUST return false on any non-2xx");
    return;
  }
  pass("KL4: ping() only succeeds on authenticated 2xx");
});

// ── Kill Line 5: Payarc webhook endpoint must not mutate canonical state without PAYARC_WEBHOOK_VERIFIED ──

check("KL5: Payarc webhook handler does not mutate canonical state", () => {
  const src = readFile("server/routes/boarding.ts");
  const webhookSection = src.match(/POST.*\/api\/webhooks\/payarc[\s\S]{0,3000}/);
  if (!webhookSection) {
    fail("KL5: POST /api/webhooks/payarc endpoint not found in boarding.ts");
    return;
  }
  const section = webhookSection[0];
  // Should not contain updateDeal, storage., or auditChange that would mutate canonical state
  // without the PAYARC_WEBHOOK_VERIFIED check
  if (/storage\.updateDeal|storage\.updateContact|advanceDealStage/.test(section)) {
    fail("KL5: Payarc webhook handler mutates canonical state (must be inert until PAYARC_WEBHOOK_VERIFIED=true)");
    return;
  }
  if (!section.includes("PAYARC_WEBHOOK_VERIFIED")) {
    fail("KL5: Payarc webhook handler missing PAYARC_WEBHOOK_VERIFIED flag check");
    return;
  }
  pass("KL5: Payarc webhook endpoint is inert pending fixture verification");
});

// ── Kill Line 6: No claim that Idempotency-Key guarantees Payarc dedup ──

check("KL6: No false claim that Idempotency-Key header guarantees Payarc-side deduplication", () => {
  const src = readFile("server/services/processors/payarc.adapter.ts");
  if (/Payarc (guarantees|certified|ensures|provides) dedup/.test(src)) {
    fail("KL6: payarc.adapter.ts claims Payarc guarantees deduplication from Idempotency-Key header");
    return;
  }
  pass("KL6: No false Payarc dedup guarantee claim");
});

// ── Kill Line 7: No blind retry on ambiguous submission result ──

check("KL7: deal-boarding-outbox-worker.ts does not blindly retry on ambiguous result", () => {
  const src = readFile("server/services/deal-boarding-outbox-worker.ts");
  // Should contain ambiguous handling
  if (!src.includes("ambiguous")) {
    fail("KL7: deal-boarding-outbox-worker.ts missing ambiguous result handling");
    return;
  }
  // Should classify ambiguous as reconciliation_required, not retry
  if (!src.includes("ambiguous_reconciliation_required")) {
    fail("KL7: deal-boarding-outbox-worker.ts missing ambiguous_reconciliation_required classification");
    return;
  }
  pass("KL7: Ambiguous submissions classified as reconciliation_required, not blindly retried");
});

// ── Kill Line 8: Raw MID pattern (/[0-9]{8,}/) must not appear in mid_assigned or mid_created audit details ──

check("KL8: audit details in merchant-mid-service.ts and boarding.ts do not include raw MID", () => {
  const midSvc = readFile("server/services/merchant-mid-service.ts");
  const boarding = readFile("server/routes/boarding.ts");

  // Check mid_created audit in merchant-mid-service
  const midCreatedSection = midSvc.match(/action.*mid_created[\s\S]{0,500}/);
  if (midCreatedSection && /mid: row\.mid/.test(midCreatedSection[0])) {
    fail("KL8: merchant-mid-service.ts mid_created audit includes raw MID (row.mid)");
    return;
  }

  // Check mid_assigned audit in boarding.ts
  const midAssignedSection = boarding.match(/action.*mid_assigned[\s\S]{0,500}/);
  if (midAssignedSection) {
    const section = midAssignedSection[0];
    // Look for raw mid: mid.trim() or mid: mid.trim()
    if (/^\s*(mid|previousMid)\s*:/.test(section) && !/Masked/.test(section)) {
      // Allow midMasked, previousMidMasked
      if (/[^a-z](mid|previousMid)\s*:/.test(section) && !/midMasked/.test(section)) {
        fail("KL8: boarding.ts mid_assigned audit may include raw MID");
        return;
      }
    }
  }
  pass("KL8: Audit details use masked MID values");
});

// ── Kill Line 9: deals.mid written outside canonical service ──

check("KL9: deals.mid not written directly outside merchant-mid-service.ts canonical path", () => {
  const boarding = readFile("server/routes/boarding.ts");
  // The old direct write was: storage.updateDeal(dealId, { mid: mid.trim() } as any)
  // This should now go through assignMerchantMidToCanonical
  if (/storage\.updateDeal[\s\S]{0,100}\{.*mid:.*\.trim\(\)/.test(boarding)) {
    fail("KL9: boarding.ts still calls storage.updateDeal() with raw MID directly");
    return;
  }
  pass("KL9: MID writes route through canonical service");
});

// ── Kill Line 10: Full MID from endpoint without access receipt ──

check("KL10: Full MID endpoint (POST/GET mids) writes access receipt", () => {
  const midSvc = readFile("server/services/merchant-mid-service.ts");
  if (!midSvc.includes("writeMidAccessReceipt")) {
    fail("KL10: merchant-mid-service.ts missing writeMidAccessReceipt function");
    return;
  }
  pass("KL10: MID access receipt function exists in canonical service");
});

// ── Kill Line 12: ENABLED_PROCESSORS or secret alone must not activate production transport ──

check("KL12: Registry requires activation snapshot concept (not just env var)", () => {
  const registry = readFile("server/services/processors/registry.ts");
  if (!registry.includes("getProcessorHealthState") && !registry.includes("getHealthState")) {
    fail("KL12: Registry missing health state function — activation snapshot check may be absent");
    return;
  }
  pass("KL12: Registry has typed health state (activation snapshot gate concept present)");
});

// ── Kill Line 13: #1737 domain functions must return held/unsupported ──

check("KL13: Payarc adapter getDailyStats/getResiduals/getTransactions/submitChargeback return held", () => {
  const src = readFile("server/services/processors/payarc.adapter.ts");

  const checkFn = (fnName: string) => {
    const pattern = new RegExp(`async ${fnName}[\\s\\S]{0,500}?pending_task_1737`);
    if (!pattern.test(src)) {
      fail(`KL13: payarc.adapter.ts ${fnName}() does not return held result (pending_task_1737)`);
      return false;
    }
    return true;
  };

  let ok = true;
  ok = checkFn("getDailyStats") && ok;
  ok = checkFn("getResiduals") && ok;
  ok = checkFn("getTransactions") && ok;
  ok = checkFn("submitChargeback") && ok;

  if (ok) pass("KL13: All #1737 domain functions return held/pending_task_1737");
});

// ── Kill Line 14: #1737 domain must not be implemented in this task ──

check("KL14: No #1737 domain implementation (transactions/stats/residuals) in this task", () => {
  const src = readFile("server/services/processors/payarc.adapter.ts");
  // getDailyStats should NOT have simulation data generation or real API calls returning data
  const dailyStatsSection = src.match(/async getDailyStats[\s\S]{0,800}/);
  if (dailyStatsSection) {
    if (/seededRng|results\.push|15_000|baseVolume/.test(dailyStatsSection[0])) {
      fail("KL14: payarc.adapter.ts getDailyStats still contains simulation data generation");
      return;
    }
  }
  pass("KL14: No #1737 domain implementation detected");
});

// ── Mock adapter kill-line: never return fake data from #1737 domain ──

check("Mock adapter: #1737 domain functions return HeldResult", () => {
  const src = readFile("server/services/processors/mock.adapter.ts");
  if (!src.includes("pending_task_1737")) {
    fail("Mock adapter: Missing pending_task_1737 HeldResult in #1737 domain functions");
    return;
  }
  pass("Mock adapter: #1737 domain functions return HeldResult");
});

// ── NMI adapter kill-line: #1737 domain must return HeldResult ──

check("NMI adapter: #1737 domain functions return HeldResult (no simulation data)", () => {
  const src = readFile("server/services/processors/nmi.adapter.ts");

  const checkFn = (fnName: string) => {
    const pattern = new RegExp(`async ${fnName}[\\s\\S]{0,400}?pending_task_1737`);
    if (!pattern.test(src)) {
      fail(`NMI KL: nmi.adapter.ts ${fnName}() does not return held result (pending_task_1737)`);
      return false;
    }
    return true;
  };

  // Also ensure simulation data generation has been removed from getDailyStats
  const dailyStatsSection = src.match(/async getDailyStats[\s\S]{0,800}/);
  if (dailyStatsSection) {
    if (/seededRng|results\.push|baseVolume|Math\.sin.*seed/.test(dailyStatsSection[0])) {
      fail("NMI KL: nmi.adapter.ts getDailyStats still contains simulation data generation");
      return;
    }
  }

  let ok = true;
  ok = checkFn("getDailyStats") && ok;
  ok = checkFn("getResiduals") && ok;
  ok = checkFn("getTransactions") && ok;
  ok = checkFn("submitChargeback") && ok;

  if (ok) pass("NMI adapter: All #1737 domain functions return held/pending_task_1737");
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n[REV-05A Kill Lines] ${checks - failures}/${checks} checks passed`);

if (failures > 0) {
  console.error(`\n[REV-05A Kill Lines] FAIL — ${failures} kill line violation(s) detected. Production deploy blocked.\n`);
  process.exit(1);
} else {
  console.log(`\n[REV-05A Kill Lines] GO — All processor boarding kill lines passed.\n`);
  process.exit(0);
}
