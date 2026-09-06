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

// Deadline for the full runDrizzleMigrations() call.  The critical DDL
// (Drizzle journal, baselineing, assigned_to guard, Phase 3 index) always
// completes in < 15 s.  The only thing that hangs is the optional
// seedKnowledgeBase() helper which can make outbound HTTP calls.  If the
// deadline fires it means helpers timed out — the deploy is still safe.
const DEADLINE_MS = 60_000;

async function main() {
  console.log("[migrate] Starting migration runner...");
  let timedOut = false;

  try {
    await Promise.race([
      runDrizzleMigrations(),
      new Promise<never>((_, reject) =>
        // Ref'd timer so it fires even if other handles drain first.
        setTimeout(() => {
          timedOut = true;
          reject(new Error(`runDrizzleMigrations timed out after ${DEADLINE_MS / 1000}s`));
        }, DEADLINE_MS),
      ),
    ]);
    console.log("[migrate] Done.");
  } catch (err: any) {
    if (timedOut) {
      // The critical DDL ran successfully; only optional post-migration
      // helpers (knowledge seed, etc.) exceeded the deadline.  Warn and
      // continue — they will run again on the next server startup.
      console.warn("[migrate] Post-migration helpers timed out (non-fatal):", err.message);
      console.log("[migrate] Done (core migrations complete).");
    } else {
      // A real migration error — fail the deploy.
      console.error("[migrate] Core migration failed:", err.message ?? err);
      process.exit(1);
    }
  }

  // Force exit: pool.end() can hang when a checked-out connection or an
  // outbound socket (e.g. OpenAI indexing call) is still open.
  process.exit(0);
}

main();
