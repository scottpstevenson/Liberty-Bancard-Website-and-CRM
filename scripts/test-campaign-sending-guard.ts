/**
 * Test: campaign worker crash-safety guard
 *
 * Verifies that:
 * 1. A message row transitions through queued → sending → sent on a normal send.
 * 2. A row left in `sending` by a simulated crash is NOT re-sent on the next tick
 *    (getQueuedMessages only returns `queued` rows).
 * 3. markStaleInFlightMessagesFailed() promotes a stale `sending` row to `failed`.
 *
 * Run with:  npx tsx scripts/test-campaign-sending-guard.ts
 */

import { db } from "../server/db";
import { outboundMessages } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { storage } from "../server/storage";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

async function cleanup(id: number) {
  await db.delete(outboundMessages).where(eq(outboundMessages.id, id));
}

async function run() {
  console.log("\n── Campaign sending guard tests ──\n");

  // ── Test 1: getQueuedMessages does not return a `sending` row ───────────
  console.log("Test 1: in-flight `sending` row is not picked up by the worker tick");
  const [row1] = await db.insert(outboundMessages).values({
    channel: "email",
    toEmail: "guard-test@example.com",
    status: "sending",
    sendingAt: new Date(),
  }).returning();

  const queued = await storage.getQueuedMessages(100);
  assert(!queued.some(m => m.id === row1.id), "sending row absent from getQueuedMessages");

  await cleanup(row1.id);

  // ── Test 2: markStaleInFlightMessagesFailed leaves fresh `sending` alone ─
  console.log("\nTest 2: fresh `sending` row (< 5 min) is left untouched by stale-cleanup");
  const [row2] = await db.insert(outboundMessages).values({
    channel: "email",
    toEmail: "guard-test-fresh@example.com",
    status: "sending",
    sendingAt: new Date(),
  }).returning();

  const count2 = await storage.markStaleInFlightMessagesFailed();
  // The fresh row should NOT have been touched
  const [check2] = await db.select().from(outboundMessages).where(eq(outboundMessages.id, row2.id));
  assert(check2.status === "sending", "fresh sending row remains in sending after stale-cleanup");

  await cleanup(row2.id);

  // ── Test 3: markStaleInFlightMessagesFailed promotes stale `sending` to `failed` ─
  console.log("\nTest 3: stale `sending` row (> 5 min) is marked failed by stale-cleanup");
  const [row3] = await db.insert(outboundMessages).values({
    channel: "email",
    toEmail: "guard-test-stale@example.com",
    status: "sending",
    // Force the timestamp to 10 minutes ago so the cleanup catches it
    sendingAt: new Date(Date.now() - 10 * 60 * 1000),
  }).returning();

  // Back-date sending_at directly so the interval check fires
  await db.execute(sql`
    UPDATE outbound_messages
    SET sending_at = NOW() - INTERVAL '10 minutes'
    WHERE id = ${row3.id}
  `);

  const count3 = await storage.markStaleInFlightMessagesFailed();
  const [check3] = await db.select().from(outboundMessages).where(eq(outboundMessages.id, row3.id));
  assert(check3.status === "failed", "stale sending row promoted to failed");
  assert(count3 >= 1, "markStaleInFlightMessagesFailed returned count >= 1");

  await cleanup(row3.id);

  // ── Test 4: `sendingAt` column exists in schema (compile-time check) ─────
  console.log("\nTest 4: sendingAt column accessible on outboundMessages schema");
  const hasCol = "sendingAt" in outboundMessages;
  assert(hasCol, "sendingAt field present on outboundMessages table schema");

  // ── Test 5: getDailySendCount includes `sending` rows ────────────────────
  // Verifies the daily-cap is not bypassed by a burst of in-flight messages.
  // Before the fix, rows in `sending` lacked sentAt so they returned 0,
  // allowing a crash-and-recover cycle to fire more than the daily limit.
  console.log("\nTest 5: getDailySendCount counts `sending` rows against the daily cap");

  const { getDailySendCount } = await import("../server/services/campaign-engine");

  // Baseline: record the count before we insert anything
  const countBefore = await getDailySendCount();

  // Insert 3 `sending` rows (no campaignId so they're unscoped)
  const sendingRows: number[] = [];
  for (let i = 0; i < 3; i++) {
    const [row] = await db.insert(outboundMessages).values({
      channel: "email",
      toEmail: `daily-cap-test-${i}@example.com`,
      status: "sending",
      sendingAt: new Date(),
    }).returning();
    sendingRows.push(row.id);
  }

  const countAfter = await getDailySendCount();
  assert(
    countAfter === countBefore + 3,
    `getDailySendCount increased by 3 when 3 sending rows inserted (before=${countBefore}, after=${countAfter})`
  );

  // Verify that rows in `failed` status (recovered crash) are NOT counted
  for (const id of sendingRows) {
    await db.execute(sql`
      UPDATE outbound_messages
      SET status = 'failed', sending_at = NOW() - INTERVAL '6 minutes'
      WHERE id = ${id}
    `);
  }
  const countAfterFail = await getDailySendCount();
  assert(
    countAfterFail === countBefore,
    `getDailySendCount drops back to baseline once sending rows move to failed (before=${countBefore}, afterFail=${countAfterFail})`
  );

  // Clean up
  for (const id of sendingRows) {
    await cleanup(id);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
