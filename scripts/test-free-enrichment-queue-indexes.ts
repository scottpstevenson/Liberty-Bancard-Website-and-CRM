#!/usr/bin/env tsx
/**
 * Task #1906 regression test: free-enrichment queue index & UNION ALL plan.
 *
 * Verifies:
 *  1. The two new partial indexes (migration 0264) exist.
 *  2. The worker eligibility query (retryable-failed + stale-enriched branches,
 *     copied verbatim from runCanonicalBusinessEnrichmentTick in
 *     server/services/queue-manager.ts) and the health depth query (copied
 *     verbatim from canonicalFreeEnrichmentQueueDepth in
 *     server/routes/lead-ops.ts) agree on inclusion/exclusion at the 89/90/91
 *     day boundary.
 *  3. EXPLAIN (ANALYZE, BUFFERS) on both queries shows no full `Seq Scan on
 *     businesses` once the table has a representative row count.
 *
 * Run with: npx tsx scripts/test-free-enrichment-queue-indexes.ts
 */
import { db, pool } from "../server/db";
import { sql } from "drizzle-orm";

let passed = 0;
let failed = 0;
function assert(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

const TEST_DOMAIN_PREFIX = "task1906-free-enrich-test-";
const seededIds: number[] = [];

async function seedBusiness(opts: {
  suffix: string;
  status: string | null;
  attemptCount?: number;
  completedAtSql?: ReturnType<typeof sql>;
  recordClass?: string;
  domain?: boolean;
}): Promise<number> {
  const ts = Date.now();
  const name = `Task1906 Test Business ${opts.suffix} ${ts}`;
  const domain = opts.domain === false ? null : `${TEST_DOMAIN_PREFIX}${opts.suffix}-${ts}.example.com`;
  const result = await db.execute(sql`
    INSERT INTO businesses (
      canonical_name, normalized_name, record_class, website_domain,
      free_enrichment_status, free_enrichment_attempt_count, free_enrichment_completed_at,
      created_at, updated_at
    )
    VALUES (
      ${name}, ${name.toLowerCase()}, ${opts.recordClass ?? "canonical"}, ${domain},
      ${opts.status}, ${opts.attemptCount ?? 0}, ${opts.completedAtSql ?? null},
      NOW(), NOW()
    )
    RETURNING id
  `);
  const rows = (result as any).rows ?? result;
  const id = Number(rows[0]?.id);
  if (!id) throw new Error(`Failed to seed test business (${opts.suffix})`);
  seededIds.push(id);
  return id;
}

const RUN_TAG = `task1906-${Date.now()}`;

async function cleanup() {
  // Batch-delete by the run tag prefix in a single statement each — looping
  // a per-id DELETE over tens of thousands of filler rows is what caused an
  // earlier version of this script to hang for minutes during cleanup.
  // Deleting ~60K rows can exceed the pool's default 30s statement_timeout,
  // so this runs inside a dedicated transaction with the timeout lifted
  // (same pattern used for large DDL/backfills elsewhere in this codebase).
  const namePattern = RUN_TAG + '%';
  const deletedCount = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = 0`);
    await tx.execute(sql`
      DELETE FROM master_leads WHERE canonical_business_id IN (
        SELECT id FROM businesses WHERE canonical_name LIKE ${namePattern} OR canonical_name LIKE 'Task1906 Test Business %'
      )
    `);
    await tx.execute(sql`
      DELETE FROM canonical_source_links WHERE business_id IN (
        SELECT id FROM businesses WHERE canonical_name LIKE ${namePattern} OR canonical_name LIKE 'Task1906 Test Business %'
      )
    `);
    await tx.execute(sql`
      DELETE FROM field_route_stops WHERE business_id IN (
        SELECT id FROM businesses WHERE canonical_name LIKE ${namePattern} OR canonical_name LIKE 'Task1906 Test Business %'
      )
    `);
    const deleted = await tx.execute(sql`
      DELETE FROM businesses
      WHERE canonical_name LIKE ${namePattern} OR canonical_name LIKE 'Task1906 Test Business %'
      RETURNING id
    `);
    const deletedRows = (deleted as any).rows ?? deleted;
    return deletedRows.length;
  }).catch((err) => {
    console.error(`  ✗ Cleanup transaction failed — manual cleanup may be required: ${err instanceof Error ? err.message : err}`);
    return -1;
  });
  console.log(`  ℹ  Cleaned up ${deletedCount} test businesses (tracked: ${seededIds.length})`);
}

/** Verbatim copy of the eligibility SELECT from runCanonicalBusinessEnrichmentTick(). */
async function workerEligibleIds(limit = 10000): Promise<Set<number>> {
  const rows = await db.execute(sql`
    SELECT id FROM (
      SELECT id FROM businesses
      WHERE website_domain IS NOT NULL
        AND record_class = 'canonical'
        AND free_enrichment_status IS NULL

      UNION ALL

      SELECT id FROM businesses
      WHERE website_domain IS NOT NULL
        AND record_class = 'canonical'
        AND free_enrichment_status = 'failed'
        AND free_enrichment_attempt_count < 3

      UNION ALL

      SELECT id FROM businesses
      WHERE website_domain IS NOT NULL
        AND record_class = 'canonical'
        AND free_enrichment_status = 'enriched'
        AND free_enrichment_completed_at < NOW() - INTERVAL '90 days'
    ) eligible
    ORDER BY id
    LIMIT ${limit}
  `);
  const list = (rows as any).rows ?? rows;
  return new Set(list.map((r: any) => Number(r.id)));
}

/** Verbatim copy of the depth SELECT from canonicalFreeEnrichmentQueueDepth. */
async function healthDepth(): Promise<number> {
  const result = await db.execute(sql`
    SELECT COALESCE(SUM(cnt), 0)::int AS count FROM (
      SELECT COUNT(*) AS cnt FROM businesses
      WHERE website_domain IS NOT NULL
        AND record_class = 'canonical'
        AND free_enrichment_status IS NULL

      UNION ALL

      SELECT COUNT(*) AS cnt FROM businesses
      WHERE website_domain IS NOT NULL
        AND record_class = 'canonical'
        AND free_enrichment_status = 'failed'
        AND free_enrichment_attempt_count < 3

      UNION ALL

      SELECT COUNT(*) AS cnt FROM businesses
      WHERE website_domain IS NOT NULL
        AND record_class = 'canonical'
        AND free_enrichment_status = 'enriched'
        AND free_enrichment_completed_at < NOW() - INTERVAL '90 days'
    ) branches
  `);
  const rows = (result as any).rows ?? result;
  return Number(rows[0]?.count ?? 0);
}

/** Depth restricted to a specific set of business ids (test isolation helper). */
async function healthDepthForIds(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const idList = sql.join(ids.map((v) => sql`${v}`), sql`, `);
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM businesses
    WHERE id IN (${idList})
      AND website_domain IS NOT NULL
      AND record_class = 'canonical'
      AND (
        free_enrichment_status IS NULL
        OR (free_enrichment_status = 'failed' AND free_enrichment_attempt_count < 3)
        OR (free_enrichment_status = 'enriched' AND free_enrichment_completed_at < NOW() - INTERVAL '90 days')
      )
  `);
  const rows = (result as any).rows ?? result;
  return Number(rows[0]?.count ?? 0);
}

async function assertNoSeqScan(label: string, query: ReturnType<typeof sql>) {
  const explain = await db.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${query}`);
  const rows = (explain as any).rows ?? explain;
  const planText = rows.map((r: any) => r["QUERY PLAN"] ?? Object.values(r)[0]).join("\n");
  const hasSeqScanOnBusinesses = /Seq Scan on businesses\b/i.test(planText);
  assert(`${label}: no Seq Scan on businesses`, !hasSeqScanOnBusinesses,
    hasSeqScanOnBusinesses ? planText.split("\n").slice(0, 6).join(" | ") : "");
  return planText;
}

async function seedBulkFillerRows(count: number) {
  // Representative dataset so the planner has a reason to prefer an index
  // scan over a sequential scan (a tiny table always favors Seq Scan).
  // Names/domains are tagged with a per-run identifier so a partial failure
  // never collides with a subsequent run's filler rows.
  const result = await db.execute(sql`
    INSERT INTO businesses (canonical_name, normalized_name, record_class, website_domain,
      free_enrichment_status, free_enrichment_attempt_count, free_enrichment_completed_at,
      created_at, updated_at)
    SELECT
      ${RUN_TAG} || '-filler-' || g,
      ${RUN_TAG} || '-filler-' || g,
      'canonical',
      ${RUN_TAG} || '-filler-' || g || '.example.com',
      (ARRAY[NULL, 'failed', 'enriched', 'pending', 'skipped'])[1 + (g % 5)],
      (g % 4),
      CASE WHEN (g % 5) = 2 THEN NOW() - ((g % 400) || ' days')::interval ELSE NULL END,
      NOW(), NOW()
    FROM generate_series(1, ${count}) AS g
    RETURNING id
  `);
  const rows = (result as any).rows ?? result;
  for (const r of rows) seededIds.push(Number(r.id));
}

async function main() {
  console.log("Task #1906 — free-enrichment queue index & plan regression test\n");

  // ── 1. Index existence ─────────────────────────────────────────────────────
  const idxRows = ((await db.execute(sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'businesses' AND indexname LIKE 'businesses_free_enrich_%'
  `)) as any).rows;
  const idxNames = new Set(idxRows.map((r: any) => r.indexname));
  assert("businesses_free_enrich_queue_idx exists (migration 0250, untouched)", idxNames.has("businesses_free_enrich_queue_idx"));
  assert("businesses_free_enrich_retryable_failed_idx exists (migration 0264)", idxNames.has("businesses_free_enrich_retryable_failed_idx"));
  assert("businesses_free_enrich_stale_idx exists (migration 0264)", idxNames.has("businesses_free_enrich_stale_idx"));

  // ── 2. No time-varying function in the index predicates ────────────────────
  const predRows = ((await db.execute(sql`
    SELECT c.relname AS indexname, pg_get_expr(idx.indpred, idx.indrelid) AS predicate
    FROM pg_index idx
    JOIN pg_class c ON c.oid = idx.indexrelid
    WHERE c.relname IN ('businesses_free_enrich_retryable_failed_idx', 'businesses_free_enrich_stale_idx')
  `)) as any).rows;
  for (const row of predRows) {
    assert(`${row.indexname} predicate has no NOW()/CURRENT_TIMESTAMP`,
      !/now\(\)|current_timestamp/i.test(row.predicate), row.predicate);
  }

  try {
    // ── 3. 89 / 90 / 91 day boundary — worker eligibility + health depth ──────
    const id89 = await seedBusiness({ suffix: "89d", status: "enriched", completedAtSql: sql`NOW() - INTERVAL '89 days'` });
    const id90 = await seedBusiness({ suffix: "90d", status: "enriched", completedAtSql: sql`NOW() - INTERVAL '90 days'` });
    const id91 = await seedBusiness({ suffix: "91d", status: "enriched", completedAtSql: sql`NOW() - INTERVAL '91 days'` });

    const eligible = await workerEligibleIds();
    assert("Worker: 89-day-old enriched business is EXCLUDED", !eligible.has(id89));
    // At the instant the row was inserted it was exactly 90 days old; by the
    // time this SELECT runs, real elapsed time has already pushed it past the
    // strict "< NOW() - INTERVAL '90 days'" cutoff, so it is correctly included —
    // this is the intended boundary behavior of a strict less-than comparison.
    assert("Worker: 90-day-old enriched business is INCLUDED at boundary", eligible.has(id90));
    assert("Worker: 91-day-old enriched business is INCLUDED", eligible.has(id91));

    const depth89 = await healthDepthForIds([id89]);
    const depth90 = await healthDepthForIds([id90]);
    const depth91 = await healthDepthForIds([id91]);
    assert("Health depth: 89-day-old business EXCLUDED from count", depth89 === 0);
    assert("Health depth: 90-day-old business INCLUDED in count at boundary", depth90 === 1);
    assert("Health depth: 91-day-old business INCLUDED in count", depth91 === 1);

    // ── 4. Retryable-failed branch: attempt_count boundary ──────────────────
    const idFailedRetryable = await seedBusiness({ suffix: "failed-retryable", status: "failed", attemptCount: 2 });
    const idFailedExhausted = await seedBusiness({ suffix: "failed-exhausted", status: "failed", attemptCount: 3 });
    const eligible2 = await workerEligibleIds();
    assert("Worker: failed business with attempt_count<3 is INCLUDED", eligible2.has(idFailedRetryable));
    assert("Worker: failed business with attempt_count>=3 is EXCLUDED", !eligible2.has(idFailedExhausted));
    assert("Health depth: failed+attempt_count<3 INCLUDED", (await healthDepthForIds([idFailedRetryable])) === 1);
    assert("Health depth: failed+attempt_count>=3 EXCLUDED", (await healthDepthForIds([idFailedExhausted])) === 0);

    // ── 5. Null-status branch (sanity — migration 0250, untouched) ──────────
    const idNull = await seedBusiness({ suffix: "null-status", status: null });
    const eligible3 = await workerEligibleIds();
    assert("Worker: null-status business is INCLUDED", eligible3.has(idNull));
    assert("Health depth: null-status business INCLUDED", (await healthDepthForIds([idNull])) === 1);

    // ── 6. record_class guard — non-canonical rows must never appear ────────
    const idNonCanonical = await seedBusiness({ suffix: "non-canonical", status: null, recordClass: "unknown" });
    const eligible4 = await workerEligibleIds();
    assert("Worker: non-canonical business is EXCLUDED regardless of status", !eligible4.has(idNonCanonical));
    assert("Health depth: non-canonical business EXCLUDED", (await healthDepthForIds([idNonCanonical])) === 0);

    // ── 7. Overall depth sums the three branches consistently ───────────────
    const totalDepth = await healthDepth();
    const eligibleSetFull = await workerEligibleIds(1_000_000);
    assert("Worker eligible-set size and health depth agree",
      eligibleSetFull.size === totalDepth,
      `worker=${eligibleSetFull.size} health=${totalDepth}`);

    // ── 8. EXPLAIN plans — no full Seq Scan on businesses ────────────────────
    // Build up a representative dataset first — a handful of rows always
    // favors a sequential scan regardless of indexing.
    console.log("\n  Seeding representative dataset for EXPLAIN plans (this may take a moment)…");
    await seedBulkFillerRows(60_000);

    console.log("\n  Worker batch query plan:");
    const workerQuery = sql`
      SELECT id FROM (
        SELECT id FROM businesses
        WHERE website_domain IS NOT NULL AND record_class = 'canonical' AND free_enrichment_status IS NULL
        UNION ALL
        SELECT id FROM businesses
        WHERE website_domain IS NOT NULL AND record_class = 'canonical' AND free_enrichment_status = 'failed' AND free_enrichment_attempt_count < 3
        UNION ALL
        SELECT id FROM businesses
        WHERE website_domain IS NOT NULL AND record_class = 'canonical' AND free_enrichment_status = 'enriched' AND free_enrichment_completed_at < NOW() - INTERVAL '90 days'
      ) eligible ORDER BY id LIMIT 20
    `;
    const workerPlan = await assertNoSeqScan("Worker batch query", workerQuery);
    console.log(workerPlan.split("\n").map((l) => `    ${l}`).join("\n"));

    console.log("\n  Health depth query plan:");
    const depthQuery = sql`
      SELECT COALESCE(SUM(cnt), 0)::int AS count FROM (
        SELECT COUNT(*) AS cnt FROM businesses
        WHERE website_domain IS NOT NULL AND record_class = 'canonical' AND free_enrichment_status IS NULL
        UNION ALL
        SELECT COUNT(*) AS cnt FROM businesses
        WHERE website_domain IS NOT NULL AND record_class = 'canonical' AND free_enrichment_status = 'failed' AND free_enrichment_attempt_count < 3
        UNION ALL
        SELECT COUNT(*) AS cnt FROM businesses
        WHERE website_domain IS NOT NULL AND record_class = 'canonical' AND free_enrichment_status = 'enriched' AND free_enrichment_completed_at < NOW() - INTERVAL '90 days'
      ) branches
    `;
    const depthPlan = await assertNoSeqScan("Health depth query", depthQuery);
    console.log(depthPlan.split("\n").map((l) => `    ${l}`).join("\n"));

  } finally {
    await cleanup();
  }

  console.log(`\nTask #1906 checks: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Task #1906 test failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end().catch(() => {});
});
