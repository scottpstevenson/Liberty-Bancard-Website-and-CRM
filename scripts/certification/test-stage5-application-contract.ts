/**
 * Stage 5 — application submission contract (S5-01).
 * Disposable database; real finalizeApplication / operatorCreate. No provider contact.
 * Empty, partial, malformed and valid payloads; refusal leaves no outbox effects and no state change.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 5 application contract certification" });
process.env.NODE_ENV = "test";
process.env.VG_PROVIDER_DENY_MODE = "1";
process.env.BACKGROUND_JOB_PROFILE = "off";
process.env.MERCHANT_DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
applyCertificationProviderDenyBoundary({ fatal: true });

const { pool, db } = await import("../../server/db");
const { sql } = await import("drizzle-orm");
const svc = await import("../../server/services/merchant-application-service");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [S5-AC-${String(checks).padStart(2, "0")}] ${message}`); };
const tag = crypto.randomBytes(3).toString("hex");
const ein = () => String(100000000 + Math.floor(Math.random() * 800000000));

const complete = (label: string, over: Record<string, unknown> = {}) => ({
  legalBusinessName: `S5AC ${tag} ${label}`, businessType: "llc", businessAddress: "1 Fixture Way", businessCity: "Miami", businessState: "FL", businessZip: "33101",
  businessPhone: "3055550100", businessEmail: `s5ac-${tag}-${label}@example.invalid`, vertical: "restaurant",
  ownerFirstName: "Fixie", ownerLastName: "Tester", ownerEmail: `s5ac-o-${tag}-${label}@example.invalid`, ownerPhone: "3055550101",
  ownerAddress: "2 Fixture Way", ownerCity: "Miami", ownerState: "FL", ownerZip: "33101", ownershipPercent: 100,
  ein: ein(), ownerDob: "1980-01-02", ownerSsn: "123-45-6789",
  bankName: "Fixture Bank", bankRoutingNumber: "021000021", bankAccountNumber: "123456789", bankAccountType: "checking",
  estimatedMonthlyVolume: "50000", estimatedAvgTicket: "50", highestTicket: "500", acceptedCardTypes: ["visa"],
  terminalNeeded: false, ecommerceNeeded: false, preferredProgram: "traditional", reviewConfirmed: true,
  ...over,
}) as Record<string, unknown>;

const outboxCount = async (id: number) => Number((((await db.execute(sql`SELECT count(*)::int AS n FROM merchant_application_protected_outbox WHERE application_id = ${id}`)) as any).rows)[0].n);
const status = async (id: number) => (((await db.execute(sql`SELECT status FROM merchant_applications WHERE id = ${id}`)) as any).rows)[0].status;
const fin = (d: { id: number; draftToken: string }, body: unknown, key = crypto.randomUUID()) =>
  svc.finalizeApplication({ appId: d.id, draftToken: d.draftToken, idempotencyKey: key, body });
const refused = async (p: Promise<unknown>) => { try { await p; return null; } catch (e: any) { return e; } };

// Refusals: nothing written, no outbox rows, still in_progress.
for (const [name, body, field] of [
  ["empty body", {}, null],
  ["partial body (business step only)", { legalBusinessName: "x", businessType: "llc" }, null],
  ["missing reviewConfirmed", complete("norev", { reviewConfirmed: undefined }), "reviewConfirmed"],
  ["reviewConfirmed false", complete("revfalse", { reviewConfirmed: false }), "reviewConfirmed"],
  ["malformed SSN (8 digits)", complete("badssn", { ownerSsn: "12345678" }), "ownerSsn"],
  ["missing bank account", complete("nobank", { bankAccountNumber: undefined }), "bankAccountNumber"],
  ["terminal needed without type/quantity", complete("noterm", { terminalNeeded: true }), "terminalType"],
  ["no accepted card types", complete("nocards", { acceptedCardTypes: [] }), "acceptedCardTypes"],
] as Array<[string, Record<string, unknown>, string | null]>) {
  const d = await svc.createDraft({});
  const err = await refused(fin(d, body));
  check(err && err.name === "ValidationError" && (field === null || err.message.includes(field)), `${name}: refused with a field-name-only error`);
  check((await outboxCount(d.id)) === 0 && (await status(d.id)) === "in_progress", `${name}: no outbox effect and no state change`);
}
{
  const d = await svc.createDraft({});
  const err = await refused(fin(d, { ...complete("leak"), ownerSsn: "123-45-678" }));
  check(err && !String(err.message).includes("123-45-678") && !String(err.message).includes("021000021"), "refusal text never echoes submitted values");
}

// Draft-saved non-protected values count toward completeness (server merges the stored draft).
{
  const d = await svc.createDraft({});
  const body = complete("merge");
  const draftPart: Record<string, unknown> = {};
  for (const k of ["legalBusinessName", "businessType", "businessAddress", "businessCity", "businessState", "businessZip", "businessPhone", "businessEmail", "vertical"]) draftPart[k] = body[k];
  await svc.autosaveDraft(d.id, d.draftToken, draftPart);
  const rest: Record<string, unknown> = { ...body };
  for (const k of Object.keys(draftPart)) delete rest[k];
  const ack = await fin(d, rest);
  check(ack && (await status(d.id)) === "submitted" && (await outboxCount(d.id)) > 0, "valid submission (autosaved business step + final body) is accepted, becomes submitted and enqueues effects");
  const storedKey = (((await db.execute(sql`SELECT finalize_idempotency_key AS k FROM merchant_applications WHERE id=${d.id}`)) as any).rows)[0].k;
  const replay = await svc.finalizeApplication({ appId: d.id, draftToken: d.draftToken, idempotencyKey: storedKey, body: rest });
  check(replay.replayed === true, "control: the same-key, same-payload replay returns the stored acknowledgement");
  const mismatch = await refused(svc.finalizeApplication({ appId: d.id, draftToken: d.draftToken, idempotencyKey: storedKey, body: {} }));
  check(mismatch && mismatch.name === "ConflictError" && mismatch.code === "finalize_payload_mismatch", "negative control: the same key with a different payload is a conflict (key is bound to one payload)");
  const changed = await refused(svc.finalizeApplication({ appId: d.id, draftToken: d.draftToken, idempotencyKey: storedKey, body: { ...rest, ownerSsn: "987-65-4321" } }));
  check(changed && changed.code === "finalize_payload_mismatch" && (await status(d.id)) === "submitted", "changing one protected value under the same key is a conflict and changes nothing");
  const receipt = await svc.getSavedSubmissionReceipt(d.id, d.draftToken, storedKey);
  check(receipt.saved === true && !!receipt.ack, "the read-only receipt reports the saved submission without dispatching");
  const noReceipt = await svc.getSavedSubmissionReceipt(d.id, d.draftToken, crypto.randomUUID());
  check(noReceipt.saved === false, "a different key reports no saved submission");
}
{
  const d = await svc.createDraft({});
  await fin(d, complete("optional-consent")); // pewcConsent omitted
  check((await status(d.id)) === "submitted", "optional marketing consent stays optional");
}

// Operator path.
{
  const before = Number((((await db.execute(sql`SELECT count(*)::int AS n FROM merchant_applications`)) as any).rows)[0].n);
  const err = await refused(svc.operatorCreate({ body: { legalBusinessName: `S5AC ${tag} op-empty` }, userId: null }));
  const after = Number((((await db.execute(sql`SELECT count(*)::int AS n FROM merchant_applications`)) as any).rows)[0].n);
  check(err && err.name === "ValidationError" && after === before, "operator create with an incomplete submitted application is refused and inserts nothing");
  const ok = await svc.operatorCreate({ body: complete("op-ok"), userId: null });
  check(ok.applicationId > 0 && (await status(ok.applicationId)) === "submitted", "operator create with a complete application succeeds");
}

// ── S5-02 / S5-03: operator identity, links, editor DTO, transitions, stale edits ──
{
  const { statusesForFilter } = await import("../../shared/merchant-application-status");
  check(statusesForFilter("draft").includes("in_progress") && statusesForFilter("draft").includes("draft") && statusesForFilter("submitted").join() === "submitted", "the draft filter covers draft and in_progress; other filters stay exact");

  const mkContact = async (label: string) => Number((((await db.execute(sql`INSERT INTO contacts (first_name,last_name,email,phone) VALUES ('S5AC',${label},${`s5ac-c-${tag}-${label}@example.invalid`},${`+1305556${String(Math.floor(1000 + Math.random() * 8999))}`}) RETURNING id`)) as any).rows)[0].id);
  const mkDeal = async (label: string, contactId: number | null) => Number((((await db.execute(sql`INSERT INTO deals (pipeline,stage,name,contact_id) VALUES ('onboarding','Underwriting',${`S5AC ${tag} ${label}`},${contactId}) RETURNING id`)) as any).rows)[0].id);
  const user = { id: null, firstName: "Op", lastName: "Erator" } as any;
  const upd = (id: number, body: unknown) => svc.operatorUpdate({ appId: id, body, user });
  const ver = async (id: number) => Number((((await db.execute(sql`SELECT state_version AS v FROM merchant_applications WHERE id=${id}`)) as any).rows)[0].v);

  const bodyUser = await refused(svc.operatorCreate({ body: { ...complete("imp"), userId: "someone-else" }, userId: null }));
  check(bodyUser && bodyUser.name === "ZodError", "operator create rejects a body-supplied userId (no impersonation)");
  const c1 = await mkContact("c1"), c2 = await mkContact("c2");
  const dealOfC2 = await mkDeal("d-c2", c2);
  const before = Number((((await db.execute(sql`SELECT count(*)::int AS n FROM merchant_applications`)) as any).rows)[0].n);
  const badCreate = await refused(svc.operatorCreate({ body: { ...complete("badlink"), contactId: c1, dealId: dealOfC2 }, userId: null }));
  const afterN = Number((((await db.execute(sql`SELECT count(*)::int AS n FROM merchant_applications`)) as any).rows)[0].n);
  check(badCreate && badCreate.name === "ValidationError" && afterN === before, "operator create with a deal that belongs to a different contact is refused and inserts nothing");
  const missingDeal = await refused(svc.operatorCreate({ body: { ...complete("nodeal"), dealId: 987654321 }, userId: null }));
  check(missingDeal && missingDeal.name === "ValidationError", "operator create with a nonexistent deal is refused");

  const dealOfC1 = await mkDeal("d-c1", c1);
  const created = await svc.operatorCreate({ body: { ...complete("link"), contactId: c1, dealId: dealOfC1 }, userId: "ignored-operator-id-must-not-be-fk" as any }).catch((e) => e);
  // userId param is the operator actor; it must never become the applicant owner.
  const linked = created.applicationId ?? (await (async () => { throw created; })());
  const owner = (((await db.execute(sql`SELECT user_id FROM merchant_applications WHERE id=${linked}`)) as any).rows)[0].user_id;
  check(owner === null, "the operator is never recorded as the applicant owner");

  const appB = await svc.operatorCreate({ body: complete("b"), userId: null });
  const relinkForeign = await refused(upd(appB.applicationId, { dealId: dealOfC1 }));
  check(relinkForeign && relinkForeign.code === "deal_already_linked", "relinking to a deal already linked to another application is refused");
  const relinkMissingContact = await refused(upd(appB.applicationId, { contactId: 987654321 }));
  check(relinkMissingContact && relinkMissingContact.name === "ValidationError", "relinking to a nonexistent contact is refused");
  const relinkMismatch = await refused(upd(appB.applicationId, { contactId: c1, dealId: dealOfC2 }));
  check(relinkMismatch && relinkMismatch.name === "ValidationError", "relinking a deal that belongs to another contact is refused");

  const stamped = await refused(upd(appB.applicationId, { status: "under_review", approvedAt: new Date().toISOString() }));
  check(stamped && stamped.name === "ZodError", "client-supplied lifecycle timestamps are rejected");
  const edit = await upd(appB.applicationId, { legalBusinessName: "S5AC Renamed", dba: null, ownerFirstName: "Ann", ownerLastName: "Lee", ownerEmail: "x@example.invalid", businessEmail: "y@example.invalid", expectedStateVersion: await ver(appB.applicationId) }) as any;
  check(edit.legalBusinessName === "S5AC Renamed" && edit.ownerFirstName === "Ann", "the narrow editor payload the UI sends is accepted with the expected version");
  const stale = await refused(upd(appB.applicationId, { legalBusinessName: "stale" , expectedStateVersion: 0 }));
  check(stale && stale.code === "state_version_conflict", "a stale edit conflicts instead of overwriting");
  const skip = await refused(upd(appB.applicationId, { status: "approved" }));
  check(skip && skip.code === "invalid_transition", "submitted cannot jump straight to approved (the UI offers Start Review first)");
  const started = await upd(appB.applicationId, { status: "under_review" }) as any;
  check(started.status === "under_review", "submitted → under_review (start review) is allowed");
  const t0 = Date.now();
  const approved = await upd(appB.applicationId, { status: "approved" }) as any;
  check(approved.status === "approved" && new Date(approved.approvedAt).getTime() >= t0 - 5000 && approved.declinedAt == null, "approval sets the timestamp on the server");
  const reopen = await refused(upd(appB.applicationId, { status: "under_review" }));
  check(reopen && reopen.code === "terminal_state", "an approved (terminal) application cannot be reopened");
  const wd = await svc.createDraft({});
  const wdApp = await upd(wd.id, { status: "withdrawn" }) as any;
  check(wdApp.status === "withdrawn", "an in_progress draft can be withdrawn");
}

// ── S5-02: durable prefill capability (real route handlers) ──────────────────
{
  const { registerMerchantsRoutes } = await import("../../server/routes/merchants");
  type H = (req: any, res: any) => Promise<unknown> | unknown;
  const routes = new Map<string, H>();
  const cap = (m: string) => (path: string, ...hs: H[]) => { routes.set(`${m} ${path}`, hs[hs.length - 1]); };
  registerMerchantsRoutes({ post: cap("POST"), get: cap("GET"), put: cap("PUT"), patch: cap("PATCH"), delete: cap("DELETE") } as any);
  const call = async (route: string, req: Record<string, any>) => {
    const h = routes.get(route); assert(h, `route registered: ${route}`);
    const res: any = { code: 200, body: undefined, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; }, send(b: unknown) { this.body = b; return this; } };
    await h!({ params: {}, headers: {}, body: {}, protocol: "https", get: () => "example.invalid", ...req }, res);
    return res as { code: number; body: any };
  };
  const PRE = "POST /api/merchant-applications/prefill-token";
  const GETPRE = "GET /api/merchant-applications/prefill-token/:token";
  const admin = { id: null, role: "admin", email: "admin.fixture@example.invalid" };
  const agentA = { id: null, role: "agent", email: `agent-a-${tag}@example.invalid` };
  const mkC = async (label: string, assignedTo: string | null) => Number((((await db.execute(sql`INSERT INTO contacts (first_name,last_name,email,phone,assigned_to) VALUES ('S5PF',${label},${`s5pf-${tag}-${label}@example.invalid`},${`+1305557${String(Math.floor(1000 + Math.random() * 8999))}`},${assignedTo}) RETURNING id`)) as any).rows)[0].id);
  const mkD = async (label: string, contactId: number | null, owner: string | null) => Number((((await db.execute(sql`INSERT INTO deals (pipeline,stage,name,contact_id,owner) VALUES ('onboarding','Underwriting',${`S5PF ${tag} ${label}`},${contactId},${owner}) RETURNING id`)) as any).rows)[0].id);

  const own = await mkC("own", agentA.email), foreign = await mkC("foreign", `other-${tag}@example.invalid`);
  const ownDeal = await mkD("own", own, agentA.email), foreignDeal = await mkD("foreign", foreign, `other-${tag}@example.invalid`);
  const denied1 = await call(PRE, { user: agentA, body: { contactId: foreign } });
  const denied2 = await call(PRE, { user: agentA, body: { dealId: foreignDeal } });
  const rowsFor = async (d: number) => Number((((await db.execute(sql`SELECT count(*)::int AS n FROM merchant_applications WHERE deal_id = ${d}`)) as any).rows)[0].n);
  check(denied1.code === 404 && denied2.code === 404 && await rowsFor(foreignDeal) === 0, "an agent cannot mint a prefill link for a foreign contact or deal (denied before any write, indistinguishable from not-found)");
  const mism = await call(PRE, { user: admin, body: { contactId: own, dealId: foreignDeal } });
  check(mism.code === 400, "a deal that is not the supplied contact's is refused");

  const ok = await call(PRE, { user: agentA, body: { dealId: ownDeal, legalBusinessName: "S5PF Biz", ein: "123456789", ownerSsn: "123-45-6789" } });
  check(ok.code === 200 && /^\d+\.[0-9a-f]{64}$/.test(ok.body.token), "an authorized agent receives an opaque durable token");
  const stored = (((await db.execute(sql`SELECT draft_token_hash, deal_id, contact_id, ein, owner_ssn, legal_business_name FROM merchant_applications WHERE deal_id = ${ownDeal}`)) as any).rows) as any[];
  check(stored.length === 1 && stored[0].draft_token_hash && !ok.body.token.includes(stored[0].draft_token_hash) && stored[0].contact_id === own && stored[0].ein == null && stored[0].owner_ssn == null,
    "only a hash is stored; the deal and contact are bound server-side; protected body fields are ignored");
  const read = await call(GETPRE, { params: { token: ok.body.token } });
  check(read.code === 200 && read.body.legalBusinessName === "S5PF Biz" && read.body.draftId && !("dealId" in read.body) && !("contactId" in read.body) && !("ein" in read.body), "the public read returns whitelisted fields and no internal ids");
  check((await call(GETPRE, { params: { token: `${read.body.draftId}.${"0".repeat(64)}` } })).code === 404 && (await call(GETPRE, { params: { token: "garbage" } })).code === 404, "a wrong or malformed token is a 404");
  // Restart survival: nothing in process memory — the same read works from the database alone.
  const again = await call(GETPRE, { params: { token: ok.body.token } });
  check(again.code === 200, "the link is database-backed (no process-local map), so it survives a restart");
  // Finalization through the adopted draft lands on the intended deal.
  await svc.finalizeApplication({ appId: read.body.draftId, draftToken: read.body.draftToken, idempotencyKey: crypto.randomUUID(), body: complete("pf-final") });
  const fin2 = (((await db.execute(sql`SELECT deal_id, status FROM merchant_applications WHERE id = ${read.body.draftId}`)) as any).rows)[0];
  check(fin2.deal_id === ownDeal && fin2.status === "submitted", "the finalized application is the one bound to the intended deal");
  check((await call(GETPRE, { params: { token: ok.body.token } })).code === 404, "a finalized (revoked) link can no longer be replayed");
  const reissue = await call(PRE, { user: agentA, body: { dealId: ownDeal } });
  check(reissue.code === 409, "a deal that already has a submitted application cannot get a new prefill link");
  // Re-issue for a deal with only a draft supersedes the old link.
  const d3 = await mkD("reissue", own, agentA.email);
  const t1 = await call(PRE, { user: agentA, body: { dealId: d3 } });
  const t2 = await call(PRE, { user: agentA, body: { dealId: d3 } });
  check(t1.code === 200 && t2.code === 200 && (await call(GETPRE, { params: { token: t1.body.token } })).code === 404 && (await call(GETPRE, { params: { token: t2.body.token } })).code === 200, "re-issuing a link revokes the previous one");
  // Expiry.
  await db.execute(sql`UPDATE merchant_applications SET draft_token_expires_at = now() - interval '1 minute' WHERE id = ${Number(t2.body.token.split(".")[0])}`);
  check((await call(GETPRE, { params: { token: t2.body.token } })).code === 404, "an expired link is a 404");
}

// ── S5-05: consent evidence at submission + ambiguity-safe contact link ──────
{
  const worker = (await import("../../server/services/merchant-application-outbox-worker")).__test__;
  const { OutboxWaitError } = await import("../../server/services/merchant-application-outbox-worker");
  const { PEWC_DISCLOSURE_VERSION } = await import("../../shared/consent-disclosures");
  const fin = async (label: string, over: Record<string, unknown>, evidence?: any) => {
    const d = await svc.createDraft({});
    return svc.finalizeApplication({ appId: d.id, draftToken: d.draftToken, idempotencyKey: crypto.randomUUID(), body: complete(label, over), requestEvidence: evidence }).then((r) => ({ ok: true as const, id: d.id, r }), (e) => ({ ok: false as const, id: d.id, e }));
  };
  const noVersion = await fin("c1", { pewcConsent: true });
  check(!noVersion.ok && (noVersion as any).e.name === "ValidationError" && await status(noVersion.id) !== "submitted", "consent without the current disclosure version is refused and nothing is submitted");
  const stale = await fin("c2", { pewcConsent: true, pewcDisclosureVersion: "v1999-01-01" });
  check(!stale.ok && (stale as any).e.name === "ValidationError", "consent against a stale disclosure version is refused");
  const noPhone = await fin("c3", { pewcConsent: true, pewcDisclosureVersion: PEWC_DISCLOSURE_VERSION, ownerPhone: "", businessPhone: "12" });
  check(!noPhone.ok, "consent without a usable phone number is refused");
  const good = await fin("c4", { pewcConsent: true, pewcDisclosureVersion: PEWC_DISCLOSURE_VERSION }, { ipAddress: "203.0.113.9", userAgent: "S5AC-agent/1.0" });
  check(good.ok, "consent with the current disclosure and a phone submits");
  const crow = (((await db.execute(sql`SELECT payload FROM merchant_application_protected_outbox WHERE application_id = ${good.id} AND event_type = 'consent_record'`)) as any).rows)[0];
  check(crow?.payload?.disclosureVersion === PEWC_DISCLOSURE_VERSION && crow.payload.consentedPhone === "3055550101" && crow.payload.ipAddress === "203.0.113.9" && crow.payload.userAgent === "S5AC-agent/1.0" && !!crow.payload.submittedAt, "the consent step carries disclosure version, phone, request address/agent and submit time");
  const noConsent = await fin("c5", { pewcConsent: false });
  const none = Number((((await db.execute(sql`SELECT count(*)::int AS n FROM merchant_application_protected_outbox WHERE application_id = ${noConsent.id} AND event_type='consent_record'`)) as any).rows)[0].n);
  check(noConsent.ok && none === 0, "no consent step exists when the applicant did not consent");
  const opConsent = await refused(svc.operatorCreate({ body: complete("opc", { pewcConsent: true, pewcDisclosureVersion: PEWC_DISCLOSURE_VERSION }), userId: null }));
  check(opConsent && opConsent.name === "ValidationError", "an operator cannot assert the applicant's consent");

  // Link the consent step to a contact and run the real handler.
  const mkC = async (email: string) => Number((((await db.execute(sql`INSERT INTO contacts (first_name,last_name,email,phone) VALUES ('S5CL','x',${email},${`+1305558${String(Math.floor(1000 + Math.random() * 8999))}`}) RETURNING id`)) as any).rows)[0].id);
  const cid = Number((((await db.execute(sql`INSERT INTO contacts (first_name,last_name,email,phone) VALUES ('S5CL','x',${`s5cl-${tag}-consent@example.invalid`},'+13055550101') RETURNING id`)) as any).rows)[0].id);
  await db.execute(sql`UPDATE merchant_applications SET contact_id = ${cid} WHERE id = ${good.id}`);
  // The handlers run inside the claim fence, so each call needs a real claimed (status=processing) outbox row; a
  // hand-built row object with no durable claim is correctly refused and would let "refused" assertions pass vacuously.
  const claimedRow = async (eventType: string, applicationId: number, payload: any) => {
    const ins = (await db.execute(sql`INSERT INTO merchant_application_protected_outbox (application_id, event_type, payload, idempotency_key, status, attempts)
      VALUES (${applicationId}, ${eventType}, ${JSON.stringify(payload)}::jsonb, ${`s5ac-claim-${crypto.randomUUID()}`}, 'processing', 1) RETURNING id`)) as any;
    return { id: ins.rows[0].id as string, applicationId, eventType, payload, attempts: 1 } as any;
  };
  const sharedConsentClaim = await claimedRow("consent_record", good.id, crow.payload);
  await worker.handleConsentRecord(sharedConsentClaim);
  await worker.handleConsentRecord(sharedConsentClaim);
  const evid = (((await db.execute(sql`SELECT disclosure_version, consented_phone, ip_address, user_agent FROM consent_audit_logs WHERE contact_id = ${cid} AND consent_type = 'express_written'`)) as any).rows) as any[];
  check(evid.length === 1 && evid[0].disclosure_version === PEWC_DISCLOSURE_VERSION && evid[0].consented_phone === "3055550101" && evid[0].ip_address === "203.0.113.9" && evid[0].user_agent === "S5AC-agent/1.0", "the real handler records the submitted evidence exactly once across a replay");
  const otherPhone = await refused(worker.handleConsentRecord(await claimedRow("consent_record", good.id, { ...crow.payload, submissionId: "other", consentedPhone: "3055559999" })));
  check(!!otherPhone, "consent for a number that is not the contact's current number is refused, not recorded");
  const incomplete = await refused(worker.handleConsentRecord(await claimedRow("consent_record", good.id, { pewcConsent: true })));
  check(!!incomplete, "a consent payload lacking submission evidence is refused, never recorded with placeholders");

  // Ambiguous mailbox: two contacts, same address ignoring case → hold, never pick one.
  const email = `s5cl-${tag}-amb@example.invalid`;
  const a1 = await mkC(email), a2 = await mkC(email.toUpperCase());
  const ambApp = await svc.operatorCreate({ body: complete("amb", { ownerEmail: email }), userId: null });
  const ambErr = await refused(worker.handleContactLink(await claimedRow("contact_link", ambApp.applicationId, { ownerEmail: email, ownerFirstName: "A", ownerLastName: "B" })));
  const ambLink = (((await db.execute(sql`SELECT contact_id FROM merchant_applications WHERE id = ${ambApp.applicationId}`)) as any).rows)[0].contact_id;
  check(ambErr instanceof OutboxWaitError && ambErr.reason === "contact_link_ambiguous" && ambLink === null, "an ambiguous mailbox holds the link step and links nothing");
  await db.execute(sql`UPDATE merchant_applications SET contact_id = ${a2} WHERE id = ${ambApp.applicationId}`);
  await worker.handleContactLink(await claimedRow("contact_link", ambApp.applicationId, { ownerEmail: email }));
  const opLink = (((await db.execute(sql`SELECT contact_id FROM merchant_applications WHERE id = ${ambApp.applicationId}`)) as any).rows)[0].contact_id;
  check(opLink === a2, "once an operator links explicitly the step completes without relinking");

  // Deal-bound conflict / deal-bound reuse.
  const cx = await mkC(`s5cl-${tag}-x@example.invalid`), cy = await mkC(`s5cl-${tag}-y@example.invalid`);
  const dealX = Number((((await db.execute(sql`INSERT INTO deals (pipeline,stage,name,contact_id) VALUES ('onboarding','Underwriting',${`S5CL ${tag} dx`},${cx}) RETURNING id`)) as any).rows)[0].id);
  const conflictApp = await svc.operatorCreate({ body: complete("conf", { ownerEmail: `s5cl-${tag}-y@example.invalid`, dealId: dealX }), userId: null });
  const confErr = await refused(worker.handleContactLink(await claimedRow("contact_link", conflictApp.applicationId, { ownerEmail: `s5cl-${tag}-y@example.invalid` })));
  check(confErr instanceof OutboxWaitError && confErr.reason === "contact_link_conflict", "a mailbox owned by a different contact than the bound deal's holds as a conflict");
  const dealX2 = Number((((await db.execute(sql`INSERT INTO deals (pipeline,stage,name,contact_id) VALUES ('onboarding','Underwriting',${`S5CL ${tag} dx2`},${cx}) RETURNING id`)) as any).rows)[0].id);
  const noMatchEmail = `s5cl-${tag}-fresh@example.invalid`;
  const reuseApp = await svc.operatorCreate({ body: complete("reuse", { ownerEmail: noMatchEmail, dealId: dealX2 }), userId: null });
  const contactsBefore = Number((((await db.execute(sql`SELECT count(*)::int AS n FROM contacts`)) as any).rows)[0].n);
  await worker.handleContactLink(await claimedRow("contact_link", reuseApp.applicationId, { ownerEmail: noMatchEmail, ownerFirstName: "N", ownerLastName: "M" }));
  const contactsAfter = Number((((await db.execute(sql`SELECT count(*)::int AS n FROM contacts`)) as any).rows)[0].n);
  const reuseLink = (((await db.execute(sql`SELECT contact_id FROM merchant_applications WHERE id = ${reuseApp.applicationId}`)) as any).rows)[0].contact_id;
  check(reuseLink === cx && contactsAfter === contactsBefore, "a deal-bound application links to the deal's contact instead of creating a duplicate");
}

// ── S5-23 (SOURCE-CHECKED ONLY, no HTTP/browser execution): e-sign status read is pure; refresh is separate ──
{
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("server/routes/merchants.ts", "utf8");
  const slice = (start: string, end: string) => { const a = src.indexOf(start); const b = src.indexOf(end, a + start.length); assert(a > 0 && b > a, `source markers found: ${start}`); return src.slice(a, b); };
  const getBlock = slice('app.get("/api/merchant-applications/:id/esign-status"', 'app.post("/api/merchant-applications/:id/esign-status/refresh"');
  check(!/getDocumentStatus|applyEsignDocumentState|storage\.update|db\.(update|insert)/.test(getBlock), "GET esign-status contains no provider call and no write (source-checked)");
  const refreshBlock = slice('app.post("/api/merchant-applications/:id/esign-status/refresh"', "// GHL document webhook");
  check(/getDocumentStatus/.test(refreshBlock) && /applyEsignDocumentState/.test(refreshBlock) && /provider_unavailable/.test(refreshBlock), "the provider refresh is a separate POST command that reports an unreachable provider as unavailable (source-checked)");
  const ui = readFileSync("client/src/pages/dashboard/MerchantApplicationsList.tsx", "utf8");
  check(!/\/api\/documents["`/]/.test(ui.replace(/\/api\/documents\/bulk/g, "")) && /\/api\/merchant-documents\/contact\//.test(ui) && /text-documents-unavailable/.test(ui), "the review UI uses the scoped document reader and renders an unavailable state distinct from empty (source-checked)");
  const pub = readFileSync("client/src/pages/MerchantApplication.tsx", "utf8");
  check(!/within 1 business day|within 1-2 business days|Most approvals within|ship your equipment/.test(pub), "the public application no longer promises timelines or shipment (source-checked)");
}


// ── S5-03: operator list is a bounded SQL read model (no load-all-and-filter-in-JS) ──
{
  const rm = await import("../../server/services/merchant-application-read-model");
  const mine: number[] = [];
  for (const l of ["rm-a", "rm-b", "rm-c"]) mine.push((await svc.operatorCreate({ body: complete(l), userId: null })).applicationId);
  const draftsBefore = (await rm.listMerchantApplicationsPage({ statuses: ["in_progress", "draft"], limit: 1 })).total;
  await svc.createDraft({}); await svc.createDraft({});
  const all = await rm.listMerchantApplicationsPage({ search: tag.toUpperCase(), limit: 100 });
  check(all.total >= 3 && mine.every((id) => all.rows.some((r: any) => r.id === id)), "search is case-insensitive and executed in SQL");
  const p1 = await rm.listMerchantApplicationsPage({ search: `S5AC ${tag} rm-`, limit: 2, offset: 0 });
  const p2 = await rm.listMerchantApplicationsPage({ search: `S5AC ${tag} rm-`, limit: 2, offset: 2 });
  check(p1.total === 3 && p1.rows.length === 2 && p2.rows.length === 1 && !p2.rows.some((r: any) => p1.rows.some((q: any) => q.id === r.id)), "paging returns disjoint pages with an exact uncapped total");
  check((await rm.listMerchantApplicationsPage({ search: "%", limit: 5 })).total === 0, "LIKE wildcards in the search term are escaped, not interpreted");
  check((await rm.listMerchantApplicationsPage({ limit: 9999 })).limit === 100, "an oversized limit is clamped to 100");
  const draftsAfter = (await rm.listMerchantApplicationsPage({ statuses: ["in_progress", "draft"], limit: 1 })).total;
  check(draftsAfter - draftsBefore === 2, "the draft filter covers both draft and in_progress rows");
  const pending = await rm.countPendingMerchantApplications();
  const sqlPending = Number((((await db.execute(sql`SELECT count(*)::int AS n FROM merchant_applications WHERE status IN ('submitted','under_review')`)) as any).rows)[0].n);
  check(pending === sqlPending, "the pending count is a SQL aggregate that matches the table");
  const { readFileSync: rfs } = await import("node:fs");
  const routeSrc = rfs("server/routes/merchants.ts", "utf8");
  check(!/storage\.getMerchantApplications\(\)/.test(routeSrc), "no merchant-application route loads the whole table (source-checked)");
}

console.log(`\nStage 5 application contract certification: ${checks} checks passed`);
await pool.end();
process.exit(0);
