#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { assertCertificationServerReady } from "./certification-server-readiness";

let fetchCalls = 0;
const fakeFetch = (async () => {
  fetchCalls++;
  return new Response("ok", { status: 200 });
}) as typeof fetch;

await assert.rejects(
  () => assertCertificationServerReady("https://api.libertybancard.com", fakeFetch),
  /loopback BASE_URL/,
);
assert.equal(fetchCalls, 0, "external BASE_URL reached fetch");

await assert.rejects(
  () => assertCertificationServerReady("http://user:pass@127.0.0.1:5000", fakeFetch),
  /credential-free loopback BASE_URL/,
);
assert.equal(fetchCalls, 0, "credentialed BASE_URL reached fetch");

await assertCertificationServerReady("http://127.0.0.1:5000", fakeFetch);
assert.equal(fetchCalls, 1, "loopback readiness did not invoke fetch exactly once");

console.log("Certification server readiness loopback boundary passed.");