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

import { runDrizzleMigrations, logUnderlyingDbError } from "../server/db-migrate";
import { pool } from "../server/db";

const DEPLOY_MIGRATION_LOCK = "liberty-bancard:production-deploy-migrations";

async function main() {
  console.log("[migrate] Starting migration runner...");

  // Replit autoscale may start more than one instance for a release. Hold a
  // session-level advisory lock for the entire migration run so only one
  // instance performs journal reconciliation at a time. Waiting instances run
  // the same idempotent check after the first instance releases the lock.
  const lockClient = await pool.connect();

  // Await core migrations without a whole-run timeout.  runDrizzleMigrations
  // uses a dedicated pg.Client with statement_timeout=0 for DDL so that
  // CREATE INDEX on large tables cannot be killed mid-run.  The optional
  // knowledge-base seed at the end is already in its own try/catch and is
  // non-fatal — no outer race is needed here.  A timeout that races the entire
  // function would misclassify a legitimate long index build as a success,
  // allowing deployment with a partially applied schema.
  try {
    await lockClient.query("SELECT pg_advisory_lock(hashtext($1))", [DEPLOY_MIGRATION_LOCK]);
    await runDrizzleMigrations();
    console.log("[migrate] Done.");
  } catch (err: any) {
    console.error("[migrate] Migration failed:", err.message ?? err);
    logUnderlyingDbError(err);
    process.exitCode = 1;
  } finally {
    await lockClient
      .query("SELECT pg_advisory_unlock(hashtext($1))", [DEPLOY_MIGRATION_LOCK])
      .catch((error: any) => console.error("[migrate] Failed to release deployment lock:", error?.message ?? error));
    lockClient.release();
  }

  // Force exit: pool.end() can hang when a checked-out connection or an
  // outbound socket (e.g. OpenAI indexing call) is still open. But
  // process.exit() tears down the process immediately, and the platform's
  // log shipper reads stdout/stderr asynchronously — calling it right after
  // a burst of console.error() output (e.g. the full underlying-DB-error
  // dump) can truncate the deploy log before the trailing lines are
  // captured, which is exactly what happened here: only the first
  // "Migration failed" line ever reached the log, never the detail after
  // it. Explicitly wait for both streams to drain before exiting.
  await drainStdio();
  process.exit(process.exitCode ?? 0);
}

function drainStdio(): Promise<void> {
  return new Promise((resolve) => {
    let pending = 0;
    let resolved = false;
    const done = () => {
      if (resolved) return;
      pending -= 1;
      if (pending <= 0) {
        resolved = true;
        resolve();
      }
    };
    for (const stream of [process.stdout, process.stderr]) {
      pending += 1;
      // A zero-length write's callback fires only after everything
      // previously queued on the stream has actually been flushed.
      stream.write("", done);
    }
    // Safety net in case a stream never calls back (e.g. already closed).
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    }, 2000);
  });
}

main().catch((err: any) => {
  console.error("[migrate] Fatal migration-runner error:", err?.message ?? err);
  process.exit(1);
});
