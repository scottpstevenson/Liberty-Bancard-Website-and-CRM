/**
 * Stage 5 (S5-10) — underwriting conditions certification. Disposable database; REAL route handlers (middleware
 * chain included) with a capture-only app; no provider, no real send. Negative controls throughout.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 5 underwriting conditions certification" });
process.env.VG_PROVIDER_DENY_MODE = "1";
process.env.BACKGROUND_JOB_PROFILE = "off";
applyCertificationProviderDenyBoundary({ fatal: true });

const { db } = await import("../../server/db");
const { sql } = await import("drizzle-orm");
const { registerUnderwritingConditionRoutes } = await import("../../server/routes/underwriting-conditions");
const checklist = await import("../../server/services/underwriting-checklist-service");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [S5-UC-${String(checks).padStart(2, "0")}] ${message}`); };
const tag = crypto.randomBytes(4).toString("hex");
const q = async (s: any) => ((await db.execute(s)) as any).rows as any[];

type H = (req: any, res: any, next?: any) => unknown;
const routes = new Map<string, H[]>();
const cap = (m: string) => (path: string, ...hs: H[]) => { routes.set(`${m} ${path}`, hs); };
registerUnderwritingConditionRoutes({ get: cap("GET"), post: cap("POST"), patch: cap("PATCH"), delete: cap("DELETE") } as any);

async function call(route: string, req: { params?: any; body?: any; query?: any; user: any | null }) {
  const chain = routes.get(route); assert(chain, `route registered: ${route}`);
  const res: any = { code: 200, body: undefined, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; }, send(b: unknown) { this.body = b; return this; } };
  const r: any = { params: {}, body: {}, query: {}, headers: {}, ...req, isAuthenticated: () => !!req.user, session: {} };
  for (const h of chain) {
    let advanced = false;
    await h(r, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res as { code: number; body: any };
}
const uid = () => crypto.randomUUID();
const admin = { id: uid(), role: "admin", email: `admin-${tag}@example.invalid` };
const manager = { id: uid(), role: "manager", email: `mgr-${tag}@example.invalid` };
const agent = { id: uid(), role: "agent", email: `agent-${tag}@example.invalid` };

const mkContact = async (l: string) => Number((await q(sql`INSERT INTO contacts (first_name,last_name,email,phone) VALUES ('S5UC',${l},${`s5uc-${tag}-${l}@example.invalid`},${`+1305559${String(Math.floor(1000 + Math.random() * 8999))}`}) RETURNING id`))[0].id);
const mkDeal = async (l: string, contactId: number | null = null) => Number((await q(sql`INSERT INTO deals (pipeline,stage,name,contact_id) VALUES ('onboarding','Underwriting',${`S5UC ${tag} ${l}`},${contactId}) RETURNING id`))[0].id);
const mkDoc = async (dealId: number | null, contactId: number | null) => Number((await q(sql`INSERT INTO documents (type,file_name,deal_id,contact_id) VALUES ('Other',${`s5uc-${tag}.pdf`},${dealId},${contactId}) RETURNING id`))[0].id);
const mkDecision = async (dealId: number) => Number((await q(sql`INSERT INTO underwriting_decisions (deal_id,decision,score) VALUES (${dealId},'hold',10) RETURNING id`))[0].id);

const POST = "POST /api/underwriting/deals/:id/conditions", PATCH = "PATCH /api/underwriting/conditions/:id";
const GET = "GET /api/underwriting/deals/:id/conditions", DEL = "DELETE /api/underwriting/conditions/:id";
const CHASE = "POST /api/underwriting/deals/:id/conditions/chase";

// ── Access, strictness, actor identity ───────────────────────────────────────
const contactA = await mkContact("a");
const dealA = await mkDeal("A", contactA), dealB = await mkDeal("B", await mkContact("b"));
check((await call(POST, { params: { id: String(dealA) }, body: { conditionType: "x", description: "y" }, user: agent })).code === 403, "an agent cannot add a condition");
check((await call(POST, { params: { id: String(dealA) }, body: { conditionType: "x", description: "y" }, user: null })).code === 401, "an unauthenticated caller cannot add a condition");
const bad = await call(POST, { params: { id: String(dealA) }, body: { conditionType: "x", description: "y", status: "approved", createdBy: "forged" }, user: admin });
check(bad.code === 400, "unknown or forged fields are refused (strict command)");

const created = await call(POST, { params: { id: String(dealA) }, body: { conditionType: "extra_doc", description: "Extra evidence" }, user: manager });
check(created.code === 201 && created.body.createdBy === manager.id && created.body.updatedBy === manager.id, "the real string (UUID) actor id is stored on create");
const stored = (await q(sql`SELECT created_by FROM underwriting_conditions WHERE id = ${created.body.id}`))[0];
check(stored.created_by === manager.id, "the actor id round-trips through the database as a string");

// ── Evidence binding ─────────────────────────────────────────────────────────
const decB = await mkDecision(dealB), decA = await mkDecision(dealA);
check((await call(POST, { params: { id: String(dealA) }, body: { conditionType: "x", description: "y", decisionId: decB }, user: admin })).code === 400, "a decision from another deal is refused");
const okDec = await call(POST, { params: { id: String(dealA) }, body: { conditionType: "x", description: "y", decisionId: decA }, user: admin });
check(okDec.code === 201 && okDec.body.decisionId === decA, "the deal's own decision is accepted");
const docB = await mkDoc(dealB, null), docOwn = await mkDoc(dealA, null), docContact = await mkDoc(null, contactA), docForeignContact = await mkDoc(null, await mkContact("z"));
check((await call(POST, { params: { id: String(dealA) }, body: { conditionType: "x", description: "y", documentId: docB }, user: admin })).code === 400, "a document that belongs to another deal is refused");
check((await call(POST, { params: { id: String(dealA) }, body: { conditionType: "x", description: "y", documentId: docForeignContact }, user: admin })).code === 400, "a document of an unrelated contact is refused");
check((await call(POST, { params: { id: String(dealA) }, body: { conditionType: "x", description: "y", documentId: 987654321 }, user: admin })).code === 400, "a nonexistent document is refused");
check((await call(POST, { params: { id: String(dealA) }, body: { conditionType: "x", description: "y", documentId: docOwn }, user: admin })).code === 201, "the deal's own document is accepted");
check((await call(POST, { params: { id: String(dealA) }, body: { conditionType: "x", description: "y", documentId: docContact }, user: admin })).code === 201, "the deal's own contact's document is accepted");
check((await call(POST, { params: { id: "987654321" }, body: { conditionType: "x", description: "y" }, user: admin })).code === 404, "an unknown deal is a 404");

// ── Legal transitions, waiver and reversal ───────────────────────────────────
const id = created.body.id as number;
const patch = (body: any, user: any = admin) => call(PATCH, { params: { id: String(id) }, body, user });
check((await patch({ status: "approved" })).code === 409, "pending cannot jump to approved");
check((await patch({ status: "waived" })).code === 400, "waiving without a reason is refused");
check((await patch({ status: "bogus" })).code === 400, "an unknown status is refused");
check((await patch({ status: "pending", waivedReason: "x" })).code === 400, "a waiver reason on a non-waive command is refused");
const sub = await patch({ status: "submitted", documentId: docOwn });
check(sub.code === 200 && sub.body.status === "submitted" && sub.body.submittedAt && sub.body.documentId === docOwn && sub.body.updatedBy === admin.id, "submit sets the server timestamp, binds the deal's document and records the actor");
check((await patch({ documentId: docB })).code === 400, "re-binding to a foreign deal's document is refused");
const appr = await patch({ status: "approved" });
check(appr.code === 200 && appr.body.approvedAt, "submitted can be approved");
check((await patch({ status: "pending" })).code === 400, "reversing an approval without a reason is refused");
const rev = await patch({ status: "pending", reversalReason: "wrong document" });
check(rev.code === 200 && rev.body.status === "pending" && rev.body.approvedAt === null && rev.body.submittedAt === null && rev.body.reversalReason === "wrong document" && rev.body.reversedBy === admin.id && rev.body.reversedAt, "a reversal requires a reason, clears active timestamps and records who/when/why");
const wv = await patch({ status: "waived", waivedReason: "Not applicable to a new merchant" }, manager);
check(wv.code === 200 && wv.body.status === "waived" && wv.body.waivedAt && wv.body.waivedBy === manager.id && wv.body.waivedReason, "a waiver records the reason, time and authorizing actor");
const hist = await q(sql`SELECT count(*)::int AS n FROM audit_logs WHERE entity_type = 'underwriting_condition' AND entity_id = ${id}`);
check(Number(hist[0].n) >= 5, "every command wrote an audit row preserving the before/after state");
check((await patch({ status: "approved" })).code === 409, "a waived condition cannot jump to approved");

// ── Supersede instead of delete ──────────────────────────────────────────────
check((await call(DEL, { params: { id: String(id) }, body: { reason: "dup" }, user: manager })).code === 403, "only an admin can supersede a condition");
check((await call(DEL, { params: { id: String(id) }, body: {}, user: admin })).code === 400, "superseding requires a reason");
const sup = await call(DEL, { params: { id: String(id) }, body: { reason: "entered in error" }, user: admin });
check(sup.code === 200 && sup.body.superseded === true && sup.body.condition.supersededBy === admin.id && sup.body.condition.supersededReason === "entered in error", "supersede records who/when/why");
check(Number((await q(sql`SELECT count(*)::int AS n FROM underwriting_conditions WHERE id = ${id}`))[0].n) === 1, "the row is preserved as evidence (no hard delete)");
const listed = await call(GET, { params: { id: String(dealA) }, user: admin });
const listedAll = await call(GET, { params: { id: String(dealA) }, query: { includeSuperseded: "1" }, user: admin });
check(!listed.body.conditions.some((c: any) => c.id === id) && listedAll.body.conditions.some((c: any) => c.id === id), "superseded conditions are hidden by default and visible on request");
check((await patch({ notes: "edit" })).code === 409, "a superseded condition cannot be edited");
const again = await call(DEL, { params: { id: String(id) }, body: { reason: "again" }, user: admin });
check(again.code === 200 && again.body.alreadySuperseded === true && again.body.condition.supersededReason === "entered in error", "a repeated supersede is idempotent and keeps the first reason");

// ── Race-safe initialization ─────────────────────────────────────────────────
const dealI = await mkDeal("init", await mkContact("i"));
const sent: any[] = [];
const open = { authorize: async () => ({ allowed: true }), canExecute: async () => true, isSmtpConfigured: () => true, sendEmail: async (m: any) => { sent.push(m); } };
await Promise.all(Array.from({ length: 6 }, () => checklist.initUnderwritingConditions(dealI, "m@example.invalid", "Merch Ant", null, open)));
const stdCount = async (d: number) => Number((await q(sql`SELECT count(*)::int AS n FROM underwriting_conditions WHERE deal_id = ${d} AND automation_key IS NOT NULL`))[0].n);
check(await stdCount(dealI) === 6, "six concurrent initializations create exactly the six standard conditions");
check(sent.length === 1, "six concurrent initializations send exactly one chase");
await db.execute(sql`DELETE FROM underwriting_conditions WHERE deal_id = ${dealI} AND condition_type IN ('photo_id','voided_check')`);
const filled = await checklist.initUnderwritingConditions(dealI, "m@example.invalid", "Merch Ant", null, open);
check(filled.inserted === 2 && await stdCount(dealI) === 6, "a partially initialized deal gets only its missing conditions");
const one = (await q(sql`SELECT id FROM underwriting_conditions WHERE deal_id = ${dealI} AND condition_type = 'bank_statements'`))[0].id;
await call(DEL, { params: { id: String(one) }, body: { reason: "not needed" }, user: admin });
const refill = await checklist.initUnderwritingConditions(dealI, "m@example.invalid", "Merch Ant", null, open);
check(refill.inserted === 0, "a superseded standard condition is not resurrected by re-initialization");
const noKeyDeal = await mkDeal("legacy");
await db.execute(sql`INSERT INTO underwriting_conditions (deal_id, condition_type, description, status) VALUES (${noKeyDeal}, 'photo_id', 'legacy row', 'pending')`);
await checklist.initUnderwritingConditions(noKeyDeal, null, null, null, open);
check(Number((await q(sql`SELECT count(*)::int AS n FROM underwriting_conditions WHERE deal_id = ${noKeyDeal}`))[0].n) === 7, "initialization is additive around a manually entered row of the same type (distinct identity)");

// ── Chase under pause and recovery ───────────────────────────────────────────
const dealP = await mkDeal("pause", await mkContact("p"));
const sentP: any[] = [];
let paused = true;
const gated = { authorize: async () => paused ? { allowed: false, reasonCode: "global_pause" } : { allowed: true }, canExecute: async () => true, isSmtpConfigured: () => true, sendEmail: async (m: any) => { sentP.push(m); } };
await checklist.initUnderwritingConditions(dealP, "p@example.invalid", "Pau Se", null, gated);
const chaseRow = async (d: number) => (await q(sql`SELECT status, attempts, last_reason, sent_at FROM underwriting_condition_chases WHERE deal_id = ${d} AND channel = 'email'`))[0];
let cr = await chaseRow(dealP);
check(sentP.length === 0 && cr.status === "owed" && cr.attempts === 0 && String(cr.last_reason).startsWith("paused:"), "under a pause the chase stays owed with its reason, nothing is sent and no attempt is burned");
check((await q(sql`SELECT 1 FROM underwriting_conditions WHERE deal_id = ${dealP}`)).length === 6, "the conditions themselves were still created under the pause");
const stillPaused = await checklist.retryOwedConditionChases({ dealId: dealP }, gated);
check(stillPaused.sent === 0 && stillPaused.stillOwed === 1, "a sweep during the pause sends nothing");
paused = false;
const slow: any = { ...gated, sendEmail: async (m: any) => { await new Promise((r) => setTimeout(r, 50)); sentP.push(m); } };
const sweeps = await Promise.all([checklist.retryOwedConditionChases({ dealId: dealP }, slow), checklist.retryOwedConditionChases({ dealId: dealP }, slow), checklist.retryOwedConditionChases({ dealId: dealP }, slow)]);
cr = await chaseRow(dealP);
check(sentP.length === 1 && sweeps.reduce((n, r) => n + r.sent, 0) === 1 && cr.status === "sent" && cr.sent_at, "after the pause lifts three concurrent sweeps send exactly once");
check((await checklist.retryOwedConditionChases({ dealId: dealP }, slow)).attempted === 0 && sentP.length === 1, "a later sweep does not resend a sent chase");
const routeChase = await call(CHASE, { params: { id: String(dealP) }, user: agent });
check(routeChase.code === 403, "an agent cannot trigger a chase");
const routeOk = await call(CHASE, { params: { id: String(dealP) }, user: manager });
check(routeOk.code === 200 && routeOk.body.sent === 0, "the explicit chase route is a safe no-op once sent");

// Unknown outcome is held, never auto-resent.
const dealU = await mkDeal("unknown", await mkContact("u"));
let throwOnce = true; const sentU: any[] = [];
const flaky = { ...open, sendEmail: async (m: any) => { if (throwOnce) { throwOnce = false; throw new Error("connection reset"); } sentU.push(m); } };
await checklist.initUnderwritingConditions(dealU, "u@example.invalid", "Un Known", null, flaky);
const held = await chaseRow(dealU);
await checklist.retryOwedConditionChases({ dealId: dealU }, flaky);
check(held.status === "sending" && String(held.last_reason).startsWith("unknown_outcome:") && sentU.length === 0, "a send that may have reached the provider is held as an unknown outcome and never auto-resent");
// Not configured stays owed.
const dealN = await mkDeal("noconf", await mkContact("n"));
await checklist.initUnderwritingConditions(dealN, "n@example.invalid", "No Conf", null, { ...open, isSmtpConfigured: () => false });
check((await chaseRow(dealN)).status === "owed" && String((await chaseRow(dealN)).last_reason) === "smtp_not_configured", "an unconfigured sender leaves the chase owed");
// Nothing outstanding.
const dealD = await mkDeal("done", await mkContact("d"));
await checklist.initUnderwritingConditions(dealD, "d@example.invalid", "Done D", null, { ...open, authorize: async () => ({ allowed: false, reasonCode: "x" }) });
await db.execute(sql`UPDATE underwriting_conditions SET status = 'waived', waived_reason = 'n/a' WHERE deal_id = ${dealD}`);
await checklist.retryOwedConditionChases({ dealId: dealD }, open);
check((await chaseRow(dealD)).status === "not_applicable", "a chase with nothing outstanding is closed as not applicable, not sent");

console.log(`\nStage 5 underwriting conditions certification: ${checks} checks passed`);
process.exit(0);
