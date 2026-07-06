#!/usr/bin/env tsx
/**
 * Task #752 — Sunbiz Batch Enrichment Hardening Smoke Test
 *
 * Verifies that a single bad record can never 500 the whole "Enrich All" batch:
 *  - enrichSunbizEntitySafe() never throws, even for a not-found or malformed id.
 *  - processSunbizEnrichmentBatch() always returns a results[] + summary breakdown
 *    of success / partial_success / skipped / failed, even when the batch
 *    contains a broken record mixed in with good ones.
 *  - The HTTP routes (/api/sunbiz/entities/:id/enrich and /api/sunbiz/enrich-batch)
 *    return structured 200/404 JSON instead of crashing with a 500.
 *
 * Run with the dev server up:
 *   BASE_URL=http://localhost:5000 npx tsx scripts/test-sunbiz-enrichment-hardening.ts
 *
 * Note: this script makes real network calls to enrich at most one live pending
 * Sunbiz entity if one exists in the DB, so it can take up to ~60s to run.
 *
 * Exits 0 if all assertions pass, 1 if any fail.
 */

import { enrichSunbizEntitySafe, processSunbizEnrichmentBatch } from "../server/services/sunbiz-enrichment";
import { storage } from "../server/storage";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5000";
const TEST_EMAIL = process.env.TEST_USER_EMAIL ?? "playwright-test@libertybancard.internal";
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD ?? "PlaywrightTest2024!";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${message}`);
  } else {
    failed++;
    failures.push(message);
    console.error(`  \u2717 ${message}`);
  }
}

const VALID_STATUSES = new Set(["success", "partial_success", "skipped", "failed"]);

async function testSafeWrapperNeverThrows() {
  console.log("\nService-level: enrichSunbizEntitySafe() never throws");

  const notFound = await enrichSunbizEntitySafe(-999999999);
  assert(notFound.status === "skipped", `not-found entity resolves to status="skipped" (got "${notFound.status}")`);
  assert(!!notFound.reason, "not-found entity includes a human-readable reason");

  const malformed = await enrichSunbizEntitySafe(NaN as unknown as number);
  assert(malformed.status === "failed", `malformed id resolves to status="failed" (got "${malformed.status}")`);
  assert(!!malformed.reason, "malformed id includes a human-readable reason");
}

async function testBatchToleratesBadRecord() {
  console.log("\nService-level: processSunbizEnrichmentBatch() tolerates a bad record mixed with good ones");

  const originalGetByStatus = storage.getSunbizEntitiesByStatus.bind(storage);
  storage.getSunbizEntitiesByStatus = (async (status: string) => {
    const real = await originalGetByStatus(status);
    return [{ id: -12345, entityName: "FAKE BROKEN RECORD" } as any, ...real.slice(0, 1)];
  }) as typeof storage.getSunbizEntitiesByStatus;

  try {
    const batch = await processSunbizEnrichmentBatch(2);
    assert(Array.isArray(batch.results), "batch response includes a results[] array");
    assert(!!batch.summary, "batch response includes a summary object");
    assert(
      batch.summary.total === batch.results.length,
      `summary.total(${batch.summary.total}) matches results.length(${batch.results.length})`,
    );
    for (const r of batch.results) {
      assert(VALID_STATUSES.has(r.status), `result for entity ${r.entityId} has a valid status (got "${r.status}")`);
    }
    const sumOfBuckets =
      batch.summary.success + batch.summary.partial_success + batch.summary.skipped + batch.summary.failed;
    assert(
      sumOfBuckets === batch.summary.total,
      `summary buckets sum to total (${sumOfBuckets} === ${batch.summary.total})`,
    );
    const badRecordResult = batch.results.find((r) => r.entityId === -12345);
    assert(!!badRecordResult, "the injected bad record appears in results (was not silently dropped)");
    assert(
      badRecordResult?.status === "skipped" || badRecordResult?.status === "failed",
      `bad record resolves to skipped/failed, not a crash (got "${badRecordResult?.status}")`,
    );
  } finally {
    storage.getSunbizEntitiesByStatus = originalGetByStatus;
  }
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

async function testHttpRoutesNeverReturn500() {
  console.log("\nHTTP-level: routes return structured JSON instead of 500s");
  let cookie: string;
  try {
    cookie = await login();
  } catch (err) {
    console.warn(`  (skipping HTTP-level tests — could not log in: ${err})`);
    return;
  }

  const csrfRes = await fetch(`${BASE_URL}/api/csrf-token`, { headers: { Cookie: cookie } });
  const { token: csrf } = await csrfRes.json();

  const singleRes = await fetch(`${BASE_URL}/api/sunbiz/entities/999999999/enrich`, {
    method: "POST",
    headers: { Cookie: cookie, "x-csrf-token": csrf },
  });
  assert(singleRes.status === 404, `single-entity route returns 404 for not-found id (got ${singleRes.status})`);
  const singleBody = await singleRes.json();
  assert(singleBody.status === "skipped", `single-entity 404 body includes status="skipped" (got "${singleBody.status}")`);

  const batchRes = await fetch(`${BASE_URL}/api/sunbiz/enrich-batch`, {
    method: "POST",
    headers: { Cookie: cookie, "x-csrf-token": csrf, "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 1 }),
  });
  assert(batchRes.status === 200, `batch route always returns 200 (got ${batchRes.status})`);
  const batchBody = await batchRes.json();
  assert(Array.isArray(batchBody.results), "batch route response includes results[]");
  assert(!!batchBody.summary, "batch route response includes summary");
}

async function main() {
  console.log(`\nSunbiz Enrichment Hardening Smoke Test (against ${BASE_URL})\n`);

  await testSafeWrapperNeverThrows();
  await testBatchToleratesBadRecord();
  await testHttpRoutesNeverReturn500();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    console.error("Failures:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  process.exit(1);
});
