#!/usr/bin/env npx tsx
/**
 * HTTP-level smoke test for the previewToken binding fix on the Sunbiz
 * bootstrap admin routes. Confirms:
 *   1. GET preview returns a previewToken alongside confirmationPhrase.
 *   2. POST run with that previewToken + confirmationPhrase succeeds without
 *      independently recomputing candidateCount against the route.
 *   3. A previewToken cannot be reused (single-use).
 *   4. A missing/garbage previewToken is rejected with a clear error.
 *   5. A confirmation typo does NOT burn the token — the same token can be
 *      corrected and resubmitted successfully (peek-before-consume).
 * Runs against the live dev server (BASE_URL), using the seeded admin user.
 *
 * Uses controlled sunbiz_entities fixtures (filtered via the admin-only
 * `filingNumberLike` preview query param) rather than ambient corpus
 * candidates, so the typo/successful-run assertions never silently skip —
 * a prior review round flagged that the ambient-data version of this test
 * could pass without ever exercising its core assertions.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:5000`;
const RUN_ID = Date.now() % 10_000_000;
const FILING_PREFIX = `task1971-http-${RUN_ID}-`;
const seededEntityIds: number[] = [];

async function seedEntity(idx: number) {
  const filingNumber = `${FILING_PREFIX}${idx}`;
  const rows = (await db.execute(sql`
    INSERT INTO sunbiz_entities (filing_number, entity_name, score, enrichment_status, website, source)
    VALUES (${filingNumber}, ${`Task1971 HTTP Test Co ${RUN_ID}-${idx}`}, 'hot', 'enriched', ${`https://http-test-${RUN_ID}-${idx}.example.com`}, 'sunbiz')
    RETURNING id
  `)).rows as any[];
  const id = Number(rows[0].id);
  seededEntityIds.push(id);
  return { id, filingNumber };
}

async function cleanup() {
  await db.execute(sql`DELETE FROM canonical_source_links WHERE source_system = 'sunbiz' AND stable_key LIKE ${FILING_PREFIX + "%"}`);
  const claimedBusinessIds = (await db.execute(sql`
    SELECT business_id FROM sunbiz_bootstrap_claims WHERE filing_number LIKE ${FILING_PREFIX + "%"} AND business_id IS NOT NULL
  `)).rows as any[];
  await db.execute(sql`DELETE FROM sunbiz_bootstrap_claims WHERE filing_number LIKE ${FILING_PREFIX + "%"}`);
  for (const row of claimedBusinessIds) {
    await db.execute(sql`DELETE FROM businesses WHERE id = ${Number(row.business_id)}`);
  }
  if (seededEntityIds.length > 0) {
    await db.execute(sql`DELETE FROM sunbiz_entities WHERE id = ANY(${sql.raw(`ARRAY[${seededEntityIds.join(",")}]::int[]`)})`);
  }
}

async function login(): Promise<string> {
  const email = process.env.ADMIN_SEED_EMAIL;
  const password = process.env.ADMIN_SEED_PASSWORD;
  if (!email || !password) throw new Error("ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD not set");
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (loginRes.status !== 200) throw new Error(`login failed: ${loginRes.status} ${await loginRes.text()}`);
  const rawHeaders = loginRes.headers as unknown as { getSetCookie?: () => string[] };
  const setCookieArr: string[] = typeof rawHeaders.getSetCookie === "function"
    ? rawHeaders.getSetCookie()
    : [loginRes.headers.get("set-cookie") ?? ""];
  const cookies = setCookieArr.map((c) => c.split(";")[0].trim()).filter(Boolean);
  if (cookies.length === 0) throw new Error("No session cookie returned");
  return cookies.join("; ");
}

async function csrfFor(cookie: string): Promise<string> {
  const r = await fetch(`${BASE_URL}/api/csrf-token`, { headers: { cookie } });
  const { token } = await r.json();
  return token;
}

let passed = 0;
function check(cond: unknown, label: string, detail?: string) {
  if (!cond) throw new Error(`FAIL: ${label}${detail ? ` (${detail})` : ""}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

async function main() {
  await seedEntity(1);
  const filingNumberLike = `${FILING_PREFIX}%`;

  try {
    const cookie = await login();
    const csrf = await csrfFor(cookie);

    const previewRes = await fetch(`${BASE_URL}/api/lead-ops/sunbiz-bootstrap/preview?limit=25&filingNumberLike=${encodeURIComponent(filingNumberLike)}`, { headers: { cookie } });
    check(previewRes.status === 200, "preview route returns 200", String(previewRes.status));
    const preview = await previewRes.json();
    check(typeof preview.previewToken === "string" && preview.previewToken.length > 0, "preview response includes previewToken");
    check(typeof preview.confirmationPhrase === "string" && preview.confirmationPhrase.startsWith("RUN SUNBIZ BOOTSTRAP"), "preview response includes confirmationPhrase");
    check(preview.candidateCount === 1, "preview sees exactly our one fixture candidate (deterministic, not ambient corpus data)", String(preview.candidateCount));

    // Garbage token is rejected.
    const garbageRunRes = await fetch(`${BASE_URL}/api/lead-ops/sunbiz-bootstrap/run`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
      body: JSON.stringify({ limit: preview.limit, confirmation: preview.confirmationPhrase, previewToken: "not-a-real-token" }),
    });
    check(garbageRunRes.status === 400, "garbage previewToken is rejected with 400", String(garbageRunRes.status));

    // A confirmation typo must NOT consume the token: peekSunbizBootstrapPreviewToken
    // validates before consumeSunbizBootstrapPreviewToken deletes it. Prove the
    // same previewToken still works after a rejected typo, matching what the
    // admin UI now relies on (onError only refetches preview for token-dead
    // error codes, never for typed_confirmation_required).
    const typoRunRes = await fetch(`${BASE_URL}/api/lead-ops/sunbiz-bootstrap/run`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
      body: JSON.stringify({ limit: preview.limit, confirmation: `${preview.confirmationPhrase}X`, previewToken: preview.previewToken }),
    });
    const typoBody = await typoRunRes.clone().json().catch(() => ({}) as any);
    check(typoRunRes.status === 400 && typoBody?.error === "typed_confirmation_required",
      "confirmation typo is rejected with typed_confirmation_required (token not yet consumed)", `${typoRunRes.status} ${JSON.stringify(typoBody)}`);

    const runRes = await fetch(`${BASE_URL}/api/lead-ops/sunbiz-bootstrap/run`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
      body: JSON.stringify({ limit: preview.limit, confirmation: preview.confirmationPhrase, previewToken: preview.previewToken }),
    });
    check(runRes.status === 200, "same previewToken succeeds on retry with the corrected confirmation", `${runRes.status} ${await runRes.clone().text()}`);
    const runBody = await runRes.clone().json();
    check(Array.isArray(runBody.outcomes) && runBody.outcomes.length === 1 && runBody.outcomes[0].outcome === "created",
      "run executed exactly the previewed fixture candidate and created it", JSON.stringify(runBody.outcomes));

    // Token is single-use: reusing it (even with a fresh preview candidateCount) must fail.
    const reuseRes = await fetch(`${BASE_URL}/api/lead-ops/sunbiz-bootstrap/run`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
      body: JSON.stringify({ limit: preview.limit, confirmation: preview.confirmationPhrase, previewToken: preview.previewToken }),
    });
    check(reuseRes.status === 400, "reusing a consumed previewToken is rejected", String(reuseRes.status));

    // Snapshot-drift: preview a second fixture, claim it out from under the
    // token (simulating a competing admin/stale-claim recovery), then prove
    // /run rejects the stale snapshot with 409 candidate_snapshot_drifted
    // instead of silently running a different set.
    await seedEntity(2);
    const preview2Res = await fetch(`${BASE_URL}/api/lead-ops/sunbiz-bootstrap/preview?limit=25&filingNumberLike=${encodeURIComponent(filingNumberLike)}`, { headers: { cookie } });
    const preview2 = await preview2Res.json();
    check(preview2.candidateCount === 1, "second preview sees exactly the new fixture (first is already claimed/created)", String(preview2.candidateCount));

    await db.execute(sql`
      INSERT INTO sunbiz_bootstrap_claims (filing_number, sunbiz_entity_id, status)
      VALUES (${`${FILING_PREFIX}2`}, ${seededEntityIds[1]}, 'claimed')
    `);
    const driftRunRes = await fetch(`${BASE_URL}/api/lead-ops/sunbiz-bootstrap/run`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
      body: JSON.stringify({ limit: preview2.limit, confirmation: preview2.confirmationPhrase, previewToken: preview2.previewToken }),
    });
    const driftBody = await driftRunRes.clone().json().catch(() => ({}) as any);
    check(driftRunRes.status === 409 && driftBody?.error === "candidate_snapshot_drifted",
      "run rejects a stale (drifted) candidate snapshot with 409 candidate_snapshot_drifted", `${driftRunRes.status} ${JSON.stringify(driftBody)}`);
  } finally {
    await cleanup();
  }

  console.log(`\n[test-sunbiz-bootstrap-http] ${passed} passed`);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => {});
  process.exit(1);
});
