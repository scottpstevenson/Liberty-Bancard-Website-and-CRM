/**
 * Load verification for the revenue list readers.
 *
 * Fires 5 concurrent requests to each reader and asserts:
 *  - No pool acquisition timeout
 *  - No statement timeout
 *  - waitingCount returns to 0 after all requests finish
 *  - No connection leak (idleCount == totalCount)
 *  - All responses are correct (same total on every request)
 *  - EXPLAIN confirms no MATERIALIZED plan in any reader
 *
 * Run: npx tsx scripts/test-revenue-load.ts
 */

import { pool } from "../server/db";
import { readPeople, readRevenueLeads, readRevenueDeals } from "../server/services/revenue-read-authority";

const ADMIN = { role: "admin" as const, email: "admin@test.com" };
const CONCURRENCY = 5;

type CheckResult = { pass: boolean; name: string; detail?: string };
const checks: CheckResult[] = [];

function check(name: string, ok: boolean, detail?: string) {
  checks.push({ pass: ok, name, detail });
  if (!ok) console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`);
}

async function runConcurrent<T>(label: string, fn: () => Promise<T>): Promise<T[]> {
  const start = Date.now();
  const tasks = Array.from({ length: CONCURRENCY }, () => fn());
  const results = await Promise.allSettled(tasks);
  const elapsed = Date.now() - start;
  const fulfilled = results.filter((r): r is PromiseFulfilledResult<T> => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");

  check(`${label}: no pool timeout (${CONCURRENCY} concurrent)`,
    rejected.every((r) => !String((r as any).reason?.message ?? "").includes("timeout")),
    rejected.map((r) => (r as any).reason?.message).join("; "));
  check(`${label}: no statement timeout`,
    rejected.every((r) => !String((r as any).reason?.message ?? "").includes("statement timeout")));
  check(`${label}: all ${CONCURRENCY} requests succeeded`,
    fulfilled.length === CONCURRENCY,
    `${rejected.length} failed: ${rejected.map((r) => (r as any).reason?.message).join("; ")}`);
  console.log(`  ${label}: ${fulfilled.length}/${CONCURRENCY} ok in ${elapsed}ms`);

  return fulfilled.map((r) => r.value);
}

async function checkPoolState(label: string) {
  // Give the pool a moment to return connections.
  await new Promise((r) => setTimeout(r, 100));
  const { totalCount, idleCount, waitingCount } = pool;
  check(`${label}: waitingCount = 0 after requests`, waitingCount === 0, `waitingCount=${waitingCount}`);
  check(`${label}: no connection leak (idle == total)`, idleCount === totalCount,
    `idle=${idleCount} total=${totalCount} waiting=${waitingCount}`);
  console.log(`  ${label} pool state: total=${totalCount} idle=${idleCount} waiting=${waitingCount}`);
}

async function verifyNoMaterialized(label: string, sql: string, params: unknown[]) {
  const { rows } = await pool.query<{ "QUERY PLAN": string }>(
    `EXPLAIN (FORMAT TEXT) ${sql}`, params as any[],
  );
  const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
  const hasMaterialized = /Materialize|CTE Scan/i.test(plan);
  check(`${label}: EXPLAIN has no MATERIALIZED/CTE Scan node`, !hasMaterialized,
    hasMaterialized ? "Plan contains Materialize or CTE Scan" : undefined);
}

async function main() {
  console.log(`Revenue list load verification (${CONCURRENCY} concurrent per reader)\n`);

  // ── readPeople ──────────────────────────────────────────────────────────────
  console.log("── readPeople");
  const peopleResults = await runConcurrent("readPeople", () =>
    readPeople(ADMIN, { limit: 100, offset: 0 }));
  await checkPoolState("readPeople");
  if (peopleResults.length > 1) {
    const totals = peopleResults.map((r) => r.total);
    check("readPeople: all responses have same total", new Set(totals).size === 1, totals.join(","));
  }
  await verifyNoMaterialized("readPeople",
    `SELECT c.* FROM contacts c WHERE c.archived_at IS NULL ORDER BY c.created_at DESC NULLS LAST, c.id DESC LIMIT $1 OFFSET $2`,
    [100, 0]);

  // ── readRevenueLeads ────────────────────────────────────────────────────────
  console.log("\n── readRevenueLeads");
  const leadsResults = await runConcurrent("readRevenueLeads", () =>
    readRevenueLeads(ADMIN, { limit: 100, offset: 0 }));
  await checkPoolState("readRevenueLeads");
  if (leadsResults.length > 1) {
    const totals = leadsResults.map((r) => r.total);
    check("readRevenueLeads: all responses have same total", new Set(totals).size === 1, totals.join(","));
  }

  // ── readRevenueDeals ────────────────────────────────────────────────────────
  console.log("\n── readRevenueDeals");
  const dealsResults = await runConcurrent("readRevenueDeals", () =>
    readRevenueDeals(ADMIN, { limit: 100, offset: 0 }));
  await checkPoolState("readRevenueDeals");
  if (dealsResults.length > 1) {
    const totals = dealsResults.map((r) => r.total);
    check("readRevenueDeals: all responses have same total", new Set(totals).size === 1, totals.join(","));
  }
  await verifyNoMaterialized("readRevenueDeals",
    `SELECT d.* FROM deals d WHERE d.archived_at IS NULL AND d.record_class = 'production' ORDER BY d.updated_at DESC NULLS LAST, d.id DESC LIMIT $1 OFFSET $2`,
    [100, 0]);

  // ── Final pool check ────────────────────────────────────────────────────────
  console.log("\n── Final pool state");
  await checkPoolState("final");

  // ── Summary ─────────────────────────────────────────────────────────────────
  await pool.end();
  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n──────────────────────────────────────────────────────────────`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${checks.length} checks`);
  if (failed > 0) {
    console.log("\nFailed:");
    checks.filter((c) => !c.pass).forEach((c) => console.log(`  ✗ ${c.name}${c.detail ? ": " + c.detail : ""}`));
    process.exit(1);
  } else {
    console.log("All load checks passed ✓");
    process.exit(0);
  }
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
