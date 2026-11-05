/**
 * Stage 5 CP4 — boarding route certification (S5-13 request identity, S5-19 bulk-refresh scope, S5-22 key contract).
 * Disposable database; the REAL registered route handlers run with a capture-only app; no worker, provider or MID.
 *
 * S5-13: an Idempotency-Key replay is honoured only for the SAME deal/application/processor command; a key already
 *        bound elsewhere is a 409 and never "already queued"; concurrent same-key requests create exactly one row.
 * S5-19: bulk refresh validates, de-duplicates and bounds body ids, applies per-deal owner authorization and never
 *        selects another owner's deals for an agent.
 * S5-22: the embedded panel sends an Idempotency-Key and does not claim an immediate provider application id.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 5 boarding route certification" });
process.env.VG_PROVIDER_DENY_MODE = "1";
process.env.BACKGROUND_JOB_PROFILE = "off";
applyCertificationProviderDenyBoundary({ fatal: true });

const { pool, db } = await import("../../server/db");
const { sql } = await import("drizzle-orm");
const mids = await import("../../server/services/merchant-mid-service");
const { registerUnderwritingRoutes } = await import("../../server/routes/underwriting");
const { registerBoardingRoutes } = await import("../../server/routes/boarding");
const { recordCertPolicy, removeCertPolicy, CERT_PROGRAM } = await import("./stage5-boarding-fixture");
await recordCertPolicy(db, sql);

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [S5-BR-${String(checks).padStart(2, "0")}] ${message}`); };
const tag = crypto.randomBytes(4).toString("hex");

type Handler = (req: any, res: any) => Promise<unknown>;
const routes = new Map<string, Handler>();
const capture = (method: string) => (path: string, ...handlers: Handler[]) => { routes.set(`${method} ${path}`, handlers[handlers.length - 1]); };
registerBoardingRoutes({ post: capture("POST"), get: capture("GET"), put: capture("PUT"), patch: capture("PATCH"), delete: capture("DELETE") } as any);

registerUnderwritingRoutes({ post: capture("POST"), get: capture("GET"), put: capture("PUT"), patch: capture("PATCH"), delete: capture("DELETE") } as any);

async function call(route: string, req: { params?: any; headers?: any; body?: any; query?: any; user: any }) {
  const handler = routes.get(route);
  assert(handler, `route registered: ${route}`);
  const res: any = { code: 200, body: undefined, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  await handler!({ params: {}, headers: {}, body: {}, query: {}, ...req }, res);
  return res as { code: number; body: any };
}
const admin = { id: "fixture-admin", role: "admin", email: "admin.fixture@example.invalid" };
const agentA = { role: "agent", email: `agent-a-${tag}@example.invalid` };
const SUBMIT = "POST /api/deals/:id/submit-to-processor";

async function deal(label: string, over: { owner?: string; boardingStatus?: string | null; pipeline?: string; complete?: boolean; stage?: string } = {}) {
  const r = await db.execute(sql`
    INSERT INTO deals (pipeline, stage, name, owner, boarding_status)
    VALUES (${over.pipeline ?? "onboarding"}, ${over.stage ?? 'Underwriting'}, ${`S5BR ${tag} ${label}`}, ${over.owner ?? null}, ${over.boardingStatus ?? null}) RETURNING id`);
  const dealId = Number(((r as any).rows ?? r)[0].id);
  if (over.complete === false) {
    await db.execute(sql`INSERT INTO merchant_applications (deal_id, legal_business_name, status) VALUES (${dealId}, ${`S5BR ${label}`}, 'submitted')`);
  } else {
    // Presence-only fixture values (readiness checks protected columns without decrypting).
    await db.execute(sql`INSERT INTO merchant_applications (deal_id, legal_business_name, business_address, business_city, business_state, business_zip,
        owner_first_name, owner_last_name, ein, owner_ssn, owner_dob, bank_routing_number, bank_account_number, status, preferred_program)
      VALUES (${dealId}, ${`S5BR ${label}`}, '1 Fixture Way', 'Miami', 'FL', '33101', 'Fixie', 'Tester', 'enc', 'enc', 'enc', 'enc', 'enc', 'submitted', ${CERT_PROGRAM})`);
  }
  return dealId;
}
const outboxRows = async (key: string) => (((await db.execute(sql`SELECT id, deal_id, processor_name FROM deal_boarding_outbox WHERE idempotency_key = ${key}`)) as any).rows) as any[];
const boardingStatus = async (id: number) => (((await db.execute(sql`SELECT boarding_status FROM deals WHERE id = ${id}`)) as any).rows)[0].boarding_status;

// ── S5-13 ────────────────────────────────────────────────────────────────────
{
  const a = await deal("a"), b = await deal("b");
  const key = `s5br-${tag}-k1`;
  check((await call(SUBMIT, { params: { id: String(a) }, body: {}, user: admin })).code === 400, "missing Idempotency-Key is refused");
  const first = await call(SUBMIT, { params: { id: String(a) }, headers: { "idempotency-key": key }, body: {}, user: admin });
  check(first.code === 202 && (await outboxRows(key)).length === 1, "first submission queues exactly one outbox row");
  check(first.body.replayed === false && first.body.outboxId === (await outboxRows(key))[0].id && first.body.receipt?.outboxId === first.body.outboxId && first.body.receipt?.boardingStatus === "queued", "the 202 carries replayed:false, the outbox id and a queued receipt (the panel's recovery handle)");
  const replay = await call(SUBMIT, { params: { id: String(a) }, headers: { "idempotency-key": key }, body: {}, user: admin });
  check(replay.code === 202 && replay.body.outboxId === (await outboxRows(key))[0].id && (await outboxRows(key)).length === 1, "same command replay returns the same row, no second row");
  const otherDeal = await call(SUBMIT, { params: { id: String(b) }, headers: { "idempotency-key": key }, body: {}, user: admin });
  check(otherDeal.code === 409 && (await outboxRows(key)).length === 1, "negative control: same key on a different deal is a 409, not 'already queued'");
  check(await boardingStatus(b) === null, "the other deal was not claimed or changed");
  const otherProcessor = await call(SUBMIT, { params: { id: String(a) }, headers: { "idempotency-key": key }, body: { processorName: "mock" }, user: admin });
  check(otherProcessor.code === 409, "same key with a different processor is a 409");
}
{
  // Barrier-driven concurrency: four identical requests released together.
  const c = await deal("c");
  const key = `s5br-${tag}-race`;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const requests = [0, 1, 2, 3].map(async () => { await gate; return call(SUBMIT, { params: { id: String(c) }, headers: { "idempotency-key": key }, body: {}, user: admin }); });
  release();
  const results = await Promise.all(requests);
  check((await outboxRows(key)).length === 1, "four concurrent identical requests create exactly one outbox row");
  check(results.filter((r) => r.code === 202).length >= 1 && results.every((r) => r.code === 202 || r.code === 409), "every concurrent request gets 202 or 409, never 500");
  check(await boardingStatus(c) === "queued", "the deal is queued once");
}

// ── S5-15: shared readiness contract at enqueue ─────────────────────────────
{
  const READY = "GET /api/deals/:id/boarding-readiness";
  const sales = await deal("ready-sales", { pipeline: "sales" });
  const k1 = `s5br-${tag}-ready-1`;
  const r1 = await call(SUBMIT, { params: { id: String(sales) }, headers: { "idempotency-key": k1 }, body: {}, user: admin });
  check(r1.code === 400 && r1.body.blockers?.some((b: any) => b.code === "deal_not_in_onboarding_pipeline") && (await outboxRows(k1)).length === 0,
    "negative control: a sales-pipeline deal whose stage text says 'Underwriting' is no longer eligible (original text match allowed it)");
  const inc = await deal("ready-incomplete", { complete: false });
  const k2 = `s5br-${tag}-ready-2`;
  const r2 = await call(SUBMIT, { params: { id: String(inc) }, headers: { "idempotency-key": k2 }, body: {}, user: admin });
  const incBlocker = r2.body.blockers?.find((b: any) => b.code === "application_incomplete");
  check(r2.code === 400 && incBlocker && incBlocker.detail.includes("bankAccountNumber") && (await outboxRows(k2)).length === 0, "an incomplete application is refused at enqueue with field names only");
  const rej = await deal("ready-reject");
  const [{ id: decId }] = (((await db.execute(sql`INSERT INTO underwriting_decisions (deal_id, decision, score) VALUES (${rej}, 'review', 40) RETURNING id`)) as any).rows) as any[];
  await db.execute(sql`UPDATE underwriting_decisions SET override_action='reject' WHERE id = ${decId}`);
  const k3 = `s5br-${tag}-ready-3`;
  const r3 = await call(SUBMIT, { params: { id: String(rej) }, headers: { "idempotency-key": k3 }, body: {}, user: admin });
  check(r3.code === 400 && r3.body.blockers?.some((b: any) => b.code === "internal_underwriting_not_cleared"), "a rejected latest internal decision blocks enqueue");
  await db.execute(sql`INSERT INTO underwriting_decisions (deal_id, decision, score) VALUES (${rej}, 'approve', 90)`);
  const r4 = await call(SUBMIT, { params: { id: String(rej) }, headers: { "idempotency-key": k3 }, body: {}, user: admin });
  check(r4.code === 202, "control: a newer approving decision clears the block");
  const rd = await call(READY, { params: { id: String(inc) }, user: admin });
  check(rd.code === 200 && rd.body.ready === false && rd.body.facts.internalDecision === "none_recorded", "readiness route returns the same blockers and facts");
  check(rd.body.policyGates.map((g: any) => g.code).sort().join() === "e_signature_by_program,required_documents_by_program"
    && rd.body.policyGates.every((g: any) => g.state === "native_policy_required"), "document and e-sign conditions are explicit native policy gates, not silently met");
  check((await call(READY, { params: { id: "999999999" }, user: admin })).code === 404, "readiness for an unknown deal is a 404");
}

// ── R03/R04/R01-3: readiness positives/exclusions, saved-outcome replay, exact bridge ─────────
{
  const READY = "GET /api/deals/:id/boarding-readiness";
  const readiness = async (id: number) => (await call(READY, { params: { id: String(id) }, user: admin })).body;
  const codes = (r: any) => (r.blockers as any[]).map((b) => b.code);

  const ok = await deal("r3-ok");
  const rOk = await readiness(ok);
  check(rOk.ready === true && rOk.policyGates.every((g: any) => g.state === "resolved") && typeof rOk.caseVersion === "string" && rOk.caseVersion.length === 64,
    "with an owner-recorded policy a complete submitted application is ready and the verdict carries a case version");

  const prog = await deal("r3-inprogress");
  await db.execute(sql`UPDATE merchant_applications SET status = 'in_progress' WHERE deal_id = ${prog}`);
  const rProg = await readiness(prog);
  check(rProg.ready === false && codes(rProg).includes("application_not_active"), "negative control: an in-progress application with no decision is NOT ready (positive allowed states)");

  const lost = await deal("r3-lost", { stage: "Closed Lost" });
  check((await readiness(lost)).ready === false && codes(await readiness(lost)).includes("deal_not_operational"), "a Closed Lost onboarding deal is not ready (no Submit)");
  const arch = await deal("r3-archived");
  await db.execute(sql`UPDATE deals SET archived_at = now() WHERE id = ${arch}`);
  check(codes(await readiness(arch)).includes("deal_not_operational"), "an archived deal is not ready");
  const testClass = await deal("r3-testclass");
  await db.execute(sql`UPDATE deals SET record_class = 'test' WHERE id = ${testClass}`);
  check(codes(await readiness(testClass)).includes("deal_not_operational"), "a test-class deal is not ready");

  // Policy: unresolved gates block; a recorded program policy with a required document / e-sign blocks until met.
  await removeCertPolicy(db, sql);
  const rNoPol = await readiness(ok);
  check(rNoPol.ready === false && codes(rNoPol).some((c) => c.startsWith("policy_unresolved:")) && rNoPol.policyGates.every((g: any) => g.state === "native_policy_required"),
    "negative control: with no recorded policy, native_policy_required gates make ready=false");
  await recordCertPolicy(db, sql, { [CERT_PROGRAM]: { requiredDocuments: ["bank_statement"], esignRequired: true } }, "cert-policy-v2");
  const rReq = await readiness(ok);
  check(codes(rReq).includes("required_document_missing") && codes(rReq).includes("e_signature_required") && rReq.caseTuple.policyVersion === "cert-policy-v2",
    "a recorded policy requiring a document and e-signature blocks until both are met, and its version is in the case tuple");
  await db.execute(sql`INSERT INTO underwriting_conditions (deal_id, condition_type, description, status) VALUES (${ok}, 'bank_statement', 'fixture', 'approved')`);
  await db.execute(sql`UPDATE merchant_applications SET esign_status = 'signed' WHERE deal_id = ${ok}`);
  check((await readiness(ok)).ready === true, "control: meeting the recorded requirements clears the blockers");
  await recordCertPolicy(db, sql);

  // Replay returns the actual saved outcome and a receipt, bound to actor/action/program.
  const key = `s5br-${tag}-replay`;
  const first = await call(SUBMIT, { params: { id: String(ok) }, headers: { "idempotency-key": key }, body: {}, user: admin });
  check(first.code === 202, "the ready deal queues");
  const outboxId = (await outboxRows(key))[0].id;
  const payload = (((await db.execute(sql`SELECT payload FROM deal_boarding_outbox WHERE id = ${outboxId}`)) as any).rows)[0].payload;
  check(typeof payload.readinessCaseVersion === "string" && payload.command?.actorId === "fixture-admin" && payload.command?.action === "processor_submit",
    "the outbox payload captures the case version and binds actor/action/program");
  await db.execute(sql`UPDATE deal_boarding_outbox SET status = 'delivered' WHERE id = ${outboxId}`);
  const replay = await call(SUBMIT, { params: { id: String(ok) }, headers: { "idempotency-key": key }, body: {}, user: admin });
  check(replay.code === 200 && replay.body.status === "delivered" && replay.body.replayed === true && replay.body.receipt?.outboxId === outboxId,
    "a replay reports the actual saved outcome (delivered) with a receipt, not a blanket 'queued'");
  const otherActor = await call(SUBMIT, { params: { id: String(ok) }, headers: { "idempotency-key": key }, body: {}, user: { ...admin, id: "someone-else" } });
  check(otherActor.code === 409, "negative control: the same key from a different actor is a 409");
  const staleRev = await call(SUBMIT, { params: { id: String(ok) }, headers: { "idempotency-key": key }, body: { expectedApplicationRevision: "1999-01-01 00:00:00" }, user: admin });
  check(staleRev.code === 409, "a replay naming a different application revision is a 409");

  // Revision conflict at first submit.
  const rv = await deal("r4-revision");
  const conflict = await call(SUBMIT, { params: { id: String(rv) }, headers: { "idempotency-key": `s5br-${tag}-rev` }, body: { expectedApplicationRevision: "1999-01-01 00:00:00" }, user: admin });
  check(conflict.code === 409 && (await outboxRows(`s5br-${tag}-rev`)).length === 0 && await boardingStatus(rv) === null, "a stale expected application revision conflicts before any local change");

  // Pinned adapter: the stored processor name is explicit when the default adapter resolves.
  const { getDefaultProcessor } = await import("../../server/services/processors/registry");
  let defName: string | null = null;
  try { defName = getDefaultProcessor().name; } catch { defName = null; }
  const pin = await deal("r4-pin");
  await call(SUBMIT, { params: { id: String(pin) }, headers: { "idempotency-key": `s5br-${tag}-pin` }, body: {}, user: admin });
  const pinned = (await outboxRows(`s5br-${tag}-pin`))[0];
  check(defName === null ? pinned.processor_name === null : pinned.processor_name === defName, "the default adapter selection is pinned in the outbox row at enqueue");

  // Bridge: exact salesDealId + same contact only.
  const mkContact = async (n: string) => (((await db.execute(sql`INSERT INTO contacts (first_name, last_name, email, phone) VALUES ('Br', ${`Fix${n}${tag}`}, ${`br-${n}-${tag}@example.invalid`}, ${`+1305556${crypto.randomInt(1000, 9999)}`}) RETURNING id`)) as any).rows)[0].id as number;
  const c1 = await mkContact("a"), c2 = await mkContact("b");
  const salesD = Number((((await db.execute(sql`INSERT INTO deals (pipeline, stage, name, contact_id) VALUES ('sales','Closed Won',${`S5BR ${tag} bridge-sales`}, ${c1}) RETURNING id`)) as any).rows)[0].id);
  const obD = Number((((await db.execute(sql`INSERT INTO deals (pipeline, stage, name, contact_id, sales_deal_id) VALUES ('onboarding','Underwriting',${`S5BR ${tag} bridge-ob`}, ${c1}, ${salesD}) RETURNING id`)) as any).rows)[0].id);
  await db.execute(sql`INSERT INTO merchant_applications (deal_id, contact_id, legal_business_name, status, preferred_program) VALUES (${salesD}, ${c1}, 'Bridge Fixture', 'submitted', ${CERT_PROGRAM})`);
  const before = await readiness(obD);
  check(before.ready === false && codes(before).includes("application_on_sales_deal") && before.facts.applicationBinding === "sales_source", "an application on the exact source sales deal is reported, not silently used");
  const BRIDGE = "POST /api/deals/:id/bridge-application";
  const bridged = await call(BRIDGE, { params: { id: String(obD) }, user: admin });
  check(bridged.code === 200 && bridged.body.bridged === true, "the explicit bridge moves the exact source application");
  const afterApp = (((await db.execute(sql`SELECT deal_id FROM merchant_applications WHERE legal_business_name = 'Bridge Fixture' AND contact_id = ${c1}`)) as any).rows)[0];
  check(afterApp.deal_id === obD, "the application is now bound directly to the onboarding deal");
  const bridgeAudit = (((await db.execute(sql`SELECT details FROM audit_logs WHERE action = 'merchant_application_bridged_to_onboarding' AND entity_id IS NOT NULL ORDER BY id DESC LIMIT 1`)) as any).rows)[0];
  check(bridgeAudit && bridgeAudit.details.toDealId === obD && bridgeAudit.details.fromDealId === salesD, "the bridge is audited with both deal ids");
  check((await call(BRIDGE, { params: { id: String(obD) }, user: admin })).body.reason === "already_direct", "a second bridge is a no-op (already direct)");
  // Negative controls: other-contact application and an onboarding deal with no sales source are never matched.
  const salesE = Number((((await db.execute(sql`INSERT INTO deals (pipeline, stage, name, contact_id) VALUES ('sales','Closed Won',${`S5BR ${tag} bridge-sales2`}, ${c1}) RETURNING id`)) as any).rows)[0].id);
  const obE = Number((((await db.execute(sql`INSERT INTO deals (pipeline, stage, name, contact_id, sales_deal_id) VALUES ('onboarding','Underwriting',${`S5BR ${tag} bridge-ob2`}, ${c2}, ${salesE}) RETURNING id`)) as any).rows)[0].id);
  await db.execute(sql`INSERT INTO merchant_applications (deal_id, contact_id, legal_business_name, status) VALUES (${salesE}, ${c1}, 'Bridge Other Contact', 'submitted')`);
  const bE = await call(BRIDGE, { params: { id: String(obE) }, user: admin });
  check(bE.code === 409 && bE.body.reason === "no_exact_source_application", "negative control: an application of a different contact is never bridged");
  const loose = await deal("bridge-loose", { complete: false });
  await db.execute(sql`DELETE FROM merchant_applications WHERE deal_id = ${loose}`);
  check(codes(await readiness(loose)).includes("no_linked_application"), "no same-contact fallback: a deal with no exact application reports no_linked_application");
}

// ── S5-19 ────────────────────────────────────────────────────────────────────
const REFRESH = "POST /api/boarding/refresh-all";
{
  const mine = await deal("mine", { owner: agentA.email, boardingStatus: "submitted" });
  const theirs = await deal("theirs", { owner: `other-${tag}@example.invalid`, boardingStatus: "submitted" });
  check((await call(REFRESH, { body: { dealIds: "1" }, user: admin })).code === 400, "non-array dealIds is a 400");
  check((await call(REFRESH, { body: { dealIds: [1, "2"] }, user: admin })).code === 400, "string ids are a 400");
  check((await call(REFRESH, { body: { dealIds: [1.5] }, user: admin })).code === 400, "fractional ids are a 400");
  check((await call(REFRESH, { body: { dealIds: Array.from({ length: 201 }, (_, i) => i + 1) }, user: admin })).code === 400, "more than 200 ids is a 400");
  const foreign = await call(REFRESH, { body: { dealIds: [theirs] }, user: agentA });
  check(foreign.body.attempted === 0 && foreign.body.skipped === 1, "agent naming another owner's deal attempts nothing (negative control)");
  const dup = await call(REFRESH, { body: { dealIds: [mine, mine] }, user: agentA });
  check(dup.body.attempted === 1, "duplicate ids are refreshed once");
  const scoped = await call(REFRESH, { body: {}, user: agentA });
  const ids = (scoped.body.results ?? []).map((r: any) => r.dealId);
  check(ids.includes(mine) && !ids.includes(theirs), "unscoped agent refresh selects only the agent's own in-flight deals");
  const adminAll = await call(REFRESH, { body: {}, user: admin });
  const adminIds = (adminAll.body.results ?? []).map((r: any) => r.dealId);
  check(adminIds.includes(mine) && adminIds.includes(theirs), "admin unscoped refresh covers all in-flight deals");
}

// ── S5-20: canonical MID writes keep one deterministic alias ───────────────
{
  const d = await deal("mid");
  const contact = (((await db.execute(sql`INSERT INTO contacts (first_name, last_name, email, phone) VALUES ('Mid', ${`Fixture${tag}`}, ${`mid-${tag}@example.invalid`}, ${`+1305555${tag.replace(/[a-f]/g, '1').slice(0,4)}`}) RETURNING id`)) as any).rows)[0].id as number;
  await db.execute(sql`UPDATE deals SET contact_id = ${contact} WHERE id = ${d}`);
  const created = await mids.createMerchantMid({ contactId: contact, dealId: d, mid: `FIXMID${tag}001` });
  const alias = async () => (((await db.execute(sql`SELECT mid FROM deals WHERE id = ${d}`)) as any).rows)[0].mid;
  check(await alias() === created.mid, "createMerchantMid fills an empty deal alias in the same transaction (negative control: original left it null)");
  const second = await mids.createMerchantMid({ contactId: contact, dealId: d, mid: `FIXMID${tag}002` });
  check(await alias() === created.mid && second.id !== created.id, "a second canonical row does not overwrite a different alias");
  // R08: closing the aliased MID moves the alias; the closed row stays as history and cannot be reused or resurrected.
  await mids.updateMerchantMid({ id: created.id, status: "closed" });
  check(await alias() === second.mid, "closing the aliased MID moves the alias to the next live MID (negative control: the closed MID stayed the alias)");
  const allRows = async () => (((await db.execute(sql`SELECT id, mid, status, processor_name FROM merchant_mids WHERE deal_id = ${d} ORDER BY id`)) as any).rows) as any[];
  const assigned = await mids.assignMerchantMidToCanonical({ dealId: d, contactId: contact, mid: `FIXMID${tag}003`, processorName: "nmi" });
  const rowsAfter = await allRows();
  check(assigned.created && assigned.midRow.id !== second.id && assigned.isPrimary === false && rowsAfter.length === 3
    && rowsAfter.find((r) => r.id === second.id)?.mid === second.mid && await alias() === second.mid,
    "a new MID value creates a new row (multiple MIDs per deal); it never rewrites another MID's value and does not displace a live primary");
  check(rowsAfter.find((r) => r.id === assigned.midRow.id)?.processor_name === "nmi", "the requested processor is honored on the new row");
  const exact = await mids.assignMerchantMidToCanonical({ dealId: d, contactId: contact, mid: `FIXMID${tag}002`, status: "active", processorName: "payarc" });
  check(exact.midRow.id === second.id && !exact.created && exact.midRow.status === "active" && exact.isPrimary, "an exact match is reused and honors the requested status and processor");
  const noStatus = await mids.assignMerchantMidToCanonical({ dealId: d, contactId: contact, mid: `FIXMID${tag}002` });
  check(noStatus.midRow.status === "active", "omitting status never demotes an existing active MID (provider-refresh path)");
  const codeOf = async (fn: () => Promise<unknown>) => { try { await fn(); return "none"; } catch (e: any) { return e.code ?? "other"; } };
  check(await codeOf(() => mids.assignMerchantMidToCanonical({ dealId: d, contactId: contact, mid: `FIXMID${tag}001` })) === "MID_CLOSED"
    && (await allRows()).find((r) => r.id === created.id)?.status === "closed", "a closed MID row is never reused or reopened");
  check(await codeOf(() => mids.assignMerchantMidToCanonical({ dealId: d, contactId: contact, mid: `FIXMID${tag}002`, status: "assigned" })) === "MID_ILLEGAL_TRANSITION", "an illegal requested status transition is refused");
  check(await codeOf(() => mids.assignMerchantMidToCanonical({ dealId: d, contactId: contact, mid: `FIXMID${tag}004`, status: "bogus" })) === "MID_INVALID_STATUS", "an unknown status is refused");
  const otherDeal = await deal("mid-other");
  await db.execute(sql`UPDATE deals SET contact_id = ${contact} WHERE id = ${otherDeal}`);
  check(await codeOf(() => mids.assignMerchantMidToCanonical({ dealId: otherDeal, contactId: contact, mid: `FIXMID${tag}002` })) === "MID_ALREADY_ASSIGNED", "a MID attached to another deal is refused, not stolen");
  await mids.updateMerchantMid({ id: second.id, status: "closed" });
  await mids.updateMerchantMid({ id: assigned.midRow.id, status: "closed" });
  check(await alias() === null, "closing every MID clears the alias; no closed MID remains readable as live");
  const midAudit = await db.execute(sql`SELECT details FROM audit_logs WHERE action IN ('mid_created','mid_assigned') AND entity_id IN (${d}, ${created.id}, ${second.id})`);
  check(!JSON.stringify((midAudit as any).rows).includes(`FIXMID${tag}`), "audit rows carry masked MIDs only");
  // S5-21: the registry reads canonical rows, masks MIDs, and reports totals.
  const d2 = await deal("registry");
  await db.execute(sql`UPDATE deals SET contact_id = ${contact} WHERE id = ${d2}`);
  await db.execute(sql`INSERT INTO merchant_mids (contact_id, deal_id, mid, tids, processor_name) VALUES (${contact}, ${d2}, ${`CANONMID${tag}9999`}, '{}', 'payarc')`);
  const reg = await call("GET /api/boarding/mid-registry", { user: admin });
  const regRow = (reg.body.merchants as any[]).find((m) => m.deal_id === d2);
  check(regRow && regRow.has_mid === true && regRow.mid_status === "assigned", "registry shows a canonical-only MID (negative control: original read only deals.mid)");
  check(!JSON.stringify(reg.body).includes(`CANONMID${tag}`) && regRow.mid_masked.endsWith("9999"), "registry returns masked MIDs only");
  check(typeof reg.body.total === "number" && reg.body.total >= reg.body.returned && reg.body.truncated === (reg.body.total > reg.body.returned), "registry reports total/returned/truncated");
  check(reg.body.unit === "deals" && typeof reg.body.asOf === "string" && reg.body.scopeTotal >= reg.body.total && reg.body.byStatus && typeof reg.body.byStatus.live === "number", "registry states its row unit, as-of time, scope total and per-status counts");
  // R08: closed MID via alias never shows; Go-Live Scheduled is scheduled, not live; pagination beyond a page is stable and complete.
  const dClosed = await deal("registry-closed");
  await db.execute(sql`UPDATE deals SET contact_id = ${contact}, mid = ${`ALIASONLY${tag}7777`} WHERE id = ${dClosed}`);
  await db.execute(sql`INSERT INTO merchant_mids (contact_id, deal_id, mid, tids, processor_name, status) VALUES (${contact}, ${dClosed}, ${`ALIASONLY${tag}7777`}, '{}', 'payarc', 'closed')`);
  const dSched = await deal("registry-sched", { stage: "Go-Live Scheduled" });
  const fresh = await call("GET /api/boarding/mid-registry", { user: admin, query: { limit: "100" } });
  const closedRow = (fresh.body.merchants as any[]).find((m) => m.deal_id === dClosed);
  const schedRow = (fresh.body.merchants as any[]).find((m) => m.deal_id === dSched);
  check(closedRow && closedRow.has_mid === false && closedRow.mid_masked === null && closedRow.mid_status === "pending", "a closed MID that is still the deals.mid alias is not shown as live or assigned (negative control: the alias fallback resurrected it)");
  check(schedRow && schedRow.mid_status === "scheduled", "Go-Live Scheduled is reported as scheduled, not live");
  const seen: number[] = []; let off = 0; let totalSeen = -1;
  for (let i = 0; i < 200; i++) {
    const pg = await call("GET /api/boarding/mid-registry", { user: admin, query: { limit: "2", offset: String(off) } });
    totalSeen = pg.body.total;
    for (const m of pg.body.merchants) seen.push(m.deal_id);
    off += pg.body.returned;
    if (!pg.body.hasMore) break;
  }
  check(totalSeen > 2 && seen.length === totalSeen && new Set(seen).size === seen.length, "paging 2 at a time visits every deal exactly once and matches the reported total (no 500-row cap)");
  const filtered = await call("GET /api/boarding/mid-registry", { user: admin, query: { midStatus: "scheduled", limit: "100" } });
  check(filtered.body.merchants.every((m: any) => m.mid_status === "scheduled") && filtered.body.total === filtered.body.byStatus.scheduled && filtered.body.scopeTotal >= filtered.body.total, "the status filter is applied to rows and total on the same scope");
  check((await call("GET /api/boarding/mid-registry", { user: admin, query: { midStatus: "bogus" } })).code === 400, "an unknown registry status is a 400");
}

// ── S5-08: local underwriting override never depends on the optional GHL task ─
{
  const r = await db.execute(sql`INSERT INTO deals (pipeline, stage, name) VALUES ('sales', 'Review In Progress', ${`S5UW ${tag}`}) RETURNING id`);
  const uwDeal = Number(((r as any).rows ?? r)[0].id);
  await db.execute(sql`INSERT INTO underwriting_decisions (deal_id, decision, score, reasons) VALUES (${uwDeal}, 'review', 50, ARRAY['fixture'])`);
  const { decisionRevisionSql } = await import("../../server/services/underwriting-read-model");
  const decisionRow = (((await db.execute(sql.raw(`SELECT ud.id, ${decisionRevisionSql("ud")} AS rev FROM underwriting_decisions ud WHERE ud.deal_id = ${uwDeal}`))) as any).rows)[0];
  const approve = await call("POST /api/underwriting/deals/:id/approve", { params: { id: String(uwDeal) },
    body: { expectedDecisionId: Number(decisionRow.id), expectedRevision: decisionRow.rev, reason: "fixture approval", commandId: crypto.randomUUID() }, user: { ...admin, id: "fixture-admin" } });
  check(approve.code === 200 && approve.body.decision.overrideAction === "approve", "manager approval commits the local override");
  const stage = (((await db.execute(sql`SELECT stage FROM deals WHERE id = ${uwDeal}`)) as any).rows)[0].stage;
  check(stage === "Proposal Sent", "approval advances the deal locally");
  const auditRow = (((await db.execute(sql`SELECT details FROM audit_logs WHERE action = 'underwriting_manual_approve' AND entity_id = ${uwDeal}`)) as any).rows)[0];
  check(auditRow && auditRow.details.stageMoved === true && approve.body.followOns?.state === "queued", "audit is written in the commit; the optional GHL task is a durable queued follow-on, not a claim that it was sent");
  const src = readFileSync("server/routes/underwriting.ts", "utf8");
  check(!/requireGhlRouteMutationAllowed/.test(src), "no pre-write GHL pause gate remains on the local decision commands");
}

// ── S5-24: worker selection and pure rules read ─────────────────────────────
{
  const { isLocalOutboxWorkerSelected } = await import("../../server/services/background-profile");
  const origProfile = process.env.BACKGROUND_JOB_PROFILE;
  const sel = (v: string | undefined) => { if (v === undefined) delete process.env.BACKGROUND_JOB_PROFILE; else process.env.BACKGROUND_JOB_PROFILE = v; return isLocalOutboxWorkerSelected(); };
  const results = {
    off: sel("off"), missing: sel(undefined), invalid: sel("bogus"), ghlOnly: sel("ghl-sync-only"),
    core: sel("core"), full: sel("full"),
    selCritical: sel("selective:critical-commands"), selOther: sel("selective:enrichment,outreach"), selBad: sel("selective:nonsense"),
  };
  check(!results.off && !results.missing && !results.invalid && !results.ghlOnly && !results.selOther && !results.selBad,
    "outbox workers are NOT selected for off, missing, invalid, ghl-sync-only, or a selective profile without critical-commands (negative control: the original started them for every non-off profile)");
  check(results.core && results.full && results.selCritical, "outbox workers are selected for core, full and selective:critical-commands");
  if (origProfile === undefined) delete process.env.BACKGROUND_JOB_PROFILE; else process.env.BACKGROUND_JOB_PROFILE = origProfile;

  const saved = (((await db.execute(sql`SELECT * FROM underwriting_rules WHERE id = 1`)) as any).rows)[0];
  await db.execute(sql`DELETE FROM underwriting_rules WHERE id = 1`);
  try {
    const rulesCount = async () => Number((((await db.execute(sql`SELECT count(*)::int AS n FROM underwriting_rules`)) as any).rows)[0].n);
    const got = await call("GET /api/underwriting/rules", { user: admin });
    check(got.code === 404 && await rulesCount() === 0, "GET rules with no configuration reports 404 and inserts nothing (negative control: the original inserted defaults from a GET)");
    const { runUnderwritingEngine } = await import("../../server/services/underwriting-engine");
    const decision = await runUnderwritingEngine({ deal: { id: 1, totalVolume: "50000" } as any } as any);
    check(decision.decision === "review" && /not configured/.test(decision.reasons.join(" ")) && await rulesCount() === 0, "the engine routes to review when rules are not configured and does not create them");
    const put = await call("PUT /api/underwriting/rules", { user: admin, body: { minMonthlyVolume: 1000, maxMonthlyVolume: 90000, autoApproveEnabled: false } });
    check(put.code === 200 && await rulesCount() === 1, "the authorized PUT command creates the rules row from exactly the supplied values");
  } finally {
    await db.execute(sql`DELETE FROM underwriting_rules WHERE id = 1`);
    if (saved) {
      const cols = Object.keys(saved);
      await db.execute(sql.raw(`INSERT INTO underwriting_rules (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map((c) => {
        const v = saved[c];
        if (v === null) return "NULL";
        if (Array.isArray(v)) return `ARRAY[${v.map((x: string) => `'${String(x).replace(/'/g, "''")}'`).join(",")}]::text[]`;
        if (v instanceof Date) return `'${v.toISOString()}'`;
        if (typeof v === "boolean" || typeof v === "number") return String(v);
        return `'${String(v).replace(/'/g, "''")}'`;
      }).join(",")})`));
    }
  }
}

// ── S5-22 (embedded panel contract) ─────────────────────────────────────────
{
  // R05: the real admin handler (not a source regex) and the transport validator agree on every host/path/port/userinfo case.
  const adminRoutes = new Map<string, Handler>();
  const capAdmin = (method: string) => (path: string, ...handlers: Handler[]) => { adminRoutes.set(`${method} ${path}`, handlers[handlers.length - 1]); };
  const adminApp: any = new Proxy({}, { get: (_t, m: string) => capAdmin(m.toUpperCase()) });
  const { registerAdminRoutes } = await import("../../server/routes/admin");
  registerAdminRoutes(adminApp);
  const SNAP = "POST /api/admin/processor-activation-snapshots";
  const snapCall = async (authorizedBaseUrl: unknown) => {
    const res: any = { code: 200, body: undefined, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    await adminRoutes.get(SNAP)!({ params: {}, headers: {}, user: admin, body: {
      processorName: "payarc", processorProgram: "traditional", sandboxEntitlement: true, productionEntitlement: false,
      authorizedBaseUrl, supportedOperations: ["board_merchant", "get_merchant_status"], ownerConfirm: true, notes: "R05 cert" } }, res);
    return res as { code: number; body: any };
  };
  const { checkProcessorBaseUrl } = await import("../../server/services/processors/processor-base-url");
  const refusedCases = ["http://testapi.payarc.net/v1", "https://u:p@testapi.payarc.net/v1", "https://testapi.payarc.net:8443/v1", "https://testapi.payarc.net/v1?x=1",
    "https://testapi.payarc.net", "https://testapi.payarc.net/other", "https://evil.example.com/v1", "https://testapi.payarc.net.evil.com/v1", "https://sandbox.payarc.net/v1", "https://api.payarc.com/v1"];
  let allRefused = true, validatorAgrees = true;
  for (const url of refusedCases) {
    const r = await snapCall(url);
    if (r.code !== 400) allRefused = false;
    if (checkProcessorBaseUrl("payarc", url).ok) validatorAgrees = false;
  }
  check(allRefused && validatorAgrees, "the admin snapshot route refuses every host/scheme/port/userinfo/query/path variant the transport validator refuses");
  const createdBefore = Number(((await db.execute(sql`SELECT count(*)::int AS n FROM processor_activation_snapshots`)) as any).rows[0].n);
  const okSnap = await snapCall("https://testapi.payarc.net/v1/");
  check(okSnap.code === 201 && okSnap.body.snapshot.authorizedBaseUrl === "https://testapi.payarc.net/v1", "the documented sandbox base is accepted and stored in normalized form");
  const createdAfter = Number(((await db.execute(sql`SELECT count(*)::int AS n FROM processor_activation_snapshots`)) as any).rows[0].n);
  check(createdAfter === createdBefore + 1, "exactly one snapshot row was created by the accepted request, none by the refused ones");
  await db.execute(sql`DELETE FROM processor_activation_snapshots WHERE id = ${okSnap.body.snapshot.id}`);
  // R05 registry gate: a stored snapshot URL that bypassed the admin validator is refused by the transport gate itself.
  {
    const { requireConfirmedActivationSnapshot } = await import("../../server/services/processors/registry");
    const gateFor = async (url: string | null) => {
      const ins = await db.execute(sql`
        INSERT INTO processor_activation_snapshots (processor_name, processor_program, sandbox_entitlement, production_entitlement, authorized_base_url, supported_operations, status, created_at)
        VALUES ('payarc', 'traditional', true, true, ${url}, '["board_merchant"]'::jsonb, 'owner_confirmed', now() + interval '1 hour') RETURNING id`);
      const id = (ins as any).rows[0].id as number;
      try {
        await requireConfirmedActivationSnapshot("payarc", "board_merchant");
        return "accepted";
      } catch (e: any) { return String(e?.code ?? e?.message); }
      finally { await db.execute(sql`DELETE FROM processor_activation_snapshots WHERE id = ${id}`); }
    };
    check((await gateFor("https://testapi.payarc.net/v1")) === "accepted", "the registry gate accepts the documented sandbox base stored in normalized form");
    check((await gateFor("https://testapi.payarc.net")) === "ACTIVATION_SNAPSHOT_URL_INVALID", "negative control: a snapshot stored without /v1 (predates the validator) fails closed at the gate");
    check((await gateFor("https://evil.example.com/v1")) === "ACTIVATION_SNAPSHOT_URL_INVALID", "negative control: a foreign host stored directly in the table fails closed at the gate");
    check((await gateFor("http://api.payarc.net/v1")) === "ACTIVATION_SNAPSHOT_URL_INVALID", "negative control: a non-https base fails closed at the gate");
    check((await gateFor(null)) === "ACTIVATION_SNAPSHOT_URL_MISSING", "negative control: a snapshot with no base URL fails closed at the gate");
  }
  const panel = readFileSync("client/src/components/BoardingPanel.tsx", "utf8");
  check(/"Idempotency-Key"\s*:\s*keys\.get\(commandIdentity\)/.test(panel) && /commandIdentity = `\$\{user\?\.id[^`]*\$\{dealId\}[^`]*\$\{revision[^`]*processorChoice/.test(panel),
    "BoardingPanel sends a durable key bound to actor + deal + reviewed revision + processor");
  check(/expectedApplicationRevision: revision/.test(panel), "BoardingPanel sends the reviewed application revision with the command");
  check(!/data\.processorApplicationId/.test(panel.slice(panel.indexOf("submitMutation"), panel.indexOf("refreshMutation"))), "BoardingPanel does not claim an immediate provider application id from the 202 response");
  check(/midMasked/.test(panel) && !/s\.mid\b/.test(panel), "BoardingPanel reads midMasked/hasMid only");
}

console.log(`\nStage 5 boarding route certification: ${checks} checks passed`);
await pool.end();
process.exit(0);
