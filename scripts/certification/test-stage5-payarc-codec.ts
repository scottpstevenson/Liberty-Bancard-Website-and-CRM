/**
 * Stage 5 CP4 — Payarc boarding/status codec certification (S5-17).
 * Real adapter, stubbed fetch (no network, no database, no provider call).
 *
 * Definite rejection vs unknown outcome, strict identity, no invented ETA, no merchant_id-as-MID,
 * correlation of status responses, and no silent "submitted" for unknown statuses.
 */
import assert from "node:assert/strict";

process.env.PAYARC_API_KEY = "fixture-key-not-real";
const { PayarcProcessorAdapter } = await import("../../server/services/processors/payarc.adapter");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [S5-PC-${String(checks).padStart(2, "0")}] ${message}`); };

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method: string }> = [];
function stub(status: number, body: unknown, opts: { reject?: boolean } = {}) {
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    if (opts.reject) throw Object.assign(new Error("reset"), { name: "TypeError" });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { "x-ratelimit-remaining": "100", "content-type": "application/json" } });
  }) as any;
}
const adapter = new PayarcProcessorAdapter();
const profile = { dealId: 1, legalBusinessName: "Fixture", processorProgram: "traditional", snapshotAuthorizedBaseUrl: "https://testapi.payarc.net/v1", providerIdempotencyKey: "pik" } as any;
const board = async (status: number, body: unknown, o: { reject?: boolean } = {}) => { stub(status, body, o); return adapter.boardMerchant(profile); };
const poll = async (id: string, status: number, body: unknown) => { stub(status, body); return adapter.getMerchantStatus(id, { snapshotAuthorizedBaseUrl: "https://testapi.payarc.net/v1" }); };

try {
  // boardMerchant: classification
  let r = await board(200, { data: { object_id: "APP-1", status: "under_review" } });
  check(r.success && r.processorApplicationId === "APP-1" && r.status === "under_review", "documented 2xx response yields the provider identity");
  check(r.estimatedDecisionDate === undefined && !/Estimated decision/.test(r.message ?? ""), "no invented decision estimate when the provider supplies none (negative control: original fabricated +2 days)");
  r = await board(200, { data: { object_id: "APP-2", estimated_decision_date: "2026-12-01" } });
  check(r.estimatedDecisionDate === "2026-12-01", "a provider-supplied estimate is passed through unchanged");
  for (const status of [500, 502, 503, 504, 408]) {
    r = await board(status, { error: "x" });
    check(!r.success && r.ambiguous === true, `HTTP ${status} is ambiguous (provider may have committed), not an auto-retryable failure`);
  }
  for (const status of [400, 401, 403, 422, 429]) {
    r = await board(status, { error: "x" });
    check(!r.success && !r.ambiguous, `HTTP ${status} is a definite rejection`);
  }
  r = await board(202, {});
  check(!r.success && r.ambiguous === true, "2xx with no identifier is ambiguous");
  for (const bad of [{ object_id: "" }, { object_id: "   " }, { object_id: { nested: 1 } }, { object_id: null }, { applicant_id: "A-9" }]) {
    r = await board(200, { data: bad });
    check(!r.success && r.ambiguous === true, `identifier ${JSON.stringify(bad)} is not accepted as identity`);
  }
  r = await board(200, "not json at all");
  check(!r.success && r.ambiguous === true, "non-JSON 2xx body is ambiguous");
  r = await board(0 + 200, {}, { reject: true });
  check(!r.success && r.ambiguous === true, "network failure after send is ambiguous");

  // getMerchantStatus: strict observation
  let s = await poll("APP-1", 200, { data: { object_id: "APP-1", status: "approved", mid: "FIXMID0001" } });
  check(s.success && s.status === "approved" && s.mid === "FIXMID0001", "explicit mid is reported");
  s = await poll("APP-1", 200, { data: { object_id: "APP-1", status: "approved", merchant_id: "MERCHANT-77" } });
  check(s.success && s.mid === undefined, "merchant_id is never treated as a MID (negative control: original fell back to it)");
  s = await poll("APP-1", 200, { data: { object_id: "APP-OTHER", status: "approved", mid: "FIXMID0002" } });
  check(!s.success && /different application/.test(s.error ?? "") && s.mid === undefined, "a response for a different application is discarded");
  s = await poll("APP-1", 200, { data: { object_id: "APP-1", status: "weird_new_state" } });
  check(!s.success && /unrecognized/.test(s.error ?? ""), "an unrecognized status is not silently applied as submitted");
  s = await poll("APP-1", 200, { data: { object_id: "APP-1" } });
  check(!s.success, "a missing status is not applied");
  s = await poll("APP-1", 200, { data: { status: "pending" } });
  check(s.success && s.status === "submitted" && s.identityEchoed === false, "RECORDED CONTRACT: a response without an echoed id is attributed to the requested application by the request path (not a strict rejection) and reports identityEchoed=false");
  s = await poll("APP-1", 200, { data: { object_id: "APP-1", status: "pending" } });
  check(s.success && s.identityEchoed === true, "a response that names the requested application reports identityEchoed=true");
  s = await poll("APP/../../x?y=1#z", 200, { data: { status: "pending" } });
  check(calls[calls.length - 1].url.endsWith("/applications/APP%2F..%2F..%2Fx%3Fy%3D1%23z"), "the requested application id is path-encoded and cannot alter the request path");
  s = await poll("APP-1", 500, {});
  check(!s.success, "a 5xx status poll is a failed observation");
  check(calls.every((c) => c.url.startsWith("https://testapi.payarc.net/v1/")), "every request went only to the snapshot-authorized host");

  // R05: one URL validator for snapshots and transport; permanent vs retryable; no redirects; no provider call on refusal.
  const { checkProcessorBaseUrl, checkPayarcPartnerEnvironment } = await import("../../server/services/processors/processor-base-url");
  for (const [url, env] of [["https://testapi.payarc.net/v1", "sandbox"], ["https://api.payarc.net/v1/", "production"], ["HTTPS://API.PAYARC.NET/v1", "production"]] as const) {
    const c = checkProcessorBaseUrl("payarc", url);
    check(c.ok && c.environment === env && c.baseUrl.endsWith("/v1") && !c.baseUrl.endsWith("//"), `documented base ${url} is accepted and normalized (${env})`);
  }
  for (const bad of ["http://api.payarc.net/v1", "https://user:pw@api.payarc.net/v1", "https://api.payarc.net:8443/v1", "https://api.payarc.net/v1?x=1", "https://api.payarc.net/v1#f",
    "https://api.payarc.net", "https://api.payarc.net/v2", "https://api.payarc.net/v1/extra", "https://evil.example/v1", "https://api.payarc.net.evil.example/v1",
    "https://sandbox.payarc.net/v1", "https://api.payarc.com/v1", "https://connect.payarc.net/v1", "mock://internal.mock.local", "not a url", ""]) {
    check(!checkProcessorBaseUrl("payarc", bad).ok, `base URL ${JSON.stringify(bad)} is refused`);
  }
  check(!checkProcessorBaseUrl("nmi", "https://api.payarc.net/v1").ok, "a processor with no allowlist has no accepted base URL");
  check(checkPayarcPartnerEnvironment("sandbox", {} as any).ok && checkPayarcPartnerEnvironment("production", { PAYARC_PARTNER_KEY_ENVIRONMENT: "production" } as any).ok
    && !checkPayarcPartnerEnvironment("production", { PAYARC_PARTNER_KEY_ENVIRONMENT: "sandbox" } as any).ok && !checkPayarcPartnerEnvironment("sandbox", { PAYARC_PARTNER_KEY_ENVIRONMENT: "bogus" } as any).ok,
    "a credential declared for another environment (or an invalid declaration) is refused; an undeclared one is accepted");
  const before = calls.length;
  const refusedBoard = await (async () => { stub(200, { data: { object_id: "X" } }); return adapter.boardMerchant({ ...profile, snapshotAuthorizedBaseUrl: "https://evil.example/v1" }); })();
  const refusedStatus = await (async () => { stub(200, {}); return adapter.getMerchantStatus("APP-1", { snapshotAuthorizedBaseUrl: "https://api.payarc.net:444/v1" }); })();
  check(!refusedBoard.success && refusedBoard.permanent === true && !refusedBoard.ambiguous && !refusedStatus.success && calls.length === before, "a refused snapshot URL makes no provider call (boarding is a permanent refusal, not ambiguous)");
  process.env.PAYARC_PARTNER_KEY_ENVIRONMENT = "production";
  const mismatch = await board(200, { data: { object_id: "X" } });
  delete process.env.PAYARC_PARTNER_KEY_ENVIRONMENT;
  check(!mismatch.success && mismatch.permanent === true && /declared for production/.test(mismatch.error ?? ""), "a production-declared credential is never sent to the sandbox host");

  for (const status of [400, 401, 403, 404, 409, 422]) {
    r = await board(status, { error: "x" });
    check(!r.success && r.permanent === true && r.retryable !== true && r.httpStatus === status, `HTTP ${status} is a PERMANENT rejection (never retried)`);
  }
  r = await board(429, { error: "slow down" });
  check(!r.success && r.retryable === true && r.permanent !== true && r.httpStatus === 429, "HTTP 429 is retryable, not permanent");
  for (const status of [301, 302, 307, 308]) {
    r = await board(status, "");
    check(!r.success && r.ambiguous === true && r.permanent !== true, `a POST redirect (${status}) is never followed and is ambiguous`);
  }
  let redirectArg: string | undefined;
  globalThis.fetch = (async (_u: any, init: any) => { redirectArg = init?.redirect; return new Response("{}", { status: 200 }); }) as any;
  await adapter.getMerchantStatus("APP-1", { snapshotAuthorizedBaseUrl: "https://testapi.payarc.net/v1" });
  check(redirectArg === "manual", "transport requests are made with redirect: manual");
  s = await poll("APP-1", 302, "");
  check(!s.success, "a redirected status poll is a failed observation");
} finally {
  globalThis.fetch = realFetch;
}
console.log(`\nStage 5 Payarc codec certification: ${checks} checks passed`);
process.exit(0);
