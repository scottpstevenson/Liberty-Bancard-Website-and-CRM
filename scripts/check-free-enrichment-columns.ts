/**
 * check-free-enrichment-columns.ts
 *
 * Pre-deploy guard: confirms every column that the free-enrichment lane reads
 * and writes actually exists on the `businesses` table. A missing column turns
 * every atomic-claim UPDATE into a PostgreSQL error, leaving
 * free_enrichment_status = null for the entire batch (20/20 silent failures
 * per tick when running from the compiled dist).
 *
 * This script also performs EXPLAIN dry-runs of the exact SQL statements used
 * by the scheduler eligibility query, the atomic-claim UPDATE (including the
 * DBPR EXISTS subquery and RETURNING clause), and the terminal enriched/failed
 * updates. If any of these fail, the script exits nonzero and reports the exact
 * SQL error.
 *
 * Exit: 0 = all checks pass, 1 = any failure.
 */

import { pool } from "../server/db";

const REQUIRED_COLUMNS: readonly string[] = [
  "free_enrichment_status",
  "free_enrichment_attempt_count",
  "free_enrichment_last_attempt_at",
  "free_enrichment_completed_at",
  "free_enrichment_last_error_code",
  "free_enrichment_evidence",
];

async function run(): Promise<void> {
  const client = await pool.connect();
  let pass = true;

  try {
    // ── 1. Column existence ────────────────────────────────────────────────────
    console.log("\n── Free-Enrichment Column Preflight ──────────────────────────────────");
    const colResult = await client.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'businesses'
        AND column_name  = ANY($1)
    `, [REQUIRED_COLUMNS]);

    const found = new Set(colResult.rows.map((r) => r.column_name));
    const missing = REQUIRED_COLUMNS.filter((c) => !found.has(c));

    if (missing.length === 0) {
      console.log(`  ✓ All ${REQUIRED_COLUMNS.length} required free_enrichment_* columns present on businesses`);
    } else {
      console.error(`  ✗ Missing column(s) on businesses: ${missing.join(", ")}`);
      console.error(`    Run migration 0250_free_enrichment_pipeline.sql against this database.`);
      pass = false;
    }

    // ── 2. Scheduler eligibility SELECT (three-branch UNION ALL) ─────────────
    // Mirrors the exact query executed in queue-manager.ts before runFreeEnrichmentLane().
    console.log("\n── Scheduler Eligibility SELECT Dry-Run ──────────────────────────────");
    try {
      await client.query(`
        EXPLAIN
        SELECT id FROM (
          SELECT id FROM businesses b
          WHERE b.website_domain IS NOT NULL
            AND b.record_class = 'canonical'
            AND b.free_enrichment_status IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM canonical_source_links csl
              WHERE csl.business_id = b.id
                AND csl.source_system ~* 'dbpr'
            )

          UNION ALL

          SELECT id FROM businesses b
          WHERE b.website_domain IS NOT NULL
            AND b.record_class = 'canonical'
            AND b.free_enrichment_status = 'failed'
            AND COALESCE(b.free_enrichment_attempt_count, 0) < 3
            AND NOT EXISTS (
              SELECT 1 FROM canonical_source_links csl
              WHERE csl.business_id = b.id
                AND csl.source_system ~* 'dbpr'
            )

          UNION ALL

          SELECT id FROM businesses b
          WHERE b.website_domain IS NOT NULL
            AND b.record_class = 'canonical'
            AND b.free_enrichment_status = 'enriched'
            AND b.free_enrichment_completed_at < NOW() - INTERVAL '90 days'
            AND NOT EXISTS (
              SELECT 1 FROM canonical_source_links csl
              WHERE csl.business_id = b.id
                AND csl.source_system ~* 'dbpr'
            )
        ) eligible
        ORDER BY id
        LIMIT 20
      `);
      console.log("  ✓ Scheduler eligibility UNION ALL SELECT EXPLAIN succeeded");
    } catch (err: any) {
      console.error(`  ✗ Scheduler eligibility SELECT EXPLAIN failed: ${err?.message}`);
      pass = false;
    }

    // ── 3. Atomic-claim UPDATE (with DBPR subquery + RETURNING) ──────────────
    // Mirrors the exact UPDATE in runFreeBusinessEnrichmentForBusiness() including
    // the businessLacksDbprLineageSql() correlated subquery and RETURNING clause.
    console.log("\n── Atomic-Claim UPDATE Dry-Run (EXPLAIN, id = -1, DBPR subquery + RETURNING) ─");
    try {
      await client.query(`
        EXPLAIN
        UPDATE businesses
        SET free_enrichment_status          = 'processing',
            free_enrichment_last_attempt_at = NOW(),
            free_enrichment_attempt_count   = COALESCE(free_enrichment_attempt_count, 0) + 1
        WHERE id = -1
          AND website_domain IS NOT NULL
          AND record_class   = 'canonical'
          AND NOT EXISTS (
            SELECT 1 FROM canonical_source_links csl
            WHERE csl.business_id = businesses.id
              AND csl.source_system ~* 'dbpr'
          )
          AND (
            free_enrichment_status IS NULL
            OR (free_enrichment_status = 'failed'
                AND COALESCE(free_enrichment_attempt_count, 0) < 3)
            OR (free_enrichment_status = 'enriched'
                AND free_enrichment_completed_at < NOW() - INTERVAL '90 days')
          )
        RETURNING id, website_domain, free_enrichment_attempt_count
      `);
      console.log("  ✓ Atomic-claim UPDATE EXPLAIN (with DBPR subquery + RETURNING) succeeded");
    } catch (err: any) {
      console.error(`  ✗ Atomic-claim UPDATE EXPLAIN failed: ${err?.message}`);
      console.error(`    This is the UPDATE silently throwing for every business in the batch.`);
      pass = false;
    }

    // ── 4. Terminal enriched UPDATE ──────────────────────────────────────────
    console.log("\n── Terminal Enriched UPDATE Dry-Run ──────────────────────────────────");
    try {
      await client.query(`
        EXPLAIN
        UPDATE businesses
        SET free_enrichment_status       = 'enriched',
            free_enrichment_completed_at = NOW(),
            free_enrichment_evidence     = '{}'::jsonb
        WHERE id = -1
      `);
      console.log("  ✓ Terminal enriched UPDATE EXPLAIN succeeded");
    } catch (err: any) {
      console.error(`  ✗ Terminal enriched UPDATE EXPLAIN failed: ${err?.message}`);
      pass = false;
    }

    // ── 5. Terminal failed UPDATE ─────────────────────────────────────────────
    console.log("\n── Terminal Failed UPDATE Dry-Run ────────────────────────────────────");
    try {
      await client.query(`
        EXPLAIN
        UPDATE businesses
        SET free_enrichment_status          = 'failed',
            free_enrichment_last_error_code = 'TEST'
        WHERE id = -1
      `);
      console.log("  ✓ Terminal failed UPDATE EXPLAIN succeeded");
    } catch (err: any) {
      console.error(`  ✗ Terminal failed UPDATE EXPLAIN failed: ${err?.message}`);
      pass = false;
    }

    // ── 6. Lane pre-claim failure UPDATE (outer catch path) ──────────────────
    console.log("\n── Lane Pre-Claim Failure UPDATE Dry-Run ─────────────────────────────");
    try {
      await client.query(`
        EXPLAIN
        UPDATE businesses
        SET free_enrichment_status           = 'failed',
            free_enrichment_last_error_code  = 'LANE_UNCAUGHT_PRE_CLAIM',
            free_enrichment_last_attempt_at  = COALESCE(free_enrichment_last_attempt_at, NOW()),
            free_enrichment_attempt_count    = COALESCE(free_enrichment_attempt_count, 0) + 1
        WHERE id = -1
          AND (free_enrichment_status IS NULL OR free_enrichment_status = 'processing')
      `);
      console.log("  ✓ Pre-claim failure UPDATE EXPLAIN succeeded");
    } catch (err: any) {
      console.error(`  ✗ Pre-claim failure UPDATE EXPLAIN failed: ${err?.message}`);
      pass = false;
    }

    // ── 7. Status-read SELECT + lane-status aggregate ────────────────────────
    console.log("\n── Status-Read and Aggregate SELECT Dry-Runs ────────────────────────");
    try {
      await client.query(`EXPLAIN SELECT free_enrichment_status FROM businesses WHERE id = -1`);
      console.log("  ✓ Status-read SELECT EXPLAIN succeeded");
    } catch (err: any) {
      console.error(`  ✗ Status-read SELECT EXPLAIN failed: ${err?.message}`);
      pass = false;
    }
    try {
      await client.query(`
        EXPLAIN
        SELECT
          COUNT(*)::int AS examined,
          COUNT(*) FILTER (WHERE free_enrichment_status = 'enriched')::int  AS enriched,
          COUNT(*) FILTER (WHERE free_enrichment_status = 'skipped')::int   AS skipped,
          COUNT(*) FILTER (WHERE free_enrichment_status = 'failed')::int    AS failed,
          COUNT(*) FILTER (WHERE free_enrichment_status = 'processing')::int AS running
        FROM businesses
        WHERE free_enrichment_last_attempt_at IS NOT NULL
      `);
      console.log("  ✓ Lane-status aggregate SELECT EXPLAIN succeeded");
    } catch (err: any) {
      console.error(`  ✗ Lane-status aggregate SELECT EXPLAIN failed: ${err?.message}`);
      pass = false;
    }

  } finally {
    client.release();
  }

  console.log("\n──────────────────────────────────────────────────────────────────────");
  if (pass) {
    console.log("  PASS — free-enrichment column preflight complete\n");
    process.exit(0);
  } else {
    console.error("  FAIL — one or more checks failed; see details above\n");
    process.exit(1);
  }
}

run()
  .catch((err) => {
    console.error("[check-free-enrichment-columns] Unexpected error:", err?.message ?? err);
    process.exit(1);
  })
  .finally(() => {
    pool.end().catch(() => {});
  });
