#!/usr/bin/env tsx
import {
  spawnCertificationTsx,
  terminateCertificationChild,
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
  let forwardedSignal: NodeJS.Signals | undefined;
  const forward = (signal: NodeJS.Signals) => {
    forwardedSignal = signal;
    void terminateCertificationChild(child);
  };
  process.once("SIGINT", () => forward("SIGINT"));
  process.once("SIGTERM", () => forward("SIGTERM"));
  await waitForCertificationChild(child);
  if (forwardedSignal) process.exitCode = 128 + (forwardedSignal === "SIGINT" ? 2 : 15);
} finally {
  await infrastructure.releaseRedisReservation();
}