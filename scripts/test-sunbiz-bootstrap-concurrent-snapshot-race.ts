#!/usr/bin/env tsx
/**
 * Proves the atomic all-or-none snapshot-acquisition fix (9th review round):
 * runSunbizBootstrapBatch(limit, opts, expectedFilingNumbers) must acquire a
 * claim on EVERY expected filing_number inside a single transaction and roll
 * back the whole batch — zero durable writes — if any single acquisition
 * fails, rather than racing a "select fresh + compare to expected" check
 * against a per-item claim loop (which left a TOCTOU window: two concurrent
 * confirmed runs could both pass the comparison before either claimed
 * anything, then split the claims between them).
 *
 * This test drives two REAL concurrent runSunbizBootstrapBatch() calls
 * against the same two fixture entities with an identical expected
 * snapshot — exactly "two concurrent confirmed runs" — and proves:
 *   1. Exactly one call succeeds, creating businesses for BOTH entities
 *      (never a partial subset).
 *   2. The other call is rejected with SunbizBootstrapSnapshotDriftError.
 *   3. The losing call performed literally zero durable writes: no stray
 *      claim rows, no orphaned businesses, no partial lineage — the DB state
 *      after both calls settle is indistinguishable from the winner having
 *      run alone.
 *
 * Run with: npx tsx scripts/test-sunbiz-bootstrap-concurrent-snapshot-race.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { runSunbizBootstrapBatch, SunbizBootstrapSnapshotDriftError } from "../server/services/sunbiz-bootstrap";

let passed = 0;
let failed = 0;
function assert(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.error(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

const RUN_ID = Date.now() % 10_000_000;
const FILING_PREFIX = `task1971-race-${RUN_ID}-`;
const seededEntityIds: number[] = [];

async function seedEntity(idx: number) {
  const filingNumber = `${FILING_PREFIX}${idx}`;
  const rows = (await db.execute(sql`
    INSERT INTO sunbiz_entities (filing_number, entity_name, score, enrichment_status, website, source)
    VALUES (${filingNumber}, ${`Task1971 Race Test Co ${RUN_ID}-${idx}`}, 'hot', 'enriched', ${`https://race-test-${RUN_ID}-${idx}.example.com`}, 'sunbiz')
    RETURNING id
  `)).rows as any[];
  const id = Number(rows[0].id);
  seededEntityIds.push(id);
  return { id, filingNumber };
}

async function cleanup() {
  await db.execute(sql`DELETE FROM canonical_source_links WHERE source_system = 'sunbiz' AND stable_key LIKE ${FILING_PREFIX + "%"}`);
  const claimedBusinessIds = (await db.execute(sql`
    SELECT business_id FROM sunbiz_bootstrap_claims WHERE filing_number LIKE ${FILING_PREFIX + "%"} AND business_id IS NOT NULL
  `)).rows as any[];
  await db.execute(sql`DELETE FROM sunbiz_bootstrap_claims WHERE filing_number LIKE ${FILING_PREFIX + "%"}`);
  for (const row of claimedBusinessIds) {
    await db.execute(sql`DELETE FROM businesses WHERE id = ${Number(row.business_id)}`);
  }
  if (seededEntityIds.length > 0) {
    await db.execute(sql`DELETE FROM sunbiz_entities WHERE id = ANY(${sql.raw(`ARRAY[${seededEntityIds.join(",")}]::int[]`)})`);
  }
}

async function main() {
  console.log(`[test-sunbiz-bootstrap-concurrent-snapshot-race] run id ${RUN_ID}`);

  try {
    const a = await seedEntity(1);
    const b = await seedEntity(2);
    const expectedFilingNumbers = [a.filingNumber, b.filingNumber];

    // Fire two REAL concurrent runs against the identical expected snapshot —
    // this is what two admins (or a double-click) confirming the same
    // preview at nearly the same instant looks like at the DB layer.
    const [resultOne, resultTwo] = await Promise.allSettled([
      runSunbizBootstrapBatch(25, {}, expectedFilingNumbers),
      runSunbizBootstrapBatch(25, {}, expectedFilingNumbers),
    ]);

    const fulfilled = [resultOne, resultTwo].filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>[];
    const rejected = [resultOne, resultTwo].filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    assert("exactly one of the two concurrent runs succeeded", fulfilled.length === 1, JSON.stringify([resultOne, resultTwo]));
    assert("exactly one of the two concurrent runs was rejected", rejected.length === 1, JSON.stringify([resultOne, resultTwo]));

    if (fulfilled.length === 1) {
      const outcomes = fulfilled[0].value as any[];
      const created = outcomes.filter((o) => o.outcome === "created");
      assert("the winning run created BOTH entities — never a partial subset", created.length === 2, JSON.stringify(outcomes));
    }

    if (rejected.length === 1) {
      assert("the losing run's rejection is SunbizBootstrapSnapshotDriftError", rejected[0].reason instanceof SunbizBootstrapSnapshotDriftError, String(rejected[0].reason));
    }

    // The decisive assertion: total durable state must reflect exactly ONE
    // full pass over both entities — not zero, not four (double-created),
    // not a 1+1 split between the two callers.
    const claimRows = (await db.execute(sql`
      SELECT filing_number, status, business_id FROM sunbiz_bootstrap_claims
      WHERE filing_number = ANY(${sql.raw(`ARRAY['${a.filingNumber}','${b.filingNumber}']::text[]`)})
      ORDER BY filing_number
    `)).rows as any[];
    assert("exactly 2 claim rows exist (one per fixture, no duplicates or partial splits)", claimRows.length === 2, JSON.stringify(claimRows));
    assert("both claims are terminally 'created' with a business_id — none left dangling from the loser",
      claimRows.every((r) => r.status === "created" && r.business_id !== null), JSON.stringify(claimRows));

    const businessCount = (await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM canonical_source_links WHERE source_system = 'sunbiz' AND stable_key = ANY(${sql.raw(`ARRAY['${a.filingNumber}','${b.filingNumber}']::text[]`)})
    `)).rows[0] as any;
    assert("exactly 2 lineage rows exist — the loser left no orphaned lineage or businesses", Number(businessCount.n) === 2, String(businessCount.n));
  } finally {
    await cleanup();
  }

  console.log(`\n[test-sunbiz-bootstrap-concurrent-snapshot-race] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => {});
  process.exit(1);
});
