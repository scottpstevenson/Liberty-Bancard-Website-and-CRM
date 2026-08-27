#!/usr/bin/env tsx
/**
 * Executes the canonical migration runner only after disposable PostgreSQL and
 * isolated Redis have been proved in this same process.
 */
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

await assertDisposableTestInfrastructure({
  operation: "VG guarded canonical migration",
  requireRedis: true,
});

try {
  const { runDrizzleMigrations } = await import("../server/db-migrate");
  await runDrizzleMigrations();
} finally {
  const { pool } = await import("../server/db");
  await pool.end().catch(() => undefined);
}