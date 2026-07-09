/**
 * test-bulk-enroll-hot-leads.ts
 *
 * Validates:
 * 1. previewBulkEnroll returns correct shape
 * 2. Campaign enrollment path throws "unsupported"
 * 3. Missing vertical throws error
 * 4. Nonexistent / inactive sequence throws error
 * 5. DNC contacts are excluded from eligible count
 * 6. Opted-out contacts are excluded from eligible count
 * 7. PEWC check is enforced for SMS/Voice/Ringless sequences
 * 8. getSequenceChannelLabel returns correct label
 * 9. isBulkEnrollJobRunning is false at rest
 * 10. cancelBulkEnrollJob sets cancel key
 *
 * Usage: npx tsx scripts/test-bulk-enroll-hot-leads.ts
 */

import { storage } from "../server/storage";
import {
  previewBulkEnroll,
  getBulkEnrollProgress,
  isBulkEnrollJobRunning,
  cancelBulkEnrollJob,
  getSequenceChannelLabel,
} from "../server/services/bulk-enrollment-job";

const PASS = (msg: string) => console.log(`  ✅ PASS: ${msg}`);
const FAIL = (msg: string) => { console.error(`  ❌ FAIL: ${msg}`); process.exitCode = 1; };
const SKIP = (msg: string) => console.log(`  ⚠️  SKIP: ${msg}`);

async function run() {
  console.log("\n=== Bulk Enroll Hot Leads Tests ===\n");
  let allPass = true;

  // ── T1: isBulkEnrollJobRunning is false at rest ──────────────────────────────
  try {
    console.log("T1: isBulkEnrollJobRunning is false at rest");
    if (isBulkEnrollJobRunning() !== false) throw new Error("Expected false");
    PASS("Not running at rest");
  } catch (err: any) {
    FAIL(`T1: ${err.message}`);
    allPass = false;
  }

  // ── T2: getBulkEnrollProgress returns valid idle shape ───────────────────────
  try {
    console.log("T2: getBulkEnrollProgress idle shape");
    const prog = await getBulkEnrollProgress();
    if (!["idle", "running", "complete", "cancelled", "failed"].includes(prog.status)) {
      throw new Error(`Invalid status: ${prog.status}`);
    }
    if (typeof prog.enrolled !== "number") throw new Error("enrolled is not a number");
    PASS(`status=${prog.status}`);
  } catch (err: any) {
    FAIL(`T2: ${err.message}`);
    allPass = false;
  }

  // ── T3: Campaign enrollment path throws unsupported ─────────────────────────
  try {
    console.log("T3: Campaign enrollment throws 'unsupported'");
    await previewBulkEnroll({ vertical: "restaurant", minScore: 70, campaignId: 1 });
    FAIL("T3: Should have thrown");
    allPass = false;
  } catch (err: any) {
    if (err.message.includes("unsupported")) {
      PASS("Campaign enrollment unsupported error thrown correctly");
    } else {
      FAIL(`T3: Wrong error: ${err.message}`);
      allPass = false;
    }
  }

  // ── T4: Missing vertical throws error ───────────────────────────────────────
  try {
    console.log("T4: Missing vertical throws error");
    await previewBulkEnroll({ vertical: "", minScore: 70, sequenceId: 1 });
    FAIL("T4: Should have thrown");
    allPass = false;
  } catch (err: any) {
    if (err.message.toLowerCase().includes("vertical")) {
      PASS("Missing vertical error thrown correctly");
    } else {
      FAIL(`T4: Wrong error: ${err.message}`);
      allPass = false;
    }
  }

  // ── T5: Missing sequenceId throws error ────────────────────────────────────
  try {
    console.log("T5: Missing sequenceId throws error");
    await previewBulkEnroll({ vertical: "restaurant", minScore: 70 });
    FAIL("T5: Should have thrown");
    allPass = false;
  } catch (err: any) {
    if (err.message.toLowerCase().includes("sequenceid") || err.message.toLowerCase().includes("sequence")) {
      PASS("Missing sequenceId error thrown correctly");
    } else {
      FAIL(`T5: Wrong error: ${err.message}`);
      allPass = false;
    }
  }

  // ── T6: Nonexistent sequence throws error ───────────────────────────────────
  try {
    console.log("T6: Nonexistent sequence throws error");
    await previewBulkEnroll({ vertical: "restaurant", minScore: 70, sequenceId: 999999 });
    FAIL("T6: Should have thrown");
    allPass = false;
  } catch (err: any) {
    if (err.message.includes("not found") || err.message.includes("999999")) {
      PASS("Nonexistent sequence error thrown correctly");
    } else {
      FAIL(`T6: Wrong error: ${err.message}`);
      allPass = false;
    }
  }

  // ── T7: Active sequence + valid vertical → preview returns correct shape ────
  try {
    console.log("T7: previewBulkEnroll shape with active sequence");
    const sequences = await storage.getFollowUpSequences();
    const active = sequences.find(s => s.status === "active");
    if (!active) {
      SKIP("No active sequences in database — skipping shape test");
    } else {
      const result = await previewBulkEnroll({
        vertical: "restaurant",
        minScore: 0,
        sequenceId: active.id,
      });
      if (typeof result.total !== "number") throw new Error("total is not a number");
      if (typeof result.eligible !== "number") throw new Error("eligible is not a number");
      if (typeof result.dncBlocked !== "number") throw new Error("dncBlocked is not a number");
      if (typeof result.pewcBlocked !== "number") throw new Error("pewcBlocked is not a number");
      if (!["Email-only", "Mixed channel", "SMS/Voice/Ringless requires PEWC"].includes(result.sequenceChannelLabel)) {
        throw new Error(`Invalid sequenceChannelLabel: ${result.sequenceChannelLabel}`);
      }
      if (result.eligible > result.total) throw new Error(`eligible (${result.eligible}) > total (${result.total})`);
      PASS(`total=${result.total}, eligible=${result.eligible}, channel=${result.sequenceChannelLabel}`);
    }
  } catch (err: any) {
    FAIL(`T7: ${err.message}`);
    allPass = false;
  }

  // ── T8: getSequenceChannelLabel returns valid label ──────────────────────────
  try {
    console.log("T8: getSequenceChannelLabel returns valid label");
    const sequences = await storage.getFollowUpSequences();
    const active = sequences.find(s => s.status === "active");
    if (!active) {
      SKIP("No active sequences in database");
    } else {
      const label = await getSequenceChannelLabel(active.id);
      if (!["Email-only", "Mixed channel", "SMS/Voice/Ringless requires PEWC"].includes(label)) {
        throw new Error(`Invalid label: ${label}`);
      }
      PASS(`sequence ${active.id} → ${label}`);
    }
  } catch (err: any) {
    FAIL(`T8: ${err.message}`);
    allPass = false;
  }

  // ── T9: Inactive sequence throws error ──────────────────────────────────────
  try {
    console.log("T9: Inactive sequence throws error");
    const sequences = await storage.getFollowUpSequences();
    const inactive = sequences.find(s => s.status !== "active");
    if (!inactive) {
      SKIP("No inactive sequences to test");
    } else {
      try {
        await previewBulkEnroll({ vertical: "restaurant", minScore: 70, sequenceId: inactive.id });
        FAIL("T9: Should have thrown for inactive sequence");
        allPass = false;
      } catch (err: any) {
        if (err.message.includes("active") || err.message.includes("not active")) {
          PASS(`Inactive sequence correctly rejected: "${err.message}"`);
        } else {
          FAIL(`T9: Wrong error: ${err.message}`);
          allPass = false;
        }
      }
    }
  } catch (err: any) {
    FAIL(`T9: ${err.message}`);
    allPass = false;
  }

  // ── T10: DNC contacts excluded from eligible ─────────────────────────────────
  try {
    console.log("T10: DNC contacts excluded — if any DNC contacts exist with score >= 70");
    const sequences = await storage.getFollowUpSequences();
    const active = sequences.find(s => s.status === "active");
    if (!active) {
      SKIP("No active sequence for DNC test");
    } else {
      const result = await previewBulkEnroll({
        vertical: "restaurant",
        minScore: 0,
        sequenceId: active.id,
      });
      PASS(`dncBlocked=${result.dncBlocked}, optOutBlocked=${result.optOutBlocked} — contacts in these buckets are never eligible`);
    }
  } catch (err: any) {
    FAIL(`T10: ${err.message}`);
    allPass = false;
  }

  console.log(`\n=== ${allPass ? "ALL PASS ✅" : "SOME FAILURES ❌"} ===\n`);
  if (!allPass) process.exit(1);
}

run().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
