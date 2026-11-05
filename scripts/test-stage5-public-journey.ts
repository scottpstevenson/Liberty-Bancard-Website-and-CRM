import assert from "node:assert/strict";
import crypto from "node:crypto";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";

/**
 * Stage 5 R01 — public application journey over REAL HTTP.
 * The request body is produced by the SAME builder the wizard ships (`buildPublicApplicationPayload`), sent through the
 * registered merchant routes on a private listener with a disposable database. No provider, send or MID path is registered.
 * Qualification: server/client contract + persistence; not a browser run (see test-stage5-browser.ts for UI evidence).
 */
process.env.NODE_ENV ||= "test";
process.env.MERCHANT_DATA_ENCRYPTION_KEY ||= crypto.randomBytes(32).toString("hex");
const h = await stage3BHttpFixture(async app => {
  const { registerMerchantsRoutes } = await import("../server/routes/merchants");
  registerMerchantsRoutes(app);
  app.use("/api", (_req, res) => res.status(501).json({ message: "Unregistered isolated service" }));
}, undefined, { backgroundProfile: "off" });
const { buildPublicApplicationPayload, finalizeAttributionExtras } = await import("../shared/merchant-application-submission");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [S5-PJ-${String(checks).padStart(2, "0")}] ${message}`); };
const tag = crypto.randomBytes(3).toString("hex");
const q = async (sql: string, p: unknown[] = []) => (await h.pool.query(sql, p)).rows as any[];
const pub = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => h.request("none", method, path, body, false, headers);

const state = (label: string, over: Record<string, unknown> = {}) => ({
  legalBusinessName: `S5PJ ${tag} ${label}`, dba: "", businessType: "llc", ein: String(100000000 + crypto.randomInt(800000000)).replace(/(\d{2})(\d{7})/, "$1-$2"),
  businessStartDate: "2015-01-01", businessAddress: "1 Fixture Way", businessCity: "Miami", businessState: "FL", businessZip: "33101",
  businessPhone: "3055550100", businessEmail: `s5pj-${tag}-${label}@example.invalid`, website: "", vertical: "restaurant",
  ownerFirstName: "Fixie", ownerLastName: "Tester", ownerEmail: `s5pj-o-${tag}-${label}@example.invalid`, ownerPhone: "3055550101",
  ownerDob: "1980-01-02", ownerSsn: "123-45-6789", ownerAddress: "2 Fixture Way", ownerCity: "Miami", ownerState: "FL", ownerZip: "33101",
  ownershipPercent: "100", bankName: "Fixture Bank", bankRoutingNumber: "021000021", bankAccountNumber: "123456789", bankAccountType: "checking",
  estimatedMonthlyVolume: "$50,000", estimatedAvgTicket: "50", highestTicket: "500", currentProcessor: "", currentRate: "",
  acceptedCardTypes: ["visa"], terminalNeeded: false, terminalType: "", terminalQuantity: "1", ecommerceNeeded: false, preferredProgram: "traditional",
  reviewConfirmed: true, pewcConsent: false, pewcDisclosureVersion: "",
  ...over,
}) as any;
const draft = async () => { const r = await pub("POST", "/api/merchant-applications/draft", {}); assert.equal(r.status, 200, "draft created"); return r.body as { id: number; draftToken: string }; };
const fin = (d: { id: number; draftToken: string }, body: unknown, key: string, extraHeaders: Record<string, string> = {}) =>
  pub("PATCH", `/api/merchant-applications/${d.id}/finalize`, body, { "x-draft-token": d.draftToken, "idempotency-key": key, ...extraHeaders });
const appRow = async (id: number) => (await q("SELECT status, deal_id, ein, owner_ssn FROM merchant_applications WHERE id = $1", [id]))[0];

try {
  // 1. The blocker: the real builder must carry reviewConfirmed; without it the server refuses (original behaviour).
  {
    const d = await draft();
    const without = buildPublicApplicationPayload(state("norev", { reviewConfirmed: false })) as any;
    check(without.reviewConfirmed === false, "the shipped builder reports the reviewer's actual (unchecked) confirmation");
    const r0 = await fin(d, without, crypto.randomUUID());
    check(r0.status === 400 && r0.body.field === "reviewConfirmed" && (await appRow(d.id)).status === "in_progress", "negative control: an unconfirmed review is refused with the field name and nothing is saved");
    const legacy = { ...(buildPublicApplicationPayload(state("legacy")) as any) }; delete legacy.reviewConfirmed;
    const r1 = await fin(d, legacy, crypto.randomUUID());
    check(r1.status === 400 && r1.body.field === "reviewConfirmed", "negative control: the original payload shape (no reviewConfirmed) is refused");
    const good = buildPublicApplicationPayload(state("good")) as any;
    check(good.reviewConfirmed === true, "the shipped builder carries reviewConfirmed=true when the reviewer confirmed");
  }

  // 2. Full journey: draft → autosave → finalize → replay → mismatch → receipt → duplicate precheck.
  const s = state("journey");
  const d = await draft();
  const key = crypto.randomUUID();
  const auto = await pub("PATCH", `/api/merchant-applications/${d.id}/autosave`, { legalBusinessName: s.legalBusinessName, businessType: s.businessType, businessAddress: s.businessAddress, businessCity: s.businessCity, businessState: s.businessState, businessZip: s.businessZip, businessPhone: s.businessPhone, businessEmail: s.businessEmail, vertical: s.vertical }, { "x-draft-token": d.draftToken });
  check(auto.status === 200, "autosave of the non-protected business step succeeds with the header token");
  check((await pub("PATCH", `/api/merchant-applications/${d.id}/autosave`, { legalBusinessName: "x" })).status === 404, "autosave without a token is a 404");
  const payload = buildPublicApplicationPayload(s) as any;
  const ok = await fin(d, payload, key);
  check(ok.status === 200 && (await appRow(d.id)).status === "submitted", "finalize with the shipped payload is accepted and the application becomes submitted");
  const row = await appRow(d.id);
  check(row.ein && !String(row.ein).includes(s.ein.replace(/\D/g, "")) && row.owner_ssn && !String(row.owner_ssn).includes("123456789"), "protected values are stored encrypted, not as typed");
  check(!JSON.stringify(ok.body).includes("123456789") && !JSON.stringify(ok.body).includes("021000021"), "the acknowledgement never echoes protected values");
  const replay = await fin(d, payload, key);
  check(replay.status === 200 && replay.body.replayed === true, "the same key and payload replays the stored acknowledgement");
  const mism = await fin(d, { ...payload, bankAccountNumber: "987654321" }, key);
  check(mism.status === 409 && mism.body.code === "finalize_payload_mismatch", "negative control: the same key with a changed protected value is a 409 (key bound to one payload)");
  const rc = await pub("GET", `/api/merchant-applications/${d.id}/finalize-receipt`, undefined, { "x-draft-token": d.draftToken, "idempotency-key": key });
  check(rc.status === 200 && rc.body.saved === true, "the read-only receipt reports the saved submission");
  const rc2 = await pub("GET", `/api/merchant-applications/${d.id}/finalize-receipt`, undefined, { "x-draft-token": d.draftToken, "idempotency-key": crypto.randomUUID() });
  check(rc2.status === 200 && rc2.body.saved === false, "a different key reports nothing saved");
  check((await pub("GET", `/api/merchant-applications/${d.id}/finalize-receipt`, undefined, { "idempotency-key": key })).status === 404, "the receipt without the draft token is a 404");
  const dupAnon = await pub("POST", "/api/merchant-applications/check-duplicate", { ein: s.ein });
  check(dupAnon.status === 200 && dupAnon.body.exists === true, "an anonymous duplicate check finds the submitted EIN");
  const dupSelf = await pub("POST", "/api/merchant-applications/check-duplicate", { ein: s.ein, draftId: d.id }, { "x-draft-token": d.draftToken });
  check(dupSelf.status === 200 && dupSelf.body.exists === false, "the draft's own saved submission is excluded from its duplicate check");

  // 3. Share token / deal tuple.
  const mkDeal = async (label: string, shareToken: string | null) => Number((await q("INSERT INTO deals (pipeline, stage, name, share_token) VALUES ('onboarding','Underwriting',$1,$2) RETURNING id", [`S5PJ ${tag} ${label}`, shareToken]))[0].id);
  const dealA = await mkDeal("share-a", `s5pj${tag}a`), dealB = await mkDeal("share-b", `s5pj${tag}b`);
  const dBad = await draft();
  const badShare = await fin(dBad, buildPublicApplicationPayload(state("badshare"), { _shareToken: "does-not-exist" }), crypto.randomUUID());
  check(badShare.status === 400 && (await appRow(dBad.id)).status === "in_progress", "an invalid share token is a 400 and nothing is submitted");
  const dShare = await draft();
  const okShare = await fin(dShare, buildPublicApplicationPayload(state("share"), { _shareToken: `s5pj${tag}a` }), crypto.randomUUID());
  check(okShare.status === 200 && (await appRow(dShare.id)).deal_id === dealA, "a valid share token binds the application to exactly that deal");
  // The browser's stored tracking record (landing page + click ids) must not turn a real submission into a 400.
  const fullStoredTracking = { utmSource: "google", utmMedium: "cpc", utmCampaign: "s5pj", landingPage: "/merchant-application?utm_source=google", gclid: "abc", gclidPresent: true, fbclidPresent: true, msclkidPresent: true };
  const dAttr = await draft();
  const attr = await fin(dAttr, buildPublicApplicationPayload(state("attr"), finalizeAttributionExtras(fullStoredTracking)), crypto.randomUUID());
  check(attr.status === 200 && (await appRow(dAttr.id)).status === "submitted", "a submission from a visitor with a stored landing page and click ids is accepted (only the five attribution fields are sent)");
  const rawStored = await fin(await draft(), buildPublicApplicationPayload(state("attrraw"), fullStoredTracking), crypto.randomUUID());
  check(rawStored.status === 400, "negative control: spreading the whole stored tracking record into the body is refused by the strict schema");
  // A draft or in-progress application (never submitted) cannot request e-signature; nothing is queued.
  const dDraftEsign = await draft();
  const esignState = async (id: number) => (await q("SELECT status, esign_send_state FROM merchant_applications WHERE id = $1", [id]))[0];
  const beforeDraft = await esignState(dDraftEsign.id);
  const draftEsign = await h.request("admin", "POST", `/api/merchant-applications/${dDraftEsign.id}/send-esign`, {});
  check(draftEsign.status === 409 && draftEsign.body.code === "application_not_submitted" && (await esignState(dDraftEsign.id)).esign_send_state === beforeDraft.esign_send_state, `a ${beforeDraft.status} application cannot request e-signature (409 application_not_submitted) and nothing is queued`);
  await pub("PATCH", `/api/merchant-applications/${dDraftEsign.id}/autosave`, { legalBusinessName: "S5PJ in progress" }, { "x-draft-token": dDraftEsign.draftToken });
  const progressEsign = await h.request("admin", "POST", `/api/merchant-applications/${dDraftEsign.id}/send-esign`, {});
  check((await esignState(dDraftEsign.id)).status === "in_progress" && progressEsign.status === 409 && progressEsign.body.code === "application_not_submitted", "an in-progress (autosaved) application is refused the same way");
  const dealC = await mkDeal("prefill-bound", null);
  const pf = await h.request("admin", "POST", "/api/merchant-applications/prefill-token", { dealId: dealC, legalBusinessName: "S5PJ prefill" });
  check(pf.status === 200 && /^\d+\.[0-9a-f]{64}$/.test(pf.body.token), "an admin mints a prefill link for the deal");
  const [pid, ptoken] = pf.body.token.split(".");
  const conflict = await fin({ id: Number(pid), draftToken: ptoken }, buildPublicApplicationPayload(state("tuple"), { _shareToken: `s5pj${tag}b` }), crypto.randomUUID());
  check(conflict.status === 409 && (await appRow(Number(pid))).status === "in_progress", "negative control: a share token for a different deal than the draft's bound deal is a 409 and changes nothing");
  void dealB;

  // 4. Concurrent first-time prefill for one deal leaves exactly one live application.
  const dealD = await mkDeal("concurrent", null);
  const results = await Promise.all([0, 1, 2, 3].map(() => h.request("admin", "POST", "/api/merchant-applications/prefill-token", { dealId: dealD })));
  const live = await q("SELECT count(*)::int AS n FROM merchant_applications WHERE deal_id = $1 AND status IN ('draft','in_progress')", [dealD]);
  check(results.every(r => r.status === 200) && live[0].n === 1, "four concurrent prefill requests for one deal leave exactly one live application (the others are revoked)");

  // 5. Role denial on the operator create route.
  const denied = [] as number[];
  for (const role of ["agent", "merchant", "partner", "affiliate"]) denied.push((await h.request(role, "POST", "/api/merchant-applications", { legalBusinessName: "x" })).status);
  check(denied.every(c => c === 403), `agent/merchant/partner/affiliate are denied on operator create (${denied.join(",")})`);
  const anon = await pub("POST", "/api/merchant-applications", { legalBusinessName: `S5PJ ${tag} anon` });
  check((anon.status === 401 || anon.status === 403) && (await q("SELECT 1 FROM merchant_applications WHERE legal_business_name = $1", [`S5PJ ${tag} anon`])).length === 0, `an unauthenticated caller is refused (${anon.status}) on operator create and nothing is inserted`);
  check(h.externalCalls() === 0, "no external call was attempted during the journey");

  console.log(`\nStage 5 public journey: ${checks} checks passed`);
} finally {
  await h.close();
}
process.exit(0);
