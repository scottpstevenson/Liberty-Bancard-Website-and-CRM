#!/usr/bin/env tsx
/**
 * Pure runtime tests for persisted Apollo HTTP diagnostics.
 *
 * No database, provider, network, or secret access is used.
 * Run with: npx tsx scripts/test-sfp-provider-http-diagnostics.ts
 */

import assert from "node:assert/strict";
import {
  buildSfpProviderHttpDiagnostics,
  safeSfpHttpClass,
  sanitizeSfpProviderHttpDiagnostics,
} from "../server/services/cro03/sfp-provider-http-diagnostics";

const REQUEST_KINDS = [
  "organization_search",
  "people_search",
  "business_email_enrichment",
] as const;

function expectDiagnostic(
  value: unknown,
  expected: {
    httpStatus: number;
    requestKind: (typeof REQUEST_KINDS)[number];
    failureCode: string | null;
  },
) {
  assert.deepEqual(value, expected);
  const diagnostic = value as Record<string, unknown>;
  assert.deepEqual(Object.keys(diagnostic).sort(), ["failureCode", "httpStatus", "requestKind"]);
  assert(Number.isInteger(diagnostic.httpStatus));
  assert(Number(diagnostic.httpStatus) >= 100 && Number(diagnostic.httpStatus) <= 599);
  assert(REQUEST_KINDS.includes(diagnostic.requestKind as (typeof REQUEST_KINDS)[number]));
  assert(
    diagnostic.failureCode === null ||
      diagnostic.failureCode === "APOLLO_PROVIDER_ERROR" ||
      /^APOLLO_HTTP_[1-5]\d\d$/.test(String(diagnostic.failureCode)),
  );
}

function testHttpFailureStatuses() {
  for (const status of [401, 403, 429, 500, 502, 503]) {
    const requestKind = REQUEST_KINDS[status % REQUEST_KINDS.length];
    const result = buildSfpProviderHttpDiagnostics(status, false, requestKind);
    expectDiagnostic(result, {
      httpStatus: status,
      requestKind,
      failureCode: `APOLLO_HTTP_${status}`,
    });
  }
}

function testSuccessAndProviderReportedError() {
  expectDiagnostic(buildSfpProviderHttpDiagnostics(200, false, "organization_search"), {
    httpStatus: 200,
    requestKind: "organization_search",
    failureCode: null,
  });
  expectDiagnostic(buildSfpProviderHttpDiagnostics(204, false, "people_search"), {
    httpStatus: 204,
    requestKind: "people_search",
    failureCode: null,
  });
  expectDiagnostic(buildSfpProviderHttpDiagnostics(200, true, "business_email_enrichment"), {
    httpStatus: 200,
    requestKind: "business_email_enrichment",
    failureCode: "APOLLO_PROVIDER_ERROR",
  });
}

function testSanitizerKeepsOnlyApprovedDiagnosticValues() {
  const input = {
    httpStatus: 429,
    requestKind: "people_search",
    failureCode: "APOLLO_HTTP_429",
    body: "raw provider response with secret token",
    rawBody: { token: "do-not-persist" },
    error: "Authorization: Bearer private-value",
    apiKey: "private-value",
    arbitrary: "customer@example.com",
  };
  const sanitized = sanitizeSfpProviderHttpDiagnostics(input);
  expectDiagnostic(sanitized, {
    httpStatus: 429,
    requestKind: "people_search",
    failureCode: "APOLLO_HTTP_429",
  });
  assert.equal(JSON.stringify(sanitized).includes("private-value"), false);
  assert.equal(JSON.stringify(sanitized).includes("customer@example.com"), false);
  assert.equal(JSON.stringify(sanitized).includes("raw provider response"), false);
}

function testSanitizerRejectsMalformedAndArbitraryValues() {
  const maliciousInputs: unknown[] = [
    null,
    undefined,
    "Authorization: Bearer secret",
    [],
    { httpStatus: 99, requestKind: "people_search", failureCode: "APOLLO_HTTP_099" },
    { httpStatus: 600, requestKind: "people_search", failureCode: "APOLLO_HTTP_600" },
    { httpStatus: 200.5, requestKind: "people_search", failureCode: null },
    { httpStatus: "429", requestKind: "people_search", failureCode: "APOLLO_HTTP_429" },
    { httpStatus: 429, requestKind: "sensitive request text", failureCode: "private error text" },
    { httpStatus: 429, requestKind: "people_search", failureCode: "APOLLO_HTTP_429 secret" },
  ];

  for (const input of maliciousInputs) {
    const sanitized = sanitizeSfpProviderHttpDiagnostics(input);
    const serialized = JSON.stringify(sanitized);
    assert.equal(serialized.includes("secret"), false);
    assert.equal(serialized.includes("private"), false);
    if (sanitized && typeof sanitized === "object") {
      const safe = sanitized as Record<string, unknown>;
      if (safe.httpStatus !== undefined && safe.httpStatus !== null) {
        assert(Number.isInteger(safe.httpStatus));
        assert(Number(safe.httpStatus) >= 100 && Number(safe.httpStatus) <= 599);
      }
      if (safe.requestKind !== undefined && safe.requestKind !== null) {
        assert(REQUEST_KINDS.includes(safe.requestKind as (typeof REQUEST_KINDS)[number]));
      }
      if (safe.failureCode !== undefined && safe.failureCode !== null) {
        assert(
          safe.failureCode === "APOLLO_PROVIDER_ERROR" ||
            /^APOLLO_HTTP_[1-5]\d\d$/.test(String(safe.failureCode)),
        );
      }
      assert.deepEqual(
        Object.keys(safe).filter((key) => !["httpStatus", "requestKind", "failureCode"].includes(key)),
        [],
      );
    }
  }
}

function testHttpClassifiesOnlyValidStatuses() {
  assert.equal(safeSfpHttpClass(100), "1xx");
  assert.equal(safeSfpHttpClass(199), "1xx");
  assert.equal(safeSfpHttpClass(200), "2xx");
  assert.equal(safeSfpHttpClass(299), "2xx");
  assert.equal(safeSfpHttpClass(300), "3xx");
  assert.equal(safeSfpHttpClass(399), "3xx");
  assert.equal(safeSfpHttpClass(400), "4xx");
  assert.equal(safeSfpHttpClass(499), "4xx");
  assert.equal(safeSfpHttpClass(500), "5xx");
  assert.equal(safeSfpHttpClass(599), "5xx");

  for (const invalid of [null, undefined, "200", 99, 600, 200.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(safeSfpHttpClass(invalid), null, `invalid status ${String(invalid)} should be rejected`);
  }
}

function main() {
  testHttpFailureStatuses();
  testSuccessAndProviderReportedError();
  testSanitizerKeepsOnlyApprovedDiagnosticValues();
  testSanitizerRejectsMalformedAndArbitraryValues();
  testHttpClassifiesOnlyValidStatuses();
  console.log("SFP provider HTTP diagnostics tests passed.");
}

main();