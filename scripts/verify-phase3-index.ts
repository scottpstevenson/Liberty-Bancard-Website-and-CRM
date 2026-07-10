/**
 * Post-Phase-3 verification script.
 *
 * Run AFTER applying migration 0054 (tasks_sla_stalling_active_unique partial
 * unique index) to confirm the index exists and matches the expected predicate.
 *
 * Usage:
 *   npx tsx scripts/verify-phase3-index.ts
 *
 * Exits 0 if the index is present and correct, 1 otherwise.
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("[Phase3Verify] Checking tasks_sla_stalling_active_unique index...");

  const rows = await db.execute(sql`
    SELECT indexdef FROM pg_indexes
    WHERE tablename = 'tasks'
      AND indexname = 'tasks_sla_stalling_active_unique'
  `);
  const r = (rows as any).rows ?? rows;

  if (!Array.isArray(r) || r.length === 0) {
    console.error("[Phase3Verify] FAIL — index tasks_sla_stalling_active_unique not found in pg_indexes.");
    console.error("  Apply migration 0054 before running this check.");
    process.exit(1);
  }

  const indexdef: string = r[0].indexdef;
  console.log(`[Phase3Verify] Index definition: ${indexdef}`);

  const required = [
    "tasks_sla_stalling_active_unique",
    "deal_id",
    "automation_key",
    "stalling-deal-follow-up",
    "deleted_at IS NULL",
    "completed_at IS NULL",
  ];

  const missing = required.filter(s => !indexdef.includes(s));
  if (missing.length > 0) {
    console.error(`[Phase3Verify] FAIL — index definition is missing expected terms: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log("[Phase3Verify] PASS — index exists and matches expected partial predicate.");
  process.exit(0);
}

main().catch(err => {
  console.error("[Phase3Verify] Fatal:", err.message);
  process.exit(1);
});
