/**
 * Regression tests for the revenue list readers (readPeople, readRevenueLeads,
 * readRevenueDeals) after the MATERIALIZED CTE removal.
 *
 * Covers:
 *  - Response contract (required properties and types)
 *  - Admin / manager full visibility
 *  - Rep owned-or-unassigned visibility
 *  - Filtering and search
 *  - Totals and facets
 *  - Empty results
 *  - Deterministic pagination (id tie-breaker)
 *  - Revenue Lead primaryDeal presence
 *  - Pipeline deal results
 *  - Repeated requests return stable totals
 *
 * Run: npx tsx scripts/test-revenue-list-regression.ts
 */

import { pool } from "../server/db";
import { readPeople, readRevenueLeads, readRevenueDeals } from "../server/services/revenue-read-authority";

type Result = { pass: boolean; name: string; detail?: string };
const results: Result[] = [];

function assert(name: string, condition: boolean, detail?: string) {
  results.push({ pass: condition, name, detail });
  if (!condition) console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
}

const ADMIN: { role: "admin"; email: string } = { role: "admin", email: "admin@test.com" };
const MANAGER: { role: "manager"; email: string } = { role: "manager", email: "mgr@test.com" };

// Pick a real rep email if one exists; fall back to a dummy (empty results expected).
async function getRepEmail(): Promise<string> {
  const { rows } = await pool.query<{ email: string }>(
    `SELECT email FROM users WHERE role = 'agent' AND email IS NOT NULL LIMIT 1`,
  );
  return rows[0]?.email ?? "rep-that-does-not-exist@test.invalid";
}

// ── helpers ──────────────────────────────────────────────────────────────────
function hasRequiredContactFields(item: any): boolean {
  return typeof item.id === "number"
    && (typeof item.email === "string" || item.email === null || item.email === undefined)
    && ("createdAt" in item || "created_at" in item);
}

function hasRequiredDealFields(item: any): boolean {
  return typeof item.id === "number" && typeof item.pipeline === "string";
}

// ── readPeople ────────────────────────────────────────────────────────────────
async function testReadPeople() {
  console.log("\n── readPeople ──────────────────────────────────────────────────");

  // 1. Response contract
  const r1 = await readPeople(ADMIN, { limit: 10, offset: 0 });
  assert("contract: has data array", Array.isArray(r1.data));
  assert("contract: data.length <= limit", r1.data.length <= 10);
  assert("contract: total is number", typeof r1.total === "number");
  assert("contract: total >= 0", r1.total >= 0);
  assert("contract: facets.byRecordClass is object", typeof r1.facets?.byRecordClass === "object");
  assert("contract: facets.byEmailHealth is object", typeof r1.facets?.byEmailHealth === "object");
  assert("contract: asOf is ISO string", /^\d{4}-\d{2}-\d{2}T/.test(r1.asOf));
  assert("contract: scope is 'all'", r1.scope === "all");
  assert("contract: limit echoed", r1.limit === 10);
  assert("contract: offset echoed", r1.offset === 0);

  // 2. Total == sum of byRecordClass facet values
  if (Object.keys(r1.facets.byRecordClass).length > 0) {
    const facetSum = Object.values(r1.facets.byRecordClass as Record<string, number>).reduce((a, b) => a + b, 0);
    assert("facets: byRecordClass sums to total", facetSum === r1.total, `sum=${facetSum} total=${r1.total}`);
  }

  // 3. Contact fields present
  if (r1.data.length > 0) {
    assert("contract: contact fields present", hasRequiredContactFields(r1.data[0]));
  }

  // 4. Manager sees same total as admin
  const rm = await readPeople(MANAGER, { limit: 1, offset: 0 });
  assert("visibility: manager total == admin total", rm.total === r1.total, `mgr=${rm.total} admin=${r1.total}`);
  assert("visibility: manager scope='all'", rm.scope === "all");

  // 5. Rep sees own-or-unassigned (total may differ; no error expected)
  const repEmail = await getRepEmail();
  const rr = await readPeople({ role: "agent", email: repEmail }, { limit: 10, offset: 0 });
  assert("visibility: rep result is array", Array.isArray(rr.data));
  assert("visibility: rep scope='owned_or_unassigned'", rr.scope === "owned_or_unassigned");

  // 6. Filtering — recordClass=production
  const rp = await readPeople(ADMIN, { limit: 100, offset: 0, recordClass: "production" });
  assert("filter: recordClass=production returns subset", rp.total <= r1.total);
  if (rp.data.length > 0) {
    assert("filter: all results are production", rp.data.every((c: any) => c.recordClass === "production" || c.record_class === "production"));
  }

  // 7. Filtering — emailHealth filter matches byEmailHealth facet key
  const rh = await readPeople(ADMIN, { limit: 10, offset: 0, emailHealth: "valid" });
  assert("filter: emailHealth=valid returns array", Array.isArray(rh.data));
  if (rh.data.length > 0) {
    assert("filter: all results have emailStatus=valid", rh.data.every((c: any) => (c.emailStatus ?? c.email_status) === "valid"));
  }

  // 8. Search
  const rs = await readPeople(ADMIN, { limit: 10, offset: 0, search: "a" });
  assert("search: returns array", Array.isArray(rs.data));
  assert("search: total >= 0", typeof rs.total === "number" && rs.total >= 0);

  // 9. Empty results (archived contacts, likely none archived if DB is clean)
  const re = await readPeople(ADMIN, { limit: 10, offset: 0, archived: true });
  assert("empty: archived result is valid contract", typeof re.total === "number" && Array.isArray(re.data));

  // 10. Pagination determinism — first+second page IDs must not overlap
  const page1 = await readPeople(ADMIN, { limit: 5, offset: 0 });
  const page2 = await readPeople(ADMIN, { limit: 5, offset: 5 });
  const ids1 = new Set(page1.data.map((c: any) => c.id));
  const ids2 = new Set(page2.data.map((c: any) => c.id));
  const overlap = [...ids1].filter((id) => ids2.has(id));
  assert("pagination: no overlap between page 1 and page 2", overlap.length === 0, `overlap ids: ${overlap.join(",")}`);

  // 11. Stable total across repeated calls
  const r2 = await readPeople(ADMIN, { limit: 10, offset: 0 });
  assert("stability: total is same on repeated calls", r2.total === r1.total);

  // 12. All sort options return without error
  const sortOptions = ["name", "alpha", "createdAtAsc", "updatedAt", "leadScore", "score_desc", "activity_desc", "activity_asc"];
  for (const sort of sortOptions) {
    const rs2 = await readPeople(ADMIN, { limit: 5, offset: 0, sort });
    assert(`sort: ${sort} returns data array`, Array.isArray(rs2.data));
  }
}

// ── readRevenueLeads ──────────────────────────────────────────────────────────
async function testReadRevenueLeads() {
  console.log("\n── readRevenueLeads ────────────────────────────────────────────");

  const r1 = await readRevenueLeads(ADMIN, { limit: 10, offset: 0 });
  assert("contract: has data array", Array.isArray(r1.data));
  assert("contract: total is number", typeof r1.total === "number");
  assert("contract: asOf is ISO string", /^\d{4}-\d{2}-\d{2}T/.test(r1.asOf));
  assert("contract: scope='all'", r1.scope === "all");
  assert("contract: filters.recordClass='production'", (r1.filters as any).recordClass === "production");
  assert("contract: filters.pipeline='sales'", (r1.filters as any).pipeline === "sales");

  // primaryDeal must be present on every returned lead
  if (r1.data.length > 0) {
    assert("primaryDeal: present on all leads", r1.data.every((item: any) => item.primaryDeal !== undefined));
    assert("primaryDeal: has id", r1.data.every((item: any) => typeof item.primaryDeal?.id === "number" || typeof item.primaryDeal?.id === "string"));
    assert("primaryDeal: pipeline=sales", r1.data.every((item: any) => item.primaryDeal?.pipeline === "sales"));
  }

  // Pagination
  const page1 = await readRevenueLeads(ADMIN, { limit: 5, offset: 0 });
  const page2 = await readRevenueLeads(ADMIN, { limit: 5, offset: 5 });
  const ids1 = new Set(page1.data.map((c: any) => c.id));
  const ids2 = new Set(page2.data.map((c: any) => c.id));
  const overlap = [...ids1].filter((id) => ids2.has(id));
  assert("pagination: no overlap between page 1 and page 2", overlap.length === 0);

  // Rep visibility
  const repEmail = await getRepEmail();
  const rr = await readRevenueLeads({ role: "agent", email: repEmail }, { limit: 5, offset: 0 });
  assert("visibility: rep result is array", Array.isArray(rr.data));
  assert("visibility: rep scope='owned_or_unassigned'", rr.scope === "owned_or_unassigned");

  // Empty page beyond total
  if (r1.total < 1000) {
    const rEnd = await readRevenueLeads(ADMIN, { limit: 5, offset: r1.total + 100 });
    assert("empty: offset beyond total returns empty data", rEnd.data.length === 0);
    assert("empty: total still correct on over-paged request", rEnd.total === r1.total);
  }

  // Stable total
  const r2 = await readRevenueLeads(ADMIN, { limit: 10, offset: 0 });
  assert("stability: total is same on repeated calls", r2.total === r1.total);
}

// ── readRevenueDeals ──────────────────────────────────────────────────────────
async function testReadRevenueDeals() {
  console.log("\n── readRevenueDeals ────────────────────────────────────────────");

  const r1 = await readRevenueDeals(ADMIN, { limit: 10, offset: 0 });
  assert("contract: has data array", Array.isArray(r1.data));
  assert("contract: total is number", typeof r1.total === "number");
  assert("contract: asOf is ISO string", /^\d{4}-\d{2}-\d{2}T/.test(r1.asOf));
  assert("contract: scope='all'", r1.scope === "all");

  if (r1.data.length > 0) {
    assert("contract: deal fields present", hasRequiredDealFields(r1.data[0]));
    assert("contract: all results are production", r1.data.every((d: any) => d.recordClass === "production" || d.record_class === "production"));
    // Contact join fields
    assert("contract: contactName field present", "contactName" in r1.data[0] || "contact_name" in r1.data[0]);
  }

  // Pipeline filter
  const rSales = await readRevenueDeals(ADMIN, { limit: 10, offset: 0, pipeline: "sales" });
  assert("filter: pipeline=sales returns array", Array.isArray(rSales.data));
  if (rSales.data.length > 0) {
    assert("filter: all results have pipeline=sales", rSales.data.every((d: any) => d.pipeline === "sales"));
  }

  const rOnboard = await readRevenueDeals(ADMIN, { limit: 10, offset: 0, pipeline: "onboarding" });
  assert("filter: pipeline=onboarding returns array", Array.isArray(rOnboard.data));
  assert("filter: sales+onboarding totals <= all total", rSales.total + rOnboard.total <= r1.total);

  // Pagination
  const page1 = await readRevenueDeals(ADMIN, { limit: 5, offset: 0 });
  const page2 = await readRevenueDeals(ADMIN, { limit: 5, offset: 5 });
  const dids1 = new Set(page1.data.map((d: any) => d.id));
  const dids2 = new Set(page2.data.map((d: any) => d.id));
  const doverlap = [...dids1].filter((id) => dids2.has(id));
  assert("pagination: no overlap between page 1 and page 2", doverlap.length === 0);

  // Rep visibility
  const repEmail = await getRepEmail();
  const rr = await readRevenueDeals({ role: "agent", email: repEmail }, { limit: 5, offset: 0 });
  assert("visibility: rep result is array", Array.isArray(rr.data));
  assert("visibility: rep scope='owned_or_unassigned'", rr.scope === "owned_or_unassigned");

  // Stable total
  const r2 = await readRevenueDeals(ADMIN, { limit: 10, offset: 0 });
  assert("stability: total is same on repeated calls", r2.total === r1.total);
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Revenue list regression tests\n");
  try {
    await testReadPeople();
    await testReadRevenueLeads();
    await testReadRevenueDeals();
  } finally {
    await pool.end();
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n──────────────────────────────────────────────────────────────`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${results.length} checks`);
  if (failed > 0) {
    console.log("\nFailed checks:");
    results.filter((r) => !r.pass).forEach((r) => console.log(`  ✗ ${r.name}${r.detail ? ": " + r.detail : ""}`));
    process.exit(1);
  } else {
    console.log("All checks passed ✓");
    process.exit(0);
  }
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
