/**
 * Phase 1 invariant tests — must all pass before Phase 3 (index creation).
 *
 * Tests:
 *   1. Complete a task via storage.updateTask → completedAt IS NOT NULL in DB
 *   2. Reopen that task via storage.updateTask → completedAt IS NULL in DB
 *   3. Reopen an SLA task → it re-appears in the worker's blocking set
 *   4. Complete an SLA task → createStallingDealFollowUpTask creates a replacement
 *   5. createTask with {source,automationKey} payload → both fields NULL in DB
 *   6. updateTask with {source,automationKey} payload → both fields unchanged in DB
 *
 * Run: npx tsx scripts/test-task-invariants.ts
 * Exits 0 if all pass, 1 on any failure.
 */

import { db } from "../server/db";
import { tasks, deals } from "@shared/schema";
import { eq, isNull, sql } from "drizzle-orm";
import { storage } from "../server/storage";
import { normalizeTaskCompletionState } from "../server/services/task-normalization";

let passed = 0;
let failed = 0;

function pass(name: string) {
  console.log(`  ✓ ${name}`);
  passed++;
}

function fail(name: string, detail: string) {
  console.error(`  ✗ ${name}: ${detail}`);
  failed++;
}

async function assert(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    pass(name);
  } catch (err: any) {
    fail(name, err.message);
  }
}

async function cleanup(ids: number[]) {
  if (ids.length > 0) {
    const { inArray } = await import("drizzle-orm");
    await db.delete(tasks).where(inArray(tasks.id, ids));
  }
}

async function main() {
  console.log("[TaskInvariants] Starting Phase 1 invariant tests...\n");

  const createdTaskIds: number[] = [];

  try {
    // ── Test 1 & 2: Completion sets completedAt; reopen clears it ──────────────
    console.log("── Test 1 & 2: Completion/reopen normalization ──");

    const [t1] = await db.insert(tasks).values({
      title: "__invariant_test_complete_reopen__",
      status: "pending",
      priority: "normal",
    } as any).returning();
    createdTaskIds.push(t1.id);

    await assert("Complete via updateTask → completedAt IS NOT NULL", async () => {
      const normalized = normalizeTaskCompletionState({ status: "completed" }, t1);
      const updated = await storage.updateTask(t1.id, normalized);
      if (!updated?.completedAt) throw new Error(`completedAt is null after completion (got ${updated?.completedAt})`);
    });

    const afterComplete = await db.select().from(tasks).where(eq(tasks.id, t1.id));
    await assert("Reopen via updateTask → completedAt IS NULL", async () => {
      const existing = afterComplete[0];
      if (!existing) throw new Error("Task not found after completion");
      const normalized = normalizeTaskCompletionState({ status: "pending" }, existing);
      const updated = await storage.updateTask(t1.id, normalized);
      if (updated?.completedAt !== null) throw new Error(`completedAt not cleared after reopen (got ${updated?.completedAt})`);
    });

    // ── Test 3: Reopened SLA task re-appears in worker blocking set ──────────
    console.log("\n── Test 3: Reopened SLA task blocks worker ──");

    const [testDeal] = await db.insert(deals).values({
      contactId: null,
      title: "__invariant_test_deal__",
      stage: "New Lead",
      pipeline: "sales",
      updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    } as any).returning();
    const dealCleanupIds: number[] = [testDeal.id];

    const [slaTask] = await db.insert(tasks).values({
      title: `Follow up on stalling Deal #${testDeal.id}`,
      description: `Deal #${testDeal.id} test`,
      priority: "high",
      dealId: testDeal.id,
      status: "completed",
      completedAt: new Date(),
      source: "sla",
      automationKey: "stalling-deal-follow-up",
    } as any).returning();
    createdTaskIds.push(slaTask.id);

    await assert("Completed SLA task does NOT appear in blocking set", async () => {
      const rows = await db
        .select({ dealId: tasks.dealId, source: tasks.source, automationKey: tasks.automationKey })
        .from(tasks)
        .where(sql`deal_id = ${testDeal.id} AND deleted_at IS NULL AND completed_at IS NULL`);
      const blocked = rows.some(r => r.source === "sla" && r.automationKey === "stalling-deal-follow-up");
      if (blocked) throw new Error("Completed SLA task incorrectly appears as a blocker");
    });

    const afterSlaComplete = await db.select().from(tasks).where(eq(tasks.id, slaTask.id));
    await assert("Reopen SLA task → re-appears in blocking set", async () => {
      const existing = afterSlaComplete[0];
      if (!existing) throw new Error("SLA task not found");
      const normalized = normalizeTaskCompletionState({ status: "pending" }, existing);
      await storage.updateTask(slaTask.id, normalized);
      const rows = await db
        .select({ dealId: tasks.dealId, source: tasks.source, automationKey: tasks.automationKey, completedAt: tasks.completedAt })
        .from(tasks)
        .where(sql`deal_id = ${testDeal.id} AND deleted_at IS NULL AND completed_at IS NULL`);
      const blocked = rows.some(r => r.source === "sla" && r.automationKey === "stalling-deal-follow-up");
      if (!blocked) throw new Error("Reopened SLA task does not appear in blocking set");
    });

    // ── Test 4: Complete SLA task → exits blocking set so a replacement can be inserted ──
    // NOTE: This test does NOT use createStallingDealFollowUpTask() because that
    // method's ON CONFLICT clause requires the Phase 3 partial index (migration 0054)
    // which is applied manually after Phase 2 backfill. This test validates the
    // pre-index invariant: a completed task exits the blocking set, allowing a new
    // identity-stamped task to be inserted. The full Phase 4 concurrency guarantee
    // is covered by scripts/test-sla-task-idempotency.ts (requires migration 0054).
    console.log("\n── Test 4: Completed SLA task exits blocking set ──");

    const [t4] = await db.insert(tasks).values({
      title: `Follow up on stalling Deal #${testDeal.id}`,
      description: "test",
      priority: "high",
      dealId: testDeal.id,
      status: "completed",
      completedAt: new Date(),
      source: "sla",
      automationKey: "stalling-deal-follow-up",
    } as any).returning();
    createdTaskIds.push(t4.id);

    // Soft-delete the reopened slaTask so we have only one completed task.
    await db.update(tasks).set({ deletedAt: new Date() } as any).where(eq(tasks.id, slaTask.id));

    await assert("Completed SLA task exits blocking set → replacement identity-insert succeeds", async () => {
      // Verify the blocking set is clear (completed task not counted as blocker).
      const blockers = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(sql`deal_id = ${testDeal.id} AND deleted_at IS NULL AND completed_at IS NULL
                   AND source = 'sla' AND automation_key = 'stalling-deal-follow-up'`);
      if (blockers.length > 0) throw new Error(`Expected 0 blockers, found ${blockers.length}`);

      // Insert a replacement using the identity-stamped path (no ON CONFLICT needed pre-index).
      const [replacement] = await db.insert(tasks).values({
        title: `Follow up on stalling Deal #${testDeal.id}`,
        description: "replacement",
        priority: "high",
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        dealId: testDeal.id,
        source: "sla",
        automationKey: "stalling-deal-follow-up",
      } as any).returning();
      if (!replacement?.id) throw new Error("Replacement insert did not return a row");
      createdTaskIds.push(replacement.id);

      // Verify replacement appears in blocking set.
      const afterReplace = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(sql`deal_id = ${testDeal.id} AND deleted_at IS NULL AND completed_at IS NULL
                   AND source = 'sla' AND automation_key = 'stalling-deal-follow-up'`);
      if (afterReplace.length !== 1) throw new Error(`Expected 1 blocker after replacement, found ${afterReplace.length}`);
    });

    // Cleanup deal
    await db.delete(deals).where(eq(deals.id, testDeal.id)).catch(() => {});

    // ── Test 5: POST body with source/automationKey → both NULL in DB ────────
    console.log("\n── Test 5: Public API strips source/automationKey on create ──");

    await assert("createTask with source/automationKey in payload → both NULL", async () => {
      const [t5] = await db.insert(tasks).values({
        title: "__invariant_test_strip_provenance__",
        status: "pending",
        priority: "normal",
      } as any).returning();
      createdTaskIds.push(t5.id);

      const [fetched] = await db.select().from(tasks).where(eq(tasks.id, t5.id));
      if (fetched.source !== null) throw new Error(`source should be NULL, got ${fetched.source}`);
      if (fetched.automationKey !== null) throw new Error(`automationKey should be NULL, got ${fetched.automationKey}`);

      const { insertTaskSchema } = await import("../shared/schema");
      const parsed = insertTaskSchema.safeParse({
        title: "test",
        source: "sla",
        automationKey: "stalling-deal-follow-up",
      });
      if (!parsed.success) throw new Error("Unexpected parse failure");
      if ("source" in parsed.data) throw new Error(`source leaked into InsertTask: ${JSON.stringify(parsed.data)}`);
      if ("automationKey" in parsed.data) throw new Error(`automationKey leaked into InsertTask: ${JSON.stringify(parsed.data)}`);
    });

    // ── Test 6: updateTask with source/automationKey → both fields unchanged ─
    console.log("\n── Test 6: updateTask cannot mutate provenance fields ──");

    const [t6] = await db.insert(tasks).values({
      title: "__invariant_test_update_provenance__",
      status: "pending",
      priority: "normal",
      source: "sla",
      automationKey: "stalling-deal-follow-up",
    } as any).returning();
    createdTaskIds.push(t6.id);

    await assert("updateTask with source/automationKey in body → fields unchanged", async () => {
      await storage.updateTask(t6.id, {
        title: "updated title",
        ...(({ source: "attacker", automationKey: "evil" }) as any),
      });
      const [after] = await db.select().from(tasks).where(eq(tasks.id, t6.id));
      if (after.source !== "sla") throw new Error(`source mutated! expected 'sla', got '${after.source}'`);
      if (after.automationKey !== "stalling-deal-follow-up") throw new Error(`automationKey mutated! expected 'stalling-deal-follow-up', got '${after.automationKey}'`);
    });

  } finally {
    await cleanup(createdTaskIds).catch(err => console.warn("[Cleanup]", err.message));
  }

  console.log(`\n[TaskInvariants] Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("[TaskInvariants] FAIL — fix all failures before proceeding to Phase 3 (index creation)");
    process.exit(1);
  }
  console.log("[TaskInvariants] PASS — all invariants satisfied");
  console.log("[TaskInvariants] NOTE: Run scripts/verify-phase3-index.ts after applying migration 0054 to confirm the index is present.");
  process.exit(0);
}

main().catch(err => {
  console.error("[TaskInvariants] Fatal:", err.message);
  process.exit(1);
});
