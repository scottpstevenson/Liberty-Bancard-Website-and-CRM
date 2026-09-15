#!/usr/bin/env npx tsx
/**
 * Behavioral test for the REAL client-side error path used by
 * bootstrapRunMutation in LeadOpsCenter.tsx: apiRequest() (from
 * client/src/lib/queryClient.ts) throws `Error(\`${status}: ${text}\`)` on a
 * non-OK response — it never returns the Response for inspection. A prior
 * review round caught the mutation reading `r.ok`/`r.json()` on a value that
 * apiRequest never returns on failure, making the server-error-code
 * extraction unreachable code.
 *
 * This test drives the actual `apiRequest` + `parseApiRequestError` helpers
 * (not a reimplementation) against the live dev server, using jsdom so
 * `document.cookie` (which getCsrfToken() reads) is available outside a
 * browser, per .agents/memory/jsdom-component-render-testing.md.
 *
 * Uses a controlled sunbiz_entities fixture (filtered via the admin-only
 * `filingNumberLike` preview query param) rather than ambient corpus
 * candidates, so the core error-path assertions never silently skip — a
 * prior review round flagged that relying on ambient data let this test
 * pass without exercising its main assertions when the live corpus happened
 * to have zero eligible candidates.
 */
import { JSDOM } from "jsdom";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:5000";
const RUN_ID = Date.now() % 10_000_000;
const FILING_PREFIX = `task1971-mut-${RUN_ID}-`;
const seededEntityIds: number[] = [];

async function seedEntity(idx: number) {
  const filingNumber = `${FILING_PREFIX}${idx}`;
  const rows = (await db.execute(sql`
    INSERT INTO sunbiz_entities (filing_number, entity_name, score, enrichment_status, website, source)
    VALUES (${filingNumber}, ${`Task1971 Mutation Test Co ${RUN_ID}-${idx}`}, 'hot', 'enriched', ${`https://mut-test-${RUN_ID}-${idx}.example.com`}, 'sunbiz')
    RETURNING id
  `)).rows as any[];
  seededEntityIds.push(Number(rows[0].id));
  return filingNumber;
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

let passed = 0;
function check(cond: unknown, label: string, detail?: string) {
  if (!cond) throw new Error(`FAIL: ${label}${detail ? ` (${detail})` : ""}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

async function main() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: BASE_URL });
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

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
  const cookieHeader = setCookieArr.map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
  // getCsrfToken() (in queryClient.ts) reads document.cookie directly — seed
  // jsdom's cookie jar the same way a real browser would after /api/auth/login
  // and /api/csrf-token set-cookie responses land.
  for (const pair of cookieHeader.split("; ")) dom.window.document.cookie = pair;

  const csrfRes = await fetch(`${BASE_URL}/api/csrf-token`, { headers: { cookie: cookieHeader } });
  const csrfSetCookie = (csrfRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const raw of csrfSetCookie) dom.window.document.cookie = raw.split(";")[0].trim();
  const { token: csrfTokenValue } = await csrfRes.json();
  if (!dom.window.document.cookie.includes("csrf_token=")) {
    dom.window.document.cookie = `csrf_token=${csrfTokenValue}`;
  }

  // fetch() inside apiRequest must carry the same session — jsdom's fetch
  // (via undici, same as Node's global fetch) does not auto-attach cookies
  // across origins the way a real browser tab would for same-origin
  // requests either, so patch global fetch to inject the cookie header,
  // mirroring what the browser does for this same-origin app in production.
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = (input: any, init: any = {}) => {
    const headers = { ...(init.headers || {}), cookie: cookieHeader };
    const url = typeof input === "string" && input.startsWith("/") ? `${BASE_URL}${input}` : input;
    return realFetch(url, { ...init, headers });
  };

  const { apiRequest, parseApiRequestError } = await import("../client/src/lib/queryClient");

  await seedEntity(1);
  const filingNumberLike = `${FILING_PREFIX}%`;
  const previewRes = await fetch(`${BASE_URL}/api/lead-ops/sunbiz-bootstrap/preview?limit=25&filingNumberLike=${encodeURIComponent(filingNumberLike)}`, { headers: { cookie: cookieHeader } });
  check(previewRes.status === 200, "preview route returns 200", String(previewRes.status));
  const preview = await previewRes.json();
  check(preview.candidateCount === 1, "preview sees exactly our one fixture candidate (deterministic, not ambient corpus data)", String(preview.candidateCount));

  // Reproduce bootstrapRunMutation's exact try/catch shape against the
  // REAL apiRequest, with a deliberate typo.
  let typoErr: (Error & { code?: string }) | null = null;
  try {
    const r = await apiRequest("POST", "/api/lead-ops/sunbiz-bootstrap/run", {
      limit: preview.limit,
      confirmation: `${preview.confirmationPhrase}X`,
      previewToken: preview.previewToken,
    });
    await r.json();
  } catch (e) {
    const { code, reason } = parseApiRequestError(e instanceof Error ? e.message : String(e));
    typoErr = new Error(reason || String(e));
    typoErr.code = code;
  }
  check(typoErr !== null, "apiRequest threw on the typo'd confirmation (as real apiRequest does on non-OK responses)");
  check(typoErr?.code === "typed_confirmation_required",
    "parseApiRequestError recovered code='typed_confirmation_required' from apiRequest's thrown Error", typoErr?.message);
  // This is exactly the condition bootstrapRunMutation.onError uses.
  const wouldInvalidateOnTypo = !!(typoErr?.code && typoErr.code !== "typed_confirmation_required");
  check(wouldInvalidateOnTypo === false, "onError's invalidation condition evaluates false for a typo — the still-valid token is preserved");

  // Now prove the SAME token succeeds through the real apiRequest with the
  // corrected confirmation (token was never consumed by the typo above).
  const r = await apiRequest("POST", "/api/lead-ops/sunbiz-bootstrap/run", {
    limit: preview.limit,
    confirmation: preview.confirmationPhrase,
    previewToken: preview.previewToken,
  });
  check(r.ok, "real apiRequest succeeds on retry with the corrected confirmation and the same token", String(r.status));

  // A dead-token rejection (reuse) must flip the onError condition to true.
  let reuseErr: (Error & { code?: string }) | null = null;
  try {
    const r2 = await apiRequest("POST", "/api/lead-ops/sunbiz-bootstrap/run", {
      limit: preview.limit,
      confirmation: preview.confirmationPhrase,
      previewToken: preview.previewToken,
    });
    await r2.json();
  } catch (e) {
    const { code, reason } = parseApiRequestError(e instanceof Error ? e.message : String(e));
    reuseErr = new Error(reason || String(e));
    reuseErr.code = code;
  }
  check(reuseErr !== null, "apiRequest throws on reusing the now-consumed token");
  check(!!reuseErr?.code, "parseApiRequestError recovered a code for the dead-token rejection", reuseErr?.message);
  const wouldInvalidateOnReuse = !!(reuseErr?.code && reuseErr.code !== "typed_confirmation_required");
  check(wouldInvalidateOnReuse === true, "onError's invalidation condition evaluates true for a dead (reused) token");

  console.log(`\n[test-sunbiz-bootstrap-mutation-error-handling] ${passed} passed`);
}

main()
  .then(
    async () => {
      await cleanup().catch(() => {});
    },
    async (err) => {
      console.error(err);
      await cleanup().catch(() => {});
      process.exit(1);
    },
  );
