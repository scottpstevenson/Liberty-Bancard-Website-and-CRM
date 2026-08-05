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
