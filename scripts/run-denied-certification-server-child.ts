#!/usr/bin/env tsx
import {
  applyCertificationProviderDenyBoundary,
  getBlockedCertificationNetworkAttemptCount,
  installCertificationLocalAiConstructorEnvironment,
} from "./certification-provider-deny";

applyCertificationProviderDenyBoundary({ fatal: true });
installCertificationLocalAiConstructorEnvironment();
const providerAttemptWatchdog = setInterval(() => {
  if (getBlockedCertificationNetworkAttemptCount() > 0) {
    console.error("Certification server attempted a blocked external-provider request.");
    process.exit(70);
  }
}, 100);
providerAttemptWatchdog.unref();
await import("../server/index");