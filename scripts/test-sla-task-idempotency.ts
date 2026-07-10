/**
 * Phase 4 concurrency validation — requires migration 0054 (partial unique index).
 *
 * PREREQUISITE: Apply migration 0054 FIRST:
 *   1. npx tsx scripts/backfill-sla-task-identity.ts   # Phase 2 dedup
 *   2. Verify backfill queries return 0 (see script header)
 *   3. psql $DATABASE_URL < migrations/0054_sla_task_stalling_unique_index.sql
 *   4. npx tsx scripts/verify-phase3-index.ts          # confirm index exists
 *   5. npx tsx scripts/test-sla-task-idempotency.ts    # this script
 *
 * Tests:
 *   1. Two concurrent createStallingDealFollowUpTask calls → exactly one active+incomplete task
 *   2. Complete SLA task → run SLA logic → replacement task created
 *   3. Different automationKey on same deal → allowed (not blocked by index)
 *   4. Manual task, same title, no identity → allowed (not blocked by index)
 *   5. Unrelated 23505 (different unique constraint) → rethrown
 *
 * Run: npx tsx scripts/test-sla-task-idempotency.ts
 * Exits 0 if all pass, exits 2 if Phase 3 index is absent, exits 1 on test failure.
 */

import { db } from "../server/db";
import { tasks, deals } from "@shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { storage } from "../server/storage";

let passed = 0;
let failed = 0;
const cleanupTaskIds: number[] = [];
const cleanupDealIds: number[] = [];

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

async function mkDeal(): Promise<number> {
  const [deal] = await db.insert(deals).values({
    title: `__idempotency_test_deal_${Date.now()}__`,
    stage: "New Lead",
    pipeline: "sales",
    updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
  } as any).returning();
  cleanupDealIds.push(deal.id);
  return deal.id;
}

async function main() {
  const isRealDb = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost:fake");
  if (!isRealDb && process.env.SKIP_REAL_DB_CHECK !== "1") {
    console.log("[IdempotencyTest] DATABASE_URL not set — this test requires real PostgreSQL.");
    console.log("[IdempotencyTest] Set DATABASE_URL or SKIP_REAL_DB_CHECK=1 to force-run with mocked Redis.");
    process.exit(0);
  }

  // Phase 3 gate: this suite's ON CONFLICT clauses require the partial index.
  // Fail clearly if migration 0054 has not been applied yet.
  const indexRows = await db.execute(sql`
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'tasks_sla_stalling_active_unique' LIMIT 1
  `);
  const indexPresent = Array.isArray((indexRows as any).rows)
    ? (indexRows as any).rows.length > 0
    : Array.isArray(indexRows) && (indexRows as any[]).length > 0;
  if (!indexPresent) {
    console.error("[IdempotencyTest] BLOCKED: Phase 3 partial index 'tasks_sla_stalling_active_unique' is not present.");
    console.error("[IdempotencyTest] Apply migration 0054 first:");
    console.error("  1. npx tsx scripts/backfill-sla-task-identity.ts");
    console.error("  2. Verify backfill queries return 0 (see script header)");
    console.error("  3. psql $DATABASE_URL < migrations/0054_sla_task_stalling_unique_index.sql");
    console.error("  4. npx tsx scripts/verify-phase3-index.ts");
    console.error("  5. Re-run this script.");
    process.exit(2);
  }
  console.log("[IdempotencyTest] Phase 3 index confirmed present. Starting Phase 4 concurrency validation...\n");

  // ── Test 1: Concurrent creates → exactly one active+incomplete task ─────────
  console.log("── Test 1: Concurrent createStallingDealFollowUpTask ──");

  const dealId1 = await mkDeal();
  await assert("Two concurrent calls → exactly one active+incomplete task", async () => {
    const payload = {
      title: `Follow up on stalling Deal #${dealId1}`,
      description: `Deal #${dealId1} stalling`,
      priority: "high" as const,
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      dealId: dealId1,
    };
    const [r1, r2] = await Promise.all([
      storage.createStallingDealFollowUpTask(payload),
      storage.createStallingDealFollowUpTask(payload),
    ]);

    const bothResults = [r1, r2];
    const createdCount = bothResults.filter(r => r.created).length;
    const skippedCount = bothResults.filter(r => !r.created).length;

    bothResults.forEach(r => { if (r.task) cleanupTaskIds.push(r.task.id); });

    if (createdCount !== 1) throw new Error(`Expected exactly 1 created, got ${createdCount}`);
    if (skippedCount !== 1) throw new Error(`Expected exactly 1 skipped, got ${skippedCount}`);

    const active = await db.select().from(tasks).where(
      and(eq(tasks.dealId, dealId1), isNull(tasks.deletedAt), isNull(tasks.completedAt))
    );
    if (active.length !== 1) throw new Error(`Expected 1 active task, found ${active.length}`);
    if (active[0].source !== "sla" || active[0].automationKey !== "stalling-deal-follow-up") {
      throw new Error(`Task missing identity: source=${active[0].source} automationKey=${active[0].automationKey}`);
    }
  });

  // ── Test 2: Complete SLA task → replacement task can be created ─────────────
  console.log("\n── Test 2: Complete then replace SLA task ──");

  const dealId2 = await mkDeal();
  await assert("Complete SLA task → createStallingDealFollowUpTask creates replacement", async () => {
    const { task: t } = await storage.createStallingDealFollowUpTask({
      title: `Follow up on stalling Deal #${dealId2}`,
      description: "initial",
      priority: "high",
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      dealId: dealId2,
    });
    if (!t) throw new Error("Initial task not created");
    cleanupTaskIds.push(t.id);

    await db.update(tasks).set({ status: "completed", completedAt: new Date() } as any).where(eq(tasks.id, t.id));

    const { task: replacement, created } = await storage.createStallingDealFollowUpTask({
      title: `Follow up on stalling Deal #${dealId2}`,
      description: "replacement",
      priority: "high",
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      dealId: dealId2,
    });
    if (!created || !replacement) throw new Error(`Replacement not created: created=${created}`);
    cleanupTaskIds.push(replacement.id);
  });

  // ── Test 3: Different automationKey on same deal → allowed ──────────────────
  console.log("\n── Test 3: Different automationKey → not blocked ──");

  const dealId3 = await mkDeal();
  await assert("Different automationKey on same deal → two tasks created", async () => {
    const [t3a] = await db.insert(tasks).values({
      title: `Follow up on stalling Deal #${dealId3}`,
      description: "stalling",
      priority: "high",
      dealId: dealId3,
      source: "sla",
      automationKey: "stalling-deal-follow-up",
    } as any).returning();
    cleanupTaskIds.push(t3a.id);

    const [t3b] = await db.insert(tasks).values({
      title: `Different follow-up for Deal #${dealId3}`,
      description: "other",
      priority: "normal",
      dealId: dealId3,
      source: "sla",
      automationKey: "different-automation-key",
    } as any).returning();
    cleanupTaskIds.push(t3b.id);

    const active = await db.select().from(tasks).where(
      and(eq(tasks.dealId, dealId3), isNull(tasks.deletedAt), isNull(tasks.completedAt))
    );
    if (active.length !== 2) throw new Error(`Expected 2 tasks, found ${active.length}`);
  });

  // ── Test 4: Manual task, same title, no identity → allowed ──────────────────
  console.log("\n── Test 4: Manual task (no identity) alongside SLA task ──");

  const dealId4 = await mkDeal();
  await assert("Manual task with same title but no identity → allowed (not blocked by index)", async () => {
    const { task: sla } = await storage.createStallingDealFollowUpTask({
      title: `Follow up on stalling Deal #${dealId4}`,
      description: "sla task",
      priority: "high",
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      dealId: dealId4,
    });
    if (!sla) throw new Error("SLA task not created");
    cleanupTaskIds.push(sla.id);

    const [manual] = await db.insert(tasks).values({
      title: `Follow up on stalling Deal #${dealId4}`,
      description: "manually created",
      priority: "normal",
      dealId: dealId4,
    } as any).returning();
    cleanupTaskIds.push(manual.id);

    const active = await db.select().from(tasks).where(
      and(eq(tasks.dealId, dealId4), isNull(tasks.deletedAt), isNull(tasks.completedAt))
    );
    if (active.length !== 2) throw new Error(`Expected 2 tasks (1 SLA + 1 manual), found ${active.length}`);
  });

  // ── Test 5: Non-targeted 23505 → rethrown ──────────────────────────────────
  // Strategy: add a temp unique index on ghl_task_id, insert a task with a
  // specific ghl_task_id, then attempt createStallingDealFollowUpTask with the
  // same ghl_task_id. The DB raises a 23505 on the temp index (not the targeted
  // partial index) — the catch block must rethrow it, not swallow it.
  console.log("\n── Test 5: Non-targeted 23505 → rethrown ──");

  const SENTINEL_GHL_TASK_ID = `test-nontargeted-23505-${Date.now()}`;
  const TEMP_INDEX_NAME = "test_tmp_ghl_task_id_unique";
  let sentinel5TaskId: number | null = null;

  try {
    // 1. Create temp unique index on ghl_task_id
    await db.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS ${TEMP_INDEX_NAME} ON tasks(ghl_task_id) WHERE ghl_task_id IS NOT NULL`));

    // 2. Insert a row claiming the sentinel ghl_task_id
    const [sentinel] = await db.insert(tasks).values({
      title: "__idempotency_test_5_sentinel__",
      status: "pending",
      priority: "normal",
      ghlTaskId: SENTINEL_GHL_TASK_ID,
    } as any).returning();
    sentinel5TaskId = sentinel.id;
    cleanupTaskIds.push(sentinel.id);

    // 3. Try to create stalling task with the same ghl_task_id → 23505 on temp index.
    //    Omit dealId so deal_id = NULL — the partial index predicate requires
    //    deal_id IS NOT NULL, so the ON CONFLICT DO NOTHING clause does NOT fire.
    //    The insert proceeds and PostgreSQL raises 23505 on the temp ghl_task_id index.
    await assert("Non-targeted 23505 (different unique constraint) → rethrown, not swallowed", async () => {
      try {
        await storage.createStallingDealFollowUpTask({
          title: "stalling task with dup ghl_task_id",
          ghlTaskId: SENTINEL_GHL_TASK_ID,
          priority: "normal",
          dueDate: new Date(),
          // No dealId: deal_id = NULL means partial index ON CONFLICT clause won't
          // match (deal_id IS NOT NULL predicate), so the insert reaches the
          // ghl_task_id unique constraint and raises 23505 on the temp index.
        });
        throw new Error("Expected 23505 to be thrown but insert succeeded");
      } catch (err: any) {
        if (err.message.includes("Expected 23505")) throw err;
        if (err.code !== "23505") throw new Error(`Expected non-targeted 23505, got code=${err.code}: ${err.message}`);
        if (err.constraint === "tasks_sla_stalling_active_unique") {
          throw new Error("Error was swallowed as targeted DO NOTHING instead of rethrown — catch block is incorrect");
        }
      }
    });
  } finally {
    // 4. Always drop the temp index and clean up sentinel
    await db.execute(sql.raw(`DROP INDEX IF EXISTS ${TEMP_INDEX_NAME}`)).catch(() => {});
    if (sentinel5TaskId !== null) {
      await db.delete(tasks).where(eq(tasks.id, sentinel5TaskId)).catch(() => {});
      cleanupTaskIds.splice(cleanupTaskIds.indexOf(sentinel5TaskId), 1);
    }
  }

  // Cleanup
  if (cleanupTaskIds.length > 0) {
    await db.delete(tasks).where(sql`id = ANY(${cleanupTaskIds})`).catch(() => {});
  }
  for (const id of cleanupDealIds) {
    await db.delete(deals).where(eq(deals.id, id)).catch(() => {});
  }

  console.log(`\n[IdempotencyTest] Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("[IdempotencyTest] FAIL");
    process.exit(1);
  }
  console.log("[IdempotencyTest] PASS — Phase 4 concurrency invariants satisfied");
  process.exit(0);
}

main().catch(err => {
  console.error("[IdempotencyTest] Fatal:", err.message);
  process.exit(1);
});
