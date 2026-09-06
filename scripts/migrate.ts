/**
 * scripts/migrate.ts
 *
 * Standalone migration runner for production deploys.
 *
 * Usage:
 *   npx tsx scripts/migrate.ts
 *
 * This is safe to run multiple times — already-applied migrations are tracked
 * in `drizzle.__drizzle_migrations` and will not be re-executed.
 *
 * On first run against an existing database (before the drizzle migration system
 * was adopted), this script will baseline all known migrations so that only new
 * ones are applied.
 */

import { runDrizzleMigrations } from "../server/db-migrate";

async function main() {
  console.log("[migrate] Starting migration runner...");

  // Await core migrations without a whole-run timeout.  runDrizzleMigrations
  // uses a dedicated pg.Client with statement_timeout=0 for DDL so that
  // CREATE INDEX on large tables cannot be killed mid-run.  The optional
  // knowledge-base seed at the end is already in its own try/catch and is
  // non-fatal — no outer race is needed here.  A timeout that races the entire
  // function would misclassify a legitimate long index build as a success,
  // allowing deployment with a partially applied schema.
  try {
    await runDrizzleMigrations();
    console.log("[migrate] Done.");
  } catch (err: any) {
    console.error("[migrate] Migration failed:", err.message ?? err);
    process.exit(1);
  }

  // Force exit: pool.end() can hang when a checked-out connection or an
  // outbound socket (e.g. OpenAI indexing call) is still open.
  process.exit(0);
}

main();
