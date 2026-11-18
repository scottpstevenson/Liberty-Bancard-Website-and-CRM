/** Explicit read-only post-publish check. Never installs objects, applies a migration, changes history or sends. */
import { readPhase7SchemaStatus } from "../server/services/phase7-schema-status";
import { pool } from "../server/db";
try {
  const status = await readPhase7SchemaStatus();
  console.log(JSON.stringify(status, null, 2));
  process.exitCode = status.schemaVerified ? 0 : 1;
} catch (e) {
  console.error(
    e instanceof Error ? e.message : "Phase 7 schema read unavailable",
  );
  process.exitCode = 2;
} finally {
  await pool.end();
}
