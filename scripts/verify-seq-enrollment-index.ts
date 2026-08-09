/**
 * scripts/verify-seq-enrollment-index.ts
 *
 * Task #1376 — Confirm the sequence enrollment partial index is actually used
 * on the live database after the first deploy.
 *
 * Run against any environment (including production — this is read-only EXPLAIN):
 *   npx tsx scripts/verify-seq-enrollment-index.ts
 *
 * Exit 0 — planner chose an Index Scan  (expected on any table > a few thousand rows)
 * Exit 1 — planner chose a Seq Scan     (index missing, not yet analysed, or too small)
 *
 * The index being verified:
 *   CREATE INDEX CONCURRENTLY IF NOT EXISTS seq_enrollments_status_next_action_idx
 *   ON sequence_enrollments (next_action_at)
 *   WHERE status = 'active' AND next_action_at IS NOT NULL;
 */

import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("✗ DATABASE_URL is not set — cannot connect to the database.");
  console.error("  Ensure the DATABASE_URL environment variable is configured.");
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractScanType(planJson: any[]): { scanType: "index" | "seq"; planText: string } {
  const planText = JSON.stringify(planJson, null, 2);
  // Walk the plan tree looking for the leaf node scan type
  const seqScanRx = /"Node Type"\s*:\s*"Seq Scan"/i;
  const idxScanRx = /"Node Type"\s*:\s*"Index(?:\s+Only)? Scan"/i;
  if (idxScanRx.test(planText)) return { scanType: "index", planText };
  if (seqScanRx.test(planText)) return { scanType: "seq", planText };
  // Bitmap Index Scan also counts
  if (/"Node Type"\s*:\s*"Bitmap Heap Scan"/i.test(planText)) return { scanType: "index", planText };
  return { scanType: "seq", planText };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL, statement_timeout: 15_000 });
  const client = await pool.connect();

  try {
    console.log("=== Sequence Enrollment Index Verification ===\n");

    // 1. Confirm the index exists
    const idxCheck = await client.query<{ indexname: string; indexdef: string }>(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'sequence_enrollments'
        AND indexname = 'seq_enrollments_status_next_action_idx'
    `);

    if (idxCheck.rows.length === 0) {
      console.error("✗ FAIL: Index 'seq_enrollments_status_next_action_idx' does NOT exist on sequence_enrollments.");
      console.error(
        "\n  Diagnosis: The migration (0114_seq_enrollments_status_next_action_idx.sql) has not run on this database.\n" +
        "  Run: npx drizzle-kit migrate  (or equivalent) to apply pending migrations."
      );
      process.exit(1);
    }

    console.log("✓ Index exists:");
    console.log("  Name:", idxCheck.rows[0].indexname);
    console.log("  Def:", idxCheck.rows[0].indexdef);
    console.log();

    // 2. Table row count for context
    const countRes = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sequence_enrollments`
    );
    const totalRows = parseInt(countRes.rows[0].count, 10);
    console.log(`  Total rows in sequence_enrollments: ${totalRows.toLocaleString()}`);

    const dueRes = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM sequence_enrollments
       WHERE status = 'active'
         AND next_action_at IS NOT NULL
         AND next_action_at <= NOW()`
    );
    const dueRows = parseInt(dueRes.rows[0].count, 10);
    console.log(`  Due-work rows (status=active, next_action_at <= NOW): ${dueRows.toLocaleString()}`);
    console.log();

    // 3. Run EXPLAIN (FORMAT JSON) against the exact due-work query
    const explainRes = await client.query<{ "QUERY PLAN": any[] }>(
      `EXPLAIN (FORMAT JSON)
       SELECT id, contact_id, sequence_id, status, next_action_at
       FROM sequence_enrollments
       WHERE status = 'active'
         AND next_action_at IS NOT NULL
         AND next_action_at <= NOW()`
    );

    const planJson = explainRes.rows[0]["QUERY PLAN"];
    const { scanType, planText } = extractScanType(planJson);

    console.log("=== Query Plan (EXPLAIN JSON) ===");
    console.log(planText.slice(0, 3000)); // truncate for readability
    console.log();

    if (scanType === "index") {
      console.log("✓ PASS: Planner chose an Index/Bitmap Scan — the partial index is being used.");
      if (totalRows < 1_000) {
        console.log(
          "  Note: Table is small (< 1,000 rows). PostgreSQL may revert to a Seq Scan once\n" +
          "  statistics update on a very small table. Rerun after the table grows."
        );
      }
      process.exit(0);
    } else {
      console.error("✗ FAIL: Planner chose a Sequential Scan — the partial index is NOT being used.");
      console.error("\n  Possible diagnoses:");
      console.error("  1. The table has too few rows for the planner to prefer an index.");
      console.error("     → Wait until there are enough active enrollments and rerun.");
      console.error("  2. Table statistics are stale — the planner doesn't know about the index.");
      console.error("     → Run: ANALYZE sequence_enrollments;");
      console.error("  3. The index was created CONCURRENTLY and is not yet valid.");
      console.error("     → Check: SELECT * FROM pg_indexes WHERE tablename='sequence_enrollments';");
      console.error("  4. The migration ran but under a different index name.");
      console.error("     → Check: \\d sequence_enrollments  in psql.");
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("✗ Unexpected error:", err.message);
  process.exit(1);
});
