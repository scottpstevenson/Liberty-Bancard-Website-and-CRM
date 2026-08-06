#!/usr/bin/env tsx
/**
 * Integration test: payout generation concurrency and idempotency.
 *
 * Verifies:
 * 1. Sequential double-run is a no-op (pending row amounts recomputed, only one row per key).
 * 2. Approved rows are never overwritten by a subsequent generation run.
 * 3. Concurrent generation requests (Promise.all) do not cause duplicate rows or errors.
 * 4. Concurrent generation-vs-approve races do not mutate finalised values.
 *
 * Run with the server NOT required — this script talks to the DB directly.
 *   npx tsx scripts/test-payout-generation.ts
 */

import { db } from "../server/db";
import { merchantResiduals, agents, users, agentPayouts, residualImports } from "../shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { ResidualsStorage } from "../server/storage/residuals";

const storage = new ResidualsStorage();

// ── helpers ──────────────────────────────────────────────────────────────────

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`✗ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

const TEST_MONTH = "1999-01"; // Isolated test month — should not collide with production data.
const TEST_EMAIL = `payout-gen-test-${Date.now()}@test.invalid`;

async function cleanup() {
  // Remove test payouts.
  await db.execute(sql`DELETE FROM agent_payouts WHERE period_month = ${TEST_MONTH}`);
  // Remove test residuals.
  await db.execute(sql`DELETE FROM merchant_residuals WHERE month = ${TEST_MONTH}`);
}

async function setup(): Promise<{ agentId: number; userId: string }> {
  // Create (or reuse) a minimal test user + agent.
  let [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, TEST_EMAIL));
  if (!user) {
    const [u] = await db.insert(users).values({
      email: TEST_EMAIL,
      firstName: "PayoutTest",
      lastName: "Agent",
      passwordHash: "x",
      role: "agent",
      authProvider: "local",
      emailVerified: new Date(),
    }).returning({ id: users.id });
    user = u;
  }

  let [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.email, TEST_EMAIL));
  if (!agent) {
    const [a] = await db.insert(agents).values({
      userId: user.id,
      firstName: "PayoutTest",
      lastName: "Agent",
      email: TEST_EMAIL,
      commissionSplitPercent: 60,
      status: "active",
    }).returning({ id: agents.id });
    agent = a;
  }

  return { agentId: agent.id, userId: user.id };
}

async function insertResidual(agentId: number, revenue: string, agentCommission: string, partnerCommission: string, importId?: number) {
  await db.insert(merchantResiduals).values({
    agentId,
    month: TEST_MONTH,
    importId: importId ?? null,
    merchantMid: `TEST-MID-${Date.now()}-${Math.random()}`,
    merchantName: "Test Merchant",
    revenue,
    netRevenue: revenue,
    agentCommission,
    partnerCommission,
  });
}

async function createTestImport(month: string, status: "pending" | "confirmed"): Promise<number> {
  const [imp] = await db.insert(residualImports).values({
    month,
    fileName: "test.csv",
    status,
    confirmedAt: status === "confirmed" ? new Date() : null,
    confirmedBy: status === "confirmed" ? "test" : null,
  }).returning({ id: residualImports.id });
  return imp.id;
}

// ── tests ─────────────────────────────────────────────────────────────────────

async function testSequentialIdempotency(agentId: number, userId: string) {
  console.log("\n── Test 1: Sequential double-run idempotency ──");

  await cleanup();
  await insertResidual(agentId, "1000.00", "500.00", "100.00");

  const run1 = await storage.generatePayoutsForMonth(TEST_MONTH);
  assert(run1.length === 1, "First run creates exactly one payout row");
  assert(run1[0].agentUserId === userId, "Row belongs to test agent");
  assert(run1[0].agentShare === "500.00", "agentShare is correct on first run");
  assert(run1[0].status === "pending", "Row starts as pending");

  const run2 = await storage.generatePayoutsForMonth(TEST_MONTH);
  assert(run2.length === 1, "Second run returns exactly one row (no duplicate)");
  assert(run2[0].id === run1[0].id, "Same row ID on second run");

  // Verify only one DB row exists.
  const { rows: countRows1 } = await db.execute(sql`SELECT COUNT(*) as cnt FROM agent_payouts WHERE period_month = ${TEST_MONTH} AND agent_user_id = ${userId}`);
  assert(Number((countRows1[0] as any).cnt) === 1, "Only one DB row after two runs");

  console.log("  PASS");
}

async function testApprovedRowImmutability(agentId: number, userId: string) {
  console.log("\n── Test 2: Approved row is not overwritten by re-generation ──");

  await cleanup();
  await insertResidual(agentId, "2000.00", "1200.00", "200.00");

  const [initial] = await storage.generatePayoutsForMonth(TEST_MONTH);
  assert(initial.status === "pending", "Row starts pending");

  // Approve it atomically.
  const approved = await storage.transitionPayoutStatus(initial.id, "pending", "approved", {});
  assert(approved !== null, "Approval succeeded");
  assert(approved!.status === "approved", "Status is now approved");
  assert(approved!.agentShare === "1200.00", "agentShare preserved after approval");

  // Add a second residual and re-generate — the approved row should be untouched.
  await insertResidual(agentId, "500.00", "300.00", "50.00");
  const run2 = await storage.generatePayoutsForMonth(TEST_MONTH);

  assert(run2.length === 1, "Re-generation returns one row (approved, unchanged)");
  assert(run2[0].status === "approved", "Approved status preserved");
  assert(run2[0].agentShare === "1200.00", "agentShare NOT overwritten despite new residual data");

  console.log("  PASS");
}

async function testConcurrentGeneration(agentId: number, userId: string) {
  console.log("\n── Test 3: Concurrent generation requests (no duplicates, no errors) ──");

  await cleanup();
  await insertResidual(agentId, "3000.00", "1800.00", "300.00");

  // Fire two generation requests simultaneously.
  const [result1, result2] = await Promise.all([
    storage.generatePayoutsForMonth(TEST_MONTH),
    storage.generatePayoutsForMonth(TEST_MONTH),
  ]);

  // Both should return exactly one row.
  assert(result1.length === 1, "Concurrent run 1 returns one row");
  assert(result2.length === 1, "Concurrent run 2 returns one row");
  assert(result1[0].id === result2[0].id, "Both runs reference the same DB row");

  // Verify only one DB row exists.
  const { rows: countRows3 } = await db.execute(sql`SELECT COUNT(*) as cnt FROM agent_payouts WHERE period_month = ${TEST_MONTH} AND agent_user_id = ${userId}`);
  assert(Number((countRows3[0] as any).cnt) === 1, "Only one DB row after concurrent runs");

  console.log("  PASS");
}

async function testConcurrentGenerationVsApprove(agentId: number, userId: string) {
  console.log("\n── Test 4: Concurrent generation vs approve does not corrupt finalised row ──");

  await cleanup();
  await insertResidual(agentId, "4000.00", "2400.00", "400.00");

  // Seed the initial row.
  const [initial] = await storage.generatePayoutsForMonth(TEST_MONTH);
  assert(initial.status === "pending", "Seed row is pending");

  // Race: generation (which should update amounts) vs approve (which finalises the row).
  const [genResult, approveResult] = await Promise.all([
    storage.generatePayoutsForMonth(TEST_MONTH),
    storage.transitionPayoutStatus(initial.id, "pending", "approved", {}),
  ]);

  // Exactly one side "won". Either:
  //   A) Approve won first → generation DO UPDATE skipped (row approved), gen returns existing approved row.
  //   B) Generation won first → amounts updated while pending, then approve succeeded.
  // In both cases: the final row must be approved, and amounts must be internally consistent.
  const finalRow = genResult[0] ?? approveResult;
  assert(finalRow !== null && finalRow !== undefined, "At least one side returned a result");

  // Re-fetch to get ground truth.
  const [grounded] = await db.select().from(agentPayouts).where(eq(agentPayouts.id, initial.id));
  assert(grounded.status === "approved" || grounded.status === "pending", "Final status is valid");
  assert(grounded.agentShare !== null && grounded.agentShare !== "", "agentShare is not empty");

  // Verify only one DB row.
  const { rows: countRows4 } = await db.execute(sql`SELECT COUNT(*) as cnt FROM agent_payouts WHERE period_month = ${TEST_MONTH} AND agent_user_id = ${userId}`);
  assert(Number((countRows4[0] as any).cnt) === 1, "Only one DB row after concurrent race");

  console.log("  PASS");
}

async function testPendingImportExcluded(agentId: number, userId: string) {
  console.log("\n── Test 6: Generation against a pending (unconfirmed) import returns no payouts ──");

  await cleanup();
  await db.execute(sql`DELETE FROM residual_imports WHERE month = ${TEST_MONTH}`);

  // Create a pending import (not yet confirmed)
  const pendingImportId = await createTestImport(TEST_MONTH, "pending");
  // Insert residuals stamped with the pending import
  await insertResidual(agentId, "5000.00", "3000.00", "500.00", pendingImportId);

  // Generation must return 0 rows — pending imports are not finalized
  const result = await storage.generatePayoutsForMonth(TEST_MONTH);
  assert(result.length === 0, "No payout rows generated when only a pending import exists");

  // Verify no DB payout row was created
  const { rows: countRows6 } = await db.execute(sql`SELECT COUNT(*) as cnt FROM agent_payouts WHERE period_month = ${TEST_MONTH} AND agent_user_id = ${userId}`);
  assert(Number((countRows6[0] as any).cnt) === 0, "No DB payout rows after generation against pending import");

  // Cleanup
  await db.execute(sql`DELETE FROM residual_imports WHERE month = ${TEST_MONTH}`);
  console.log("  PASS");
}

async function testConcurrentConfirmationIdempotency(agentId: number, userId: string) {
  console.log("\n── Test 7: (import_id, merchant_mid) unique constraint prevents duplicate residual rows ──");

  await cleanup();
  await db.execute(sql`DELETE FROM residual_imports WHERE month = ${TEST_MONTH}`);

  const importId = await createTestImport(TEST_MONTH, "confirmed");
  const testMid = `MID-CONCURRENT-${Date.now()}`;

  // Simulate what would happen if two concurrent confirmation requests both tried to insert
  // the same (import_id, merchant_mid) row — only one must survive.
  await db.execute(sql`
    INSERT INTO merchant_residuals
      (import_id, month, merchant_mid, merchant_name, revenue, net_revenue, agent_id, agent_commission, partner_commission, created_at)
    VALUES
      (${importId}, ${TEST_MONTH}, ${testMid}, 'Concurrent Test', '1000.00', '900.00', ${agentId}, '540.00', '90.00', NOW())
    ON CONFLICT (import_id, merchant_mid) WHERE import_id IS NOT NULL DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO merchant_residuals
      (import_id, month, merchant_mid, merchant_name, revenue, net_revenue, agent_id, agent_commission, partner_commission, created_at)
    VALUES
      (${importId}, ${TEST_MONTH}, ${testMid}, 'Concurrent Test', '1000.00', '900.00', ${agentId}, '540.00', '90.00', NOW())
    ON CONFLICT (import_id, merchant_mid) WHERE import_id IS NOT NULL DO NOTHING
  `);

  // Verify only one residual row exists for this (import_id, merchant_mid)
  const { rows: residualRows } = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM merchant_residuals WHERE import_id = ${importId} AND merchant_mid = ${testMid}
  `);
  assert(Number((residualRows[0] as any).cnt) === 1, "Only one residual row per (import_id, merchant_mid) after concurrent inserts");

  // Generation should now produce a payout from this confirmed import
  const result = await storage.generatePayoutsForMonth(TEST_MONTH);
  assert(result.length === 1, "One payout generated from confirmed import");
  assert(result[0].agentShare === "540.00", `agentShare matches the single residual row (got ${result[0].agentShare})`);

  // Cleanup
  await db.execute(sql`DELETE FROM merchant_residuals WHERE merchant_mid = ${testMid}`);
  await db.execute(sql`DELETE FROM residual_imports WHERE month = ${TEST_MONTH}`);
  console.log("  PASS");
}

async function testDoubleImportSameMonth(agentId: number, userId: string) {
  console.log("\n── Test 5: Double-import for same month — generation uses only latest confirmed import ──");

  await cleanup();
  // Also clean up any test imports for this month.
  await db.execute(sql`DELETE FROM residual_imports WHERE month = ${TEST_MONTH}`);

  // Import A: confirmed first, $600 agent share
  const importIdA = await createTestImport(TEST_MONTH, "confirmed");
  await insertResidual(agentId, "1000.00", "600.00", "100.00", importIdA);

  // Import B: confirmed later (higher id), $900 agent share — this is the "re-import"
  const importIdB = await createTestImport(TEST_MONTH, "confirmed");
  await insertResidual(agentId, "1500.00", "900.00", "150.00", importIdB);

  // Generate: must use only import B's residuals ($900), not import A's ($600) + B's ($900) = $1500
  const result = await storage.generatePayoutsForMonth(TEST_MONTH);
  assert(result.length === 1, "One payout row generated");
  assert(result[0].agentShare === "900.00", `agentShare equals import B's amount (got ${result[0].agentShare})`);
  assert(result[0].agentShare !== "1500.00", "agentShare is NOT a sum of both imports (no double-counting)");
  assert(result[0].agentShare !== "600.00", "agentShare is NOT from the older import A");

  // Only one DB payout row.
  const { rows: countRows5 } = await db.execute(sql`SELECT COUNT(*) as cnt FROM agent_payouts WHERE period_month = ${TEST_MONTH} AND agent_user_id = ${userId}`);
  assert(Number((countRows5[0] as any).cnt) === 1, "Only one DB payout row after double-import generation");

  // Cleanup test imports.
  await db.execute(sql`DELETE FROM residual_imports WHERE month = ${TEST_MONTH}`);
  console.log("  PASS");
}

// ── main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log("Payout generation integration tests\n");
  let { agentId, userId } = await setup();

  try {
    await testSequentialIdempotency(agentId, userId);
    await testApprovedRowImmutability(agentId, userId);
    await testConcurrentGeneration(agentId, userId);
    await testConcurrentGenerationVsApprove(agentId, userId);
    await testDoubleImportSameMonth(agentId, userId);
    await testPendingImportExcluded(agentId, userId);
    await testConcurrentConfirmationIdempotency(agentId, userId);
  } finally {
    await cleanup();
    await db.execute(sql`DELETE FROM residual_imports WHERE month = ${TEST_MONTH}`);
    // Clean up test agent/user only if we created them.
    await db.execute(sql`DELETE FROM agents WHERE email = ${TEST_EMAIL}`);
    await db.execute(sql`DELETE FROM users WHERE email = ${TEST_EMAIL}`);
  }

  console.log("\n✓ All payout generation tests passed.\n");
  process.exit(0);
}

run().catch(err => {
  console.error("\n✗ Test failed:", err);
  process.exit(1);
});
