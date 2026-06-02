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
import { pool } from "../server/db";

async function main() {
  console.log("[migrate] Starting migration runner...");
  try {
    await runDrizzleMigrations();
    console.log("[migrate] Done.");
  } catch (err: any) {
    console.error("[migrate] Migration failed:", err.message ?? err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
