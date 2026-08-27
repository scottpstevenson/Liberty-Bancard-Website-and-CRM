#!/usr/bin/env tsx
/**
 * Proves disposable infrastructure in the outer process, then starts the
 * canonical migration child with a replacement (not inherited) environment.
 */
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import {
  spawnCertificationTsx,
  waitForCertificationChild,
} from "./certification-child-process";
import { randomUUID } from "node:crypto";

process.env.TEST_REDIS_PREFIX =
  `${process.env.TEST_REDIS_PREFIX ?? "ci_certification_"}migration_` +
  `${randomUUID().replace(/-/g, "")}_`;
const infrastructure = await assertDisposableTestInfrastructure({
  operation: "VG guarded canonical migration",
  requireRedis: true,
  reserveRedisNamespace: true,
});

try {
  const child = spawnCertificationTsx(
    "scripts/run-guarded-canonical-migration-child.ts",
  );
  await waitForCertificationChild(child);
} finally {
  await infrastructure.releaseRedisReservation();
}