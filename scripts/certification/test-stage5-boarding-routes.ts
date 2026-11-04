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

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [S5-BR-${String(checks).padStart(2, "0")}] ${message}`); };
const tag = crypto.randomBytes(4).toString("hex");

type Handler = (req: any, res: any) => Promise<unknown>;
const routes = new Map<string, Handler>();
const capture = (method: string) => (path: string, ...handlers: Handler[]) => { routes.set(`${method} ${path}`, handlers[handlers.length - 1]); };
registerBoardingRoutes({ post: capture("POST"), get: capture("GET"), put: capture("PUT"), patch: capture("PATCH"), delete: capture("DELETE") } as any);

registerUnderwritingRoutes({ post: capture("POST"), get: capture("GET"), put: capture("PUT"), patch: capture("PATCH"), delete: capture("DELETE") } as any);

async function call(route: string, req: { params?: any; headers?: any; body?: any; user: any }) {
  const handler = routes.get(route);
  assert(handler, `route registered: ${route}`);
  const res: any = { code: 200, body: undefined, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  await handler!({ params: {}, headers: {}, body: {}, ...req }, res);
  return res as { code: number; body: any };
}
const admin = { role: "admin", email: "admin.fixture@example.invalid" };
const agentA = { role: "agent", email: `agent-a-${tag}@example.invalid` };
const SUBMIT = "POST /api/deals/:id/submit-to-processor";

async function deal(label: string, over: { owner?: string; boardingStatus?: string | null; pipeline?: string; complete?: boolean } = {}) {
  const r = await db.execute(sql`
    INSERT INTO deals (pipeline, stage, name, owner, boarding_status)
    VALUES (${over.pipeline ?? "onboarding"}, 'Underwriting', ${`S5BR ${tag} ${label}`}, ${over.owner ?? null}, ${over.boardingStatus ?? null}) RETURNING id`);
  const dealId = Number(((r as any).rows ?? r)[0].id);
  if (over.complete === false) {
    await db.execute(sql`INSERT INTO merchant_applications (deal_id, legal_business_name) VALUES (${dealId}, ${`S5BR ${label}`})`);
  } else {
    // Presence-only fixture values (readiness checks protected columns without decrypting).
    await db.execute(sql`INSERT INTO merchant_applications (deal_id, legal_business_name, business_address, business_city, business_state, business_zip,
        owner_first_name, owner_last_name, ein, owner_ssn, owner_dob, bank_routing_number, bank_account_number)
      VALUES (${dealId}, ${`S5BR ${label}`}, '1 Fixture Way', 'Miami', 'FL', '33101', 'Fixie', 'Tester', 'enc', 'enc', 'enc', 'enc', 'enc')`);
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
  await db.execute(sql`UPDATE merchant_mids SET status = 'closed' WHERE id = ${created.id}`);
  const assigned = await mids.assignMerchantMidToCanonical({ dealId: d, contactId: contact, mid: `FIXMID${tag}003` });
  check(assigned.midRow.id === second.id, "assign chooses the oldest non-closed canonical row deterministically");
  const exact = await mids.assignMerchantMidToCanonical({ dealId: d, contactId: contact, mid: `FIXMID${tag}001` });
  check(exact.midRow.id === created.id, "an exact MID match is preferred over other rows");
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
}

// ── S5-08: local underwriting override never depends on the optional GHL task ─
{
  const r = await db.execute(sql`INSERT INTO deals (pipeline, stage, name) VALUES ('sales', 'Review In Progress', ${`S5UW ${tag}`}) RETURNING id`);
  const uwDeal = Number(((r as any).rows ?? r)[0].id);
  await db.execute(sql`INSERT INTO underwriting_decisions (deal_id, decision, score, reasons) VALUES (${uwDeal}, 'review', 50, ARRAY['fixture'])`);
  const approve = await call("POST /api/underwriting/deals/:id/approve", { params: { id: String(uwDeal) }, body: { note: "fixture" }, user: { ...admin, id: "fixture-admin" } });
  check(approve.code === 200 && approve.body.decision.overrideAction === "approve", "manager approval commits the local override");
  const stage = (((await db.execute(sql`SELECT stage FROM deals WHERE id = ${uwDeal}`)) as any).rows)[0].stage;
  check(stage === "Proposal Sent", "approval advances the deal locally");
  const auditRow = (((await db.execute(sql`SELECT details FROM audit_logs WHERE action = 'underwriting_manual_approve' AND entity_id = ${uwDeal}`)) as any).rows)[0];
  check(auditRow && auditRow.details.stageMoved === true && approve.body.ghlTask === "not_applicable", "audit is written in the commit; the optional GHL task state is reported truthfully after commit");
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
  const adminSrc = readFileSync("server/routes/admin.ts", "utf8");
  const m = adminSrc.match(/payarc: (\/\^[^\n]*\/i),/);
  const re = m ? new RegExp(m[1].slice(1, m[1].lastIndexOf("/")), "i") : null;
  check(re && re.test("testapi.payarc.net") && re.test("api.payarc.net") && !re.test("evil.example.com") && !re.test("testapi.payarc.net.evil.com"),
    "S5-16: activation host allowlist accepts the documented sandbox host and still rejects foreign hosts");
  const panel = readFileSync("client/src/components/BoardingPanel.tsx", "utf8");
  check(/"Idempotency-Key"\s*:\s*submissionKey\(/.test(panel), "BoardingPanel sends a stable Idempotency-Key with the submit request");
  check(!/data\.processorApplicationId/.test(panel.slice(panel.indexOf("submitMutation"), panel.indexOf("refreshMutation"))), "BoardingPanel does not claim an immediate provider application id from the 202 response");
}

console.log(`\nStage 5 boarding route certification: ${checks} checks passed`);
await pool.end();
process.exit(0);
