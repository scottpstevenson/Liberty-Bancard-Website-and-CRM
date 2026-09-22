/**
 * apply-sfp-migrations.ts — Applies SFP migrations (0275, 0276, 0277) directly via the DB pool.
 * Run: npx tsx scripts/apply-sfp-migrations.ts
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? undefined });

async function apply(file: string, label: string) {
  const sql = readFileSync(file, "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log(`✓ ${label}`);
  } catch (err: any) {
    await client.query("ROLLBACK");
    // IF NOT EXISTS / already exists is fine
    if (err?.message?.includes("already exists")) {
      console.log(`⚠ ${label} (already exists — OK)`);
    } else {
      throw err;
    }
  } finally {
    client.release();
  }
}

await apply("migrations/0275_roi_candidate_scores_table.sql", "0275: cro03c_roi_candidate_scores");
await apply("migrations/0276_cohort_validation_runs_table.sql", "0276: mi09_cohort_validation_runs");
await apply("migrations/0277_south_florida_prospecting.sql", "0277: sfp_* tables");

// Register in drizzle journal if not already there
const client = await pool.connect();
try {
  for (const [hash, tag] of [
    ["0275_roi_candidate_scores_table", "0275_roi_candidate_scores_table"],
    ["0276_cohort_validation_runs_table", "0276_cohort_validation_runs_table"],
    ["0277_south_florida_prospecting", "0277_south_florida_prospecting"],
  ]) {
    const exists = (await client.query(
      "SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1 LIMIT 1",
      [hash]
    )).rows[0];
    if (!exists) {
      await client.query(
        "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [hash, Date.now()]
      );
      console.log(`✓ Journaled: ${tag}`);
    } else {
      console.log(`⚠ Already journaled: ${tag}`);
    }
  }
} finally {
  client.release();
}

await pool.end();
console.log("Done.");
