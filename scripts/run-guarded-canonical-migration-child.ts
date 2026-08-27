#!/usr/bin/env tsx
import {
  applyCertificationProviderDenyBoundary,
  getBlockedCertificationNetworkAttemptCount,
} from "./certification-provider-deny";

const { scrubbedCredentialCount } = applyCertificationProviderDenyBoundary({ fatal: true });
console.log(
  `[VG guarded canonical migration] clean child environment active; scrubbed ${scrubbedCredentialCount} configured credential(s).`,
);

try {
  const { runDrizzleMigrations } = await import("../server/db-migrate");
  await runDrizzleMigrations();
  if (getBlockedCertificationNetworkAttemptCount() !== 0) {
    throw new Error("Canonical migration attempted a blocked external-provider request.");
  }
} finally {
  const { pool } = await import("../server/db");
  await pool.end().catch(() => undefined);
}