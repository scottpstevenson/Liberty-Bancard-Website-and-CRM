#!/usr/bin/env tsx
/**
 * Executes the canonical migration runner only after disposable PostgreSQL and
 * isolated Redis have been proved in this same process.
 */
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "./certification-provider-deny";

await assertDisposableTestInfrastructure({
  operation: "VG guarded canonical migration",
  requireRedis: true,
});

const { scrubbedCredentialCount } = applyCertificationProviderDenyBoundary();
console.log(
  `[VG guarded canonical migration] provider deny boundary active; scrubbed ${scrubbedCredentialCount} configured credential(s).`,
);

try {
  const { runDrizzleMigrations } = await import("../server/db-migrate");
  await runDrizzleMigrations();
} finally {
  const { pool } = await import("../server/db");
  await pool.end().catch(() => undefined);
}