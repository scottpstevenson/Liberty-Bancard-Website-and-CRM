#!/usr/bin/env tsx
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { applyCertificationProviderDenyBoundary } from "./certification-provider-deny";
import { replaceWithCertificationEnvironment } from "./certification-process-env";

const suitePath = process.argv[2];
const capability = process.argv[3];
if (!suitePath || !/^(?:scripts|server\/tests)\/[A-Za-z0-9._/-]+\.ts$/.test(suitePath)) {
  throw new Error("A certification suite path under scripts/ or server/tests/ is required.");
}
if (
  !["deterministic-static", "deterministic-integration", "server-required"].includes(
    capability ?? "",
  )
) {
  throw new Error("A recognized certification suite capability is required.");
}

let releaseRedisReservation = async (): Promise<void> => {};
if (capability !== "deterministic-static") {
  process.env.TEST_REDIS_PREFIX =
    `${process.env.TEST_REDIS_PREFIX ?? "ci_certification_"}suite_` +
    `${randomUUID().replace(/-/g, "")}_`;
  const { assertDisposableTestInfrastructure } = await import("./test-infrastructure-guard");
  const infrastructure = await assertDisposableTestInfrastructure({
    operation: `Certification suite ${capability}`,
    requireRedis: true,
    reserveRedisNamespace: true,
  });
  releaseRedisReservation = infrastructure.releaseRedisReservation;
}
try {
  replaceWithCertificationEnvironment();
  applyCertificationProviderDenyBoundary({ fatal: true });
  const absoluteSuitePath = path.resolve(process.cwd(), suitePath);
  process.argv = [process.argv[0], absoluteSuitePath, ...process.argv.slice(4)];
  await import(pathToFileURL(absoluteSuitePath).href);
  const { getBlockedCertificationNetworkAttemptCount } = await import(
    "./certification-provider-deny"
  );
  if (getBlockedCertificationNetworkAttemptCount() !== 0) {
    throw new Error("Certification suite attempted a blocked external-provider request.");
  }
} finally {
  await releaseRedisReservation();
}