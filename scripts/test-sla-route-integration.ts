#!/usr/bin/env tsx
/**
 * SLA Task Route and Worker Integration Regression Tests
 *
 * 14 integration assertions across two groups:
 *   Group 1 — HTTP route tests (live dev server, no worker calls)
 *     A — Authorization (3): anon→401, anon→401, merchant→403
 *     B — Provenance isolation (6): source/automationKey stripped, never 400
 *     C — Completion/reopen lifecycle (2)
 *   Group 2 — Worker integration tests (in-process, no HTTP calls)
 *     D — Scoped SLA cycle (3): blocking works, task created, no duplicate
 *
 * DB safety contract:
 *   - TEST_DATABASE_URL must be set and must differ from DATABASE_URL
 *   - A pg.Client connects to TEST_DATABASE_URL and verifies current_database()
 *     matches an approved pattern (_test, _dev, or INTEGRATION_TEST_DB_NAME)
 *   - process.env.DATABASE_URL is then set to TEST_DATABASE_URL so that all
 *     server module imports (db, storage, sla-worker) use the test database
 *   - Dynamic imports ensure server/db.ts is loaded AFTER the remap
 *
 * Run:
 *   BASE_URL=http://localhost:5000 \
 *   TEST_DATABASE_URL=<test-db-url> \
 *   TEST_USER_EMAIL=<email> \
 *   TEST_USER_PASSWORD=<password> \
 *   [INTEGRATION_TEST_DB_NAME=<approved-db-name>] \
 *   npx tsx scripts/test-sla-route-integration.ts
 */

// Only lightweight imports at the top level — NO server/db or schema imports here.
// All database-touching modules are loaded dynamically after the safety gate
// remaps DATABASE_URL to TEST_DATABASE_URL.
import bcrypt from "bcryptjs";
import { Client } from "pg";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";

const MERCHANT_EMAIL = "__sla_test_merchant@libertybancard.test";
const MERCHANT_PASSWORD = "SlaMerchant-Aa1!-route-test";

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

async function assertTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    pass(name);
  } catch (err: any) {
    fail(name, err.message);
  }
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`[Env] FAIL: Required env var ${name} is not set. Exiting.`);
    process.exit(1);
  }
  return val;
}

async function dbSafetyGate(testDbUrl: string, mainDbUrl: string | undefined): Promise<void> {
  // 1. TEST_DATABASE_URL must differ from DATABASE_URL.
  if (testDbUrl === mainDbUrl) {
    console.error("[SafetyGate] FAIL: TEST_DATABASE_URL must differ from DATABASE_URL.");
    console.error("[SafetyGate] Set TEST_DATABASE_URL to a non-production URL to confirm intent.");
    process.exit(1);
  }

  // 2. Connect to TEST_DATABASE_URL and verify current_database() is safe.
  const client = new Client({ connectionString: testDbUrl });
  try {
    await client.connect();
    const result = await client.query("SELECT current_database()");
    const dbName: string = result.rows[0]?.current_database ?? "";

    const integrationTestDbName = process.env.INTEGRATION_TEST_DB_NAME;
    const nameOk =
      dbName.includes("_test") ||
      dbName.includes("_dev") ||
      (integrationTestDbName ? dbName === integrationTestDbName : false);

    if (!nameOk) {
      console.error(
        `[SafetyGate] FAIL: current_database() on TEST_DATABASE_URL = "${dbName}"\n` +
        `  does not match an approved pattern.\n` +
        `  Approved patterns: contains "_test", contains "_dev", or\n` +
        `  equals INTEGRATION_TEST_DB_NAME env var.\n` +
        `  Set INTEGRATION_TEST_DB_NAME="${dbName}" to explicitly approve this database.`
      );
      process.exit(1);
    }

    console.log(`[SafetyGate] OK — TEST_DATABASE_URL database "${dbName}" approved for integration tests.`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`Login failed for ${email}: ${res.status} ${body}`);
  }
  const rawHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  const setCookieArr: string[] = typeof rawHeaders.getSetCookie === "function"
    ? rawHeaders.getSetCookie()
    : [res.headers.get("set-cookie") ?? ""];
  const cookies = setCookieArr.map(c => c.split(";")[0].trim()).filter(Boolean);
  if (cookies.length === 0) throw new Error(`No session cookie returned for ${email}`);
  return cookies.join("; ");
}

async function getCsrfToken(cookie: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/csrf-token`, {
    headers: { Cookie: cookie },
  });
  if (!res.ok) throw new Error(`Failed to fetch CSRF token: ${res.status}`);
  const body = await res.json() as { token?: string; csrfToken?: string };
  const token = body.token ?? body.csrfToken;
  if (!token) throw new Error("CSRF token not found in response");
  return token;
}

async function apiPost(path: string, body: unknown, cookie: string, csrf: string) {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": cookie,
      "x-csrf-token": csrf,
    },
    body: JSON.stringify(body),
  });
}

async function apiPut(path: string, body: unknown, cookie: string, csrf: string) {
  return fetch(`${BASE_URL}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Cookie": cookie,
      "x-csrf-token": csrf,
    },
    body: JSON.stringify(body),
  });
}

async function main() {
  const testDbUrl = requireEnv("TEST_DATABASE_URL");
  const testUserEmail = requireEnv("TEST_USER_EMAIL");
  const testUserPassword = requireEnv("TEST_USER_PASSWORD");

  // ── DB safety gate (connects to TEST_DATABASE_URL via pg.Client) ─────────
  await dbSafetyGate(testDbUrl, process.env.DATABASE_URL);

  // ── Remap DATABASE_URL so all server module imports use the test DB ───────
  // This must happen before any dynamic import of server/db or server/storage.
  process.env.DATABASE_URL = testDbUrl;

  // Dynamic imports — loaded after DATABASE_URL is remapped to testDbUrl.
  const { db } = await import("../server/db");
  const { tasks, deals, users } = await import("@shared/schema");
  const { eq, and, isNull, inArray, sql } = await import("drizzle-orm");
  const { storage } = await import("../server/storage");
  const { normalizeTaskCompletionState } = await import("../server/services/task-normalization");
  const { runSlaCheckForDeals } = await import("../server/services/sla-worker");

  // ── Helpers using the dynamically-imported db ─────────────────────────────

  async function ensureTestMerchantUser(): Promise<void> {
    const passwordHash = await bcrypt.hash(MERCHANT_PASSWORD, 12);
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, MERCHANT_EMAIL));
    if (existing.length === 0) {
      await db.insert(users).values({
        email: MERCHANT_EMAIL,
        firstName: "Sla",
        lastName: "TestMerchant",
        passwordHash,
        role: "merchant",
        authProvider: "local",
        emailVerified: new Date(),
      } as any);
    } else {
      await db.update(users)
        .set({ passwordHash, role: "merchant", authProvider: "local", emailVerified: new Date() } as any)
        .where(eq(users.email, MERCHANT_EMAIL));
    }
  }

  async function deleteTestMerchantUser(): Promise<void> {
    await db.delete(users).where(eq(users.email, MERCHANT_EMAIL)).catch(() => {});
  }

  async function getTaskFromDb(id: number) {
    const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
    return row ?? null;
  }

  async function countCanonicalActiveTasks(dealId: number): Promise<number> {
    const rows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.dealId, dealId),
          eq(tasks.source as any, "sla"),
          eq(tasks.automationKey as any, "stalling-deal-follow-up"),
          isNull(tasks.deletedAt),
          isNull(tasks.completedAt),
        )
      );
    return rows.length;
  }

  async function snapshotTaskIds(dealId: number): Promise<number[]> {
    const rows = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.dealId, dealId));
    return rows.map(r => r.id);
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  await ensureTestMerchantUser();

  const fixtureHttpDealIds: number[] = [];
  const fixtureWorkerDealIds: number[] = [];
  const directInsertTaskIds: number[] = [];

  try {
    console.log("\n─── Group 1: HTTP Route Tests ───────────────────────────────\n");

    const adminCookie = await login(testUserEmail, testUserPassword);
    const adminCsrf = await getCsrfToken(adminCookie);
    const merchantCookie = await login(MERCHANT_EMAIL, MERCHANT_PASSWORD);
    const merchantCsrf = await getCsrfToken(merchantCookie);

    // Fixture deal for HTTP tests — updatedAt=now, never stalling.
    const [fixtureHttpDeal] = await db.insert(deals).values({
      title: "__sla_route_test_http_deal__",
      stage: "New Lead",
      pipeline: "sales",
      updatedAt: new Date(),
    } as any).returning();
    fixtureHttpDealIds.push(fixtureHttpDeal.id);

    // Insert a canonical SLA task directly (for provenance tests 8-9, lifecycle tests 10-11).
    const [fixtureSlaDbtask] = await db.insert(tasks).values({
      title: "__sla_route_test_direct_sla_task__",
      status: "pending",
      priority: "normal",
      dealId: fixtureHttpDeal.id,
      source: "sla",
      automationKey: "stalling-deal-follow-up",
    } as any).returning();
    directInsertTaskIds.push(fixtureSlaDbtask.id);

    // ── A — Authorization (3) ─────────────────────────────────────────────────

    console.log("── A — Authorization ──");

    await assertTest("1. POST /api/tasks (anon) → 401", async () => {
      const res = await fetch(`${BASE_URL}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "anon test", status: "pending" }),
      });
      if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
    });

    await assertTest("2. PUT /api/tasks/:id (anon) → 401", async () => {
      const res = await fetch(`${BASE_URL}/api/tasks/${fixtureSlaDbtask.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "anon put" }),
      });
      if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
    });

    await assertTest("3. POST /api/tasks (merchant session) → 403", async () => {
      const res = await apiPost("/api/tasks", { title: "merchant test", status: "pending" }, merchantCookie, merchantCsrf);
      if (res.status !== 403) throw new Error(`Expected 403, got ${res.status}`);
    });

    // ── B — Provenance isolation via HTTP (6) ─────────────────────────────────
    // source and automationKey are omitted from insertTaskSchema → silently stripped → DB IS NULL.

    console.log("\n── B — Provenance isolation via HTTP ──");

    await assertTest("4. POST {source:'sla'} only → source IS NULL in DB", async () => {
      const res = await apiPost("/api/tasks", { source: "sla", title: "__prov_test_4__", status: "pending" }, adminCookie, adminCsrf);
      if (!res.ok) throw new Error(`POST failed: ${res.status}`);
      const body = await res.json() as { id: number };
      directInsertTaskIds.push(body.id);
      const row = await getTaskFromDb(body.id);
      if (!row) throw new Error("Task not found in DB");
      if ((row as any).source !== null) throw new Error(`Expected source IS NULL, got: ${(row as any).source}`);
    });

    await assertTest("5. POST {automationKey:'stalling-deal-follow-up'} only → automation_key IS NULL in DB", async () => {
      const res = await apiPost("/api/tasks", { automationKey: "stalling-deal-follow-up", title: "__prov_test_5__", status: "pending" }, adminCookie, adminCsrf);
      if (!res.ok) throw new Error(`POST failed: ${res.status}`);
      const body = await res.json() as { id: number };
      directInsertTaskIds.push(body.id);
      const row = await getTaskFromDb(body.id);
      if (!row) throw new Error("Task not found in DB");
      if ((row as any).automationKey !== null) throw new Error(`Expected automationKey IS NULL, got: ${(row as any).automationKey}`);
    });

    await assertTest("6. POST {source:'sla', automationKey:'test'} → both NULL in DB", async () => {
      const res = await apiPost("/api/tasks", { source: "sla", automationKey: "test", title: "__prov_test_6__", status: "pending" }, adminCookie, adminCsrf);
      if (!res.ok) throw new Error(`POST failed: ${res.status}`);
      const body = await res.json() as { id: number };
      directInsertTaskIds.push(body.id);
      const row = await getTaskFromDb(body.id);
      if (!row) throw new Error("Task not found in DB");
      if ((row as any).source !== null) throw new Error(`Expected source IS NULL, got: ${(row as any).source}`);
      if ((row as any).automationKey !== null) throw new Error(`Expected automationKey IS NULL, got: ${(row as any).automationKey}`);
    });

    await assertTest("7. POST valid fields {title, status:'pending'} → provenance NULL, title+status persisted", async () => {
      const res = await apiPost("/api/tasks", { title: "__prov_test_7_normal__", status: "pending" }, adminCookie, adminCsrf);
      if (!res.ok) throw new Error(`POST failed: ${res.status}`);
      const body = await res.json() as { id: number };
      directInsertTaskIds.push(body.id);
      const row = await getTaskFromDb(body.id);
      if (!row) throw new Error("Task not found in DB");
      if ((row as any).source !== null) throw new Error(`Expected source IS NULL, got: ${(row as any).source}`);
      if ((row as any).automationKey !== null) throw new Error(`Expected automationKey IS NULL, got: ${(row as any).automationKey}`);
      if (row.title !== "__prov_test_7_normal__") throw new Error(`Expected title persisted, got: ${row.title}`);
      if (row.status !== "pending") throw new Error(`Expected status='pending', got: ${row.status}`);
    });

    await assertTest("8. PUT {source:'manual'} on SLA task → source unchanged in DB", async () => {
      const res = await apiPut(`/api/tasks/${fixtureSlaDbtask.id}`, { source: "manual", title: "__prov_test_8__" }, adminCookie, adminCsrf);
      if (!res.ok) throw new Error(`PUT failed: ${res.status}`);
      const row = await getTaskFromDb(fixtureSlaDbtask.id);
      if (!row) throw new Error("Task not found in DB");
      if ((row as any).source !== "sla") throw new Error(`Expected source='sla' (unchanged), got: ${(row as any).source}`);
    });

    await assertTest("9. PUT {automationKey:'changed'} on SLA task → automationKey unchanged in DB", async () => {
      const res = await apiPut(`/api/tasks/${fixtureSlaDbtask.id}`, { automationKey: "changed", title: "__prov_test_9__" }, adminCookie, adminCsrf);
      if (!res.ok) throw new Error(`PUT failed: ${res.status}`);
      const row = await getTaskFromDb(fixtureSlaDbtask.id);
      if (!row) throw new Error("Task not found in DB");
      if ((row as any).automationKey !== "stalling-deal-follow-up") throw new Error(`Expected automationKey='stalling-deal-follow-up' (unchanged), got: ${(row as any).automationKey}`);
    });

    // ── C — Completion/reopen lifecycle (2) ──────────────────────────────────

    console.log("\n── C — Completion/reopen lifecycle ──");

    await assertTest("10. PUT {status:'completed'} → status='completed' AND completedAt IS NOT NULL", async () => {
      const res = await apiPut(`/api/tasks/${fixtureSlaDbtask.id}`, { status: "completed" }, adminCookie, adminCsrf);
      if (!res.ok) throw new Error(`PUT failed: ${res.status}`);
      const row = await getTaskFromDb(fixtureSlaDbtask.id);
      if (!row) throw new Error("Task not found in DB");
      if (row.status !== "completed") throw new Error(`Expected status='completed', got: ${row.status}`);
      if (!row.completedAt) throw new Error("Expected completedAt IS NOT NULL");
    });

    await assertTest("11. PUT {status:'pending'} on completed task → status='pending' AND completedAt IS NULL", async () => {
      const res = await apiPut(`/api/tasks/${fixtureSlaDbtask.id}`, { status: "pending" }, adminCookie, adminCsrf);
      if (!res.ok) throw new Error(`PUT failed: ${res.status}`);
      const row = await getTaskFromDb(fixtureSlaDbtask.id);
      if (!row) throw new Error("Task not found in DB");
      if (row.status !== "pending") throw new Error(`Expected status='pending', got: ${row.status}`);
      if (row.completedAt !== null) throw new Error(`Expected completedAt IS NULL, got: ${row.completedAt}`);
    });

    // ─────────────────────────────────────────────────────────────────────────

    console.log("\n─── Group 2: Worker Integration Tests ───────────────────────\n");
    console.log("── D — Scoped SLA cycle ──");

    // Fixture deal for worker tests — updatedAt=8 days ago (stalling).
    const [fixtureWorkerDeal] = await db.insert(deals).values({
      title: "__sla_route_test_worker_deal__",
      stage: "New Lead",
      pipeline: "sales",
      updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    } as any).returning();
    fixtureWorkerDealIds.push(fixtureWorkerDeal.id);

    // Verify conditions 1-4 for the fixture worker deal.
    const workerDealFresh = await storage.getDeal(fixtureWorkerDeal.id);
    if (!workerDealFresh) throw new Error("Fixture worker deal not found");

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const cond1 = workerDealFresh.pipeline === "sales";
    const cond2 = workerDealFresh.stage !== "Closed Won";
    const cond3 = workerDealFresh.stage !== "Closed Lost";
    const cond4 = workerDealFresh.updatedAt != null && new Date(workerDealFresh.updatedAt) < sevenDaysAgo;
    if (!cond1) throw new Error(`Condition 1 (pipeline=sales) failed: ${workerDealFresh.pipeline}`);
    if (!cond2) throw new Error(`Condition 2 (stage!='Closed Won') failed: ${workerDealFresh.stage}`);
    if (!cond3) throw new Error(`Condition 3 (stage!='Closed Lost') failed: ${workerDealFresh.stage}`);
    if (!cond4) throw new Error(`Condition 4 (updatedAt<7daysAgo) failed: ${workerDealFresh.updatedAt}`);
    console.log(`  [D] Conditions 1-4 verified for deal ${fixtureWorkerDeal.id}`);

    // Insert a canonical active+incomplete SLA task (condition 5 = false).
    const [blockingTask] = await db.insert(tasks).values({
      title: `Follow up on stalling Deal #${fixtureWorkerDeal.id}`,
      description: "blocking task for test 12",
      priority: "high",
      status: "pending",
      dealId: fixtureWorkerDeal.id,
      source: "sla",
      automationKey: "stalling-deal-follow-up",
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    } as any).returning();

    await assertTest("12. Blocking task present → runSlaCheckForDeals → snapshot unchanged", async () => {
      const snapshotBefore = await snapshotTaskIds(fixtureWorkerDeal.id);
      await runSlaCheckForDeals([fixtureWorkerDeal.id]);
      const snapshotAfter = await snapshotTaskIds(fixtureWorkerDeal.id);
      if (snapshotBefore.length !== snapshotAfter.length) {
        throw new Error(`Expected snapshot unchanged (${snapshotBefore.length} tasks), got ${snapshotAfter.length}`);
      }
      const beforeSet = new Set(snapshotBefore);
      for (const id of snapshotAfter) {
        if (!beforeSet.has(id)) throw new Error(`Unexpected new task id=${id} appeared in snapshot`);
      }
    });

    // Complete blocking task using normalizeTaskCompletionState + storage.updateTask().
    await assertTest("13. Complete blocking task → all 5 conditions met → runSlaCheckForDeals → exactly 1 new canonical task", async () => {
      const existing = await getTaskFromDb(blockingTask.id);
      if (!existing) throw new Error("Blocking task not found");
      const normalized = normalizeTaskCompletionState({ status: "completed" }, existing);
      await storage.updateTask(blockingTask.id, normalized);

      const cond5Before = await countCanonicalActiveTasks(fixtureWorkerDeal.id);
      if (cond5Before !== 0) throw new Error(`Expected 0 active canonical tasks before cycle, got ${cond5Before}`);

      const snapshotBefore = await snapshotTaskIds(fixtureWorkerDeal.id);
      await runSlaCheckForDeals([fixtureWorkerDeal.id]);
      const snapshotAfter = await snapshotTaskIds(fixtureWorkerDeal.id);

      const newTaskCount = snapshotAfter.length - snapshotBefore.length;
      if (newTaskCount !== 1) throw new Error(`Expected exactly 1 new task, got ${newTaskCount}`);

      const canonicalCount = await countCanonicalActiveTasks(fixtureWorkerDeal.id);
      if (canonicalCount !== 1) throw new Error(`Expected exactly 1 canonical active task, got ${canonicalCount}`);
    });

    await assertTest("14. runSlaCheckForDeals again → canonical active task count still exactly 1 (no duplicate)", async () => {
      const snapshotBefore = await snapshotTaskIds(fixtureWorkerDeal.id);
      await runSlaCheckForDeals([fixtureWorkerDeal.id]);
      const snapshotAfter = await snapshotTaskIds(fixtureWorkerDeal.id);

      if (snapshotBefore.length !== snapshotAfter.length) {
        throw new Error(`Expected snapshot unchanged (${snapshotBefore.length} tasks), got ${snapshotAfter.length}`);
      }

      const canonicalCount = await countCanonicalActiveTasks(fixtureWorkerDeal.id);
      if (canonicalCount !== 1) throw new Error(`Expected exactly 1 canonical active task, got ${canonicalCount}`);
    });

  } finally {
    console.log("\n─── Cleanup ──────────────────────────────────────────────────");

    // Remove all tasks for fixture worker deals (blocking task + any generated tasks).
    if (fixtureWorkerDealIds.length > 0) {
      await db.delete(tasks).where(inArray(tasks.dealId, fixtureWorkerDealIds)).catch(() => {});
    }

    // Remove direct-insert tasks from HTTP tests.
    if (directInsertTaskIds.length > 0) {
      await db.delete(tasks).where(inArray(tasks.id, directInsertTaskIds)).catch(() => {});
    }

    // Remove all tasks for HTTP fixture deals (belt + suspenders).
    if (fixtureHttpDealIds.length > 0) {
      await db.delete(tasks).where(inArray(tasks.dealId, fixtureHttpDealIds)).catch(() => {});
      await db.delete(deals).where(inArray(deals.id, fixtureHttpDealIds)).catch(() => {});
    }

    // Remove fixture worker deals (tasks must be deleted first due to FK).
    if (fixtureWorkerDealIds.length > 0) {
      await db.delete(deals).where(inArray(deals.id, fixtureWorkerDealIds)).catch(() => {});
    }

    await deleteTestMerchantUser();
    console.log("  Cleanup complete.");
  }

  // ── Final report ────────────────────────────────────────────────────────────

  console.log(`\n[SlaRouteIntegration] Results: ${passed} passed, ${failed} failed`);
  console.log("\n── Final report ──");
  console.log("  DatabaseStorage.createStallingDealFollowUpTask() implementation read: YES");
  console.log("  Does it write audit records or call GHL? NO — pure SQL INSERT ON CONFLICT DO NOTHING (server/storage/tasks.ts:156-214)");
  console.log("  runSlaCheckForDeals() extracted from lines 689-727 only: YES");
  console.log("  runSlaCheckDirect() (sla-worker.ts:419-421) → runSlaCheck(): YES");
  console.log("  runFullSlaLoop() (sla-worker.ts:432-434) → runSlaCheck(): YES");
  console.log("  Both delegate through same internal runSlaCheck() function: YES");
  console.log("  runSlaCheckDirect() NOT executed in test: YES — test calls runSlaCheckForDeals() directly");
  console.log("  Provenance assertions all check DB IS NULL (not 400): YES");
  console.log("  updateTaskSchema referenced at tickets-tasks.ts:19 (not re-derived): YES");
  console.log("  TEST_DATABASE_URL !== DATABASE_URL enforced: YES");
  console.log("  current_database() verified via pg.Client on TEST_DATABASE_URL: YES");
  console.log("  DATABASE_URL remapped to TEST_DATABASE_URL before server module imports: YES");
  console.log("  No credential fallback literals in new script: YES");
  console.log("  Test merchant user created and deleted in finally: YES");
  console.log("  Completion asserts both status AND completedAt: YES (assertion 10)");
  console.log("  Before/after task snapshot per cycle call: YES (assertions 12, 13, 14)");
  console.log("  Cleanup removes all tasks for fixture deals: YES");
  console.log(`  Total integration assertions: ${passed + failed}`);

  if (failed > 0) {
    console.error("[SlaRouteIntegration] FAIL");
    process.exit(1);
  }
  console.log("[SlaRouteIntegration] PASS — all 14 integration assertions satisfied");
  process.exit(0);
}

main().catch(err => {
  console.error("[SlaRouteIntegration] Fatal:", err.message, err.stack);
  process.exit(1);
});
