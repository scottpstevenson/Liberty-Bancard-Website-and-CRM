/** Actual Traditional adapter against official contract shapes; no database or network. */
import assert from "node:assert/strict";
import {
  payarcRequestSchema,
  validatePayarcPayload,
  decodePayarcObservation,
  PAYARC_TRADITIONAL_PATHS,
  payarcObservationCanAdvance,
} from "../../shared/payarc-traditional";
process.env.PAYARC_API_KEY = "fixture-not-a-key";
process.env.PAYARC_PARTNER_KEY_ENVIRONMENT = "sandbox";
process.env.PAYARC_RATE_LIMIT_BACKOFF_MS = "1";
const { PayarcProcessorAdapter, requestPayarcSignature } = await import(
  "../../server/services/processors/payarc.adapter"
);
let checks = 0;
const check = (v: unknown, m: string) => {
  assert(v, m);
  checks++;
  console.log("✓ " + m);
};
function fixture(s: any): any {
  if (s.enum) return s.enum[0];
  if (s.type === "object")
    return Object.fromEntries(
      (s.required ?? []).map((k: string) => [k, fixture(s.properties[k])]),
    );
  if (s.type === "array") return [fixture(s.items)];
  if (s.type === "integer" || s.type === "number") return 1;
  if (s.type === "boolean") return false;
  return "Fixture";
}
const payload = fixture(payarcRequestSchema);
payload.Owners[0].OwnershipPct = 100;
payload.Owners[0].BirthDate = "01/01/1980";
payload.Lead.DateIncorporated = "2020-01-01";
const profile: any = {
  dealId: 1,
  legalBusinessName: "Fixture",
  processorProgram: "traditional",
  snapshotAuthorizedBaseUrl: "https://testapi.payarc.net/v1",
  payarcTraditionalPayload: payload,
};
const adapter = new PayarcProcessorAdapter();
let calls: any[] = [];
const original = globalThis.fetch;
function stub(status: number, body: any, throws = false) {
  globalThis.fetch = async (url: any, init: any) => {
    calls.push({ url: String(url), ...init });
    if (throws) throw Error("network");
    return new Response(JSON.stringify(body), {
      status,
      headers: { "x-ratelimit-remaining": "100" },
    });
  };
}
try {
  check(
    validatePayarcPayload(payload).length === 0,
    "required structured Lead/Owners fixture validates",
  );
  check(
    validatePayarcPayload({ ...payload, TaxId: "not allowed" }).some((x) =>
      x.includes("unknown_field"),
    ),
    "unknown root input refused",
  );
  for (const field of ["Lead", "Owners"])
    check(
      validatePayarcPayload({ ...payload, [field]: undefined }).length > 0,
      field + " required",
    );
  check(
    validatePayarcPayload({ ...payload, Owners: [] }).length > 0,
    "empty owner list refused",
  );
  stub(200, { MerchantCode: "MC-1" });
  let r = await adapter.boardMerchant(profile);
  check(
    r.success &&
      r.processorApplicationId === "MC-1" &&
      r.phase === "lead_created" &&
      r.contractVersion === "traditional-apply-v1",
    "create lead decodes MerchantCode without claiming signature or underwriting",
  );
  check(
    calls.at(-1).url.endsWith(PAYARC_TRADITIONAL_PATHS.create) &&
      calls.at(-1).method === "POST",
    "Traditional create endpoint used",
  );
  check(
    JSON.parse(calls.at(-1).body).Owners[0].OwnershipPct === 100,
    "reviewed percentage preserved",
  );
  const before = calls.length;
  await adapter.boardMerchant({
    ...profile,
    payarcTraditionalPayload: undefined,
  });
  check(calls.length === before, "missing preparation sends nothing");
  await adapter.boardMerchant({ ...profile, processorProgram: "payfac" });
  check(calls.length === before, "unimplemented Payfac sends nothing");
  for (const status of [500, 502, 503, 504, 408, 302]) {
    stub(status, {});
    r = await adapter.boardMerchant(profile);
    check(r.ambiguous === true, `create ${status} uncertain`);
  }
  for (const status of [400, 401, 403, 422, 429]) {
    stub(status, {});
    r = await adapter.boardMerchant(profile);
    check(
      !r.ambiguous && r.retryable === (status === 429),
      `create ${status} definite rejection`,
    );
  }
  for (const bad of [
    {},
    { id: "legacy-id" },
    { MerchantCode: "" },
    { MerchantCode: { x: 1 } },
  ]) {
    stub(200, bad);
    check(
      (await adapter.boardMerchant(profile)).ambiguous,
      "no synthetic or legacy ID accepted",
    );
  }
  stub(200, {}, true);
  check(
    (await adapter.boardMerchant(profile)).ambiguous,
    "create lost response held",
  );
  const observation = {
    MerchantCode: "MC-1",
    Status: 32,
    LeadStatus: "submitted_to_underwriting",
    LeadModule: "underwriting",
  };
  stub(200, observation);
  let s = await adapter.getMerchantStatus("MC-1", {
    snapshotAuthorizedBaseUrl: "https://testapi.payarc.net/v1",
  });
  check(s.success && s.status === "under_review", "documented status decoded");
  check(
    calls.at(-1).method === "POST" &&
      calls.at(-1).url.endsWith("/lead-status") &&
      JSON.parse(calls.at(-1).body).MerchantCode === "MC-1",
    "status POST carries identity",
  );
  for (const value of [undefined, "OTHER"]) {
    stub(200, { ...observation, MerchantCode: value });
    check(
      !(
        await adapter.getMerchantStatus("MC-1", {
          snapshotAuthorizedBaseUrl: "https://testapi.payarc.net/v1",
        })
      ).success,
      "missing/foreign identity refused",
    );
  }
  for (const status of [0, 1, 2, 4, 8, 16, 32, 64])
    check(
      !!decodePayarcObservation(
        { MerchantCode: "MC-1", Status: status },
        "MC-1",
      ).phase,
      "documented numeric status " + status,
    );
  for (const phase of [
    "approved",
    "pending_docs",
    "declined",
    "boarded",
    "active",
    "on_hold",
  ]) {
    const o = decodePayarcObservation(
      {
        ...observation,
        LeadStatus: phase,
        AccountCode: "AC-1",
        AccountMID: "000123456789",
        AccountStatus: "open",
      },
      "MC-1",
    );
    check(
      phase === "approved"
        ? o.phase === "underwriting_approved"
        : phase === "pending_docs"
          ? o.phase === "documents_needed"
          : o.phase === ({ active: "processing_ready" } as any)[phase] ||
            o.phase === phase,
      "lifecycle " + phase,
    );
  }
  const unsigned = decodePayarcObservation(
    { MerchantCode: "MC-1", Status: 2 },
    "MC-1",
  );
  check(
    unsigned.phase === "awaiting_signature" && !unsigned.mid,
    "unsigned app never boards",
  );
  const approved = decodePayarcObservation(
    { ...observation, LeadStatus: "approved", AccountMID: "000123456789" },
    "MC-1",
  );
  check(!approved.mid, "underwriting approval alone never assigns MID");
  const noAccount = decodePayarcObservation(
    { ...observation, LeadStatus: "boarded", AccountMID: "000123456789" },
    "MC-1",
  );
  check(!noAccount.mid, "MID requires provider account identity");
  for (const bad of [
    { Status: 3 },
    { LeadStatus: "mystery" },
    { LeadModule: "mystery" },
    { AccountStatus: "mystery" },
  ]) {
    assert.throws(() =>
      decodePayarcObservation({ ...observation, ...bad }, "MC-1"),
    );
    checks++;
  }
  stub(201, { MerchantCode: "MC-1" });
  check(
    (await requestPayarcSignature("MC-1", "https://testapi.payarc.net/v1")).ok,
    "signature response correlated",
  );
  check(
    calls.at(-1).url.endsWith("/submit-for-signature") &&
      JSON.parse(calls.at(-1).body).generate_form === false,
    "provider delivers signature; no bearer URL stored",
  );
  stub(201, { MerchantCode: "OTHER" });
  check(
    (await requestPayarcSignature("MC-1", "https://testapi.payarc.net/v1"))
      .ambiguous,
    "foreign signature response uncertain",
  );
  stub(200, {}, true);
  check(
    (await requestPayarcSignature("MC-1", "https://testapi.payarc.net/v1"))
      .ambiguous,
    "lost signature response uncertain",
  );
  const count = calls.length;
  check(
    !(await requestPayarcSignature("MC-1", "https://api.payarc.net/v1")).ok &&
      calls.length === count,
    "sandbox key cannot cross environment",
  );
  check(
    calls.every(
      (c) =>
        c.redirect === "manual" &&
        c.url.startsWith("https://testapi.payarc.net/v1/"),
    ),
    "all transport confined to approved host, redirects denied",
  );
  check(
    !payarcObservationCanAdvance("processing_ready", "under_review"),
    "ordinary poll cannot regress processing readiness",
  );
  check(
    !payarcObservationCanAdvance("signed", "awaiting_signature"),
    "late unsigned status cannot rewind a signed case",
  );
  check(
    payarcObservationCanAdvance("processing_ready", "closed"),
    "authenticated closure remains visible",
  );
  check(
    !payarcObservationCanAdvance("declined", "under_review"),
    "declined case requires explicit correction before reopening",
  );
  console.log(`Payarc Traditional codec: ${checks} checks passed`);
} finally {
  globalThis.fetch = original;
}
