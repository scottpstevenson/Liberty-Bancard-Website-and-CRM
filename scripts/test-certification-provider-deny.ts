#!/usr/bin/env tsx
import assert from "node:assert/strict";
import {
  applyCertificationProviderDenyBoundary,
  getBlockedCertificationNetworkAttemptCount,
} from "./certification-provider-deny";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

try {
  process.env.NODE_ENV = "test";
  process.env.VG_PROVIDER_DENY_MODE = "1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "inherited-key-must-be-scrubbed";
  process.env.SERPER_API_KEY = "inherited-key-must-be-scrubbed";

  const result = applyCertificationProviderDenyBoundary();
  assert.ok(result.scrubbedCredentialCount >= 2);
  assert.equal(process.env.AI_INTEGRATIONS_OPENAI_API_KEY, undefined);
  assert.equal(process.env.SERPER_API_KEY, undefined);
  assert.equal(process.env.SERPER_GATEWAY_ENABLED, "false");
  assert.equal(process.env.SUNBIZ_ENRICHMENT_ENABLED, "false");
  assert.equal(process.env.GHL_TRANSPORT_FAILFAST, "true");
  assert.equal(getBlockedCertificationNetworkAttemptCount(), 0);

  await assert.rejects(
    () => globalThis.fetch("https://example.invalid/provider-probe"),
    /provider deny boundary blocked/,
  );
  assert.equal(getBlockedCertificationNetworkAttemptCount(), 1);
  console.log("VG certification provider deny boundary passed.");
} finally {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, originalEnv);
}