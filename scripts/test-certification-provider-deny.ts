#!/usr/bin/env tsx
import assert from "node:assert/strict";
import http, { createServer } from "node:http";
import https from "node:https";
import {
  applyCertificationProviderDenyBoundary,
  getBlockedCertificationNetworkAttemptCount,
  installCertificationLocalAiConstructorEnvironment,
} from "./certification-provider-deny";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const localServer = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("local-only");
});

try {
  await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
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

  const address = localServer.address();
  assert.ok(address && typeof address === "object");
  const localResponse = await globalThis.fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(await localResponse.text(), "local-only");
  assert.equal(getBlockedCertificationNetworkAttemptCount(), 0);
  const localHttpBody = await new Promise<string>((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${address.port}/health`, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      })
      .on("error", reject);
  });
  assert.equal(localHttpBody, "local-only");
  assert.equal(getBlockedCertificationNetworkAttemptCount(), 0);

  await assert.rejects(
    () => globalThis.fetch("https://example.invalid/provider-probe"),
    /provider deny boundary blocked/,
  );
  assert.equal(getBlockedCertificationNetworkAttemptCount(), 1);
  assert.throws(
    () => https.request("https://example.invalid/provider-probe"),
    /provider deny boundary blocked/,
  );
  assert.equal(getBlockedCertificationNetworkAttemptCount(), 2);
  assert.throws(
    () =>
      http.request("http://127.0.0.1/provider-probe", {
        hostname: "example.invalid",
      }),
    /provider deny boundary blocked/,
  );
  assert.equal(getBlockedCertificationNetworkAttemptCount(), 3);
  assert.throws(
    () =>
      https.request(new URL("https://127.0.0.1/provider-probe"), {
        hostname: "example.invalid",
      }),
    /provider deny boundary blocked/,
  );
  assert.equal(getBlockedCertificationNetworkAttemptCount(), 4);
  assert.throws(
    () =>
      http.request({
        hostname: "127.0.0.1",
        agent: new http.Agent(),
      }),
    /provider deny boundary blocked/,
  );
  assert.equal(getBlockedCertificationNetworkAttemptCount(), 5);
  installCertificationLocalAiConstructorEnvironment();
  assert.equal(
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    "vg-certification-fixed-dummy-key-not-valid-for-any-provider",
  );
  console.log("VG certification provider deny boundary passed.");
} finally {
  await new Promise<void>((resolve) => localServer.close(() => resolve()));
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, originalEnv);
}