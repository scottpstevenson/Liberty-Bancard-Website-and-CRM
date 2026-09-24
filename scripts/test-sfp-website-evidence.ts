#!/usr/bin/env npx tsx
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extractWebsiteClassificationEvidence } from "../server/services/cro03/sfp-website-evidence";

let passed = 0;
const server = createServer((request, response) => {
  if (request.url === "/fixture") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixtureHtml);
    return;
  }
  if (request.url === "/large") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "transfer-encoding": "chunked",
    });
    const pieces = [`<title>Large Dental Services</title>${"x".repeat(32)}`];
    const remainingBytes = 300_000;
    let sent = 0;
    let closedEarly = false;
    response.on("close", () => {
      if (sent < remainingBytes) closedEarly = true;
    });
    const sendNext = () => {
      if (response.destroyed) return;
      if (sent >= remainingBytes) {
        response.end();
        return;
      }
      const chunk = "z".repeat(Math.min(1024, remainingBytes - sent));
      sent += Buffer.byteLength(chunk);
      response.write(chunk);
      setTimeout(sendNext, 1);
    };
    response.write(pieces[0]);
    setTimeout(sendNext, 1);
    response.on("close", () => {
      if (closedEarly) server.emit("large-response-closed-early");
    });
    return;
  }
  response.writeHead(404).end();
});

const fixtureHtml = `<!doctype html>
<html><head>
  <title>Miami Dental &amp; Spa Services</title>
  <meta name="description" content="Dental appointment booking and clinic services">
  <meta content="salon menu" name="keywords">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":["LocalBusiness","Dentist"]}</script>
</head><body><h1>Dental clinic appointments and spa services</h1><p>UNIQUE_RAW_BODY_MARKER_7F31</p></body></html>`;

async function run() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const resolveLocalhost = async () => "8.8.8.8";
  const fetchLocal: typeof fetch = (input, init) => {
    const requestUrl = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    return fetch(`${baseUrl}${requestUrl.pathname}${requestUrl.search}`, init);
  };
  try {
    console.log("[1] Fixture extraction, determinism, and raw-body exclusion");
    const first = await extractWebsiteClassificationEvidence("http://evidence.test/fixture", {
      resolveImpl: resolveLocalhost,
      fetchImpl: fetchLocal,
    });
    const second = await extractWebsiteClassificationEvidence("http://evidence.test/fixture", {
      resolveImpl: resolveLocalhost,
      fetchImpl: fetchLocal,
    });
    assert.ok(!("error" in first));
    assert.ok(!("error" in second));
    assert.deepEqual(first.jsonLdTypes, ["LocalBusiness", "Dentist"]);
    assert.deepEqual(first.titleTokens, ["miami", "dental", "spa", "services"]);
    assert.deepEqual(first.metaTokens, [
      "dental", "appointment", "booking", "and", "clinic", "services", "salon", "menu",
    ]);
    assert.deepEqual(first.serviceTokens, ["services", "appointment", "booking", "menu"]);
    assert.deepEqual(first.categoryTokens, ["dental", "spa", "clinic", "salon"]);
    assert.equal(first.pageType, "LocalBusiness");
    assert.equal(first.contentHash, second.contentHash);
    assert.ok(
      Object.values(first).every(
        (value) => typeof value !== "string" || !value.includes("UNIQUE_RAW_BODY_MARKER_7F31"),
      ),
    );
    pass("JSON-LD/title/meta/service/category extraction is correct and deterministic; raw HTML marker is absent");

    console.log("\n[2] Bounded body read aborts the oversized response");
    const earlyClose = new Promise<void>((resolve) => {
      server.once("large-response-closed-early", () => resolve());
    });
    const large = await extractWebsiteClassificationEvidence("http://evidence.test/large", {
      resolveImpl: resolveLocalhost,
      fetchImpl: fetchLocal,
      maxBodyBytes: 128,
      timeoutMs: 3_000,
    });
    assert.ok(!("error" in large));
    await Promise.race([
      earlyClose,
      new Promise((_, reject) => setTimeout(() => reject(new Error("large response was not aborted")), 3_000)),
    ]);
    assert.deepEqual(large.titleTokens, ["large", "dental", "services"]);
    pass("The oversized response connection closes early after the configured 128-byte cap");

    console.log("\n[3] Private target is rejected before the fetch implementation");
    let privateFetchCalls = 0;
    const privateResult = await extractWebsiteClassificationEvidence("http://private-evidence.invalid/", {
      resolveImpl: async () => "10.23.4.5",
      fetchImpl: async () => {
        privateFetchCalls++;
        throw new Error("fetch must not be reached");
      },
    });
    assert.deepEqual(privateResult, { error: "blocked_private_target" });
    assert.equal(privateFetchCalls, 0);
    pass("Resolved private IPv4 target is blocked before HTTP fetch");

    console.log("\n[4] Non-HTTP protocol is rejected without network access");
    let protocolFetchCalls = 0;
    const protocolResult = await extractWebsiteClassificationEvidence("file:///etc/passwd", {
      fetchImpl: async () => {
        protocolFetchCalls++;
        throw new Error("fetch must not be reached");
      },
    });
    assert.deepEqual(protocolResult, { error: "unsupported_protocol" });
    assert.equal(protocolFetchCalls, 0);
    pass("file:// is rejected before DNS or fetch");

    console.log(`\n${passed} assertions passed; 0 failed.`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function pass(label: string) {
  console.log(`  ✓ ${label}`);
  passed++;
}

run().catch((error) => {
  console.error("  ✗ FAIL:", error);
  process.exitCode = 1;
});