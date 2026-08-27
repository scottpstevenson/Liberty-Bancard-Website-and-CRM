#!/usr/bin/env tsx
import {
  spawnCertificationTsx,
  waitForCertificationChild,
} from "./certification-child-process";
import { randomUUID } from "node:crypto";

const { assertDisposableTestInfrastructure } = await import("./test-infrastructure-guard");
process.env.TEST_REDIS_PREFIX =
  `${process.env.TEST_REDIS_PREFIX ?? "ci_certification_"}server_` +
  `${randomUUID().replace(/-/g, "")}_`;
const infrastructure = await assertDisposableTestInfrastructure({
  operation: "Certification application server",
  requireRedis: true,
  reserveRedisNamespace: true,
});
try {
  const child = spawnCertificationTsx("scripts/run-denied-certification-server-child.ts");
  process.once("SIGINT", () => child.kill("SIGINT"));
  process.once("SIGTERM", () => child.kill("SIGTERM"));
  await waitForCertificationChild(child);
} finally {
  await infrastructure.releaseRedisReservation();
}