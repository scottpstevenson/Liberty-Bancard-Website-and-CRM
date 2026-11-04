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

async function deal(label: string, over: { owner?: string; boardingStatus?: string | null } = {}) {
  const r = await db.execute(sql`
    INSERT INTO deals (pipeline, stage, name, owner, boarding_status)
    VALUES ('onboarding', 'Underwriting', ${`S5BR ${tag} ${label}`}, ${over.owner ?? null}, ${over.boardingStatus ?? null}) RETURNING id`);
  const dealId = Number(((r as any).rows ?? r)[0].id);
  await db.execute(sql`INSERT INTO merchant_applications (deal_id, legal_business_name) VALUES (${dealId}, ${`S5BR ${label}`})`);
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
  check(auditRow && auditRow.details.ghlTask === "not_applicable", "audit records the optional GHL task state truthfully");
  const src = readFileSync("server/routes/underwriting.ts", "utf8");
  check(!/requireGhlRouteMutationAllowed/.test(src), "no pre-write GHL pause gate remains on the local decision commands");
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
