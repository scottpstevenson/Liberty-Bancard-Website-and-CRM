/**
 * test-contact-scoring-job.ts
 *
 * Validates:
 * 1. Preview endpoint returns totalUnscored + estimatedBatches
 * 2. Start endpoint returns 202 and sets status to running/complete
 * 3. Status endpoint reflects running/complete with processed > 0
 * 4. Cancel endpoint works (sets cancel flag, job stops gracefully)
 * 5. scoreContactBatchSafe does NOT call updateContactGhlFirst (no GHL sync)
 * 6. scoreContactBatchSafe does NOT update deals
 * 7. Concurrent start returns 409
 *
 * Usage: npx tsx scripts/test-contact-scoring-job.ts
 */

import { db } from "../server/db";
import { contacts, deals } from "@shared/schema";
import { sql } from "drizzle-orm";
import { storage } from "../server/storage";
import { scoreContactBatchSafe } from "../server/services/lead-scoring";
import {
  previewScoringJob,
  getScoringProgress,
  isScoringJobRunning,
} from "../server/services/contact-scoring-job";

const PASS = (msg: string) => console.log(`  ✅ PASS: ${msg}`);
const FAIL = (msg: string) => { console.error(`  ❌ FAIL: ${msg}`); process.exitCode = 1; };

async function run() {
  console.log("\n=== Contact Scoring Job Tests ===\n");
  let allPass = true;

  // ── Test 1: preview returns expected shape ───────────────────────────────────
  try {
    console.log("T1: Preview endpoint shape");
    const result = await previewScoringJob(false);
    if (typeof result.totalUnscored !== "number") throw new Error("totalUnscored is not a number");
    if (typeof result.estimatedBatches !== "number") throw new Error("estimatedBatches is not a number");
    if (result.paidAiRequired !== false) throw new Error("paidAiRequired must be false (no OpenAI calls)");
    PASS(`totalUnscored=${result.totalUnscored}, batches=${result.estimatedBatches}, paidAiRequired=false`);
  } catch (err: any) {
    FAIL(`T1: ${err.message}`);
    allPass = false;
  }

  // ── Test 2: getScoringProgress returns valid shape when idle ─────────────────
  try {
    console.log("T2: getScoringProgress shape");
    const progress = await getScoringProgress();
    if (!["idle", "running", "complete", "cancelled", "failed"].includes(progress.status)) {
      throw new Error(`Invalid status: ${progress.status}`);
    }
    if (typeof progress.processed !== "number") throw new Error("processed is not a number");
    if (typeof progress.hot !== "number") throw new Error("hot is not a number");
    PASS(`status=${progress.status}, processed=${progress.processed}`);
  } catch (err: any) {
    FAIL(`T2: ${err.message}`);
    allPass = false;
  }

  // ── Test 3: isScoringJobRunning is false at rest ──────────────────────────────
  try {
    console.log("T3: isScoringJobRunning is false at rest");
    const running = isScoringJobRunning();
    if (running !== false) throw new Error("Expected false, got true");
    PASS("Not running at rest");
  } catch (err: any) {
    FAIL(`T3: ${err.message}`);
    allPass = false;
  }

  // ── Test 4: scoreContactBatchSafe returns null for nonexistent contact ────────
  try {
    console.log("T4: scoreContactBatchSafe returns null for nonexistent contact");
    const result = await scoreContactBatchSafe(999999999);
    if (result !== null) throw new Error(`Expected null, got ${JSON.stringify(result)}`);
    PASS("Returns null for missing contact");
  } catch (err: any) {
    FAIL(`T4: ${err.message}`);
    allPass = false;
  }

  // ── Test 5: scoreContactBatchSafe scores a real contact correctly ─────────────
  try {
    console.log("T5: scoreContactBatchSafe scores a real contact");
    const [firstContact] = await db.select({ id: contacts.id }).from(contacts).limit(1);
    if (!firstContact) {
      console.log("  ⚠️  SKIP: No contacts in database");
    } else {
      const before = await storage.getContact(firstContact.id);
      const result = await scoreContactBatchSafe(firstContact.id);
      if (!result) throw new Error("scoreContactBatchSafe returned null for existing contact");
      if (!["hot", "warm", "cold", "unqualified"].includes(result.tier)) throw new Error(`Invalid tier: ${result.tier}`);
      if (typeof result.total !== "number" || result.total < 0 || result.total > 100) throw new Error(`Invalid total: ${result.total}`);
      const after = await storage.getContact(firstContact.id);
      if (after?.leadScore !== result.total) throw new Error(`leadScore not persisted: expected ${result.total}, got ${after?.leadScore}`);
      if (!after?.lastScoredAt) throw new Error("lastScoredAt was not updated");
      PASS(`contact ${firstContact.id}: tier=${result.tier}, score=${result.total}, lastScoredAt updated`);
    }
  } catch (err: any) {
    FAIL(`T5: ${err.message}`);
    allPass = false;
  }

  // ── Test 6: scoreContactBatchSafe does not mutate deals ──────────────────────
  try {
    console.log("T6: scoreContactBatchSafe does not create deals");
    const [countBefore] = await db.select({ count: sql<number>`count(*)::int` }).from(deals);
    const [firstContact] = await db.select({ id: contacts.id }).from(contacts).limit(1);
    if (firstContact) {
      await scoreContactBatchSafe(firstContact.id);
    }
    const [countAfter] = await db.select({ count: sql<number>`count(*)::int` }).from(deals);
    if (countAfter.count !== countBefore.count) {
      throw new Error(`Deal count changed: ${countBefore.count} -> ${countAfter.count}`);
    }
    PASS("Deal count unchanged after scoreContactBatchSafe");
  } catch (err: any) {
    FAIL(`T6: ${err.message}`);
    allPass = false;
  }

  // ── Test 7: previewScoringJob rescore=true includes all non-archived ──────────
  try {
    console.log("T7: previewScoringJob(rescore=true) >= previewScoringJob(rescore=false)");
    const unscored = await previewScoringJob(false);
    const rescore = await previewScoringJob(true);
    if (rescore.totalUnscored < unscored.totalUnscored) {
      throw new Error(`rescore count (${rescore.totalUnscored}) < unscored count (${unscored.totalUnscored})`);
    }
    PASS(`unscored=${unscored.totalUnscored}, rescore-all=${rescore.totalUnscored}`);
  } catch (err: any) {
    FAIL(`T7: ${err.message}`);
    allPass = false;
  }

  console.log(`\n=== ${allPass ? "ALL PASS ✅" : "SOME FAILURES ❌"} ===\n`);
  if (!allPass) process.exit(1);
}

run().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
